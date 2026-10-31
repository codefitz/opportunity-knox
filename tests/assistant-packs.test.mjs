import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { DatabaseSync } from "node:sqlite";
import { createAssistantPacks } from "../server/assistant-packs.mjs";
import { createAIScheduler } from "../server/ai-scheduler.mjs";

test("assistant pack builds manifest, instructions, context, schema and exports valid ZIP bundle", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE records(id TEXT PRIMARY KEY, data TEXT); CREATE TABLE ai_tasks(id TEXT PRIMARY KEY, data TEXT);");

  const opp = {
    id: "opp-123",
    company: "Acme Corp",
    role: "Senior Staff Engineer",
    stage: "review",
    outcome: "",
    priority: "high",
    location: "London",
    workMode: "remote",
    salary: "£140k",
    employmentType: "permanent",
    contact: "Jane Recruiter",
    deadline: "2026-12-01",
    nextAction: "Tailor CV",
    nextActionDate: "2026-11-05",
    jobReference: "REQ-999",
    revision: 3,
    description: "Looking for an experienced engineer to lead systems architecture.",
    events: [],
    activities: [],
  };

  db.prepare("INSERT INTO records VALUES (?, ?)").run(opp.id, JSON.stringify(opp));

  const docs = [
    {
      id: "doc-1",
      name: "Master CV 2026.docx",
      kind: "cv",
      category: "cv",
      opportunityId: "opp-123",
      status: "ready",
      generation: false,
    },
  ];

  const scheduler = createAIScheduler({ db, listRecords: () => [opp] });

  const packs = createAssistantPacks({
    db,
    getRecord: (id) => (id === opp.id ? opp : null),
    putRecord: (rec) => {},
    fullRecord: (rec) => ({ ...rec, documents: [], applicationPacks: [] }),
    getDocuments: () => docs,
    documentPath: (d) => null,
    saveDocument: () => ({ id: "saved-doc-1" }),
    scheduler,
    settings: () => ({ timezone: "Europe/London" }),
    indexDocuments: async (ids) => docs.filter((d) => ids.includes(d.id)),
  });

  const { taskPayload } = await packs.buildTaskPayload({
    opportunityId: opp.id,
    action: "cv",
    sourceIds: ["doc-1"],
    includeOtherOpportunities: false,
    customInstructions: "Emphasize distributed systems and latency reduction.",
  });

  assert.equal(taskPayload.manifest.opportunityId, opp.id);
  assert.equal(taskPayload.manifest.baseRevision, 3);
  assert.equal(taskPayload.manifest.action, "cv");
  assert.equal(taskPayload.manifest.company, "Acme Corp");
  assert.ok(taskPayload.instructions.includes("You are Career Buddy"));
  assert.equal(taskPayload.customPrompt, "Emphasize distributed systems and latency reduction.");
  assert.ok(taskPayload.expectedSchema);

  // Test ZIP export
  const { buffer, filename } = await packs.exportZip({
    opportunityId: opp.id,
    action: "cv",
    sourceIds: ["doc-1"],
    customInstructions: "Emphasize distributed systems.",
  });

  assert.ok(buffer.length > 0);
  assert.ok(filename.includes("Acme_Corp"));

  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file("manifest.json"));
  assert.ok(zip.file("instructions.md"));
  assert.ok(zip.file("context.json"));
  assert.ok(zip.file("schema.json"));
  assert.ok(zip.file("prompt.txt"));

  const unzippedManifest = JSON.parse(await zip.file("manifest.json").async("text"));
  assert.equal(unzippedManifest.opportunityId, opp.id);
});

test("assistant pack preview validates schema, markdown codeblock parsing, and detects revision conflicts", async () => {
  const db = new DatabaseSync(":memory:");
  const opp = {
    id: "opp-123",
    company: "Acme Corp",
    role: "Staff Engineer",
    stage: "review",
    outcome: "",
    revision: 2,
    events: [],
    activities: [],
  };

  const packs = createAssistantPacks({
    db,
    getRecord: (id) => (id === opp.id ? opp : null),
    putRecord: () => {},
    fullRecord: (r) => r,
    getDocuments: () => [],
    documentPath: () => null,
    saveDocument: () => null,
    scheduler: null,
    settings: () => ({ timezone: "Europe/London" }),
  });

  // 1. Revision conflict
  assert.throws(
    () =>
      packs.previewResult({
        opportunityId: opp.id,
        baseRevision: 1, // Stale!
        resultText: JSON.stringify({ reply: "Hello", changes: [], draft: { kind: "none", title: "", content: "" }, sourceIds: [] }),
      }),
    (err) => err.status === 409 && err.message.includes("revision conflict"),
  );

  // 2. Markdown fenced code block extraction
  const assistantMarkdown = `
Here is my advice on tailoring your CV:

\`\`\`json
{
  "reply": "I tailored your CV highlighting microservices and mentoring.",
  "changes": [
    {
      "kind": "update",
      "field": "nextAction",
      "value": "Review tailored CV draft",
      "title": "",
      "date": "",
      "notes": "",
      "type": "",
      "status": "",
      "isFinal": false
    }
  ],
  "draft": {
    "kind": "cv",
    "title": "Tailored Senior CV",
    "content": "# Jane Doe\\n## Experience\\n- Senior Staff Engineer"
  },
  "sourceIds": []
}
\`\`\`

Let me know if you want any adjustments!
  `;

  const preview = packs.previewResult({
    opportunityId: opp.id,
    baseRevision: 2,
    resultText: assistantMarkdown,
  });

  assert.equal(preview.valid, true);
  assert.equal(preview.baseRevision, 2);
  assert.ok(preview.reply.includes("tailored your CV"));
  assert.equal(preview.changes.length, 1);
  assert.equal(preview.changes[0].field, "nextAction");
  assert.equal(preview.draft.kind, "cv");
  assert.equal(preview.draft.title, "Tailored Senior CV");
});

test("assistant pack apply commits changes, saves Word draft, and records task in scheduler", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE ai_tasks(id TEXT PRIMARY KEY, data TEXT);");

  let storedOpp = {
    id: "opp-456",
    company: "Beta Ltd",
    role: "Lead Developer",
    stage: "review",
    outcome: "",
    priority: "normal",
    nextAction: "Initial review",
    revision: 5,
    events: [],
    activities: [],
  };

  const savedDocs = [];
  const scheduler = createAIScheduler({ db, listRecords: () => [storedOpp] });

  const packs = createAssistantPacks({
    db,
    getRecord: (id) => (id === storedOpp.id ? storedOpp : null),
    putRecord: (rec) => {
      storedOpp = rec;
    },
    fullRecord: (r) => r,
    getDocuments: () => [],
    documentPath: () => null,
    saveDocument: (doc) => {
      const saved = { id: "doc-saved-456", ...doc };
      savedDocs.push(saved);
      return saved;
    },
    scheduler,
    settings: () => ({ timezone: "Europe/London" }),
  });

  const rawJson = JSON.stringify({
    reply: "Proposed updating deadline and tailored cover letter.",
    changes: [
      {
        kind: "update",
        field: "deadline",
        value: "2026-11-20",
        title: "",
        date: "",
        notes: "",
        type: "",
        status: "",
        isFinal: false,
      },
    ],
    draft: {
      kind: "cover",
      title: "Cover Letter - Beta Ltd",
      content: "# Dear Hiring Team\\n\\nI am excited to apply...",
    },
    sourceIds: [],
  });

  // Apply without confirmation fails
  await assert.rejects(
    async () => {
      await packs.applyResult({
        opportunityId: storedOpp.id,
        baseRevision: 5,
        resultText: rawJson,
        confirm: false,
      });
    },
    (err) => err.status === 400 && err.message.includes("Confirmation required"),
  );

  // Apply with confirmation succeeds
  const res = await packs.applyResult({
    opportunityId: storedOpp.id,
    baseRevision: 5,
    resultText: rawJson,
    confirm: true,
  });

  assert.equal(res.success, true);
  assert.equal(storedOpp.deadline, "2026-11-20");
  assert.equal(storedOpp.revision, 6);
  assert.equal(savedDocs.length, 1);
  assert.equal(savedDocs[0].kind, "cover");
  assert.ok(savedDocs[0].name.includes("Cover Letter"));
  assert.equal(savedDocs[0].generation.source, "external-assistant");

  // Verify task was recorded in scheduler
  const tasks = scheduler.list({ kind: "external-assistant" });
  assert.equal(tasks.items.length, 1);
  assert.equal(tasks.items[0].status, "completed");
  assert.equal(tasks.items[0].targetId, storedOpp.id);
  assert.equal(tasks.items[0].payload.baseRevision, 5);
  assert.equal(tasks.items[0].payload.newRevision, 6);
  assert.equal(tasks.items[0].payload.changesCount, 1);
  assert.equal(tasks.items[0].payload.draftSaved, "doc-saved-456");
});
