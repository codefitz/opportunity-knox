import test from "node:test";
import assert from "node:assert/strict";
import {
  canAutoAdvance,
  computeNextActionForStage,
  STAGE_ORDER,
  calendarDay,
  offsetDay,
} from "../server/workflow-automation.mjs";
import { calculateDailyProgress } from "../src/lib/workflow-automation.ts";

test("canAutoAdvance only permits forward movement and blocks outcome stages", () => {
  assert.equal(canAutoAdvance("identification", "review"), true);
  assert.equal(canAutoAdvance("identification", "documents"), true);
  assert.equal(canAutoAdvance("identification", "submitted"), true);
  assert.equal(canAutoAdvance("documents", "application-review"), true);
  assert.equal(canAutoAdvance("submitted", "interviews"), true);

  // Backward movement blocked
  assert.equal(canAutoAdvance("submitted", "documents"), false);
  assert.equal(canAutoAdvance("interviews", "identification"), false);
  assert.equal(canAutoAdvance("review", "identification"), false);

  // Same stage blocked
  assert.equal(canAutoAdvance("review", "review"), false);

  // Outcome stages blocked from auto-advance
  assert.equal(canAutoAdvance("interviews", "outcome"), false);
  assert.equal(canAutoAdvance("outcome", "interviews"), false);
});

test("computeNextActionForStage computes intelligent next actions and dates", () => {
  const today = "2026-11-04";

  // Identification
  const idPlan = computeNextActionForStage("identification", {
    today,
    role: "Staff Engineer",
    company: "Acme",
  });
  assert.equal(idPlan.nextAction, "Review job requirements & fit");
  assert.equal(idPlan.nextActionDate, "2026-11-04");
  assert.match(idPlan.taskTitle, /Staff Engineer at Acme/);

  // Documents
  const docPlan = computeNextActionForStage("documents", { today });
  assert.equal(docPlan.nextAction, "Tailor CV and cover letter");
  assert.equal(docPlan.nextActionDate, "2026-11-05");

  // Submitted (default 7 days)
  const subPlan = computeNextActionForStage("submitted", { today, followUpDays: 7 });
  assert.equal(subPlan.nextAction, "Follow up on application");
  assert.equal(subPlan.nextActionDate, "2026-11-11");

  // Interviews with scheduled date
  const intPlan = computeNextActionForStage("interviews", {
    today,
    scheduledDate: "2026-11-09",
  });
  assert.equal(intPlan.nextAction, "Prepare interview talking points");
  assert.equal(intPlan.nextActionDate, "2026-11-09");

  // Outcome clears next action
  const outPlan = computeNextActionForStage("outcome", { today });
  assert.equal(outPlan.nextAction, "");
  assert.equal(outPlan.nextActionDate, "");
});

test("calculateDailyProgress calculates submissions, percentages, and streaks", () => {
  const at = new Date("2026-11-04T12:00:00Z");
  const timezone = "Europe/London";

  const opportunities = [
    // Today submissions
    {
      id: "opp-1",
      stage: "submitted",
      events: [{ stage: "submitted", effectiveAt: "2026-11-04T09:00:00Z" }],
    },
    {
      id: "opp-2",
      stage: "submitted",
      events: [{ stage: "submitted", effectiveAt: "2026-11-04T10:00:00Z" }],
    },
    // Yesterday submissions (target met: 2)
    {
      id: "opp-3",
      stage: "submitted",
      events: [{ stage: "submitted", effectiveAt: "2026-11-03T11:00:00Z" }],
    },
    {
      id: "opp-4",
      stage: "interviews",
      events: [{ stage: "submitted", effectiveAt: "2026-11-03T14:00:00Z" }],
    },
    // 2 days ago submissions (target met: 2)
    {
      id: "opp-5",
      stage: "submitted",
      events: [{ stage: "submitted", effectiveAt: "2026-11-02T15:00:00Z" }],
    },
    {
      id: "opp-6",
      stage: "submitted",
      events: [{ stage: "submitted", effectiveAt: "2026-11-02T16:00:00Z" }],
    },
  ];

  // Target = 2
  const progressTarget2 = calculateDailyProgress(opportunities, 2, timezone, at);
  assert.equal(progressTarget2.todayCount, 2);
  assert.equal(progressTarget2.target, 2);
  assert.equal(progressTarget2.percentage, 100);
  assert.equal(progressTarget2.metToday, true);
  // Met today (2), yesterday (2), 2 days ago (2) -> streak = 3
  assert.equal(progressTarget2.streakDays, 3);

  // Target = 3 (Today only has 2, so not met today, but yesterday met? Yesterday only had 2 so streak = 0)
  const progressTarget3 = calculateDailyProgress(opportunities, 3, timezone, at);
  assert.equal(progressTarget3.todayCount, 2);
  assert.equal(progressTarget3.target, 3);
  assert.equal(progressTarget3.percentage, 67);
  assert.equal(progressTarget3.metToday, false);
  assert.equal(progressTarget3.streakDays, 0);
});
