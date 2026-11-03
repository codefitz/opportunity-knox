import { randomBytes, timingSafeEqual } from "node:crypto";
import { retrieveHybridChunks } from "./buddy-documents.mjs";

const DEFAULT_MCP_SETTINGS = {
  enabled: false,
  apiKey: "",
  allowWrite: true,
  createdAt: "",
  lastUsedAt: "",
};

function generateApiKey() {
  return "opknox_mcp_" + randomBytes(24).toString("hex");
}

function verifyToken(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  const pBuf = Buffer.from(provided);
  const eBuf = Buffer.from(expected);
  if (pBuf.length !== eBuf.length || pBuf.length === 0) return false;
  return timingSafeEqual(pBuf, eBuf);
}

export function createMcpIntegration({
  db,
  getConfig,
  putConfig,
  getRecord,
  putRecord,
  listRecords,
  fullRecord,
  getDocuments,
  buddy,
}) {
  const getSettings = () => {
    const raw = getConfig("mcpSettings");
    if (!raw) return { ...DEFAULT_MCP_SETTINGS };
    return {
      enabled: Boolean(raw.enabled),
      apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
      allowWrite: raw.allowWrite !== false,
      createdAt: raw.createdAt || "",
      lastUsedAt: raw.lastUsedAt || "",
    };
  };

  const saveSettings = (updated) => {
    putConfig("mcpSettings", updated);
    return updated;
  };

  const authenticateMcpRequest = (req) => {
    const settings = getSettings();
    if (!settings.enabled || !settings.apiKey) {
      const err = new Error("MCP server is disabled in Opportunity Knox settings.");
      err.status = 403;
      throw err;
    }

    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      const err = new Error("Authorization header with Bearer token is required.");
      err.status = 401;
      throw err;
    }

    const token = authHeader.slice(7).trim();
    if (!verifyToken(token, settings.apiKey)) {
      const err = new Error("Invalid MCP API key.");
      err.status = 401;
      throw err;
    }

    // Touch lastUsedAt asynchronously
    settings.lastUsedAt = new Date().toISOString();
    saveSettings(settings);

    return settings;
  };

  return {
    getSettings,
    saveSettings,
    generateApiKey,

    async handle(path, method, req, res, { json, readBody, fail }) {
      // 1. Settings Endpoints (Authenticated by user web session via app.mjs)
      if (path === "/api/mcp/settings") {
        if (method === "GET") {
          const settings = getSettings();
          const hostPort = req.headers.host || "127.0.0.1:4318";
          const protocol = req.headers["x-forwarded-proto"] || "http";
          const baseUrl = `${protocol}://${hostPort}`;
          json(res, {
            ...settings,
            hasKey: Boolean(settings.apiKey),
            clientConfig: {
              mcpServers: {
                "opportunity-knox": {
                  command: "node",
                  args: ["server/mcp-server.mjs"],
                  env: {
                    OPKNOX_URL: baseUrl,
                    OPKNOX_API_KEY: settings.apiKey || "<YOUR_API_KEY>",
                  },
                },
              },
            },
          });
          return true;
        }

        if (method === "PATCH") {
          const body = await readBody(req);
          const current = getSettings();
          if (body.enabled !== undefined) {
            if (typeof body.enabled !== "boolean") fail(400, "enabled must be a boolean.");
            current.enabled = body.enabled;
          }
          if (body.allowWrite !== undefined) {
            if (typeof body.allowWrite !== "boolean") fail(400, "allowWrite must be a boolean.");
            current.allowWrite = body.allowWrite;
          }
          if (!current.apiKey && current.enabled) {
            current.apiKey = generateApiKey();
            current.createdAt = new Date().toISOString();
          }
          saveSettings(current);
          json(res, {
            ...current,
            hasKey: Boolean(current.apiKey),
          });
          return true;
        }

        fail(405, "Method not allowed.");
      }

      if (path === "/api/mcp/settings/rotate-key" && method === "POST") {
        const current = getSettings();
        current.apiKey = generateApiKey();
        current.createdAt = new Date().toISOString();
        current.lastUsedAt = "";
        saveSettings(current);
        json(res, {
          success: true,
          apiKey: current.apiKey,
          createdAt: current.createdAt,
        });
        return true;
      }

      // 2. MCP API Endpoints (Authenticated by Bearer token)
      if (path.startsWith("/api/mcp/v1/")) {
        const settings = authenticateMcpRequest(req);

        // Tool: search_opportunities
        if (path === "/api/mcp/v1/opportunities/search" && method === "POST") {
          const body = await readBody(req);
          const query = typeof body.query === "string" ? body.query.trim().toLowerCase() : "";
          const stage = typeof body.stage === "string" ? body.stage.trim() : "";
          const limit = Math.min(Math.max(1, parseInt(body.limit, 10) || 20), 50);

          const allRecords = listRecords();
          const filtered = allRecords.filter((rec) => {
            if (stage && rec.stage !== stage) return false;
            if (query) {
              const text = [rec.company, rec.role, rec.description || ""].join(" ").toLowerCase();
              return text.includes(query);
            }
            return true;
          });

          // Sort by updatedAt descending
          filtered.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

          const results = filtered.slice(0, limit).map((o) => ({
            id: o.id,
            company: o.company,
            role: o.role,
            stage: o.stage,
            outcome: o.outcome || "",
            location: o.location || "",
            salary: o.salary || "",
            nextAction: o.nextAction || "",
            nextActionDate: o.nextActionDate || "",
            updatedAt: o.updatedAt || o.createdAt,
            revision: o.revision || 1,
          }));

          json(res, {
            total: filtered.length,
            opportunities: results,
          });
          return true;
        }

        // Tool: get_opportunity
        const getMatch = path.match(/^\/api\/mcp\/v1\/opportunities\/([a-zA-Z0-9_-]+)$/);
        if (getMatch && method === "GET") {
          const id = getMatch[1];
          const record = getRecord(id);
          if (!record) fail(404, "Opportunity not found.");

          const full = fullRecord(record);
          const review = full.review
            ? {
                strengths: full.review.strengths || "",
                gaps: full.review.gaps || "",
                reviewedAt: full.review.effectiveAt || full.review.recordedAt || "",
                historyCount: full.review.history ? full.review.history.length : 0,
              }
            : null;

          json(res, {
            opportunity: {
              id: full.id,
              company: full.company,
              role: full.role,
              stage: full.stage,
              outcome: full.outcome || "",
              location: full.location || "",
              workMode: full.workMode || "",
              salary: full.salary || "",
              description: full.description || "",
              requirements: full.requirements || "",
              contact: full.contact || "",
              nextAction: full.nextAction || "",
              nextActionDate: full.nextActionDate || "",
              applicationRoute: full.applicationRoute || "",
              review,
              revision: full.revision || 1,
              updatedAt: full.updatedAt || full.createdAt,
            },
          });
          return true;
        }

        // Tool: search_career_evidence
        if (path === "/api/mcp/v1/career-evidence/search" && method === "POST") {
          const body = await readBody(req);
          const query = typeof body.query === "string" ? body.query.trim() : "";
          if (!query) fail(400, "Search query is required.");

          const opportunityId = typeof body.opportunityId === "string" ? body.opportunityId : null;
          const limit = Math.min(Math.max(1, parseInt(body.limit, 10) || 5), 10);

          // Find eligible career evidence documents
          const allDocs = getDocuments();
          const eligible = allDocs.filter(
            (d) =>
              (!d.opportunityId || (opportunityId && d.opportunityId === opportunityId)) &&
              !d.generation &&
              d.kind !== "jd" &&
              !["template", "cv-template", "cover-letter-template"].includes(d.category),
          );

          if (!eligible.length) {
            json(res, {
              excerpts: [],
              totalAvailable: 0,
              message: "No eligible career evidence documents found in the Career Library.",
            });
            return true;
          }

          const indexed = await buddy.indexDocuments(eligible.map((d) => d.id));
          const readyDocs = indexed.filter((d) => d.status === "ready" && d.chunks && d.chunks.length > 0);

          const retrieval = retrieveHybridChunks(readyDocs, query, {}, 25000);
          const excerpts = retrieval.chunks.slice(0, limit).map((chunk) => ({
            documentId: chunk.sourceId,
            documentName: chunk.sourceName,
            passageIndex: chunk.index,
            excerpt: chunk.text,
            matchedBy: chunk.matchedBy || ["keyword"],
            freshness: chunk.indexedAt || new Date().toISOString(),
          }));

          json(res, {
            totalAvailable: eligible.length,
            excerpts,
          });
          return true;
        }

        // Tool: read_career_evidence
        const readMatch = path.match(/^\/api\/mcp\/v1\/career-evidence\/([a-zA-Z0-9_-]+)$/);
        if (readMatch && method === "GET") {
          const id = readMatch[1];
          const doc = getDocuments().find((d) => d.id === id);
          if (!doc) fail(404, "Evidence document not found.");

          // Reject templates and JDs from evidence reading
          if (doc.kind === "jd" || ["template", "cv-template", "cover-letter-template"].includes(doc.category)) {
            fail(400, "Job descriptions and templates cannot be read as candidate evidence.");
          }

          const indexed = await buddy.indexDocuments([doc.id]);
          const ready = indexed[0];
          if (!ready || ready.status !== "ready") {
            fail(502, "Document text is not available or could not be extracted.");
          }

          const url = new URL(req.url, "http://127.0.0.1");
          const passageParam = url.searchParams.get("passageIndex");
          const passageIndex = passageParam !== null ? parseInt(passageParam, 10) : null;

          let textContent = ready.text || "";
          if (passageIndex !== null && Number.isInteger(passageIndex)) {
            if (!ready.chunks || !ready.chunks[passageIndex]) {
              fail(404, `Passage index ${passageIndex} not found (total passages: ${ready.chunks ? ready.chunks.length : 0}).`);
            }
            textContent = ready.chunks[passageIndex].text;
          }

          json(res, {
            document: {
              documentId: doc.id,
              documentName: doc.name,
              kind: doc.kind,
              category: doc.category || "",
              text: textContent,
              passageIndex,
              totalPassages: ready.chunks ? ready.chunks.length : 0,
              updatedAt: doc.updatedAt || doc.createdAt,
            },
          });
          return true;
        }

        // Tool: save_fit_review
        if (path === "/api/mcp/v1/fit-review" && method === "POST") {
          if (!settings.allowWrite) {
            fail(403, "Fit review writing is disabled in Opportunity Knox MCP settings.");
          }

          const body = await readBody(req);
          const opportunityId = typeof body.opportunityId === "string" ? body.opportunityId.trim() : "";
          if (!opportunityId) fail(400, "opportunityId is required.");

          const o = getRecord(opportunityId);
          if (!o) fail(404, "Opportunity not found.");

          const strengths = typeof body.strengths === "string" ? body.strengths.trim() : "";
          const gaps = typeof body.gaps === "string" ? body.gaps.trim() : "";
          if (!strengths && !gaps) {
            fail(400, "Provide strengths or gaps for the fit review.");
          }
          if (strengths.length > 50000 || gaps.length > 50000) {
            fail(400, "Strengths and gaps must each be under 50,000 characters.");
          }

          const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
          // Idempotent retry check: if already recorded with this requestId, return prior success
          if (requestId && o.review?.lastRequestId === requestId) {
            if (o.review.strengths === strengths && o.review.gaps === gaps) {
              json(res, {
                success: true,
                opportunityId: o.id,
                revision: o.revision,
                savedAt: o.review.effectiveAt,
                idempotent: true,
              });
              return true;
            }
            fail(409, "This requestId was already submitted with different review content.");
          }

          const expectedRevision = parseInt(body.expectedRevision, 10);
          if (!Number.isInteger(expectedRevision)) {
            fail(400, "expectedRevision must be an integer.");
          }

          if (o.revision !== expectedRevision) {
            fail(409, `Opportunity was modified (expected revision ${expectedRevision}, current is ${o.revision}). Refresh opportunity details and review afresh.`);
          }

          const now = new Date().toISOString();
          const effectiveAt = typeof body.reviewTimestamp === "string" && !isNaN(Date.parse(body.reviewTimestamp))
            ? new Date(body.reviewTimestamp).toISOString()
            : now;

          const previous = o.review;
          const { history, ...snapshot } = previous || {};

          o.review = {
            strengths,
            gaps,
            decision: previous?.decision || "",
            reason: previous?.reason || "",
            effectiveAt,
            recordedAt: now,
            provenance: "mcp:claude-desktop",
            lastRequestId: requestId || undefined,
            history: [
              ...(history || []),
              ...(previous ? [{ ...snapshot, changedAt: now }] : []),
            ],
          };

          // Append timeline event
          const eventSummary = [
            strengths ? `Strengths: ${strengths.slice(0, 300)}${strengths.length > 300 ? "…" : ""}` : "",
            gaps ? `Gaps: ${gaps.slice(0, 300)}${gaps.length > 300 ? "…" : ""}` : "",
            "Assessed via Claude Desktop (MCP)",
          ]
            .filter(Boolean)
            .join("\n");

          if (!Array.isArray(o.events)) o.events = [];
          o.events.push({
            id: randomBytes(16).toString("hex"),
            title: "Fit review saved",
            date: effectiveAt.slice(0, 10),
            notes: eventSummary,
            type: "assessment",
            status: "completed",
            createdAt: now,
          });

          o.revision = (o.revision || 1) + 1;
          o.updatedAt = now;

          putRecord(o);

          json(res, {
            success: true,
            opportunityId: o.id,
            revision: o.revision,
            savedAt: effectiveAt,
          });
          return true;
        }

        fail(404, "MCP endpoint not found.");
      }

      return false;
    },
  };
}
