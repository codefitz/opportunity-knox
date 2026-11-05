import { uploadId } from "./lib/upload-queue";
import DocumentThumbnail from "./components/DocumentThumbnail";
import WorkspaceAction from "./components/WorkspaceAction";
import BuildVersion from "./components/BuildVersion";
import WorkspaceSections from "./components/WorkspaceSections";
import AIActivity,{type ActivityDestination} from "./components/AIActivity";
import RecordImports from "./components/RecordImports";
import OpportunityBriefing from "./components/OpportunityBriefing";
import AIWorkflowSettings from "./components/AIWorkflowSettings";
import JobIntake,{type IntakeResult} from "./components/JobIntake";
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
import DocumentConnections from "./components/DocumentConnections";
import BuddyWorkspace from "./components/BuddyWorkspace";
import VectorIndex from "./components/VectorIndex";
import OpportunityAISummary from "./components/OpportunityAISummary";
import {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
  Fragment,
  type ReactNode,
  type FormEvent,
  type DragEvent,
} from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Briefcase,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Clock3,
  Columns3,
  Copy,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  FolderInput,
  Layers,
  LayoutGrid,
  ChartNoAxesCombined,
  ListTodo,
  List,
  LoaderCircle,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
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
  isTemporaryConnectionError,
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
  type UpdateStatus,
} from "./types";

import JobLookup, {
  JOB_FIELDS,
  lookupNote,
  type JobLookupResult,
} from "./components/JobLookup";

import {
  AVAILABLE_COLUMNS,
  DEFAULT_VISIBLE_COLUMNS,
  loadSavedColumns,
  saveColumns,
  loadSavedSort,
  saveSort,
  sortOpportunities,
  type ColumnId,
  type SortConfig,
} from "./lib/opportunity-columns.ts";
import { findDuplicateMap, findExistingDuplicate } from "./lib/duplicates.ts";
import { type TargetCompany } from "./lib/target-companies.ts";
import { SENIORITY_LABELS } from "./lib/seniority.ts";
import { ALIGNMENT_TIER_LABELS } from "./lib/alignment.ts";
import TargetWishlist from "./components/TargetWishlist";
import AlignmentSettings from "./components/AlignmentSettings";
import BulkActionsBar from "./components/BulkActionsBar";

import Dashboard from "./components/Dashboard";
import CareerBuddy, { type BuddySource } from "./components/CareerBuddy";
import CareerBuddySettings from "./components/CareerBuddySettings";
import DocumentStudio from "./components/DocumentStudio";
import EmbeddingSettings from "./components/EmbeddingSettings";
import MCPSettings from "./components/MCPSettings";
import Todos from "./components/Todos";
import ProfileSettings, {
  ThemeSettings,
  applyTheme,
  appearanceFrom,
} from "./components/ProfileSettings";
import "./themes.css";

type Page =
  | "dashboard"
  | "opportunities"
  | "board"
  | "todos"
  | "library"
  | "studio"
  | "buddy"
  | "activity"
  | "settings";
const PAGE_LABELS: Record<Page, string> = {
  dashboard: "Dashboard",
  opportunities: "Opportunities",
  board: "Kanban board",
  todos: "To-do list",
  library: "Career Hub",
  studio: "Document Studio",
  buddy: "Career Buddy",
  activity: "AI activity",
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
  const [initialOpportunityTab,setInitialOpportunityTab]=useState("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [page, setPage] = useState<Page>(routePage),
    [opportunityFilters, setOpportunityFilters] = useState({...defaultOpportunityFilters,tags:[] as string[]});
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [newOpen, setNewOpen] = useState(false),
    [newUrl, setNewUrl] = useState(""),
    [newCompany, setNewCompany] = useState(""),
    [newRole, setNewRole] = useState(""),
    [newFile, setNewFile] = useState<File | null>(null),
    [newText, setNewText] = useState("");
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(loadSavedColumns);
  const [tableSort, setTableSort] = useState<SortConfig>(loadSavedSort);
  const [groupByCompany, setGroupByCompany] = useState<boolean>(() => {
    try {
      return localStorage.getItem("knox_opportunity_group_by_company") === "true";
    } catch {
      return false;
    }
  });
  const [collapsedCompanies, setCollapsedCompanies] = useState<Record<string, boolean>>({});
  const [opportunitySubTab, setOpportunitySubTab] = useState<"active" | "wishlist">("active");
  const [targetCompanies, setTargetCompanies] = useState<TargetCompany[]>([]);
  const [profile, setProfile] = useState<Profile>({
    name: "Your workspace",
    avatarUrl: "",
    revision: 0,
  });
  useEffect(()=>{const message=sessionStorage.getItem('knox-reset-receipt');if(message){sessionStorage.removeItem('knox-reset-receipt');setNotice(message);}},[]);
  const [tasks, setTasks] = useState<Task[]>([]),
    [referenceCount, setReferenceCount] = useState(0),
    [refreshing, setRefreshing] = useState(false),
    [restarting, setRestarting] = useState(false),
    [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const restartingRef = useRef(false);
  const view = page === "board" ? "board" : "list";
  const [selected, setSelected] = useState<Opportunity | null>(null),
    [studioOpportunityId, setStudioOpportunityId] = useState<string>(""),
    [dragging, setDragging] = useState(""),
    [dropStage, setDropStage] = useState("");
  const [selectedOpportunityIds, setSelectedOpportunityIds] = useState<
    string[]
  >([]);

  const toggleSelectOpportunity = (id: string) => {
    setSelectedOpportunityIds((curr) =>
      curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id],
    );
  };

  const selectAllFiltered = () => {
    setSelectedOpportunityIds(filtered.map((o) => o.id));
  };

  const clearSelection = () => {
    setSelectedOpportunityIds([]);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedOpportunityIds.length > 0) {
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedOpportunityIds.length]);
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
  function navigate(next: Page, section?: string) {
    const hash = `#/${next}${section ? `?section=${section}` : ""}`;
    if (window.location.hash !== hash) window.location.hash = hash;
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
    if (restartingRef.current) return;
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
        updateStatus?: UpdateStatus;
      }>("/board");
      setOpportunities(data.opportunities);
      if (data.updateStatus) setUpdateStatus(data.updateStatus);
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
      api<TargetCompany[]>("/target-companies")
        .then(setTargetCompanies)
        .catch(() => {});
    } catch (e) {
      report(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }
  useEffect(() => {
    if (session?.authenticated) {
      void load();
    }
  }, [session?.authenticated]);
  useEffect(() => {
    if (!session?.authenticated || restarting) return;
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking || restartingRef.current) return;
      checking = true;
      try {
        const status = await api<UpdateStatus>("/updates/check");
        if (active) setUpdateStatus(status);
      } catch {
        if (active) setUpdateStatus(current => current ? { ...current, checkError: "Update check unavailable." } : current);
      } finally { checking = false; }
    };
    void check();
    const interval = window.setInterval(() => void check(), 30000);
    window.addEventListener("focus", check);
    return () => { active = false; window.clearInterval(interval); window.removeEventListener("focus", check); };
  }, [session?.authenticated, restarting]);
  useEffect(() => {
    if (session?.authenticated && (page === "dashboard" || page === "todos"))
      void load(true);
  }, [page]);
  useEffect(() => {
    if (!session?.authenticated || restarting) return;
    const refresh = () => {
      const element = document.activeElement as HTMLElement | null;
      if (
        restartingRef.current ||
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
  }, [session?.authenticated, page, newOpen, selected, restarting]);
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
    // Reads already in flight can fail while the restart deliberately stops the server.
    if (restartingRef.current && isTemporaryConnectionError(e)) return;
    setError(displayError(e));
    if (e instanceof ApiError && e.status === 401)
      setSession({
        authenticated: false,
        setupRequired: false,
        setupTokenRequired: false,
      });
  }
  async function restartBoard() {
    if (restartingRef.current) return;
    restartingRef.current = true;
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
              setNotice("");
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
      if (!reconnected) {
        setNotice("");
        setError(
          "The board is taking longer than expected to restart. Refresh the page or check ./board logs.",
        );
      }
    } catch (e) {
      setNotice("");
      restartingRef.current = false;
      report(e);
    } finally {
      restartingRef.current = false;
      setRestarting(false);
    }
  }
  async function openOpportunity(id: string,tab="overview") {
    setInitialOpportunityTab(tab);
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
  function add(prefill?: { company?: string; role?: string; url?: string }) {
    setNewCompany(prefill?.company || "");
    setNewRole(prefill?.role || "");
    setNewUrl(prefill?.url || "");
    setNewFile(null);
    setNewText("");
    setNewOpen(true);
  }
  function handleHeaderSort(column: ColumnId) {
    setTableSort((current) => {
      let next: SortConfig;
      if (current.column === column) {
        next = {
          column,
          direction: current.direction === "asc" ? "desc" : "asc",
        };
      } else {
        next = { column, direction: "asc" };
      }
      saveSort(next);
      return next;
    });
  }
  async function addTargetCompany(body: Partial<TargetCompany>) {
    const created = await api<TargetCompany>("/target-companies", json(body));
    setTargetCompanies((current) => [...current, created]);
    setNotice(`Added target company ${created.name}.`);
  }
  async function updateTargetCompany(id: string, body: Partial<TargetCompany>) {
    const updated = await api<TargetCompany>(`/target-companies/${id}`, json(body, "PATCH"));
    setTargetCompanies((current) => current.map((c) => (c.id === id ? updated : c)));
    setNotice(`Updated target company ${updated.name}.`);
  }
  async function deleteTargetCompany(id: string) {
    await api(`/target-companies/${id}`, { method: "DELETE" });
    setTargetCompanies((current) => current.filter((c) => c.id !== id));
    setNotice("Target company removed.");
  }
  async function mergeOpportunity(targetId: string, duplicateId: string) {
    try {
      const updated = await api<Opportunity>(`/opportunities/${targetId}/merge`, json({ duplicateId }));
      await load(true);
      setSelected(updated);
      setNotice("Opportunities successfully merged.");
    } catch (err) {
      report(err);
    }
  }
  async function deleteOpportunity(id: string) {
    try {
      await api(`/opportunities/${id}`, { method: "DELETE" });
      setSelected(null);
      await load(true);
      setNotice("Opportunity deleted.");
    } catch (err) {
      report(err);
    }
  }
  const filterTimezone = settings?.timezone || "Europe/London";
  const filterNow = new Date();
  const overdueIds = overdueOpportunityIds(opportunities,tasks,calendarDay(filterNow,filterTimezone));
  const filtered = filterOpportunities(opportunities,opportunityFilters,overdueIds,filterTimezone,filterNow);
  const duplicateMap = useMemo(() => findDuplicateMap(opportunities), [opportunities]);
  const sortedOpportunities = useMemo(() => {
    return sortOpportunities(filtered, tableSort);
  }, [filtered, tableSort]);
  const companyGroups = useMemo(() => {
    if (!groupByCompany) return null;
    const groups = new Map<string, Opportunity[]>();
    for (const o of sortedOpportunities) {
      const key = (o.company || "").trim() || "Unspecified employer";
      const list = groups.get(key) || [];
      list.push(o);
      groups.set(key, list);
    }
    if (tableSort.column === "company") {
      return [...groups.entries()].sort(([a], [b]) =>
        tableSort.direction === "desc" ? b.localeCompare(a) : a.localeCompare(b),
      );
    }
    return [...groups.entries()];
  }, [sortedOpportunities, groupByCompany, tableSort]);
  const active = opportunities.filter((o) => !o.outcome),
    activeExcluded = active.filter((o) => o.matchedExclusions && o.matchedExclusions.length > 0),
    interviews = active.filter((o) =>
      ["interviews", "final-interview"].includes(o.stage),
    ),
    overdue = active.filter(o => overdueIds.has(o.id));
  const renderOpportunityRow = (o: Opportunity) => {
    const isSelected = selectedOpportunityIds.includes(o.id);
    return (
      <tr
        key={o.id}
        className={`${groupByCompany ? "company-grouped-row" : ""} ${isSelected ? "selected" : ""}`}
      >
        <td className="select-col" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelectOpportunity(o.id)}
            aria-label={`Select ${o.role} at ${o.company}`}
          />
        </td>
        {visibleColumns.map((colId) => {
        switch (colId) {
          case "opportunity":
            return (
              <td key={colId}>
                <button
                  className="table-link"
                  onClick={() => void openOpportunity(o.id)}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {o.role}
                    {o.matchedExclusions && o.matchedExclusions.length > 0 && (
                      <span
                        className="exclusion-warning-badge"
                        title={`Excluded keyword matched: ${o.matchedExclusions.join(", ")}`}
                      >
                        <AlertTriangle size={11} />
                        Excluded
                      </span>
                    )}
                    {duplicateMap.has(o.id) && (
                      <span
                        className="duplicate-warning-badge"
                        title="Potential duplicate detected"
                      >
                        <Copy size={11} />
                        Duplicate
                      </span>
                    )}
                  </span>
                  {!groupByCompany ? (
                    <small>{o.company}</small>
                  ) : o.jobReference ? (
                    <small>{o.jobReference}</small>
                  ) : null}
                </button>
              </td>
            );
          case "company":
            return <td key={colId}>{o.company || "—"}</td>;
          case "stage":
            return (
              <td key={colId}>
                {stageLabel(o.stage)}
                {o.outcome && (
                  <Badge kind={o.outcome === "hired" ? "green" : "muted"}>
                    {o.outcome}
                  </Badge>
                )}
              </td>
            );
          case "nextAction":
            return (
              <td key={colId}>
                {o.nextAction || "—"}
                {o.nextActionDate && (
                  <small>
                    {formatDate(o.nextActionDate, settings?.timezone)}
                  </small>
                )}
              </td>
            );
          case "deadline":
            return (
              <td key={colId}>
                {o.deadline
                  ? formatDate(o.deadline, settings?.timezone)
                  : "—"}
              </td>
            );
          case "priority":
            return (
              <td key={colId}>
                <Badge kind={o.priority === "high" ? "amber" : "muted"}>
                  {o.priority}
                </Badge>
              </td>
            );
          case "workMode":
            return <td key={colId}>{o.workMode || "—"}</td>;
          case "salary":
            return <td key={colId}>{o.salary || "—"}</td>;
          case "location":
            return <td key={colId}>{o.location || "—"}</td>;
          case "datePosted":
            return (
              <td key={colId}>
                {o.datePosted
                  ? formatDate(o.datePosted, settings?.timezone)
                  : "—"}
              </td>
            );
          case "applicantCount":
            return (
              <td key={colId}>
                {o.applicantCount != null && o.applicantCount !== ""
                  ? String(o.applicantCount)
                  : "—"}
              </td>
            );
          case "applicationRoute":
            return <td key={colId}>{o.applicationRoute || "—"}</td>;
          case "seniority":
            return (
              <td key={colId}>
                {o.seniority ? (
                  <Badge
                    kind={
                      o.seniority === "executive" || o.seniority === "director"
                        ? "accent"
                        : o.seniority === "lead"
                          ? "blue"
                          : "muted"
                    }
                  >
                    {SENIORITY_LABELS[o.seniority] || o.seniority}
                  </Badge>
                ) : (
                  "—"
                )}
              </td>
            );
          case "alignment":
            return (
              <td key={colId}>
                {o.alignmentScore != null ? (
                  <span
                    title={
                      [
                        o.matchedSkills?.length
                          ? `Matched skills: ${o.matchedSkills.join(", ")}`
                          : null,
                        o.missingSkills?.length
                          ? `Missing skills: ${o.missingSkills.join(", ")}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                  >
                    <Badge
                      kind={
                        o.alignmentTier === "strong"
                          ? "green"
                          : o.alignmentTier === "moderate"
                            ? "blue"
                            : o.alignmentTier === "reach"
                              ? "amber"
                              : "muted"
                      }
                    >
                      {o.alignmentScore}%{" "}
                      {ALIGNMENT_TIER_LABELS[o.alignmentTier || "mismatch"]}
                    </Badge>
                  </span>
                ) : (
                  "—"
                )}
              </td>
            );
          default:
            return <td key={colId}>—</td>;
        }
      })}
      <td>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {o.url && (
            <a
              href={o.url}
              target="_blank"
              rel="noreferrer"
              className="icon-button"
              aria-label={`Open job listing for ${o.role}`}
              title="Open original job listing in a new tab"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={16} />
            </a>
          )}
          <button
            className="icon-button"
            aria-label={`Open ${o.role}`}
            onClick={() => void openOpportunity(o.id)}
            title="Open opportunity details"
          >
            <ArrowUpRight size={17} />
          </button>
        </div>
      </td>
    </tr>
    );
  };
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
    <div className={`app-shell${page === "board" ? " board-focused" : ""}${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <Feedback authenticated={true}/>
      <button
        className="icon-button sidebar-toggle"
        aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        aria-expanded={!sidebarCollapsed}
        aria-controls="workspace-sidebar"
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
      >
        {sidebarCollapsed ? <PanelLeftOpen size={17}/> : <PanelLeftClose size={17}/>}
      </button>
      <aside id="workspace-sidebar" className="sidebar" inert={sidebarCollapsed} aria-hidden={sidebarCollapsed}>
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
              { id: "library", label: "Career Hub", icon: FolderOpen },
              { id: "studio", label: "Document Studio", icon: FileText },
              { id: "buddy", label: "Career Buddy", icon: Sparkles },
              { id: "activity", label: "AI activity", icon: Clock3 },
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
            title={
              updateStatus?.updateAvailable
                ? updateStatus.reason || "An update is available."
                : updateStatus?.checkError || undefined
            }
          >
            <RotateCw size={14} className={restarting ? "spin" : undefined} />
            {restarting ? "Restarting…" : "Update & restart"}
            {updateStatus?.updateAvailable ? (
              <span
                className="update-indicator-pill"
                title={updateStatus.reason || "Update available"}
              >
                Update
              </span>
            ) : null}
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
          {updateStatus && <div className="sidebar-version-tag"><BuildVersion status={updateStatus} /></div>}
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
              dailyTarget={settings?.dailyTarget || 3}
              onUpdateDailyTarget={async (newTarget: number) => {
                try {
                  const updated = await api<Settings>(
                    "/settings",
                    json({ dailyTarget: newTarget }, "PATCH"),
                  );
                  setSettings(updated);
                  setNotice(`Daily application goal set to ${newTarget}.`);
                } catch (err) {
                  setError(displayError(err));
                }
              }}
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
            {page === "opportunities" && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">
                      A LITTLE STRUCTURE. A CLEARER PATH.
                    </div>
                    <h1>
                      Your opportunities
                      <span className="heading-dot">.</span>
                    </h1>
                    <p>
                      Every possibility, application, and next action in one place.
                    </p>
                  </div>
                  <div className="opportunity-page-actions">
                    <WorkspaceAction
                      action="clear-opportunities"
                      label="Clear all opportunities"
                      disabled={!opportunities.length}
                      onComplete={(result) => {
                        setSelected(null);
                        setOpportunityFilters({
                          ...defaultOpportunityFilters,
                          tags: [],
                        });
                        void load(true);
                        setNotice(
                          `Cleared ${result.removedOpportunities} opportunities. Backup: ${result.backup.location}`,
                        );
                      }}
                    />
                    <button className="button primary" onClick={() => add()}>
                      <Plus size={18} />
                      Add opportunity
                    </button>
                  </div>
                </div>
                <nav
                  className="opportunities-subnav"
                  aria-label="Opportunity sections"
                >
                  <button
                    type="button"
                    className={`subnav-tab ${opportunitySubTab === "active" ? "active" : ""}`}
                    onClick={() => setOpportunitySubTab("active")}
                  >
                    <BriefcaseBusiness size={15} />
                    Active opportunities
                    <span className="subnav-pill">{active.length}</span>
                  </button>
                  <button
                    type="button"
                    className={`subnav-tab ${opportunitySubTab === "wishlist" ? "active" : ""}`}
                    onClick={() => setOpportunitySubTab("wishlist")}
                  >
                    <Building2 size={15} />
                    Target wishlist
                    <span className="subnav-pill">{targetCompanies.length}</span>
                  </button>
                </nav>
              </>
            )}
            {page === "opportunities" && opportunitySubTab === "wishlist" ? (
              <TargetWishlist
                companies={targetCompanies}
                onAdd={addTargetCompany}
                onUpdate={updateTargetCompany}
                onDelete={deleteTargetCompany}
                onCreateOpportunity={(prefill) => {
                  add(prefill);
                }}
              />
            ) : (
              <>
                {page === "opportunities" && (
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
                )}
                <OpportunityFiltersToolbar
                  value={opportunityFilters}
                  onChange={setOpportunityFilters}
                  opportunities={opportunities}
                  resultCount={filtered.length}
                  board={page === "board"}
                  timezone={filterTimezone}
                  onBack={() => navigate("opportunities")}
                  actions={
                    page === "board" ? (
                      <>
                        <button
                          className="button primary small"
                          onClick={() => add()}
                        >
                          <Plus size={16} />
                          Add opportunity
                        </button>
                        <details className="board-actions-menu">
                          <summary aria-label="Board actions">
                            <MoreHorizontal size={18} />
                          </summary>
                          <WorkspaceAction
                            action="clear-opportunities"
                            label="Clear all opportunities"
                            disabled={!opportunities.length}
                            onComplete={(result) => {
                              setSelected(null);
                              setOpportunityFilters({
                                ...defaultOpportunityFilters,
                                tags: [],
                              });
                              void load(true);
                              setNotice(
                                `Cleared ${result.removedOpportunities} opportunities. Backup: ${result.backup.location}`,
                              );
                            }}
                          />
                        </details>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={`button secondary small${groupByCompany ? " active" : ""}`}
                          aria-pressed={groupByCompany}
                          onClick={() => {
                            setGroupByCompany((prev) => {
                              const next = !prev;
                              try {
                                localStorage.setItem(
                                  "knox_opportunity_group_by_company",
                                  String(next),
                                );
                              } catch {}
                              return next;
                            });
                          }}
                          title={groupByCompany ? "Switch to flat list view" : "Group opportunities by company"}
                        >
                          <Building2 size={14} />
                          Group by company
                        </button>
                        <details className="column-picker-dropdown">
                          <summary
                            className="button secondary small"
                            aria-label="Customize visible columns"
                          >
                            <Columns3 size={14} />
                            Columns
                          </summary>
                          <div className="column-picker-menu">
                            <div className="column-picker-header">
                              <strong>Visible columns</strong>
                              <button
                                type="button"
                                className="column-picker-reset"
                                onClick={() => {
                                  setVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
                                  saveColumns(DEFAULT_VISIBLE_COLUMNS);
                                }}
                              >
                                Reset
                              </button>
                            </div>
                            <div className="column-picker-list">
                              {AVAILABLE_COLUMNS.map((col) => {
                                const checked = visibleColumns.includes(col.id);
                                const isRequired = col.id === "opportunity";
                                return (
                                  <label
                                    key={col.id}
                                    className="column-picker-item"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={isRequired}
                                      onChange={(e) => {
                                        let next: ColumnId[];
                                        if (e.target.checked) {
                                          next = [...visibleColumns, col.id];
                                        } else {
                                          next = visibleColumns.filter(
                                            (id) => id !== col.id,
                                          );
                                        }
                                        setVisibleColumns(next);
                                        saveColumns(next);
                                      }}
                                    />
                                    <span>{col.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        </details>
                        <button
                          className="button primary small"
                          onClick={() => add()}
                        >
                          <Plus size={16} />
                          Add opportunity
                        </button>
                        <details className="board-actions-menu">
                          <summary aria-label="Table actions">
                            <MoreHorizontal size={18} />
                          </summary>
                          <WorkspaceAction
                            action="clear-opportunities"
                            label="Clear all opportunities"
                            disabled={!opportunities.length}
                            onComplete={(result) => {
                              setSelected(null);
                              setOpportunityFilters({
                                ...defaultOpportunityFilters,
                                tags: [],
                              });
                              void load(true);
                              setNotice(
                                `Cleared ${result.removedOpportunities} opportunities. Backup: ${result.backup.location}`,
                              );
                            }}
                          />
                        </details>
                      </>
                    )
                  }
                />
                {activeExcluded.length > 0 && (
                  <div
                    className="exclusion-bulk-banner"
                    role="status"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "8px 16px",
                      margin: "0 0 16px 0",
                      background: "var(--amber-soft)",
                      border: "1px solid color-mix(in srgb, var(--amber) 35%, transparent)",
                      borderRadius: 6,
                      fontSize: 13,
                      color: "var(--ink)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <AlertTriangle size={15} style={{ color: "var(--amber)" }} />
                      <span>
                        <strong>
                          {activeExcluded.length} active opportunit{activeExcluded.length === 1 ? "y matches" : "ies match"} your exclusion keywords.
                        </strong>{" "}
                        {opportunityFilters.hideExcluded ? "(Currently hidden by filter)" : "(Currently visible)"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() =>
                          setOpportunityFilters((prev) => ({
                            ...prev,
                            hideExcluded: !prev.hideExcluded,
                          }))
                        }
                      >
                        {opportunityFilters.hideExcluded ? "Show excluded" : "Hide excluded"}
                      </button>
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={async () => {
                          if (
                            window.confirm(
                              `Archive all ${activeExcluded.length} excluded opportunities as ignored?`,
                            )
                          ) {
                            try {
                              const res = await api<{ archivedCount: number }>(
                                "/opportunities/archive-excluded",
                                { method: "POST" },
                              );
                              setNotice(
                                `Archived ${res.archivedCount} excluded opportunities.`,
                              );
                              void load(true);
                            } catch (err) {
                              setError(displayError(err));
                            }
                          }
                        }}
                      >
                        Archive all excluded ({activeExcluded.length})
                      </button>
                    </div>
                  </div>
                )}
                {loading ? (
                  <div className="loading-board">
                    <Busy text="Loading your opportunities…" />
                  </div>
                ) : view === "board" ? (
                  <div
                    className="kanban"
                    role="region"
                    tabIndex={0}
                    aria-label="Opportunity stages"
                  >
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
                              e.dataTransfer.dropEffect = "move";
                              if (dropStage !== stage.id) {
                                setDropStage(stage.id);
                              }
                            }
                          }}
                          onDragLeave={(e) => {
                            if (
                              !e.currentTarget.contains(e.relatedTarget as Node)
                            )
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
                              onClick={() => add()}
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
                                hasDuplicate={duplicateMap.has(op.id)}
                                timezone={settings?.timezone}
                                selected={selectedOpportunityIds.includes(
                                  op.id,
                                )}
                                isDragging={dragging === op.id}
                                onToggleSelect={() =>
                                  toggleSelectOpportunity(op.id)
                                }
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
                                  <button onClick={() => add()}>
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
                          <th className="select-col">
                            <input
                              type="checkbox"
                              aria-label="Select all opportunities"
                              checked={
                                filtered.length > 0 &&
                                filtered.every((o) =>
                                  selectedOpportunityIds.includes(o.id),
                                )
                              }
                              ref={(el) => {
                                if (el) {
                                  const some = filtered.some((o) =>
                                    selectedOpportunityIds.includes(o.id),
                                  );
                                  const all =
                                    filtered.length > 0 &&
                                    filtered.every((o) =>
                                      selectedOpportunityIds.includes(o.id),
                                    );
                                  el.indeterminate = some && !all;
                                }
                              }}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  selectAllFiltered();
                                } else {
                                  clearSelection();
                                }
                              }}
                            />
                          </th>
                          {visibleColumns.map((colId) => {
                            const colMeta = AVAILABLE_COLUMNS.find(
                              (c) => c.id === colId,
                            );
                            const isSorted = tableSort.column === colId;
                            return (
                              <th
                                key={colId}
                                className="sortable-th"
                                onClick={() => handleHeaderSort(colId)}
                                aria-sort={
                                  isSorted
                                    ? tableSort.direction === "asc"
                                      ? "ascending"
                                      : "descending"
                                    : "none"
                                }
                              >
                                <span className="th-content">
                                  {colMeta?.label || colId}
                                  {isSorted && (
                                    <span className="sort-icon">
                                      {tableSort.direction === "asc" ? (
                                        <ChevronUp size={13} />
                                      ) : (
                                        <ChevronDown size={13} />
                                      )}
                                    </span>
                                  )}
                                </span>
                              </th>
                            );
                          })}
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {groupByCompany && companyGroups ? (
                          companyGroups.map(([companyName, items]) => {
                            const isCollapsed =
                              !!collapsedCompanies[companyName];
                            const totalCols = visibleColumns.length + 2;
                            const activeCount = items.filter((x) => !x.outcome).length;
                            return (
                              <Fragment key={companyName}>
                                <tr
                                  className="company-group-row"
                                  onClick={() => {
                                    setCollapsedCompanies((curr) => ({
                                      ...curr,
                                      [companyName]: !curr[companyName],
                                    }));
                                  }}
                                >
                                  <td colSpan={totalCols}>
                                    <div className="company-group-header-cell">
                                      <span style={{ display: "inline-flex", color: "var(--ink-secondary)" }}>
                                        {isCollapsed ? (
                                          <ChevronRight size={15} />
                                        ) : (
                                          <ChevronDown size={15} />
                                        )}
                                      </span>
                                      <span className={`company-avatar tint-${companyName.length % 4}`}>
                                        {initials(companyName)}
                                      </span>
                                      <strong className="company-group-name">
                                        {companyName}
                                      </strong>
                                      <span className="group-count-badge">
                                        {items.length}{" "}
                                        {items.length === 1
                                          ? "role"
                                          : "roles"}
                                      </span>
                                      {activeCount > 0 && (
                                        <span className="group-active-badge">
                                          {activeCount} active
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        className="button secondary small"
                                        style={{ marginLeft: "auto", minHeight: 24, padding: "2px 8px", fontSize: 10 }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          add({
                                            company: companyName === "Unspecified employer" ? "" : companyName,
                                          });
                                        }}
                                        title={`Add opportunity at ${companyName}`}
                                      >
                                        <Plus size={12} />
                                        Add role
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {!isCollapsed &&
                                  items.map((o) => renderOpportunityRow(o))}
                              </Fragment>
                            );
                          })
                        ) : (
                          sortedOpportunities.map((o) =>
                            renderOpportunityRow(o),
                          )
                        )}
                      </tbody>
                    </table>
                    {!opportunities.length && (
                      <div className="empty-state">
                        <Search size={26} />
                        <h3>A fresh start, all yours.</h3>
                        <p>Add a role to start building your next chapter.</p>
                      </div>
                    )}
                    {opportunities.length > 0 && !filtered.length && (
                      <div className="empty-state">
                        <Search size={26} />
                        <h3>No matching opportunities</h3>
                        <p>Try another search or filter.</p>
                      </div>
                    )}
                  </div>
                )}
                {page !== "board" && (
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
                )}
                {!opportunities.length && !loading && page !== "board" && (
                  <div className="getting-started">
                    <div className="start-icon">
                      <Sparkles size={20} />
                    </div>
                    <div>
                      <h3>Make space for your next move.</h3>
                      <p>
                        Add a job link, a description, or a PDF. Your history
                        and documents stay together as you go.
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
              </>
            )}
          </main>
        )}
        {page === "activity" && <AIActivity timezone={settings?.timezone||"Europe/London"} onError={report} onOpen={(destination:ActivityDestination)=>{if(destination.type==="opportunity"&&destination.id)void openOpportunity(destination.id,destination.tab);else if(destination.type==="buddy"){localStorage.setItem("knox-buddy-conversation",destination.id||"legacy");navigate("buddy");}else if(destination.type==="intake"){setNewUrl("");setNewFile(null);setNewText("");setNewOpen(true);}else if(destination.type==="feedback")window.dispatchEvent(new Event("knox-feedback-inbox"));else navigate("settings", "career-buddy");}}/>}
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
        {page === "studio" && (
          <DocumentStudio
            onError={report}
            onNotice={setNotice}
            onChanged={() => void load(true)}
            timezone={settings?.timezone || "Europe/London"}
            initialOpportunityId={studioOpportunityId}
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
            onImported={()=>void load(true)}
            restarting={restarting}
            onRestart={() => void restartBoard()}
            updateStatus={updateStatus}
            onError={report}
            onNotice={setNotice}
          />
        )}
      </div>
      {newOpen && (
        <NewOpportunity
          initialUrl={newUrl}
          initialCompany={newCompany}
          initialRole={newRole}
          initialFile={newFile}
          initialText={newText}
          opportunities={opportunities}
          onOpenOpportunity={(id) => void openOpportunity(id)}
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
          duplicates={duplicateMap.get(selected.id) || []}
          onMerge={(dupId) => mergeOpportunity(selected.id, dupId)}
          initialTab={initialOpportunityTab}
          timezone={settings?.timezone || "Europe/London"}
          onClose={() => setSelected(null)}
          onDeleted={result=>{setSelected(null);void load(true);setNotice(`Opportunity deleted. Backup: ${result.backup.location}`);}}
          onUpdate={updated}
          onError={report}
          onReload={() => void openOpportunity(selected.id)}
          onConfigureBuddy={() => {
            setSelected(null);
            navigate("settings", "career-buddy");
            requestAnimationFrame(() =>
              document
                .getElementById("career-buddy-settings")
                ?.scrollIntoView({ block: "start" }),
            );
          }}
          onOpenStudio={(opId) => {
            if (opId) setStudioOpportunityId(opId);
            setSelected(null);
            navigate("studio");
          }}
        />
      )}
      {selectedOpportunityIds.length > 0 && !selected && (
        <BulkActionsBar
          selectedIds={selectedOpportunityIds}
          allFilteredCount={filtered.length}
          opportunities={opportunities}
          onSelectAllFiltered={selectAllFiltered}
          onClearSelection={clearSelection}
          onReload={() => load(true)}
          onError={(e) => setError(displayError(e))}
          onNotice={(msg) => setNotice(msg)}
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
  hasDuplicate = false,
  timezone = "Europe/London",
  selected = false,
  isDragging = false,
  onToggleSelect,
  onOpen,
  onDrag,
  onDragEnd,
}: {
  opportunity: Opportunity;
  hasDuplicate?: boolean;
  timezone?: string;
  selected?: boolean;
  isDragging?: boolean;
  onToggleSelect?: () => void;
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
      className={`opportunity-card ${selected ? "selected" : ""} ${isDragging ? "is-dragging" : ""}`}
      draggable
      onDragStart={(e) => {
        const card = e.currentTarget;
        if (e.dataTransfer?.setDragImage) {
          const rect = card.getBoundingClientRect();
          const clone = card.cloneNode(true) as HTMLElement;
          clone.style.width = `${rect.width}px`;
          clone.style.height = `${rect.height}px`;
          clone.style.position = "fixed";
          clone.style.top = "0px";
          clone.style.left = "0px";
          clone.style.zIndex = "-9999";
          clone.style.margin = "0";
          clone.style.pointerEvents = "none";
          clone.style.boxSizing = "border-box";
          clone.style.transform = "none";
          clone.style.borderRadius = "9px";
          clone.style.background = "var(--surface)";
          clone.style.boxShadow =
            "var(--shadow), 0 10px 24px rgba(0, 0, 0, 0.16)";
          clone.classList.add("drag-ghost-preview");
          document.body.appendChild(clone);

          const offsetX = Math.min(
            Math.max(16, e.clientX - rect.left),
            rect.width - 16,
          );
          const offsetY = Math.min(
            Math.max(16, e.clientY - rect.top),
            rect.height - 16,
          );
          e.dataTransfer.setDragImage(clone, offsetX, offsetY);

          setTimeout(() => {
            clone.remove();
          }, 0);
        }
        e.dataTransfer.setData("application/x-opportunity", o.id);
        e.dataTransfer.effectAllowed = "move";
        onDrag(o.id);
      }}
      onDragEnd={onDragEnd}
    >
      <div className="card-top">
        <input
          type="checkbox"
          className="card-select-checkbox"
          checked={selected}
          draggable={false}
          onChange={(e) => {
            e.stopPropagation();
            onToggleSelect?.();
          }}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${o.role} at ${o.company}`}
        />
        <span className={`company-avatar tint-${o.company.length % 4}`}>
          {initials(o.company)}
        </span>
        {o.priority === "high" ? (
          <Badge kind="amber">High priority</Badge>
        ) : (
          <span className="card-ref">{o.jobReference || "Opportunity"}</span>
        )}
        <div className="card-top-actions">
          {o.matchedExclusions && o.matchedExclusions.length > 0 && (
            <span
              className="exclusion-warning-badge"
              title={`Excluded keyword matched: ${o.matchedExclusions.join(", ")}`}
            >
              <AlertTriangle size={11} />
              Excluded
            </span>
          )}
          {hasDuplicate && (
            <span
              className="duplicate-warning-badge"
              title="Potential duplicate opportunity detected"
            >
              <Copy size={11} />
              Duplicate
            </span>
          )}
          {o.url && (
            <a
              href={o.url}
              target="_blank"
              rel="noreferrer"
              className="icon-button"
              aria-label={`Open job listing for ${o.role}`}
              title="Open job listing in new tab"
              draggable={false}
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={15} />
            </a>
          )}
          <button
            className="icon-button"
            aria-label={`Open details for ${o.role}`}
            draggable={false}
            onClick={onOpen}
          >
            <MoreHorizontal size={17} />
          </button>
        </div>
      </div>
      <button className="card-main" draggable={false} onClick={onOpen}>
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
      {(o.seniority || o.alignmentScore != null) && (
        <div className="card-pills-row">
          {o.seniority && (
            <span className="card-seniority-pill">
              {SENIORITY_LABELS[o.seniority] || o.seniority}
            </span>
          )}
          {o.alignmentScore != null && (
            <span
              className={`card-alignment-pill alignment-${o.alignmentTier || "mismatch"}`}
              title={
                [
                  o.matchedSkills?.length
                    ? `Matched: ${o.matchedSkills.join(", ")}`
                    : null,
                  o.missingSkills?.length
                    ? `Missing: ${o.missingSkills.join(", ")}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
            >
              {o.alignmentScore}% match
            </span>
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
  initialCompany = "",
  initialRole = "",
  opportunities = [],
  onOpenOpportunity,
  onClose,
  onCreated,
  onAuthError,
}: {
  initialUrl: string;
  initialFile: File | null;
  initialText: string;
  initialCompany?: string;
  initialRole?: string;
  opportunities?: Opportunity[];
  onOpenOpportunity?: (id: string) => void;
  onClose: () => void;
  onCreated: (o: Opportunity, warning?: string) => void;
  onAuthError: (error: unknown) => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({
    company: initialCompany,
    role: initialRole,
    url: initialUrl,
    description: initialText,
    jobReference: "",
    applicationRoute: "",
    location: "",
    workMode: "",
    salary: "",
    employmentType: "",
    contact: "",
    deadline: "",
    datePosted: "",
    applicantCount: "",
  });
  const [file, setFile] = useState<File | null>(initialFile),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [detailsOpen, setDetailsOpen] = useState(false),
    [retrieved, setRetrieved] = useState<JobLookupResult | null>(null);
  const [intake,setIntake]=useState<IntakeResult|null>(null),[intakeBusy,setIntakeBusy]=useState(false);
  const dirty = useRef(new Set<string>(initialText ? ["description"] : []));
  const existingDuplicate = useMemo(() => {
    return findExistingDuplicate(form, opportunities);
  }, [form.company, form.role, form.url, form.jobReference, opportunities]);
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
    setIntake(null);
    setForm((current) => {
      const next: Record<string, string> = { ...current, url };
      if (retrieved||intake?.source.kind==="url") {
        for (const key of [...JOB_FIELDS,"applicationRoute"])
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
          ...(intake?{intakeId:intake.id}:{}),
          ...(retrieved ? { note: lookupNote(retrieved) } : {}),
        }),
      );
      if (file && intake?.source.kind!=="file") {
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
          action={
            <button
              type="submit"
              className="button primary"
              disabled={busy || intakeBusy}
              title="Add opportunity to board"
              style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              {busy ? (
                <Busy text="Adding…" />
              ) : (
                <>
                  <Plus size={16} />
                  Add opportunity
                </>
              )}
            </button>
          }
        />
        <div className="intake-mode-callout">
          <span>Need deep quote-backed evidence or importing from a document?</span>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              const el = document.getElementById("job-intake-section");
              el?.scrollIntoView({ behavior: "smooth" });
              setDetailsOpen(true);
            }}
          >
            <Sparkles size={14} />
            Use Smarter AI Intake below
          </button>
        </div>
        {existingDuplicate && (
          <div className="duplicate-alert-banner" role="alert" style={{ marginBottom: 16 }}>
            <Copy size={16} />
            <div className="duplicate-alert-content">
              <strong>Potential duplicate found:</strong>
              <p>You already have &ldquo;{existingDuplicate.role}&rdquo; at {existingDuplicate.company}.</p>
            </div>
            {onOpenOpportunity && (
              <button
                type="button"
                className="button secondary small"
                onClick={() => {
                  onClose();
                  onOpenOpportunity(existingDuplicate.id);
                }}
              >
                Open existing
              </button>
            )}
          </div>
        )}
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
                onChange={change("applicationRoute")}
                placeholder="Employer portal, recruiter, email…"
              />
            </Field>
            {form.datePosted && (
              <Field label="Date posted">
                <input
                  value={form.datePosted}
                  onChange={change("datePosted")}
                  placeholder="Date or age"
                />
              </Field>
            )}
            {form.applicantCount && (
              <Field label="Applicants">
                <input
                  value={form.applicantCount}
                  onChange={change("applicantCount")}
                  placeholder="Applicant count"
                />
              </Field>
            )}
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
            onChange={(e) => {setIntake(null);setFile(e.target.files?.[0] || null);}}
          />
        </label>
        <JobIntake url={form.url} text={form.description} file={file} onBusy={setIntakeBusy} onError={onAuthError} onApply={(result,fields)=>{
          setForm(current=>{const next={...current};for(const [key,value] of Object.entries(fields))if(!dirty.current.has(key))next[key]=value;return next;});setIntake(result);setDetailsOpen(true);
        }}/>
        {intake&&<p className="lookup-applied">Source snapshot selected. It will be saved with this opportunity.</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy||intakeBusy}>
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
  initialTab="overview",
  opportunity: o,
  duplicates,
  onMerge,
  timezone,
  onClose,
  onUpdate,
  onError,
  onReload,
  onConfigureBuddy,
  onOpenStudio,
  onDeleted,
}: {
  initialTab?:string;
  opportunity: Opportunity;
  duplicates?: Opportunity[];
  onMerge?: (duplicateId: string) => Promise<void>;
  timezone: string;
  onClose: () => void;
  onUpdate: (o: Opportunity) => void;
  onError: (e: unknown) => void;
  onReload: () => void;
  onConfigureBuddy: () => void;
  onOpenStudio?: (opId?: string) => void;
  onDeleted: (result: import("./components/WorkspaceAction").WorkspaceActionResult) => void;
}) {
  const [tab, setTab] = useState(initialTab),
    [busy, setBusy] = useState(false),
    [localError, setLocalError] = useState("");
  const latestOpportunityRef = useRef(o);
  latestOpportunityRef.current = o;
  async function mutate(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setLocalError("");
    try {
      const next = await api<Opportunity>(path, json(body, method));
      latestOpportunityRef.current = next;
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
        {o.outputFolder && (
          <span
            title={`Dedicated folder: ${o.outputFolder}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            <Folder size={13} />
            {o.outputFolder}
          </span>
        )}
        {o.url && (
          <a
            className="button secondary small"
            href={o.url}
            target="_blank"
            rel="noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", fontSize: 11 }}
            title="Open original job listing in a new tab"
          >
            <ExternalLink size={13} />
            Open job link
          </a>
        )}
      </div>
      {duplicates && duplicates.length > 0 && (
        <div className="duplicate-alert-banner" role="alert" style={{ margin: "12px 18px 0" }}>
          <Copy size={16} />
          <div className="duplicate-alert-content">
            <strong>Potential duplicate{duplicates.length > 1 ? "s" : ""} detected:</strong>
            <p>
              {duplicates.map((d) => `${d.role} at ${d.company}`).join(", ")}
            </p>
          </div>
          {onMerge && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {duplicates.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="button secondary small"
                  onClick={() => {
                    if (window.confirm(`Merge "${d.role} (${d.company})" into this opportunity? History, notes, documents, and tasks will be consolidated, and the duplicate will be deleted.`)) {
                      void onMerge(d.id);
                    }
                  }}
                >
                  Merge with duplicate
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {o.matchedExclusions && o.matchedExclusions.length > 0 && o.stage !== "outcome" && (
        <div className="exclusion-alert-banner" role="alert" style={{ margin: "12px 18px 0" }}>
          <AlertTriangle size={16} />
          <div className="exclusion-alert-content">
            <strong>Exclusion keyword matched:</strong>
            <p>
              This role matches your exclusion filters: <em>{o.matchedExclusions.join(", ")}</em>.
            </p>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              type="button"
              className="button secondary small"
              disabled={busy}
              onClick={async () => {
                await mutate(
                  `/opportunities/${o.id}`,
                  {
                    revision: o.revision,
                    stage: "outcome",
                    outcome: "ignored",
                    note: `Archived automatically as ignored due to exclusion filter: ${o.matchedExclusions?.join(", ")}`,
                  },
                  "PATCH",
                );
              }}
            >
              Archive as ignored
            </button>
          </div>
        </div>
      )}
      <div className="detail-tabs" role="tablist">
        {[
          ["overview", "Overview"],
          ["summary", "AI Summary"],
          ["decision", "Fit assessment"],
          ["documents", "Documents"],
          ["activities", "Interview & comms"],
          ...(o.offers?.length || tab === "offers"
            ? [["offers", `Offers${o.offers?.length ? ` (${o.offers.length})` : ""}`]]
            : []),
          ["timeline", "Timeline & notes"],
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
            key={o.id}
            o={o}
            busy={busy}
            onAuthError={onError}
            save={(body) =>
              mutate(
                `/opportunities/${latestOpportunityRef.current.id}`,
                { ...body, revision: latestOpportunityRef.current.revision },
                "PATCH",
              )
            }
          />
        )}{" "}
        {tab === "summary" && (
          <OpportunityAISummary
            key={o.id}
            opportunity={o}
            timezone={timezone}
            busy={busy}
            mutate={mutate}
            onConfigureBuddy={onConfigureBuddy}
            onNavigateOverview={() => setTab("overview")}
          />
        )}{" "}
        {tab === "decision" && (
          <OpportunityReviewForm
            key={o.id}
            opportunity={o}
            timezone={timezone}
            busy={busy}
            mutate={mutate}
            onError={onError}
            onAssessed={onUpdate}
          />
        )}{" "}
        {tab === "documents" && (
          <>
            {onOpenStudio && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => onOpenStudio(o.id)}
                  title="Open Document Studio"
                >
                  <FileText size={14} /> Open Document Studio
                </button>
              </div>
            )}
            <ApplicationPacks
              opportunity={o}
              timezone={timezone}
              onChanged={onReload}
              onError={onError}
            />
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
        {tab === "activities" && (
          <Activities
            key={o.revision}
            o={o}
            timezone={timezone}
            busy={busy}
            mutate={mutate}
          />
        )}{" "}
        {tab === "offers" && (
          <OpportunityOffers
            key={`${o.id}-${o.revision}`}
            opportunity={o}
            timezone={timezone}
            busy={busy}
            mutate={mutate}
          />
        )}{" "}
        {(tab === "timeline" || tab === "summary") && (
          <Timeline
            key={o.revision}
            o={o}
            timezone={timezone}
            busy={busy}
            mutate={mutate}
            onNavigateTab={(targetTab) => setTab(targetTab)}
          />
        )}{" "}
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
      <div className="opportunity-delete-action"><WorkspaceAction action="delete-opportunity" opportunityId={o.id} label="Delete opportunity" disabled={busy} onComplete={onDeleted}/></div>
    </Modal>
  );
}
function getInitialOverviewForm(o: Opportunity): Record<string, string> {
  return {
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
        "datePosted",
        "applicantCount",
        "description",
        "priority",
        "nextAction",
        "nextActionDate",
        "stage",
        "outcome",
        "seniority",
      ].map((k) => [k, String(o[k as keyof Opportunity] || "")]),
    ),
    tags: (o.tags || []).join(", "),
    effectiveAt: "",
    note: "",
  };
}

function areOverviewFormsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
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
  const [form, setForm] = useState<Record<string, string>>(() => getInitialOverviewForm(o));
  const [undoStack, setUndoStack] = useState<Record<string, string>[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "undone" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  const formRef = useRef(form);
  formRef.current = form;
  const lastSavedRef = useRef<Record<string, string>>(form);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef(false);

  const performSave = useCallback(
    async (targetForm: Record<string, string>, isUndo = false) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (!isUndo && areOverviewFormsEqual(targetForm, lastSavedRef.current)) {
        return true;
      }
      if (isSavingRef.current) {
        pendingSaveRef.current = true;
        return false;
      }
      isSavingRef.current = true;
      setSaveStatus("saving");

      const priorSnapshot = lastSavedRef.current;
      const body: Record<string, unknown> = {
        ...targetForm,
        tags: targetForm.tags
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        effectiveAt: iso(targetForm.effectiveAt),
        seniority: targetForm.seniority || undefined,
      };
      if (targetForm.outcome) body.stage = "outcome";

      try {
        const ok = await save(body);
        if (ok) {
          if (!isUndo) {
            setUndoStack((prev) => [...prev.slice(-19), priorSnapshot]);
            setSaveStatus("saved");
            setStatusMessage("All changes saved");
          } else {
            setSaveStatus("undone");
            setStatusMessage("Undid last change");
          }
          lastSavedRef.current = { ...targetForm, effectiveAt: "", note: "" };
        } else {
          setSaveStatus("error");
          setStatusMessage("Could not save changes");
        }
        return ok;
      } catch {
        setSaveStatus("error");
        setStatusMessage("Could not save changes");
        return false;
      } finally {
        isSavingRef.current = false;
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          void performSave(formRef.current);
        }
      }
    },
    [save],
  );

  const scheduleSave = useCallback(
    (updatedForm: Record<string, string>, delay = 600) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      setSaveStatus("saving");
      if (delay === 0) {
        saveTimerRef.current = null;
        void performSave(updatedForm);
      } else {
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          void performSave(updatedForm);
        }, delay);
      }
    },
    [performSave],
  );

  const handleBlur = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      void performSave(formRef.current);
    }
  }, [performSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void performSave(formRef.current);
      }
    };
  }, [performSave]);

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0 || isSavingRef.current) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setForm(previous);
    await performSave(previous, true);
  }, [undoStack, performSave]);

  const set =
    (key: string) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => {
      const updated = { ...formRef.current, [key]: e.target.value };
      setForm(updated);
      scheduleSave(updated, 600);
    };

  const renderAutoSaveBar = (isTop = false) => (
    <div className={`auto-save-bar ${isTop ? "auto-save-bar-top" : ""}`}>
      <div className="auto-save-status" role="status" aria-live="polite">
        {saveStatus === "saving" && (
          <span className="status-saving">
            <LoaderCircle size={14} className="spin" />
            <span>Saving…</span>
          </span>
        )}
        {saveStatus === "saved" && (
          <span className="status-saved">
            <Check size={14} />
            <span>{statusMessage || "All changes saved"}</span>
          </span>
        )}
        {saveStatus === "undone" && (
          <span className="status-undone">
            <RotateCcw size={14} />
            <span>{statusMessage || "Undid last change"}</span>
          </span>
        )}
        {saveStatus === "error" && (
          <span className="status-error">
            <AlertCircle size={14} />
            <span>{statusMessage || "Could not save changes"}</span>
          </span>
        )}
      </div>
      <button
        type="button"
        className="button secondary small undo-button"
        disabled={undoStack.length === 0 || saveStatus === "saving" || busy}
        onClick={() => void handleUndo()}
        title="Undo last change (Cmd+Z or Ctrl+Z)"
      >
        <RotateCcw size={13} />
        Undo last change
      </button>
    </div>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void performSave(formRef.current);
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
          if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
            e.preventDefault();
            void handleUndo();
          }
        }
      }}
    >
      {(o.alignmentScore != null || (o.matchedSkills && o.matchedSkills.length > 0)) && (
        <div className="alignment-overview-card" style={{ marginBottom: 16 }}>
          <div className="alignment-overview-header">
            <div>
              <strong>Candidate Profile Alignment</strong>
              <p>Calculated using conventional ML over your career library documents, target titles, skills, and seniority.</p>
            </div>
            {o.alignmentScore != null && (
              <Badge
                kind={
                  o.alignmentTier === "strong"
                    ? "green"
                    : o.alignmentTier === "moderate"
                      ? "blue"
                      : o.alignmentTier === "reach"
                        ? "amber"
                        : "muted"
                }
              >
                {o.alignmentScore}% — {ALIGNMENT_TIER_LABELS[o.alignmentTier || "mismatch"]}
              </Badge>
            )}
          </div>
          {o.matchedSkills && o.matchedSkills.length > 0 && (
            <div className="matched-skills-section">
              <span className="matched-skills-title">Matched target skills in job specification:</span>
              <div className="tags" style={{ marginTop: 4 }}>
                {o.matchedSkills.map((sk) => (
                  <span key={sk} className="matched-skill-tag">
                    ✓ {sk}
                  </span>
                ))}
              </div>
            </div>
          )}
          {o.missingSkills && o.missingSkills.length > 0 && (
            <div className="missing-skills-section" style={{ marginTop: 8 }}>
              <span className="missing-skills-title" style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Unverified skills in job specification:
              </span>
              <div className="tags" style={{ marginTop: 4 }}>
                {o.missingSkills.map((sk) => (
                  <span key={sk} className="tag tag-missing-skill" style={{ opacity: 0.85 }}>
                    ✗ {sk}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="section-intro">
        <h3>Keep the details in one place.</h3>
        <p>
          Changes are saved automatically. Stage changes are dated
          automatically.
        </p>
      </div>
      {renderAutoSaveBar(true)}
      <div className="form-grid">
        <Field label="Company">
          <input required value={form.company} onChange={set("company")} onBlur={handleBlur} />
        </Field>
        <Field label="Role">
          <input required value={form.role} onChange={set("role")} onBlur={handleBlur} />
        </Field>
        <Field label="Stage">
          <select
            value={form.stage}
            onChange={(e) => {
              const nextStage = e.target.value;
              const nextOutcome = nextStage === "outcome" ? formRef.current.outcome : "";
              const updated = {
                ...formRef.current,
                stage: nextStage,
                outcome: nextOutcome,
                effectiveAt: "",
                note: "",
              };
              setForm(updated);
              scheduleSave(updated, 800);
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
            onChange={(e) => {
              const nextOutcome = e.target.value;
              const nextStage = nextOutcome
                ? "outcome"
                : formRef.current.stage === "outcome"
                  ? "review"
                  : formRef.current.stage;
              const updated = {
                ...formRef.current,
                outcome: nextOutcome,
                stage: nextStage,
              };
              setForm(updated);
              scheduleSave(updated, 800);
            }}
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
                onBlur={handleBlur}
              />
            </Field>
            <Field label="Stage note (optional)">
              <input
                value={form.note}
                onChange={set("note")}
                onBlur={handleBlur}
                placeholder="Decision, feedback, or context"
              />
            </Field>
          </>
        )}
        <Field label="Priority">
          <select
            value={form.priority || "normal"}
            onChange={(e) => {
              const updated = { ...formRef.current, priority: e.target.value };
              setForm(updated);
              scheduleSave(updated, 0);
            }}
          >
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="low">Low</option>
          </select>
        </Field>
        <Field label="Seniority level" hint="Auto-classified from listing; override if needed.">
          <select
            value={form.seniority}
            onChange={(e) => {
              const updated = { ...formRef.current, seniority: e.target.value };
              setForm(updated);
              scheduleSave(updated, 0);
            }}
          >
            <option value="">Auto-classified ({o.seniority ? (SENIORITY_LABELS[o.seniority] || o.seniority) : "None"})</option>
            {Object.entries(SENIORITY_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Closing date">
          <input type="date" value={form.deadline} onChange={set("deadline")} onBlur={handleBlur} />
        </Field>
        <Field label="Next action">
          <input
            value={form.nextAction}
            onChange={set("nextAction")}
            onBlur={handleBlur}
            placeholder="What happens next?"
          />
        </Field>
        <Field label="Next action date">
          <input
            type="date"
            value={form.nextActionDate}
            onChange={set("nextActionDate")}
            onBlur={handleBlur}
          />
        </Field>
        <Field label="Location">
          <input
            value={form.location}
            onChange={set("location")}
            onBlur={handleBlur}
            placeholder="City or region"
          />
        </Field>
        <Field label="Working arrangement">
          <input
            value={form.workMode}
            onChange={set("workMode")}
            onBlur={handleBlur}
            placeholder="Remote, hybrid, on-site…"
          />
        </Field>
        <Field label="Salary / rate">
          <input
            value={form.salary}
            onChange={set("salary")}
            onBlur={handleBlur}
            placeholder="Include amount, currency, and period"
          />
        </Field>
        <Field label="Employment type">
          <input
            value={form.employmentType}
            onChange={set("employmentType")}
            onBlur={handleBlur}
            placeholder="Permanent, contract…"
          />
        </Field>
        <Field label="Contact">
          <input value={form.contact} onChange={set("contact")} onBlur={handleBlur} />
        </Field>
        <Field
          label="Application route"
          hint="Where and how to apply; submission packs retain their own recorded route."
        >
          <input
            maxLength={10000}
            value={form.applicationRoute}
            onChange={set("applicationRoute")}
            onBlur={handleBlur}
            placeholder="Employer portal, recruiter, email…"
          />
        </Field>
        {form.datePosted && (
          <Field label="Date posted">
            <input value={form.datePosted} onChange={set("datePosted")} onBlur={handleBlur} />
          </Field>
        )}
        {form.applicantCount && (
          <Field label="Applicants">
            <input value={form.applicantCount} onChange={set("applicantCount")} onBlur={handleBlur} />
          </Field>
        )}
        <Field label="Job reference">
          <input value={form.jobReference} onChange={set("jobReference")} onBlur={handleBlur} />
        </Field>
        <div className="wide">
          <JobLookup
            url={form.url}
            onUrlChange={(url) => {
              const updated = { ...formRef.current, url };
              setForm(updated);
              scheduleSave(updated, 600);
            }}
            onAuthError={onAuthError}
            preview
            onResult={(result) => {
              const next = { ...formRef.current };
              let changed = false;
              for (const key of JOB_FIELDS) {
                const value = result.fields[key];
                if (
                  typeof value === "string" &&
                  value &&
                  !formRef.current[key]?.trim()
                ) {
                  next[key] = value;
                  changed = true;
                }
              }
              if (changed) {
                setForm(next);
                scheduleSave(next, 0);
              }
            }}
          />
        </div>
        <Field label="Tags" wide hint="Separate tags with commas.">
          <input
            value={form.tags}
            onChange={set("tags")}
            onBlur={handleBlur}
            placeholder="AI, leadership, consulting…"
          />
        </Field>
        <Field label="Job description" wide>
          <textarea
            rows={7}
            value={form.description}
            onChange={set("description")}
            onBlur={handleBlur}
          />
        </Field>
      </div>
      {renderAutoSaveBar(false)}
    </form>
  );
}
function generateSummaryText(o: Opportunity, timezone: string): string {
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
  return [
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
}
function Timeline({
  o,
  timezone,
  busy,
  mutate,
  onNavigateTab,
}: {
  o: Opportunity;
  timezone: string;
  busy: boolean;
  mutate: (path: string, body: unknown, method?: string) => Promise<boolean>;
  onNavigateTab?: (tab: string) => void;
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
      <div className="section-intro with-action">
        <div>
          <h3>Every step, remembered.</h3>
          <p>
            Stage changes, notes, and activity history.
          </p>
        </div>
        <button
          type="button"
          className="button secondary small"
          onClick={() =>
            download(
              `${o.company}-${o.role}-summary.txt`,
              generateSummaryText(o, timezone),
            )
          }
          title="Download complete chronological history and document log"
        >
          <ArrowDownToLine size={14} />
          Download log (.txt)
        </button>
      </div>
      <details className="timeline-briefing-expander">
        <summary className="timeline-briefing-summary">
          <span className="timeline-briefing-title">
            <Sparkles size={14} />
            <strong>Career Buddy Briefing</strong>
          </span>
          <span className="timeline-briefing-badge">AI summary</span>
        </summary>
        <div className="timeline-briefing-body">
          <OpportunityBriefing
            id={o.id}
            revision={o.revision}
            timezone={timezone}
            onOpenSource={(sourceId) =>
              onNavigateTab?.(
                sourceId.startsWith("events:")
                  ? "timeline"
                  : sourceId.startsWith("activities:")
                  ? "activities"
                  : sourceId.startsWith("document:")
                  ? "documents"
                  : "overview",
              )
            }
          />
        </div>
      </details>
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
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {Boolean(o.activities?.some((a) => a.scheduledAt)) && (
            <a
              href={`/api/opportunities/${encodeURIComponent(o.id)}/calendar.ics`}
              className="button secondary small"
              title="Download all scheduled interviews and activities as an iCalendar file"
            >
              <CalendarDays size={14} />
              Export .ics
            </a>
          )}
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
                        (file) => ({ file, requestId: uploadId() }),
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
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end" }}>
                  <button
                    className="text-button"
                    disabled={saving || busy}
                    onClick={() => edit(a)}
                  >
                    Edit
                  </button>
                  {Boolean(a.scheduledAt) && (
                    <a
                      href={`/api/opportunities/${encodeURIComponent(o.id)}/activities/${encodeURIComponent(a.id)}/calendar.ics`}
                      className="text-button"
                      title="Download this event as an iCalendar (.ics) file"
                      style={{ fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                    >
                      <CalendarDays size={12} />
                      Add to calendar
                    </a>
                  )}
                </div>
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
  const [kind, setKind] = useState(""),
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
    [moving, setMoving] = useState(false),
    [organizing, setOrganizing] = useState(false);
  const [categoryFilter,setCategoryFilter]=useState(''),[uploadCategory,setUploadCategory]=useState(''),[bulkCategory,setBulkCategory]=useState(''),[categorising,setCategorising]=useState(false);
  const queue=useUploadQueue(opportunityId, options=>{setKind(options.automaticDefaults ? options.kind : "");setNotes(options.notes);setUploadCategory(options.automaticDefaults ? options.category : "");setBatchUploads(options.batchUploads);});
  const files=queue.files,uploadAbort=useRef<AbortController|null>(null);
  useEffect(()=>()=>uploadAbort.current?.abort(),[]);
  useEffect(()=>{if(queue.ready)void queue.saveOptions({automaticDefaults:true,kind,status:"",notes,category:uploadCategory,batchUploads});},[queue.ready,kind,notes,uploadCategory,batchUploads]);
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
  async function organizeOpportunityFolders() {
    if (!opportunityId || organizing) return;
    setOrganizing(true);
    try {
      const res = await api<{
        organizedCount: number;
        retainedOriginals: number;
        documents: BoardDocument[];
      }>(`/opportunities/${opportunityId}/organize-folders`, { method: "POST" });
      onChanged();
      if (res.organizedCount > 0) {
        onNotice?.(
          `Organized ${res.organizedCount} document${res.organizedCount === 1 ? "" : "s"} into Company > Role folder.`,
        );
      } else {
        onNotice?.("All opportunity documents are already in the Company > Role folder.");
      }
    } catch (e) {
      onError(e);
    } finally {
      setOrganizing(false);
    }
  }

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
              status: "",
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
              ...(options.kind ? { kind: options.kind } : {}),
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
      <details className="document-upload-expander" open={files.length>0||busy||undefined}>
        <summary>Add documents{files.length?` · ${files.length} queued`:""}</summary>
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
              : "Drag and drop files or entire directories into your library. Career Buddy prepares PDF, DOCX, Google Workspace (.gdoc, .gsheet, .gslides) and text sources locally."}
          </p>
        </div>
        <div className="section-actions">
          {opportunityId && allDocuments.length > 0 && (
            <button
              type="button"
              className="button secondary small"
              disabled={busy || organizing}
              onClick={() => void organizeOpportunityFolders()}
              title="Ensure all documents for this opportunity are structured into the dedicated Company > Role folder."
            >
              <FolderInput size={15} />
              {organizing ? "Organizing…" : "Organize into Company > Role"}
            </button>
          )}
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
            PDF, Word, PowerPoint, Markdown, HTML, RTF, captions (.vtt/.srt), Google Workspace (.gdoc, .gsheet, .gslides), or
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
                    ["", "Automatic for each file"],
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
              <Field label="Category"><select value={uploadCategory} onChange={e=>setUploadCategory(e.target.value)}><option value="">Automatic for each file</option>{documentCategories.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>
              <p className="muted">Type and category use each file’s name and folders. Unrecognised files use Other. Imports start without a status.</p>
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
      </details>
      <label className="field"><span>Filter document category</span><select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option value="">All categories ({allDocuments.length})</option>{documentCategories.map(c=><option key={c.id} value={c.id}>{c.label} ({allDocuments.filter(d=>d.category===c.id).length})</option>)}</select></label>

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
          subtitle="Choose a folder within your configured Career Hub location."
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
                            <DocumentThumbnail key={`${doc.id}:${doc.revision}`} id={doc.id} name={doc.name} revision={doc.revision} className="document-row-thumbnail"/>
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
                                {(doc.originalUrl || doc.externalSource?.url) && (
                                  <>
                                    {" · "}
                                    <a
                                      href={doc.originalUrl || doc.externalSource?.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      style={{ textDecoration: "underline" }}
                                    >
                                      {doc.name.endsWith(".gsheet")
                                        ? "Google Sheet"
                                        : doc.name.endsWith(".gslides")
                                          ? "Google Slides"
                                          : "Google Doc"}
                                    </a>
                                  </>
                                )}
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
                                <option value="">No status</option>
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
                            {(doc.originalUrl || doc.externalSource?.url) && (
                              <a
                                className="icon-button"
                                href={doc.originalUrl || doc.externalSource?.url}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Open ${doc.name} in Google`}
                                title={`Open in ${doc.name.endsWith(".gsheet") ? "Google Sheets" : doc.name.endsWith(".gslides") ? "Google Slides" : "Google Docs"}`}
                              >
                                <ArrowUpRight size={17} />
                              </a>
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
                title="Import new or edited Markdown notes and files from your Obsidian vault into your Career Hub"
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
                title="Export existing Career Hub sources into your Obsidian vault"
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
                  Import existing Career Hub sources into this vault right
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
                    vault into your Career Hub
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
          if (items.length) {
            window.location.hash = "/library?section=documents";
            setDroppedQueue(items);
          }
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
            Career Hub<span className="heading-dot">.</span>
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
      <WorkspaceSections label="Career Hub sections" sections={[
        { id: "documents", label: "Documents", content: <>
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
        </> },
        { id: "preparation", label: "Text preparation", content: <>
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

        </> },
        { id: "search", label: "Semantic search", content: <>
      <VectorIndex onError={onError} refreshKey={connectionRevision} />

        </> },
        { id: "connections", label: "Connections", content: <>
      <DocumentConnections onError={onError} onChanged={()=>{setConnectionRevision(v=>v+1);void load();}} onRestart={onRestart} restarting={restarting} />

        </> },
        { id: "obsidian", label: "Obsidian vault", content: <>
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

        </> },
      ]} />
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
  updateStatus,
  onError,
  onNotice,
  onImported,
}: {
  onImported:()=>void;
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
  updateStatus?: UpdateStatus | null;
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
  const [storageUndoStack, setStorageUndoStack] = useState<typeof form[]>([]);
  const [storageStatus, setStorageStatus] = useState<"idle" | "saving" | "saved" | "undone" | "error">("idle");
  const [storageNotice, setStorageNotice] = useState("");
  const formRef = useRef(form);
  formRef.current = form;
  const lastSavedStorageRef = useRef(form);
  const storageTimerRef = useRef<NodeJS.Timeout | null>(null);

  type FolderEntry = { name: string; path: string };
  const [folderBrowser, setFolderBrowser] = useState<{
    open: boolean;
    loading: boolean;
    currentPath: string;
    parentPath: string | null;
    folders: FolderEntry[];
    presets: { label: string; path: string }[];
    writable: boolean;
    error: string | null;
    newFolderName: string;
    creating: boolean;
  }>({
    open: false,
    loading: false,
    currentPath: "",
    parentPath: null,
    folders: [],
    presets: [],
    writable: true,
    error: null,
    newFolderName: "",
    creating: false,
  });

  const loadFolders = useCallback(async (targetPath?: string) => {
    setFolderBrowser((prev) => ({ ...prev, open: true, loading: true, error: null }));
    try {
      const url = targetPath ? `/system/folders?path=${encodeURIComponent(targetPath)}` : "/system/folders";
      const data = await api<{
        currentPath: string;
        parentPath: string | null;
        folders: FolderEntry[];
        presets: { label: string; path: string }[];
        writable: boolean;
      }>(url);
      setFolderBrowser((prev) => ({
        ...prev,
        open: true,
        loading: false,
        currentPath: data.currentPath,
        parentPath: data.parentPath,
        folders: data.folders,
        presets: data.presets,
        writable: data.writable,
        error: null,
      }));
    } catch (err: any) {
      setFolderBrowser((prev) => ({
        ...prev,
        open: true,
        loading: false,
        error: err.message || "Could not read folders",
      }));
    }
  }, []);

  const handleSelectFolder = (selectedPath: string) => {
    const updated = { ...formRef.current, exportsPath: selectedPath };
    setForm(updated);
    setFolderBrowser((prev) => ({ ...prev, open: false }));
    void performStorageSave(updated);
  };

  const handleCreateSubfolder = async () => {
    if (!folderBrowser.newFolderName.trim()) return;
    setFolderBrowser((prev) => ({ ...prev, creating: true }));
    try {
      const res = await api<{ ok: boolean; path: string }>(
        "/system/folders",
        json({ parentPath: folderBrowser.currentPath, name: folderBrowser.newFolderName.trim() }),
      );
      setFolderBrowser((prev) => ({ ...prev, newFolderName: "", creating: false }));
      await loadFolders(res.path);
    } catch (err: any) {
      setFolderBrowser((prev) => ({
        ...prev,
        creating: false,
        error: err.message || "Could not create subfolder",
      }));
    }
  };

  useEffect(() => {
    setForm(settings);
    lastSavedStorageRef.current = settings;
  }, [
    settings.timezone,
    settings.documentsSubdir,
    settings.exportsPath,
    settings.referenceSubdir,
    settings.backupSubdir,
    settings.pendingHostPath,
  ]);

  const performStorageSave = useCallback(
    async (targetForm: typeof form, isUndo = false) => {
      if (storageTimerRef.current) {
        clearTimeout(storageTimerRef.current);
        storageTimerRef.current = null;
      }
      const prior = lastSavedStorageRef.current;
      if (
        !isUndo &&
        targetForm.timezone === prior.timezone &&
        targetForm.documentsSubdir === prior.documentsSubdir &&
        targetForm.exportsPath === prior.exportsPath &&
        targetForm.referenceSubdir === prior.referenceSubdir &&
        targetForm.backupSubdir === prior.backupSubdir &&
        targetForm.pendingHostPath === prior.pendingHostPath
      ) {
        return;
      }
      setStorageStatus("saving");
      setBusy(true);
      try {
        const s = await api<Settings>(
          "/settings",
          json(
            {
              timezone: targetForm.timezone,
              documentsSubdir: targetForm.documentsSubdir,
              exportsPath: targetForm.exportsPath,
              referenceSubdir: targetForm.referenceSubdir,
              backupSubdir: targetForm.backupSubdir,
              pendingHostPath: targetForm.pendingHostPath,
            },
            "PATCH",
          ),
        );
        onSaved(s);
        setForm(s);
        lastSavedStorageRef.current = s;
        if (!isUndo) {
          setStorageUndoStack((prev) => [...prev.slice(-19), prior]);
          setStorageStatus("saved");
          setStorageNotice(
            s.pendingHostPath
              ? "Settings saved. Use Update & restart board below to apply the new folder."
              : "All changes saved",
          );
        } else {
          setStorageStatus("undone");
          setStorageNotice("Undid last change");
        }
      } catch (e) {
        setStorageStatus("error");
        onError(e);
      } finally {
        setBusy(false);
      }
    },
    [onSaved, onError],
  );

  const scheduleStorageSave = useCallback(
    (updatedForm: typeof form, delay = 600) => {
      if (storageTimerRef.current) clearTimeout(storageTimerRef.current);
      setStorageStatus("saving");
      storageTimerRef.current = setTimeout(() => {
        storageTimerRef.current = null;
        void performStorageSave(updatedForm);
      }, delay);
    },
    [performStorageSave],
  );

  const handleStorageBlur = useCallback(() => {
    if (storageTimerRef.current) {
      clearTimeout(storageTimerRef.current);
      storageTimerRef.current = null;
      void performStorageSave(formRef.current);
    }
  }, [performStorageSave]);

  const handleStorageUndo = useCallback(async () => {
    if (storageUndoStack.length === 0 || busy) return;
    if (storageTimerRef.current) {
      clearTimeout(storageTimerRef.current);
      storageTimerRef.current = null;
    }
    const previous = storageUndoStack[storageUndoStack.length - 1];
    setStorageUndoStack((prev) => prev.slice(0, -1));
    setForm(previous);
    await performStorageSave(previous, true);
  }, [storageUndoStack, busy, performStorageSave]);

  useEffect(() => {
    return () => {
      if (storageTimerRef.current) {
        clearTimeout(storageTimerRef.current);
        storageTimerRef.current = null;
        void performStorageSave(formRef.current);
      }
    };
  }, [performStorageSave]);
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
      {updateStatus && <BuildVersion status={updateStatus} />}
      <WorkspaceSections label="Settings sections" sections={[
        { id: "profile", label: "Profile", content: <>
      <ProfileSettings
        profile={profile}
        onSaved={onProfileSaved}
        onError={onError}
        onNotice={onNotice}
      />

        </> },
        { id: "appearance", label: "Appearance", content: <>
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

        </> },
        { id: "alignment", label: "Target roles & criteria", aliases: ["decisions", "fit-criteria", "filters"], content: <>
      <AlignmentSettings
        settings={settings}
        onSaved={onSaved}
        onError={onError}
        onNotice={onNotice}
      />

        </> },
        { id: "storage", label: "Files & storage", content: <>
      <form onSubmit={(e) => { e.preventDefault(); void performStorageSave(formRef.current); }}>
        <section className="settings-section">
          <div className="settings-section-heading">
            <FolderOpen size={21} />
            <div>
              <h2>Files & storage</h2>
              <p>
                These locations are on the hosting machine, shared by all your
                devices. Changes are saved automatically.
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

          {/* Opportunity Applications & Exports Folder Global Setting */}
          <div className="location-box" style={{ flexDirection: "column", alignItems: "stretch", gap: 12, margin: "14px 0" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Briefcase size={16} style={{ color: "var(--accent)" }} />
                <strong style={{ fontSize: 13.5 }}>Opportunity applications &amp; exports folder</strong>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Badge kind="accent">Full disk</Badge>
                <Badge kind="muted">Auto Company &gt; Role</Badge>
                <Badge kind="green">Never ingested</Badge>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
              Choose any folder on the hosting machine where generated CVs, cover letters, and opportunity files are stored. Opportunity Knox automatically maintains the 2-level folder structure (<code>Company &gt; Role</code>). Files here are strictly for external applications and are <strong>never ingested</strong> into your Career Library or vector index.
            </p>

            {/* Selectable location mode */}
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", padding: "8px 12px", background: "var(--panel-soft)", borderRadius: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="exportLocationMode"
                  checked={!form.exportsPath}
                  onChange={() => {
                    const updated = { ...formRef.current, exportsPath: "" };
                    setForm(updated);
                    void performStorageSave(updated);
                  }}
                />
                <span>Default workspace (<code>{(settings.hostDocumentsPath || settings.storagePath).replace(/\/+$/, "")}/{form.documentsSubdir || "opportunities"}</code>)</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="exportLocationMode"
                  checked={Boolean(form.exportsPath)}
                  onChange={() => {
                    if (!form.exportsPath) {
                      loadFolders();
                    }
                  }}
                />
                <span>Custom full-disk folder</span>
              </label>
            </div>

            {/* Full-disk path input & selector actions */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              <Field
                label="Full disk folder path"
                hint="Absolute path anywhere on disk (e.g. /Users/you/Documents/Applications, /Volumes/Hub/Applications)."
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    style={{ flex: 1, minWidth: 260 }}
                    value={form.exportsPath || ""}
                    onChange={(e) => {
                      const updated = { ...formRef.current, exportsPath: e.target.value };
                      setForm(updated);
                      scheduleStorageSave(updated, 600);
                    }}
                    onBlur={handleStorageBlur}
                    placeholder={(settings.hostDocumentsPath || settings.storagePath).replace(/\/+$/, "") + "/" + (form.documentsSubdir || "opportunities")}
                  />
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => loadFolders(form.exportsPath || undefined)}
                    title="Browse disk to select folder"
                  >
                    <FolderOpen size={14} />
                    <span>Select folder…</span>
                  </button>
                  {form.exportsPath && (
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => {
                        const updated = { ...formRef.current, exportsPath: "" };
                        setForm(updated);
                        void performStorageSave(updated);
                      }}
                      title="Reset to workspace default"
                    >
                      <RotateCcw size={13} />
                      <span>Reset</span>
                    </button>
                  )}
                </div>
              </Field>
            </div>

            {/* Quick Presets */}
            {folderBrowser.presets.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 11.5 }}>
                <span style={{ color: "var(--muted)" }}>Quick select:</span>
                <button
                  type="button"
                  className="button secondary small"
                  style={{ padding: "2px 8px", fontSize: 11 }}
                  onClick={() => {
                    const updated = { ...formRef.current, exportsPath: "" };
                    setForm(updated);
                    void performStorageSave(updated);
                  }}
                >
                  Workspace default
                </button>
                {folderBrowser.presets.slice(0, 4).map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="button secondary small"
                    style={{ padding: "2px 8px", fontSize: 11 }}
                    onClick={() => {
                      const target = `${preset.path.replace(/\/+$/, "")}/Applications`;
                      const updated = { ...formRef.current, exportsPath: target };
                      setForm(updated);
                      void performStorageSave(updated);
                    }}
                  >
                    {preset.label}/Applications
                  </button>
                ))}
              </div>
            )}

            <div style={{ fontSize: 11.5, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span>Resolved export path:</span>
              <code>{(form.exportsPath ? form.exportsPath : `${settings.hostDocumentsPath || settings.storagePath}/${form.documentsSubdir || "opportunities"}`).replace(/\/+$/, "")}/&lt;Company&gt;/&lt;Role&gt;/</code>
            </div>
          </div>

          <div className="form-grid">
            <Field label="Reference library subfolder">
              <input
                required
                value={form.referenceSubdir}
                onChange={(e) => {
                  const updated = { ...formRef.current, referenceSubdir: e.target.value };
                  setForm(updated);
                  scheduleStorageSave(updated, 600);
                }}
                onBlur={handleStorageBlur}
              />
            </Field>
            <Field
              label="Backup subfolder"
              hint="Managed files are included in backups. Keep backups private."
            >
              <input
                required
                value={form.backupSubdir}
                onChange={(e) => {
                  const updated = { ...formRef.current, backupSubdir: e.target.value };
                  setForm(updated);
                  scheduleStorageSave(updated, 600);
                }}
                onBlur={handleStorageBlur}
              />
            </Field>
            <Field label="Display timezone">
              <input
                required
                value={form.timezone}
                onChange={(e) => {
                  const updated = { ...formRef.current, timezone: e.target.value };
                  setForm(updated);
                  scheduleStorageSave(updated, 600);
                }}
                onBlur={handleStorageBlur}
                placeholder="Europe/London"
              />
            </Field>
            <Field
              label="New host document root (optional)"
              wide
              hint="Enter an absolute folder path on the host, save, then choose Update & restart. Use the Recovery section to copy or reconnect existing files."
            >
              <input
                value={form.pendingHostPath || ""}
                onChange={(e) => {
                  const updated = { ...formRef.current, pendingHostPath: e.target.value };
                  setForm(updated);
                  scheduleStorageSave(updated, 600);
                }}
                onBlur={handleStorageBlur}
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
          <div className="auto-save-bar">
            <div className="auto-save-status" role="status" aria-live="polite">
              {storageStatus === "saving" && (
                <span className="status-saving">
                  <LoaderCircle size={14} className="spin" />
                  <span>Saving…</span>
                </span>
              )}
              {storageStatus === "saved" && (
                <span className="status-saved">
                  <Check size={14} />
                  <span>{storageNotice || "All changes saved"}</span>
                </span>
              )}
              {storageStatus === "undone" && (
                <span className="status-undone">
                  <RotateCcw size={14} />
                  <span>{storageNotice || "Undid last change"}</span>
                </span>
              )}
              {storageStatus === "error" && (
                <span className="status-error">
                  <AlertCircle size={14} />
                  <span>Could not save settings</span>
                </span>
              )}
            </div>
            <button
              type="button"
              className="button secondary small undo-button"
              disabled={storageUndoStack.length === 0 || storageStatus === "saving" || busy}
              onClick={() => void handleStorageUndo()}
              title="Undo last change (Cmd+Z or Ctrl+Z)"
            >
              <RotateCcw size={13} />
              Undo last change
            </button>
          </div>
        </section>
      </form>

      {folderBrowser.open && (
        <div
          className="modal-overlay"
          onClick={() => setFolderBrowser((prev) => ({ ...prev, open: false }))}
        >
          <div
            className="modal modal-wide"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 680, display: "flex", flexDirection: "column", gap: 16 }}
          >
            <div className="modal-heading" style={{ marginBottom: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <FolderOpen size={20} style={{ color: "var(--accent)" }} />
                <div>
                  <h2 style={{ fontSize: 18 }}>Select Application Export Folder</h2>
                  <p>Browse full disk to select where your opportunity application materials and exports are saved.</p>
                </div>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setFolderBrowser((prev) => ({ ...prev, open: false }))}
                title="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Quick jump presets */}
            {folderBrowser.presets.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "6px 10px", background: "var(--panel-soft)", borderRadius: 8 }}>
                <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Locations:</span>
                {folderBrowser.presets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className="button secondary small"
                    style={{ padding: "2px 8px", fontSize: 11 }}
                    onClick={() => loadFolders(p.path)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}

            {/* Current path and navigation */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--field-bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px" }}>
              <button
                type="button"
                className="button secondary small"
                disabled={!folderBrowser.parentPath || folderBrowser.loading}
                onClick={() => folderBrowser.parentPath && loadFolders(folderBrowser.parentPath)}
                title="Go up to parent folder"
                style={{ padding: "4px 8px" }}
              >
                <ChevronUp size={14} />
                <span>Up</span>
              </button>
              <code style={{ fontSize: 12, flex: 1, wordBreak: "break-all", color: "var(--ink)" }}>
                {folderBrowser.currentPath}
              </code>
            </div>

            {folderBrowser.error && (
              <div className="alert error" style={{ margin: 0, padding: "8px 12px", fontSize: 12 }}>
                {folderBrowser.error}
              </div>
            )}

            {/* Folder list */}
            <div
              style={{
                border: "1px solid var(--line)",
                borderRadius: 8,
                maxHeight: 280,
                minHeight: 180,
                overflowY: "auto",
                background: "var(--field-bg)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {folderBrowser.loading ? (
                <div style={{ padding: 30, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--muted)", fontSize: 12 }}>
                  <LoaderCircle size={16} className="spin" />
                  <span>Loading directories…</span>
                </div>
              ) : folderBrowser.folders.length === 0 ? (
                <div style={{ padding: 30, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
                  No subdirectories found in this folder.
                </div>
              ) : (
                folderBrowser.folders.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => loadFolders(f.path)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "8px 14px",
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px solid var(--line)",
                      color: "var(--ink)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 12.5,
                      fontFamily: "inherit",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--panel-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Folder size={15} style={{ color: "var(--accent)" }} />
                      <span>{f.name}</span>
                    </div>
                    <ChevronRight size={14} style={{ color: "var(--muted)" }} />
                  </button>
                ))
              )}
            </div>

            {/* Create subfolder input */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="text"
                placeholder="New subfolder name…"
                value={folderBrowser.newFolderName}
                onChange={(e) => setFolderBrowser((prev) => ({ ...prev, newFolderName: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleCreateSubfolder();
                  }
                }}
                style={{ flex: 1, height: 34, fontSize: 12 }}
              />
              <button
                type="button"
                className="button secondary small"
                disabled={!folderBrowser.newFolderName.trim() || folderBrowser.creating}
                onClick={handleCreateSubfolder}
              >
                <Plus size={13} />
                <span>Create folder</span>
              </button>
            </div>

            {/* Modal actions */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTop: "1px solid var(--line)" }}>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                {folderBrowser.writable ? (
                  <span style={{ color: "var(--green)", display: "flex", alignItems: "center", gap: 4 }}>
                    <Check size={13} /> Writable location
                  </span>
                ) : (
                  <span style={{ color: "var(--danger)" }}>Read-only folder</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setFolderBrowser((prev) => ({ ...prev, open: false }))}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={!folderBrowser.currentPath}
                  onClick={() => handleSelectFolder(folderBrowser.currentPath)}
                >
                  <Check size={14} />
                  <span>Select this folder</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

        </> },
        { id: "workflow", label: "AI workflow", content: <>
      <AIWorkflowSettings onError={onError}/>

        </> },
        { id: "recovery", label: "Recovery", content: <>
      <ReliabilitySettings onError={onError} timezone={settings.timezone}/>

        </> },
        { id: "imports", label: "Import records", content: <>
      <RecordImports timezone={settings.timezone} onImported={onImported}/>

        </> },
        { id: "backups", label: "Backups & export", content: <>
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
              Buddy API keys; keep it private. Use the Recovery section to activate a verified backup.
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
            {updateStatus?.reason && <p role="status">{updateStatus.reason}</p>}
            {updateStatus?.checkError && <p role="status">{updateStatus.checkError} Local source detection is separate.</p>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {updateStatus?.updateAvailable ? (
              <span
                className="update-indicator-pill"
                title={updateStatus.reason || "Update available"}
              >
                {updateStatus.localUpdateAvailable ? "Local changes ready" : "Update available"}
              </span>
            ) : null}
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
        </div>
      </section>

        </> },
        { id: "reset", label: "Reset workspace", content: <>
          <section className="settings-section">
            <div className="settings-section-heading"><div><h2>Start over</h2><p>Review exactly what will be removed before making a fresh start.</p></div></div>
            <p>Keep your profile, sign-in and storage locations. Reset the board's records, library links, conversations, feedback and preferences, including saved AI and connection credentials.</p>
            <p>A verified private backup is created first. Existing files, external originals and earlier backups stay on disk.</p>
            <WorkspaceAction action="reset-workspace" label="Reset workspace" onComplete={result=>{
              for(const key of Object.keys(localStorage))if(key.startsWith('knox-')||key.startsWith('opportunity-knox-'))localStorage.removeItem(key);
              sessionStorage.setItem('knox-reset-receipt',`Workspace reset. Your profile was kept. Private backup: ${result.backup.location}`);
              window.location.reload();
            }}/>
          </section>
        </> },
        { id: "connections", label: "Connections", content: <>
      <DocumentConnections onError={onError} onRestart={onRestart} restarting={restarting} />

        </> },
        { id: "ai-models", label: "AI Models", aliases: ["career-buddy", "embeddings", "decisions"], content: <>
      <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        <section className="settings-section" id="career-buddy-settings">
          <div className="settings-section-heading">
            <Bot size={21} />
            <div>
              <h2>Career Buddy Model</h2>
              <p>Configure the primary generative AI provider and model used for career chats, tailored CVs, and application drafting.</p>
            </div>
          </div>
          <CareerBuddySettings onError={onError} />
        </section>

        <section className="settings-section" id="decision-model-settings">
          <div className="settings-section-heading">
            <Sparkles size={21} />
            <div>
              <h2>Decision Model</h2>
              <p>Configure the AI model used for evaluating role alignment, criteria match scoring, and candidate fit assessments.</p>
            </div>
          </div>
          <CareerBuddySettings decision onError={onError} />
        </section>

        <section className="settings-section" id="embeddings-settings">
          <div className="settings-section-heading">
            <Layers size={21} />
            <div>
              <h2>Embeddings &amp; Semantic Search</h2>
              <p>Configure vector embeddings for indexing reference documents and retrieving relevant evidence from your Career Library.</p>
            </div>
          </div>
          <EmbeddingSettings onError={onError} />
        </section>
      </div>
        </> },
        { id: "mcp", label: "MCP Server", content: <>
      <MCPSettings onError={onError} />
        </> },
      ]} />
    </main>
  );
}
