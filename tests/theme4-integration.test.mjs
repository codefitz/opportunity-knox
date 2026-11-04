import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";

async function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "theme4-test-"));
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

test("Theme 4: Settings API manages exclusionKeywords, targetTitles, and targetSkills", async (t) => {
  const f = await createFixture(t);

  const initial = await f.request("/api/settings");
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.data.exclusionKeywords, []);
  assert.deepEqual(initial.data.targetTitles, []);
  assert.deepEqual(initial.data.targetSkills, []);

  // Configure settings
  const updated = await f.request("/api/settings", {
    method: "PATCH",
    body: {
      exclusionKeywords: ["DV clearance", "Inside IR35", "WordPress"],
      targetTitles: ["Staff Engineer", "Principal Architect"],
      targetSkills: ["TypeScript", "Distributed Systems", "Cloud"],
    },
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.data.exclusionKeywords, [
    "DV clearance",
    "Inside IR35",
    "WordPress",
  ]);
  assert.deepEqual(updated.data.targetTitles, [
    "Staff Engineer",
    "Principal Architect",
  ]);
  assert.deepEqual(updated.data.targetSkills, [
    "TypeScript",
    "Distributed Systems",
    "Cloud",
  ]);

  // Validation: non-array rejected
  const invalid = await f.request("/api/settings", {
    method: "PATCH",
    body: {
      exclusionKeywords: "invalid string",
    },
  });
  assert.equal(invalid.status, 400);
});

test("Theme 4: Opportunity intake classifies seniority, detects exclusions, and scores alignment", async (t) => {
  const f = await createFixture(t);

  // Set up profile criteria
  await f.request("/api/settings", {
    method: "PATCH",
    body: {
      exclusionKeywords: ["DV clearance", "WordPress"],
      targetTitles: ["Principal Architect", "Head of Engineering"],
      targetSkills: ["TypeScript", "Kubernetes", "AWS"],
    },
  });

  // 1. Executive role with clean title
  const opp1 = await f.request("/api/opportunities", {
    method: "POST",
    body: {
      company: "Acme Corp",
      role: "VP of Engineering",
      description: "Leading the global technical organisation.",
    },
  });
  assert.equal(opp1.status, 201);
  assert.equal(opp1.data.seniority, "executive");
  assert.deepEqual(opp1.data.matchedExclusions, []);

  // 2. Strong match role with target skills and explicit seniority
  const opp2 = await f.request("/api/opportunities", {
    method: "POST",
    body: {
      company: "CloudScale Inc",
      role: "Principal Architect",
      description: "We are seeking a Principal Architect skilled in TypeScript, Kubernetes, and AWS architecture.",
      seniority: "lead",
    },
  });
  assert.equal(opp2.status, 201);
  assert.equal(opp2.data.seniority, "lead");
  assert.equal(opp2.data.alignmentTier, "strong");
  assert.ok(opp2.data.alignmentScore >= 75);
  assert.deepEqual(opp2.data.matchedSkills.sort(), ["AWS", "Kubernetes", "TypeScript"].sort());
  assert.deepEqual(opp2.data.matchedExclusions, []);

  // 3. Excluded role
  const opp3 = await f.request("/api/opportunities", {
    method: "POST",
    body: {
      company: "GovSec Ltd",
      role: "Lead Architect",
      description: "Must hold active DV clearance before starting. Role entails AWS cloud infrastructure.",
    },
  });
  assert.equal(opp3.status, 201);
  assert.equal(opp3.data.seniority, "lead");
  assert.deepEqual(opp3.data.matchedExclusions, ["DV clearance"]);

  // 4. Update seniority via PATCH
  const patchRes = await f.request(`/api/opportunities/${opp1.data.id}`, {
    method: "PATCH",
    body: {
      revision: opp1.data.revision,
      seniority: "director",
    },
  });
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.data.seniority, "director");

  // 5. Batch archive excluded opportunities
  const archiveRes = await f.request("/api/opportunities/archive-excluded", {
    method: "POST",
  });
  assert.equal(archiveRes.status, 200);
  assert.equal(archiveRes.data.archivedCount, 1);
  assert.deepEqual(archiveRes.data.archivedIds, [opp3.data.id]);

  // Check opp3 is now outcome "ignored" with event note
  const board = await f.request("/api/board");
  assert.equal(board.status, 200);
  const archived = board.data.opportunities.find((o) => o.id === opp3.data.id);
  assert.equal(archived.stage, "outcome");
  assert.equal(archived.outcome, "ignored");
  assert.match(
    archived.events[archived.events.length - 1].note,
    /Archived automatically due to exclusion keyword/,
  );

  // opp1 and opp2 remain in active stages
  const activeOpp1 = board.data.opportunities.find((o) => o.id === opp1.data.id);
  assert.equal(activeOpp1.stage, "identification");
  assert.equal(activeOpp1.outcome, "");
});
