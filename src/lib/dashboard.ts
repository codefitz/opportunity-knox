import type { Activity, Opportunity, StageId, Task } from "../types";

export const PIPELINE_STAGES: { id: StageId; label: string }[] = [
  { id: "identification", label: "Identification" },
  { id: "review", label: "Fit review" },
  { id: "documents", label: "CV & cover letter" },
  { id: "application-review", label: "Application review" },
  { id: "submitted", label: "Submitted" },
  { id: "interviews", label: "Interviews & comms" },
  { id: "final-interview", label: "Final interview" },
  { id: "outcome", label: "Outcome" },
];
export const OUTCOME_LABELS = [
  { id: "hired", label: "Hired" },
  { id: "rejected", label: "Rejected" },
  { id: "ignored", label: "Ignored" },
  { id: "withdrawn", label: "Withdrawn" },
  { id: "closed", label: "Role closed" },
];

export function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

/** Preserve date-only values; convert actual timestamps to the workspace's calendar. */
export function calendarDay(value: string | Date, timezone: string): string {
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
  const part = (name: string) =>
    parts.find((item) => item.type === name)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function offsetDay(day: string, offset: number): string {
  if (!validDay(day)) return "";
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function dayDifference(day: string, today: string): number | null {
  if (!validDay(day) || !validDay(today)) return null;
  return Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
}

/** First saved Submitted entry, in recording order; later notes/revisits cannot count twice. */
export function firstSubmission(opportunity: Opportunity): string {
  const event = opportunity.events?.find((item) => item.stage === "submitted");
  return event?.effectiveAt && Number.isFinite(Date.parse(event.effectiveAt))
    ? event.effectiveAt
    : "";
}

export type ActionItem = {
  id: string;
  source: "task" | "opportunity" | "activity" | "offer";
  title: string;
  dueDate: string;
  opportunityId: string;
  opportunityLabel: string;
  createdAt: string;
  task?: Task;
};

export function compareDueDates(
  a: { dueDate: string; title: string; id: string },
  b: { dueDate: string; title: string; id: string },
): number {
  const aDate = validDay(a.dueDate) ? a.dueDate : "";
  const bDate = validDay(b.dueDate) ? b.dueDate : "";
  if (aDate !== bDate)
    return aDate ? (bDate ? aDate.localeCompare(bDate) : -1) : 1;
  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(compareDueDates);
}

export function buildActionQueue(
  tasks: Task[],
  opportunities: Opportunity[],
  includeOpportunityActions = true,
): ActionItem[] {
  const byId = new Map(opportunities.map((item) => [item.id, item]));
  const rows: ActionItem[] = tasks
    .filter((task) => !task.completed)
    .map((task) => {
      const opportunity = byId.get(task.opportunityId);
      return {
        id: `task:${task.id}`,
        source: "task",
        title: task.title,
        dueDate: task.dueDate,
        opportunityId: task.opportunityId,
        opportunityLabel: opportunity
          ? `${opportunity.company} · ${opportunity.role}`
          : "",
        createdAt: task.createdAt,
        task,
      };
    });
  if (includeOpportunityActions) {
    for (const opportunity of opportunities) {
      if (!opportunity.outcome)
        for (const offer of opportunity.offers || []) {
          if (offer.decision !== "pending" || !offer.responseDueDate) continue;
          rows.push({
            id: `offer:${opportunity.id}:${offer.id}`,
            source: "offer",
            title: `Respond to offer: ${offer.title}`,
            dueDate: offer.responseDueDate,
            opportunityId: opportunity.id,
            opportunityLabel: `${opportunity.company} · ${opportunity.role}`,
            createdAt: offer.createdAt,
          });
        }
      if (!opportunity.outcome)
        for (const activity of opportunity.activities || []) {
          if (
            !activity.followUp?.trim() ||
            activity.followUpDone ||
            activity.status === "cancelled"
          )
            continue;
          rows.push({
            id: `activity:${opportunity.id}:${activity.id}`,
            source: "activity",
            title: activity.followUp,
            dueDate: activity.followUpDate || "",
            opportunityId: opportunity.id,
            opportunityLabel: `${opportunity.company} · ${opportunity.role} · ${activity.title}`,
            createdAt: activity.createdAt,
          });
        }
      if (opportunity.outcome || !(opportunity.nextAction || "").trim())
        continue;
      rows.push({
        id: `opportunity:${opportunity.id}`,
        source: "opportunity",
        title: opportunity.nextAction,
        dueDate: opportunity.nextActionDate,
        opportunityId: opportunity.id,
        opportunityLabel: `${opportunity.company} · ${opportunity.role}`,
        createdAt: opportunity.createdAt,
      });
    }
  }
  return rows.sort(compareDueDates);
}

export function plannedInterviews(opportunities: Opportunity[]) {
  const interviews: { opportunity: Opportunity; activity: Activity }[] = [];
  for (const opportunity of opportunities) {
    if (opportunity.outcome) continue;
    for (const activity of opportunity.activities || []) {
      if (
        activity.kind === "interview" &&
        ["planned", "rescheduled"].includes(activity.status)
      ) {
        interviews.push({ opportunity, activity });
      }
    }
  }
  return interviews.sort((a, b) => {
    const aDate =
      a.activity.scheduledAt &&
      Number.isFinite(Date.parse(a.activity.scheduledAt))
        ? a.activity.scheduledAt
        : "";
    const bDate =
      b.activity.scheduledAt &&
      Number.isFinite(Date.parse(b.activity.scheduledAt))
        ? b.activity.scheduledAt
        : "";
    if (aDate !== bDate)
      return aDate ? (bDate ? Date.parse(aDate) - Date.parse(bDate) : -1) : 1;
    return (
      a.activity.title.localeCompare(b.activity.title) ||
      a.activity.id.localeCompare(b.activity.id)
    );
  });
}

export function dashboardMetrics(
  opportunities: Opportunity[],
  tasks: Task[],
  timezone: string,
  now = new Date(),
) {
  const today = calendarDay(now, timezone);
  const pipeline = PIPELINE_STAGES.map((stage) => ({
    ...stage,
    count: opportunities.filter((item) => item.stage === stage.id).length,
  }));
  const outcomes = OUTCOME_LABELS.map((outcome) => ({
    ...outcome,
    count: opportunities.filter((item) => item.outcome === outcome.id).length,
  }));
  const hired = outcomes.find((item) => item.id === "hired")!.count;
  const rejected = outcomes.find((item) => item.id === "rejected")!.count;
  const submitted = opportunities.filter((item) => {
    const day = calendarDay(firstSubmission(item), timezone);
    return day && day <= today;
  });
  const openTasks = tasks.filter((task) => !task.completed);
  return {
    total: opportunities.length,
    active: opportunities.filter((item) => !item.outcome).length,
    submitted: submitted.length,
    submittedIds: submitted.map((item) => item.id),
    openTasks: openTasks.length,
    overdueTasks: openTasks.filter(
      (task) => validDay(task.dueDate) && task.dueDate < today,
    ).length,
    plannedInterviews: plannedInterviews(opportunities).length,
    closed: outcomes.reduce((sum, item) => sum + item.count, 0),
    hireShare: hired + rejected ? hired / (hired + rejected) : null,
    pipeline,
    outcomes,
  };
}

export type ActivityDay = {
  date: string;
  identified: number;
  submitted: number;
  identifiedIds: string[];
  submittedIds: string[];
};

/** Calendar days including today. Each opportunity can add one submission, ever. */
export function applicationActivity(
  opportunities: Opportunity[],
  days: 14 | 30 | 90,
  timezone: string,
  now = new Date(),
): ActivityDay[] {
  const today = calendarDay(now, timezone);
  const series: ActivityDay[] = Array.from({ length: days }, (_, index) => ({
    date: offsetDay(today, index - days + 1),
    identified: 0,
    submitted: 0,
    identifiedIds: [],
    submittedIds: [],
  }));
  const byDay = new Map(series.map((day) => [day.date, day]));
  for (const opportunity of opportunities) {
    const created = byDay.get(calendarDay(opportunity.createdAt, timezone));
    if (created) {
      created.identified++;
      created.identifiedIds.push(opportunity.id);
    }
    const submitted = byDay.get(
      calendarDay(firstSubmission(opportunity), timezone),
    );
    if (submitted) {
      submitted.submitted++;
      submitted.submittedIds.push(opportunity.id);
    }
  }
  return series;
}
