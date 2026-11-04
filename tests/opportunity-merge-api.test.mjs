import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "knox-theme2-test-"));
  const options = {
    dataDir: join(root, "state"),
    filesDir: join(root, "files"),
    setupToken: "test-token",
    automationEnabled: false,
  };
  const app = createApp(options);
  await new Promise((done) => app.server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  let cookie = "";

  async function request(path, { method = "GET", body } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      cookie = setCookie.split(";")[0];
    }
    const json = res.status !== 204 ? await res.json() : null;
    return { status: res.status, json };
  }

  // Setup passphrase
  const setupRes = await request("/api/setup", {
    method: "POST",
    body: { token: "test-token", password: "correct horse battery staple" },
  });
  assert.equal(setupRes.status, 200);

  return { request };
}

test("Target companies API supports CRUD operations", async (t) => {
  const { request } = await fixture(t);

  // List initial
  const list1 = await request("/api/target-companies");
  assert.equal(list1.status, 200);
  assert.deepEqual(list1.json, []);

  // Create target company
  const created = await request("/api/target-companies", {
    method: "POST",
    body: {
      name: "Stripe",
      targetRoles: ["Staff Engineer"],
      tier: "dream",
      status: "researching",
      website: "https://stripe.com",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.name, "Stripe");
  assert.equal(created.json.tier, "dream");

  // Update target company
  const updated = await request(`/api/target-companies/${created.json.id}`, {
    method: "PATCH",
    body: {
      status: "reached-out",
      notes: "Spoke with recruiter on LinkedIn",
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.status, "reached-out");
  assert.equal(updated.json.notes, "Spoke with recruiter on LinkedIn");

  // Delete target company
  const deleted = await request(`/api/target-companies/${created.json.id}`, {
    method: "DELETE",
  });
  assert.equal(deleted.status, 200);

  const list2 = await request("/api/target-companies");
  assert.equal(list2.status, 200);
  assert.deepEqual(list2.json, []);
});

test("Opportunity merge endpoint consolidates duplicate records and deletes duplicate", async (t) => {
  const { request } = await fixture(t);

  // Create target opportunity
  const op1 = await request("/api/opportunities", {
    method: "POST",
    body: {
      company: "Acme Corp",
      role: "Lead Designer",
      location: "London",
      url: "https://acme.com/jobs/1",
      tags: ["design", "lead"],
    },
  });
  assert.equal(op1.status, 201);

  // Create duplicate opportunity with additional info
  const op2 = await request("/api/opportunities", {
    method: "POST",
    body: {
      company: "Acme Corp",
      role: "Lead Designer",
      salary: "£90,000",
      workMode: "Hybrid",
      tags: ["design", "figma"],
      description: "Exciting opportunity leading product design",
    },
  });
  assert.equal(op2.status, 201);

  // Merge op2 into op1
  const mergeRes = await request(`/api/opportunities/${op1.json.id}/merge`, {
    method: "POST",
    body: { duplicateId: op2.json.id },
  });
  assert.equal(mergeRes.status, 200);

  const merged = mergeRes.json;
  assert.equal(merged.company, "Acme Corp");
  assert.equal(merged.role, "Lead Designer");
  assert.equal(merged.salary, "£90,000"); // filled from duplicate
  assert.equal(merged.workMode, "Hybrid"); // filled from duplicate
  assert.equal(merged.location, "London"); // preserved from primary
  assert.ok(merged.tags.includes("lead"));
  assert.ok(merged.tags.includes("figma"));
  assert.ok(merged.events.some((e) => e.note?.includes("Merged duplicate opportunity")));

  // Verify op2 was deleted
  const getOp2 = await request(`/api/opportunities/${op2.json.id}`);
  assert.equal(getOp2.status, 404);
});

test("Opportunity DELETE endpoint removes record", async (t) => {
  const { request } = await fixture(t);

  const op = await request("/api/opportunities", {
    method: "POST",
    body: {
      company: "Linear",
      role: "Frontend Engineer",
    },
  });
  assert.equal(op.status, 201);

  const del = await request(`/api/opportunities/${op.json.id}`, {
    method: "DELETE",
  });
  assert.equal(del.status, 200);
  assert.equal(del.json.deleted, true);

  const check = await request(`/api/opportunities/${op.json.id}`);
  assert.equal(check.status, 404);
});
