import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createBuddyRequests } from "../server/buddy-requests.mjs";
test("restart marks unfinished requests and preserved user messages interrupted without retrying", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE standalone_messages(id TEXT PRIMARY KEY,data TEXT NOT NULL)",
    );
    const controls = createBuddyRequests(db);
    controls.start("fictional-request", "fictional-chat", {
      provider: "custom",
      model: "fictional",
    });
    db.prepare("INSERT INTO standalone_messages VALUES (?,?)").run(
      "u",
      JSON.stringify({
        role: "user",
        requestId: "fictional-request",
        status: "pending",
        content: "Fictional preserved draft",
      }),
    );
    createBuddyRequests(db);
    const request = JSON.parse(
      db.prepare("SELECT data FROM buddy_requests").get().data,
    );
    assert.equal(request.stage, "interrupted");
    const message = JSON.parse(
      db.prepare("SELECT data FROM standalone_messages").get().data,
    );
    assert.equal(message.status, "interrupted");
    assert.equal(message.content, "Fictional preserved draft");
  } finally {
    db.close();
  }
});
