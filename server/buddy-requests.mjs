import { randomUUID } from "node:crypto";
const error = (message, status) =>
  Object.assign(new Error(message), { status });
export function createBuddyRequests(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS buddy_requests(id TEXT PRIMARY KEY,data TEXT NOT NULL)",
  );
  const controllers = new Map();
  const read = (id) => {
    const r = db.prepare("SELECT data FROM buddy_requests WHERE id=?").get(id);
    return r ? JSON.parse(r.data) : null;
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
    start(id, conversationId, config) {
      if(controllers.has(id))throw error("This request ID belongs to another request. Retry with a new ID.",409);
      const controller = new AbortController(),
        record = {
          id,
          conversationId,
          provider: config.provider,
          model: config.model,
          stage: "preparing",
          startedAt: new Date().toISOString(),
          timeoutSeconds:
            config.requestTimeoutSeconds ||
            (config.provider === "codex" ? 300 : 120),
        };
      controllers.set(id, controller);
      save(record);
      return {
        signal: controller.signal,
        progress(stage) {
          if (!controller.signal.aborted) {
            record.stage = stage;
            save(record);
          }
        },
        check() {
          if (controller.signal.aborted)
            throw error("Career Buddy request cancelled.", 499);
        },
        finish(stage, errorCode) {
          record.stage = stage;
          record.errorCode = errorCode || "";
          record.finishedAt = new Date().toISOString();
          record.durationMs = Date.now() - Date.parse(record.startedAt);
          save(record);
          controllers.delete(id);
        },
      };
    },
    async handle(path, method, req, res, { json, readBody }) {
      if(path==='/api/buddy/requests'&&method==='GET'){
        const scope=new URL(req.url,'http://board').searchParams.get('scope');
        if(!scope||scope.length>200)throw error('Choose a request scope.',400);
        const row=db.prepare("SELECT data FROM buddy_requests WHERE json_extract(data,'$.conversationId')=? ORDER BY json_extract(data,'$.startedAt') DESC LIMIT 1").get(scope);
        json(res,{request:row?JSON.parse(row.data):null});return true;
      }
      const m = path.match(/^\/api\/buddy\/requests\/([^/]+)$/);
      if (!m) return false;
      const record = read(m[1]);
      if (!record) throw error("Request not found.", 404);
      if (method === "POST") {
        const b = await readBody(req);
        if (b.cancel !== true) throw error("Choose cancel.", 400);
        const controller = controllers.get(m[1]);
        if (controller) {
          record.stage = "cancelling";
          save(record);
          controller.abort();
        }
      } else if (method !== "GET") throw error("Method not supported.", 405);
      json(res, { request: read(m[1]) });
      return true;
    },
  };
}
