import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";
import {
  validateCriteria,
  validateAssessment,
} from "../server/decision-review.mjs";

const profile = {
  revision: 1,
  items: [
    {
      id: "salary",
      description: "At least GBP 80,000 base salary",
      priority: "required",
    },
  ],
};
test("criteria validate priorities, unique IDs and revision conflicts", () => {
  assert.equal(validateCriteria(profile, profile).revision, 2);
  assert.throws(() => validateCriteria({ ...profile, revision: 0 }, profile), {
    status: 409,
  });
  for (const items of [
    [...profile.items, ...profile.items],
    [{ ...profile.items[0], priority: "maybe" }],
    [{ ...profile.items[0], description: "" }],
  ])
    assert.throws(() => validateCriteria({ ...profile, items }, profile), {
      status: 400,
    });
});
test("assessment needs every criterion, real source IDs and no proceed with unknown required facts", () => {
  const value = {
    recommendation: "consider",
    summary: "Salary needs clarification.",
    criteria: [
      {
        id: "salary",
        status: "unknown",
        reason: "No salary is listed.",
        sourceIds: [],
        questions: ["What is the base salary?"],
      },
    ],
  };
  assert.equal(
    validateAssessment(value, profile, new Set(["role"])).criteria[0].status,
    "unknown",
  );
  assert.throws(
    () =>
      validateAssessment(
        { ...value, recommendation: "proceed" },
        profile,
        new Set(),
      ),
    { status: 502 },
  );
  for (const row of [
    { ...value.criteria[0], status: "met" },
    { ...value.criteria[0], sourceIds: ["invented"] },
    { ...value.criteria[0], id: "other" },
  ])
    assert.throws(
      () =>
        validateAssessment(
          { ...value, criteria: [row] },
          profile,
          new Set(["role"]),
        ),
      { status: 502 },
    );
  assert.throws(
    () => validateAssessment({ ...value, criteria: [] }, profile, new Set()),
    { status: 502 },
  );
});

test("criteria validates and normalizes structured criteria", () => {
  const current = { revision: 1, items: [] };
  const res = validateCriteria(
    {
      revision: 1,
      items: [],
      structured: {
        targetTitles: ["  Software Architect  ", "", 123, "Tech Lead"],
        minSalary: 120000,
        salaryCurrency: " USD ",
        salaryPeriod: "year",
        targetSeniorities: ["senior", "lead", "invalid-level"],
        targetSkills: [" TypeScript ", "React", ""],
        workModes: ["remote", "hybrid", "in-space"],
      },
    },
    current,
  );

  assert.equal(res.revision, 2);
  assert.deepEqual(res.structured.targetTitles, [
    "Software Architect",
    "Tech Lead",
  ]);
  assert.equal(res.structured.minSalary, 120000);
  assert.equal(res.structured.salaryCurrency, "USD");
  assert.equal(res.structured.salaryPeriod, "year");
  assert.deepEqual(res.structured.targetSeniorities, ["senior", "lead"]);
  assert.deepEqual(res.structured.targetSkills, ["TypeScript", "React"]);
  assert.deepEqual(res.structured.workModes, ["remote", "hybrid"]);
});

test("fit criteria endpoint gets and patches structured criteria", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "fit-criteria-test-"));
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

  // 1. Initial GET returns structured defaults
  const initial = await request("/api/buddy/fit-criteria");
  assert.equal(initial.status, 200);
  assert.equal(initial.data.revision, 1);
  assert.ok(initial.data.structured);
  assert.deepEqual(initial.data.structured.targetTitles, []);
  assert.equal(initial.data.structured.minSalary, null);

  // 2. PATCH persists structured preferences
  const patchRes = await request("/api/buddy/fit-criteria", {
    method: "PATCH",
    body: {
      revision: initial.data.revision,
      items: [
        {
          id: "crit-1",
          description: "Role matches senior level requirements",
          priority: "required",
        },
      ],
      structured: {
        targetTitles: ["Staff Engineer"],
        minSalary: 150000,
        salaryCurrency: "USD",
        salaryPeriod: "year",
        targetSeniorities: ["senior", "lead"],
        targetSkills: ["TypeScript", "Node.js"],
        workModes: ["remote"],
      },
    },
  });
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.data.revision, 2);
  assert.equal(patchRes.data.structured.minSalary, 150000);
  assert.deepEqual(patchRes.data.structured.targetTitles, ["Staff Engineer"]);
  assert.deepEqual(patchRes.data.structured.workModes, ["remote"]);

  // 3. GET retrieves the persisted structured criteria
  const fetched = await request("/api/buddy/fit-criteria");
  assert.equal(fetched.status, 200);
  assert.equal(fetched.data.revision, 2);
  assert.equal(fetched.data.structured.minSalary, 150000);
  assert.deepEqual(fetched.data.structured.targetSkills, ["TypeScript", "Node.js"]);
  assert.deepEqual(fetched.data.structured.targetSeniorities, ["senior", "lead"]);
});

