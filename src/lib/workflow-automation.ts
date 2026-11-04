/**
 * Workflow Automation and Daily Target Engine
 */

import type { Opportunity, StageId } from "../types";
import { calendarDay, offsetDay, validDay } from "./dashboard.ts";

export const STAGE_ORDER: Record<StageId, number> = {
  identification: 1,
  review: 2,
  documents: 3,
  "application-review": 4,
  submitted: 5,
  interviews: 6,
  "final-interview": 7,
  outcome: 8,
};

/**
 * Returns true if the targetStage is ahead in the pipeline than currentStage,
 * and neither stage is 'outcome'. Auto-advance never moves a stage backwards
 * and never modifies an outcome/closed opportunity.
 */
export function canAutoAdvance(
  currentStage: StageId | string,
  targetStage: StageId | string,
): boolean {
  if (currentStage === "outcome" || targetStage === "outcome") return false;
  const currentRank = STAGE_ORDER[currentStage as StageId] || 0;
  const targetRank = STAGE_ORDER[targetStage as StageId] || 0;
  return targetRank > currentRank;
}

export type NextActionPlan = {
  nextAction: string;
  nextActionDate: string;
  taskTitle?: string;
};

/**
 * Computes suggested next action and scheduled due date based on the target stage.
 */
export function computeNextActionForStage(
  stage: StageId | string,
  options: {
    today: string;
    followUpDays?: number;
    scheduledDate?: string;
    role?: string;
    company?: string;
  },
): NextActionPlan {
  const { today, followUpDays = 7, scheduledDate, role, company } = options;
  const rolePrefix = role && company ? ` for ${role} at ${company}` : "";

  switch (stage) {
    case "identification":
      return {
        nextAction: "Review job requirements & fit",
        nextActionDate: today,
        taskTitle: `Review job requirements & fit${rolePrefix}`,
      };
    case "review":
      return {
        nextAction: "Complete fit assessment",
        nextActionDate: today,
        taskTitle: `Complete fit assessment${rolePrefix}`,
      };
    case "documents":
      return {
        nextAction: "Tailor CV and cover letter",
        nextActionDate: offsetDay(today, 1) || today,
        taskTitle: `Tailor CV and cover letter${rolePrefix}`,
      };
    case "application-review":
      return {
        nextAction: "Review application pack before sending",
        nextActionDate: today,
        taskTitle: `Review application pack${rolePrefix}`,
      };
    case "submitted":
      return {
        nextAction: "Follow up on application",
        nextActionDate: offsetDay(today, Math.max(1, followUpDays)) || today,
        taskTitle: `Follow up on submitted application${rolePrefix}`,
      };
    case "interviews":
      return {
        nextAction: "Prepare interview talking points",
        nextActionDate: scheduledDate && validDay(scheduledDate)
          ? scheduledDate
          : offsetDay(today, 2) || today,
        taskTitle: `Prepare for interview${rolePrefix}`,
      };
    case "final-interview":
      return {
        nextAction: "Prepare final interview questions & talking points",
        nextActionDate: scheduledDate && validDay(scheduledDate)
          ? scheduledDate
          : offsetDay(today, 1) || today,
        taskTitle: `Prepare for final interview${rolePrefix}`,
      };
    case "outcome":
    default:
      return {
        nextAction: "",
        nextActionDate: "",
      };
  }
}

export type DailyTargetProgress = {
  todayCount: number;
  target: number;
  percentage: number;
  streakDays: number;
  metToday: boolean;
  submittedOpportunityIds: string[];
};

/**
 * Calculates candidate daily application target progress and streak.
 */
export function calculateDailyProgress(
  opportunities: Opportunity[],
  dailyTarget: number = 3,
  timezone: string = "Europe/London",
  at: Date = new Date(),
): DailyTargetProgress {
  const target = Math.max(1, Math.min(50, dailyTarget));
  const today = calendarDay(at, timezone);

  // Group submitted opportunity IDs by the calendar day of their submission
  const submissionsByDay = new Map<string, Set<string>>();

  for (const opp of opportunities) {
    const datesFound = new Set<string>();

    // 1. Check all events for submitted stage
    if (opp.events && opp.events.length > 0) {
      for (const event of opp.events) {
        if (event.stage === "submitted" && event.effectiveAt) {
          const day = calendarDay(event.effectiveAt, timezone);
          if (day && validDay(day)) datesFound.add(day);
        }
      }
    }

    // 2. Fallback: if currently in submitted stage and has stageEnteredAt
    if (opp.stage === "submitted") {
      const enterDay = calendarDay(opp.stageEnteredAt || opp.createdAt, timezone);
      if (enterDay && validDay(enterDay)) datesFound.add(enterDay);
    }

    for (const day of datesFound) {
      const set = submissionsByDay.get(day) || new Set<string>();
      set.add(opp.id);
      submissionsByDay.set(day, set);
    }
  }

  const todaySet = submissionsByDay.get(today) || new Set<string>();
  const todayCount = todaySet.size;
  const percentage = Math.min(100, Math.round((todayCount / target) * 100));
  const metToday = todayCount >= target;

  // Streak calculation:
  // If met today: count 1 (today) + consecutive previous days
  // If not met today: count consecutive previous days starting from yesterday (streak is preserved through end of today)
  let streakDays = 0;
  let checkOffset = metToday ? 0 : -1;

  while (true) {
    const checkDay = offsetDay(today, checkOffset);
    if (!checkDay) break;
    const count = submissionsByDay.get(checkDay)?.size || 0;
    if (count >= target) {
      streakDays++;
      checkOffset--;
    } else {
      break;
    }
  }

  return {
    todayCount,
    target,
    percentage,
    streakDays,
    metToday,
    submittedOpportunityIds: [...todaySet],
  };
}
