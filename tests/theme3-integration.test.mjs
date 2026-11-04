import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";

async function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "theme3-test-"));
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

  async function request(path, { method = "GET", body, auth = true } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(auth && cookie ? { Cookie: cookie } : {}),
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

  return { request };
}

test("Theme 3: Settings API manages workflow automation and daily target preferences", async (t) => {
  const f = await createFixture(t);

  const initial = await f.request("/api/settings");
  assert.equal(initial.status, 200);
  assert.equal(initial.data.autoAdvanceStages, true);
  assert.equal(initial.data.autoGenerateTasks, false);
  assert.equal(initial.data.defaultFollowUpDays, 7);
  assert.equal(initial.data.dailyTarget, 3);

  // Update settings
  const updated = await f.request("/api/settings", {
    method: "PATCH",
    body: {
      autoAdvanceStages: false,
      autoGenerateTasks: false,
      defaultFollowUpDays: 14,
      dailyTarget: 5,
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.autoAdvanceStages, false);
  assert.equal(updated.data.autoGenerateTasks, false);
  assert.equal(updated.data.defaultFollowUpDays, 14);
  assert.equal(updated.data.dailyTarget, 5);

  // Validation: dailyTarget bounds
  const invalidTarget = await f.request("/api/settings", {
    method: "PATCH",
    body: { dailyTarget: 0 },
  });
  assert.equal(invalidTarget.status, 400);

  const invalidDays = await f.request("/api/settings", {
    method: "PATCH",
    body: { defaultFollowUpDays: -1 },
  });
  assert.equal(invalidDays.status, 400);
});

test("Theme 3: Automatic next actions, linked tasks, and two-way completion sync", async (t) => {
  const f = await createFixture(t);

  // Enable autoGenerateTasks
  await f.request("/api/settings", {
    method: "PATCH",
    body: { autoGenerateTasks: true },
  });

  // Create an opportunity without explicit nextAction
  const oppRes = await f.request("/api/opportunities", {
    method: "POST",
    body: {
      company: "Acme Corp",
      role: "Staff Engineer",
    },
  });
  assert.equal(oppRes.status, 201);
  const opp = oppRes.data;
  assert.equal(opp.nextAction, "Review job requirements & fit");
  assert.ok(opp.nextActionDate);

  // Verify linked task was automatically generated
  const tasksRes = await f.request("/api/tasks");
  assert.equal(tasksRes.status, 200);
  const linkedTask = tasksRes.data.tasks.find((tk) => tk.opportunityId === opp.id);
  assert.ok(linkedTask, "Linked task should have been created");
  assert.match(linkedTask.title, /Review job requirements & fit for Staff Engineer at Acme Corp/);
  assert.equal(linkedTask.dueDate, opp.nextActionDate);
  assert.equal(linkedTask.completed, false);

  // Complete the linked task via PATCH /api/tasks/:id
  const completeTaskRes = await f.request(`/api/tasks/${linkedTask.id}`, {
    method: "PATCH",
    body: {
      revision: linkedTask.revision,
      completed: true,
    },
  });
  assert.equal(completeTaskRes.status, 200);
  assert.equal(completeTaskRes.data.completed, true);

  // Verify the opportunity's nextAction was cleared in response
  const updatedOpp = await f.request(`/api/opportunities/${opp.id}`);
  assert.equal(updatedOpp.status, 200);
  assert.equal(updatedOpp.data.nextAction, "");
  assert.equal(updatedOpp.data.nextActionDate, "");
});

test("Theme 3: Milestone auto-advancement on interview scheduling with provenance event notes", async (t) => {
  const f = await createFixture(t);

  // Create an opportunity in identification stage
  const oppRes = await f.request("/api/opportunities", {
    method: "POST",
    body: {
      company: "Tech Giant",
      role: "Lead Architect",
      stage: "identification",
    },
  });
  assert.equal(oppRes.status, 201);
  const opp = oppRes.data;
  assert.equal(opp.stage, "identification");

  // Schedule an interview
  const actRes = await f.request(`/api/opportunities/${opp.id}/activities`, {
    method: "POST",
    body: {
      kind: "interview",
      type: "Technical screen",
      title: "Architecture & System Design",
      scheduledAt: "2026-11-15T14:00:00Z",
      status: "planned",
      isFinal: false,
    },
  });
  assert.equal(actRes.status, 200);

  // Check opportunity auto-advanced to 'interviews'
  const updatedOpp = await f.request(`/api/opportunities/${opp.id}`);
  assert.equal(updatedOpp.status, 200);
  assert.equal(updatedOpp.data.stage, "interviews");
  assert.equal(updatedOpp.data.nextAction, "Prepare interview talking points");

  // Check event provenance
  const lastEvent = updatedOpp.data.events.find(
    (e) => e.note && e.note.includes("Auto-advanced: Interview scheduled"),
  );
  assert.ok(lastEvent, "Auto-advanced provenance event should be logged");

  // Schedule a final interview
  const finalActRes = await f.request(`/api/opportunities/${opp.id}/activities`, {
    method: "POST",
    body: {
      kind: "interview",
      type: "Executive interview",
      title: "VP of Engineering Discussion",
      scheduledAt: "2026-11-20T16:00:00Z",
      status: "planned",
      isFinal: true,
    },
  });
  assert.equal(finalActRes.status, 200);

  // Check opportunity auto-advanced to 'final-interview'
  const finalOpp = await f.request(`/api/opportunities/${opp.id}`);
  assert.equal(finalOpp.data.stage, "final-interview");
  assert.ok(
    finalOpp.data.events.some((e) => e.note?.includes("Auto-advanced: Final interview scheduled")),
  );

  // Disable autoAdvanceStages and ensure stages are not auto-advanced
  await f.request("/api/settings", {
    method: "PATCH",
    body: { autoAdvanceStages: false },
  });

  const opp2Res = await f.request("/api/opportunities", {
    method: "POST",
    body: {
      company: "Startup Co",
      role: "Full Stack Engineer",
      stage: "identification",
    },
  });
  assert.equal(opp2Res.status, 201);
  const opp2 = opp2Res.data;

  // Add an interview to opp2
  await f.request(`/api/opportunities/${opp2.id}/activities`, {
    method: "POST",
    body: {
      kind: "interview",
      type: "Screen",
      title: "Recruiter Chat",
      scheduledAt: "2026-11-18T10:00:00Z",
      status: "planned",
    },
  });

  // Verify stage remains 'identification' because autoAdvanceStages is disabled
  const opp2After = await f.request(`/api/opportunities/${opp2.id}`);
  assert.equal(opp2After.data.stage, "identification");
});

