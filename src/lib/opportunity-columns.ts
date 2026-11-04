import { STAGES, type Opportunity } from "../types.ts";

export type ColumnId =
  | "opportunity"
  | "company"
  | "stage"
  | "workMode"
  | "salary"
  | "location"
  | "deadline"
  | "datePosted"
  | "applicantCount"
  | "priority"
  | "nextAction"
  | "applicationRoute";

export type ColumnDef = {
  id: ColumnId;
  label: string;
  required?: boolean;
  defaultVisible: boolean;
};

export const AVAILABLE_COLUMNS: ColumnDef[] = [
  { id: "opportunity", label: "Role & Employer", required: true, defaultVisible: true },
  { id: "company", label: "Company", defaultVisible: false },
  { id: "stage", label: "Stage & Outcome", defaultVisible: true },
  { id: "workMode", label: "Working arrangement", defaultVisible: true },
  { id: "salary", label: "Salary / Rate", defaultVisible: true },
  { id: "deadline", label: "Closing date", defaultVisible: true },
  { id: "priority", label: "Priority", defaultVisible: true },
  { id: "nextAction", label: "Next action", defaultVisible: true },
  { id: "location", label: "Location", defaultVisible: false },
  { id: "datePosted", label: "Date posted", defaultVisible: false },
  { id: "applicantCount", label: "Applicants", defaultVisible: false },
  { id: "applicationRoute", label: "Application route", defaultVisible: false },
];

export const DEFAULT_VISIBLE_COLUMNS: ColumnId[] = AVAILABLE_COLUMNS
  .filter((c) => c.defaultVisible)
  .map((c) => c.id);

const STORAGE_KEY_COLUMNS = "knox_opportunity_columns";
const STORAGE_KEY_SORT = "knox_opportunity_sort";

export function loadSavedColumns(): ColumnId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_COLUMNS);
    if (!raw) return DEFAULT_VISIBLE_COLUMNS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const valid = parsed.filter((id): id is ColumnId =>
        AVAILABLE_COLUMNS.some((col) => col.id === id),
      );
      if (!valid.includes("opportunity")) valid.unshift("opportunity");
      return valid;
    }
  } catch {}
  return DEFAULT_VISIBLE_COLUMNS;
}

export function saveColumns(columns: ColumnId[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_COLUMNS, JSON.stringify(columns));
  } catch {}
}

export type SortDirection = "asc" | "desc";
export type SortConfig = {
  column: ColumnId;
  direction: SortDirection;
};

export function loadSavedSort(): SortConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SORT);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.column === "string" &&
        (parsed.direction === "asc" || parsed.direction === "desc")
      ) {
        return parsed;
      }
    }
  } catch {}
  return { column: "opportunity", direction: "asc" };
}

export function saveSort(sort: SortConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY_SORT, JSON.stringify(sort));
  } catch {}
}

const PRIORITY_ORDER: Record<string, number> = {
  high: 3,
  normal: 2,
  low: 1,
};

const STAGE_ORDER: Record<string, number> = Object.fromEntries(
  STAGES.map((s, idx) => [s.id, idx]),
);

export function sortOpportunities(
  opportunities: Opportunity[],
  sort: SortConfig,
): Opportunity[] {
  const { column, direction } = sort;
  const factor = direction === "asc" ? 1 : -1;

  return [...opportunities].sort((a, b) => {
    switch (column) {
      case "opportunity": {
        const roleA = (a.role || "").toLowerCase();
        const roleB = (b.role || "").toLowerCase();
        if (roleA !== roleB) return roleA.localeCompare(roleB) * factor;
        return (a.company || "").toLowerCase().localeCompare((b.company || "").toLowerCase()) * factor;
      }
      case "company":
        return (a.company || "").toLowerCase().localeCompare((b.company || "").toLowerCase()) * factor;
      case "stage": {
        const orderA = STAGE_ORDER[a.stage] ?? 99;
        const orderB = STAGE_ORDER[b.stage] ?? 99;
        if (orderA !== orderB) return (orderA - orderB) * factor;
        return (a.outcome || "").localeCompare(b.outcome || "") * factor;
      }
      case "workMode":
        return (a.workMode || "").toLowerCase().localeCompare((b.workMode || "").toLowerCase()) * factor;
      case "salary":
        return (a.salary || "").toLowerCase().localeCompare((b.salary || "").toLowerCase()) * factor;
      case "location":
        return (a.location || "").toLowerCase().localeCompare((b.location || "").toLowerCase()) * factor;
      case "deadline": {
        const dA = a.deadline || (direction === "asc" ? "9999-99-99" : "0000-00-00");
        const dB = b.deadline || (direction === "asc" ? "9999-99-99" : "0000-00-00");
        return dA.localeCompare(dB) * factor;
      }
      case "datePosted": {
        const pA = a.datePosted || (direction === "asc" ? "0000-00-00" : "9999-99-99");
        const pB = b.datePosted || (direction === "asc" ? "0000-00-00" : "9999-99-99");
        return pA.localeCompare(pB) * factor;
      }
      case "applicantCount":
        return (a.applicantCount || "").localeCompare(b.applicantCount || "") * factor;
      case "priority": {
        const pA = PRIORITY_ORDER[a.priority] || 2;
        const pB = PRIORITY_ORDER[b.priority] || 2;
        return (pA - pB) * factor;
      }
      case "nextAction": {
        const nA = a.nextActionDate || a.nextAction || "";
        const nB = b.nextActionDate || b.nextAction || "";
        return nA.localeCompare(nB) * factor;
      }
      case "applicationRoute":
        return (a.applicationRoute || "").localeCompare(b.applicationRoute || "") * factor;
      default:
        return 0;
    }
  });
}
