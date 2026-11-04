/**
 * Server-side Workflow Automation and Milestone Advancement Engine
 */

export const STAGE_ORDER = {
  identification: 1,
  review: 2,
  documents: 3,
  "application-review": 4,
  submitted: 5,
  interviews: 6,
  "final-interview": 7,
  outcome: 8,
};

export function validDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

export function calendarDay(value, timezone = "Europe/London") {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return validDay(value) ? value : "";
  }
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.valueOf())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (name) => parts.find((item) => item.type === name)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function offsetDay(day, offset) {
  if (!validDay(day)) return "";
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function canAutoAdvance(currentStage, targetStage) {
  if (currentStage === "outcome" || targetStage === "outcome") return false;
  const currentRank = STAGE_ORDER[currentStage] || 0;
  const targetRank = STAGE_ORDER[targetStage] || 0;
  return targetRank > currentRank;
}

export function computeNextActionForStage(stage, options = {}) {
  const {
    today = new Date().toISOString().slice(0, 10),
    followUpDays = 7,
    scheduledDate,
    role,
    company,
  } = options;
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
