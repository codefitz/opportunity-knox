import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarDays,
  CheckSquare2,
  ChevronRight,
  FileCheck2,
  FolderOpen,
  Plus,
  RefreshCw,
} from "lucide-react";
import type { Opportunity, Profile, Task } from "../types";
import { formatDate } from "../api";
import {
  applicationActivity,
  buildActionQueue,
  calendarDay,
  dashboardMetrics,
  dayDifference,
  plannedInterviews,
} from "../lib/dashboard";
import "../dashboard.css";

type Props = {
  opportunities: Opportunity[];
  tasks: Task[];
  profile: Profile;
  timezone: string;
  referenceCount: number;
  onOpenOpportunity: (id: string) => void;
  onNavigate: (page: "board" | "todos" | "library") => void;
  onAddOpportunity: () => void;
  onRefresh: () => void;
  refreshing: boolean;
};
type Selection = { title: string; ids: string[]; definition: string } | null;
const outcomeColors = [
  "var(--green)",
  "var(--danger)",
  "var(--muted)",
  "var(--amber)",
  "color-mix(in srgb, var(--green) 40%, var(--muted))",
];

function activate(
  event: KeyboardEvent<SVGGElement | SVGCircleElement>,
  action: () => void,
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}
function shortDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
function Due({ date, today }: { date: string; today: string }) {
  const diff = dayDifference(date, today);
  return (
    <span
      className={`knox-due ${diff !== null && diff < 0 ? "is-overdue" : diff === 0 ? "is-today" : ""}`}
    >
      {diff === null
        ? "No date"
        : diff < 0
          ? `${Math.abs(diff)}d overdue`
          : diff === 0
            ? "Today"
            : diff === 1
              ? "Tomorrow"
              : shortDate(date)}
    </span>
  );
}

export default function Dashboard(props: Props) {
  const { opportunities, tasks, timezone, onOpenOpportunity, onNavigate } =
    props;
  const [period, setPeriod] = useState<14 | 30 | 90>(30);
  const [selection, setSelection] = useState<Selection>(null);
  const chartElement = useRef<SVGSVGElement>(null);
  const [chartWidth, setChartWidth] = useState(710);
  useEffect(() => {
    const element = chartElement.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setChartWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Every render uses the current workspace day; polling/refresh comes from the app.
  const today = calendarDay(new Date(), timezone);
  const metrics = useMemo(
    () => dashboardMetrics(opportunities, tasks, timezone),
    [opportunities, tasks, timezone, today],
  );
  const activity = useMemo(
    () => applicationActivity(opportunities, period, timezone),
    [opportunities, period, timezone, today],
  );
  const actions = useMemo(
    () => buildActionQueue(tasks, opportunities),
    [tasks, opportunities],
  );
  const interviews = useMemo(
    () => plannedInterviews(opportunities),
    [opportunities],
  );
  const maxActivity = Math.max(
    1,
    ...activity.map((day) => Math.max(day.identified, day.submitted)),
  );
  const activityTotal = activity.reduce(
    (sum, day) => sum + day.identified + day.submitted,
    0,
  );
  const maxPipeline = Math.max(
    1,
    ...metrics.pipeline.map((stage) => stage.count),
  );
  const selectedRecords = selection
    ? opportunities.filter((item) => selection.ids.includes(item.id))
    : [];
  const circumference = 2 * Math.PI * 54;
  let outcomeOffset = 0;
  const chart = {
    left: 35,
    top: 16,
    width: Math.max(180, chartWidth - 55),
    height: 142,
  };
  const groupWidth = chart.width / period;
  const barWidth = Math.max(1.1, Math.min(9, groupWidth * 0.3));
  const show = (title: string, ids: string[], definition: string) =>
    setSelection({ title, ids, definition });
  const activeRecords = opportunities.filter((item) => !item.outcome);

  return (
    <section className="knox-dashboard" aria-label="Statistics dashboard">
      <header className="knox-page-heading">
        <div>
          <p className="knox-eyebrow">WORKSPACE OVERVIEW</p>
          <h1>Your search, at a glance.</h1>
          <p>Every opportunity, next step and milestone in one place.</p>
        </div>
        <div className="knox-heading-actions">
          <button
            className="knox-button knox-button-quiet"
            onClick={props.onRefresh}
            disabled={props.refreshing}
            aria-label="Refresh dashboard"
          >
            <RefreshCw
              size={16}
              className={props.refreshing ? "knox-spin" : ""}
            />
            <span>Refresh</span>
          </button>
          <button
            className="knox-button knox-button-primary"
            onClick={props.onAddOpportunity}
          >
            <Plus size={17} />
            New opportunity
          </button>
        </div>
      </header>
      <div className="knox-dashboard-context">
        <span>
          <span className="knox-live-dot" />
          From your saved records
        </span>
        <span>
          {formatDate(today, timezone)} · {timezone.replaceAll("_", " ")}
        </span>
      </div>

      <div className="knox-metric-grid">
        <button
          className="knox-metric"
          onClick={() =>
            show(
              "Active opportunities",
              activeRecords.map((item) => item.id),
              "Opportunities with no final outcome recorded. These are current counts, across all dates.",
            )
          }
        >
          <div className="knox-metric-label">
            <span>Active opportunities</span>
            <BriefcaseBusiness size={17} />
          </div>
          <strong>{metrics.active}</strong>
          <span className="knox-metric-foot">
            {metrics.total} total in your workspace <ArrowUpRight size={14} />
          </span>
        </button>
        <button
          className="knox-metric"
          onClick={() =>
            show(
              "Recorded submissions",
              metrics.submittedIds,
              "Distinct opportunities with a saved Submitted-stage entry dated up to today. Revisited stages and notes count once; later stages alone do not establish submission.",
            )
          }
        >
          <div className="knox-metric-label">
            <span>Recorded submissions</span>
            <FileCheck2 size={17} />
          </div>
          <strong>{metrics.submitted}</strong>
          <span className="knox-metric-foot">
            First submitted entry, up to today <ArrowUpRight size={14} />
          </span>
        </button>
        <button className="knox-metric" onClick={() => onNavigate("todos")}>
          <div className="knox-metric-label">
            <span>Open tasks</span>
            <CheckSquare2 size={17} />
          </div>
          <strong>{metrics.openTasks}</strong>
          <span className="knox-metric-foot">
            {metrics.overdueTasks
              ? `${metrics.overdueTasks} past their due date`
              : "Your manually created to-dos"}
            <ArrowUpRight size={14} />
          </span>
        </button>
        <button
          className="knox-metric"
          onClick={() =>
            show(
              "Opportunities with planned interviews",
              [...new Set(interviews.map((item) => item.opportunity.id))],
              "Planned interview entries on active opportunities, including entries needing a date or an overdue status update. A role may have several interviews.",
            )
          }
        >
          <div className="knox-metric-label">
            <span>Interviews planned</span>
            <CalendarDays size={17} />
          </div>
          <strong>{metrics.plannedInterviews}</strong>
          <span className="knox-metric-foot">
            Across active opportunities <ArrowUpRight size={14} />
          </span>
        </button>
      </div>

      <div className="knox-dashboard-main">
        <section className="knox-panel knox-activity-panel">
          <div className="knox-panel-heading">
            <div>
              <h2>Application activity</h2>
              <p>New opportunities and first recorded submissions.</p>
            </div>
            <div className="knox-period" aria-label="Activity chart period">
              {([14, 30, 90] as const).map((days) => (
                <button
                  key={days}
                  aria-pressed={period === days}
                  onClick={() => {
                    setPeriod(days);
                    setSelection(null);
                  }}
                >
                  {days}d
                </button>
              ))}
            </div>
          </div>
          <div className="knox-chart-legend">
            <span>
              <i className="knox-legend-dot knox-series-new" />
              New opportunities
            </span>
            <span>
              <i className="knox-legend-dot knox-series-submitted" />
              Recorded submissions
            </span>
          </div>
          <svg
            className="knox-activity-chart"
            ref={chartElement}
            viewBox={`0 0 ${chartWidth} 195`}
            role="img"
            aria-label={`${period}-day activity chart: ${activity.reduce((sum, day) => sum + day.identified, 0)} new opportunities and ${activity.reduce((sum, day) => sum + day.submitted, 0)} first recorded submissions. Select a nonzero day to view its records.`}
          >
            {[...new Set([0, Math.ceil(maxActivity / 2), maxActivity])].map(
              (tick) => {
                const y =
                  chart.top +
                  chart.height -
                  (tick / maxActivity) * chart.height;
                return (
                  <g key={tick}>
                    <line
                      x1={chart.left}
                      x2={chart.left + chart.width}
                      y1={y}
                      y2={y}
                      className="knox-chart-grid"
                    />
                    <text
                      x={chart.left - 12}
                      y={y + 4}
                      textAnchor="end"
                      className="knox-chart-label"
                    >
                      {tick}
                    </text>
                  </g>
                );
              },
            )}
            {activity.map((day, index) => {
              const count = day.identified + day.submitted;
              const x = chart.left + index * groupWidth + groupWidth / 2;
              const open = () => {
                if (count)
                  show(
                    `Activity · ${formatDate(day.date, timezone)}`,
                    [...new Set([...day.identifiedIds, ...day.submittedIds])],
                    `${day.identified} newly identified and ${day.submitted} first recorded submissions on this workspace calendar day. A record may appear in both series.`,
                  );
              };
              return (
                <g
                  key={day.date}
                  role="button"
                  tabIndex={count ? 0 : -1}
                  aria-disabled={!count}
                  aria-label={`${shortDate(day.date)}: ${day.identified} new opportunities, ${day.submitted} submissions${count ? "; view opportunities" : ""}`}
                  onClick={open}
                  onKeyDown={(event) => activate(event, open)}
                  className={count ? "knox-chart-day" : ""}
                >
                  <title>{`${shortDate(day.date)}: ${day.identified} new · ${day.submitted} submitted`}</title>
                  <rect
                    x={x - barWidth - 0.7}
                    y={
                      chart.top +
                      chart.height -
                      (day.identified / maxActivity) * chart.height
                    }
                    width={barWidth}
                    height={(day.identified / maxActivity) * chart.height}
                    rx={1.8}
                    className="knox-bar-new"
                  />
                  <rect
                    x={x + 0.7}
                    y={
                      chart.top +
                      chart.height -
                      (day.submitted / maxActivity) * chart.height
                    }
                    width={barWidth}
                    height={(day.submitted / maxActivity) * chart.height}
                    rx={1.8}
                    className="knox-bar-submitted"
                  />
                  {count > 0 && (
                    <rect
                      x={x - groupWidth / 2}
                      y={chart.top}
                      width={groupWidth}
                      height={chart.height}
                      fill="transparent"
                    />
                  )}
                </g>
              );
            })}
            {[0, Math.floor((period - 1) / 2), period - 1].map((index) => (
              <text
                key={index}
                x={chart.left + (index / (period - 1)) * chart.width}
                y={185}
                textAnchor={
                  index === 0
                    ? "start"
                    : index === period - 1
                      ? "end"
                      : "middle"
                }
                className="knox-chart-label"
              >
                {shortDate(activity[index].date)}
              </text>
            ))}
          </svg>
          {!activityTotal && (
            <p className="knox-chart-empty">
              No new opportunities or recorded submissions in this period.
            </p>
          )}
          <p className="knox-definition">
            Calendar days in {timezone}. This period selector changes only the
            activity chart; current totals stay across all dates.
          </p>
        </section>

        <section className="knox-panel knox-pipeline-panel">
          <div className="knox-panel-heading">
            <div>
              <h2>Your pipeline</h2>
              <p>{metrics.total} opportunities · current stage</p>
            </div>
            <button
              className="knox-text-button"
              onClick={() => onNavigate("board")}
              aria-label="Open Kanban board"
            >
              <ArrowUpRight size={17} />
            </button>
          </div>
          <div className="knox-pipeline-list">
            {metrics.pipeline.map((stage) => (
              <button
                key={stage.id}
                className="knox-pipeline-row"
                disabled={!stage.count}
                onClick={() =>
                  show(
                    stage.label,
                    opportunities
                      .filter((item) => item.stage === stage.id)
                      .map((item) => item.id),
                    "Opportunities currently in this stage. This is a distribution of current status, not a conversion funnel.",
                  )
                }
              >
                <span className="knox-pipeline-label">{stage.label}</span>
                <span className="knox-pipeline-track">
                  <span
                    style={{ width: `${(stage.count / maxPipeline) * 100}%` }}
                  />
                </span>
                <strong>{stage.count}</strong>
              </button>
            ))}
          </div>
          <p className="knox-definition">
            One current stage per opportunity, including outcomes.
          </p>
        </section>
      </div>

      {selection && (
        <section className="knox-panel knox-drilldown" aria-live="polite">
          <div className="knox-panel-heading">
            <div>
              <h2>{selection.title}</h2>
              <p>
                {selectedRecords.length} matching{" "}
                {selectedRecords.length === 1 ? "opportunity" : "opportunities"}
              </p>
            </div>
            <button
              className="knox-text-button"
              onClick={() => setSelection(null)}
            >
              Close
            </button>
          </div>
          <p className="knox-definition">{selection.definition}</p>
          {selectedRecords.length ? (
            <div className="knox-drilldown-list">
              {selectedRecords.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onOpenOpportunity(item.id)}
                >
                  <span>
                    <strong>{item.role}</strong>
                    <small>{item.company}</small>
                  </span>
                  <span>
                    {
                      metrics.pipeline.find((stage) => stage.id === item.stage)
                        ?.label
                    }
                    <ChevronRight size={15} />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="knox-inline-empty">No matching records yet.</p>
          )}
        </section>
      )}

      <div className="knox-dashboard-lower">
        <section className="knox-panel">
          <div className="knox-panel-heading">
            <div>
              <h2>Next steps</h2>
              <p>
                Open tasks, opportunity actions, follow-ups and offer deadlines.
              </p>
            </div>
            <button
              className="knox-text-button"
              onClick={() => onNavigate("todos")}
            >
              View all <ArrowRight size={14} />
            </button>
          </div>
          <div className="knox-upcoming-list">
            {actions.length ? (
              actions.slice(0, 5).map((action) => (
                <button
                  key={action.id}
                  className="knox-upcoming-row"
                  onClick={() =>
                    action.source !== "task"
                      ? onOpenOpportunity(action.opportunityId)
                      : onNavigate("todos")
                  }
                >
                  <span className="knox-upcoming-icon">
                    {action.source === "task" ? (
                      <CheckSquare2 size={17} />
                    ) : (
                      <ArrowUpRight size={17} />
                    )}
                  </span>
                  <span className="knox-upcoming-copy">
                    <strong>{action.title}</strong>
                    <small>
                      {action.source === "task"
                        ? "Task"
                        : action.source === "activity"
                          ? "Activity follow-up"
                          : action.source === "offer"
                            ? "Offer response"
                            : "Opportunity action"}
                      {action.opportunityLabel
                        ? ` · ${action.opportunityLabel}`
                        : ""}
                    </small>
                  </span>
                  <Due date={action.dueDate} today={today} />
                </button>
              ))
            ) : (
              <div className="knox-card-empty">
                <CheckSquare2 size={25} />
                <h3>Room for your next move</h3>
                <p>
                  Add a task or an opportunity's next action to see it here.
                </p>
                <button
                  className="knox-text-button"
                  onClick={() => onNavigate("todos")}
                >
                  Create a task <ArrowRight size={14} />
                </button>
              </div>
            )}
          </div>
          <p className="knox-definition">
            Oldest due dates first; undated actions follow. Tasks and
            opportunity actions remain separate records.
          </p>
        </section>
        <section className="knox-panel">
          <div className="knox-panel-heading">
            <div>
              <h2>Interviews to prepare</h2>
              <p>Planned and rescheduled entries on active opportunities.</p>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {interviews.length > 0 && (
                <a
                  href="/api/calendar/interviews.ics"
                  className="button secondary small"
                  style={{ textDecoration: "none", fontSize: "11px", padding: "4px 8px" }}
                  title="Subscribe or download all planned interviews as an iCalendar (.ics) feed"
                >
                  <CalendarDays size={13} />
                  Export .ics
                </a>
              )}
              <CalendarDays size={18} className="knox-muted-icon" />
            </div>
          </div>
          <div className="knox-upcoming-list">
            {interviews.length ? (
              interviews
                .slice(0, 5)
                .map(({ opportunity, activity: interview }) => (
                  <button
                    key={`${opportunity.id}:${interview.id}`}
                    className="knox-upcoming-row"
                    onClick={() => onOpenOpportunity(opportunity.id)}
                  >
                    <span className="knox-upcoming-icon">
                      <CalendarDays size={17} />
                    </span>
                    <span className="knox-upcoming-copy">
                      <strong>
                        {interview.title || opportunity.role}
                        {interview.isFinal ? " · Final" : ""}
                      </strong>
                      <small>
                        {opportunity.company} · {interview.type}
                        {interview.scheduledAt
                          ? ` · ${formatDate(interview.scheduledAt, timezone, true)}`
                          : " · Date not set"}
                      </small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))
            ) : (
              <div className="knox-card-empty">
                <CalendarDays size={25} />
                <h3>A little preparation goes a long way</h3>
                <p>
                  Planned and rescheduled interviews will appear here when you
                  add them to an opportunity.
                </p>
              </div>
            )}
          </div>
          <p className="knox-definition">
            Earlier planned dates come first, including past dates needing an
            update. Completed and cancelled interviews are excluded.
          </p>
        </section>
      </div>

      <div className="knox-dashboard-footer-grid">
        <section className="knox-panel knox-outcomes-panel">
          <div className="knox-panel-heading">
            <div>
              <h2>Outcomes</h2>
              <p>Current recorded decisions, across all dates.</p>
            </div>
            <span className="knox-panel-total">{metrics.closed} closed</span>
          </div>
          <div className="knox-outcomes-content">
            <svg
              viewBox="0 0 144 144"
              className="knox-donut"
              role="img"
              aria-label={`Outcomes: ${metrics.outcomes.map((item) => `${item.count} ${item.label.toLowerCase()}`).join(", ")}`}
            >
              <circle
                cx="72"
                cy="72"
                r="54"
                fill="none"
                stroke="var(--line)"
                strokeWidth="15"
              />
              {metrics.outcomes.map((outcome, index) => {
                const length = metrics.closed
                  ? (outcome.count / metrics.closed) * circumference
                  : 0;
                const start = outcomeOffset;
                outcomeOffset += length;
                return outcome.count ? (
                  <circle
                    key={outcome.id}
                    cx="72"
                    cy="72"
                    r="54"
                    fill="none"
                    stroke={outcomeColors[index]}
                    strokeWidth="15"
                    strokeDasharray={`${length} ${circumference - length}`}
                    strokeDashoffset={-start}
                    transform="rotate(-90 72 72)"
                    tabIndex={0}
                    role="button"
                    className="knox-donut-segment"
                    aria-label={`${outcome.count} ${outcome.label.toLowerCase()}; view opportunities`}
                    onClick={() =>
                      show(
                        outcome.label,
                        opportunities
                          .filter((item) => item.outcome === outcome.id)
                          .map((item) => item.id),
                        "Opportunities currently carrying this outcome, regardless of which stages they visited.",
                      )
                    }
                    onKeyDown={(event) =>
                      activate(event, () =>
                        show(
                          outcome.label,
                          opportunities
                            .filter((item) => item.outcome === outcome.id)
                            .map((item) => item.id),
                          "Opportunities currently carrying this outcome.",
                        ),
                      )
                    }
                  />
                ) : null;
              })}
              <text
                x="72"
                y="72"
                textAnchor="middle"
                className="knox-donut-number"
              >
                {metrics.closed}
              </text>
              <text
                x="72"
                y="91"
                textAnchor="middle"
                className="knox-chart-label"
              >
                outcomes
              </text>
            </svg>
            <div className="knox-outcome-legend">
              {metrics.outcomes.map((outcome, index) => (
                <button
                  key={outcome.id}
                  disabled={!outcome.count}
                  onClick={() =>
                    show(
                      outcome.label,
                      opportunities
                        .filter((item) => item.outcome === outcome.id)
                        .map((item) => item.id),
                      "Opportunities currently carrying this outcome.",
                    )
                  }
                >
                  <i style={{ background: outcomeColors[index] }} />
                  <span>{outcome.label}</span>
                  <strong>{outcome.count}</strong>
                </button>
              ))}
            </div>
            <div className="knox-hire-share">
              <strong>
                {metrics.hireShare === null
                  ? "—"
                  : `${Math.round(metrics.hireShare * 100)}%`}
              </strong>
              <span>Hire share of decided</span>
              <small>
                Hired ÷ (hired + rejected).{" "}
                {metrics.hireShare === null
                  ? "No hired or rejected outcomes yet."
                  : "Ignored, withdrawn and closed roles are excluded."}
              </small>
            </div>
          </div>
        </section>
        <button
          className="knox-reference-card"
          onClick={() => onNavigate("library")}
        >
          <FolderOpen size={25} />
          <span className="knox-eyebrow">YOUR CAREER MATERIAL</span>
          <strong>
            {props.referenceCount} reference{" "}
            {props.referenceCount === 1 ? "document" : "documents"}
          </strong>
          <p>
            Keep CVs, achievements and evidence together for your next
            application.
          </p>
          <span className="knox-reference-link">
            Open Career Hub <ArrowRight size={15} />
          </span>
          <small>Stored originals · Source material for Career Buddy</small>
        </button>
      </div>
    </section>
  );
}
