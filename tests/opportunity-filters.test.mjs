import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultOpportunityFilters,
  filterOpportunities,
  opportunityFilterError,
  opportunityTags,
  overdueOpportunityIds,
} from "../src/lib/opportunity-filters.ts";
const now = new Date("2026-10-29T12:00:00Z"),
  today = "2026-10-29";
const opp = (id, extra = {}) => ({
  id,
  company: `Fictional ${id}`,
  role: "Architect",
  location: "London",
  stage: "review",
  outcome: "",
  tags: [],
  deadline: "",
  nextAction: "",
  nextActionDate: "",
  createdAt: "2026-10-20T09:00:00Z",
  ...extra,
});
const task = (id, opportunityId, extra = {}) => ({
  id,
  opportunityId,
  title: "Fictional follow-up",
  dueDate: "2026-10-28",
  completed: false,
  ...extra,
});
const run = (
  opportunities,
  extra = {},
  overdue = new Set(),
  timezone = "Europe/London",
  at = now,
) =>
  filterOpportunities(
    opportunities,
    { ...defaultOpportunityFilters, ...extra },
    overdue,
    timezone,
    at,
  ).map((o) => o.id);

test("opportunity filters intersect search, stage and outcome while retaining original order and records", () => {
  const rows = [
    opp("active", { tags: ["AI"] }),
    opp("hired", { stage: "outcome", outcome: "hired" }),
    opp("interview", {
      stage: "interviews",
      company: "Fictional Platform",
      tags: ["AI"],
    }),
    opp("rejected", { stage: "outcome", outcome: "rejected" }),
  ];
  const original = structuredClone(rows);
  assert.deepEqual(run(rows), ["active", "interview"]);
  assert.deepEqual(run(rows, { outcome: "all" }), [
    "active",
    "hired",
    "interview",
    "rejected",
  ]);
  assert.deepEqual(run(rows, { outcome: "completed" }), ["hired", "rejected"]);
  assert.deepEqual(run(rows, { outcome: "hired" }), ["hired"]);
  assert.deepEqual(
    run(rows, { search: " platform ", stage: "interviews", tags: ["ai"] }),
    ["interview"],
  );
  assert.deepEqual(run(rows, { search: "london", stage: "review" }), [
    "active",
  ]);
  assert.deepEqual(run(rows, { stage: "outcome" }), []);
  assert.deepEqual(run(rows, { outcome: "all", stage: "outcome" }), [
    "hired",
    "rejected",
  ]);
  assert.deepEqual(run(rows, { search: "does-not-exist" }), []);
  assert.deepEqual(rows, original);
  assert.deepEqual(run([], {}), []);
});

test("tag choices count each opportunity once, normalise case/whitespace and support all versus any", () => {
  const rows = [
    opp("both", { tags: ["AI", " ai ", "Leadership"] }),
    opp("ai", { tags: ["ai"] }),
    opp("lead", { tags: ["Leadership"] }),
    opp("legacy", { tags: undefined }),
  ];
  assert.deepEqual(opportunityTags(rows), [
    { id: "ai", label: "AI", count: 2 },
    { id: "leadership", label: "Leadership", count: 2 },
  ]);
  assert.deepEqual(run(rows, { tags: ["AI", "leadership"], tagMatch: "all" }), [
    "both",
  ]);
  assert.deepEqual(run(rows, { tags: ["ai", "Leadership"], tagMatch: "any" }), [
    "both",
    "ai",
    "lead",
  ]);
  assert.deepEqual(run(rows, { tags: ["missing"] }), []);
});

test("application deadline presets and inclusive/open custom ranges use real valid dates", () => {
  const rows = [
    opp("past", { deadline: "2026-10-28" }),
    opp("today", { deadline: today }),
    opp("day7", { deadline: "2026-11-04" }),
    opp("day8", { deadline: "2026-11-05" }),
    opp("day30", { deadline: "2026-11-27" }),
    opp("day31", { deadline: "2026-11-28" }),
    opp("none"),
    opp("invalid", { deadline: "2026-02-30" }),
  ];
  assert.deepEqual(run(rows, { deadline: "overdue" }), ["past"]);
  assert.deepEqual(run(rows, { deadline: "today" }), ["today"]);
  assert.deepEqual(run(rows, { deadline: "next7" }), ["today", "day7"]);
  assert.deepEqual(run(rows, { deadline: "next30" }), [
    "today",
    "day7",
    "day8",
    "day30",
  ]);
  assert.deepEqual(run(rows, { deadline: "none" }), ["none", "invalid"]);
  assert.deepEqual(run(rows, { deadline: "dated" }), [
    "past",
    "today",
    "day7",
    "day8",
    "day30",
    "day31",
  ]);
  assert.deepEqual(
    run(rows, {
      deadline: "range",
      deadlineFrom: today,
      deadlineTo: "2026-11-04",
    }),
    ["today", "day7"],
  );
  assert.deepEqual(run(rows, { deadline: "range", deadlineTo: today }), [
    "past",
    "today",
  ]);
  assert.deepEqual(
    run(rows, { deadline: "range", deadlineFrom: "2026-11-27" }),
    ["day30", "day31"],
  );
  assert.deepEqual(run(rows, { deadline: "range" }), [
    "past",
    "today",
    "day7",
    "day8",
    "day30",
    "day31",
  ]);
  const invalid = {
    ...defaultOpportunityFilters,
    deadline: "range",
    deadlineFrom: "2026-11-05",
    deadlineTo: today,
  };
  assert.match(opportunityFilterError(invalid), /start date/);
  assert.deepEqual(run(rows, invalid), []);
  assert.match(
    opportunityFilterError({ ...invalid, deadlineFrom: "2026-02-30" }),
    /valid dates/,
  );
});

test("deadline today follows workspace midnight including a daylight-saving boundary", () => {
  const rows = [
    opp("oct24", { deadline: "2026-10-24" }),
    opp("oct25", { deadline: "2026-10-25" }),
  ];
  const at = new Date("2026-10-24T23:30:00Z");
  assert.deepEqual(
    run(rows, { deadline: "today" }, new Set(), "Europe/London", at),
    ["oct25"],
  );
  assert.deepEqual(
    run(rows, { deadline: "today" }, new Set(), "America/New_York", at),
    ["oct24"],
  );
});

test("overdue opportunities cover next actions, unfinished follow-ups, pending offers and linked tasks without duplicates or closed records", () => {
  const activity = {
    id: "a",
    kind: "communication",
    status: "completed",
    title: "Recruiter call",
    createdAt: "2026-10-20",
    followUp: "Send availability",
    followUpDate: "2026-10-28",
  };
  const offer = {
    id: "offer",
    title: "Initial offer",
    decision: "pending",
    responseDueDate: "2026-10-28",
    createdAt: "2026-10-20",
  };
  const rows = [
    opp("next", { nextAction: "Call recruiter", nextActionDate: "2026-10-28" }),
    opp("follow", { activities: [activity, { ...activity, id: "a2" }] }),
    opp("offer", { offers: [offer] }),
    opp("task"),
    opp("today", { nextAction: "Call", nextActionDate: today }),
    opp("empty", { nextActionDate: "2026-10-28" }),
    opp("done", { activities: [{ ...activity, followUpDone: true }] }),
    opp("cancelled", { activities: [{ ...activity, status: "cancelled" }] }),
    opp("accepted", { offers: [{ ...offer, decision: "accepted" }] }),
    opp("invalid", { nextAction: "Call", nextActionDate: "2026-02-30" }),
    opp("legacy", { nextAction: undefined }),
    opp("closed", {
      outcome: "rejected",
      nextAction: "Call",
      nextActionDate: "2026-10-28",
      activities: [activity],
      offers: [offer],
    }),
  ];
  const tasks = [
    task("linked", "task"),
    task("duplicate", "follow"),
    task("unlinked", ""),
    task("orphan", "missing"),
    task("closed", "closed"),
    task("completed", "today", { completed: true }),
    task("future", "today", { dueDate: "2026-11-02" }),
  ];
  const ids = overdueOpportunityIds(rows, tasks, today);
  assert.deepEqual([...ids].sort(), ["follow", "next", "offer", "task"]);
  assert.deepEqual(run(rows, { outcome: "all", overdueOnly: true }, ids), [
    "next",
    "follow",
    "offer",
    "task",
  ]);
  assert.deepEqual(
    run(rows, { overdueOnly: true, stage: "interviews" }, ids),
    [],
  );
  assert.deepEqual(overdueOpportunityIds([], [], today), new Set());
});
