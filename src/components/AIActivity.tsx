import { useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { api, json, formatDate, ApiError } from "../api";
import { requestStage } from "./BuddyRequestDetails";
import "./AIActivity.css";
export type ActivityDestination = {
  type: "opportunity" | "buddy" | "intake" | "feedback" | "settings";
  id?: string;
  tab?: string;
};
type TaskRow = {
  id: string;
  kind: string;
  status: string;
  subject: string;
  progress: {
    phase?: string;
    completed?: number;
    total?: number;
    percent?: number;
  } | null;
  retryCount: number;
  lastError: string | null;
  enqueuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  canCancel: boolean;
  canRetry: boolean;
};
type TaskResult = {
  items: TaskRow[];
  total: number;
  totals: {
    total: number;
    active: number;
    completed: number;
    failed: number;
    cancelled: number;
    interrupted: number;
  };
};
type Row = {
  id: string;
  originalRequestId: string | null;
  retryOf: string | null;
  attempt: number | null;
  kind: string;
  label: string;
  action: string | null;
  subject: string;
  provider: string;
  model: string;
  reportedModel: string | null;
  stage: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  promptVersion: string | null;
  promptHash: string | null;
  errorCode: string | null;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    cacheWriteInputTokens?: number;
    reasoningTokens?: number;
    complete?: boolean;
  } | null;
  cost: { amount: number; currency: string; estimated: true } | null;
  pricing: {
    currency: string;
    inputPerMillion: number;
    outputPerMillion: number;
    revision: number;
  } | null;
  destination: ActivityDestination | null;
};
type Result = {
  items: Row[];
  total: number;
  totals: {
    requests: number;
    active: number;
    completed: number;
    attention: number;
    cancelled: number;
    inputTokens: number;
    outputTokens: number;
    completeUsageRequests: number;
    partialUsageRequests: number;
    unreportedUsageRequests: number;
    estimatedRequests: number;
    costs: Record<string, number>;
  };
};
type Rate = {
  provider: string;
  model: string;
  currency: string;
  inputPerMillion: number;
  outputPerMillion: number;
};
type Rates = { revision: number; rates: Rate[] };
const providers: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Claude",
  gemini: "Gemini",
  ollama: "Ollama",
  custom: "Custom",
  codex: "Codex account",
  local: "Local reader",
};
const kinds: Record<string, string> = {
  "opportunity-chat": "Opportunity chat",
  "buddy-chat": "Career Buddy chat",
  draft: "Document drafting",
  fit: "Fit assessment",
  tags: "Automatic tags",
  summary: "Opportunity briefing",
  intake: "AI job intake",
  "local-intake": "Local job reading",
  feedback: "Feedback review",
  "connection-test": "Connection test",
};
const taskKindLabels: Record<string, string> = {
  "embedding-index": "Vector embedding indexing",
  "opportunity-automation": "Opportunity automation",
  "deferred-fit": "Deferred fit assessment",
  "deferred-briefing": "Deferred briefing",
};
const taskStatusLabels: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  cancelling: "Cancelling",
  completed: "Completed",
  "completed-with-errors": "Completed with errors",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};
const count = (v: number | undefined) =>
  v === undefined ? "Not reported" : v.toLocaleString();
const amount = (value: number, currency: string) =>
  currency +
  " " +
  value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
export default function AIActivity({
  timezone,
  onOpen,
  onError,
}: {
  timezone: string;
  onOpen: (destination: ActivityDestination) => void;
  onError: (error: unknown) => void;
}) {
  const [result, setResult] = useState<Result | null>(null),
    [rates, setRates] = useState<Rates | null>(null),
    [taskResult, setTaskResult] = useState<TaskResult | null>(null),
    [taskStatus, setTaskStatus] = useState("all"),
    [taskKind, setTaskKind] = useState("all"),
    [error, setError] = useState(""),
    [status, setStatus] = useState("all"),
    [kind, setKind] = useState("all"),
    [provider, setProvider] = useState("all"),
    [days, setDays] = useState("0"),
    [offset, setOffset] = useState(0),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(""),
    [rateProvider, setRateProvider] = useState("openai"),
    [model, setModel] = useState(""),
    [currency, setCurrency] = useState("USD"),
    [inputRate, setInputRate] = useState(""),
    [outputRate, setOutputRate] = useState("");
  const report = (e: unknown) => {
    setError(e instanceof Error ? e.message : "Could not load activity");
    if (e instanceof ApiError && e.status === 401) onError(e);
  };
  const loadRates = () =>
    api<Rates>("/ai-activity/rates").then(setRates).catch(report);
  const loadTasks = async () => {
    try {
      const v = await api<TaskResult>(
        "/ai-tasks?" +
          new URLSearchParams({
            status: taskStatus,
            kind: taskKind,
            limit: "50",
          }),
      );
      setTaskResult(v);
    } catch (e) {
      report(e);
    }
  };
  useEffect(() => {
    void loadRates();
  }, []);
  useEffect(() => {
    let live = true;
    const poll = async () => {
      try {
        const v = await api<TaskResult>(
          "/ai-tasks?" +
            new URLSearchParams({
              status: taskStatus,
              kind: taskKind,
              limit: "50",
            }),
        );
        if (live) setTaskResult(v);
      } catch (e) {
        if (live) report(e);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [taskStatus, taskKind, refresh]);
  useEffect(() => {
    let live = true;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const v = await api<Result>(
          "/ai-activity?" +
            new URLSearchParams({
              status,
              kind,
              provider,
              days,
              offset: String(offset),
              limit: "25",
            }),
        );
        if (live) {
          setResult(v);
          if (v.total && offset >= v.total) setOffset(0);
        }
      } catch (e) {
        if (live) report(e);
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [status, kind, provider, days, offset, refresh]);
  async function saveRates(next: Rate[]) {
    if (!rates) return;
    setBusy("rates");
    setError("");
    try {
      setRates(
        await api<Rates>(
          "/ai-activity/rates",
          json({ revision: rates.revision, rates: next }, "PATCH"),
        ),
      );
      setModel("");
      setInputRate("");
      setOutputRate("");
    } catch (e) {
      report(e);
      if (e instanceof ApiError && e.status === 409) void loadRates();
    } finally {
      setBusy("");
    }
  }
  const totals = result?.totals;
  return (
    <main className="content-page ai-activity">
      <div className="page-heading">
        <div>
          <div className="eyebrow">CAREER BUDDY AT WORK</div>
          <h1>AI activity</h1>
          <p>Requests, outcomes and provider-reported usage in one place.</p>
        </div>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setError("");
            setRefresh((v) => v + 1);
            void loadRates();
          }}
        >
          <RefreshCw size={16} />
          Refresh activity
        </button>
      </div>
      <section className="settings-section">
        <div className="section-header">
          <div>
            <h2>Scheduled & background tasks</h2>
            <p>
              Persistent asynchronous jobs including vector embedding batches,
              opportunity automation workflows, and deferred evaluations.
              Interrupted jobs do not restart automatically.
            </p>
          </div>
        </div>

        <div className="activity-filters">
          <label className="field">
            Task status
            <select
              aria-label="Filter background task status"
              value={taskStatus}
              onChange={(e) => setTaskStatus(e.target.value)}
            >
              {[
                ["all", "All statuses"],
                ["active", "Active (Queued / Running)"],
                ["queued", "Queued"],
                ["running", "Running"],
                ["completed", "Completed"],
                ["failed", "Failed"],
                ["interrupted", "Interrupted"],
                ["cancelled", "Cancelled"],
              ].map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Task kind
            <select
              aria-label="Filter background task kind"
              value={taskKind}
              onChange={(e) => setTaskKind(e.target.value)}
            >
              {[
                ["all", "All task kinds"],
                ["embedding-index", "Vector embedding indexing"],
                ["opportunity-automation", "Opportunity automation"],
                ["deferred-fit", "Deferred fit assessment"],
                ["deferred-briefing", "Deferred briefing"],
              ].map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>

        {taskResult?.totals && (
          <div className="activity-stats">
            <div>
              <strong>{taskResult.totals.total}</strong>
              <span>Total tasks</span>
            </div>
            <div>
              <strong>{taskResult.totals.active}</strong>
              <span>Active</span>
            </div>
            <div>
              <strong>{taskResult.totals.completed}</strong>
              <span>Completed</span>
            </div>
            <div>
              <strong>{taskResult.totals.failed}</strong>
              <span>Failed</span>
            </div>
            <div>
              <strong>{taskResult.totals.interrupted}</strong>
              <span>Interrupted</span>
            </div>
          </div>
        )}

        <div className="activity-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Task & subject</th>
                <th>Status & progress</th>
                <th>Enqueued / Started</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!taskResult?.items.length ? (
                <tr>
                  <td colSpan={4}>No matching background tasks found.</td>
                </tr>
              ) : (
                taskResult.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>
                        {taskKindLabels[row.kind] || row.kind}
                      </strong>
                      <span>{row.subject}</span>
                      <span className="activity-hash">ID: {row.id}</span>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          ["running", "queued"].includes(row.status)
                            ? "blue"
                            : ["completed", "completed-with-errors"].includes(
                                row.status,
                              )
                            ? "green"
                            : ["failed", "interrupted"].includes(row.status)
                            ? "red"
                            : "gray"
                        }`}
                      >
                        {taskStatusLabels[row.status] || row.status}
                      </span>
                      {row.progress && (
                        <span>
                          {row.progress.phase
                            ? `${row.progress.phase} `
                            : ""}
                          {row.progress.completed !== undefined &&
                          row.progress.total !== undefined
                            ? `(${row.progress.completed} / ${row.progress.total})`
                            : row.progress.percent !== undefined
                            ? `(${row.progress.percent}%)`
                            : ""}
                        </span>
                      )}
                      {row.lastError && (
                        <span className="field-error">{row.lastError}</span>
                      )}
                      {row.retryCount > 0 && (
                        <span>Retried {row.retryCount} times</span>
                      )}
                    </td>
                    <td>
                      <div>
                        {formatDate(row.enqueuedAt, timezone)}
                      </div>
                      {row.finishedAt && (
                        <span>
                          Finished: {formatDate(row.finishedAt, timezone)}
                        </span>
                      )}
                    </td>
                    <td>
                      {row.canCancel && (
                        <button
                          type="button"
                          className="button secondary small"
                          disabled={busy === "task-" + row.id}
                          onClick={async () => {
                            setBusy("task-" + row.id);
                            setError("");
                            try {
                              await api(
                                `/ai-tasks/${encodeURIComponent(row.id)}/cancel`,
                                json({}),
                              );
                              void loadTasks();
                            } catch (e) {
                              report(e);
                            } finally {
                              setBusy("");
                            }
                          }}
                        >
                          Cancel task
                        </button>
                      )}
                      {row.canRetry && (
                        <button
                          type="button"
                          className="button secondary small"
                          disabled={busy === "task-" + row.id}
                          onClick={async () => {
                            setBusy("task-" + row.id);
                            setError("");
                            try {
                              await api(
                                `/ai-tasks/${encodeURIComponent(row.id)}/retry`,
                                json({}),
                              );
                              void loadTasks();
                            } catch (e) {
                              report(e);
                            } finally {
                              setBusy("");
                            }
                          }}
                        >
                          Retry task
                        </button>
                      )}
                      {!row.canCancel && !row.canRetry && (
                        <span>—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="settings-section">
        <p>
          Recorded requests appear here as they start. Earlier records may lack
          usage or prompt details. Model discovery, embedding jobs and local
          document exports are outside this request log.
        </p>
        <div className="activity-filters">
          <label className="field">
            Status
            <select
              aria-label="Activity status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setOffset(0);
              }}
            >
              {[
                ["all", "All statuses"],
                ["active", "In progress"],
                ["completed", "Completed"],
                ["attention", "Needs attention"],
                ["cancelled", "Cancelled"],
              ].map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Task
            <select
              aria-label="Activity task type"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setOffset(0);
              }}
            >
              <option value="all">All task types</option>
              {Object.entries(kinds).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Provider
            <select
              aria-label="Activity provider"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setOffset(0);
              }}
            >
              <option value="all">All providers</option>
              {Object.entries(providers).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Period
            <select
              aria-label="Activity period"
              value={days}
              onChange={(e) => {
                setDays(e.target.value);
                setOffset(0);
              }}
            >
              <option value="0">All time</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </label>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {totals && (
          <>
            <div className="activity-stats">
              <div>
                <strong>{totals.requests}</strong>
                <span>Tracked requests</span>
              </div>
              <div>
                <strong>{totals.active}</strong>
                <span>In progress</span>
              </div>
              <div>
                <strong>{totals.attention}</strong>
                <span>Need attention</span>
              </div>
              <div>
                <strong>
                  {totals.completeUsageRequests
                    ? (
                        totals.inputTokens + totals.outputTokens
                      ).toLocaleString()
                    : "Not reported"}
                </strong>
                <span>Tokens · complete reports only</span>
              </div>
            </div>
            <p className="buddy-muted">
              Across all matching requests: {totals.completeUsageRequests}{" "}
              complete token reports, {totals.partialUsageRequests} partial,{" "}
              {totals.unreportedUsageRequests} unreported. Every retry attempt
              counts separately.
            </p>
            <p className="buddy-muted">
              Estimated costs:{" "}
              {Object.entries(totals.costs).length
                ? Object.entries(totals.costs)
                    .map(([c, v]) => amount(v, c))
                    .join(" · ")
                : "Not available"}
              . Estimates cover {totals.estimatedRequests} of {totals.requests}{" "}
              requests; missing usage or rates are not treated as free.
            </p>
          </>
        )}
        <p className="buddy-muted">
          Review &amp; retry opens the original workflow. Review its current
          context, attachments and settings before sending again; this page
          never resends a request.
        </p>
        {!result ? (
          <p role="status">Loading activity…</p>
        ) : !result.total ? (
          <p>No recorded requests match these filters.</p>
        ) : (
          <>
            <div className="activity-table-wrap">
              <table>
                <caption className="sr-only">
                  Recorded Career Buddy request activity
                </caption>
                <thead>
                  <tr>
                    <th>Task / started</th>
                    <th>Requested model</th>
                    <th>Outcome / duration</th>
                    <th>Tokens</th>
                    <th>Estimated cost</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((row) => {
                    const attention = [
                      "failed",
                      "timed-out",
                      "interrupted",
                      "stale",
                      "cancelled",
                    ].includes(row.stage);
                    const seconds = Math.max(
                      0,
                      Math.round(
                        (row.durationMs ??
                          Date.now() - Date.parse(row.startedAt)) / 1000,
                      ),
                    );
                    return (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.label}</strong>
                          <span>{row.subject}</span>
                          <span>
                            {formatDate(row.startedAt, timezone, true)}
                          </span>
                          {row.action && <span>{row.action}</span>}
                        </td>
                        <td>
                          {providers[row.provider] || row.provider}
                          <span>{row.model}</span>
                          {row.reportedModel &&
                            row.reportedModel !== row.model && (
                              <span>Reported: {row.reportedModel}</span>
                            )}
                        </td>
                        <td>
                          <strong>{requestStage(row.stage)}</strong>
                          <span>
                            {seconds}s · attempt {row.attempt ?? "not recorded"}
                          </span>
                          {row.errorCode && (
                            <span>
                              {row.errorCode === "409"
                                ? "Source or revision conflict"
                                : row.errorCode === "504"
                                  ? "Response time limit"
                                  : row.errorCode === "499"
                                    ? "Cancellation requested"
                                    : "Request error " + row.errorCode}
                            </span>
                          )}
                        </td>
                        <td>
                          <span>In: {count(row.usage?.inputTokens)}</span>
                          <span>Out: {count(row.usage?.outputTokens)}</span>
                          {row.usage && !row.usage.complete && (
                            <span>Partial report</span>
                          )}
                        </td>
                        <td>
                          {row.provider === "codex"
                            ? "Account usage — no per-request price"
                            : row.provider === "local"
                              ? "Local processing"
                              : row.cost
                                ? amount(row.cost.amount, row.cost.currency)
                                : "Not available"}
                        </td>
                        <td>
                          {!row.finishedAt ? (
                            <button
                              type="button"
                              className="button secondary small"
                              disabled={!!busy}
                              onClick={async () => {
                                setBusy(row.id);
                                try {
                                  await api(
                                    "/buddy/requests/" +
                                      encodeURIComponent(row.id),
                                    json({ cancel: true }),
                                  );
                                  setRefresh((v) => v + 1);
                                } catch (e) {
                                  report(e);
                                } finally {
                                  setBusy("");
                                }
                              }}
                            >
                              Cancel request
                            </button>
                          ) : row.destination ? (
                            <button
                              type="button"
                              className="button secondary small"
                              onClick={() => onOpen(row.destination!)}
                            >
                              {attention ? "Review & retry" : "Open workflow"}
                            </button>
                          ) : (
                            <span>Opportunity unavailable</span>
                          )}
                          <details>
                            <summary>Request details</summary>
                            <dl>
                              <dt>Prompt version</dt>
                              <dd>{row.promptVersion || "Not recorded"}</dd>
                              <dt>System prompt fingerprint</dt>
                              <dd className="activity-hash">
                                {row.promptHash || "Not recorded"}
                              </dd>
                              <dt>Cached input / cache writes</dt>
                              <dd>
                                {count(row.usage?.cachedInputTokens)} /{" "}
                                {count(row.usage?.cacheWriteInputTokens)}
                              </dd>
                              <dt>Reasoning tokens</dt>
                              <dd>{count(row.usage?.reasoningTokens)}</dd>
                              <dt>Request ID</dt>
                              <dd className="activity-hash">{row.id}</dd>
                              {row.retryOf && (
                                <>
                                  <dt>Previous attempt</dt>
                                  <dd className="activity-hash">
                                    {row.retryOf}
                                  </dd>
                                </>
                              )}
                              {row.pricing && (
                                <>
                                  <dt>Saved estimate rates</dt>
                                  <dd>
                                    {row.pricing.currency}{" "}
                                    {row.pricing.inputPerMillion} in /{" "}
                                    {row.pricing.outputPerMillion} out per
                                    million · rate revision{" "}
                                    {row.pricing.revision}
                                  </dd>
                                </>
                              )}
                            </dl>
                          </details>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="activity-pagination">
              <span>
                Showing {offset + 1}–{Math.min(offset + 25, result.total)} of{" "}
                {result.total}
              </span>
              <button
                type="button"
                className="button secondary small"
                disabled={!offset}
                onClick={() => setOffset((v) => Math.max(0, v - 25))}
              >
                Previous activity
              </button>
              <button
                type="button"
                className="button secondary small"
                disabled={offset + 25 >= result.total}
                onClick={() => setOffset((v) => v + 25)}
              >
                Next activity
              </button>
            </div>
          </>
        )}
      </section>
      <section className="settings-section">
        <div className="section-header">
          <div>
            <h2>Scheduled & background tasks</h2>
            <p>
              Persistent asynchronous jobs including vector embedding batches,
              opportunity automation workflows, and deferred evaluations.
              Interrupted jobs do not restart automatically.
            </p>
          </div>
        </div>

        <div className="activity-filters">
          <label className="field">
            Task status
            <select
              aria-label="Filter background task status"
              value={taskStatus}
              onChange={(e) => setTaskStatus(e.target.value)}
            >
              {[
                ["all", "All statuses"],
                ["active", "Active (Queued / Running)"],
                ["queued", "Queued"],
                ["running", "Running"],
                ["completed", "Completed"],
                ["failed", "Failed"],
                ["interrupted", "Interrupted"],
                ["cancelled", "Cancelled"],
              ].map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Task kind
            <select
              aria-label="Filter background task kind"
              value={taskKind}
              onChange={(e) => setTaskKind(e.target.value)}
            >
              {[
                ["all", "All task kinds"],
                ["embedding-index", "Vector embedding indexing"],
                ["opportunity-automation", "Opportunity automation"],
                ["deferred-fit", "Deferred fit assessment"],
                ["deferred-briefing", "Deferred briefing"],
              ].map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>

        {taskResult?.totals && (
          <div className="activity-stats">
            <div>
              <strong>{taskResult.totals.total}</strong>
              <span>Total tasks</span>
            </div>
            <div>
              <strong>{taskResult.totals.active}</strong>
              <span>Active</span>
            </div>
            <div>
              <strong>{taskResult.totals.completed}</strong>
              <span>Completed</span>
            </div>
            <div>
              <strong>{taskResult.totals.failed}</strong>
              <span>Failed</span>
            </div>
            <div>
              <strong>{taskResult.totals.interrupted}</strong>
              <span>Interrupted</span>
            </div>
          </div>
        )}

        <div className="activity-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Task & subject</th>
                <th>Status & progress</th>
                <th>Enqueued / Started</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!taskResult?.items.length ? (
                <tr>
                  <td colSpan={4}>No matching background tasks found.</td>
                </tr>
              ) : (
                taskResult.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>
                        {taskKindLabels[row.kind] || row.kind}
                      </strong>
                      <span>{row.subject}</span>
                      <span className="activity-hash">ID: {row.id}</span>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          ["running", "queued"].includes(row.status)
                            ? "blue"
                            : ["completed", "completed-with-errors"].includes(
                                row.status,
                              )
                            ? "green"
                            : ["failed", "interrupted"].includes(row.status)
                            ? "red"
                            : "gray"
                        }`}
                      >
                        {taskStatusLabels[row.status] || row.status}
                      </span>
                      {row.progress && (
                        <span>
                          {row.progress.phase
                            ? `${row.progress.phase} `
                            : ""}
                          {row.progress.completed !== undefined &&
                          row.progress.total !== undefined
                            ? `(${row.progress.completed} / ${row.progress.total})`
                            : row.progress.percent !== undefined
                            ? `(${row.progress.percent}%)`
                            : ""}
                        </span>
                      )}
                      {row.lastError && (
                        <span className="field-error">{row.lastError}</span>
                      )}
                      {row.retryCount > 0 && (
                        <span>Retried {row.retryCount} times</span>
                      )}
                    </td>
                    <td>
                      <div>
                        {formatDate(row.enqueuedAt, timezone)}
                      </div>
                      {row.finishedAt && (
                        <span>
                          Finished: {formatDate(row.finishedAt, timezone)}
                        </span>
                      )}
                    </td>
                    <td>
                      {row.canCancel && (
                        <button
                          type="button"
                          className="button secondary small"
                          disabled={busy === "task-" + row.id}
                          onClick={async () => {
                            setBusy("task-" + row.id);
                            setError("");
                            try {
                              await api(
                                `/ai-tasks/${encodeURIComponent(row.id)}/cancel`,
                                json({}),
                              );
                              void loadTasks();
                            } catch (e) {
                              report(e);
                            } finally {
                              setBusy("");
                            }
                          }}
                        >
                          Cancel task
                        </button>
                      )}
                      {row.canRetry && (
                        <button
                          type="button"
                          className="button secondary small"
                          disabled={busy === "task-" + row.id}
                          onClick={async () => {
                            setBusy("task-" + row.id);
                            setError("");
                            try {
                              await api(
                                `/ai-tasks/${encodeURIComponent(row.id)}/retry`,
                                json({}),
                              );
                              void loadTasks();
                            } catch (e) {
                              report(e);
                            } finally {
                              setBusy("");
                            }
                          }}
                        >
                          Retry task
                        </button>
                      )}
                      {!row.canCancel && !row.canRetry && (
                        <span>—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading">
          <Activity size={21} />
          <div>
            <h2>Optional cost estimates</h2>
            <p>Your rates, recorded with each new request.</p>
          </div>
        </div>
        <p>
          Set input/output prices per million tokens for the requested model ID.
          Rates apply to new requests only; old estimates keep their saved
          rates. Flat estimates exclude cache discounts, separate cache-write
          prices, tool fees, taxes and service-tier differences. Codex
          subscriptions have no per-request price here.
        </p>
        <details>
          <summary>Configure model rates ({rates?.rates.length || 0})</summary>
          {rates && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    !model.trim() ||
                    inputRate.trim() === "" ||
                    outputRate.trim() === ""
                  ) {
                    setError(
                      "Enter a model and both rates, including 0 when appropriate.",
                    );
                    return;
                  }
                  void saveRates([
                    ...rates.rates.filter(
                      (r) =>
                        r.provider !== rateProvider || r.model !== model.trim(),
                    ),
                    {
                      provider: rateProvider,
                      model: model.trim(),
                      currency: currency.toUpperCase(),
                      inputPerMillion: Number(inputRate),
                      outputPerMillion: Number(outputRate),
                    },
                  ]);
                }}
              >
                <div className="activity-rate-grid">
                  <label className="field">
                    Rate provider
                    <select
                      aria-label="Rate provider"
                      value={rateProvider}
                      onChange={(e) => setRateProvider(e.target.value)}
                    >
                      {Object.entries(providers)
                        .filter(([v]) => !["codex", "local"].includes(v))
                        .map(([v, t]) => (
                          <option key={v} value={v}>
                            {t}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="field">
                    Model ID
                    <input
                      aria-label="Rate model ID"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      maxLength={200}
                      required
                    />
                  </label>
                  <label className="field">
                    Currency
                    <input
                      aria-label="Rate currency"
                      value={currency}
                      onChange={(e) =>
                        setCurrency(e.target.value.toUpperCase())
                      }
                      maxLength={3}
                      minLength={3}
                      pattern="[A-Z]{3}"
                      required
                    />
                  </label>
                  <label className="field">
                    Input per million
                    <input
                      aria-label="Input rate per million tokens"
                      type="number"
                      min="0"
                      max="1000000"
                      step="any"
                      value={inputRate}
                      onChange={(e) => setInputRate(e.target.value)}
                      required
                    />
                  </label>
                  <label className="field">
                    Output per million
                    <input
                      aria-label="Output rate per million tokens"
                      type="number"
                      min="0"
                      max="1000000"
                      step="any"
                      value={outputRate}
                      onChange={(e) => setOutputRate(e.target.value)}
                      required
                    />
                  </label>
                </div>
                <button className="button secondary" disabled={!!busy}>
                  Save model rate
                </button>
              </form>
              <ul className="activity-rates">
                {rates.rates.map((r) => (
                  <li key={r.provider + ":" + r.model}>
                    <span>
                      {providers[r.provider]} / {r.model} · {r.currency}{" "}
                      {r.inputPerMillion} in / {r.outputPerMillion} out
                    </span>
                    <button
                      type="button"
                      className="button secondary small"
                      disabled={!!busy}
                      onClick={() => {
                        setRateProvider(r.provider);
                        setModel(r.model);
                        setCurrency(r.currency);
                        setInputRate(String(r.inputPerMillion));
                        setOutputRate(String(r.outputPerMillion));
                      }}
                    >
                      Edit rate
                    </button>
                    <button
                      type="button"
                      className="button secondary small"
                      disabled={!!busy}
                      onClick={() =>
                        void saveRates(rates.rates.filter((v) => v !== r))
                      }
                    >
                      Remove rate
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      </section>
    </main>
  );
}
