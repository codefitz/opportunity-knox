import {
  useState,
  useEffect,
  useRef,
  type ReactNode,
  type FormEvent,
  type DragEvent,
} from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  Folder,
  FolderOpen,
  LayoutGrid,
  List,
  LoaderCircle,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  api,
  ApiError,
  json,
  readFile,
  download,
  localInput,
  iso,
  formatDate,
  editedTimestamp,
} from "./api";
import {
  STAGES,
  OUTCOMES,
  stageLabel,
  type Opportunity,
  type Settings,
  type Session,
  type StageId,
  type Activity,
  type BoardDocument,
  type StageEvent,
} from "./types";

import JobLookup, {
  JOB_FIELDS,
  lookupNote,
  type JobLookupResult,
} from "./components/JobLookup";

type Page = "board" | "library" | "settings";
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";
const displayError = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
const today = (timezone = "Europe/London") =>
  new Date().toLocaleDateString("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
function Field({
  label,
  children,
  hint,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Busy({ text = "Loading…" }: { text?: string }) {
  return (
    <span className="busy">
      <LoaderCircle size={16} className="spin" />
      {text}
    </span>
  );
}
function Badge({
  children,
  kind = "muted",
}: {
  children: ReactNode;
  kind?: string;
}) {
  return <span className={`badge ${kind}`}>{children}</span>;
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const first = container.current?.querySelector<HTMLElement>(
      "input,button,select,textarea,a[href]",
    );
    first?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const items = container.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = scroll;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={container}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [bootError, setBootError] = useState("");
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]),
    [settings, setSettings] = useState<Settings | null>(null);
  const [page, setPage] = useState<Page>("board"),
    [view, setView] = useState<"board" | "list">("board"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("active");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [newOpen, setNewOpen] = useState(false),
    [newUrl, setNewUrl] = useState(""),
    [newFile, setNewFile] = useState<File | null>(null),
    [newText, setNewText] = useState("");
  const [selected, setSelected] = useState<Opportunity | null>(null),
    [dragging, setDragging] = useState(""),
    [dropStage, setDropStage] = useState("");
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get("setup") || "",
  );
  useEffect(() => {
    if (window.location.hash.startsWith("#setup="))
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    api<Session>("/session")
      .then(setSession)
      .catch((e) => setBootError(displayError(e)));
  }, []);
  async function load() {
    setLoading(true);
    try {
      const data = await api<{
        opportunities: Opportunity[];
        settings: Settings;
      }>("/board");
      setOpportunities(data.opportunities);
      setSettings(data.settings);
    } catch (e) {
      report(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (session?.authenticated) void load();
  }, [session?.authenticated]);
  function report(e: unknown) {
    setError(displayError(e));
    if (e instanceof ApiError && e.status === 401)
      setSession({
        authenticated: false,
        setupRequired: false,
        setupTokenRequired: false,
      });
  }
  async function openOpportunity(id: string) {
    try {
      setSelected(await api<Opportunity>(`/opportunities/${id}`));
    } catch (e) {
      report(e);
    }
  }
  function updated(op: Opportunity) {
    setSelected((current) => (current?.id === op.id ? op : current));
    setOpportunities((list) =>
      list.some((o) => o.id === op.id)
        ? list.map((o) => (o.id === op.id ? op : o))
        : [op, ...list],
    );
  }
  async function move(op: Opportunity, stage: StageId) {
    if (stage === op.stage) return;
    if (stage === "outcome") {
      await openOpportunity(op.id);
      setNotice("Choose an outcome in the opportunity details, then save.");
      return;
    }
    try {
      const next = await api<Opportunity>(
        `/opportunities/${op.id}`,
        json({ revision: op.revision, stage, outcome: "" }, "PATCH"),
      );
      setOpportunities((list) =>
        list.map((o) => (o.id === next.id ? next : o)),
      );
    } catch (e) {
      report(e);
      if (e instanceof ApiError && e.status === 409) void load();
    }
  }
  function externalDrop(e: DragEvent) {
    e.preventDefault();
    if (dragging) return;
    const file = e.dataTransfer.files[0];
    const text =
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("text/plain");
    if (file) {
      setNewFile(file);
      setNewUrl("");
      setNewText("");
      setNewOpen(true);
    } else if (text) {
      setNewFile(null);
      setNewUrl("");
      setNewText("");
      if (/^https?:\/\//i.test(text.trim()))
        setNewUrl(text.trim().split("\n")[0]);
      else setNewText(text);
      setNewOpen(true);
    }
  }
  function add() {
    setNewUrl("");
    setNewFile(null);
    setNewText("");
    setNewOpen(true);
  }
  const filtered = opportunities.filter(
    (o) =>
      (filter === "all" ||
        (filter === "active"
          ? !o.outcome
          : filter === "completed"
            ? !!o.outcome
            : o.outcome === filter)) &&
      `${o.company} ${o.role} ${o.tags?.join(" ")} ${o.location}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const active = opportunities.filter((o) => !o.outcome),
    interviews = active.filter((o) =>
      ["interviews", "final-interview"].includes(o.stage),
    ),
    overdue = active.filter(
      (o) => o.nextActionDate && o.nextActionDate < today(settings?.timezone),
    );
  if (bootError)
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1>Let’s reconnect.</h1>
          <p>{bootError}</p>
          <button
            className="button primary"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      </div>
    );
  if (!session)
    return (
      <div className="auth-screen">
        <Busy text="Opening your workspace…" />
      </div>
    );
  if (!session.authenticated)
    return <Auth session={session} token={token} onDone={setSession} />;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("board");
          }}
        >
          <span className="brand-mark">
            <LayoutGrid size={20} />
          </span>
          <span>
            Opportunity<span className="brand-sub">YOUR NEXT CHAPTER</span>
          </span>
        </a>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={page === "board" ? "nav-item active" : "nav-item"}
            onClick={() => setPage("board")}
          >
            <LayoutGrid size={18} />
            Opportunities<span className="nav-count">{active.length}</span>
          </button>
          <button
            className={page === "library" ? "nav-item active" : "nav-item"}
            onClick={() => setPage("library")}
          >
            <FolderOpen size={18} />
            Reference library
          </button>
          <button
            className={page === "settings" ? "nav-item active" : "nav-item"}
            onClick={() => setPage("settings")}
          >
            <Settings2 size={18} />
            Settings
          </button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-note">
          <span className="tiny-icon">
            <ShieldCheck size={17} />
          </span>
          <strong>Your workspace, your data.</strong>
          <p>
            Saved on your private host.
            <br />
            Ready whenever you are.
          </p>
        </div>
        <button
          className="profile"
          onClick={async () => {
            try {
              await api("/logout", json({}));
              setSession({
                authenticated: false,
                setupRequired: false,
                setupTokenRequired: false,
              });
            } catch (e) {
              report(e);
            }
          }}
        >
          <span className="avatar">YO</span>
          <span>
            <strong>Your workspace</strong>
            <small>Sign out</small>
          </span>
          <LogOut size={16} />
        </button>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>
              {page === "board"
                ? "Opportunities"
                : page === "library"
                  ? "Reference library"
                  : "Settings"}
            </strong>
          </span>
          <span className="private-label">
            <span />
            Private workspace
          </span>
        </header>
        {error && (
          <div className="alert error" role="alert">
            <span>{error}</span>
            <button
              onClick={() => {
                setError("");
                void load();
              }}
            >
              Refresh
            </button>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="alert notice" role="status">
            <Check size={16} />
            <span>{notice}</span>
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {page === "board" && (
          <main
            className="board-page"
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={externalDrop}
          >
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  A LITTLE STRUCTURE. A CLEARER PATH.
                </div>
                <h1>
                  Your next opportunity<span className="heading-dot">.</span>
                </h1>
                <p>
                  From the first possibility to your next chapter. Keep it all
                  moving.
                </p>
              </div>
              <button className="button primary" onClick={add}>
                <Plus size={18} />
                Add opportunity
              </button>
            </div>
            <div className="metrics">
              <Metric
                icon={<BriefcaseBusiness size={17} />}
                label="Active opportunities"
                value={active.length}
                tone="green"
              />
              <Metric
                icon={<MessageSquare size={17} />}
                label="In conversation"
                value={interviews.length}
                tone="purple"
              />
              <Metric
                icon={<Clock3 size={17} />}
                label="Follow-ups overdue"
                value={overdue.length}
                tone="amber"
              />
              <Metric
                icon={<CheckCheck size={17} />}
                label="Applications submitted"
                value={
                  opportunities.filter(
                    (o) =>
                      o.stage === "submitted" ||
                      o.events?.some((e) => e.stage === "submitted"),
                  ).length
                }
                tone="blue"
              />
            </div>
            <div className="board-toolbar">
              <div className="view-toggle" aria-label="Display mode">
                <button
                  className={view === "board" ? "selected" : ""}
                  onClick={() => setView("board")}
                >
                  <LayoutGrid size={15} />
                  Board
                </button>
                <button
                  className={view === "list" ? "selected" : ""}
                  onClick={() => setView("list")}
                >
                  <List size={16} />
                  List
                </button>
              </div>
              <div className="toolbar-right">
                <div className="search-input">
                  <Search size={16} />
                  <input
                    aria-label="Search opportunities"
                    placeholder="Search opportunities…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <label className="filter-select">
                  <span className="sr-only">Filter by outcome</span>
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
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
                  <ChevronDown size={14} />
                </label>
              </div>
            </div>
            {loading ? (
              <div className="loading-board">
                <Busy text="Loading your opportunities…" />
              </div>
            ) : view === "board" ? (
              <div className="kanban" aria-label="Opportunity stages">
                {STAGES.map((stage, index) => {
                  const cards = filtered.filter((o) => o.stage === stage.id);
                  return (
                    <section
                      key={stage.id}
                      className={`kanban-column stage-${stage.id} ${dropStage === stage.id ? "drop-target" : ""}`}
                      onDragOver={(e) => {
                        if (dragging) {
                          e.preventDefault();
                          e.stopPropagation();
                          setDropStage(stage.id);
                        }
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node))
                          setDropStage("");
                      }}
                      onDrop={(e) => {
                        if (dragging) {
                          e.preventDefault();
                          e.stopPropagation();
                          const op = opportunities.find(
                            (o) => o.id === dragging,
                          );
                          if (op) void move(op, stage.id);
                          setDropStage("");
                          setDragging("");
                        }
                      }}
                    >
                      <div className="column-heading">
                        <span className="stage-dot" />
                        <h2>{stage.label}</h2>
                        <span className="column-count">{cards.length}</span>
                        <button
                          className="icon-button"
                          aria-label={`Add opportunity (${stage.label})`}
                          onClick={add}
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                      <div className="column-rail" />
                      <div className="column-cards">
                        {cards.map((op) => (
                          <OpportunityCard
                            key={op.id}
                            opportunity={op}
                            timezone={settings?.timezone}
                            onOpen={() => void openOpportunity(op.id)}
                            onDrag={setDragging}
                            onDragEnd={() => {
                              setDragging("");
                              setDropStage("");
                            }}
                          />
                        ))}
                        {!cards.length && (
                          <div className="column-empty">
                            <span>
                              {index === 0
                                ? "Every next chapter starts here."
                                : "Room for what’s next."}
                            </span>
                            {index === 0 && (
                              <button onClick={add}>
                                <Plus size={14} />
                                Add your first opportunity
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="list-wrap">
                <table className="opportunity-table">
                  <thead>
                    <tr>
                      <th>Opportunity</th>
                      <th>Stage</th>
                      <th>Next action</th>
                      <th>Deadline</th>
                      <th>Priority</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <button
                            className="table-link"
                            onClick={() => void openOpportunity(o.id)}
                          >
                            {o.role}
                            <small>{o.company}</small>
                          </button>
                        </td>
                        <td>
                          {stageLabel(o.stage)}
                          {o.outcome && (
                            <Badge
                              kind={o.outcome === "hired" ? "green" : "muted"}
                            >
                              {o.outcome}
                            </Badge>
                          )}
                        </td>
                        <td>
                          {o.nextAction || "—"}
                          {o.nextActionDate && (
                            <small>{formatDate(o.nextActionDate)}</small>
                          )}
                        </td>
                        <td>{o.deadline ? formatDate(o.deadline) : "—"}</td>
                        <td>
                          <Badge
                            kind={o.priority === "high" ? "amber" : "muted"}
                          >
                            {o.priority}
                          </Badge>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`Open ${o.role}`}
                            onClick={() => void openOpportunity(o.id)}
                          >
                            <ArrowUpRight size={17} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filtered.length && (
                  <div className="empty-state">
                    <Search size={26} />
                    <h3>
                      {opportunities.length
                        ? "No matching opportunities"
                        : "A fresh start, all yours."}
                    </h3>
                    <p>
                      {opportunities.length
                        ? "Try another search or filter."
                        : "Add a role to start building your next chapter."}
                    </p>
                  </div>
                )}
              </div>
            )}
            <div className="board-footer">
              <span>
                <Folder size={14} />
                Drop a job link or document anywhere to get started
              </span>
              <span>
                {filtered.length} opportunit
                {filtered.length === 1 ? "y" : "ies"}
                <span className="footer-separator">·</span>Changes save
                automatically after confirmation
              </span>
            </div>
            {!opportunities.length && !loading && (
              <div className="getting-started">
                <div className="start-icon">
                  <Sparkles size={20} />
                </div>
                <div>
                  <h3>Make space for your next move.</h3>
                  <p>
                    Add a job link, a description, or a PDF. Your history and
                    documents stay together as you go.
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={async () => {
                    try {
                      await api("/demo", json({}));
                      await load();
                      setNotice(
                        "Fictional sample opportunities added. These are clearly labelled demo records.",
                      );
                    } catch (e) {
                      report(e);
                    }
                  }}
                >
                  Try fictional samples
                  <ArrowRight size={15} />
                </button>
              </div>
            )}
          </main>
        )}
        {page === "library" && (
          <Library
            onError={report}
            timezone={settings?.timezone || "Europe/London"}
          />
        )}
        {page === "settings" && settings && (
          <SettingsPage
            settings={settings}
            onSaved={setSettings}
            onError={report}
            onNotice={setNotice}
          />
        )}
      </div>
      {newOpen && (
        <NewOpportunity
          initialUrl={newUrl}
          initialFile={newFile}
          initialText={newText}
          onAuthError={report}
          onClose={() => setNewOpen(false)}
          onCreated={(op, warning) => {
            updated(op);
            setNewOpen(false);
            setNotice(
              warning || "Opportunity added. Your next chapter is underway.",
            );
          }}
        />
      )}
      {selected && (
        <OpportunityDetail
          key={selected.id}
          opportunity={selected}
          timezone={settings?.timezone || "Europe/London"}
          onClose={() => setSelected(null)}
          onUpdate={updated}
          onError={report}
          onReload={() => void openOpportunity(selected.id)}
        />
      )}
    </div>
  );
}
function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="metric">
      <span className={`metric-icon ${tone}`}>{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value.toString().padStart(2, "0")}</strong>
      </div>
    </div>
  );
}
function OpportunityCard({
  opportunity: o,
  timezone = "Europe/London",
  onOpen,
  onDrag,
  onDragEnd,
}: {
  opportunity: Opportunity;
  timezone?: string;
  onOpen: () => void;
  onDrag: (id: string) => void;
  onDragEnd: () => void;
}) {
  const days = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(o.stageEnteredAt || o.createdAt).valueOf()) /
        86400000,
    ),
  );
  return (
    <article
      className="opportunity-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-opportunity", o.id);
        e.dataTransfer.effectAllowed = "move";
        onDrag(o.id);
      }}
      onDragEnd={onDragEnd}
    >
      <div className="card-top">
        <span className={`company-avatar tint-${o.company.length % 4}`}>
          {initials(o.company)}
        </span>
        {o.priority === "high" ? (
          <Badge kind="amber">High priority</Badge>
        ) : (
          <span className="card-ref">{o.jobReference || "Opportunity"}</span>
        )}
        <button
          className="icon-button"
          aria-label={`Open details for ${o.role}`}
          onClick={onOpen}
        >
          <MoreHorizontal size={17} />
        </button>
      </div>
      <button className="card-main" onClick={onOpen}>
        <span className="card-company">{o.company}</span>
        <h3>{o.role}</h3>
      </button>
      {(o.location || o.workMode) && (
        <p className="card-location">
          {[o.location, o.workMode].filter(Boolean).join(" · ")}
        </p>
      )}
      {o.salary && <div className="card-salary">{o.salary}</div>}
      {!!o.tags?.length && (
        <div className="tags">
          {o.tags.slice(0, 3).map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      )}
      {o.outcome && (
        <Badge kind={o.outcome === "hired" ? "green" : "muted"}>
          {OUTCOMES.find((x) => x.id === o.outcome)?.label || o.outcome}
        </Badge>
      )}
      {o.nextAction && (
        <div
          className={`card-action ${o.nextActionDate && o.nextActionDate < today(timezone) ? "overdue" : ""}`}
        >
          <span className="action-dot" />
          <span>{o.nextAction}</span>
          {o.nextActionDate && (
            <small>{formatDate(o.nextActionDate, timezone)}</small>
          )}
        </div>
      )}
      <div className="card-bottom">
        <span>
          <Clock3 size={12} />
          {days === 0 ? "Added today" : `${days}d in stage`}
        </span>
        {o.deadline && (
          <span title={`Closing date: ${formatDate(o.deadline)}`}>
            <CalendarDays size={12} />
            {formatDate(o.deadline).replace(/ \d{4}$/, "")}
          </span>
        )}
      </div>
    </article>
  );
}

function Auth({
  session,
  token,
  onDone,
}: {
  session: Session;
  token: string;
  onDone: (s: Session) => void;
}) {
  const [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [setupToken, setSetupToken] = useState(token),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (session.setupRequired && password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api(
        session.setupRequired ? "/setup" : "/login",
        json({ password, token: setupToken }),
      );
      onDone(await api<Session>("/session"));
    } catch (e) {
      setError(displayError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-screen">
      <div className="auth-intro">
        <span className="brand-mark">
          <LayoutGrid size={24} />
        </span>
        <div className="eyebrow">YOUR NEXT CHAPTER</div>
        <h1>
          A clearer path
          <br />
          to what’s next<span>.</span>
        </h1>
        <p>
          One private home for every possibility,
          <br />
          application, and conversation.
        </p>
        <div className="auth-line" />
      </div>
      <div className="auth-card">
        <span className="auth-icon">
          <ShieldCheck size={23} />
        </span>
        <h2>
          {session.setupRequired
            ? "Make this workspace yours."
            : "Welcome back."}
        </h2>
        <p>
          {session.setupRequired
            ? "Set a password to keep your opportunities private."
            : "Sign in to pick up where you left off."}
        </p>
        <form onSubmit={submit}>
          {session.setupRequired && session.setupTokenRequired && !token && (
            <Field
              label="First-run setup token"
              hint="The launcher shows this token on your hosting machine."
            >
              <input
                required
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                autoComplete="off"
              />
            </Field>
          )}
          <Field
            label={session.setupRequired ? "Create password" : "Password"}
            hint={
              session.setupRequired ? "Use at least 10 characters." : undefined
            }
          >
            <input
              autoFocus
              type="password"
              required
              minLength={session.setupRequired ? 10 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={
                session.setupRequired ? "new-password" : "current-password"
              }
            />
          </Field>
          {session.setupRequired && (
            <Field label="Confirm password">
              <input
                type="password"
                required
                minLength={10}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? (
              <Busy text="Opening workspace…" />
            ) : (
              <>
                {session.setupRequired ? "Create workspace" : "Open workspace"}
                <ArrowRight size={17} />
              </>
            )}
          </button>
        </form>
        <p className="auth-footnote">
          <ShieldCheck size={13} />
          Your data stays on your private host.
        </p>
      </div>
    </div>
  );
}

function NewOpportunity({
  initialUrl,
  initialFile,
  initialText,
  onClose,
  onCreated,
  onAuthError,
}: {
  initialUrl: string;
  initialFile: File | null;
  initialText: string;
  onClose: () => void;
  onCreated: (o: Opportunity, warning?: string) => void;
  onAuthError: (error: unknown) => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({
    company: "",
    role: "",
    url: initialUrl,
    description: initialText,
    jobReference: "",
    location: "",
    workMode: "",
    salary: "",
    employmentType: "",
    contact: "",
    deadline: "",
  });
  const [file, setFile] = useState<File | null>(initialFile),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [detailsOpen, setDetailsOpen] = useState(false),
    [retrieved, setRetrieved] = useState<JobLookupResult | null>(null);
  const dirty = useRef(new Set<string>(initialText ? ["description"] : []));
  const change =
    (key: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      dirty.current.add(key);
      setForm((current) => ({ ...current, [key]: e.target.value }));
    };
  function applyLookup(result: JobLookupResult) {
    setForm((current) => {
      const next = { ...current };
      for (const key of JOB_FIELDS) {
        const value = result.fields[key];
        if (typeof value === "string" && value && !dirty.current.has(key))
          next[key] = value;
      }
      return next;
    });
    setRetrieved(result);
    setDetailsOpen(true);
  }
  function changeUrl(url: string) {
    setForm((current) => {
      const next: Record<string, string> = { ...current, url };
      if (retrieved) {
        for (const key of JOB_FIELDS)
          if (!dirty.current.has(key)) next[key] = "";
      }
      return next;
    });
    setRetrieved(null);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const o = await api<Opportunity>(
        "/opportunities",
        json({
          ...form,
          ...(retrieved ? { note: lookupNote(retrieved) } : {}),
        }),
      );
      if (file) {
        try {
          await api(
            "/documents",
            json({
              opportunityId: o.id,
              name: file.name,
              contentBase64: await readFile(file),
              kind: "jd",
              status: "draft",
            }),
          );
          onCreated(await api<Opportunity>(`/opportunities/${o.id}`));
        } catch (uploadError) {
          onCreated(
            o,
            `Opportunity saved, but its document was not uploaded: ${displayError(uploadError)}. Add it from the Documents tab.`,
          );
        }
      } else onCreated(o);
    } catch (e) {
      setError(displayError(e));
      if (e instanceof ApiError && e.status === 401) onAuthError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="A new possibility."
      subtitle="Start with a job link. Fetch its details, review them, and make it yours."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <JobLookup
          url={form.url}
          onUrlChange={changeUrl}
          onResult={applyLookup}
          onAuthError={onAuthError}
          autoLookup={!!initialUrl}
        />
        <div className="form-grid">
          <Field label="Company">
            <input
              required
              value={form.company}
              onChange={change("company")}
              placeholder="Company name"
            />
          </Field>
          <Field label="Role">
            <input
              required
              value={form.role}
              onChange={change("role")}
              placeholder="Job title"
            />
          </Field>
          <Field
            label="Job description"
            wide
            hint="Keep the source description here, or attach a document below. Review extracted text against the listing."
          >
            <textarea
              rows={5}
              value={form.description}
              onChange={change("description")}
              placeholder="Paste the job description, or fetch it from a link above."
            />
          </Field>
        </div>
        <details
          className="new-job-details"
          open={detailsOpen}
          onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
        >
          <summary>
            More job details{" "}
            <span>Location, salary, closing date, and contacts</span>
          </summary>
          <div className="form-grid">
            <Field label="Location">
              <input
                value={form.location}
                onChange={change("location")}
                placeholder="City or region"
              />
            </Field>
            <Field label="Working arrangement">
              <input
                value={form.workMode}
                onChange={change("workMode")}
                placeholder="Remote, hybrid, on-site…"
              />
            </Field>
            <Field label="Salary / rate">
              <input
                value={form.salary}
                onChange={change("salary")}
                placeholder="Amount, currency, and period"
              />
            </Field>
            <Field label="Employment type">
              <input
                value={form.employmentType}
                onChange={change("employmentType")}
                placeholder="Permanent, contract…"
              />
            </Field>
            <Field label="Job reference">
              <input
                value={form.jobReference}
                onChange={change("jobReference")}
              />
            </Field>
            <Field label="Closing date">
              <input
                type="date"
                value={form.deadline}
                onChange={change("deadline")}
              />
            </Field>
            <Field label="Contact" wide>
              <input value={form.contact} onChange={change("contact")} />
            </Field>
          </div>
        </details>
        <label className="upload-drop">
          <Upload size={21} />
          <strong>{file ? file.name : "Or attach a job description"}</strong>
          <span>PDF, Word, or text · up to 15 MB</span>
          <input
            type="file"
            accept=".pdf,.docx,.doc,.txt,.md"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <Busy text="Adding…" />
            ) : (
              <>
                <Plus size={16} />
                Add opportunity
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function OpportunityDetail({
  opportunity: o,
  timezone,
  onClose,
  onUpdate,
  onError,
  onReload,
}: {
  opportunity: Opportunity;
  timezone: string;
  onClose: () => void;
  onUpdate: (o: Opportunity) => void;
  onError: (e: unknown) => void;
  onReload: () => void;
}) {
  const [tab, setTab] = useState("overview"),
    [busy, setBusy] = useState(false),
    [localError, setLocalError] = useState("");
  async function mutate(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setLocalError("");
    try {
      const next = await api<Opportunity>(path, json(body, method));
      onUpdate(next);
      return true;
    } catch (e) {
      setLocalError(displayError(e));
      if (e instanceof ApiError && e.status === 409) onReload();
      if (e instanceof ApiError && e.status === 401) onError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={o.role} subtitle={o.company} wide onClose={onClose}>
      <div className="detail-context">
        <Badge
          kind={o.outcome === "hired" ? "green" : o.outcome ? "muted" : "green"}
        >
          {o.outcome
            ? OUTCOMES.find((x) => x.id === o.outcome)?.label
            : stageLabel(o.stage)}
        </Badge>
        <span>
          <Clock3 size={13} />
          Added {formatDate(o.createdAt, timezone)}
        </span>
        {o.url && (
          <a
            className="text-link"
            href={o.url}
            target="_blank"
            rel="noreferrer"
          >
            Original listing
            <ArrowUpRight size={13} />
          </a>
        )}
      </div>
      <div className="detail-tabs" role="tablist">
        {[
          ["overview", "Overview"],
          ["timeline", "Timeline & notes"],
          ["activities", "Interviews & comms"],
          ["documents", "Documents"],
          ["summary", "Summary"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => {
              setTab(id);
              setLocalError("");
            }}
          >
            {label}
            {id === "documents" && !!o.documents?.length && (
              <span>{o.documents.length}</span>
            )}
          </button>
        ))}
      </div>
      {localError && (
        <div className="alert error" role="alert">
          {localError}
        </div>
      )}
      <div className="detail-body">
        {tab === "overview" && (
          <Overview
            key={`${o.id}-${o.revision}`}
            o={o}
            busy={busy}
            onAuthError={onError}
            save={(body) =>
              mutate(
                `/opportunities/${o.id}`,
                { ...body, revision: o.revision },
                "PATCH",
              )
            }
          />
        )}{" "}
        {tab === "timeline" && (
          <Timeline
            key={o.revision}
            o={o}
            timezone={timezone}
            busy={busy}
            mutate={mutate}
          />
        )}{" "}
        {tab === "activities" && (
          <Activities
            key={o.revision}
            o={o}
            timezone={timezone}
            busy={busy}
            mutate={mutate}
          />
        )}{" "}
        {tab === "documents" && (
          <Documents
            documents={o.documents || []}
            opportunityId={o.id}
            timezone={timezone}
            onChanged={onReload}
            onError={(e) => {
              setLocalError(displayError(e));
              if (e instanceof ApiError && e.status === 401) onError(e);
            }}
          />
        )}{" "}
        {tab === "summary" && <Summary o={o} timezone={timezone} />}
      </div>
    </Modal>
  );
}
function Overview({
  o,
  busy,
  save,
  onAuthError,
}: {
  o: Opportunity;
  busy: boolean;
  onAuthError: (error: unknown) => void;
  save: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [form, setForm] = useState<Record<string, string>>({
      ...Object.fromEntries(
        [
          "company",
          "role",
          "url",
          "jobReference",
          "location",
          "workMode",
          "salary",
          "employmentType",
          "contact",
          "deadline",
          "description",
          "priority",
          "nextAction",
          "nextActionDate",
          "stage",
          "outcome",
        ].map((k) => [k, String(o[k as keyof Opportunity] || "")]),
      ),
      tags: (o.tags || []).join(", "),
      effectiveAt: "",
      note: "",
    }),
    [saved, setSaved] = useState(false);
  const set =
    (key: string) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => {
      setForm({ ...form, [key]: e.target.value });
      setSaved(false);
    };
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      ...form,
      tags: form.tags
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      effectiveAt: iso(form.effectiveAt),
    };
    if (form.outcome) body.stage = "outcome";
    if (await save(body)) setSaved(true);
  }
  return (
    <form onSubmit={submit}>
      <div className="section-intro">
        <h3>Keep the details in one place.</h3>
        <p>
          Save changes to update this opportunity. Stage changes are dated
          automatically.
        </p>
      </div>
      <div className="form-grid">
        <Field label="Company">
          <input required value={form.company} onChange={set("company")} />
        </Field>
        <Field label="Role">
          <input required value={form.role} onChange={set("role")} />
        </Field>
        <Field label="Stage">
          <select
            value={form.stage}
            onChange={(e) => {
              setForm({
                ...form,
                stage: e.target.value,
                outcome: e.target.value === "outcome" ? form.outcome : "",
                effectiveAt: "",
                note: "",
              });
            }}
          >
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Outcome">
          <select
            value={form.outcome}
            required={form.stage === "outcome"}
            onChange={(e) =>
              setForm({
                ...form,
                outcome: e.target.value,
                stage: e.target.value
                  ? "outcome"
                  : form.stage === "outcome"
                    ? "review"
                    : form.stage,
              })
            }
          >
            <option value="">Still active</option>
            {OUTCOMES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>
        {(form.stage !== o.stage || form.outcome !== o.outcome) && (
          <>
            <Field
              label="Stage date"
              hint="Leave empty to use the current time. Times use this device’s timezone."
            >
              <input
                type="datetime-local"
                value={form.effectiveAt}
                onChange={set("effectiveAt")}
              />
            </Field>
            <Field label="Stage note (optional)">
              <input
                value={form.note}
                onChange={set("note")}
                placeholder="Decision, feedback, or context"
              />
            </Field>
          </>
        )}
        <Field label="Priority">
          <select value={form.priority || "normal"} onChange={set("priority")}>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="low">Low</option>
          </select>
        </Field>
        <Field label="Closing date">
          <input type="date" value={form.deadline} onChange={set("deadline")} />
        </Field>
        <Field label="Next action">
          <input
            value={form.nextAction}
            onChange={set("nextAction")}
            placeholder="What happens next?"
          />
        </Field>
        <Field label="Next action date">
          <input
            type="date"
            value={form.nextActionDate}
            onChange={set("nextActionDate")}
          />
        </Field>
        <Field label="Location">
          <input
            value={form.location}
            onChange={set("location")}
            placeholder="City or region"
          />
        </Field>
        <Field label="Working arrangement">
          <input
            value={form.workMode}
            onChange={set("workMode")}
            placeholder="Remote, hybrid, on-site…"
          />
        </Field>
        <Field label="Salary / rate">
          <input
            value={form.salary}
            onChange={set("salary")}
            placeholder="Include amount, currency, and period"
          />
        </Field>
        <Field label="Employment type">
          <input
            value={form.employmentType}
            onChange={set("employmentType")}
            placeholder="Permanent, contract…"
          />
        </Field>
        <Field label="Contact">
          <input value={form.contact} onChange={set("contact")} />
        </Field>
        <Field label="Job reference">
          <input value={form.jobReference} onChange={set("jobReference")} />
        </Field>
        <div className="wide">
          <JobLookup
            url={form.url}
            onUrlChange={(url) => setForm((current) => ({ ...current, url }))}
            onAuthError={onAuthError}
            preview
            onResult={(result) => {
              setForm((current) => {
                const next = { ...current };
                for (const key of JOB_FIELDS) {
                  const value = result.fields[key];
                  if (
                    typeof value === "string" &&
                    value &&
                    !current[key]?.trim()
                  )
                    next[key] = value;
                }
                return next;
              });
              setSaved(false);
            }}
          />
        </div>
        <Field label="Tags" wide hint="Separate tags with commas.">
          <input
            value={form.tags}
            onChange={set("tags")}
            placeholder="AI, leadership, consulting…"
          />
        </Field>
        <Field label="Job description" wide>
          <textarea
            rows={7}
            value={form.description}
            onChange={set("description")}
          />
        </Field>
      </div>
      <div className="form-actions">
        {saved && (
          <span className="saved">
            <Check size={15} />
            Saved
          </span>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? (
            <Busy text="Saving…" />
          ) : (
            <>
              <Check size={16} />
              Save changes
            </>
          )}
        </button>
      </div>
    </form>
  );
}
function Timeline({
  o,
  timezone,
  busy,
  mutate,
}: {
  o: Opportunity;
  timezone: string;
  busy: boolean;
  mutate: (path: string, body: unknown, method?: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState(""),
    [date, setDate] = useState(""),
    [editing, setEditing] = useState<StageEvent | null>(null),
    [editNote, setEditNote] = useState(""),
    [editDate, setEditDate] = useState("");
  async function add(e: FormEvent) {
    e.preventDefault();
    if (
      await mutate(`/opportunities/${o.id}/events`, {
        note,
        effectiveAt: iso(date),
        stage: o.stage,
        revision: o.revision,
      })
    ) {
      setNote("");
      setDate("");
    }
  }
  return (
    <>
      <div className="section-intro">
        <h3>Every step, remembered.</h3>
        <p>
          Stage changes and notes build a lasting history. Correcting a date
          keeps the original record.
        </p>
      </div>
      <form onSubmit={add} className="note-composer">
        <textarea
          required
          rows={3}
          placeholder="Add a decision, reflection, or follow-up note…"
          aria-label="Stage note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div>
          <label className="inline-date">
            Date{" "}
            <input
              aria-label="Note date"
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button
            className="button primary small"
            disabled={busy || !note.trim()}
          >
            <Plus size={15} />
            Add note
          </button>
        </div>
        <small>
          Leave the date empty to use the current time. Entered times use this
          device’s timezone.
        </small>
      </form>
      <div className="timeline">
        {[...(o.events || [])]
          .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))
          .map((event) => (
            <div className="timeline-item" key={event.id}>
              <span className="timeline-dot" />
              <div className="timeline-content">
                <div className="timeline-header">
                  <strong>{stageLabel(event.stage)}</strong>
                  <time>{formatDate(event.effectiveAt, timezone, true)}</time>
                  <button
                    className="text-button"
                    onClick={() => {
                      setEditing(event);
                      setEditNote(event.note);
                      setEditDate(localInput(event.effectiveAt));
                    }}
                  >
                    Edit
                  </button>
                </div>
                {editing?.id === event.id ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (
                        await mutate(
                          `/opportunities/${o.id}/events/${event.id}`,
                          {
                            revision: o.revision,
                            note: editNote,
                            effectiveAt: editedTimestamp(
                              editDate,
                              event.effectiveAt,
                            ),
                          },
                          "PATCH",
                        )
                      )
                        setEditing(null);
                    }}
                  >
                    <textarea
                      aria-label="Edit note"
                      rows={3}
                      value={editNote}
                      onChange={(e) => setEditNote(e.target.value)}
                    />
                    <input
                      required
                      aria-label="Corrected event date"
                      type="datetime-local"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                    />
                    <div className="form-actions">
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </button>
                      <button className="button primary small" disabled={busy}>
                        Save correction
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="preserve-lines">
                    {event.note || "Entered this stage."}
                  </p>
                )}
                <small>
                  Recorded {formatDate(event.recordedAt, timezone, true)}
                  {event.corrections?.length
                    ? ` · ${event.corrections.length} correction${event.corrections.length === 1 ? "" : "s"} retained`
                    : ""}
                </small>
              </div>
            </div>
          ))}
      </div>
    </>
  );
}
function Activities({
  o,
  timezone,
  busy,
  mutate,
}: {
  o: Opportunity;
  timezone: string;
  busy: boolean;
  mutate: (path: string, body: unknown, method?: string) => Promise<boolean>;
}) {
  const empty = {
    kind: "interview",
    type: "video",
    title: "",
    scheduledAt: "",
    status: "planned",
    notes: "",
    contact: "",
    isFinal: false,
  };
  const [form, setForm] = useState(empty),
    [open, setOpen] = useState(false),
    [editId, setEditId] = useState("");
  function edit(a: Activity) {
    setForm({
      kind: a.kind,
      type: a.type,
      title: a.title,
      scheduledAt: localInput(a.scheduledAt),
      status: a.status,
      notes: a.notes,
      contact: a.contact,
      isFinal: a.isFinal,
    });
    setEditId(a.id);
    setOpen(true);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (
      await mutate(
        `/opportunities/${o.id}/activities${editId ? `/${editId}` : ""}`,
        {
          ...form,
          scheduledAt: editedTimestamp(
            form.scheduledAt,
            editId
              ? o.activities?.find((a) => a.id === editId)?.scheduledAt
              : undefined,
          ),
          revision: o.revision,
        },
        editId ? "PATCH" : "POST",
      )
    ) {
      setOpen(false);
      setEditId("");
      setForm(empty);
    }
  }
  return (
    <>
      <div className="section-intro with-action">
        <div>
          <h3>Keep the conversation moving.</h3>
          <p>Add as many interviews and communications as you need.</p>
        </div>
        <button
          className="button secondary small"
          onClick={() => {
            setForm(empty);
            setEditId("");
            setOpen(!open);
          }}
        >
          <Plus size={15} />
          Add activity
        </button>
      </div>
      {open && (
        <form className="inset-form" onSubmit={submit}>
          <div className="form-grid">
            <Field label="Activity">
              <select
                value={form.kind}
                onChange={(e) =>
                  setForm({
                    ...form,
                    kind: e.target.value,
                    type:
                      e.target.value === "communication" ? "email" : "video",
                  })
                }
              >
                <option value="interview">Interview / assessment</option>
                <option value="communication">Communication</option>
              </select>
            </Field>
            <Field label="Format">
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {[
                  ["text", "Text / written"],
                  ["phone", "Phone"],
                  ["video", "Video"],
                  ["in-person", "In-person"],
                  ["assessment", "Assessment"],
                  ["email", "Email"],
                  ["other", "Other"],
                ].map(([id, label]) => (
                  <option value={id} key={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Title" wide>
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="First conversation, technical interview…"
              />
            </Field>
            <Field label="Date and time" hint="Uses this device’s timezone.">
              <input
                type="datetime-local"
                value={form.scheduledAt}
                onChange={(e) =>
                  setForm({ ...form, scheduledAt: e.target.value })
                }
              />
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="planned">Planned</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </Field>
            <Field label="Contact / participants" wide>
              <input
                value={form.contact}
                onChange={(e) => setForm({ ...form, contact: e.target.value })}
              />
            </Field>
            <Field label="Notes / preparation" wide>
              <textarea
                rows={4}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
            {form.kind === "interview" && (
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={form.isFinal}
                  onChange={(e) =>
                    setForm({ ...form, isFinal: e.target.checked })
                  }
                />
                Final-stage interview
              </label>
            )}
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="button secondary small"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button className="button primary small" disabled={busy}>
              {busy ? <Busy text="Saving…" /> : "Save activity"}
            </button>
          </div>
        </form>
      )}
      {!o.activities?.length && !open ? (
        <div className="empty-state">
          <MessageSquare size={28} />
          <h3>Your conversations will live here.</h3>
          <p>
            Keep interview dates, preparation, contacts, and follow-ups
            together.
          </p>
        </div>
      ) : (
        <div className="activity-list">
          {[...(o.activities || [])]
            .sort((a, b) =>
              (b.scheduledAt || b.createdAt).localeCompare(
                a.scheduledAt || a.createdAt,
              ),
            )
            .map((a) => (
              <article className="activity-card" key={a.id}>
                <div className="activity-icon">
                  {a.kind === "interview" ? (
                    <CalendarDays size={20} />
                  ) : (
                    <MessageSquare size={20} />
                  )}
                </div>
                <div>
                  <div className="activity-heading">
                    <h4>{a.title}</h4>
                    <Badge kind={a.status === "completed" ? "green" : "muted"}>
                      {a.status}
                    </Badge>
                    {a.isFinal && <Badge kind="purple">Final stage</Badge>}
                  </div>
                  <p className="activity-meta">
                    {a.type} ·{" "}
                    {a.scheduledAt
                      ? formatDate(a.scheduledAt, timezone, true)
                      : "Date to be confirmed"}
                    {a.contact ? ` · ${a.contact}` : ""}
                  </p>
                  {a.notes && <p className="preserve-lines">{a.notes}</p>}
                  {!!a.history?.length && (
                    <small>
                      {a.history.length} earlier revision
                      {a.history.length === 1 ? "" : "s"} retained
                    </small>
                  )}
                </div>
                <button className="text-button" onClick={() => edit(a)}>
                  Edit
                </button>
              </article>
            ))}
        </div>
      )}
    </>
  );
}
function Documents({
  documents,
  opportunityId,
  timezone,
  onChanged,
  onError,
}: {
  documents: BoardDocument[];
  opportunityId?: string;
  timezone: string;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [kind, setKind] = useState(opportunityId ? "jd" : "reference"),
    [status, setStatus] = useState("draft"),
    [notes, setNotes] = useState(""),
    [busy, setBusy] = useState(false);
  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      await api(
        "/documents",
        json({
          opportunityId,
          name: file.name,
          contentBase64: await readFile(file),
          kind,
          status,
          notes,
        }),
      );
      setFile(null);
      setNotes("");
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="section-intro">
        <h3>
          {opportunityId
            ? "The right documents, at every step."
            : "Your experience is the starting point."}
        </h3>
        <p>
          {opportunityId
            ? "Each upload creates a separate version. Submitted files stay preserved."
            : "Add master CVs, previous JDs, templates, and career evidence. Choose what to reuse later."}
        </p>
      </div>
      <form className="document-upload" onSubmit={upload}>
        <label className={`upload-drop ${file ? "has-file" : ""}`}>
          <Upload size={21} />
          <strong>{file ? file.name : "Choose a document"}</strong>
          <span>PDF, Word, or text · up to 15 MB</span>
          <input
            key={file?.name || "empty"}
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        {file && (
          <>
            <div className="form-grid">
              <Field label="Document type">
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  {[
                    ["jd", "Job description"],
                    ["cv", "CV"],
                    ["cover", "Cover letter"],
                    ["reference", "Reference material"],
                    ["other", "Other"],
                  ].map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                  <option value="submitted">Submitted</option>
                </select>
              </Field>
              <Field label="Notes" wide>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Source, purpose, or version notes"
                />
              </Field>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="button secondary small"
                onClick={() => setFile(null)}
              >
                Cancel
              </button>
              <button className="button primary small" disabled={busy}>
                {busy ? (
                  <Busy text="Uploading…" />
                ) : (
                  <>
                    <Upload size={15} />
                    Upload document
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </form>
      <div className="document-list">
        {documents.map((doc) => (
          <article className="document-row" key={doc.id}>
            <span className="document-icon">
              <FileText size={21} />
            </span>
            <div className="document-name">
              <a href={doc.url || `/api/documents/${doc.id}/content`} download>
                {doc.name}
              </a>
              <small>
                {doc.kind} · v{doc.version} ·{" "}
                {Math.max(1, Math.round(doc.size / 1024))} KB ·{" "}
                {formatDate(doc.createdAt, timezone)}
              </small>
              {doc.notes && <p>{doc.notes}</p>}
            </div>
            {doc.status === "submitted" ? (
              <Badge kind="green">
                <ShieldCheck size={11} />
                Submitted
              </Badge>
            ) : (
              <select
                className="compact-select"
                aria-label={`Status of ${doc.name}`}
                value={doc.status}
                onChange={async (e) => {
                  try {
                    await api(
                      `/documents/${doc.id}`,
                      json(
                        { status: e.target.value, revision: doc.revision },
                        "PATCH",
                      ),
                    );
                    onChanged();
                  } catch (error) {
                    onError(error);
                  }
                }}
              >
                <option value="draft">Draft</option>
                <option value="approved">Approved</option>
                <option value="submitted">Submitted</option>
              </select>
            )}
            <a
              className="icon-button"
              href={doc.url || `/api/documents/${doc.id}/content`}
              download
              aria-label={`Download ${doc.name}`}
            >
              <ArrowDownToLine size={17} />
            </a>
          </article>
        ))}
      </div>
      {!documents.length && (
        <p className="quiet-empty">
          No documents yet. Add one above to keep everything together.
        </p>
      )}
    </>
  );
}
function Summary({ o, timezone }: { o: Opportunity; timezone: string }) {
  const entries = [
    ...(o.events || []).map((e) => ({
      date: e.effectiveAt,
      title: stageLabel(e.stage),
      text: e.note || "Entered this stage.",
    })),
    ...(o.activities || []).map((a) => ({
      date: a.scheduledAt || a.createdAt,
      title: `${a.kind === "interview" ? "Interview" : "Communication"}: ${a.title}`,
      text: [
        `${a.type} · ${a.status}${a.isFinal ? " · Final stage" : ""}`,
        a.contact,
        a.notes,
      ]
        .filter(Boolean)
        .join("\n"),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const summary = [
    `${o.role} — ${o.company}`,
    `Stage: ${stageLabel(o.stage)}${o.outcome ? ` | Outcome: ${o.outcome}` : ""}`,
    o.url ? `Job link: ${o.url}` : "",
    o.nextAction
      ? `Next action: ${o.nextAction}${o.nextActionDate ? ` (${formatDate(o.nextActionDate)})` : ""}`
      : "",
    "HISTORY",
    ...entries.flatMap((e) => [
      `${formatDate(e.date, timezone, true)} — ${e.title}`,
      e.text,
      "",
    ]),
    "DOCUMENTS",
    ...(o.documents || []).map(
      (d) => `${d.name} — ${d.kind}, v${d.version}, ${d.status}`,
    ),
  ]
    .filter((x) => x !== undefined)
    .join("\n");
  return (
    <>
      <div className="section-intro with-action">
        <div>
          <h3>The whole story, in one place.</h3>
          <p>
            A chronological summary of your notes, decisions, and conversations.
            No AI required.
          </p>
        </div>
        <button
          className="button secondary small"
          onClick={() =>
            download(`${o.company}-${o.role}-summary.txt`, summary)
          }
        >
          <ArrowDownToLine size={15} />
          Download
        </button>
      </div>
      <pre className="summary-text">{summary}</pre>
    </>
  );
}
function Library({
  onError,
  timezone,
}: {
  onError: (e: unknown) => void;
  timezone: string;
}) {
  const [docs, setDocs] = useState<BoardDocument[]>([]),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState("");
  async function load() {
    try {
      const r = await api<{ documents: BoardDocument[] }>("/documents");
      setDocs(r.documents.filter((d) => !d.opportunityId));
    } catch (e) {
      onError(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <main className="content-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">BUILT ON YOUR EXPERIENCE</div>
          <h1>
            Your reference library<span className="heading-dot">.</span>
          </h1>
          <p>
            A reusable home for career evidence, templates, and previous
            documents.
          </p>
        </div>
        <Badge kind="green">
          {docs.length} document{docs.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <div className="content-panel">
        <div className="search-input library-search">
          <Search size={16} />
          <input
            aria-label="Search reference documents"
            placeholder="Find a reference document…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {loading ? (
          <Busy text="Opening your library…" />
        ) : (
          <Documents
            documents={docs.filter((d) =>
              `${d.name} ${d.notes} ${d.kind}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )}
            timezone={timezone}
            onChanged={() => void load()}
            onError={onError}
          />
        )}
      </div>
      <div className="gentle-note">
        <CircleHelp size={18} />
        <p>
          Previous job descriptions provide context. Your CVs and approved
          career evidence establish your experience.
        </p>
      </div>
    </main>
  );
}
function SettingsPage({
  settings,
  onSaved,
  onError,
  onNotice,
}: {
  settings: Settings;
  onSaved: (s: Settings) => void;
  onError: (e: unknown) => void;
  onNotice: (s: string) => void;
}) {
  const [form, setForm] = useState(settings),
    [busy, setBusy] = useState(false),
    [backingUp, setBackingUp] = useState(false);
  useEffect(() => setForm(settings), [settings]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const s = await api<Settings>(
        "/settings",
        json(
          {
            timezone: form.timezone,
            documentsSubdir: form.documentsSubdir,
            referenceSubdir: form.referenceSubdir,
            backupSubdir: form.backupSubdir,
            pendingHostPath: form.pendingHostPath,
            aiEnabled: false,
          },
          "PATCH",
        ),
      );
      onSaved(s);
      onNotice(
        s.pendingHostPath
          ? "Settings saved. Apply the new host folder with ./board restart on the hosting machine."
          : "Settings saved.",
      );
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="content-page settings-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">SET UP YOUR WAY</div>
          <h1>
            A workspace that fits<span className="heading-dot">.</span>
          </h1>
          <p>Your files, preferences, and future connections.</p>
        </div>
      </div>
      <form onSubmit={save}>
        <section className="settings-section">
          <div className="settings-section-heading">
            <FolderOpen size={21} />
            <div>
              <h2>Files & storage</h2>
              <p>
                These locations are on the hosting machine, shared by all your
                devices.
              </p>
            </div>
          </div>
          <div className="location-box">
            <small>CURRENT DOCUMENT ROOT</small>
            <code>{settings.hostDocumentsPath || settings.storagePath}</code>
            <Badge kind="green">
              <Check size={11} />
              Connected
            </Badge>
          </div>
          <div className="form-grid">
            <Field
              label="Application document subfolder"
              hint="Relative to your document root."
            >
              <input
                required
                value={form.documentsSubdir}
                onChange={(e) =>
                  setForm({ ...form, documentsSubdir: e.target.value })
                }
              />
            </Field>
            <Field label="Reference library subfolder">
              <input
                required
                value={form.referenceSubdir}
                onChange={(e) =>
                  setForm({ ...form, referenceSubdir: e.target.value })
                }
              />
            </Field>
            <Field
              label="Backup subfolder"
              hint="Managed files are included in backups. Keep backups private."
            >
              <input
                required
                value={form.backupSubdir}
                onChange={(e) =>
                  setForm({ ...form, backupSubdir: e.target.value })
                }
              />
            </Field>
            <Field label="Display timezone">
              <input
                required
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                placeholder="Europe/London"
              />
            </Field>
            <Field
              label="New host document root (optional)"
              wide
              hint="Enter an absolute folder path on the host. Save, then run ./board restart on that machine to apply it. Existing files stay at their original locations."
            >
              <input
                value={form.pendingHostPath || ""}
                onChange={(e) =>
                  setForm({ ...form, pendingHostPath: e.target.value })
                }
                placeholder="/path/on/the/hosting-machine"
              />
            </Field>
          </div>
          {settings.pendingHostPath && (
            <div className="pending-note">
              <Clock3 size={17} />
              <span>
                New location pending: <code>{settings.pendingHostPath}</code>
                <br />
                Apply with <code>./board restart</code> on your host.
              </span>
            </div>
          )}
          <div className="form-actions">
            <button className="button primary" disabled={busy}>
              {busy ? (
                <Busy text="Saving…" />
              ) : (
                <>
                  <Check size={16} />
                  Save settings
                </>
              )}
            </button>
          </div>
        </section>
      </form>
      <section className="settings-section">
        <div className="settings-section-heading">
          <ShieldCheck size={21} />
          <div>
            <h2>Backups & export</h2>
            <p>Keep a record of your workspace and documents.</p>
          </div>
        </div>
        <div className="settings-action">
          <div>
            <strong>Create a private backup</strong>
            <p>
              Save a consistent database snapshot and managed documents in your
              configured backup subfolder. This includes account data; keep it
              private. Portable restore is planned.
            </p>
          </div>
          <button
            className="button secondary"
            disabled={backingUp}
            onClick={async () => {
              setBackingUp(true);
              try {
                const r = await api<{ name: string; location?: string }>(
                  "/backup",
                  json({}),
                );
                onNotice(
                  `Backup created: ${(settings.hostDocumentsPath || settings.storagePath).replace(/\/$/, "")}/${settings.backupSubdir}/${r.name}`,
                );
              } catch (e) {
                onError(e);
              } finally {
                setBackingUp(false);
              }
            }}
          >
            {backingUp ? (
              <Busy text="Backing up…" />
            ) : (
              <>
                <Folder size={16} />
                Create backup
              </>
            )}
          </button>
        </div>
        <div className="settings-action">
          <div>
            <strong>Export board records</strong>
            <p>
              Download your opportunity history and document manifest as JSON.
              Document files and login credentials are excluded.
            </p>
          </div>
          <button
            className="button secondary"
            onClick={async () => {
              try {
                const r = await api("/export");
                download(
                  `opportunity-board-${today(settings.timezone)}.json`,
                  JSON.stringify(r, null, 2),
                  "application/json",
                );
              } catch (e) {
                onError(e);
              }
            }}
          >
            <ArrowDownToLine size={16} />
            Export records
          </button>
        </div>
      </section>
      <section className="settings-section ai-settings">
        <div className="settings-section-heading">
          <Sparkles size={21} />
          <div>
            <h2>AI connections</h2>
            <p>
              Optional help for identification, fit review, and document
              generation.
            </p>
          </div>
          <Badge>Coming next</Badge>
        </div>
        <p className="ai-explanation">
          The connection layer will let you choose your provider later. This
          first version lets you track applications manually; no documents are
          sent to an AI service.
        </p>
        <div className="ai-stages">
          {["Extract job details", "Review fit", "Draft CV & cover letter"].map(
            (t, i) => (
              <span key={t}>
                <span>{i + 1}</span>
                {t}
              </span>
            ),
          )}
        </div>
      </section>
    </main>
  );
}
