import { randomUUID } from "node:crypto";
import { cleanUsage, tokenKeys, estimateCost } from "./ai-usage.mjs";
import { replyPreview } from "./buddy-stream.mjs";
const error = (message, status) =>
  Object.assign(new Error(message), { status });
const stages = new Set([
  "reading-job-source",
  "reading-pdf",
  "ocr",
  "preparing",
  "waiting-provider",
  "reading-response",
  "receiving-response",
  "queued-codex",
  "running-codex",
  "stopping-codex",
  "validating",
]);
const timingKeys = new Set([
  "preparationMs",
  "providerMs",
  "firstResponseMs",
  "modelLoadMs",
  "promptEvaluationMs",
  "generationMs",
  "queueMs",
  "executionMs",
]);
export function createBuddyRequests(db, { getConfig = () => null } = {}) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS buddy_requests(id TEXT PRIMARY KEY,data TEXT NOT NULL)",
  );
  const controllers = new Map(),
    previews = new Map();
  const stored = (id) => {
    const r = db.prepare("SELECT data FROM buddy_requests WHERE id=?").get(id);
    return r ? JSON.parse(r.data) : null;
  };
  const read = (id) => {
    const r = stored(id);
    return r && previews.has(id) ? { ...r, preview: previews.get(id) } : r;
  };
  const save = (r) =>
    db
      .prepare(
        "INSERT INTO buddy_requests VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(r.id, JSON.stringify(r));
  for (const row of db.prepare("SELECT data FROM buddy_requests").all()) {
    const r = JSON.parse(row.data);
    if (!r.finishedAt) {
      r.stage = "interrupted";
      r.finishedAt = new Date().toISOString();
      save(r);
      db.prepare(
        "UPDATE standalone_messages SET data=json_set(data,'$.status','interrupted') WHERE json_extract(data,'$.requestId')=? AND json_extract(data,'$.role')='user' AND json_extract(data,'$.status')='pending'",
      ).run(r.id);
    }
  }
  return {
    read,
    start(id, conversationId, config, metadata = {}) {
      if (controllers.has(id))
        throw error(
          "This request ID belongs to another request. Retry with a new ID.",
          409,
        );
      const previous = stored(id);
      const previousArchiveId = previous ? id + "~" + randomUUID() : null;
      const kinds = [
        "opportunity-chat",
        "buddy-chat",
        "draft",
        "fit",
        "tags",
        "summary",
        "intake",
        "local-intake",
        "feedback",
        "connection-test",
      ];
      const rateSettings = getConfig("aiUsageRates");
      const rate = rateSettings?.rates?.find(
        (r) => r.provider === config.provider && r.model === config.model,
      );
      const controller = new AbortController(),
        record = {
          id,
          conversationId,
          attempt: (previous?.attempt || 0) + 1,
          ...(previousArchiveId ? { retryOf: previousArchiveId } : {}),
          ...(kinds.includes(metadata.kind) ? { kind: metadata.kind } : {}),
          ...(typeof metadata.promptVersion === "string" &&
          /^[a-zA-Z0-9._-]{1,100}$/.test(metadata.promptVersion)
            ? { promptVersion: metadata.promptVersion }
            : {}),
          ...([
            "chat",
            "auto",
            "coach",
            "star",
            "recruiter",
            "update",
            "cv",
            "cover",
            "fit",
            "salary",
            "skills",
          ].includes(metadata.action)
            ? { action: metadata.action }
            : {}),
          ...(rate && !["codex", "local"].includes(config.provider)
            ? {
                pricing: {
                  currency: rate.currency,
                  inputPerMillion: rate.inputPerMillion,
                  outputPerMillion: rate.outputPerMillion,
                  revision: rateSettings.revision,
                },
              }
            : {}),
          provider: config.provider,
          model: config.model,
          stage: "preparing",
          startedAt: new Date().toISOString(),
          timeoutSeconds:
            config.requestTimeoutSeconds ||
            (config.provider === "codex" ? 300 : 120),
          timings: {},
        };
      let providerStarted = false;
      controllers.set(id, { controller, record });
      db.exec("SAVEPOINT buddy_request_start");
      try {
        if (previous)
          save({
            ...previous,
            id: previousArchiveId,
            originalRequestId: id,
            archived: true,
          });
        save(record);
        db.exec("RELEASE buddy_request_start");
      } catch (e) {
        db.exec("ROLLBACK TO buddy_request_start;RELEASE buddy_request_start");
        controllers.delete(id);
        throw e;
      }
      return {
        signal: controller.signal,
        describe(values) {
          if (!record.finishedAt && kinds.includes(values?.kind)) {
            record.kind = values.kind;
            save(record);
          }
        },
        progress(stage) {
          if (
            record.finishedAt ||
            controller.signal.aborted ||
            !stages.has(stage) ||
            record.stage === stage
          )
            return;
          if (
            !providerStarted &&
            ["waiting-provider", "queued-codex"].includes(stage)
          ) {
            record.timings.preparationMs =
              Date.now() - Date.parse(record.startedAt);
            providerStarted = true;
          }
          record.stage = stage;
          save(record);
        },
        preview(raw) {
          if (
            !record.finishedAt &&
            !controller.signal.aborted &&
            typeof raw === "string"
          ) {
            const text = replyPreview(
              raw,
              config.previewFormat === "standalone",
            );
            if (text) previews.set(id, text);
          }
        },
        diagnostics(values) {
          if (record.finishedAt) return;
          if (
            typeof values?.reportedModel === "string" &&
            /^[a-zA-Z0-9._:/@+-]{1,200}$/.test(values.reportedModel)
          )
            record.reportedModel = values.reportedModel;
          if (values?.usage) {
            const cleaned = cleanUsage(values.usage);
            const merged = { ...(record.usage || {}), ...cleaned };
            if (tokenKeys.some((k) => merged[k] !== undefined))
              record.usage = merged;
          }
          if (
            typeof values?.promptHash === "string" &&
            /^[a-f0-9]{64}$/.test(values.promptHash)
          )
            record.promptHash = values.promptHash;
          record.cost = estimateCost(record);
          for (const [key, value] of Object.entries(values || {})) {
            if (
              timingKeys.has(key) &&
              Number.isFinite(value) &&
              value >= 0 &&
              value <= 3600000
            )
              record.timings[key] = Math.round(value);
            if (
              key === "responseMode" &&
              ["streamed", "buffered", "codex"].includes(value)
            )
              record.responseMode = value;
            if (
              key === "cancellation" &&
              [
                "transport-stopped",
                "codex-process-stopped",
                "unconfirmed",
              ].includes(value)
            )
              record.cancellation = value;
          }
          save(record);
        },
        check() {
          if (controller.signal.aborted)
            throw error("Career Buddy request cancelled.", 499);
        },
        finish(stage, errorCode) {
          if (record.finishedAt) return;
          record.stage =
            errorCode == 504
              ? "timed-out"
              : errorCode == 499
                ? "cancelled"
                : stage;
          record.errorCode = /^[0-9]{3}$/.test(String(errorCode))
            ? String(errorCode)
            : "";
          record.cost = estimateCost(record);
          record.finishedAt = new Date().toISOString();
          record.durationMs = Date.now() - Date.parse(record.startedAt);
          previews.delete(id);
          save(record);
          controllers.delete(id);
        },
      };
    },
    async handle(path, method, req, res, { json, readBody }) {
      if (path === "/api/buddy/requests" && method === "GET") {
        const scope = new URL(req.url, "http://board").searchParams.get(
          "scope",
        );
        if (!scope || scope.length > 200)
          throw error("Choose a request scope.", 400);
        const row = db
          .prepare(
            "SELECT id FROM buddy_requests WHERE json_extract(data,'$.conversationId')=? AND COALESCE(json_extract(data,'$.archived'),0)=0 ORDER BY json_extract(data,'$.startedAt') DESC LIMIT 1",
          )
          .get(scope);
        json(res, { request: row ? read(row.id) : null });
        return true;
      }
      const m = path.match(/^\/api\/buddy\/requests\/([^/]+)$/);
      if (!m) return false;
      const record = stored(m[1]);
      if (!record) throw error("Request not found.", 404);
      if (method === "POST") {
        const b = await readBody(req);
        if (b.cancel !== true) throw error("Choose cancel.", 400);
        const active = controllers.get(m[1]);
        if (active) {
          active.record.stage = "cancelling";
          active.record.cancelRequestedAt = new Date().toISOString();
          active.record.cancellation = "unconfirmed";
          previews.delete(m[1]);
          save(active.record);
          active.controller.abort();
        }
      } else if (method !== "GET") throw error("Method not supported.", 405);
      json(res, { request: read(m[1]) });
      return true;
    },
  };
}
