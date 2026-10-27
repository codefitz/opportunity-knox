import test from "node:test";
import assert from "node:assert/strict";
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
