import JSZip from "jszip";
import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import {
  systemPrompt,
  parseBuddyOutput,
  validateChanges,
  applyChanges,
} from "./career-buddy.mjs";
import { retrieveHybridChunks, wordDraft } from "./buddy-documents.mjs";
import { BUDDY_SCHEMA } from "./buddy-provider.mjs";

const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};

const text = (v, max, label) => {
  if (typeof v !== "string" || v.length > max || v.includes("\0")) {
    fail(400, "Invalid " + label + ".");
  }
  return v.trim();
};

export function createAssistantPacks({
  db,
  getRecord,
  putRecord,
  fullRecord,
  getDocuments,
  documentPath,
  saveDocument,
  scheduler,
  settings,
  indexDocuments,
  vectors,
}) {
  const now = () => new Date().toISOString();

  // Validate allowed task actions
  const ALLOWED_ACTIONS = new Set(["general", "fit", "salary", "skills", "cv", "cover"]);

  async function buildTaskPayload({
    opportunityId,
    action = "general",
    sourceIds = [],
    includeOtherOpportunities = false,
    customInstructions = "",
  }) {
    const opp = getRecord(opportunityId);
    if (!opp) fail(404, "Opportunity not found.");

    if (!ALLOWED_ACTIONS.has(action)) {
      fail(400, "Unsupported task action: " + action);
    }

    if (!Array.isArray(sourceIds) || sourceIds.length > 50) {
      fail(400, "Select up to 50 sources.");
    }

    const availableDocs = getDocuments().filter(
      (d) => !d.opportunityId || d.opportunityId === opp.id,
    );
    const availableMap = new Map(availableDocs.map((d) => [d.id, d]));

    const validSourceIds = [
      ...new Set(sourceIds.filter((id) => availableMap.has(id))),
    ];

    let indexed = [];
    if (indexDocuments && validSourceIds.length) {
      indexed = await indexDocuments(validSourceIds);
    } else {
      indexed = validSourceIds.map((id) => availableMap.get(id)).filter(Boolean);
    }

    const query = (customInstructions || action) + "\n" + (opp.role || "") + "\n" + (opp.description || "").slice(0, 12000);
    let semanticScores = new Map();
    if (vectors && indexed.length) {
      const searchRes = await vectors.search(indexed, query.slice(0, 1200));
      indexed = searchRes.documents;
      semanticScores = searchRes.scores;
    }

    const retrieval = retrieveHybridChunks(
      indexed,
      query,
      semanticScores,
      36000,
    );

    const timezone = settings().timezone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const promptInstructions = systemPrompt(timezone, today, action);

    const full = fullRecord(opp);
    const context = {
      opportunity: {
        id: full.id,
        company: full.company,
        role: full.role,
        stage: full.stage,
        outcome: full.outcome,
        priority: full.priority,
        location: full.location,
        workMode: full.workMode,
        salary: full.salary,
        employmentType: full.employmentType,
        contact: full.contact,
        deadline: full.deadline,
        nextAction: full.nextAction,
        nextActionDate: full.nextActionDate,
        jobReference: full.jobReference,
        revision: full.revision,
        description: (full.description || "").slice(0, 35000),
        events: (full.events || []).slice(-50),
        activities: (full.activities || []).slice(-40),
      },
      otherOpportunities: includeOtherOpportunities
        ? db
            .prepare("SELECT data FROM records ORDER BY rowid DESC LIMIT 100")
            .all()
            .map((row) => JSON.parse(row.data))
            .filter((o) => o.id !== opp.id)
            .map((o) => ({
              id: o.id,
              company: o.company,
              role: o.role,
              stage: o.stage,
              outcome: o.outcome,
              location: o.location,
              salary: o.salary,
              nextAction: o.nextAction,
            }))
        : [],
      excerpts: retrieval.chunks,
      coverage: {
        omittedChunks: retrieval.omittedChunks,
        files: indexed.map((d) => ({
          id: d.id,
          name: d.name,
          status: d.status,
          generatedDraft: Boolean(d.generation),
        })),
      },
    };

    const manifest = {
      version: 1,
      format: "opportunity-knox-task-pack-v1",
      createdAt: now(),
      opportunityId: opp.id,
      baseRevision: opp.revision,
      company: opp.company,
      role: opp.role,
      action,
      sourceDocuments: validSourceIds.map((id) => {
        const d = availableMap.get(id);
        return {
          id: d.id,
          name: d.name,
          kind: d.kind,
          category: d.category,
        };
      }),
    };

    const taskPayload = {
      manifest,
      instructions: promptInstructions,
      customPrompt: customInstructions || null,
      context,
      expectedSchema: BUDDY_SCHEMA,
    };

    return {
      taskPayload,
      opportunity: opp,
      sourceDocs: validSourceIds.map((id) => availableMap.get(id)).filter(Boolean),
    };
  }

  async function exportZip(options) {
    const { taskPayload, opportunity, sourceDocs } = await buildTaskPayload(options);
    const zip = new JSZip();

    zip.file("manifest.json", JSON.stringify(taskPayload.manifest, null, 2));
    zip.file("instructions.md", taskPayload.instructions);
    zip.file("context.json", JSON.stringify(taskPayload.context, null, 2));
    zip.file("schema.json", JSON.stringify(taskPayload.expectedSchema, null, 2));

    const promptText = [
      "# Task: " + taskPayload.manifest.action.toUpperCase(),
      "",
      taskPayload.customPrompt ? "User Request: " + taskPayload.customPrompt + "\n" : "",
      "Review the instructions in instructions.md and the opportunity context in context.json.",
      "Output strictly one JSON object matching schema.json.",
    ].filter(Boolean).join("\n");

    zip.file("prompt.txt", promptText);

    // Source attachments if available on disk
    if (sourceDocs && sourceDocs.length && documentPath) {
      const docsFolder = zip.folder("sources");
      for (let i = 0; i < sourceDocs.length; i++) {
        const doc = sourceDocs[i];
        try {
          const filePath = documentPath(doc);
          if (filePath) {
            const { readFileSync } = await import("node:fs");
            const bytes = readFileSync(filePath);
            const safeName = String(i + 1).padStart(2, "0") + "-" + basename(doc.name).replace(/[^a-zA-Z0-9._ -]/g, "_");
            docsFolder.file(safeName, bytes);
          }
        } catch {
          // Non-fatal if specific source file cannot be read from disk
        }
      }
    }

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });

    return {
      buffer: zipBuffer,
      filename: `task-pack-${opportunity.company.replace(/[^a-zA-Z0-9_-]/g, "_")}-${opportunity.id.slice(0, 8)}.zip`,
    };
  }

  function parseRawResult(rawInput) {
    if (typeof rawInput !== "string" || !rawInput.trim()) {
      fail(400, "Provide the assistant result text or JSON.");
    }
    if (rawInput.length > 500000) {
      fail(413, "Assistant response exceeds 500KB limit.");
    }

    let cleaned = rawInput.trim();
    // If wrapped in markdown prose with a ```json codeblock, extract the block
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1].trim();
    }

    return parseBuddyOutput(cleaned);
  }

  function previewResult({ opportunityId, baseRevision, resultText }) {
    const opp = getRecord(opportunityId);
    if (!opp) fail(404, "Opportunity not found.");

    if (typeof baseRevision === "number" && opp.revision !== baseRevision) {
      fail(409, `Opportunity revision conflict: expected base revision ${baseRevision}, but current revision is ${opp.revision}.`);
    }

    const parsed = parseRawResult(resultText);

    return {
      valid: true,
      baseRevision: opp.revision,
      reply: parsed.reply,
      changes: parsed.changes,
      draft: parsed.draft,
      sourceIds: parsed.sourceIds,
    };
  }

  async function applyResult({
    opportunityId,
    baseRevision,
    resultText,
    editedDraft = null,
    confirm = false,
  }) {
    const opp = getRecord(opportunityId);
    if (!opp) fail(404, "Opportunity not found.");

    if (confirm !== true) {
      fail(400, "Confirmation required to apply external assistant results.");
    }

    if (typeof baseRevision === "number" && opp.revision !== baseRevision) {
      fail(409, `Opportunity revision conflict: expected base revision ${baseRevision}, but current revision is ${opp.revision}.`);
    }

    const parsed = parseRawResult(resultText);
    const recordedAt = now();
    const taskId = randomUUID();

    // 1. Apply changes if any
    let updatedOpp = opp;
    if (parsed.changes && parsed.changes.length) {
      updatedOpp = applyChanges(opp, parsed.changes, taskId, recordedAt);
      putRecord(updatedOpp);
    }

    // 2. Save document draft if present
    let savedDoc = null;
    const finalDraft = editedDraft || parsed.draft;
    if (finalDraft && finalDraft.kind && finalDraft.kind !== "none" && finalDraft.title && finalDraft.content && saveDocument) {
      const draftBytes = await wordDraft(finalDraft.title, finalDraft.content);
      const safeTitle = (finalDraft.title.replace(/[^\p{L}\p{N} _-]/gu, "") || "Draft").slice(0, 100);
      savedDoc = saveDocument({
        name: `${safeTitle}.docx`,
        kind: finalDraft.kind === "cv" ? "cv" : "cover",
        status: "draft",
        opportunityId: opp.id,
        content: draftBytes,
        notes: "Generated by external assistant task pack. Verify before submission.",
        generation: {
          source: "external-assistant",
          title: finalDraft.title,
          content: finalDraft.content,
          taskId,
          appliedAt: recordedAt,
        },
      });
    }

    // 3. Record task entry in scheduler
    if (scheduler && scheduler.enqueue) {
      const task = scheduler.enqueue({
        id: taskId,
        kind: "external-assistant",
        label: "External assistant result applied",
        targetId: opp.id,
        priority: "normal",
        payload: {
          opportunityId: opp.id,
          baseRevision: opp.revision,
          newRevision: updatedOpp.revision,
          changesCount: (parsed.changes || []).length,
          draftSaved: savedDoc ? savedDoc.id : null,
          draftKind: finalDraft ? finalDraft.kind : "none",
        },
      });
      if (task) {
        scheduler.updateProgress(taskId, {
          status: "completed",
          current: 1,
          total: 1,
          detail: `Applied ${(parsed.changes || []).length} change(s) and ${savedDoc ? "saved document draft" : "no draft"}.`,
        });
      }
    }

    return {
      success: true,
      opportunity: fullRecord(updatedOpp),
      savedDocument: savedDoc,
      appliedChanges: parsed.changes,
      taskId,
    };
  }

  async function handle(path, method, req, res, { json, readBody }) {
    const packMatch = path.match(/^\/api\/opportunities\/([^/]+)\/assistant-pack$/);
    const previewMatch = path.match(/^\/api\/opportunities\/([^/]+)\/assistant-pack\/preview$/);
    const applyMatch = path.match(/^\/api\/opportunities\/([^/]+)\/assistant-pack\/apply$/);

    if (packMatch) {
      const opportunityId = packMatch[1];
      if (method === "GET") {
        // Return JSON task-pack payload
        const url = new URL(req.url, "http://localhost");
        const action = url.searchParams.get("action") || "general";
        const sourceIds = (url.searchParams.get("sourceIds") || "").split(",").filter(Boolean);
        const includeOtherOpportunities = url.searchParams.get("includeOtherOpportunities") === "true";
        const customInstructions = url.searchParams.get("customInstructions") || "";

        const { taskPayload } = await buildTaskPayload({
          opportunityId,
          action,
          sourceIds,
          includeOtherOpportunities,
          customInstructions,
        });
        json(res, taskPayload);
        return true;
      }
      if (method === "POST") {
        // Generate and stream ZIP archive
        const body = await readBody(req);
        const { buffer, filename } = await exportZip({
          opportunityId,
          action: body.action || "general",
          sourceIds: body.sourceIds || [],
          includeOtherOpportunities: Boolean(body.includeOtherOpportunities),
          customInstructions: body.customInstructions || "",
        });
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        });
        res.end(buffer);
        return true;
      }
      fail(405, "Method not allowed.");
    }

    if (previewMatch && method === "POST") {
      const opportunityId = previewMatch[1];
      const body = await readBody(req);
      const preview = previewResult({
        opportunityId,
        baseRevision: body.baseRevision ?? body.revision,
        resultText: body.resultText || body.result,
      });
      json(res, preview);
      return true;
    }

    if (applyMatch && method === "POST") {
      const opportunityId = applyMatch[1];
      const body = await readBody(req);
      const result = await applyResult({
        opportunityId,
        baseRevision: body.baseRevision ?? body.revision,
        resultText: body.resultText || body.result,
        editedDraft: body.editedDraft || null,
        confirm: body.confirm,
      });
      json(res, result);
      return true;
    }

    return false;
  }

  return {
    buildTaskPayload,
    exportZip,
    previewResult,
    applyResult,
    handle,
  };
}
