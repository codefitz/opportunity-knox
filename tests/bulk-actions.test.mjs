import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";

async function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "bulk-actions-test-"));
  const options = {
    dataDir: join(root, "state"),
    filesDir: join(root, "files"),
    setupToken: "test-setup-token",
    automationEnabled: false,
  };
  const app = createApp(options);
  await new Promise((done) => app.server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = "";

  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  async function request(path, { method = "GET", body } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const type = response.headers.get("content-type") || "";
    const data = type.includes("application/json")
      ? await response.json()
      : await response.text();
    return { response, status: response.status, data };
  }

  const setupRes = await request("/api/setup", {
    method: "POST",
    body: {
      password: "test-password-123",
      token: "test-setup-token",
    },
  });
  assert.equal(setupRes.status, 200);
  cookie = setupRes.response.headers.get("set-cookie").split(";")[0];

  return { request, app };
}

test("Bulk Actions: batch stage change, outcome, tag management and delete", async (t) => {
  const f = await createFixture(t);

  // Create 3 test opportunities
  const opp1 = await f.request("/api/opportunities", {
    method: "POST",
    body: {
      role: "Lead Platform Engineer",
      company: "Acme Cloud",
      description: "Kubernetes and Go platform architecture.",
      stage: "identification",
    },
  });
  assert.equal(opp1.status, 201);

  const opp2 = await f.request("/api/opportunities", {
    method: "POST",
    body: {
      role: "Senior Backend Engineer",
      company: "Stripe",
      description: "Distributed payments engine.",
      stage: "identification",
    },
  });
  assert.equal(opp2.status, 201);

  const opp3 = await f.request("/api/opportunities", {
    method: "POST",
    body: {
      role: "Staff Infrastructure Engineer",
      company: "Datadog",
      description: "Observability at scale.",
      stage: "identification",
    },
  });
  assert.equal(opp3.status, 201);

  const ids = [opp1.data.id, opp2.data.id, opp3.data.id];

  // 1. Validation checks
  const noIds = await f.request("/api/opportunities/batch", {
    method: "POST",
    body: { action: "stage", stage: "review", ids: [] },
  });
  assert.equal(noIds.status, 400);

  const invalidAction = await f.request("/api/opportunities/batch", {
    method: "POST",
    body: { action: "unknown-action", ids },
  });
  assert.equal(invalidAction.status, 400);

  // 2. Batch Stage Change: Move opp1 and opp2 to "interviews"
  const stageRes = await f.request("/api/opportunities/batch", {
    method: "POST",
    body: {
      action: "stage",
      stage: "interviews",
      ids: [opp1.data.id, opp2.data.id],
    },
  });
  assert.equal(stageRes.status, 200);
  assert.equal(stageRes.data.count, 2);
  assert.deepEqual(stageRes.data.updatedIds.sort(), [opp1.data.id, opp2.data.id].sort());

  // Verify in board
  const boardAfterStage = await f.request("/api/board");
  const checkOpp1 = boardAfterStage.data.opportunities.find((o) => o.id === opp1.data.id);
  const checkOpp2 = boardAfterStage.data.opportunities.find((o) => o.id === opp2.data.id);
  const checkOpp3 = boardAfterStage.data.opportunities.find((o) => o.id === opp3.data.id);
  assert.equal(checkOpp1.stage, "interviews");
  assert.equal(checkOpp2.stage, "interviews");
  assert.equal(checkOpp3.stage, "identification"); // untouched
  assert.match(checkOpp1.events.at(-1).note, /Stage updated via bulk action/);

  // 3. Batch Tag Add: Add "High Priority" to all 3
  const addTagRes = await f.request("/api/opportunities/batch", {
    method: "POST",
    body: {
      action: "add-tag",
      tag: "High Priority",
      ids,
    },
  });
  assert.equal(addTagRes.status, 200);
  assert.equal(addTagRes.data.count, 3);

  // Verify tags in board
  const boardAfterTag = await f.request("/api/board");
  for (const id of ids) {
    const opp = boardAfterTag.data.opportunities.find((o) => o.id === id);
    assert.ok(opp.tags.includes("High Priority"));
  }

  // 4. Batch Tag Remove: Remove "High Priority" from opp2 and opp3
  const removeTagRes = await f.request("/api/opportunities/batch", {
    method: "POST",
    body: {
      action: "remove-tag",
      tag: "High Priority",
      ids: [opp2.data.id, opp3.data.id],
    },
  });
  assert.equal(removeTagRes.status, 200);
  assert.equal(removeTagRes.data.count, 2);

  const boardAfterRemoveTag = await f.request("/api/board");
  const opp1Tags = boardAfterRemoveTag.data.opportunities.find((o) => o.id === opp1.data.id).tags;
  const opp2Tags = boardAfterRemoveTag.data.opportunities.find((o) => o.id === opp2.data.id).tags;
  assert.ok(opp1Tags.includes("High Priority"));
  assert.ok(!opp2Tags.includes("High Priority"));

  // 5. Batch Outcome: Mark opp3 as outcome "rejected" and opp2 as outcome "gone-cold"
  const outcomeRes = await f.request("/api/opportunities/batch", {
    method: "POST",
    body: {
      action: "outcome",
      outcome: "rejected",
      ids: [opp3.data.id],
    },
  });
  assert.equal(outcomeRes.status, 200);
  assert.equal(outcomeRes.data.count, 1);

  const coldRes = await f.request("/api/opportunities/batch", {
    method: "POST",
    body: {
      action: "outcome",
      outcome: "gone-cold",
      ids: [opp2.data.id],
    },
  });
  assert.equal(coldRes.status, 200);
  assert.equal(coldRes.data.count, 1);

  const boardAfterOutcome = await f.request("/api/board");
  const opp3Outcome = boardAfterOutcome.data.opportunities.find((o) => o.id === opp3.data.id);
  const opp2Outcome = boardAfterOutcome.data.opportunities.find((o) => o.id === opp2.data.id);
  assert.equal(opp3Outcome.stage, "outcome");
  assert.equal(opp3Outcome.outcome, "rejected");
  assert.equal(opp2Outcome.stage, "outcome");
  assert.equal(opp2Outcome.outcome, "gone-cold");

  // 6. Batch Delete: Delete opp2 and opp3
  const deleteRes = await f.request("/api/opportunities/batch", {
    method: "POST",
    body: {
      action: "delete",
      ids: [opp2.data.id, opp3.data.id],
    },
  });
  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.data.count, 2);

  const boardAfterDelete = await f.request("/api/board");
  assert.equal(boardAfterDelete.data.opportunities.length, 1);
  assert.equal(boardAfterDelete.data.opportunities[0].id, opp1.data.id);
});
