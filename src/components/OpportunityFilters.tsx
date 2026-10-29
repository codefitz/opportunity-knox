import { Search, ChevronDown, X } from "lucide-react";
import { STAGES, OUTCOMES, type Opportunity } from "../types";
import {
  defaultOpportunityFilters,
  opportunityTags,
  opportunityFilterError,
  type OpportunityFilters,
} from "../lib/opportunity-filters";
const deadlineLabels = {
  any: "Any deadline",
  overdue: "Deadline passed",
  today: "Due today",
  next7: "Next 7 days",
  next30: "Next 30 days",
  dated: "Has a deadline",
  none: "No recorded deadline",
  range: "Custom date range",
};
export default function OpportunityFiltersToolbar({
  value,
  onChange,
  opportunities,
  resultCount,
  board,
  timezone,
}: {
  value: OpportunityFilters;
  onChange: (value: OpportunityFilters) => void;
  opportunities: Opportunity[];
  resultCount: number;
  board: boolean;
  timezone: string;
}) {
  const tags = opportunityTags(opportunities),
    error = opportunityFilterError(value);
  const set = <K extends keyof OpportunityFilters>(
    key: K,
    next: OpportunityFilters[K],
  ) => onChange({ ...value, [key]: next });
  const changed = !!(
    value.search ||
    value.outcome !== "active" ||
    value.stage ||
    value.tags.length ||
    value.deadline !== "any" ||
    value.overdueOnly
  );
  function chip(label: string, remove: () => void) {
    return (
      <button
        type="button"
        className="opportunity-filter-chip"
        aria-label={`Remove filter: ${label}`}
        onClick={remove}
      >
        {label}
        <X size={12} aria-hidden="true" />
      </button>
    );
  }
  return (
    <section
      className="opportunity-filter-panel"
      aria-label="Opportunity filters"
    >
      <div className="board-toolbar">
        <span className="view-caption">
          {board ? "PIPELINE VIEW" : "OPPORTUNITY REGISTER"}
        </span>
        <div className="toolbar-right">
          <div className="search-input">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Search opportunities"
              placeholder="Search company, role, location or tags…"
              value={value.search}
              onChange={(e) => set("search", e.target.value)}
            />
          </div>
          <label className="filter-select">
            <span className="sr-only">Filter by outcome</span>
            <select
              value={value.outcome}
              onChange={(e) => set("outcome", e.target.value)}
            >
              <option value="active">Active opportunities</option>
              <option value="completed">Completed</option>
              <option value="all">All opportunities</option>
              {OUTCOMES.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
        </div>
      </div>
      <div className="opportunity-filter-controls">
        <label className="opportunity-filter-field">
          <span>Stage</span>
          <select
            aria-label="Filter by stage"
            value={value.stage}
            onChange={(e) =>
              set("stage", e.target.value as OpportunityFilters["stage"])
            }
          >
            <option value="">All stages</option>
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="opportunity-tag-control">
          <span>Tags</span>
          <details className="opportunity-tag-picker">
            <summary>
              Tags{value.tags.length ? ` (${value.tags.length})` : " · All"}
              <ChevronDown size={14} aria-hidden="true" />
            </summary>
            <div className="opportunity-tag-options">
              <p>Select one or more tags.</p>
              {tags.length ? (
                tags.map((tag) => (
                  <label className="check-field" key={tag.id}>
                    <input
                      type="checkbox"
                      checked={value.tags.includes(tag.id)}
                      onChange={(e) =>
                        set(
                          "tags",
                          e.target.checked
                            ? [...value.tags, tag.id]
                            : value.tags.filter((t) => t !== tag.id),
                        )
                      }
                    />
                    <span>
                      {tag.label} <small>({tag.count})</small>
                    </span>
                  </label>
                ))
              ) : (
                <p>No tags recorded yet.</p>
              )}
              {!!value.tags.length && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    onChange({ ...value, tags: [], tagMatch: "all" })
                  }
                >
                  Clear selected tags
                </button>
              )}
            </div>
          </details>
        </div>
        {value.tags.length > 1 && (
          <label className="opportunity-filter-field">
            <span>Tag matching</span>
            <select
              aria-label="Tag matching"
              value={value.tagMatch}
              onChange={(e) => set("tagMatch", e.target.value as "all" | "any")}
            >
              <option value="all">All selected tags</option>
              <option value="any">Any selected tag</option>
            </select>
          </label>
        )}
        <label className="opportunity-filter-field">
          <span>Application deadline</span>
          <select
            aria-label="Filter application deadline"
            value={value.deadline}
            onChange={(e) =>
              set("deadline", e.target.value as OpportunityFilters["deadline"])
            }
          >
            {Object.entries(deadlineLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="check-field opportunity-overdue-toggle">
          <input
            type="checkbox"
            checked={value.overdueOnly}
            onChange={(e) => set("overdueOnly", e.target.checked)}
          />
          Overdue actions only
        </label>
        <button
          className="button secondary small"
          type="button"
          disabled={!changed}
          onClick={() => onChange({ ...defaultOpportunityFilters, tags: [] })}
        >
          Reset filters
        </button>
      </div>
      {value.deadline === "range" && (
        <div className="opportunity-deadline-range">
          <label className="opportunity-filter-field">
            <span>Deadline from</span>
            <input
              aria-label="Deadline from"
              type="date"
              value={value.deadlineFrom}
              aria-invalid={!!error}
              aria-describedby={error ? "opportunity-filter-error" : undefined}
              onChange={(e) => set("deadlineFrom", e.target.value)}
            />
          </label>
          <label className="opportunity-filter-field">
            <span>Deadline to</span>
            <input
              aria-label="Deadline to"
              type="date"
              value={value.deadlineTo}
              aria-invalid={!!error}
              aria-describedby={error ? "opportunity-filter-error" : undefined}
              onChange={(e) => set("deadlineTo", e.target.value)}
            />
          </label>
          <p>
            Both ends are inclusive; leave either blank for an open range. With
            both blank, all recorded deadlines match.
          </p>
        </div>
      )}
      {error && (
        <p className="alert error" role="alert" id="opportunity-filter-error">
          {error}
        </p>
      )}
      <div
        className="opportunity-filter-chips"
        aria-label="Selected opportunity filters"
      >
        {value.search &&
          chip(`Search: ${value.search}`, () => set("search", ""))}
        {value.outcome !== "active" &&
          chip(
            `Outcome: ${value.outcome === "all" ? "All" : value.outcome === "completed" ? "Completed" : OUTCOMES.find((o) => o.id === value.outcome)?.label || value.outcome}`,
            () => set("outcome", "active"),
          )}
        {value.stage &&
          chip(
            `Stage: ${STAGES.find((s) => s.id === value.stage)?.label}`,
            () => set("stage", ""),
          )}
        {value.tags.map((id) => (
          <span key={id}>
            {chip(`Tag: ${tags.find((t) => t.id === id)?.label || id}`, () =>
              set(
                "tags",
                value.tags.filter((t) => t !== id),
              ),
            )}
          </span>
        ))}
        {value.deadline !== "any" &&
          chip(
            `Deadline: ${deadlineLabels[value.deadline]}${value.deadline === "range" ? ` (${value.deadlineFrom || "any start"} – ${value.deadlineTo || "any end"})` : ""}`,
            () =>
              onChange({
                ...value,
                deadline: "any",
                deadlineFrom: "",
                deadlineTo: "",
              }),
          )}
        {value.overdueOnly &&
          chip("Overdue actions", () => set("overdueOnly", false))}
      </div>
      <p className="opportunity-filter-count" role="status" aria-live="polite">
        Showing <strong>{resultCount}</strong> of {opportunities.length}{" "}
        opportunities. Workspace totals above are unfiltered.
      </p>
      <p className="opportunity-filter-hint">
        Dates use {timezone}; the next 7/30 days include today. Overdue means
        before today and includes next actions, follow-ups, pending offer
        responses and linked open to-dos on active opportunities. Reset returns
        to active opportunities.
      </p>
      {opportunities.length > 0 && resultCount === 0 && !error && (
        <div className="opportunity-no-match">
          <strong>No matching opportunities.</strong>
          <span>Try changing a filter or reset to the active view.</span>
        </div>
      )}
    </section>
  );
}
