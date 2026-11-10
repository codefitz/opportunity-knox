import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanRoleTitle,
  extractCoreRoleTitle,
  matchRoleArchetype,
  computeTitleKeywordSimilarity,
  groupOpportunitiesByTitleKeyword,
  clusterTitlesWithVectors,
} from "../server/title-grouping.mjs";
import { groupOpportunitiesByTitle } from "../src/lib/title-grouping.ts";
import { createApp } from "../server/app.mjs";

test("cleanRoleTitle and extractCoreRoleTitle normalize noise and seniority", () => {
  assert.equal(
    cleanRoleTitle("Senior Software Engineer (Remote, UK) [m/f/d]"),
    "Senior Software Engineer",
  );
  assert.equal(
    extractCoreRoleTitle("Senior Software Engineer - Remote"),
    "Software Engineer",
  );
  assert.equal(
    extractCoreRoleTitle("Principal Backend Developer II"),
    "Backend Developer",
  );
  assert.equal(
    extractCoreRoleTitle("Lead Site Reliability Engineer, Cloud Platform"),
    "Site Reliability Engineer",
  );
  // Keep management nouns intact
  assert.equal(
    extractCoreRoleTitle("Senior Engineering Manager"),
    "Engineering Manager",
  );
});

test("matchRoleArchetype maps synonyms and role variants to canonical families", () => {
  assert.equal(
    matchRoleArchetype("Senior Software Developer (Remote)")?.canonicalTitle,
    "Software Engineer",
  );
  assert.equal(
    matchRoleArchetype("Staff SWE")?.canonicalTitle,
    "Software Engineer",
  );
  assert.equal(
    matchRoleArchetype("Senior SRE")?.canonicalTitle,
    "Platform, DevOps & SRE",
  );
  assert.equal(
    matchRoleArchetype("Lead Platform Engineer")?.canonicalTitle,
    "Platform, DevOps & SRE",
  );
  assert.equal(
    matchRoleArchetype("Senior Software Engineering Manager")?.canonicalTitle,
    "Engineering Manager",
  );
  assert.equal(
    matchRoleArchetype("Applied AI / LLM Engineer")?.canonicalTitle,
    "AI & Machine Learning Engineer",
  );
  assert.equal(
    matchRoleArchetype("Principal Cloud Architect")?.canonicalTitle,
    "Solutions & Systems Architect",
  );
});

test("computeTitleKeywordSimilarity groups similar domain titles and separates unrelated managers", () => {
  const simSameDomain = computeTitleKeywordSimilarity(
    "Senior Clinical Research Associate",
    "Clinical Research Coordinator",
  );
  assert.ok(simSameDomain >= 0.65, `Expected >= 0.65, got ${simSameDomain}`);

  const simUnrelatedManagers = computeTitleKeywordSimilarity(
    "Marketing Manager",
    "Finance Manager",
  );
  assert.ok(
    simUnrelatedManagers < 0.3,
    `Expected < 0.3 for unrelated managers, got ${simUnrelatedManagers}`,
  );
});

test("groupOpportunitiesByTitleKeyword clusters role variations and preserves IC vs management separation", () => {
  const opportunities = [
    { id: "1", role: "Senior Software Engineer (Remote)", company: "Alpha" },
    { id: "2", role: "Software Developer II", company: "Beta" },
    { id: "3", role: "Staff SWE", company: "Gamma" },
    { id: "4", role: "Senior Engineering Manager", company: "Delta" },
    { id: "5", role: "Software Development Manager", company: "Epsilon" },
    { id: "6", role: "Site Reliability Engineer", company: "Zeta" },
    { id: "7", role: "Senior DevOps & Platform Engineer", company: "Eta" },
  ];

  const groups = groupOpportunitiesByTitleKeyword(opportunities);
  assert.equal(groups.length, 3);

  const sweGroup = groups.find((g) => g.label === "Software Engineer");
  assert.ok(sweGroup);
  assert.deepEqual(
    sweGroup.items.map((x) => x.id),
    ["1", "2", "3"],
  );

  const emGroup = groups.find((g) => g.label === "Engineering Manager");
  assert.ok(emGroup);
  assert.deepEqual(
    emGroup.items.map((x) => x.id),
    ["4", "5"],
  );

  const sreGroup = groups.find((g) => g.label === "Platform, DevOps & SRE");
  assert.ok(sreGroup);
  assert.deepEqual(
    sreGroup.items.map((x) => x.id),
    ["6", "7"],
  );
});

test("clusterTitlesWithVectors merges semantically equivalent custom titles using embeddings", () => {
  const opportunities = [
    { id: "1", role: "Quantitative Alpha Strategist", company: "Fund A" },
    { id: "2", role: "Systematic Trading Modeler", company: "Fund B" },
    { id: "3", role: "Biomedical Lab Specialist", company: "Bio C" },
  ];

  // Construct normalized 4-d vectors where roles 1 & 2 have high cosine similarity (~0.98)
  // and role 3 is orthogonal.
  const vec1 = [0.8, 0.6, 0, 0];
  const vec2 = [0.82, 0.572, 0, 0];
  const vec3 = [0, 0, 0.7071, 0.7071];

  const vectorMap = new Map([
    ["quantitative alpha strategist", vec1],
    ["systematic trading modeler", vec2],
    ["biomedical lab specialist", vec3],
  ]);

  const groups = clusterTitlesWithVectors(opportunities, vectorMap);
  assert.equal(groups.length, 2);
  const quantGroup = groups.find((g) => g.items.length === 2);
  assert.ok(quantGroup);
  assert.equal(quantGroup.matchMethod, "keyword+semantic");
  assert.deepEqual(
    quantGroup.items.map((x) => x.id),
    ["1", "2"],
  );
});

test("client groupOpportunitiesByTitle applies semantic assignments and sort direction", () => {
  const opportunities = [
    { id: "a", role: "Product Owner", company: "Acme" },
    { id: "b", role: "Senior Backend Engineer", company: "Beta" },
  ];

  const assignments = {
    a: {
      key: "arch:product-manager",
      label: "Product Manager",
      archetypeId: "product-manager",
      matchMethod: "keyword+semantic",
    },
    b: {
      key: "arch:backend-engineer",
      label: "Backend Engineer",
      archetypeId: "backend-engineer",
      matchMethod: "keyword+semantic",
    },
  };

  const asc = groupOpportunitiesByTitle(opportunities, assignments, "asc");
  assert.equal(asc[0].label, "Backend Engineer");
  assert.equal(asc[1].label, "Product Manager");

  const desc = groupOpportunitiesByTitle(opportunities, assignments, "desc");
  assert.equal(desc[0].label, "Product Manager");
  assert.equal(desc[1].label, "Backend Engineer");
});

test("GET and POST /api/opportunities/title-groups return hybrid keyword + semantic groups and cache vectors", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "knox-title-groups-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  let embedCallCount = 0;
  const mockEmbeddingFn = async (texts) => {
    embedCallCount++;
    return texts.map((text) => {
      const vec = new Array(384).fill(0);
      // Deterministic normalized vector based on semantic family keywords
      if (/software|developer|swe|mts|technical staff/i.test(text)) {
        vec[0] = 0.9;
        vec[1] = Math.sqrt(1 - 0.81);
      } else if (/product|owner/i.test(text)) {
        vec[2] = 0.9;
        vec[3] = Math.sqrt(1 - 0.81);
      } else {
        const hash = text.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
        const idx = 4 + (hash % 370);
        vec[idx] = 1;
      }
      return vec;
    });
  };

  const app = createApp({
    dataDir: join(root, "data"),
    filesDir: join(root, "files"),
    automationEnabled: false,
    embeddingFn: mockEmbeddingFn,
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());

  const { port } = app.server.address();
  const base = `http://127.0.0.1:${port}`;

  // Setup auth
  const setupRes = await fetch(`${base}/api/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ password: "fictional-password-123" }),
  });
  assert.equal(setupRes.status, 200);
  const cookie = setupRes.headers.get("set-cookie")?.split(";")[0] || "";

  // Create opportunities
  const createOpp = async (company, role) => {
    const res = await fetch(`${base}/api/opportunities`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        Cookie: cookie,
      },
      body: JSON.stringify({ company, role }),
    });
    assert.equal(res.status, 201);
    return res.json();
  };

  const opp1 = await createOpp("Fictional One", "Senior Software Engineer (Remote)");
  const opp2 = await createOpp("Fictional Two", "Software Developer");
  const opp3 = await createOpp("Fictional Three", "Senior Product Manager");

  const getRes = await fetch(`${base}/api/opportunities/title-groups`, {
    headers: { Cookie: cookie },
  });
  assert.equal(getRes.status, 200);
  const data = await getRes.json();

  assert.equal(data.usedEmbeddings, true);
  assert.equal(data.groups.length, 2);
  assert.equal(data.assignments[opp1.id].label, "Software Engineer");
  assert.equal(data.assignments[opp2.id].label, "Software Engineer");
  assert.equal(data.assignments[opp3.id].label, "Product Manager");
  assert.equal(data.assignments[opp1.id].matchMethod, "keyword+semantic");

  const callsAfterFirst = embedCallCount;
  assert.ok(callsAfterFirst >= 1);

  // Second call should hit SQLite cache and not invoke embeddingFn again
  const getRes2 = await fetch(`${base}/api/opportunities/title-groups`, {
    headers: { Cookie: cookie },
  });
  assert.equal(getRes2.status, 200);
  assert.equal(embedCallCount, callsAfterFirst);

  // Direct DELETE /api/opportunities/:id removes the opportunity immediately without preview
  const delRes = await fetch(`${base}/api/opportunities/${opp3.id}`, {
    method: "DELETE",
    headers: { Origin: base, Cookie: cookie },
  });
  assert.equal(delRes.status, 200);
  const delData = await delRes.json();
  assert.equal(delData.deleted, true);
  assert.equal(delData.id, opp3.id);

  const boardRes = await fetch(`${base}/api/board`, {
    headers: { Cookie: cookie },
  });
  const boardData = await boardRes.json();
  assert.equal(boardData.opportunities.length, 2);
});
