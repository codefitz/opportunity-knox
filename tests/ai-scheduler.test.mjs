import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createAIScheduler, TASK_KINDS, TASK_STATUSES } from "../server/ai-scheduler.mjs";

function memoryDb() {
  const db = new DatabaseSync(":memory:");
  return db;
}

test("scheduler initialises table, marks incomplete jobs interrupted on startup, and exports secret-safe tasks", () => {
  const db = memoryDb();
  let now = Date.parse("2026-10-31T12:00:00Z");
  const clock = () => now;

  db.exec("CREATE TABLE ai_tasks(id TEXT PRIMARY KEY, data TEXT NOT NULL)");
  db.prepare("INSERT INTO ai_tasks VALUES (?, ?)").run(
    "old-running",
    JSON.stringify({
      id: "old-running",
      kind: "embedding-index",
      label: "Vector embedding indexing",
      status: "running",
      payload: { documentIds: ["doc-1"], apiKey: "secret-key", vectorApiKey: "v-secret" },
      createdAt: "2026-10-31T11:50:00Z",
    }),
  );

  const scheduler = createAIScheduler({ db, clock });
  const interrupted = scheduler.get("old-running");
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.finishedAt, "2026-10-31T12:00:00.000Z");
  assert.match(interrupted.error, /restart/i);

  const exported = scheduler.exportTasks();
  assert.equal(exported.length, 1);
  assert.equal(exported[0].id, "old-running");
  assert.equal(exported[0].payload.apiKey, undefined);
  assert.equal(exported[0].payload.vectorApiKey, undefined);
  assert.deepEqual(exported[0].payload.documentIds, ["doc-1"]);
});

test("scheduler enqueues, tracks progress, sets running, cooperative cancellation, and handles runner retries", async () => {
  const db = memoryDb();
  let now = Date.parse("2026-10-31T12:00:00Z");
  const clock = () => now;

  const scheduler = createAIScheduler({
    db,
    clock,
    listRecords: () => [{ id: "opp-1", role: "Staff Engineer", company: "Fictional Ltd" }],
  });

  let runnerCalls = 0;
  scheduler.registerRunner("opportunity-automation", (task) => {
    runnerCalls++;
    assert.equal(task.targetId, "opp-1");
  });

  assert.throws(() => scheduler.enqueue({ kind: "unsupported-kind" }), { status: 400 });

  const task = scheduler.enqueue({
    id: "task-1",
    kind: "opportunity-automation",
    targetId: "opp-1",
    payload: { options: { useLibrary: true } },
  });
  assert.equal(task.id, "task-1");
  assert.equal(task.status, "queued");

  // Conflict on enqueue duplicate active
  assert.throws(() => scheduler.enqueue({ id: "task-1", kind: "opportunity-automation" }), { status: 409 });

  const controller = new AbortController();
  scheduler.setRunning("task-1", controller);
  assert.equal(scheduler.get("task-1").status, "running");

  scheduler.updateProgress("task-1", { current: 1, total: 3, detail: "1 of 3 items" });
  assert.equal(scheduler.get("task-1").progress.current, 1);
  assert.equal(scheduler.get("task-1").progress.total, 3);
  assert.equal(scheduler.get("task-1").progress.detail, "1 of 3 items");

  // Cancel while running aborts controller
  let aborted = false;
  controller.signal.addEventListener("abort", () => {
    aborted = true;
  });
  scheduler.cancel("task-1");
  assert.equal(aborted, true);
  assert.equal(scheduler.get("task-1").status, "cancelling");

  scheduler.finish("task-1", { status: "cancelled" });
  assert.equal(scheduler.get("task-1").status, "cancelled");

  // Filter list with subject from targetId
  const listing = scheduler.list({ status: "all" });
  assert.equal(listing.total, 1);
  assert.equal(listing.items[0].subject, "Staff Engineer — Fictional Ltd");
  assert.equal(listing.totals.cancelled, 1);

  // Retry triggers registered runner
  scheduler.retry("task-1");
  assert.equal(scheduler.get("task-1").status, "queued");
  assert.equal(scheduler.get("task-1").retries, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runnerCalls, 1);
});
