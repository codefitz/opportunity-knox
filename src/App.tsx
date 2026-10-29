import ReliabilitySettings from "./components/ReliabilitySettings";
import {useUploadQueue} from "./components/useUploadQueue";
import {calendarDay} from "./lib/dashboard";
import OpportunityFiltersToolbar from "./components/OpportunityFilters";
import {defaultOpportunityFilters,filterOpportunities,overdueOpportunityIds} from "./lib/opportunity-filters";
import {OpportunityReviewForm,OpportunityOffers} from "./components/OpportunityWorkflow";
import Feedback from "./components/Feedback";
import ApplicationPacks from "./components/ApplicationPacks";
import DocumentCategory from "./components/DocumentCategory";
import documentCategories from "../server/document-categories.json";
import DocumentStudio from "./components/DocumentStudio";
import DocumentConnections from "./components/DocumentConnections";
import BuddyWorkspace from "./components/BuddyWorkspace";
import DecisionReview, { FitCriteria } from "./components/DecisionReview";
import VectorIndex from "./components/VectorIndex";
import {
  useState,
  useMemo,
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
  FolderInput,
  LayoutGrid,
  ChartNoAxesCombined,
  ListTodo,
  List,
  LoaderCircle,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RotateCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  api,
  ApiError,
  json,
  readFile,
  collectDroppedFiles,
  collectFileList,
  download,
  localInput,
  iso,
  formatDate,
  editedTimestamp,
  type DroppedFile,
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
  type Profile,
  type Task,
  type Appearance,
  type ObsidianStatus,
} from "./types";

import JobLookup, {
  JOB_FIELDS,
  lookupNote,
  type JobLookupResult,
} from "./components/JobLookup";

import Dashboard from "./components/Dashboard";
import CareerBuddy, { type BuddySource } from "./components/CareerBuddy";
import CareerBuddySettings from "./components/CareerBuddySettings";
import EmbeddingSettings from "./components/EmbeddingSettings";
import Todos from "./components/Todos";
import ProfileSettings, {
  ThemeSettings,
  applyTheme,
  appearanceFrom,
} from "./components/ProfileSettings";
import "./themes.css";

type Page =
  "dashboard" | "opportunities" | "board" | "todos" | "library" | "buddy" | "settings";
const PAGE_LABELS: Record<Page, string> = {
  dashboard: "Dashboard",
  opportunities: "Opportunities",
  board: "Kanban board",
  todos: "To-do list",
  library: "Career library",
  buddy: "Career Buddy",
  settings: "Settings",
};
function routePage(): Page {
  const route = window.location.hash.replace(/^#\//, "").split("?")[0];
  return Object.hasOwn(PAGE_LABELS, route) ? (route as Page) : "dashboard";
}
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
  const [appearanceDraft, setAppearanceDraft] = useState<Appearance | null>(
      null,
    ),
    [appearanceSaving, setAppearanceSaving] = useState(false),
    [appearanceFailed, setAppearanceFailed] = useState(false);
  const appearanceDraftRef = useRef<Appearance | null>(null),
    appearanceSettingsRef = useRef<Settings | null>(null),
    appearancePendingRef = useRef<Partial<Appearance>>({}),
    appearanceTimerRef = useRef<number | null>(null),
    appearanceSavingRef = useRef(false),
    appearanceRevision = useRef(0);
  appearanceSettingsRef.current = settings;
  const [page, setPage] = useState<Page>(routePage),
    [opportunityFilters, setOpportunityFilters] = useState({...defaultOpportunityFilters,tags:[] as string[]});
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [newOpen, setNewOpen] = useState(false),
    [newUrl, setNewUrl] = useState(""),
    [newFile, setNewFile] = useState<File | null>(null),
    [newText, setNewText] = useState("");
  const [profile, setProfile] = useState<Profile>({
    name: "Your workspace",
    avatarUrl: "",
    revision: 0,
  });
  const [tasks, setTasks] = useState<Task[]>([]),
    [referenceCount, setReferenceCount] = useState(0),
    [refreshing, setRefreshing] = useState(false),
    [restarting, setRestarting] = useState(false);
  const view = page === "board" ? "board" : "list";
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
        window.location.pathname + window.location.search + "#/dashboard",
      );
    api<Session>("/session")
      .then(setSession)
      .catch((e) => setBootError(displayError(e)));
  }, []);
  function navigate(next: Page) {
    if (window.location.hash !== `#/${next}`) window.location.hash = `/${next}`;
    setPage(next);
  }
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  useEffect(() => {
    const changed = () => setPage(routePage());
    window.addEventListener("hashchange", changed);
    if (!window.location.hash)
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}#/dashboard`,
      );
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    if (!settings) return;
    applyTheme(appearanceDraft || appearanceFrom(settings), !appearanceDraft);
  }, [
    page,
    settings?.theme,
    settings?.themeAccent,
    settings?.themeBackground,
    appearanceDraft,
  ]);
  async function load(background = false) {
    const revision = appearanceRevision.current;
    if (!background) setLoading(true);
    setRefreshing(true);
    try {
      const data = await api<{
        opportunities: Opportunity[];
        settings: Settings;
        profile: Profile;
        tasks: Task[];
        referenceCount: number;
      }>("/board");
      setOpportunities(data.opportunities);
      if (revision === appearanceRevision.current) setSettings(data.settings);
      else
        setSettings((current) =>
          current
            ? { ...data.settings, ...appearanceFrom(current) }
            : data.settings,
        );
      setProfile(
        data.profile || { name: "Your workspace", avatarUrl: "", revision: 0 },
      );
      setTasks(data.tasks || []);
      setReferenceCount(data.referenceCount || 0);
    } catch (e) {
      report(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }
  useEffect(() => {
    if (session?.authenticated) void load();
  }, [session?.authenticated]);
  useEffect(() => {
    if (session?.authenticated && (page === "dashboard" || page === "todos"))
      void load(true);
  }, [page]);
  useEffect(() => {
    if (!session?.authenticated) return;
    const refresh = () => {
      const element = document.activeElement as HTMLElement | null;
      if (
        page === "settings" ||
        newOpen ||
        selected ||
        document.querySelector('[data-editing="true"]') ||
        element?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(element?.tagName || "")
      )
        return;
      void load(true);
    };
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [session?.authenticated, page, newOpen, selected]);
  function scheduleAppearanceSave() {
    if (appearanceTimerRef.current !== null)
      window.clearTimeout(appearanceTimerRef.current);
    appearanceTimerRef.current = window.setTimeout(() => {
      appearanceTimerRef.current = null;
      void saveAppearance();
    }, 250);
  }
  function previewAppearance(patch: Partial<Appearance>) {
    const saved = appearanceSettingsRef.current;
    if (!saved) return;
    const next = {
      ...(appearanceDraftRef.current || appearanceFrom(saved)),
      ...patch,
    };
    appearanceDraftRef.current = next;
    appearancePendingRef.current = {
      ...appearancePendingRef.current,
      ...patch,
    };
    setAppearanceDraft(next);
    setAppearanceFailed(false);
    if (
      patch.theme !== undefined ||
      Object.keys(patch).length > 1 ||
      Object.values(patch).every((value) => value === "")
    ) {
      if (appearanceTimerRef.current !== null)
        window.clearTimeout(appearanceTimerRef.current);
      appearanceTimerRef.current = null;
      void saveAppearance();
    } else scheduleAppearanceSave();
  }
  async function saveAppearance() {
    if (
      appearanceSavingRef.current ||
      !Object.keys(appearancePendingRef.current).length
    )
      return;
    const patch = appearancePendingRef.current;
    appearancePendingRef.current = {};
    appearanceSavingRef.current = true;
    appearanceRevision.current++;
    setAppearanceSaving(true);
    let failed = false;
    try {
      const saved = await api<Settings>("/settings", {
        ...json(patch, "PATCH"),
        keepalive: true,
      });
      appearanceRevision.current++;
      appearanceSettingsRef.current = saved;
      setSettings(saved);
      if (Object.keys(appearancePendingRef.current).length) {
        const next = {
          ...appearanceFrom(saved),
          ...appearancePendingRef.current,
        };
        appearanceDraftRef.current = next;
        setAppearanceDraft(next);
      } else {
        appearanceDraftRef.current = null;
        setAppearanceDraft(null);
      }
      setAppearanceFailed(false);
    } catch (e) {
      appearanceRevision.current++;
      appearancePendingRef.current = {
        ...patch,
        ...appearancePendingRef.current,
      };
      setAppearanceFailed(true);
      failed = true;
      report(e);
    } finally {
      appearanceSavingRef.current = false;
      setAppearanceSaving(false);
      if (!failed && Object.keys(appearancePendingRef.current).length)
        scheduleAppearanceSave();
    }
  }
  function report(e: unknown) {
    setError(displayError(e));
    if (e instanceof ApiError && e.status === 401)
      setSession({
        authenticated: false,
        setupRequired: false,
        setupTokenRequired: false,
      });
  }
  async function restartBoard() {
    if (restarting) return;
    setRestarting(true);
    setError("");
    setNotice(
      "Updating and restarting your workspace… The page will refresh automatically once ready.",
    );
    try {
      const restart = await api<{ requestId: string; hostManaged: boolean }>("/restart", json({}));
      const deadline = Date.now() + 90000;
      await new Promise((r) => window.setTimeout(r, 2500));
      let reconnected = false;
      while (Date.now() < deadline) {
        try {
          await api<{ ok: boolean }>("/health");
          if (restart.hostManaged) {
            const status = await api<{ requestId?: string; state: string; message?: string }>("/restart/status");
            if (status.requestId !== restart.requestId || status.state === "queued" || status.state === "running") {
              await new Promise((r) => window.setTimeout(r, 1000));
              continue;
            }
            if (status.state === "failed") {
              setError(status.message || "The host could not restart the board. Your settings are still pending.");
              return;
            }
            if (status.state !== "succeeded") continue;
          }
          reconnected = true;
          await new Promise((r) => window.setTimeout(r, 400));
          window.location.reload();
          return;
        } catch {
          await new Promise((r) => window.setTimeout(r, 1000));
        }
      }
      if (!reconnected)
        setError(
          "The board is taking longer than expected to restart. Refresh the page or check ./board logs.",
        );
    } catch (e) {
      report(e);
    } finally {
      setRestarting(false);
    }
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
  const filterTimezone = settings?.timezone || "Europe/London";
  const filterNow = new Date();
  const overdueIds = overdueOpportunityIds(opportunities,tasks,calendarDay(filterNow,filterTimezone));
  const filtered = filterOpportunities(opportunities,opportunityFilters,overdueIds,filterTimezone,filterNow);
  const active = opportunities.filter((o) => !o.outcome),
    interviews = active.filter((o) =>
      ["interviews", "final-interview"].includes(o.stage),
    ),
    overdue = active.filter(o => overdueIds.has(o.id));
  if (bootError)
    return (
      <div className="auth-screen">
        <Feedback authenticated={false}/>
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
        <Feedback authenticated={false}/>
        <Busy text="Opening your workspace…" />
      </div>
    );
  if (!session.authenticated)
    return <><Feedback authenticated={false}/><Auth session={session} token={token} onDone={setSession} /></>;
  return (
    <div className="app-shell">
      <Feedback authenticated={true}/>
      <aside className="sidebar">
        <a
          className="brand"
          href="#/dashboard"
          onClick={(e) => {
            e.preventDefault();
            navigate("dashboard");
          }}
        >
          <span className="brand-mark">
            <LayoutGrid size={20} />
          </span>
          <span>
            Opportunity Knox<span className="brand-sub">YOUR NEXT CHAPTER</span>
          </span>
        </a>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav aria-label="Main navigation">
          {(
            [
              {
                id: "dashboard",
                label: "Dashboard",
                icon: ChartNoAxesCombined,
              },
              {
                id: "opportunities",
                label: "Opportunities",
                icon: BriefcaseBusiness,
              },
              { id: "board", label: "Kanban board", icon: LayoutGrid },
              { id: "todos", label: "To-do list", icon: ListTodo },
              { id: "library", label: "Career library", icon: FolderOpen },
              { id: "buddy", label: "Career Buddy", icon: Sparkles },
              { id: "settings", label: "Settings", icon: Settings2 },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={page === item.id ? "nav-item active" : "nav-item"}
              aria-current={page === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} />
              {item.label}
              {item.id === "opportunities" && (
                <span className="nav-count">{active.length}</span>
              )}
              {item.id === "todos" && tasks.some((t) => !t.completed) && (
                <span className="nav-count">
                  {tasks.filter((t) => !t.completed).length}
                </span>
              )}
            </button>
          ))}
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
        <div className="sidebar-profile">
          <button
            className="profile"
            aria-label={`Edit profile for ${profile.name}`}
            onClick={() => navigate("settings")}
          >
            <span className="avatar">
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="" />
              ) : (
                initials(profile.name)
              )}
            </span>
            <span>
              <strong>{profile.name}</strong>
              <small>Edit your profile</small>
            </span>
            <Settings2 size={15} />
          </button>
          <button
            className="signout-button"
            disabled={restarting}
            onClick={() => void restartBoard()}
          >
            <RotateCw size={14} className={restarting ? "spin" : undefined} />
            {restarting ? "Restarting…" : "Update & restart"}
          </button>
          <button
            className="signout-button"
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
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>{PAGE_LABELS[page]}</strong>
          </span>
          <span className="private-label">
            <span />
            Private workspace
          </span>
          <div className="topbar-mobile-profile">
            <button
              className="avatar"
              aria-label={`Edit profile for ${profile.name}`}
              onClick={() => navigate("settings")}
            >
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="" />
              ) : (
                initials(profile.name)
              )}
            </button>
            <button
              className="icon-button"
              aria-label="Sign out"
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
              <LogOut size={14} />
            </button>
          </div>
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
        {page === "dashboard" &&
          (loading ? (
            <div className="loading-board">
              <Busy text="Opening your dashboard…" />
            </div>
          ) : (
            <Dashboard
              opportunities={opportunities}
              tasks={tasks}
              profile={profile}
              timezone={settings?.timezone || "Europe/London"}
              referenceCount={referenceCount}
              onOpenOpportunity={(id) => void openOpportunity(id)}
              onNavigate={navigate}
              onAddOpportunity={add}
              onRefresh={() => void load(true)}
              refreshing={refreshing}
            />
          ))}
        {page === "todos" &&
          (loading ? (
            <div className="loading-board">
              <Busy text="Opening your to-do list…" />
            </div>
          ) : (
            <Todos
              tasks={tasks}
              opportunities={opportunities}
              timezone={settings?.timezone || "Europe/London"}
              onChanged={() => void load(true)}
              onError={report}
              onOpenOpportunity={(id) => void openOpportunity(id)}
            />
          ))}
        {(page === "board" || page === "opportunities") && (
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
                  {page === "board"
                    ? "Your opportunity board"
                    : "Your opportunities"}
                  <span className="heading-dot">.</span>
                </h1>
                <p>
                  {page === "board"
                    ? "See the whole journey. Move each possibility forward at your own pace."
                    : "Every possibility, application, and next action in one place."}
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
                label="Overdue actions"
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
            <OpportunityFiltersToolbar value={opportunityFilters} onChange={setOpportunityFilters} opportunities={opportunities} resultCount={filtered.length} board={page==="board"} timezone={filterTimezone}/>
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
                {!opportunities.length && (
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
        {page === "buddy" && <BuddyWorkspace onError={report} onChanged={()=>void load(true)} />}
        {page === "library" && (
          <Library
            onError={report}
            onNotice={setNotice}
            onChanged={() => void load(true)}
            onRestart={() => void restartBoard()}
            restarting={restarting}
            timezone={settings?.timezone || "Europe/London"}
          />
        )}
        {page === "settings" && settings && (
          <SettingsPage
            settings={settings}
            appearance={appearanceDraft || appearanceFrom(settings)}
            appearanceDirty={Boolean(appearanceDraft)}
            appearanceSaving={
              appearanceSaving || Boolean(appearanceDraft && !appearanceFailed)
            }
            appearanceFailed={appearanceFailed}
            onAppearanceChange={previewAppearance}
            onAppearanceSave={() => void saveAppearance()}
            profile={profile}
            onProfileSaved={setProfile}
            onSaved={setSettings}
            restarting={restarting}
            onRestart={() => void restartBoard()}
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
          onConfigureBuddy={() => {
            setSelected(null);
            navigate("settings");
            requestAnimationFrame(() =>
              document
                .getElementById("career-buddy-settings")
                ?.scrollIntoView({ block: "start" }),
            );
          }}
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
        <div className="eyebrow">OPPORTUNITY KNOX · YOUR NEXT CHAPTER</div>
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
            <Field
              label="Application route"
              hint="Where and how to apply; submission packs retain their own recorded route."
            >
              <input
                maxLength={10000}
                value={form.applicationRoute || ""}
                onChange={(e) =>
                  setForm({ ...form, applicationRoute: e.target.value })
                }
                placeholder="Employer portal, recruiter, email…"
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
  onConfigureBuddy,
}: {
  opportunity: Opportunity;
  timezone: string;
  onClose: () => void;
  onUpdate: (o: Opportunity) => void;
  onError: (e: unknown) => void;
  onReload: () => void;
  onConfigureBuddy: () => void;
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
          ["decision", "Fit assessment"],
          ["timeline", "Timeline & notes"],
          ["activities", "Interviews & comms"],
          ["offers", "Offers"],
          ["documents", "Documents"],
          ["summary", "Summary"],
          ["buddy", "Career Buddy"],
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
          <>
          <ApplicationPacks opportunity={o} timezone={timezone} onChanged={onReload} onError={onError}/>
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
          </>
        )}{" "}
        {tab === "decision" && <><OpportunityReviewForm key={`${o.id}-${o.revision}`} opportunity={o} timezone={timezone} busy={busy} mutate={mutate}/><DecisionReview opportunity={o} onError={onError} /></>}
        {tab === "offers" && <OpportunityOffers key={`${o.id}-${o.revision}`} opportunity={o} timezone={timezone} busy={busy} mutate={mutate}/>}
        {tab === "summary" && <Summary o={o} timezone={timezone} />}
        {tab === "buddy" && (
          <CareerBuddy
            opportunity={o}
            timezone={timezone}
            onUpdate={onUpdate}
            onError={onError}
            onConfigure={onConfigureBuddy}
          />
        )}
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
          "applicationRoute",
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
        <Field
          label="Application route"
          hint="Where and how to apply; submission packs retain their own recorded route."
        >
          <input
            maxLength={10000}
            value={form.applicationRoute}
            onChange={set("applicationRoute")}
            placeholder="Employer portal, recruiter, email…"
          />
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
                  <strong>
                    {event.title
                      ? `${event.title} · ${stageLabel(event.stage)}`
                      : stageLabel(event.stage)}
                  </strong>
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
    direction: "",
    channel: "",
    followUp: "",
    followUpDate: "",
    followUpDone: false,
    documentIds: [] as string[],
  };
  const [form, setForm] = useState(empty),
    [open, setOpen] = useState(false),
    [editId, setEditId] = useState("");
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [files, setFiles] = useState<{ file: File; requestId: string }[]>([]);
  const [uploaded, setUploaded] = useState<BoardDocument[]>([]);
  const documents = [...(o.documents || []), ...uploaded].filter(
    (d, i, all) => all.findIndex((v) => v.id === d.id) === i,
  );
  function attachments(ids: string[] = []) {
    return ids.length ? (
      <ul className="activity-attachments">
        {ids.map((id) => {
          const doc = documents.find((d) => d.id === id);
          return (
            <li key={id}>
              {doc ? (
                <a
                  href={doc.url || `/api/documents/${id}/content`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {doc.name} · v{doc.version}
                </a>
              ) : (
                <span>Attachment unavailable (removed document)</span>
              )}
            </li>
          );
        })}
      </ul>
    ) : null;
  }
  function edit(a: Activity) {
    setError("");
    setFiles([]);
    setForm({
      kind: a.kind,
      type: a.type,
      title: a.title,
      scheduledAt: localInput(a.scheduledAt),
      status: a.status,
      notes: a.notes,
      contact: a.contact,
      isFinal: a.isFinal,
      direction: a.direction || "",
      channel: a.channel || (a.kind === "communication" ? a.type : ""),
      followUp: a.followUp || "",
      followUpDate: a.followUpDate || "",
      followUpDone: a.followUpDone || false,
      documentIds: a.documentIds || [],
    });
    setEditId(a.id);
    setOpen(true);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const documentIds = [...form.documentIds];
      for (const item of files) {
        const doc = await api<BoardDocument>(
          "/documents",
          json({
            opportunityId: o.id,
            name: item.file.name,
            kind: "other",
            status: "draft",
            contentBase64: await readFile(item.file),
            importRequestId: item.requestId,
          }),
        );
        documentIds.push(doc.id);
        setUploaded((current) => [...current, doc]);
        setForm((current) => ({
          ...current,
          documentIds: [...new Set([...current.documentIds, doc.id])],
        }));
        setFiles((current) =>
          current.filter((v) => v.requestId !== item.requestId),
        );
      }
      if (
        await mutate(
          `/opportunities/${o.id}/activities${editId ? `/${editId}` : ""}`,
          {
            ...form,
            documentIds: [...new Set(documentIds)],
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
    } catch (e) {
      setError(
        `${displayError(e)} Uploaded files remain in this opportunity’s Documents tab; you can retry saving this activity.`,
      );
    } finally {
      setSaving(false);
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
          disabled={saving || busy}
          onClick={() => {
            setForm(empty);
            setFiles([]);
            setError("");
            setEditId("");
            setOpen(!open);
          }}
        >
          <Plus size={15} />
          Add activity
        </button>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {open && (
        <form className="inset-form" onSubmit={submit}>
          <fieldset className="activity-form-fields" disabled={saving || busy}>
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
                      channel:
                        e.target.value === "communication" ? "email" : "",
                      direction:
                        e.target.value === "communication"
                          ? form.direction
                          : "",
                      isFinal:
                        e.target.value === "interview" ? form.isFinal : false,
                    })
                  }
                >
                  <option value="interview">Interview / assessment</option>
                  <option value="communication">Communication</option>
                </select>
              </Field>
              {form.kind === "communication" ? (
                <>
                  <Field label="Direction">
                    <select
                      value={form.direction}
                      onChange={(e) =>
                        setForm({ ...form, direction: e.target.value })
                      }
                    >
                      <option value="">Not recorded</option>
                      <option value="incoming">Incoming</option>
                      <option value="outgoing">Outgoing</option>
                    </select>
                  </Field>
                  <Field label="Channel">
                    <input
                      maxLength={100}
                      list="activity-channels"
                      value={form.channel}
                      onChange={(e) =>
                        setForm({ ...form, channel: e.target.value })
                      }
                      placeholder="Email, LinkedIn, phone…"
                    />
                    <datalist id="activity-channels">
                      {[
                        "email",
                        "phone",
                        "text",
                        "video",
                        "in-person",
                        "LinkedIn",
                        "WhatsApp",
                        "recruiter portal",
                        "other",
                      ].map((v) => (
                        <option key={v} value={v} />
                      ))}
                    </datalist>
                  </Field>
                </>
              ) : (
                <Field
                  label="Interview type / format"
                  hint="Choose a suggestion or enter your own type."
                >
                  <input
                    required
                    maxLength={100}
                    list="interview-types"
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                  />
                  <datalist id="interview-types">
                    {[
                      "text",
                      "phone",
                      "video",
                      "in-person",
                      "assessment",
                      "technical panel",
                      "presentation",
                      "other",
                    ].map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                </Field>
              )}
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
                  <option value="rescheduled">Rescheduled</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </Field>
              <Field label="Contact / participants" wide>
                <input
                  value={form.contact}
                  onChange={(e) =>
                    setForm({ ...form, contact: e.target.value })
                  }
                />
              </Field>
              <Field label="Notes / preparation" wide>
                <textarea
                  rows={4}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </Field>
              <Field label="Follow-up" wide>
                <textarea
                  rows={2}
                  maxLength={50000}
                  value={form.followUp}
                  onChange={(e) =>
                    setForm({ ...form, followUp: e.target.value })
                  }
                  placeholder="Send a thank-you, ask about next steps…"
                />
              </Field>
              <Field label="Follow-up due date">
                <input
                  type="date"
                  value={form.followUpDate}
                  onChange={(e) =>
                    setForm({ ...form, followUpDate: e.target.value })
                  }
                />
              </Field>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={form.followUpDone}
                  onChange={(e) =>
                    setForm({ ...form, followUpDone: e.target.checked })
                  }
                />
                Follow-up completed
              </label>
              <fieldset className="activity-document-picker">
                <legend>Attachments</legend>
                <p className="quiet-empty">
                  Choose opportunity documents or upload files. Originals stay
                  in the Documents tab when a link is removed.
                </p>
                {documents.map((d) => (
                  <label className="check-field" key={d.id}>
                    <input
                      type="checkbox"
                      checked={form.documentIds.includes(d.id)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          documentIds: e.target.checked
                            ? [...form.documentIds, d.id]
                            : form.documentIds.filter((id) => id !== d.id),
                        })
                      }
                    />
                    {d.name} · v{d.version}
                  </label>
                ))}
                {form.documentIds
                  .filter((id) => !documents.some((d) => d.id === id))
                  .map((id) => (
                    <label className="check-field" key={id}>
                      <input
                        type="checkbox"
                        checked
                        onChange={() =>
                          setForm({
                            ...form,
                            documentIds: form.documentIds.filter(
                              (v) => v !== id,
                            ),
                          })
                        }
                      />
                      Unavailable attachment — untick to unlink
                    </label>
                  ))}
                <label>
                  Upload files (up to 15 MB each)
                  <input
                    type="file"
                    multiple
                    disabled={saving}
                    onChange={(e) => {
                      const selected = Array.from(e.target.files || []).map(
                        (file) => ({ file, requestId: crypto.randomUUID() }),
                      );
                      setFiles((current) => [...current, ...selected]);
                      e.target.value = "";
                    }}
                  />
                </label>
                {files.map((item) => (
                  <div key={item.requestId}>
                    {item.file.name}{" "}
                    <button
                      type="button"
                      className="text-button"
                      disabled={saving}
                      onClick={() =>
                        setFiles((current) => current.filter((v) => v !== item))
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </fieldset>
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
          </fieldset>
          <div className="form-actions">
            <button
              type="button"
              className="button secondary small"
              disabled={saving || busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button className="button primary small" disabled={busy || saving}>
              {busy || saving ? <Busy text="Saving…" /> : "Save activity"}
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
                    {a.kind === "communication"
                      ? [
                          a.direction || "Direction not recorded",
                          a.channel || a.type,
                        ].join(" · ")
                      : a.type}{" "}
                    ·{" "}
                    {a.scheduledAt
                      ? formatDate(a.scheduledAt, timezone, true)
                      : "Date to be confirmed"}
                    {a.contact ? ` · ${a.contact}` : ""}
                  </p>
                  {a.notes && <p className="preserve-lines">{a.notes}</p>}
                  {a.followUp && (
                    <p className="preserve-lines">
                      <strong>
                        Follow-up{a.followUpDone ? " (completed)" : ""}:
                      </strong>{" "}
                      {a.followUp}
                      {a.followUpDate
                        ? ` · Due ${formatDate(a.followUpDate, timezone)}`
                        : ""}
                    </p>
                  )}
                  {attachments(a.documentIds)}
                  {!!a.history?.length && (
                    <details className="activity-history">
                      <summary>
                        {a.history.length} earlier revision
                        {a.history.length === 1 ? "" : "s"} retained
                      </summary>
                      {[...a.history].reverse().map((h, i) => (
                        <article key={i}>
                          <strong>
                            Changed {formatDate(h.changedAt, timezone, true)}
                          </strong>
                          <p>
                            {h.title || a.title} · {h.kind || a.kind} ·{" "}
                            {h.channel || h.type || ""}
                            {h.direction ? ` · ${h.direction}` : ""} ·{" "}
                            {h.status}
                            {h.isFinal ? " · Final stage" : ""}
                          </p>
                          <p>
                            {h.scheduledAt
                              ? formatDate(h.scheduledAt, timezone, true)
                              : "Date to be confirmed"}
                            {h.contact ? ` · ${h.contact}` : ""}
                          </p>
                          {h.notes && (
                            <p className="preserve-lines">{h.notes}</p>
                          )}
                          {h.followUp && (
                            <p className="preserve-lines">
                              Follow-up{h.followUpDone ? " (completed)" : ""}:{" "}
                              {h.followUp}
                              {h.followUpDate
                                ? ` · Due ${formatDate(h.followUpDate, timezone)}`
                                : ""}
                            </p>
                          )}
                          {attachments(h.documentIds)}
                        </article>
                      ))}
                    </details>
                  )}
                </div>
                <button
                  className="text-button"
                  disabled={saving || busy}
                  onClick={() => edit(a)}
                >
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
  documents:allDocuments,
  opportunityId,
  timezone,
  onChanged,
  onError,
  onNotice,
  extraction,
  externalQueue,
  onExternalQueueConsumed,
  groupByFolder = false,
  splitByPrepared = false,
  sourceFilter = "split",
  onPrepareDocument,
  selectedTag = "",
  onSelectTag,
}: {
  documents: BoardDocument[];
  opportunityId?: string;
  timezone: string;
  onChanged: () => void;
  onError: (e: unknown) => void;
  onNotice?: (s: string) => void;
  extraction?: Record<string, BuddySource["extraction"]>;
  externalQueue?: DroppedFile[];
  onExternalQueueConsumed?: () => void;
  groupByFolder?: boolean;
  splitByPrepared?: boolean;
  sourceFilter?: "split" | "used" | "unused";
  onPrepareDocument?: (id: string, force: boolean) => Promise<void>;
  selectedTag?: string;
  onSelectTag?: (tag: string) => void;
}) {
  const [kind, setKind] = useState(opportunityId ? "jd" : "reference"),
    [status, setStatus] = useState("draft"),
    [notes, setNotes] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [batchUploads, setBatchUploads] = useState(false),
    [dragOver, setDragOver] = useState(false),
    [deletingId, setDeletingId] = useState(""),
    [confirmDeleteId, setConfirmDeleteId] = useState(""),
    [confirmDeleteFolderKey, setConfirmDeleteFolderKey] = useState(""),
    [deletingFolderKey, setDeletingFolderKey] = useState(""),
    [preparingDocId, setPreparingDocId] = useState(""),
    [editingTagsId, setEditingTagsId] = useState(""),
    [tagInput, setTagInput] = useState(""),
    [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>(
      {},
    ),
    [expandedSources, setExpandedSources] = useState({
      ready: true,
      unprepared: true,
    }),
    [selectedForMove, setSelectedForMove] = useState<string[]>([]),
    [moveDocuments, setMoveDocuments] = useState<BoardDocument[] | null>(null),
    [moveFolder, setMoveFolder] = useState(""),
    [moveError, setMoveError] = useState(""),
    [moving, setMoving] = useState(false);
  const [categoryFilter,setCategoryFilter]=useState(''),[uploadCategory,setUploadCategory]=useState(''),[bulkCategory,setBulkCategory]=useState(''),[categorising,setCategorising]=useState(false);
  const queue=useUploadQueue(opportunityId, options=>{setKind(options.kind);setStatus(options.status);setNotes(options.notes);setUploadCategory(options.category);setBatchUploads(options.batchUploads);});
  const files=queue.files,uploadAbort=useRef<AbortController|null>(null);
  useEffect(()=>()=>uploadAbort.current?.abort(),[]);
  useEffect(()=>{if(queue.ready)void queue.saveOptions({kind,status,notes,category:uploadCategory,batchUploads});},[queue.ready,kind,status,notes,uploadCategory,batchUploads]);
  const documents=useMemo(()=>allDocuments.filter(d=>!categoryFilter||d.category===categoryFilter),[allDocuments,categoryFilter]);
  async function categoriseSelected(){if(!bulkCategory||!selectedForMove.length)return;setCategorising(true);try{await api('/documents/categories',json({category:bulkCategory,documents:movableDocuments.filter(d=>selectedForMove.includes(d.id)).map(d=>({id:d.id,revision:d.revision??1}))}));setSelectedForMove([]);onChanged();onNotice?.('Document categories saved. Files stay in their current folders.');}catch(e){onError(e);}finally{setCategorising(false);}}
  const movableDocuments = documents.filter((d) => {
    const ready = extraction?.[d.id]?.status === "ready";
    return (
      !d.opportunityId &&
      d.status !== "submitted" &&
      (!splitByPrepared ||
        sourceFilter === "split" ||
        (sourceFilter === "used" ? ready : !ready))
    );
  });
  useEffect(() => {
    const available = new Set(movableDocuments.map((d) => d.id));
    setSelectedForMove((current) =>
      current.every((id) => available.has(id))
        ? current
        : current.filter((id) => available.has(id)),
    );
  }, [documents, sourceFilter, extraction]);
  function startMove(items: BoardDocument[]) {
    if (!items.length) return;
    const dirs = new Set(
      items.map((d) =>
        d.name.includes("/") ? d.name.slice(0, d.name.lastIndexOf("/")) : "",
      ),
    );
    setMoveFolder(dirs.size === 1 ? [...dirs][0] : "");
    setMoveError("");
    setMoveDocuments(items);
  }
  async function moveSelected(event: FormEvent) {
    event.preventDefault();
    if (!moveDocuments || moving) return;
    setMoving(true);
    setMoveError("");
    try {
      const result = await api<{
        documents: BoardDocument[];
        retainedOriginals: number;
      }>(
        "/documents/move",
        json({
          folder: moveFolder,
          documents: moveDocuments.map((d) => ({
            id: d.id,
            revision: d.revision ?? 1,
          })),
        }),
      );
      const movedIds = new Set(result.documents.map((d) => d.id));
      setSelectedForMove((current) =>
        current.filter((id) => !movedIds.has(id)),
      );
      setMoveDocuments(null);
      onChanged();
      onNotice?.(
        `Moved ${result.documents.length} document${result.documents.length === 1 ? "" : "s"}.${result.retainedOriginals ? ` ${result.retainedOriginals} original cop${result.retainedOriginals === 1 ? "y was" : "ies were"} retained in their previous location.` : ""}`,
      );
    } catch (error) {
      setMoveError(displayError(error));
      if (error instanceof ApiError && error.status === 401) onError(error);
    } finally {
      setMoving(false);
    }
  }
  const folderInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (groupByFolder) setExpandedFolders({});
  }, [groupByFolder]);
  function addQueued(incoming: DroppedFile[]) {
    if(incoming.length)void queue.add(incoming).catch(onError);
  }
  useEffect(() => {
    if (externalQueue?.length && queue.ready) {
      void queue.add(externalQueue).then(()=>onExternalQueueConsumed?.()).catch(onError);
    }
  }, [externalQueue,queue.ready]);
  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (busy) return;
    const dropped = await collectDroppedFiles(e.dataTransfer);
    if (!dropped.length) {
      onError(
        new Error(
          "No readable files were found in the dropped selection (hidden and system folders are skipped).",
        ),
      );
      return;
    }
    addQueued(dropped);
  }
  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!files.length || busy || !queue.ready) return;
    setBusy(true);
    const batch = batchUploads ? files.slice(0, 500) : files;
    const succeeded = new Set<string>();
    const failed: { path: string; message: string }[] = [];
    try {
      await queue.begin();
      uploadAbort.current = new AbortController();
      for (let i = 0; i < batch.length; i++) {
        if (uploadAbort.current.signal.aborted) break;
        const item = batch[i];
        setProgress(
          batch.length > 1
            ? `Uploading ${i + 1} of ${batch.length}: ${item.path}…`
            : `Uploading ${item.path}…`,
        );
        try {
          const stored = await queue.attempt(item, {
              kind,
              status,
              notes,
              category: uploadCategory,
              batchUploads,
            }),
            options = stored.attempt!;
          await api("/documents", {
            ...json({
              opportunityId,
              name: item.path,
              contentBase64: await readFile(item.file),
              kind: options.kind,
              status: options.status,
              notes: options.notes,
              importRequestId: stored.id,
              ...(options.category ? { category: options.category } : {}),
            }),
            signal: uploadAbort.current.signal,
          });
          await queue.complete(item);
          succeeded.add(item.path);
        } catch (err) {
          if (uploadAbort.current?.signal.aborted) break;
          await queue.failed(item, displayError(err));
          if (err instanceof ApiError && err.status === 401) throw err;
          failed.push({ path: item.path, message: displayError(err) });
        }
      }
      const remaining = files.length - succeeded.size;
      if (succeeded.size && onNotice) {
        onNotice(
          `Uploaded ${succeeded.size} of ${batch.length} document${batch.length === 1 ? "" : "s"}.${remaining ? ` ${remaining} file${remaining === 1 ? " remains" : "s remain"} in the queue; upload the next batch when ready.` : ""}`,
        );
      }
      if (failed.length) {
        onError(
          new Error(
            `Could not upload ${failed.length} file${failed.length === 1 ? "" : "s"}: ${failed
              .slice(0, 3)
              .map((item) => `${item.path} (${item.message})`)
              .join(
                "; ",
              )}${failed.length > 3 ? ` (+${failed.length - 3} more)` : ""}. Failed files remain in the queue.`,
          ),
        );
      }
      if (!remaining) setNotes("");
    } catch (error) {
      onError(error);
    } finally {
      if (succeeded.size) {
        await queue.refresh();
        onChanged();
      }
      uploadAbort.current = null;
      await queue.end();
      setBusy(false);
      setProgress("");
    }
  }
  const summaryLabel =
    files.length === 0
      ? opportunityId
        ? "Drop files or a folder here, or click to choose documents"
        : "Drop files or directories here, or click to choose documents"
      : files.length === 1
        ? files[0].path
        : `${files.length} files queued (${Math.max(1, Math.round(files.reduce((sum, f) => sum + f.file.size, 0) / 1024))} KB total)`;
  return (
    <>
      <div className="section-intro with-action">
        <div>
          <h3>
            {opportunityId
              ? "The right documents, at every step."
              : "Your experience is the starting point."}
          </h3>
          <p>
            {opportunityId
              ? "Each upload creates a separate version. Submitted files stay preserved."
              : "Drag and drop files or entire directories into your library. Career Buddy prepares PDF, DOCX and text sources locally."}
          </p>
        </div>
        <button
          type="button"
          className="button secondary small"
          disabled={busy}
          onClick={() => folderInputRef.current?.click()}
        >
          <FolderOpen size={15} />
          Choose folder
        </button>
      </div>
      <input
        ref={folderInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={(e) => {
          addQueued(collectFileList(e.target.files));
          e.target.value = "";
        }}
      />
      <label className="field"><span>Filter document category</span><select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option value="">All categories ({allDocuments.length})</option>{documentCategories.map(c=><option key={c.id} value={c.id}>{c.label} ({allDocuments.filter(d=>d.category===c.id).length})</option>)}</select></label>
      <DocumentStudio onError={onError} onChanged={onChanged} opportunityId={opportunityId}/>
      {queue.error&&<div className="alert error" role="alert">{queue.error} Queue changes could not be saved. Free browser storage or choose fewer files, then select them again; originals are unchanged.</div>}
      <p className="quiet-empty" role="status">{!queue.ready?"Opening saved upload queue…":queue.saving?"Saving files to this browser…":files.length?`${files.length} ${files.length===1?"file":"files"} saved in this browser’s upload queue. Reloading or closing this tab will not clear them. Select Upload to resume.`:"Selected files are kept in this browser until uploaded or removed."} Browser storage limits apply; this queue is private to this browser and is not part of server backups.</p>
      <form className="document-upload" onSubmit={upload}>
        <label
          className={`upload-drop ${files.length ? "has-file" : ""} ${dragOver ? "drag-active" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!dragOver) setDragOver(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setDragOver(false);
          }}
          onDrop={(e) => void handleDrop(e)}
        >
          <Upload size={21} />
          <strong>{summaryLabel}</strong>
          <span>
            PDF, Word, PowerPoint, Markdown, HTML, RTF, captions (.vtt/.srt), or
            text · multiple files or folders · up to 15 MB per file
          </span>
          <input
            key={files.map((f) => f.path).join("|") || "empty"}
            type="file"
            multiple
            disabled={busy || !queue.ready || queue.saving}
            onChange={(e) => addQueued(collectFileList(e.target.files))}
          />
        </label>
        {busy&&<button type="button" className="button secondary small" onClick={()=>uploadAbort.current?.abort()}>Pause uploads</button>}
        {files.length > 0 && (
          <>
            {(files.length > 500 || batchUploads) && (
              <div className="upload-large-warning" role="status">
                {files.length > 500 && <p><strong>Large upload:</strong> {files.length} files are queued. Uploading may take some time; keep this page open.</p>}
                <label className="checkbox-row">
                  <input type="checkbox" checked={batchUploads} disabled={busy} onChange={(e) => setBatchUploads(e.target.checked)} />
                  <span>Upload in batches of 500, pausing between batches</span>
                </label>
                {batchUploads && <small>After each batch, the remaining files stay queued. Select the upload button to continue.</small>}
              </div>
            )}
            {files.length > 0 && (
              <div className="upload-queue" aria-label="Queued files">
                <div className="upload-queue-header">
                  <strong>{files.length} {files.length===1?"file":"files"} ready to upload</strong>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => void queue.remove(null)}
                  >
                    Clear all
                  </button>
                </div>
                <ul className="upload-queue-list">
                  {files.slice(0, 25).map((item) => (
                    <li key={item.id}>
                      <span>{item.path}{item.attempt&&<small> · Retry retains original document options</small>}{item.error&&<small> · {item.error}</small>}</span>
                      <small>
                        {Math.max(1, Math.round(item.file.size / 1024))} KB
                      </small>
                      <button
                        type="button"
                        className="icon-button"
                        disabled={busy}
                        aria-label={`Remove ${item.path}`}
                        onClick={() => void queue.remove([item.id])}
                      >
                        <X size={13} />
                      </button>
                    </li>
                  ))}
                  {files.length > 25 && (
                    <li className="upload-queue-more">
                      +{files.length - 25} more files in queue
                    </li>
                  )}
                </ul>
              </div>
            )}
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
              <Field label="Category"><select value={uploadCategory} onChange={e=>setUploadCategory(e.target.value)}><option value="">Automatic from document type</option>{documentCategories.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>
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
                disabled={busy}
                onClick={() => void queue.remove(null)}
              >
                Cancel
              </button>
              <button className="button primary small" disabled={busy || !queue.ready || queue.saving}>
                {busy ? (
                  <Busy text={progress || "Uploading…"} />
                ) : (
                  <>
                    <Upload size={15} />
                    {files.length === 1
                      ? "Upload document"
                      : batchUploads && files.length > 500
                        ? "Upload next 500 documents"
                        : `Upload ${files.length} documents`}
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </form>
      {!opportunityId && movableDocuments.length > 0 && (
        <div className="library-move-toolbar">
          <label>
            <input
              type="checkbox"
              checked={
                movableDocuments.length <= 500 &&
                movableDocuments.every((d) => selectedForMove.includes(d.id))
              }
              onChange={(e) =>
                setSelectedForMove(
                  e.target.checked
                    ? movableDocuments.slice(0, 500).map((d) => d.id)
                    : [],
                )
              }
            />{" "}
            {movableDocuments.length > 500
              ? "Select first 500 matching files"
              : "Select all matching files"}
          </label>
          <button
            type="button"
            className="button secondary small"
            disabled={!selectedForMove.length}
            onClick={() =>
              startMove(
                movableDocuments.filter((d) => selectedForMove.includes(d.id)),
              )
            }
          >
            <FolderInput size={14} /> Move selected
            {selectedForMove.length ? ` (${selectedForMove.length})` : ""}
          </button>
        </div>
      )}
      {!opportunityId&&selectedForMove.length>0&&<div className="library-tool-actions"><label className="field"><span>Category for selected documents</span><select disabled={categorising} value={bulkCategory} onChange={e=>setBulkCategory(e.target.value)}><option value="">Choose a category</option>{documentCategories.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label><button type="button" className="button secondary small" disabled={categorising||!bulkCategory} onClick={()=>void categoriseSelected()}>{categorising?'Saving…':'Categorise selected ('+selectedForMove.length+')'}</button></div>}
      {moveDocuments && (
        <Modal
          title={
            moveDocuments.length === 1
              ? "Move library file"
              : `Move ${moveDocuments.length} library files`
          }
          subtitle="Choose a folder within your configured Career Library location."
          onClose={() => {
            if (!moving) setMoveDocuments(null);
          }}
        >
          <form onSubmit={moveSelected}>
            <p className="library-move-help">
              Files move into the chosen folder; their document records and
              prepared text stay linked. Leave the folder blank for top-level
              files.
            </p>
            <Field
              label="Destination folder"
              hint="Use a relative path, such as Projects/2026. New folders are created if needed."
            >
              <input
                autoFocus
                value={moveFolder}
                onChange={(e) => setMoveFolder(e.target.value)}
                list="library-move-folders"
                maxLength={480}
                placeholder="Top-level files"
              />
            </Field>
            <datalist id="library-move-folders">
              {[
                ...new Set(
                  documents
                    .map((d) =>
                      d.name.includes("/")
                        ? d.name.slice(0, d.name.lastIndexOf("/"))
                        : "",
                    )
                    .filter(Boolean),
                ),
              ]
                .sort()
                .map((folder) => (
                  <option key={folder} value={folder} />
                ))}
            </datalist>
            {moveError && (
              <p className="form-error" role="alert">
                {moveError}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="button secondary"
                disabled={moving}
                onClick={() => setMoveDocuments(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={moving}
              >
                {moving ? "Moving…" : "Move files"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {(() => {
        function folderEntries(sectionDocs: BoardDocument[]) {
          const map = new Map<string, BoardDocument[]>();
          for (const doc of sectionDocs) {
            const idx = doc.name.lastIndexOf("/");
            const folderName = idx > 0 ? doc.name.slice(0, idx) : "";
            if (!map.has(folderName)) map.set(folderName, []);
            map.get(folderName)!.push(doc);
          }
          return [...map.entries()].sort(([a], [b]) =>
            !a ? 1 : !b ? -1 : a.localeCompare(b),
          );
        }
        function renderDocumentGroups(
          sectionDocs: BoardDocument[],
          sectionKey: string,
        ) {
          const groups = groupByFolder
            ? folderEntries(sectionDocs)
            : ([["", sectionDocs]] as [string, BoardDocument[]][]);
          return (
            <div className="document-list">
              {groups.map(([folderName, groupDocs]) => {
                const collapseKey = `${sectionKey}:${folderName || "__root__"}`;
                const isCollapsed = Boolean(
                  groupByFolder && !expandedFolders[collapseKey],
                );
                const removableFolderDocs = groupDocs.filter(
                  (d) => d.status !== "submitted",
                );
                return (
                  <div
                    key={collapseKey}
                    className={
                      groupByFolder && folderName ? "document-folder-group" : ""
                    }
                  >
                    {groupByFolder && (
                      <div className="document-folder-bar">
                        <button
                          type="button"
                          className="document-folder-header"
                          aria-expanded={!isCollapsed}
                          onClick={() =>
                            setExpandedFolders((current) => ({
                              ...current,
                              [collapseKey]: !current[collapseKey],
                            }))
                          }
                        >
                          {isCollapsed ? (
                            <ChevronRight size={14} />
                          ) : (
                            <ChevronDown size={14} />
                          )}
                          <Folder size={14} />
                          <strong>{folderName || "Top-level files"}</strong>
                          <span className="badge muted">
                            {groupDocs.length}
                          </span>
                        </button>
                        {!opportunityId && removableFolderDocs.length > 0 && (
                          <button
                            type="button"
                            className="button secondary small"
                            onClick={() => startMove(removableFolderDocs)}
                            disabled={removableFolderDocs.length > 500}
                            title={
                              removableFolderDocs.length > 500
                                ? "Select up to 500 files at a time."
                                : undefined
                            }
                            aria-label={`Move ${removableFolderDocs.length} file${removableFolderDocs.length === 1 ? "" : "s"} from ${folderName || "Top-level files"}`}
                          >
                            <FolderInput size={13} /> Move files
                          </button>
                        )}
                        {removableFolderDocs.length > 0 &&
                          (confirmDeleteFolderKey === collapseKey ? (
                            <div className="document-delete-confirm">
                              <span>
                                Delete {removableFolderDocs.length} file
                                {removableFolderDocs.length === 1 ? "" : "s"}?
                              </span>
                              <button
                                type="button"
                                className="button danger small"
                                disabled={deletingFolderKey === collapseKey}
                                onClick={async () => {
                                  setDeletingFolderKey(collapseKey);
                                  try {
                                    const params = new URLSearchParams({
                                      ...(opportunityId
                                        ? { opportunityId }
                                        : { scope: "library" }),
                                      folder: folderName || "__root__",
                                      ids: removableFolderDocs
                                        .map((d) => d.id)
                                        .join(","),
                                    });
                                    const res = await api<{
                                      deletedCount: number;
                                      preservedSubmittedCount: number;
                                    }>(`/documents?${params.toString()}`, {
                                      method: "DELETE",
                                    });
                                    setConfirmDeleteFolderKey("");
                                    onChanged();
                                    onNotice?.(
                                      `Deleted ${res.deletedCount} document${res.deletedCount === 1 ? "" : "s"} from ${folderName || "Top-level files"}.`,
                                    );
                                  } catch (err) {
                                    onError(err);
                                  } finally {
                                    setDeletingFolderKey("");
                                  }
                                }}
                              >
                                {deletingFolderKey === collapseKey
                                  ? "Deleting…"
                                  : "Confirm"}
                              </button>
                              <button
                                type="button"
                                className="button secondary small"
                                disabled={deletingFolderKey === collapseKey}
                                onClick={() => setConfirmDeleteFolderKey("")}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="button secondary small danger-text folder-delete-btn"
                              aria-label={`Delete folder ${folderName || "Top-level files"}`}
                              onClick={() =>
                                setConfirmDeleteFolderKey(collapseKey)
                              }
                            >
                              <Trash2 size={13} />
                              Delete folder
                            </button>
                          ))}
                      </div>
                    )}
                    {!isCollapsed &&
                      groupDocs.map((doc) => {
                        const displayName =
                          groupByFolder &&
                          folderName &&
                          doc.name.startsWith(folderName + "/")
                            ? doc.name.slice(folderName.length + 1)
                            : doc.name;
                        const isReady =
                          extraction?.[doc.id]?.status === "ready";
                        return (
                          <article className="document-row" key={doc.id}>
                            {!opportunityId && doc.status !== "submitted" && (
                              <input
                                className="document-move-select"
                                type="checkbox"
                                aria-label={`Select ${doc.name} for library actions`}
                                checked={selectedForMove.includes(doc.id)}
                                disabled={
                                  !selectedForMove.includes(doc.id) &&
                                  selectedForMove.length >= 500
                                }
                                onChange={(e) =>
                                  setSelectedForMove((current) =>
                                    e.target.checked
                                      ? current.length < 500
                                        ? [...current, doc.id]
                                        : current
                                      : current.filter((id) => id !== doc.id),
                                  )
                                }
                              />
                            )}
                            <span className="document-icon">
                              <FileText size={21} />
                            </span>
                            <div className="document-name">
                              <a
                                href={
                                  doc.url || `/api/documents/${doc.id}/content`
                                }
                                download
                              >
                                {displayName}
                              </a>
                              <small>
                                {doc.kind} · v{doc.version} ·{" "}
                                {Math.max(1, Math.round(doc.size / 1024))} KB ·{" "}
                                {formatDate(doc.createdAt, timezone)}
                              </small>
                              <DocumentCategory document={doc} onChanged={onChanged} onError={onError}/>
                              <div className="document-tags">
                                {(doc.tags || []).map((tag) => (
                                  <span
                                    key={tag}
                                    className={`document-tag-pill ${selectedTag && selectedTag.toLowerCase() === tag.toLowerCase() ? "active" : ""}`}
                                  >
                                    <button
                                      type="button"
                                      className="document-tag-click"
                                      onClick={() =>
                                        onSelectTag?.(
                                          selectedTag.toLowerCase() ===
                                            tag.toLowerCase()
                                            ? ""
                                            : tag,
                                        )
                                      }
                                    >
                                      <Tag size={10} />
                                      {tag}
                                    </button>
                                    <button
                                      type="button"
                                      className="document-tag-remove"
                                      aria-label={`Remove tag ${tag} from ${doc.name}`}
                                      onClick={async () => {
                                        try {
                                          await api(
                                            `/documents/${doc.id}`,
                                            json(
                                              {
                                                tags: (doc.tags || []).filter(
                                                  (t) => t !== tag,
                                                ),
                                                revision: doc.revision,
                                              },
                                              "PATCH",
                                            ),
                                          );
                                          onChanged();
                                        } catch (error) {
                                          onError(error);
                                        }
                                      }}
                                    >
                                      <X size={10} />
                                    </button>
                                  </span>
                                ))}
                                {editingTagsId === doc.id ? (
                                  <form
                                    className="document-tag-form"
                                    onSubmit={async (e) => {
                                      e.preventDefault();
                                      const nextTag = tagInput
                                        .trim()
                                        .replace(/^#+/, "");
                                      if (!nextTag) {
                                        setEditingTagsId("");
                                        return;
                                      }
                                      try {
                                        await api(
                                          `/documents/${doc.id}`,
                                          json(
                                            {
                                              tags: [
                                                ...(doc.tags || []),
                                                nextTag,
                                              ],
                                              revision: doc.revision,
                                            },
                                            "PATCH",
                                          ),
                                        );
                                        setTagInput("");
                                        setEditingTagsId("");
                                        onChanged();
                                      } catch (error) {
                                        onError(error);
                                      }
                                    }}
                                  >
                                    <input
                                      autoFocus
                                      aria-label={`New tag for ${doc.name}`}
                                      placeholder="Add tag…"
                                      value={tagInput}
                                      onChange={(e) =>
                                        setTagInput(e.target.value)
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === "Escape") {
                                          setEditingTagsId("");
                                          setTagInput("");
                                        }
                                      }}
                                    />
                                    <button
                                      type="submit"
                                      className="button primary small"
                                    >
                                      Add
                                    </button>
                                  </form>
                                ) : (
                                  <button
                                    type="button"
                                    className="document-tag-add"
                                    aria-label={`Add tag to ${doc.name}`}
                                    onClick={() => {
                                      setEditingTagsId(doc.id);
                                      setTagInput("");
                                    }}
                                  >
                                    <Plus size={10} />
                                    Tag
                                  </button>
                                )}
                              </div>
                              {!opportunityId && (
                                <span className="library-file-status">
                                  Stored ·{" "}
                                  {isReady
                                    ? `${extraction[doc.id].chunkCount} text chunk${extraction[doc.id].chunkCount === 1 ? "" : "s"} ready`
                                    : extraction?.[doc.id]?.warnings.join(
                                        " ",
                                      ) ||
                                      "Text prepared when selected for Career Buddy"}
                                </span>
                              )}
                              {doc.notes && <p>{doc.notes}</p>}
                            </div>
                            {!opportunityId && onPrepareDocument && (
                              <button
                                type="button"
                                className="button secondary small"
                                disabled={preparingDocId === doc.id}
                                title={
                                  isReady
                                    ? "Re-extract and prepare text chunks for this source"
                                    : "Prepare readable text chunks for Career Buddy"
                                }
                                onClick={async () => {
                                  setPreparingDocId(doc.id);
                                  try {
                                    await onPrepareDocument(doc.id, true);
                                  } finally {
                                    setPreparingDocId("");
                                  }
                                }}
                              >
                                {preparingDocId === doc.id ? (
                                  <LoaderCircle size={13} className="spin" />
                                ) : (
                                  <RotateCw size={13} />
                                )}
                                {isReady ? "Re-prepare" : "Prepare"}
                              </button>
                            )}
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
                                        {
                                          status: e.target.value,
                                          revision: doc.revision,
                                        },
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
                            {!opportunityId && doc.status !== "submitted" && (
                              <button
                                type="button"
                                className="icon-button"
                                aria-label={`Move ${doc.name}`}
                                title="Move to another library folder"
                                onClick={() => startMove([doc])}
                              >
                                <FolderInput size={17} />
                              </button>
                            )}
                            <a
                              className="icon-button"
                              href={
                                doc.url || `/api/documents/${doc.id}/content`
                              }
                              download
                              aria-label={`Download ${doc.name}`}
                            >
                              <ArrowDownToLine size={17} />
                            </a>
                            {doc.status !== "submitted" &&
                              (confirmDeleteId === doc.id ? (
                                <div className="document-delete-confirm">
                                  <button
                                    type="button"
                                    className="button danger small"
                                    disabled={deletingId === doc.id}
                                    onClick={async () => {
                                      setDeletingId(doc.id);
                                      try {
                                        await api(`/documents/${doc.id}`, {
                                          method: "DELETE",
                                        });
                                        setConfirmDeleteId("");
                                        onChanged();
                                        onNotice?.(`Deleted ${doc.name}.`);
                                      } catch (err) {
                                        onError(err);
                                      } finally {
                                        setDeletingId("");
                                      }
                                    }}
                                  >
                                    {deletingId === doc.id
                                      ? "Deleting…"
                                      : "Confirm"}
                                  </button>
                                  <button
                                    type="button"
                                    className="button secondary small"
                                    disabled={deletingId === doc.id}
                                    onClick={() => setConfirmDeleteId("")}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="icon-button danger-icon"
                                  aria-label={`Delete ${doc.name}`}
                                  onClick={() => setConfirmDeleteId(doc.id)}
                                >
                                  <Trash2 size={16} />
                                </button>
                              ))}
                          </article>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          );
        }
        const preparedDocs = documents.filter(
          (doc) => extraction?.[doc.id]?.status === "ready",
        );
        const unpreparedDocs = documents.filter(
          (doc) => extraction?.[doc.id]?.status !== "ready",
        );
        const allFolderKeys = groupByFolder
          ? splitByPrepared
            ? [
                ...(sourceFilter !== "unused"
                  ? folderEntries(preparedDocs).map(
                      ([name]) => `ready:${name || "__root__"}`,
                    )
                  : []),
                ...(sourceFilter !== "used"
                  ? folderEntries(unpreparedDocs).map(
                      ([name]) => `unprepared:${name || "__root__"}`,
                    )
                  : []),
              ]
            : folderEntries(documents).map(
                ([name]) => `all:${name || "__root__"}`,
              )
          : [];
        const expandedCount = allFolderKeys.filter(
          (k) => expandedFolders[k],
        ).length;
        const folderToolbar =
          groupByFolder && allFolderKeys.length > 0 ? (
            <div className="document-folder-toolbar">
              <span className="folder-toolbar-summary">
                {allFolderKeys.length} folder
                {allFolderKeys.length === 1 ? "" : "s"} · {expandedCount}{" "}
                expanded
              </span>
              <div className="folder-toolbar-actions">
                <button
                  type="button"
                  className="button secondary small"
                  disabled={expandedCount === allFolderKeys.length}
                  onClick={() =>
                    setExpandedFolders(
                      Object.fromEntries(allFolderKeys.map((k) => [k, true])),
                    )
                  }
                >
                  <ChevronDown size={13} />
                  Expand all
                </button>
                <button
                  type="button"
                  className="button secondary small"
                  disabled={expandedCount === 0}
                  onClick={() => setExpandedFolders({})}
                >
                  <ChevronRight size={13} />
                  Collapse all
                </button>
              </div>
            </div>
          ) : null;
        if (splitByPrepared && documents.length > 0) {
          return (
            <div className="document-split-sections">
              {folderToolbar}
              {sourceFilter !== "unused" && (
                <section
                  className="document-split-section"
                  aria-label="Used (prepared) sources"
                >
                  <button
                    type="button"
                    className="document-split-heading document-split-toggle"
                    aria-expanded={expandedSources.ready}
                    onClick={() =>
                      setExpandedSources((current) => ({
                        ...current,
                        ready: !current.ready,
                      }))
                    }
                  >
                    <div>
                      <h4>
                        {expandedSources.ready ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}{" "}
                        <Check size={14} /> Used sources (prepared for Career
                        Buddy)
                      </h4>
                      <p>
                        Readable text chunks extracted locally and ready to be
                        matched when you ask Career Buddy a question.
                      </p>
                    </div>
                    <Badge kind="green">{preparedDocs.length} used</Badge>
                  </button>
                  {expandedSources.ready &&
                    (preparedDocs.length > 0 ? (
                      renderDocumentGroups(preparedDocs, "ready")
                    ) : (
                      <p className="quiet-empty">
                        No used (prepared) sources yet. Click &ldquo;Prepare
                        library text&rdquo; above or &ldquo;Prepare&rdquo; on
                        any unused source below.
                      </p>
                    ))}
                </section>
              )}
              {sourceFilter !== "used" && (
                <section
                  className="document-split-section"
                  aria-label="Unused (unprepared) sources"
                >
                  <button
                    type="button"
                    className="document-split-heading document-split-toggle"
                    aria-expanded={expandedSources.unprepared}
                    onClick={() =>
                      setExpandedSources((current) => ({
                        ...current,
                        unprepared: !current.unprepared,
                      }))
                    }
                  >
                    <div>
                      <h4>
                        {expandedSources.unprepared ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}{" "}
                        Unused sources (not yet prepared)
                      </h4>
                      <p>
                        Stored safely in your library, but not yet prepared into
                        searchable text chunks (or no readable text could be
                        extracted).
                      </p>
                    </div>
                    <Badge kind="muted">{unpreparedDocs.length} unused</Badge>
                  </button>
                  {expandedSources.unprepared &&
                    (unpreparedDocs.length > 0 ? (
                      renderDocumentGroups(unpreparedDocs, "unprepared")
                    ) : (
                      <p className="quiet-empty">
                        All matching sources are prepared and ready for Career
                        Buddy.
                      </p>
                    ))}
                </section>
              )}
            </div>
          );
        }
        return (
          <>
            {folderToolbar}
            {renderDocumentGroups(documents, "all")}
          </>
        );
      })()}
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
      title: e.title || stageLabel(e.stage),
      text: e.note || "Entered this stage.",
    })),
    ...(o.activities || []).map((a) => ({
      date: a.scheduledAt || a.createdAt,
      title: `${a.kind === "interview" ? "Interview" : "Communication"}: ${a.title}`,
      text: [
        `${a.kind === "communication" ? [a.direction || "Direction not recorded", a.channel || a.type].join(" · ") : a.type} · ${a.status}${a.isFinal ? " · Final stage" : ""}`,
        a.followUp
          ? `Follow-up${a.followUpDone ? " (completed)" : ""}: ${a.followUp}${a.followUpDate ? ` · Due ${formatDate(a.followUpDate, timezone)}` : ""}`
          : "",
        ...(a.documentIds || []).map(
          (id) =>
            `Attachment: ${(o.documents || []).find((d) => d.id === id)?.name || "Unavailable (removed document)"}`,
        ),
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
    o.applicationRoute ? `Application route: ${o.applicationRoute}` : "",
    ...(o.review
      ? [
          "CURRENT REVIEW",
          `Decision: ${o.review.decision || "Not decided"}`,
          o.review.strengths ? `Strengths: ${o.review.strengths}` : "",
          o.review.gaps ? `Gaps: ${o.review.gaps}` : "",
          o.review.reason ? `Reason: ${o.review.reason}` : "",
        ]
      : []),
    ...(o.offers?.length
      ? [
          "CURRENT OFFERS",
          ...o.offers.flatMap((v) => [
            `${v.title}: ${v.decision} · Offered ${formatDate(v.offeredAt, timezone, true)}`,
            v.compensation,
            v.terms,
            v.contact,
            v.responseDueDate
              ? `Respond by: ${formatDate(v.responseDueDate, timezone)}`
              : "",
            v.startDate
              ? `Proposed start: ${formatDate(v.startDate, timezone)}`
              : "",
            v.decidedAt
              ? `Decision date: ${formatDate(v.decidedAt, timezone, true)}`
              : "",
            v.decisionReason,
            ...v.documentIds.map(
              (id) =>
                `Offer document: ${(o.documents || []).find((d) => d.id === id)?.name || "Unavailable (removed document)"}`,
            ),
          ]),
        ]
      : []),
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
function ObsidianVaultPanel({
  obsidian,
  totalDocs,
  preparedDocsCount,
  timezone,
  restarting,
  onRestart,
  onReload,
  onNotice,
  onError,
}: {
  obsidian: ObsidianStatus | null;
  totalDocs: number;
  preparedDocsCount: number;
  timezone: string;
  restarting?: boolean;
  onRestart?: () => void;
  onReload: () => Promise<void>;
  onNotice: (s: string) => void;
  onError: (e: unknown) => void;
}) {
  const [expanded, setExpanded] = useState(false),
    [action, setAction] = useState<"create" | "connect">("create"),
    [locationType, setLocationType] = useState<"subpath" | "hostPath">(
      obsidian?.locationType || "subpath",
    ),
    [subpath, setSubpath] = useState(obsidian?.subpath || "obsidian-vault"),
    [hostPath, setHostPath] = useState(obsidian?.hostPath || ""),
    [vaultName, setVaultName] = useState(
      obsidian?.vaultName || "Opportunity Knox Vault",
    ),
    [importExisting, setImportExisting] = useState(false),
    [importOnlyPrepared, setImportOnlyPrepared] = useState(false),
    [syncOnConnect, setSyncOnConnect] = useState(false),
    [readOnly, setReadOnly] = useState(true),
    [onlyPreparedExport, setOnlyPreparedExport] = useState(false),
    [includeExtractedText, setIncludeExtractedText] = useState(true),
    [busy, setBusy] = useState(""),
    [vaultSources, setVaultSources] = useState<{id: string; path: string; selected: boolean}[] | null>(null),
    [vaultQuery, setVaultQuery] = useState("");

  async function loadVaultSources() {
    setBusy("sources");
    try { const result = await api<{sources: {id: string; path: string; selected: boolean}[]}>("/obsidian/sources"); setVaultSources(result.sources); }
    catch (error) { onError(error); }
    finally { setBusy(""); }
  }
  async function saveVaultSources() {
    setBusy("sources");
    try { await api("/obsidian/sources", json({ ids: vaultSources?.filter((source) => source.selected).map((source) => source.id) || [] })); onNotice("Read-only sources saved. Select them in Career Buddy when chatting."); }
    catch (error) { onError(error); }
    finally { setBusy(""); }
  }

  useEffect(() => {
    if (obsidian) {
      setLocationType(obsidian.locationType || "subpath");
      if (obsidian.subpath) setSubpath(obsidian.subpath);
      if (obsidian.hostPath) setHostPath(obsidian.hostPath);
      if (obsidian.vaultName) setVaultName(obsidian.vaultName);
    }
  }, [
    obsidian?.enabled,
    obsidian?.locationType,
    obsidian?.subpath,
    obsidian?.hostPath,
    obsidian?.vaultName,
  ]);

  async function submitConfigure(e: FormEvent) {
    e.preventDefault();
    setBusy("configure");
    try {
      const res = await api<{
        ok: boolean;
        obsidian: ObsidianStatus;
        importedToVault?: {
          importedNotesCount: number;
          copiedAttachmentsCount: number;
        };
        syncedFromVault?: {
          importedCount: number;
          updatedCount: number;
        };
      }>(
        "/obsidian/configure",
        json({
          action,
          locationType,
          subpath,
          hostPath,
          vaultName,
          readOnly: action === "connect" && readOnly,
          importExisting: action === "connect" && readOnly ? false : importExisting,
          importOnlyPrepared,
          syncFromVault: action === "connect" ? syncOnConnect : false,
        }),
      );
      await onReload();
      if (res.obsidian.mountPending) {
        onNotice(
          "Obsidian host vault path saved. Click Update & restart to attach the host folder.",
        );
      } else {
        const parts = [
          action === "create"
            ? `Created Obsidian vault "${res.obsidian.vaultName}".`
            : `Connected Obsidian vault "${res.obsidian.vaultName}".`,
        ];
        if (res.importedToVault) {
          parts.push(
            `Exported ${res.importedToVault.importedNotesCount} note${res.importedToVault.importedNotesCount === 1 ? "" : "s"} (${res.importedToVault.copiedAttachmentsCount} attachment${res.importedToVault.copiedAttachmentsCount === 1 ? "" : "s"}) into the vault.`,
          );
        }
        if (res.syncedFromVault) {
          parts.push(
            `Imported ${res.syncedFromVault.importedCount} new and ${res.syncedFromVault.updatedCount} updated file${res.syncedFromVault.importedCount + res.syncedFromVault.updatedCount === 1 ? "" : "s"} from the vault.`,
          );
        }
        onNotice(parts.join(" "));
      }
    } catch (err) {
      onError(err);
    } finally {
      setBusy("");
    }
  }

  async function handleImportToVault() {
    setBusy("export");
    try {
      const res = await api<{
        importedNotesCount: number;
        copiedAttachmentsCount: number;
        skippedCount: number;
      }>(
        "/obsidian/import-to-vault",
        json({
          onlyPrepared: onlyPreparedExport,
          includeExtractedText,
        }),
      );
      await onReload();
      onNotice(
        `Imported ${res.importedNotesCount} source${res.importedNotesCount === 1 ? "" : "s"} (${res.copiedAttachmentsCount} original attachment${res.copiedAttachmentsCount === 1 ? "" : "s"}) into your Obsidian vault.`,
      );
    } catch (err) {
      onError(err);
    } finally {
      setBusy("");
    }
  }

  async function handleSyncFromVault() {
    setBusy("sync");
    try {
      const res = await api<{
        importedCount: number;
        updatedCount: number;
        unchangedCount: number;
        preparedCount: number;
      }>("/obsidian/sync-from-vault", json({ autoPrepare: true }));
      await onReload();
      onNotice(
        `Synced from Obsidian vault: ${res.importedCount} new, ${res.updatedCount} updated, ${res.unchangedCount} unchanged (${res.preparedCount} prepared for Career Buddy).`,
      );
    } catch (err) {
      onError(err);
    } finally {
      setBusy("");
    }
  }

  async function handleDisconnect() {
    setBusy("disconnect");
    try {
      await api("/obsidian/configure", json({ action: "disconnect" }));
      await onReload();
      onNotice("Disconnected Obsidian vault. Vault files remain untouched.");
    } catch (err) {
      onError(err);
    } finally {
      setBusy("");
    }
  }

  const isConnected = Boolean(obsidian?.enabled);
  const isReady = Boolean(
    obsidian?.enabled &&
    !obsidian?.mountPending &&
    obsidian?.vaultStats?.exists,
  );

  return (
    <div className="obsidian-panel">
      <div className="obsidian-panel-header">
        <button
          type="button"
          className="obsidian-panel-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <FolderOpen size={16} />
          <strong>Obsidian Vault</strong>
          {isReady ? (
            <Badge kind="green">
              <Check size={11} />
              {obsidian?.vaultName}{obsidian?.readOnly ? " · Read-only" : ""} · {obsidian?.vaultStats.markdownCount} note
              {obsidian?.vaultStats.markdownCount === 1 ? "" : "s"}
              {obsidian?.vaultStats.attachmentCount
                ? ` · ${obsidian.vaultStats.attachmentCount} attachment${obsidian.vaultStats.attachmentCount === 1 ? "" : "s"}`
                : ""}
            </Badge>
          ) : obsidian?.mountPending ? (
            <Badge kind="amber">Restart needed to attach host vault</Badge>
          ) : (
            <Badge kind="muted">Not connected</Badge>
          )}
        </button>
        <div className="obsidian-header-actions">
          {isReady && (
            <>
              <button
                type="button"
                className="button secondary small"
                disabled={Boolean(busy)}
                onClick={() => void handleSyncFromVault()}
                title="Import new or edited Markdown notes and files from your Obsidian vault into your Career Library"
              >
                {busy === "sync" ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <RotateCw size={14} />
                )}
                Sync from vault
              </button>
              <button
                type="button"
                className="button secondary small"
                disabled={Boolean(busy) || totalDocs === 0 || Boolean(obsidian?.readOnly)}
                onClick={() => void handleImportToVault()}
                title="Export existing Career Library sources into your Obsidian vault"
              >
                {busy === "export" ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Upload size={14} />
                )}
                Import sources to vault
              </button>
              {obsidian?.obsidianUrl && (
                <a
                  className="button secondary small"
                  href={obsidian.obsidianUrl}
                  title={`Open ${obsidian.resolvedHostPath} in Obsidian desktop`}
                >
                  <ArrowUpRight size={14} />
                  Open in Obsidian
                </a>
              )}
            </>
          )}
          {obsidian?.mountPending && onRestart && (
            <button
              type="button"
              className="button primary small"
              disabled={restarting}
              onClick={onRestart}
            >
              <RotateCw size={14} className={restarting ? "spin" : ""} />
              {restarting ? "Restarting…" : "Mount & restart board"}
            </button>
          )}
          <button
            type="button"
            className="button secondary small"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? "Hide settings"
              : isConnected
                ? "Manage vault"
                : "Set up vault"}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="obsidian-panel-body">
          {isConnected && obsidian && (
            <div className="obsidian-status-card">
              <div className="obsidian-status-details">
                <div>
                  <span className="eyebrow">ACTIVE VAULT LOCATION</span>
                  <p className="obsidian-vault-path">
                    <code>{obsidian.resolvedHostPath}</code>
                  </p>
                  <small>
                    {obsidian.mountPending
                      ? "Waiting for container restart to mount this host directory."
                      : `Open this folder in Obsidian via "Open folder as vault" or click "Open in Obsidian" above.${obsidian.lastSyncedAt ? ` · Last synced from vault: ${formatDate(obsidian.lastSyncedAt, timezone, true)}` : ""}${obsidian.lastImportedToVaultAt ? ` · Last imported to vault: ${formatDate(obsidian.lastImportedToVaultAt, timezone, true)}` : ""}`}
                  </small>
                </div>
                <button
                  type="button"
                  className="button secondary small danger-text"
                  disabled={Boolean(busy)}
                  onClick={() => void handleDisconnect()}
                >
                  Disconnect vault
                </button>
              </div>
              {isReady && obsidian.readOnly && <div className="obsidian-sync-box">
                <h4>Read-only sources for Career Buddy</h4>
                <p>Choose up to 1,000 files to make available in Career Buddy. Originals stay in the vault; extracted text is cached in this board when used and removed from the cache when deselected. Selected excerpts are sent to your configured AI provider.</p>
                <button type="button" className="button secondary small" disabled={Boolean(busy)} onClick={() => void loadVaultSources()}>Choose vault sources</button>
                {vaultSources && <>
                  <input aria-label="Filter vault sources" value={vaultQuery} onChange={(e) => setVaultQuery(e.target.value)} placeholder="Filter by file or folder" />
                  <p>{vaultSources.filter((source) => source.selected).length} selected</p>
                  <div className="buddy-source-picker">{vaultSources.filter((source) => source.path.toLowerCase().includes(vaultQuery.toLowerCase())).map((source) => <label key={source.id}><input type="checkbox" checked={source.selected} onChange={(e) => setVaultSources((current) => current?.map((item) => item.id === source.id ? {...item, selected: e.target.checked} : item) || null)} /><span>{source.path}</span></label>)}</div>
                  <button type="button" className="button primary small" disabled={Boolean(busy)} onClick={() => void saveVaultSources()}>Save selected sources</button>
                </>}
              </div>}
              {isReady && (
                <div className="obsidian-sync-cards">
                  <div className="obsidian-sync-box">
                    <h4>Import existing library sources into vault</h4>
                    {obsidian.readOnly && <p>This vault is read-only. No files can be exported to it.</p>}
                    <p>
                      Writes Markdown notes into <code>Career Library/</code>{" "}
                      and copies PDFs, Word docs, PowerPoints, and transcripts
                      into <code>Attachments/</code> with companion notes.
                    </p>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={onlyPreparedExport}
                        onChange={(e) =>
                          setOnlyPreparedExport(e.target.checked)
                        }
                      />
                      <span>
                        Import only <strong>Used (prepared)</strong> sources (
                        {preparedDocsCount} of {totalDocs})
                      </span>
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={includeExtractedText}
                        onChange={(e) =>
                          setIncludeExtractedText(e.target.checked)
                        }
                      />
                      <span>
                        Include extracted text inside companion Markdown notes
                        so PDFs, DOCX &amp; slides are searchable in Obsidian
                      </span>
                    </label>
                    <button
                      type="button"
                      className="button primary small"
                      disabled={Boolean(busy) || totalDocs === 0 || Boolean(obsidian?.readOnly)}
                      onClick={() => void handleImportToVault()}
                    >
                      {busy === "export" ? (
                        <Busy text="Importing to vault…" />
                      ) : (
                        <>
                          <Upload size={14} />
                          Import{" "}
                          {onlyPreparedExport
                            ? preparedDocsCount
                            : totalDocs}{" "}
                          source
                          {(onlyPreparedExport
                            ? preparedDocsCount
                            : totalDocs) === 1
                            ? ""
                            : "s"}{" "}
                          into vault
                        </>
                      )}
                    </button>
                  </div>
                  <div className="obsidian-sync-box">
                    <h4>Sync notes from Obsidian vault into library</h4>
                    <p>
                      Scans <code>{obsidian.vaultName}</code> for new or updated
                      Markdown notes and attachments, adds them to your Career
                      Library with <code>#Obsidian</code> and frontmatter tags,
                      and prepares their text for Career Buddy.
                    </p>
                    <button
                      type="button"
                      className="button secondary small"
                      disabled={Boolean(busy)}
                      onClick={() => void handleSyncFromVault()}
                    >
                      {busy === "sync" ? (
                        <Busy text="Syncing vault…" />
                      ) : (
                        <>
                          <RotateCw size={14} />
                          Sync vault into library (
                          {obsidian.vaultStats.totalFiles} file
                          {obsidian.vaultStats.totalFiles === 1 ? "" : "s"} in
                          vault)
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <form className="obsidian-config-form" onSubmit={submitConfigure}>
            <div className="obsidian-mode-tabs" role="group">
              <button
                type="button"
                className={action === "create" ? "active" : ""}
                onClick={() => {
                  setAction("create");
                  setImportExisting(false);
                }}
              >
                <Plus size={13} />
                Create a new vault
              </button>
              <button
                type="button"
                className={action === "connect" ? "active" : ""}
                onClick={() => {
                  setAction("connect");
                  setSyncOnConnect(false);
                  setImportExisting(false);
                  setReadOnly(true);
                }}
              >
                <FolderOpen size={13} />
                Point to an existing vault
              </button>
            </div>
            <div className="form-grid">
              <Field label="Vault location">
                <select
                  value={locationType}
                  onChange={(e) =>
                    setLocationType(e.target.value as "subpath" | "hostPath")
                  }
                >
                  <option value="subpath">
                    Subfolder inside workspace document folder (instant, no
                    restart)
                  </option>
                  <option value="hostPath">
                    Custom absolute path on host computer
                  </option>
                </select>
              </Field>
              <Field label="Vault display name">
                <input
                  value={vaultName}
                  onChange={(e) => setVaultName(e.target.value)}
                  placeholder="Opportunity Knox Vault"
                />
              </Field>
              {locationType === "subpath" ? (
                <Field label="Vault subfolder name" wide>
                  <input
                    value={subpath}
                    onChange={(e) => setSubpath(e.target.value)}
                    placeholder="obsidian-vault"
                  />
                </Field>
              ) : (
                <Field label="Absolute folder path on host machine" wide>
                  <input
                    value={hostPath}
                    onChange={(e) => setHostPath(e.target.value)}
                    placeholder="/Users/you/Documents/Obsidian/CareerVault"
                  />
                </Field>
              )}
            </div>
            <div className="obsidian-options-list">
              {action === "connect" && <label className="checkbox-row">
                <input type="checkbox" checked={readOnly} onChange={(e) => { setReadOnly(e.target.checked); if (e.target.checked) setImportExisting(false); }} />
                <span>Connect read-only (do not write files to the vault)</span>
              </label>}
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={importExisting}
                  disabled={action === "connect" && readOnly}
                  onChange={(e) => setImportExisting(e.target.checked)}
                />
                <span>
                  Import existing Career Library sources into this vault right
                  away ({totalDocs} document{totalDocs === 1 ? "" : "s"})
                </span>
              </label>
              {importExisting && totalDocs > 0 && (
                <label className="checkbox-row nested">
                  <input
                    type="checkbox"
                    checked={importOnlyPrepared}
                    onChange={(e) => setImportOnlyPrepared(e.target.checked)}
                  />
                  <span>
                    Import only <strong>Used (prepared)</strong> sources (
                    {preparedDocsCount} ready)
                  </span>
                </label>
              )}
              {action === "connect" && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={syncOnConnect}
                    onChange={(e) => setSyncOnConnect(e.target.checked)}
                  />
                  <span>
                    Import existing notes and attachments from this Obsidian
                    vault into your Career Library
                  </span>
                </label>
              )}
            </div>
            <div className="form-actions">
              <button
                type="submit"
                className="button primary small"
                disabled={Boolean(busy)}
              >
                {busy === "configure" ? (
                  <Busy
                    text={
                      action === "create"
                        ? "Creating vault…"
                        : "Connecting vault…"
                    }
                  />
                ) : action === "create" ? (
                  <>
                    <Plus size={14} />
                    Create Obsidian vault
                  </>
                ) : (
                  <>
                    <FolderOpen size={14} />
                    Connect existing vault
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
function Library({
  onError,
  onNotice,
  onChanged,
  onRestart,
  restarting,
  timezone,
}: {
  onError: (e: unknown) => void;
  onNotice: (s: string) => void;
  onChanged?: () => void;
  onRestart?: () => void;
  restarting?: boolean;
  timezone: string;
}) {
  const [extraction, setExtraction] = useState<
      Record<string, BuddySource["extraction"]>
    >({}),
    [obsidian, setObsidian] = useState<ObsidianStatus | null>(null),
    [preparing, setPreparing] = useState(false),
    [resetting, setResetting] = useState(false),
    [clearing, setClearing] = useState(false),
    [confirmClearAll, setConfirmClearAll] = useState(false);
  const [connectionRevision,setConnectionRevision]=useState(0);
  const [docs, setDocs] = useState<BoardDocument[]>([]),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(""),
    [selectedTag, setSelectedTag] = useState(""),
    [tagsExpanded, setTagsExpanded] = useState(false),
    [confirmDeleteTag, setConfirmDeleteTag] = useState(""),
    [deletingTag, setDeletingTag] = useState(""),
    [sourceFilter, setSourceFilter] = useState<"split" | "used" | "unused">(
      "split",
    ),
    [groupByFolder, setGroupByFolder] = useState(true),
    [pageDragOver, setPageDragOver] = useState(false),
    [droppedQueue, setDroppedQueue] = useState<DroppedFile[]>([]);
  async function load() {
    try {
      const [r, prepared, obs] = await Promise.all([
        api<{ documents: BoardDocument[] }>("/documents"),
        api<{ documents: BuddySource[] }>("/buddy/documents"),
        api<ObsidianStatus>("/obsidian"),
      ]);
      setExtraction(
        Object.fromEntries(prepared.documents.map((d) => [d.id, d.extraction])),
      );
      setDocs(r.documents.filter((d) => !d.opportunityId));
      setObsidian(obs);
      onChanged?.();
    } catch (e) {
      onError(e);
    } finally {
      setLoading(false);
    }
  }
  async function prepare(force = false) {
    setPreparing(true);
    try {
      if (force) {
        await api("/buddy/index", { method: "DELETE" });
      }
      for (let i = 0; i < docs.length; i += 50)
        await api(
          "/buddy/index",
          json({
            documentIds: docs.slice(i, i + 50).map((doc) => doc.id),
            force,
          }),
        );
      await load();
      onNotice(
        force
          ? "Library text reset and re-prepared."
          : "Library text prepared for Career Buddy.",
      );
    } catch (error) {
      onError(error);
    } finally {
      setPreparing(false);
    }
  }
  async function resetPrepared() {
    setResetting(true);
    try {
      const res = await api<{ resetCount: number }>("/buddy/index", {
        method: "DELETE",
      });
      await load();
      onNotice(
        `Reset prepared text for ${res.resetCount} library document${res.resetCount === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      onError(error);
    } finally {
      setResetting(false);
    }
  }
  async function prepareSingleDocument(id: string, force: boolean) {
    try {
      await api("/buddy/index", json({ documentIds: [id], force }));
      await load();
      onNotice(force ? "Source re-prepared." : "Source prepared.");
    } catch (error) {
      onError(error);
    }
  }
  async function clearLibrary() {
    setClearing(true);
    try {
      const res = await api<{
        deletedCount: number;
        preservedSubmittedCount: number;
      }>("/documents?scope=library", { method: "DELETE" });
      setConfirmClearAll(false);
      await load();
      onNotice(
        res.preservedSubmittedCount > 0
          ? `Cleared ${res.deletedCount} library document${res.deletedCount === 1 ? "" : "s"} (${res.preservedSubmittedCount} submitted preserved).`
          : `Cleared ${res.deletedCount} library document${res.deletedCount === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      onError(error);
    } finally {
      setClearing(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <main
      className={`content-page ${pageDragOver ? "page-drag-active" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!pageDragOver) setPageDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setPageDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setPageDragOver(false);
        void collectDroppedFiles(e.dataTransfer).then((items) => {
          if (items.length) setDroppedQueue(items);
          else
            onError(
              new Error(
                "No readable files were found in the dropped selection (hidden and system folders are skipped).",
              ),
            );
        });
      }}
    >
      <div className="page-heading">
        <div>
          <div className="eyebrow">BUILT ON YOUR EXPERIENCE</div>
          <h1>
            Your career library<span className="heading-dot">.</span>
          </h1>
          <p>
            Bring your career material together. Give Career Buddy the evidence
            for your next application.
          </p>
        </div>
        <Badge kind="green">
          {docs.length} document{docs.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <div className="library-intro-panel">
        <div>
          <FolderOpen size={24} />
          <h2>Your career, in its own words.</h2>
          <p>
            Drop in CVs, old job descriptions, project notes, achievements,
            certificates, interview notes, articles, or entire folders of
            career-related evidence. This is your source library; you can select
            what Career Buddy reads for each conversation.
          </p>
        </div>
        <div className="library-index-state">
          <span className="badge green">
            <Check size={12} />
            Stored originals
          </span>
          <span className="badge muted">Local text preparation</span>
          <p>
            PDF, DOCX, PPTX, HTML, RTF, captions (.vtt/.srt), and text files can
            be prepared locally as text chunks. Career Buddy selects excerpts by
            matching words and, for indexed sources, meaning. Select sources for semantic indexing below. Selected
            excerpts are sent only when you message Career Buddy. Scanned PDFs
            need OCR first; originals stay unchanged.
          </p>
        </div>
      </div>
      <VectorIndex onError={onError} refreshKey={connectionRevision} />
      <div className="buddy-library-tools">
        <p>
          {docs.filter((doc) => extraction[doc.id]?.status === "ready").length}{" "}
          of {docs.length} documents have readable text ready. Preparation is
          local and needs no API key.
        </p>
        <div className="library-tool-actions">
          <button
            type="button"
            className="button secondary small"
            disabled={preparing || resetting || clearing || !docs.length}
            onClick={() => void prepare(false)}
          >
            {preparing ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Sparkles size={15} />
            )}{" "}
            {preparing ? "Preparing text…" : "Prepare library text"}
          </button>
          <button
            type="button"
            className="button secondary small"
            disabled={preparing || resetting || clearing || !docs.length}
            onClick={() => void prepare(true)}
            title="Clear cached text chunks and re-prepare all library documents from scratch"
          >
            <RotateCw size={15} className={preparing ? "spin" : ""} />
            Reset &amp; re-prepare
          </button>
          {docs.some((doc) => extraction[doc.id]?.status === "ready") && (
            <button
              type="button"
              className="button secondary small"
              disabled={preparing || resetting || clearing}
              onClick={() => void resetPrepared()}
              title="Clear prepared text cache so sources move back to Unprepared"
            >
              {resetting ? "Resetting…" : "Reset prepared"}
            </button>
          )}
          {docs.some((doc) => doc.status !== "submitted") &&
            (confirmClearAll ? (
              <div className="library-clear-confirm">
                <span>
                  Clear{" "}
                  {docs.filter((doc) => doc.status !== "submitted").length}{" "}
                  library document
                  {docs.filter((doc) => doc.status !== "submitted").length === 1
                    ? ""
                    : "s"}
                  ?
                </span>
                <button
                  type="button"
                  className="button danger small"
                  disabled={clearing}
                  onClick={() => void clearLibrary()}
                >
                  {clearing ? "Clearing…" : "Confirm clear all"}
                </button>
                <button
                  type="button"
                  className="button secondary small"
                  disabled={clearing}
                  onClick={() => setConfirmClearAll(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="button secondary small danger-text"
                disabled={preparing || resetting || clearing}
                onClick={() => setConfirmClearAll(true)}
              >
                <Trash2 size={15} />
                Clear all
              </button>
            ))}
        </div>
      </div>
      <DocumentConnections onError={onError} onChanged={()=>{setConnectionRevision(v=>v+1);void load();}} onRestart={onRestart} restarting={restarting} />
      <ObsidianVaultPanel
        obsidian={obsidian}
        totalDocs={docs.length}
        preparedDocsCount={
          docs.filter((doc) => extraction[doc.id]?.status === "ready").length
        }
        timezone={timezone}
        restarting={restarting}
        onRestart={onRestart}
        onReload={load}
        onNotice={onNotice}
        onError={onError}
      />
      <div className="content-panel">
        <div className="library-browse-bar">
          <div className="search-input library-search">
            <Search size={16} />
            <input
              aria-label="Search reference documents"
              placeholder="Find a reference document, folder, or #tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {docs.length > 0 && (
            <div className="library-browse-controls">
              <div
                className="library-view-toggle"
                role="group"
                aria-label="Source preparation view"
              >
                <button
                  type="button"
                  className={sourceFilter === "split" ? "active" : ""}
                  onClick={() => setSourceFilter("split")}
                >
                  Split view
                </button>
                <button
                  type="button"
                  className={sourceFilter === "used" ? "active" : ""}
                  onClick={() => setSourceFilter("used")}
                >
                  <Check size={12} />
                  Used (
                  {
                    docs.filter((d) => extraction[d.id]?.status === "ready")
                      .length
                  }
                  )
                </button>
                <button
                  type="button"
                  className={sourceFilter === "unused" ? "active" : ""}
                  onClick={() => setSourceFilter("unused")}
                >
                  Unused (
                  {
                    docs.filter((d) => extraction[d.id]?.status !== "ready")
                      .length
                  }
                  )
                </button>
              </div>
              <div
                className="library-view-toggle"
                role="group"
                aria-label="Library view mode"
              >
                <button
                  type="button"
                  className={groupByFolder ? "active" : ""}
                  onClick={() => setGroupByFolder(true)}
                >
                  <Folder size={13} />
                  By folder
                </button>
                <button
                  type="button"
                  className={!groupByFolder ? "active" : ""}
                  onClick={() => setGroupByFolder(false)}
                >
                  <List size={13} />
                  Flat list
                </button>
              </div>
            </div>
          )}
        </div>
        {(() => {
          const counts = new Map<
            string,
            { label: string; count: number; removableCount: number }
          >();
          for (const doc of docs) {
            for (const tag of doc.tags || []) {
              const key = tag.toLowerCase();
              const existing = counts.get(key);
              const isRemovable = doc.status !== "submitted" ? 1 : 0;
              if (existing) {
                existing.count++;
                existing.removableCount += isRemovable;
              } else {
                counts.set(key, {
                  label: tag,
                  count: 1,
                  removableCount: isRemovable,
                });
              }
            }
          }
          const tagEntries = [...counts.values()].sort(
            (a, b) => b.count - a.count || a.label.localeCompare(b.label),
          );
          if (!tagEntries.length) return null;
          const activeTagEntry = selectedTag
            ? counts.get(selectedTag.toLowerCase())
            : undefined;
          const pendingDeleteEntry = confirmDeleteTag
            ? counts.get(confirmDeleteTag.toLowerCase())
            : undefined;
          return (
            <div className="library-tags-section">
              <div className="library-tags-header">
                <button
                  type="button"
                  className="library-tags-toggle"
                  aria-expanded={tagsExpanded}
                  onClick={() => setTagsExpanded((v) => !v)}
                >
                  {tagsExpanded ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                  <Tag size={13} />
                  <strong>Tags</strong>
                  <span className="badge muted">{tagEntries.length}</span>
                </button>
                {selectedTag && (
                  <div className="library-tags-active-bar">
                    <span className="badge green">
                      <Tag size={11} />
                      {selectedTag}
                    </span>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setSelectedTag("");
                        setConfirmDeleteTag("");
                      }}
                    >
                      Clear filter
                    </button>
                    {activeTagEntry &&
                      activeTagEntry.removableCount > 0 &&
                      confirmDeleteTag.toLowerCase() !==
                        selectedTag.toLowerCase() && (
                        <button
                          type="button"
                          className="button secondary small danger-text"
                          onClick={() => setConfirmDeleteTag(selectedTag)}
                        >
                          <Trash2 size={13} />
                          Delete #{selectedTag} ({activeTagEntry.removableCount}
                          )
                        </button>
                      )}
                  </div>
                )}
                {confirmDeleteTag && pendingDeleteEntry && (
                  <div className="document-delete-confirm">
                    <span>
                      Delete {pendingDeleteEntry.removableCount} document
                      {pendingDeleteEntry.removableCount === 1 ? "" : "s"}{" "}
                      tagged #{pendingDeleteEntry.label}?
                    </span>
                    <button
                      type="button"
                      className="button danger small"
                      disabled={Boolean(deletingTag)}
                      onClick={async () => {
                        const targetTag = pendingDeleteEntry.label;
                        setDeletingTag(targetTag);
                        try {
                          const res = await api<{
                            deletedCount: number;
                            preservedSubmittedCount: number;
                          }>(
                            `/documents?scope=library&tag=${encodeURIComponent(targetTag)}`,
                            { method: "DELETE" },
                          );
                          setConfirmDeleteTag("");
                          if (
                            selectedTag.toLowerCase() ===
                            targetTag.toLowerCase()
                          )
                            setSelectedTag("");
                          await load();
                          onNotice(
                            `Deleted ${res.deletedCount} document${res.deletedCount === 1 ? "" : "s"} tagged #${targetTag}.`,
                          );
                        } catch (err) {
                          onError(err);
                        } finally {
                          setDeletingTag("");
                        }
                      }}
                    >
                      {deletingTag ? "Deleting…" : "Confirm delete"}
                    </button>
                    <button
                      type="button"
                      className="button secondary small"
                      disabled={Boolean(deletingTag)}
                      onClick={() => setConfirmDeleteTag("")}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
              {tagsExpanded && (
                <div className="library-tag-filters" aria-label="Filter by tag">
                  <button
                    type="button"
                    className={`library-tag-filter ${!selectedTag ? "active" : ""}`}
                    onClick={() => setSelectedTag("")}
                  >
                    All ({docs.length})
                  </button>
                  {tagEntries.map((item) => (
                    <span
                      key={item.label}
                      className={`library-tag-chip ${selectedTag.toLowerCase() === item.label.toLowerCase() ? "active" : ""}`}
                    >
                      <button
                        type="button"
                        className="library-tag-chip-select"
                        onClick={() =>
                          setSelectedTag(
                            selectedTag.toLowerCase() ===
                              item.label.toLowerCase()
                              ? ""
                              : item.label,
                          )
                        }
                      >
                        <Tag size={11} />
                        {item.label}
                        <span>{item.count}</span>
                      </button>
                      {item.removableCount > 0 && (
                        <button
                          type="button"
                          className="library-tag-chip-delete"
                          aria-label={`Delete all documents tagged ${item.label}`}
                          title={`Delete ${item.removableCount} document${item.removableCount === 1 ? "" : "s"} tagged #${item.label}`}
                          onClick={() => setConfirmDeleteTag(item.label)}
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
        {loading ? (
          <Busy text="Opening your library…" />
        ) : (
          <Documents
            documents={docs.filter(
              (d) =>
                (!selectedTag ||
                  (d.tags || []).some(
                    (t) => t.toLowerCase() === selectedTag.toLowerCase(),
                  )) &&
                `${d.name} ${d.notes} ${d.kind} ${(d.tags || []).join(" ")}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
            )}
            timezone={timezone}
            extraction={extraction}
            externalQueue={droppedQueue}
            onExternalQueueConsumed={() => setDroppedQueue([])}
            groupByFolder={groupByFolder}
            splitByPrepared={true}
            sourceFilter={sourceFilter}
            onPrepareDocument={prepareSingleDocument}
            selectedTag={selectedTag}
            onSelectTag={setSelectedTag}
            onChanged={() => void load()}
            onNotice={onNotice}
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
  appearance,
  appearanceDirty,
  appearanceSaving,
  appearanceFailed,
  onAppearanceChange,
  onAppearanceSave,
  profile,
  onProfileSaved,
  onSaved,
  restarting,
  onRestart,
  onError,
  onNotice,
}: {
  settings: Settings;
  appearance: Appearance;
  appearanceDirty: boolean;
  appearanceSaving: boolean;
  appearanceFailed: boolean;
  onAppearanceChange: (patch: Partial<Appearance>) => void;
  onAppearanceSave: () => void;
  profile: Profile;
  onProfileSaved: (profile: Profile) => void;
  onSaved: (s: Settings) => void;
  restarting: boolean;
  onRestart: () => void;
  onError: (e: unknown) => void;
  onNotice: (s: string) => void;
}) {
  const [form, setForm] = useState(settings),
    [busy, setBusy] = useState(false),
    [backingUp, setBackingUp] = useState(false),
    [restoreConfirmed, setRestoreConfirmed] = useState(false),
    [restoreResult, setRestoreResult] = useState<{destination:string;documentsRestored:number} | null>(null),
    [backupList, setBackupList] = useState<{name:string}[] | null>(null),
    [backupInspection, setBackupInspection] = useState<{name:string;createdAt:string;counts:Record<string,number>;checked:number;issues:string[];valid:boolean} | null>(null);
  useEffect(() => {
    setForm(settings);
  }, [
    settings.timezone,
    settings.documentsSubdir,
    settings.referenceSubdir,
    settings.backupSubdir,
    settings.pendingHostPath,
  ]);
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
          },
          "PATCH",
        ),
      );
      onSaved(s);
      setForm(s);
      onNotice(
        s.pendingHostPath
          ? "Settings saved. Use Update & restart board below (or run ./board restart on the host) to apply the new folder."
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
      <ProfileSettings
        profile={profile}
        onSaved={onProfileSaved}
        onError={onError}
        onNotice={onNotice}
      />
      <ThemeSettings
        appearance={appearance}
        onChange={onAppearanceChange}
        onSave={onAppearanceSave}
        onReset={() =>
          onAppearanceChange({ themeAccent: "", themeBackground: "" })
        }
        saving={appearanceSaving}
        failed={appearanceFailed}
        dirty={appearanceDirty}
      />
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
              hint="Enter an absolute folder path on the host, save, then choose Update & restart. Use Reliability & recovery below to copy or reconnect existing files."
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
                Apply with <strong>Update &amp; restart board</strong> or{" "}
                <code>./board restart</code> on your host.
              </span>
              <button
                type="button"
                className="button secondary small"
                disabled={restarting || busy}
                onClick={onRestart}
              >
                <RotateCw
                  size={14}
                  className={restarting ? "spin" : undefined}
                />
                {restarting ? "Restarting…" : "Apply & restart"}
              </button>
            </div>
          )}
          <div className="form-actions">
            <button
              className="button primary"
              disabled={busy || appearanceSaving}
            >
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
      <ReliabilitySettings onError={onError} timezone={settings.timezone}/>
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
              configured backup subfolder. This includes account data and Career
              Buddy API keys; keep it private. Use Reliability & recovery above to activate a verified backup.
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
          <div><strong>Inspect a backup</strong><p>Check a backup in the configured backup folder without restoring it. Backups contain private account information and may include API keys.</p>
            {backupList && <><select aria-label="Choose backup to inspect" disabled={backingUp} defaultValue="" onChange={async (e) => { setBackupInspection(null); setRestoreConfirmed(false); setRestoreResult(null); if (!e.target.value) return; setBackingUp(true); try { setBackupInspection(await api("/backups/inspect", json({name:e.target.value}))); } catch (error) { setBackupInspection(null); onError(error); } finally { setBackingUp(false); } }}><option value="">Choose a backup</option>{backupList.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}</select>{backupList.length === 0 && <p>No completed backups found.</p>}</>}
            {backupInspection && <div role="status"><p>{backupInspection.valid ? "Integrity checks passed" : "Issues found"} · {backupInspection.checked} documents verified · {backupInspection.counts.records} opportunities · {backupInspection.counts.tasks} tasks</p><p>Created: {backupInspection.createdAt || "unknown"}</p>{backupInspection.issues.map((issue) => <p key={issue}>{issue}</p>)}</div>}
          </div>
          <button type="button" className="button secondary" disabled={backingUp} onClick={async () => {setRestoreConfirmed(false); setRestoreResult(null); setBackingUp(true); try {const result = await api<{backups:{name:string}[]}>("/backups"); setBackupList(result.backups); setBackupInspection(null);} catch (error) {onError(error);} finally {setBackingUp(false);}}}>Find backups</button>
        </div>
        {backupInspection?.valid && <div className="settings-action">
          <div><strong>Restore into a separate workspace</strong>
            <p>Create a private offline copy of {backupInspection.name}. The current board stays active. The copy retains account data, conversations and any saved API keys, and is stored in the board's private application data folder.</p>
            <label className="checkbox-row"><input type="checkbox" checked={restoreConfirmed} disabled={backingUp} onChange={(e) => setRestoreConfirmed(e.target.checked)} /><span>I want to create this private isolated copy.</span></label>
            {restoreResult && <div role="status"><p>Isolated restore completed: {restoreResult.documentsRestored} documents copied and verified.</p><p>Workspace: <code>{restoreResult.destination}</code></p><p>The restored service has not been started. Its restore report is saved in the workspace.</p></div>}
          </div>
          <button type="button" className="button secondary" disabled={backingUp || !restoreConfirmed} onClick={async () => {setBackingUp(true);setRestoreResult(null);try {setRestoreResult(await api("/backups/restore-isolated",json({name:backupInspection.name,confirm:true})));setRestoreConfirmed(false);}catch(error){onError(error);}finally{setBackingUp(false);}}}>{backingUp ? "Restoring…" : "Create isolated restore"}</button>
        </div>}
        <div className="settings-action">
          <div>
            <strong>Export board records</strong>
            <p>
              Download opportunity history, tasks, chats and the document
              manifest as JSON. File bytes, API keys and login credentials are
              excluded.
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
        <div className="settings-action">
          <div>
            <strong>Update &amp; restart board</strong>
            <p>
              Rebuild and restart the workspace service, apply any pending host
              document-folder changes, and reconnect automatically. Your
              opportunities, documents, and active sign-in session are
              preserved.
            </p>
          </div>
          <button
            type="button"
            className="button secondary"
            disabled={restarting || backingUp}
            onClick={onRestart}
          >
            <RotateCw size={16} className={restarting ? "spin" : undefined} />
            {restarting ? "Restarting…" : "Update & restart board"}
          </button>
        </div>
      </section>
      <DocumentConnections onError={onError} onRestart={onRestart} restarting={restarting} />
      <CareerBuddySettings onError={onError} />
      <EmbeddingSettings onError={onError} />
      <FitCriteria onError={onError} />
      <CareerBuddySettings decision onError={onError} />
    </main>
  );
}
