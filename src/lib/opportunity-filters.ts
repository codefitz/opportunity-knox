import type { Opportunity, Task, StageId } from "../types";
import {
  buildActionQueue,
  calendarDay,
  offsetDay,
  validDay,
} from "./dashboard.ts";
export type OpportunityFilters = {
  search: string;
  outcome: string;
  stage: StageId | "";
  tags: string[];
  tagMatch: "all" | "any";
  deadline:
    | "any"
    | "overdue"
    | "today"
    | "next7"
    | "next30"
    | "dated"
    | "none"
    | "range";
  deadlineFrom: string;
  deadlineTo: string;
  overdueOnly: boolean;
};
export const defaultOpportunityFilters: OpportunityFilters = {
  search: "",
  outcome: "active",
  stage: "",
  tags: [],
  tagMatch: "all",
  deadline: "any",
  deadlineFrom: "",
  deadlineTo: "",
  overdueOnly: false,
};
export const tagKey = (tag: string) => tag.trim().toLowerCase();
export function opportunityTags(opportunities: Opportunity[]) {
  const tags = new Map<string, { id: string; label: string; count: number }>();
  for (const o of opportunities) {
    const seen = new Set<string>();
    for (const tag of o.tags || []) {
      const id = tagKey(tag);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const existing = tags.get(id);
      if (existing) existing.count++;
      else tags.set(id, { id, label: tag.trim(), count: 1 });
    }
  }
  return [...tags.values()].sort((a, b) => a.label.localeCompare(b.label));
}
/** Include overdue work attached to active opportunities, beyond the single overview next action. */
export function overdueOpportunityIds(
  opportunities: Opportunity[],
  tasks: Task[],
  day: string,
) {
  const active = new Set(
    opportunities.filter((o) => !o.outcome).map((o) => o.id),
  );
  return new Set(
    buildActionQueue(tasks, opportunities)
      .filter(
        (a) =>
          active.has(a.opportunityId) && validDay(a.dueDate) && a.dueDate < day,
      )
      .map((a) => a.opportunityId),
  );
}
export function opportunityFilterError(filters: OpportunityFilters) {
  if (filters.deadline !== "range") return "";
  if (
    (filters.deadlineFrom && !validDay(filters.deadlineFrom)) ||
    (filters.deadlineTo && !validDay(filters.deadlineTo))
  )
    return "Choose valid dates for the deadline range.";
  return filters.deadlineFrom &&
    filters.deadlineTo &&
    filters.deadlineFrom > filters.deadlineTo
    ? "The deadline start date must be on or before the end date."
    : "";
}
export function filterOpportunities(
  opportunities: Opportunity[],
  filters: OpportunityFilters,
  overdue: Set<string>,
  timezone: string,
  now = new Date(),
) {
  if (opportunityFilterError(filters)) return [];
  const day = calendarDay(now, timezone),
    search = filters.search.trim().toLowerCase();
  return opportunities.filter((o) => {
    if (filters.outcome === "active" && o.outcome) return false;
    if (filters.outcome === "completed" && !o.outcome) return false;
    if (
      !["all", "active", "completed"].includes(filters.outcome) &&
      o.outcome !== filters.outcome
    )
      return false;
    if (filters.stage && o.stage !== filters.stage) return false;
    if (
      search &&
      ![o.company, o.role, o.location, ...(o.tags || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search)
    )
      return false;
    const tags = new Set((o.tags || []).map(tagKey));
    if (
      filters.tags.length &&
      !(filters.tagMatch === "all"
        ? filters.tags.every((t) => tags.has(tagKey(t)))
        : filters.tags.some((t) => tags.has(tagKey(t))))
    )
      return false;
    if (filters.overdueOnly && !overdue.has(o.id)) return false;
    const deadline = validDay(o.deadline) ? o.deadline : "";
    switch (filters.deadline) {
      case "any":
        return true;
      case "none":
        return !deadline;
      case "dated":
        return !!deadline;
      case "overdue":
        return !!deadline && deadline < day;
      case "today":
        return deadline === day;
      case "next7":
        return !!deadline && deadline >= day && deadline <= offsetDay(day, 6);
      case "next30":
        return !!deadline && deadline >= day && deadline <= offsetDay(day, 29);
      case "range":
        return (
          !!deadline &&
          (!filters.deadlineFrom || deadline >= filters.deadlineFrom) &&
          (!filters.deadlineTo || deadline <= filters.deadlineTo)
        );
    }
  });
}
