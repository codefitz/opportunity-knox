import { randomUUID } from "node:crypto";

export const TASK_KINDS = {
  "embedding-index": "Vector embedding indexing",
  "opportunity-automation": "Opportunity review automation",
  "deferred-assessment": "Deferred opportunity fit review",
  "deferred-briefing": "Deferred opportunity briefing",
  "external-assistant": "External assistant task execution",
};

export const TASK_STATUSES = new Set([
  "queued",
  "running",
  "cancelling",
  "completed",
  "completed-with-errors",
  "failed",
  "cancelled",
  "interrupted",
]);

const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};

export function createAIScheduler({
  db,
  getConfig = () => null,
  putConfig = () => {},
  clock = () => Date.now(),
  listRecords = () => [],
}) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS ai_tasks(id TEXT PRIMARY KEY, data TEXT NOT NULL)",
  );

  const activeControllers = new Map();
  const taskRunners = new Map();

  // Mark all incomplete tasks as interrupted on startup without automatically resuming.
  // Rule: Interrupted jobs never restart automatically.
  for (const row of db.prepare("SELECT id, data FROM ai_tasks").all()) {
    try {
      const task = JSON.parse(row.data);
      if (["queued", "running", "cancelling"].includes(task.status)) {
        const updated = {
          ...task,
          status: "interrupted",
          finishedAt: new Date(clock()).toISOString(),
          error: task.error || "Interrupted by server restart.",
        };
        db.prepare(
          "INSERT INTO ai_tasks(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        ).run(row.id, JSON.stringify(updated));
      }
    } catch {}
  }

  function get(id) {
    const row = db.prepare("SELECT data FROM ai_tasks WHERE id=?").get(id);
    return row ? JSON.parse(row.data) : null;
  }

  function save(task) {
    db.prepare(
      "INSERT INTO ai_tasks(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
    ).run(task.id, JSON.stringify(task));
  }

  function registerRunner(kind, handler) {
    taskRunners.set(kind, handler);
  }

  function enqueue({
    id = randomUUID(),
    kind,
    label = null,
    targetId = null,
    priority = "normal",
    payload = {},
    scheduledFor = null,
  }) {
    if (!TASK_KINDS[kind]) fail(400, "Unsupported task kind: " + kind);
    const existing = get(id);
    if (existing && ["queued", "running"].includes(existing.status)) {
      fail(409, "A task with this ID is already queued or running.");
    }

    const task = {
      id,
      kind,
      label: label || TASK_KINDS[kind],
      targetId,
      priority,
      status: "queued",
      progress: { current: 0, total: 0, detail: "" },
      payload,
      createdAt: new Date(clock()).toISOString(),
      startedAt: null,
      finishedAt: null,
      scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : null,
      error: null,
      retries: 0,
    };
    save(task);
    return task;
  }

  function updateProgress(id, { current, total, detail, status }) {
    const task = get(id);
    if (!task) return null;
    if (current !== undefined) task.progress.current = current;
    if (total !== undefined) task.progress.total = total;
    if (detail !== undefined) task.progress.detail = detail;
    if (status && TASK_STATUSES.has(status)) task.status = status;
    save(task);
    return task;
  }

  function finish(id, { status = "completed", error = null, result = null }) {
    const task = get(id);
    if (!task) return null;
    task.status = status;
    task.finishedAt = new Date(clock()).toISOString();
    if (error) task.error = typeof error === "string" ? error : error.message;
    if (result) task.result = result;
    activeControllers.delete(id);
    save(task);
    return task;
  }

  function setRunning(id, controller = null) {
    const task = get(id);
    if (!task) return null;
    task.status = "running";
    task.startedAt = task.startedAt || new Date(clock()).toISOString();
    if (controller) activeControllers.set(id, controller);
    save(task);
    return task;
  }

  function cancel(id) {
    const task = get(id);
    if (!task) fail(404, "Task not found.");
    if (["completed", "failed", "cancelled", "interrupted"].includes(task.status)) {
      return task;
    }
    task.status = activeControllers.has(id) ? "cancelling" : "cancelled";
    task.finishedAt = activeControllers.has(id) ? null : new Date(clock()).toISOString();
    const ctrl = activeControllers.get(id);
    if (ctrl) {
      ctrl.abort();
    }
    save(task);
    return task;
  }

  function retry(id) {
    const task = get(id);
    if (!task) fail(404, "Task not found.");
    if (["queued", "running", "cancelling"].includes(task.status)) {
      fail(409, "Task is already active.");
    }
    const runner = taskRunners.get(task.kind);
    if (!runner) fail(400, "No runner registered for this task type.");

    task.status = "queued";
    task.startedAt = null;
    task.finishedAt = null;
    task.error = null;
    task.retries = (task.retries || 0) + 1;
    task.progress = { current: 0, total: task.progress.total || 0, detail: "Retrying..." };
    save(task);

    queueMicrotask(() => {
      try {
        runner(task);
      } catch (err) {
        finish(task.id, { status: "failed", error: err.message });
      }
    });

    return task;
  }

  function list({ kind = "all", status = "all", limit = 50, offset = 0 } = {}) {
    const rows = db
      .prepare("SELECT data FROM ai_tasks ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(r.data));

    const opportunities = new Map(listRecords().map((o) => [o.id, o]));

    const items = rows
      .filter((t) => (kind === "all" || t.kind === kind))
      .filter((t) => {
        if (status === "all") return true;
        if (status === "active") return ["queued", "running", "cancelling"].includes(t.status);
        if (status === "completed") return t.status === "completed";
        if (status === "attention") return ["failed", "completed-with-errors", "interrupted"].includes(t.status);
        if (status === "cancelled") return t.status === "cancelled";
        return t.status === status;
      })
      .map((t) => {
        const opp = t.targetId ? opportunities.get(t.targetId) : null;
        return {
          ...t,
          subject: opp ? `${opp.role} — ${opp.company}` : t.label,
          canCancel: ["queued", "running"].includes(t.status),
          canRetry: ["failed", "completed-with-errors", "interrupted", "cancelled"].includes(t.status),
        };
      });

    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
      totals: {
        total: rows.length,
        all: rows.length,
        active: rows.filter((r) => ["queued", "running", "cancelling"].includes(r.status)).length,
        completed: rows.filter((r) => r.status === "completed").length,
        attention: rows.filter((r) => ["failed", "completed-with-errors", "interrupted"].includes(r.status)).length,
        failed: rows.filter((r) => r.status === "failed").length,
        interrupted: rows.filter((r) => r.status === "interrupted").length,
        cancelled: rows.filter((r) => r.status === "cancelled").length,
      },
    };
  }

  function exportTasks() {
    return db
      .prepare("SELECT data FROM ai_tasks ORDER BY rowid DESC")
      .all()
      .map((r) => {
        const item = JSON.parse(r.data);
        // Exclude internal raw credentials or keys if any ever made it into payload
        const safePayload = { ...item.payload };
        delete safePayload.apiKey;
        delete safePayload.vectorApiKey;
        delete safePayload.secret;
        return { ...item, payload: safePayload };
      });
  }

  async function close() {
    for (const [id, ctrl] of activeControllers.entries()) {
      ctrl.abort();
    }
    activeControllers.clear();
  }

  return {
    get,
    enqueue,
    setRunning,
    updateProgress,
    finish,
    cancel,
    retry,
    list,
    registerRunner,
    exportTasks,
    close,
    async handle(path, method, req, res, { json, readBody }) {
      if (path === "/api/ai-tasks" && method === "GET") {
        const url = new URL(req.url, "http://board");
        const status = url.searchParams.get("status") || "all";
        const kind = url.searchParams.get("kind") || "all";
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
        const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
        json(res, list({ kind, status, limit, offset }));
        return true;
      }

      const matchId = path.match(/^\/api\/ai-tasks\/([^/]+)$/);
      if (matchId && method === "GET") {
        const task = get(matchId[1]);
        if (!task) fail(404, "Task not found.");
        const opp = task.targetId ? listRecords().find((o) => o.id === task.targetId) : null;
        json(res, {
          ...task,
          subject: opp ? `${opp.role} — ${opp.company}` : task.label,
          canCancel: ["queued", "running"].includes(task.status),
          canRetry: ["failed", "completed-with-errors", "interrupted", "cancelled"].includes(task.status),
        });
        return true;
      }

      const matchCancel = path.match(/^\/api\/ai-tasks\/([^/]+)\/cancel$/);
      if (matchCancel && method === "POST") {
        json(res, cancel(matchCancel[1]));
        return true;
      }

      const matchRetry = path.match(/^\/api\/ai-tasks\/([^/]+)\/retry$/);
      if (matchRetry && method === "POST") {
        json(res, retry(matchRetry[1]));
        return true;
      }

      return false;
    },
  };
}
