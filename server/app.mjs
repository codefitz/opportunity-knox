import {createWorkspaceActions} from "./workspace-actions.mjs";
import {createAIActivity,publicRates} from "./ai-activity.mjs";
import {createAIScheduler} from "./ai-scheduler.mjs";
import {createRecordImports} from "./record-imports.mjs";
import {createOpportunitySummaries} from "./opportunity-summary.mjs";
import {createAIWorkflow} from "./ai-workflow.mjs";
import {createJobIntake} from "./job-intake.mjs";
import {createReliability} from "./reliability.mjs";
import {createBackupSchedule} from "./backup-schedule.mjs";
import {createOpportunityWorkflow} from "./opportunity-workflow.mjs";
import {createFeedback} from "./feedback.mjs";
import {createApplicationPacks} from "./application-packs.mjs";
import {
  generateSingleActivityIcs,
  generateOpportunityCalendarIcs,
  generateAllInterviewsCalendarIcs,
} from "./calendar.mjs";
import {
  opportunityFolderName,
  opportunityFolderPath,
  opportunitySubdirectory,
  buildOpportunityDocumentPath,
  isOpportunityDocumentOrganized,
} from "./managed-folders.mjs";
import { createUpdateChecker } from "./update-checker.mjs";
import { renderJobPageWithBrowser, detectBrowserExecutable } from "./job-browser-render.mjs";
import {documentCategory,inferDocumentClassification,validateCategory as categoryValue} from "./document-categories.mjs";
import {createDocumentStudio} from "./document-studio.mjs";
import {createGoogleDocuments} from "./google-documents.mjs";
import {createDirectorySources} from "./directory-sources.mjs";
import { createMcpIntegration } from "./mcp-integration.mjs";
import { cleanJobUrl } from "./url-cleaner.mjs";
import { createTargetCompanies } from "./target-companies.mjs";
import { checkOpportunityExclusions } from "./exclusions.mjs";
import { classifySeniority } from "./seniority.mjs";
import { calculateAlignment } from "./alignment.mjs";
import {
  canAutoAdvance,
  computeNextActionForStage,
  calendarDay,
} from "./workflow-automation.mjs";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import {
  mkdirSync,
  chmodSync,
  existsSync,
  realpathSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  statSync,
  copyFileSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
  rmSync,
  rmdirSync,
  accessSync,
  constants,
  readdirSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  resolve,
  dirname,
  join,
  extname,
  isAbsolute,
  relative,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJobPage } from "./job-fetch.mjs";
import { parseJobPage } from "./job-parser.mjs";
import { validateAvatar } from "./profile.mjs";
import { createCareerBuddy, parseBuddyOutput } from "./career-buddy.mjs";
import {
  defaultBuddy,
  assertConfigured,
  callProvider,
  buddyError,
  BUDDY_SCHEMA,
} from "./buddy-provider.mjs";
import { createObsidianIntegration } from "./obsidian-vault.mjs";
import { listBackups, inspectBackup } from "./backup-inspect.mjs";
import { restoreIsolatedBackup } from "./backup-restore.mjs";

export const stages = [
  ["identification", "Identification"],
  ["review", "Review"],
  ["documents", "CV & cover letter"],
  ["application-review", "Application review"],
  ["submitted", "Submitted"],
  ["interviews", "Interviews"],
  ["final-interview", "Final interview"],
  ["outcome", "Outcome"],
].map(([id, label]) => ({ id, label }));
const stageIds = stages.map((s) => s.id);
const outcomes = [
  "hired",
  "rejected",
  "ignored",
  "withdrawn",
  "closed",
  "gone-cold",
];
const textFields = [
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
  "aiSummary",
  "aiSummaryGeneratedAt",
  "nextAction",
  "nextActionDate",
];
const now = () => new Date().toISOString();
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};
const inside = (root, path) => path === root || path.startsWith(root + sep);
const cleanText = (value, name, max = 10000) => {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    fail(400, `${name} must be text up to ${max} characters.`);
  return value.trim();
};
const choice = (value, values, name) =>
  values.includes(value) ? value : fail(400, `Invalid ${name}.`);
const dateOnly = (value, name) => {
  if (value === "") return "";
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail(400, `${name} must be a valid date.`);
  return value;
};
const cleanDateOnly = (value, onNonDateText = null) => {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    if (Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === trimmed) {
      return trimmed;
    }
  }
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) {
    try {
      const iso = new Date(parsed).toISOString().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    } catch {}
  }
  if (onNonDateText && typeof onNonDateText === "function") {
    onNonDateText(trimmed);
  }
  return "";
};
const timestamp = (value, name) => {
  if (
    typeof value !== "string" ||
    !value ||
    !Number.isFinite(Date.parse(value))
  )
    fail(400, `${name} must be a valid date/time.`);
  return new Date(value).toISOString();
};
const safeURL = (value) => {
  const str = cleanText(value, "URL", 4000);
  if (str) {
    let url;
    try {
      url = new URL(str);
    } catch {
      fail(400, "Use a complete http or https job URL.");
    }
    if (!["http:", "https:"].includes(url.protocol))
      fail(400, "Use an http or https job URL.");
    return cleanJobUrl(str);
  }
  return str;
};
function safePath(root, subpath, { create = false } = {}) {
  if (
    typeof subpath !== "string" ||
    subpath.includes("\0") ||
    subpath.includes("\\") ||
    isAbsolute(subpath)
  )
    fail(400, "Choose a relative folder within the document location.");
  const segments = subpath.split("/").filter(Boolean);
  if (segments.some((s) => s === ".." || s === "."))
    fail(400, "Folder traversal is not allowed.");
  const base = realpathSync(root);
  let current = base;
  for (const segment of segments) {
    current = join(current, segment);
    if (
      existsSync(current) ||
      (() => {
        try {
          return lstatSync(current).isSymbolicLink();
        } catch {
          return false;
        }
      })()
    ) {
      let actual;
      try {
        actual = realpathSync(current);
      } catch {
        fail(400, "Folder contains an unavailable symbolic link.");
      }
      if (!inside(base, actual))
        fail(400, "Folder must remain inside the document location.");
    } else if (create) mkdirSync(current);
  }
  if (!inside(base, resolve(current)))
    fail(400, "Folder must remain inside the document location.");
  return current;
}
function folder(root, subpath) {
  const result = safePath(root, subpath, { create: true });
  if (!statSync(result).isDirectory())
    fail(400, "The selected location is not a folder.");
  const probe = join(result, `.board-write-check-${randomUUID()}`);
  try {
    writeFileSync(probe, "", { flag: "wx" });
    unlinkSync(probe);
  } catch {
    fail(400, "The selected folder is not writable.");
  }
  return result;
}
function cleanDocumentName(raw, allowFolders = false) {
  const value = cleanText(raw, "Filename", allowFolders ? 500 : 250);
  if (!allowFolders) {
    if (!value || /[/\\]/.test(value) || value === "." || value === "..")
      fail(400, "Use a filename without folder separators.");
    return value;
  }
  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (
    !segments.length ||
    segments.some(
      (s) =>
        !s || s === "." || s === ".." || s.length > 250 || s.startsWith("."),
    )
  )
    fail(
      400,
      "Use a valid relative path without hidden or parent folder segments.",
    );
  return segments.join("/");
}
function inferDocumentTags(name, kind, content) {
  const tags = [];
  const add = (raw) => {
    const clean = String(raw || "")
      .trim()
      .replace(/^#+/, "")
      .replace(/\s+/g, " ")
      .slice(0, 60);
    if (
      clean &&
      !tags.some((t) => t.toLowerCase() === clean.toLowerCase()) &&
      tags.length < 20
    )
      tags.push(clean);
  };
  const segments = name.split("/").slice(0, -1);
  for (const seg of segments) add(seg);
  const ext = extname(name).toLowerCase();
  const extMap = {
    ".pdf": "PDF",
    ".docx": "Word",
    ".pptx": "Slides",
    ".md": "Markdown",
    ".markdown": "Markdown",
    ".txt": "Text",
    ".vtt": "Transcript",
    ".srt": "Transcript",
    ".html": "HTML",
    ".htm": "HTML",
    ".rtf": "RTF",
    ".csv": "Data",
    ".tsv": "Data",
    ".json": "Data",
    ".yaml": "Config",
    ".yml": "Config",
    ".gdoc": "Google Doc",
    ".gsheet": "Google Sheet",
    ".gslides": "Google Slides",
  };
  if (extMap[ext]) add(extMap[ext]);
  const kindMap = {
    jd: "Job Description",
    cv: "CV",
    cover: "Cover Letter",
  };
  if (kindMap[kind]) add(kindMap[kind]);
  if (
    content &&
    [".md", ".markdown", ".txt"].includes(ext) &&
    content.length <= 500000
  ) {
    const sample = content.subarray(0, 16384).toString("utf8");
    const fm = sample.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fm) {
      const inline = fm[1].match(/^\s*tags\s*:\s*\[([^\]]*)\]/im);
      if (inline) {
        for (const item of inline[1].split(","))
          add(item.trim().replace(/^['"]|['"]$/g, ""));
      } else {
        const list = fm[1].match(
          /^\s*tags\s*:\s*\r?\n((?:\s*-\s*.+\r?\n?)+)/im,
        );
        if (list) {
          for (const line of list[1].split(/\r?\n/)) {
            const m = line.match(/^\s*-\s*(.+)/);
            if (m) add(m[1].trim().replace(/^['"]|['"]$/g, ""));
          }
        }
      }
    }
    const body = fm ? sample.slice(fm[0].length) : sample;
    for (const m of body.matchAll(/(?:^|[\s(])#([a-zA-Z][\w/-]{1,35})\b/g)) {
      add(m[1]);
    }
  }
  return tags;
}
function cleanDocumentTags(raw) {
  if (!Array.isArray(raw) || raw.length > 30)
    fail(400, "Tags must be a list of up to 30 items.");
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const tag = cleanText(item, "Tag", 60).replace(/^#+/, "").trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}
function validateCategory(v){try{return categoryValue(v);}catch(e){fail(e.status||400,e.message);}}
const publicDocument = ({
  storageRoot,
  relativePath,
  sha256,
  tags,
  ...rest
}) => {
  const originalUrl =
    rest.originalUrl ||
    rest.externalSource?.url ||
    (rest.notes || "").match(
      /https:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[A-Za-z0-9_-]+(?:\/edit)?/,
    )?.[0] ||
    "";
  return {
    ...rest,
    ...(originalUrl ? { originalUrl } : {}),
    category: documentCategory(rest),
    tags: Array.isArray(tags)
      ? tags
      : inferDocumentTags(rest.name || "", rest.kind || ""),
    url: `/api/documents/${rest.id}/content`,
  };
};
function writeAtomic(path, data) {
  const temp = path + "." + randomUUID() + ".tmp";
  writeFileSync(temp, data, { mode: 0o600 });
  renameSync(temp, path);
}

/** Creates an unbound HTTP server. Call server.listen(), and await close() to release server and SQLite. */
export function createApp(options = {}) {
  const browserRunner = options.browserRunner;
  const lookupJob =
    options.jobLookup ||
    (async (url) => {
      const page = await fetchJobPage(url);
      try {
        const parsed = parseJobPage(page.html, { url: page.url });
        return {
          ...parsed,
          sourceUrl: url,
          resolvedUrl: page.url,
        };
      } catch (parseError) {
        if (parseError.code === "JOB_PAGE_JS_REQUIRED") {
          // Attempt headless browser rendering if available
          try {
            const rendered = await renderJobPageWithBrowser(page.url, {
              runner: browserRunner,
            });
            const renderedParsed = parseJobPage(rendered.html, { url: page.url });
            return {
              ...renderedParsed,
              method: "browser-rendered",
              sourceUrl: url,
              resolvedUrl: page.url,
              warnings: [
                "Listing was rendered with a headless browser; verify details against the listing.",
                ...(renderedParsed.warnings || []),
              ],
            };
          } catch (renderError) {
            // Propagate the original or rendering error
            throw renderError;
          }
        }
        throw parseError;
      }
    });
  let activeJobLookups = 0;
  const dataDir = resolve(
    options.dataDir || process.env.BOARD_DATA_DIR || ".local/state",
  );
  const filesInput = resolve(
    options.filesDir || process.env.BOARD_FILES_DIR || ".local/files",
  );
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(filesInput, { recursive: true });
  const filesDir = realpathSync(filesInput);
  const setupToken = options.setupToken ?? process.env.BOARD_SETUP_TOKEN ?? "";
  const updateChecker = options.updateChecker || createUpdateChecker({
    fetcher: options.fetcher,
  });
  const configuredRoots =
    options.documentRoots ??
    (process.env.BOARD_DOCUMENT_ROOTS
      ? JSON.parse(process.env.BOARD_DOCUMENT_ROOTS)
      : null);
  const allowedRoots = configuredRoots
    ? new Set(
        [...configuredRoots, filesDir].map((p) => {
          try {
            return realpathSync(p);
          } catch {
            return resolve(p);
          }
        }),
      )
    : null;
  const documentPath = (doc) => {
    const s = settings();
    const activeExports =
      s.exportsPath && isAbsolute(s.exportsPath)
        ? resolve(s.exportsPath)
        : null;
    if (
      allowedRoots &&
      !allowedRoots.has(resolve(doc.storageRoot)) &&
      (!activeExports || resolve(doc.storageRoot) !== activeExports)
    )
      fail(
        404,
        "The original document location is not attached to this installation.",
      );
    return safePath(doc.storageRoot, doc.relativePath);
  };
  const hostFilesDir =
    options.hostFilesDir ?? process.env.BOARD_HOST_FILES_DIR ?? filesDir;
  const distDir = resolve(
    options.distDir || fileURLToPath(new URL("../dist", import.meta.url)),
  );
  const db = new DatabaseSync(join(dataDir, "board.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS ai_tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL);",
  );
  const getConfig = (key) => {
    const row = db.prepare("SELECT data FROM config WHERE key=?").get(key);
    return row ? JSON.parse(row.data) : null;
  };
  const putConfig = (key, data) =>
    db
      .prepare(
        "INSERT INTO config(key,data) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
      )
      .run(key, JSON.stringify(data));
  if (!getConfig("uploadWorkspaceId")) putConfig("uploadWorkspaceId", randomUUID());
  let activeWrites = 0;
  const getRecord = (id) => {
    const row = db.prepare("SELECT data FROM records WHERE id=?").get(id);
    if (!row) fail(404, "Opportunity not found.");
    return JSON.parse(row.data);
  };
  const putRecord = (record) =>
    db
      .prepare(
        "INSERT INTO records(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(record.id, JSON.stringify(record));
  const getProfile = () =>
    getConfig("profile") || {
      name: "Your workspace",
      revision: 1,
      image: null,
    };
  const publicProfile = () => {
    const profile = getProfile();
    return {
      name: profile.name,
      revision: profile.revision,
      avatarUrl: profile.image
        ? `/api/profile/avatar?v=${profile.revision}`
        : "",
    };
  };
  const getTask = (id) => {
    const row = db.prepare("SELECT data FROM tasks WHERE id=?").get(id);
    if (!row) fail(404, "Task not found.");
    return JSON.parse(row.data);
  };
  const putTask = (task) =>
    db
      .prepare(
        "INSERT INTO tasks(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(task.id, JSON.stringify(task));
  const listTasks = () =>
    db
      .prepare("SELECT data FROM tasks")
      .all()
      .map((row) => JSON.parse(row.data))
      .sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        const due = (a.dueDate || "9999-99-99").localeCompare(
          b.dueDate || "9999-99-99",
        );
        return (
          due ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id)
        );
      });
  const linkedOpportunity = (value) => {
    const id = cleanText(value, "Linked opportunity", 100);
    if (id && !db.prepare("SELECT id FROM records WHERE id=?").get(id))
      fail(
        400,
        "The linked opportunity was not found. Reload and choose an existing opportunity.",
      );
    return id;
  };
  const getDocuments = () =>
    db
      .prepare("SELECT data FROM documents")
      .all()
      .map((row) => {const d=JSON.parse(row.data);return {...d,category:documentCategory(d)};});
  const getDocument = (id) => {
    const row = db.prepare("SELECT data FROM documents WHERE id=?").get(id);
    if (!row) fail(404, "Document not found.");
    return JSON.parse(row.data);
  };
  const putDocument = (doc) =>
    db
      .prepare(
        "INSERT INTO documents(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(doc.id, JSON.stringify(doc));
  const pruneEmptyParents = (dir, root) => {
    let curr = resolve(dir);
    const stop = resolve(root);
    while (curr.startsWith(stop) && curr !== stop) {
      try {
        rmdirSync(curr);
        curr = dirname(curr);
      } catch {
        break;
      }
    }
  };
  const removeDocument = (doc) => {
    db.prepare("DELETE FROM documents WHERE id=?").run(doc.id);
    db.prepare("DELETE FROM document_text WHERE id=?").run(doc.id);
    try {
      const target = documentPath(doc);
      const root =
        doc.storageRoot && inside(resolve(doc.storageRoot), resolve(target))
          ? resolve(doc.storageRoot)
          : filesDir;
      if (inside(root, target)) {
        rmSync(target, { force: true });
        pruneEmptyParents(dirname(target), root);
      }
    } catch {
      /* Missing or read-only prior storage root; metadata is already removed. */
    }
  };
  const fullRecord = (record, candidateProfile = null) => {
    const s = settings();
    const seniority =
      record.seniority ||
      classifySeniority(record.role, record.description);
    const matchedExclusions = checkOpportunityExclusions(
      record,
      s.exclusionKeywords || [],
    );
    const profile = candidateProfile || getCandidateProfile();
    const alignment = calculateAlignment(record, profile);
    const outputFolder =
      s.exportsPath && isAbsolute(s.exportsPath)
        ? `${resolve(s.exportsPath).replace(/\/+$/, "")}/${opportunityFolderPath(record)}`
        : `${s.documentsSubdir || "opportunities"}/${opportunityFolderPath(record)}`;
    return {
      ...record,
      seniority,
      matchedExclusions,
      alignmentScore: alignment.score,
      alignmentTier: alignment.tier,
      matchedSkills: alignment.matchedSkills,
      missingSkills: alignment.missingSkills || [],
      alignmentBreakdown: alignment.breakdown,
      outputFolder,
      documents: getDocuments()
        .filter((d) => d.opportunityId === record.id)
        .map(publicDocument),
    };
  };
  const listRecords = () =>
    db
      .prepare("SELECT data FROM records ORDER BY rowid DESC")
      .all()
      .map((row) => JSON.parse(row.data));
  const settingDefaults = {
    timezone: "Europe/London",
    theme: "forest",
    themeAccent: "",
    themeBackground: "",
    documentsSubdir: "opportunities",
    exportsPath: "",
    referenceSubdir: "references",
    backupSubdir: "backups",
    pendingHostPath: "",
    aiEnabled: false,
    exclusionKeywords: [],
    targetTitles: [],
    targetSkills: [],
    autoArchiveExcluded: false,
    autoAdvanceStages: true,
    autoGenerateTasks: false,
    defaultFollowUpDays: 7,
    dailyTarget: 3,
  };
  const settings = () => {
    let pendingHostPath = "";
    try {
      pendingHostPath =
        JSON.parse(readFileSync(join(dataDir, "pending-storage.json"), "utf8"))
          .hostPath || "";
    } catch {
      /* No pending request. */
    }
    const stored = getConfig("settings") || {};
    const effectiveExports =
      stored.exportsPath && isAbsolute(stored.exportsPath)
        ? resolve(stored.exportsPath)
        : resolve(hostFilesDir, stored.documentsSubdir || "opportunities");
    return {
      ...settingDefaults,
      ...stored,
      aiEnabled: Boolean(getConfig("careerBuddy")?.enabled),
      pendingHostPath,
      hostDocumentsPath: hostFilesDir,
      storagePath: filesDir,
      exportsPath: stored.exportsPath || "",
      resolvedExportsPath: effectiveExports,
    };
  };
  const getCandidateProfile = () => {
    const s = settings();
    const crit = getConfig("fitCriteria") || {};
    const structured = crit.structured || {};

    const targetTitles = [
      ...(s.targetTitles || []),
      ...(structured.targetTitles || []),
    ].filter((t, i, arr) => t && arr.indexOf(t) === i);

    const targetSkills = [
      ...(s.targetSkills || []),
      ...(structured.targetSkills || []),
    ].filter((sk, i, arr) => sk && arr.indexOf(sk) === i);

    const targetSeniorities = structured.targetSeniorities || [];
    const workModes = structured.workModes || [];

    const careerTexts = [];
    try {
      const rows = db
        .prepare(
          `SELECT dt.data
           FROM document_text dt
           JOIN documents d ON dt.id = d.id
           WHERE json_extract(d.data, '$.opportunityId') IS NULL`,
        )
        .all();
      for (const r of rows) {
        try {
          const parsed = JSON.parse(r.data);
          if (
            parsed.text &&
            typeof parsed.text === "string" &&
            parsed.text.trim()
          ) {
            careerTexts.push(parsed.text);
          }
        } catch {}
      }
    } catch {}

    try {
      const docs = getDocuments().filter((d) => !d.opportunityId);
      for (const doc of docs) {
        if (
          doc.generation?.content &&
          typeof doc.generation.content === "string"
        ) {
          if (!careerTexts.includes(doc.generation.content)) {
            careerTexts.push(doc.generation.content);
          }
        }
      }
    } catch {}

    return {
      targetTitles,
      targetSkills,
      targetSeniorities,
      workModes,
      careerTexts,
    };
  };
  for (const key of ["documentsSubdir", "referenceSubdir", "backupSubdir"])
    folder(filesDir, settings()[key]);
  const loadSessions = () => {
    const stored = getConfig("sessions") || {};
    const valid = {};
    const nowMs = Date.now();
    for (const [k, exp] of Object.entries(stored))
      if (typeof exp === "number" && exp > nowMs) valid[k] = exp;
    return valid;
  };
  const sessions = new Map(Object.entries(loadSessions()));
  const persistSessions = () =>
    putConfig("sessions", Object.fromEntries(sessions.entries()));
  const attempts = new Map();
  const authCookie = (req) => {
    const match = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("board_session="));
    if (!match) return false;
    const key = createHash("sha256").update(match.slice(14)).digest("hex");
    const expires = sessions.get(key);
    if (!expires || expires < Date.now()) {
      if (sessions.delete(key)) persistSessions();
      return false;
    }
    return true;
  };
  const setSession = (req, res) => {
    const token = randomBytes(32).toString("hex");
    sessions.set(
      createHash("sha256").update(token).digest("hex"),
      Date.now() + 14 * 86400000,
    );
    persistSessions();
    const secure =
      req.socket.encrypted ||
      (process.env.BOARD_TRUST_PROXY === "1" &&
        req.headers["x-forwarded-proto"] === "https");
    res.setHeader(
      "Set-Cookie",
      `board_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1209600${secure ? "; Secure" : ""}`,
    );
  };
  const requireRevision = (body, record) => {
    if (!Number.isInteger(body.revision) || body.revision !== record.revision)
      fail(
        409,
        "This opportunity changed on another device. Reload it before saving.",
      );
  };
  const changed = (record) => {
    record.revision++;
    record.updatedAt = now();
    putRecord(record);
    queueMicrotask(()=>buddy.automate(record.id));
    return fullRecord(record);
  };
  const addEvent = (record, body, stage = record.stage) => {
    const event = {
      id: randomUUID(),
      stage: choice(stage, stageIds, "stage"),
      note: cleanText(body.note ?? "", "Note", 50000),
      effectiveAt: body.effectiveAt
        ? timestamp(body.effectiveAt, "Effective date")
        : now(),
      recordedAt: now(),
      corrections: [],
    };
    record.events.push(event);
    return event;
  };
  function createOpportunity(body,{skipAutomation=false}={}) {
    const record = {
      id: randomUUID(),
      stage: body.stage ?? "identification",
      outcome: body.outcome ?? "",
      priority: body.priority ?? "normal",
      tags: [],
      revision: 1,
      createdAt: now(),
      updatedAt: now(),
      stageEnteredAt: now(),
      events: [],
      activities: [],
    };
    for (const key of textFields)
      record[key] = cleanText(
        body[key] ?? "",
        key,
        key === "description" ? 200000 : 10000,
      );
    if (!record.role || !record.company)
      fail(400, "Employer and role are required.");
    record.url = safeURL(record.url);
    if (record.deadline) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(record.deadline)) {
        dateOnly(record.deadline, "Deadline");
      } else {
        if (!record.description.includes(record.deadline)) {
          record.description = (record.description ? record.description + "\n\n" : "") + `Deadline: ${record.deadline}`;
        }
        record.deadline = "";
      }
    }
    if (record.nextActionDate) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(record.nextActionDate)) {
        dateOnly(record.nextActionDate, "Next action date");
      } else {
        if (!record.description.includes(record.nextActionDate)) {
          record.description = (record.description ? record.description + "\n\n" : "") + `Next action date: ${record.nextActionDate}`;
        }
        record.nextActionDate = "";
      }
    }
    choice(record.stage, stageIds, "stage");
    choice(record.priority, ["normal", "high", "low"], "priority");
    choice(record.outcome, ["", ...outcomes], "outcome");
    if (record.outcome) record.stage = "outcome";
    if (record.stage === "outcome" && !record.outcome)
      fail(400, "Choose an outcome.");
    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags) || body.tags.length > 30)
        fail(400, "Tags must be a list of up to 30 items.");
      record.tags = body.tags.map((x) => cleanText(x, "Tag", 100));
    }
    if (body.seniority) {
      record.seniority = choice(
        body.seniority,
        ["entry", "mid", "senior", "lead", "director", "executive"],
        "seniority",
      );
    } else {
      record.seniority = classifySeniority(record.role, record.description);
    }
    const s = settings();
    if (!record.nextAction && record.stage !== "outcome") {
      const plan = computeNextActionForStage(record.stage, {
        today: calendarDay(new Date(), s.timezone),
        followUpDays: s.defaultFollowUpDays,
        role: record.role,
        company: record.company,
      });
      record.nextAction = plan.nextAction;
      record.nextActionDate = plan.nextActionDate;
      if (s.autoGenerateTasks && plan.taskTitle) {
        putTask({
          id: randomUUID(),
          title: plan.taskTitle,
          notes: "",
          dueDate: plan.nextActionDate,
          completed: false,
          opportunityId: record.id,
          revision: 1,
          createdAt: now(),
          updatedAt: now(),
          completedAt: "",
        });
      }
    }
    const event = addEvent(record, body);
    record.stageEnteredAt = event.effectiveAt;
    record.currentStageEventId = event.id;
    try {
      folder(filesDir, join(s.documentsSubdir, opportunityFolderPath(record)));
    } catch {}
    putRecord(record);
    if(!skipAutomation)queueMicrotask(()=>buddy.automate(record.id,{useLibrary:body.autoUseLibrary===true}));
    return fullRecord(record);
  }
  const saveDocument = ({
    name,
    kind,
    status,
    opportunityId,
    content,
    notes = "",
    tags,
    generation,
    importRequestId,
    externalSource,
    category,
  }) => {
    const resolvedCategory=category===undefined?documentCategory({kind,opportunityId,generation}):validateCategory(category);
    const version =
      1 +
      getDocuments()
        .filter(
          (d) =>
            d.opportunityId === opportunityId &&
            d.kind === kind &&
            d.name === name,
        )
        .reduce((n, d) => Math.max(n, d.version), 0);
    const id = randomUUID();
    let relativePath;
    let docStorageRoot = filesDir;
    if (opportunityId) {
      let opp = null;
      try {
        opp = getRecord(opportunityId);
      } catch {}
      const s = settings();
      if (s.exportsPath && isAbsolute(s.exportsPath)) {
        docStorageRoot = resolve(s.exportsPath);
        try {
          mkdirSync(docStorageRoot, { recursive: true, mode: 0o700 });
        } catch {}
        const folderPath = opp ? opportunityFolderPath(opp) : "unassigned";
        const ext = (name ? extname(name) : "").replace(/[^.a-zA-Z0-9]/g, "");
        const baseName = name
          ? name.replace(/[/\\]/g, "-").replace(extname(name), "").trim()
          : "";
        const fileName = baseName ? `${baseName}${ext}` : `${id}${ext}`;
        relativePath = `${folderPath}/${fileName}`;
        const checkTarget = safePath(docStorageRoot, relativePath);
        if (existsSync(checkTarget)) {
          relativePath = `${folderPath}/${baseName || id}-${id.slice(0, 8)}${ext}`;
        }
        folder(docStorageRoot, dirname(relativePath));
      } else {
        relativePath = buildOpportunityDocumentPath({
          documentsSubdir: s.documentsSubdir,
          opportunity: opp,
          documentId: id,
          name,
          kind,
          status,
          category: resolvedCategory,
        });
        const checkTarget = safePath(filesDir, relativePath);
        if (existsSync(checkTarget)) {
          const ext = extname(relativePath);
          const base = relativePath.slice(0, relativePath.length - ext.length);
          relativePath = `${base}-${id.slice(0, 8)}${ext}`;
        }
        folder(filesDir, dirname(relativePath));
      }
    } else {
      const baseSubdir = settings().referenceSubdir;
      folder(filesDir, baseSubdir);
      relativePath = `${baseSubdir}/${id}${extname(name).replace(/[^.a-zA-Z0-9]/g, "")}`;
    }
    const target = safePath(docStorageRoot, relativePath);
    writeFileSync(target, content, { flag: "wx", mode: 0o600 });
    const resolvedTags =
      tags !== undefined
        ? cleanDocumentTags(tags)
        : inferDocumentTags(name, kind, content);
    let detectedExternalSource = externalSource;
    const ext = extname(name).toLowerCase();
    if (
      !detectedExternalSource &&
      [".gdoc", ".gsheet", ".gslides"].includes(ext) &&
      content.length < 100000
    ) {
      try {
        const raw = content.toString("utf8").replace(/^\uFEFF/, "").trim();
        const data = JSON.parse(raw);
        const docId =
          data.doc_id ||
          data.id ||
          (typeof data.resource_id === "string"
            ? data.resource_id.replace(
                /^(?:document|spreadsheet|presentation):/,
                "",
              )
            : "");
        let url = data.url || "";
        if (!docId && url) {
          const m =
            url.match(
              /\/(?:document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/,
            ) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
          if (m) docId = m[1];
        }
        const subpath =
          ext === ".gsheet"
            ? "spreadsheets"
            : ext === ".gslides"
              ? "presentation"
              : "document";
        if (!url && docId) url = `https://docs.google.com/${subpath}/d/${docId}/edit`;
        if (docId || url) {
          detectedExternalSource = {
            provider: "google-docs",
            id: docId,
            url,
            email: data.email || "",
          };
        }
      } catch {
        const m = content
          .toString("utf8")
          .match(
            /https:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/,
          );
        if (m) {
          detectedExternalSource = {
            provider: "google-docs",
            id: m[1],
            url: m[0],
          };
        }
      }
    }
    const document = {
      id,
      name,
      kind,
      status,
      opportunityId,
      createdAt: now(),
      size: content.length,
      version,
      notes: notes,
      tags: resolvedTags,
      category:resolvedCategory,
      storageRoot: docStorageRoot,
      relativePath,
      sha256: createHash("sha256").update(content).digest("hex"),
      revision: 1,
      ...(generation ? { generation } : {}),
      ...(detectedExternalSource ? { externalSource: detectedExternalSource } : {}),
      ...(importRequestId ? { importRequestId } : {}),
    };
    try {
      putDocument(document);
    } catch (e) {
      unlinkSync(target);
      throw e;
    }
    return publicDocument(document);
  };
  function createBackup() {
    const createdAt = now();
    const name = `board-${createdAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const backupRoot = folder(filesDir, settings().backupSubdir);
    const destination = join(backupRoot, `.partial-${name}`);
    const completedDestination = join(backupRoot, name);
    try {
      mkdirSync(join(destination, "documents"), {
        recursive: true,
        mode: 0o700,
      });
      // Copy only database-tracked documents, never walk the storage tree: prior backups
      // and this snapshot are excluded even when backupRoot is inside filesDir.
      // All copies and metadata reads are synchronous, so requests cannot interleave.
      const manifest = [];
      for (const doc of getDocuments()) {
        let source;
        try {
          source = documentPath(doc);
          if (!statSync(source).isFile()) throw Error("Unavailable");
        } catch {
          fail(
            409,
            `Backup incomplete: ${doc.name} is unavailable. Restore its document location and retry.`,
          );
        }
        const destinationPath = join(destination, "documents", doc.id);
        copyFileSync(source, destinationPath);
        if (
          createHash("sha256")
            .update(readFileSync(destinationPath))
            .digest("hex") !== doc.sha256
        )
          fail(
            409,
            "Backup could not verify a document. Originals remain unchanged.",
          );
        manifest.push({
          ...publicDocument(doc),
          backupPath: `documents/${doc.id}`,
          storageRoot: doc.storageRoot,
          relativePath: doc.relativePath,
        });
      }
      // Serialize metadata and credentials into a standalone database snapshot before yielding.
      const snapshot = new DatabaseSync(join(destination, "board.sqlite"));
      try {
        snapshot.exec(
          "CREATE TABLE records (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE documents (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE config (key TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE tasks (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE buddy_messages (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE document_text (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE document_vectors (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE decision_assessments (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE standalone_messages (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE standalone_attachments (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE standalone_attachment_originals (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE opportunity_automation (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE buddy_requests (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE ai_tasks (id TEXT PRIMARY KEY,data TEXT NOT NULL);",
        );
        for (const table of [
          "records",
          "documents",
          "config",
          "tasks",
          "buddy_messages",
          "document_text",
          "document_vectors",
          "decision_assessments",
          "standalone_messages",
          "standalone_attachments",
          "standalone_attachment_originals",
          "opportunity_automation",
          "buddy_requests",
          "ai_tasks",
        ]) {
          const rows = db.prepare(`SELECT * FROM ${table}`).all();
          const key = table === "config" ? "key" : "id";
          const insert = snapshot.prepare(
            `INSERT INTO ${table}(${key},data) VALUES (?,?)`,
          );
          snapshot.exec("BEGIN");
          for (const row of rows) insert.run(row[key], row.data);
          snapshot.exec("COMMIT");
        }
      } finally {
        snapshot.close();
      }
      chmodSync(join(destination, "board.sqlite"), 0o600);
      writeFileSync(
        join(destination, "manifest.json"),
        JSON.stringify(
          {
            format: "opportunity-board-backup",
            version: 1,
            createdAt,
            documents: manifest,
            restore:
              "Restore board.sqlite into a stopped installation and copy documents to their recorded storageRoot/relativePath, or remap roots before use. Backup contains the private password hash, Career Buddy API key and conversations. Keep it private.",
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      renameSync(destination, completedDestination);
    } catch (error) {
      // Incomplete backups never appear under a finished snapshot name.
      try {
        rmSync(destination, { recursive: true, force: true });
      } catch {
        /* A remaining .partial directory clearly identifies failed work. */
      }
      throw error;
    }
    return { name, createdAt, location: completedDestination };
  }
  const reliability=createReliability({dataDir,settings,createRestore:(name)=>{const id="restore-"+randomUUID();restoreIsolatedBackup(safePath(filesDir,settings().backupSubdir),name,join(folder(dataDir,"restores",{create:true}),id));return id;}});
  const backupSchedule=createBackupSchedule({getConfig,putConfig,createBackup,clock:options.backupClock,timers:options.backupTimers!==false,canRun:()=>!reliability.applying()});
  const autoAdvanceOpportunity = (recordOrId, targetStage, reason) => {
    const s = settings();
    if (!s.autoAdvanceStages) return null;
    let record;
    if (typeof recordOrId === "object" && recordOrId !== null) {
      record = recordOrId;
    } else {
      try {
        record = getRecord(recordOrId);
      } catch {
        return null;
      }
    }
    if (!canAutoAdvance(record.stage, targetStage)) return null;

    const oldStage = record.stage;
    record.stage = targetStage;
    const note = `Auto-advanced: ${reason}`;
    const ev = addEvent(record, { note });
    record.stageEnteredAt = ev.effectiveAt;
    record.currentStageEventId = ev.id;

    // Update next action and create linked task
    const plan = computeNextActionForStage(targetStage, {
      today: calendarDay(new Date(), s.timezone),
      followUpDays: s.defaultFollowUpDays,
      role: record.role,
      company: record.company,
    });
    record.nextAction = plan.nextAction;
    record.nextActionDate = plan.nextActionDate;
    if (s.autoGenerateTasks && plan.taskTitle) {
      putTask({
        id: randomUUID(),
        title: plan.taskTitle,
        notes: "",
        dueDate: plan.nextActionDate,
        completed: false,
        opportunityId: record.id,
        revision: 1,
        createdAt: now(),
        updatedAt: now(),
        completedAt: "",
      });
    }

    if (typeof recordOrId === "string") {
      record.revision++;
      record.updatedAt = now();
      putRecord(record);
    }
    return record;
  };
  const workflow=createOpportunityWorkflow({getRecord,putRecord,fullRecord,addEvent,getDocuments});
  const packs=createApplicationPacks({db,getRecord,putRecord,getDocuments,putDocument,documentPath,fullRecord,addEvent});
  const googleDocuments=createGoogleDocuments({getConfig,putConfig,getDocuments,saveDocument,publicDocument,fetcher:options.googleFetch});
  const studio=createDocumentStudio({getDocuments,documentPath,saveDocument,convert:options.documentConvert,pdfThumbnail:options.documentThumbnail,pdfPages:options.documentPages,googleDocuments,obsidian:()=>obsidian,getConfig,putConfig,getRecord,listRecords,buddyFetch:options.buddyFetch,autoAdvanceOpportunity});
  const directories=createDirectorySources({db,getConfig,putConfig,dataDir,filesDir,hostFilesDir,mounts:options.sourceRoots||JSON.parse(process.env.BOARD_SOURCE_ROOTS||"[]")});
  const aiScheduler=createAIScheduler({db,getConfig,putConfig,listRecords});
  let obsidian;
  const buddy = createCareerBuddy({
    saveFitReview: workflow.saveFitReview,
    db,
    getConfig,
    putConfig,
    getRecord,
    putRecord,
    fullRecord,
    getCandidateProfile,
    getDocuments: () => [...getDocuments(), ...(obsidian?.sourceDocuments() || []),...directories.sourceDocuments()],
    documentPath: (doc) => doc.readOnlyDirectorySource ? directories.sourcePath(doc) : doc.readOnlyVaultSource ? obsidian.sourcePath(doc) : documentPath(doc),
    settings,
    saveDocument,
    googleDocuments,
    fetcher: options.googleFetch || fetch,
    buddyFetch: options.buddyFetch,
    pdfStyle: options.pdfStyle,
    embeddingFn: options.embeddingFn,
    automationEnabled:options.automationEnabled,
    scheduler:aiScheduler,
    codexQueueDir: options.codexQueueDir,
    createOpportunity,putTask,
  });
  const feedback=createFeedback({getConfig,putConfig,fetcher:options.buddyFetch,requests:buddy.requests});
  const aiActivity=createAIActivity({db,getConfig,putConfig,listRecords});
  const recordImports=createRecordImports({db,getConfig,putConfig,listRecords,getRecord,putRecord,getDocuments,listTasks,createBackup});
  const summaries=createOpportunitySummaries({getConfig,putConfig,getRecord,getDocuments,listTasks,listRecords,requests:buddy.requests,buddyFetch:options.buddyFetch});
  const aiWorkflow=createAIWorkflow({getConfig,putConfig});
  const targetCompanies=createTargetCompanies({getConfig,putConfig});
  const jobIntake=createJobIntake({dataDir,db,getConfig,requests:buddy.requests,saveDocument,getDocument,getDocuments,getRecord,putRecord,fullRecord,addEvent,documentPath,createOpportunity,pageFetcher:options.intakePageFetcher,extractor:options.intakeExtractor,pdfExtractor:options.intakePDF,browserRunner:options.browserRunner,buddyFetch:options.buddyFetch,onCreated:id=>queueMicrotask(()=>buddy.automate(id))});
  obsidian = createObsidianIntegration({
    dataDir,
    filesDir,
    hostFilesDir,
    vaultDir: options.vaultDir ?? process.env.BOARD_VAULT_DIR ?? "",
    hostVaultDir:
      options.hostVaultDir ?? process.env.BOARD_HOST_VAULT_DIR ?? "",
    getConfig,
    putConfig,
    getDocuments,
    putDocument,
    saveDocument,
    documentPath,
    safePath,
    buddy,
    replaceDocumentContent: (id, revision, expectedHash, content) => {
      const doc = getDocument(id);
      if (doc.opportunityId || doc.status === "submitted") fail(409, "Submitted or opportunity documents cannot be replaced here.");
      if ((doc.revision ?? 1) !== revision) fail(409, "The document changed. Review again.");
      const file = documentPath(doc), original = readFileSync(file);
      if (createHash("sha256").update(original).digest("hex") !== expectedHash || doc.sha256 !== expectedHash) fail(409, "The local file changed. Refresh storage and review again.");
      if (content.length > 20 * 1024 * 1024) fail(413, "Maximum file size is 20 MB.");
      const backup = createBackup();
      db.exec("BEGIN IMMEDIATE");
      try {
        writeAtomic(file, content);
        putDocument({ ...doc, size: content.length, sha256: createHash("sha256").update(content).digest("hex"), revision: (doc.revision ?? 1) + 1 });
        db.prepare("DELETE FROM document_text WHERE id=?").run(id);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); writeAtomic(file, original); throw error; }
      return { backup: backup.name };
    },
    deleteSourceCache: (id) => db.prepare("DELETE FROM document_text WHERE id=?").run(id),
    fail,
  });
  const workspaceActions = createWorkspaceActions({db,getConfig,putConfig,settings,dataDir,createBackup,
    otherWrites:()=>activeWrites>1,
    invalidate:({reset,documentIds})=>{studio.invalidate(reset?null:documentIds);if(reset)buddy.resetWorkspace();},
  });
  const mcp = createMcpIntegration({
    db,
    getConfig,
    putConfig,
    getRecord,
    putRecord,
    listRecords,
    fullRecord,
    getCandidateProfile,
    getDocuments: () => [
      ...getDocuments(),
      ...(obsidian?.sourceDocuments() || []),
      ...directories.sourceDocuments(),
    ],
    buddy,
  });
  async function readBody(req) {
    if (!(req.headers["content-type"] || "").startsWith("application/json"))
      fail(415, "Send JSON content.");
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 30 * 1024 * 1024)
        fail(413, "Upload is too large. Maximum file size is 20 MB.");
      chunks.push(chunk);
    }
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (!body || Array.isArray(body) || typeof body !== "object")
        fail(400, "Expected a JSON object.");
      return body;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      fail(400, "Invalid JSON.");
    }
  }
  const json = (res, data, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  };
  const server = createServer(async (req, res) => {
    const trackedWrite = ['POST','PATCH','DELETE'].includes(req.method) || req.url?.startsWith('/api/connections/google/callback');
    if (trackedWrite) activeWrites++;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    try {
      const workspaceId=getConfig("uploadWorkspaceId");
      res.setHeader("X-Board-Workspace",workspaceId);
      const parsed = new URL(req.url, "http://localhost");
      if (['POST','PATCH','DELETE'].includes(req.method) && req.headers['x-board-workspace'] && req.headers['x-board-workspace'] !== workspaceId) fail(409,"The workspace was reset. Reload before saving changes.");
      const path = parsed.pathname;
      const method = req.method;
      if (!["GET", "HEAD", "POST", "PATCH", "DELETE"].includes(method))
        fail(405, "Method not allowed.");
      if (["POST", "PATCH", "DELETE"].includes(method) && req.headers.origin) {
        let origin;
        try {
          origin = new URL(req.headers.origin);
        } catch {
          fail(403, "Invalid request origin.");
        }
        const host = req.headers.host || "";
        const devOrigin =
          ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) &&
          ["localhost", "127.0.0.1", "[::1]"].includes(
            new URL(`http://${host}`).hostname,
          );
        const configured = (
          options.allowedOrigins ||
          process.env.BOARD_ALLOWED_ORIGINS ||
          ""
        )
          .split(",")
          .filter(Boolean);
        if (
          origin.host !== host &&
          !devOrigin &&
          !configured.includes(origin.origin)
        )
          fail(403, "Request origin is not allowed.");
      }
      if (path === "/api/health" && method === "GET")
        return json(res, { ok: true, service: "opportunity-board" });
      if (path === "/api/session" && method === "GET")
        return json(res, {
          authenticated: authCookie(req),
          setupRequired: !getConfig("auth"),
          setupTokenRequired: Boolean(setupToken),
        });
      if (
        (path === "/api/setup" || path === "/api/login") &&
        method === "POST"
      ) {
        const body = await readBody(req);
        const auth = getConfig("auth");
        const key = req.socket.remoteAddress || "unknown";
        const recent = attempts.get(key) || { count: 0, since: Date.now() };
        if (Date.now() - recent.since > 60000) {
          recent.count = 0;
          recent.since = Date.now();
        }
        recent.count++;
        attempts.set(key, recent);
        if (recent.count > 10)
          fail(429, "Too many login attempts. Try again in a minute.");
        if (path === "/api/setup") {
          if (auth)
            fail(409, "The board is already configured. Sign in instead.");
          if (
            setupToken &&
            (typeof body.token !== "string" ||
              body.token.length !== setupToken.length ||
              !timingSafeEqual(
                Buffer.from(body.token),
                Buffer.from(setupToken),
              ))
          )
            fail(
              403,
              "Open the setup link from the host launcher or enter its setup token.",
            );
          const password = cleanText(body.password, "Password", 1024);
          if (password.length < 10)
            fail(400, "Use a password with at least 10 characters.");
          const salt = randomBytes(16).toString("hex");
          putConfig("auth", {
            salt,
            hash: scryptSync(password, salt, 64).toString("hex"),
          });
        } else {
          if (!auth) fail(409, "Set up the board first.");
          const password = cleanText(body.password ?? "", "Password", 1024);
          if (
            !timingSafeEqual(
              scryptSync(password, auth.salt, 64),
              Buffer.from(auth.hash, "hex"),
            )
          )
            fail(401, "Incorrect password.");
        }
        attempts.delete(key);
        setSession(req, res);
        return json(res, { authenticated: true });
      }
      if (path === "/api/logout" && method === "POST") {
        const cookie = (req.headers.cookie || "")
          .split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith("board_session="));
        if (cookie) {
          sessions.delete(
            createHash("sha256").update(cookie.slice(14)).digest("hex"),
          );
          persistSessions();
        }
        res.setHeader(
          "Set-Cookie",
          "board_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        );
        return json(res, { authenticated: false });
      }
      if(path==="/api/connections/google/callback") {try{if(await googleDocuments.handle(path,method,req,res,{json,readBody}))return;}catch(e){if(e.status)fail(e.status,e.message);throw e;}}
      if (path.startsWith("/api/mcp/v1/")) {
        try {
          if (await mcp.handle(path, method, req, res, { json, readBody, fail }))
            return;
        } catch (e) {
          if (e.status) fail(e.status, e.message);
          throw e;
        }
      }
      if (path.startsWith("/api/")) {
        if (!authCookie(req)) fail(401, "Sign in to access your board.");
        if(reliability.applying()&&!['GET','HEAD'].includes(method)&&!path.startsWith('/api/reliability/')&&path!=='/api/logout')fail(503,"Workspace maintenance is in progress. Wait for it to finish.");
        try {if(await workspaceActions.handle(path,method,req,res,{json,readBody}))return;
        if(await mcp.handle(path,method,req,res,{json,readBody,fail}))return;
        if(await aiActivity.handle(path,method,req,res,{json,readBody}))return;
        if(await aiScheduler.handle(path,method,req,res,{json,readBody}))return;
        if(await recordImports.handle(path,method,req,res,{json,readBody}))return;
        if(await summaries.handle(path,method,req,res,{json,readBody}))return;
        if(await aiWorkflow.handle(path,method,req,res,{json,readBody}))return;
        if(await jobIntake.handle(path,method,req,res,{json,readBody}))return;
        if(await reliability.handle(path,method,req,res,{json,readBody}))return;
        if(await backupSchedule.handle(path,method,req,res,{json,readBody}))return;
        if(await feedback.handle(path,method,req,res,{json,readBody}))return;
        if(await workflow.handle(path,method,req,res,{json,readBody}))return;
        if(await packs.handle(path,method,req,res,{json,readBody}))return;
        if(await studio.handle(path,method,req,res,{json,readBody}))return;
        if(await directories.handle(path,method,req,res,{json,readBody}))return;
        if(await googleDocuments.handle(path,method,req,res,{json,readBody}))return;}catch(e){if(e.status)fail(e.status,e.message);throw e;}
        if (path === "/api/obsidian" || path.startsWith("/api/obsidian/")) {
          if (await obsidian.handle(path, method, req, res, { json, readBody }))
            return;
        }
        if (
          path.startsWith("/api/buddy/") ||
          /^\/api\/opportunities\/[^/]+\/(buddy|assistant-pack)(?:\/|$)/.test(path)
        ) {
          try {
            if (await buddy.handle(path, method, req, res, { json, readBody }))
              return;
          } catch (error) {
            if (
              Number.isInteger(error.status) &&
              error.status >= 400 &&
              error.status < 600
            )
              fail(error.status, error.message);
            throw error;
          }
        }
        if (path === "/api/job-lookup" && method === "POST") {
          const body = await readBody(req);
          const url = safeURL(body.url ?? "");
          if (!url) fail(400, "Add a job listing URL first.");
          if (activeJobLookups >= 4)
            fail(429, "Job lookups are busy. Try again shortly.");
          activeJobLookups++;
          try {
            return json(res, await lookupJob(url));
          } catch (error) {
            if ([400, 413, 415, 422, 429, 502, 504].includes(error.status))
              fail(error.status, error.message);
            throw error;
          } finally {
            activeJobLookups--;
          }
        }
        if (path === "/api/profile" && method === "GET")
          return json(res, publicProfile());
        if (path === "/api/profile/avatar" && method === "GET") {
          const image = getProfile().image;
          if (!image) fail(404, "No profile photo has been set.");
          const bytes = Buffer.from(image.base64, "base64");
          res.writeHead(200, {
            "Content-Type": image.contentType,
            "Content-Length": bytes.length,
            "Content-Disposition": "inline",
          });
          return res.end(bytes);
        }
        if (path === "/api/profile" && method === "PATCH") {
          const body = await readBody(req);
          const profile = getProfile();
          if (
            !Number.isInteger(body.revision) ||
            body.revision !== profile.revision
          )
            fail(
              409,
              "Your profile changed on another device. Reload before saving.",
            );
          if (
            Object.keys(body).some(
              (key) =>
                !["revision", "name", "imageBase64", "removeAvatar"].includes(
                  key,
                ),
            )
          )
            fail(400, "Unsupported profile setting.");
          if (body.name !== undefined) {
            profile.name = cleanText(body.name, "Name", 80);
            if (!profile.name)
              fail(400, "Enter a name between 1 and 80 characters.");
          }
          if (
            body.removeAvatar !== undefined &&
            typeof body.removeAvatar !== "boolean"
          )
            fail(400, "Remove photo must be true or false.");
          if (body.imageBase64 !== undefined && body.removeAvatar)
            fail(
              400,
              "Upload a photo or remove the current photo, not both at once.",
            );
          if (body.imageBase64 !== undefined) {
            try {
              profile.image = validateAvatar(body.imageBase64);
            } catch (error) {
              fail(error.status || 400, error.message);
            }
          }
          if (body.removeAvatar) profile.image = null;
          profile.revision++;
          putConfig("profile", profile);
          return json(res, publicProfile());
        }
        if (path === "/api/tasks" && method === "GET")
          return json(res, { tasks: listTasks() });
        if (path === "/api/tasks" && method === "POST") {
          const body = await readBody(req);
          const title = cleanText(body.title, "Task title", 300);
          if (!title) fail(400, "Enter a task title.");
          const createdAt = now();
          const task = {
            id: randomUUID(),
            title,
            notes: cleanText(
              body.notes === undefined ? "" : body.notes,
              "Task notes",
              10000,
            ),
            dueDate: dateOnly(
              body.dueDate === undefined ? "" : body.dueDate,
              "Due date",
            ),
            opportunityId: linkedOpportunity(
              body.opportunityId === undefined ? "" : body.opportunityId,
            ),
            completed: false,
            completedAt: "",
            revision: 1,
            createdAt,
            updatedAt: createdAt,
          };
          putTask(task);
          return json(res, task, 201);
        }
        const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
        if (taskMatch && method === "PATCH") {
          const body = await readBody(req);
          const task = getTask(taskMatch[1]);
          if (
            !Number.isInteger(body.revision) ||
            body.revision !== task.revision
          )
            fail(
              409,
              "This task changed on another device. Reload before saving.",
            );
          if (body.title !== undefined) {
            task.title = cleanText(body.title, "Task title", 300);
            if (!task.title) fail(400, "Enter a task title.");
          }
          if (body.notes !== undefined)
            task.notes = cleanText(body.notes, "Task notes", 10000);
          if (body.dueDate !== undefined)
            task.dueDate = dateOnly(body.dueDate, "Due date");
          if (body.opportunityId !== undefined)
            task.opportunityId = linkedOpportunity(body.opportunityId);
          if (body.completed !== undefined) {
            if (typeof body.completed !== "boolean")
              fail(400, "Task completion must be true or false.");
            if (body.completed && !task.completed) {
              task.completedAt = now();
              if (task.opportunityId) {
                try {
                  const opp = getRecord(task.opportunityId);
                  if (opp && opp.stage !== "outcome") {
                    if (
                      opp.nextAction &&
                      task.title.toLowerCase().includes(opp.nextAction.toLowerCase())
                    ) {
                      opp.nextAction = "";
                      opp.nextActionDate = "";
                      opp.revision++;
                      opp.updatedAt = now();
                      putRecord(opp);
                    }
                  }
                } catch {}
              }
            }
            if (!body.completed) task.completedAt = "";
            task.completed = body.completed;
          }
          task.revision++;
          task.updatedAt = now();
          putTask(task);
          return json(res, task);
        }
        if (path === "/api/board" && method === "GET") {
          const documents = getDocuments();
          const profile = getCandidateProfile();
          return json(res, {
            opportunities: listRecords().map((r) => fullRecord(r, profile)),
            settings: settings(),
            stages,
            profile: publicProfile(),
            tasks: listTasks(),
            documentCount: documents.length,
            referenceCount: documents.filter(
              (document) => !document.opportunityId,
            ).length,
            updateStatus: updateChecker.getStatusSync(),
          });
        }
        if (path === "/api/updates/check" && (method === "GET" || method === "POST")) {
          const status = await updateChecker.checkForUpdates(method === "POST");
          return json(res, status);
        }
        if (path === "/api/opportunities" && method === "POST") {
          try{return json(res,jobIntake.create(await readBody(req)),201);}catch(e){if(Number.isInteger(e.status)&&e.status>=400&&e.status<600)fail(e.status,e.message);throw e;}
        }
        if (path === "/api/opportunities/archive-excluded" && method === "POST") {
          const s = settings();
          const keywords = s.exclusionKeywords || [];
          if (!keywords.length) {
            return json(res, { archivedCount: 0, archivedIds: [] });
          }
          const records = listRecords().filter(
            (r) => r.stage !== "outcome" || !r.outcome,
          );
          const archivedIds = [];
          for (const record of records) {
            const matches = checkOpportunityExclusions(record, keywords);
            if (matches.length > 0) {
              record.stage = "outcome";
              record.outcome = "ignored";
              const note = `Archived automatically due to exclusion keyword${matches.length > 1 ? "s" : ""}: ${matches.join(", ")}`;
              const event = addEvent(record, { note });
              record.stageEnteredAt = event.effectiveAt;
              record.currentStageEventId = event.id;
              record.revision++;
              record.updatedAt = now();
              putRecord(record);
              archivedIds.push(record.id);
            }
          }
          return json(res, {
            archivedCount: archivedIds.length,
            archivedIds,
          });
        }
        if (path === "/api/opportunities/batch" && method === "POST") {
          const body = await readBody(req);
          if (!body || typeof body !== "object") fail(400, "Invalid batch request.");
          const ids = Array.isArray(body.ids)
            ? body.ids.filter((id) => typeof id === "string" && id.trim())
            : [];
          if (!ids.length) fail(400, "Provide at least one opportunity ID.");
          if (ids.length > 500)
            fail(400, "Cannot process more than 500 opportunities at once.");
          const action = choice(
            body.action,
            ["stage", "outcome", "add-tag", "remove-tag", "delete"],
            "action",
          );

          const updatedIds = [];
          if (action === "delete") {
            for (const id of ids) {
              try {
                const record = getRecord(id);
                db.prepare(
                  "UPDATE documents SET data = json_set(data, '$.opportunityId', null) WHERE json_extract(data, '$.opportunityId') = ?",
                ).run(record.id);
                db.prepare(
                  "DELETE FROM tasks WHERE json_extract(data, '$.opportunityId') = ?",
                ).run(record.id);
                try {
                  db.prepare(
                    "DELETE FROM decision_assessments WHERE opportunity_id = ?",
                  ).run(record.id);
                  db.prepare(
                    "DELETE FROM opportunity_automation WHERE opportunity_id = ?",
                  ).run(record.id);
                } catch {}
                db.prepare("DELETE FROM records WHERE id = ?").run(record.id);
                updatedIds.push(record.id);
              } catch {}
            }
            return json(res, {
              success: true,
              count: updatedIds.length,
              updatedIds,
            });
          }

          const s = settings();
          for (const id of ids) {
            try {
              const record = getRecord(id);
              const oldStage = record.stage;
              const oldOutcome = record.outcome;
              let changed = false;

              if (action === "stage") {
                const targetStage = choice(body.stage, stageIds, "stage");
                if (targetStage !== "outcome") {
                  record.stage = targetStage;
                  record.outcome = "";
                } else {
                  record.stage = "outcome";
                  record.outcome =
                    body.outcome && outcomes.includes(body.outcome)
                      ? body.outcome
                      : "closed";
                }
                if (oldStage !== record.stage || oldOutcome !== record.outcome) {
                  const event = addEvent(record, {
                    note: body.note || "Stage updated via bulk action",
                  });
                  record.stageEnteredAt = event.effectiveAt;
                  record.currentStageEventId = event.id;
                  if (record.stage !== "outcome") {
                    const plan = computeNextActionForStage(record.stage, {
                      today: calendarDay(new Date(), s.timezone),
                      followUpDays: s.defaultFollowUpDays,
                      role: record.role,
                      company: record.company,
                    });
                    record.nextAction = plan.nextAction;
                    record.nextActionDate = plan.nextActionDate;
                    if (s.autoGenerateTasks && plan.taskTitle) {
                      putTask({
                        id: randomUUID(),
                        title: plan.taskTitle,
                        notes: "",
                        dueDate: plan.nextActionDate,
                        completed: false,
                        opportunityId: record.id,
                        revision: 1,
                        createdAt: now(),
                        updatedAt: now(),
                      });
                    }
                  }
                  changed = true;
                }
              } else if (action === "outcome") {
                const targetOutcome = choice(
                  body.outcome,
                  ["", ...outcomes],
                  "outcome",
                );
                if (targetOutcome) {
                  record.stage = "outcome";
                  record.outcome = targetOutcome;
                } else {
                  record.outcome = "";
                  if (record.stage === "outcome") record.stage = "review";
                }
                if (oldStage !== record.stage || oldOutcome !== record.outcome) {
                  const event = addEvent(record, {
                    note: body.note || "Outcome updated via bulk action",
                  });
                  record.stageEnteredAt = event.effectiveAt;
                  record.currentStageEventId = event.id;
                  changed = true;
                }
              } else if (action === "add-tag") {
                const tag = cleanText(body.tag || "", "tag", 40);
                if (!tag) fail(400, "Tag cannot be empty.");
                if (!Array.isArray(record.tags)) record.tags = [];
                if (!record.tags.includes(tag)) {
                  record.tags.push(tag);
                  changed = true;
                }
              } else if (action === "remove-tag") {
                const tag = cleanText(body.tag || "", "tag", 40);
                if (Array.isArray(record.tags) && record.tags.includes(tag)) {
                  record.tags = record.tags.filter((t) => t !== tag);
                  changed = true;
                }
              }

              if (changed) {
                record.revision++;
                record.updatedAt = now();
                putRecord(record);
                updatedIds.push(record.id);
              }
            } catch (err) {
              // Skip invalid record ID and continue batch
            }
          }

          return json(res, {
            success: true,
            count: updatedIds.length,
            updatedIds,
          });
        }
        if (path === "/api/calendar/interviews.ics" && method === "GET") {
          const opportunities = listRecords().map(fullRecord);
          const ics = generateAllInterviewsCalendarIcs(opportunities);
          res.writeHead(200, {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": 'attachment; filename="interviews.ics"',
            "Cache-Control": "no-store",
          });
          res.end(ics);
          return;
        }
        const calendarMatch = path.match(
          /^\/api\/opportunities\/([^/]+)\/(?:calendar\.ics|activities\/([^/]+)\/calendar\.ics)$/,
        );
        if (calendarMatch && method === "GET") {
          const record = fullRecord(getRecord(calendarMatch[1]));
          let ics;
          let filename;
          if (calendarMatch[2]) {
            const act = (record.activities || []).find((a) => a.id === calendarMatch[2]);
            if (!act) fail(404, "Activity not found.");
            ics = generateSingleActivityIcs(act, record);
            if (!ics) fail(400, "Activity has no scheduled date.");
            const safeTitle = (act.title || "interview").replace(/[^a-zA-Z0-9_-]/g, "_");
            filename = `interview-${safeTitle}.ics`;
          } else {
            ics = generateOpportunityCalendarIcs(record);
            const safeCompany = (record.company || "opportunity").replace(/[^a-zA-Z0-9_-]/g, "_");
            filename = `${safeCompany}-interviews.ics`;
          }
          res.writeHead(200, {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store",
          });
          res.end(ics);
          return;
        }
        const mergeMatch = path.match(/^\/api\/opportunities\/([^/]+)\/merge$/);
        if (mergeMatch && method === "POST") {
          const body = await readBody(req);
          const targetId = mergeMatch[1];
          const duplicateId = body.duplicateId;
          if (!duplicateId || typeof duplicateId !== "string") {
            fail(400, "duplicateId is required to merge.");
          }
          if (targetId === duplicateId) {
            fail(400, "Cannot merge an opportunity with itself.");
          }
          const target = getRecord(targetId);
          const duplicate = getRecord(duplicateId);

          // Re-link documents
          db.prepare("UPDATE documents SET data = json_set(data, '$.opportunityId', ?) WHERE json_extract(data, '$.opportunityId') = ?").run(target.id, duplicate.id);
          // Re-link tasks
          db.prepare("UPDATE tasks SET data = json_set(data, '$.opportunityId', ?) WHERE json_extract(data, '$.opportunityId') = ?").run(target.id, duplicate.id);
          // Re-link decision assessments
          try {
            db.prepare("UPDATE decision_assessments SET opportunity_id = ? WHERE opportunity_id = ?").run(target.id, duplicate.id);
          } catch {}

          // Merge activities
          target.activities ||= [];
          for (const act of duplicate.activities || []) {
            if (!target.activities.some((a) => a.id === act.id)) {
              target.activities.push(act);
            }
          }

          // Merge stage events
          target.events ||= [];
          for (const ev of duplicate.events || []) {
            if (!target.events.some((e) => e.id === ev.id)) {
              target.events.push(ev);
            }
          }

          // Merge tags
          target.tags = [...new Set([...(target.tags || []), ...(duplicate.tags || [])])];

          // Fill missing text fields
          for (const key of textFields) {
            if (!target[key] && duplicate[key]) {
              target[key] = duplicate[key];
            }
          }

          // Audit event
          addEvent(target, {
            note: `Merged duplicate opportunity "${duplicate.role}" at ${duplicate.company} (${duplicate.id}).`,
            stage: target.stage,
          });

          // Delete duplicate record
          db.prepare("DELETE FROM records WHERE id = ?").run(duplicate.id);
          try {
            db.prepare("DELETE FROM opportunity_automation WHERE opportunity_id = ?").run(duplicate.id);
          } catch {}

          target.revision = (target.revision || 1) + 1;
          target.updatedAt = now();
          putRecord(target);
          return json(res, fullRecord(target));
        }
        if (path === "/api/target-companies") {
          if (method === "GET") return json(res, targetCompanies.list());
          if (method === "POST") return json(res, targetCompanies.create(await readBody(req)), 201);
          fail(405, "Method not allowed.");
        }
        const targetMatch = path.match(/^\/api\/target-companies\/([^/]+)$/);
        if (targetMatch) {
          if (method === "PATCH") return json(res, targetCompanies.update(targetMatch[1], await readBody(req)));
          if (method === "DELETE") return json(res, targetCompanies.remove(targetMatch[1]));
          fail(405, "Method not allowed.");
        }
        const summaryMatch = path.match(
          /^\/api\/opportunities\/([^/]+)\/description-summary$/,
        );
        if (summaryMatch && method === "POST") {
          const record = getRecord(summaryMatch[1]);
          if (!record.description || !record.description.trim()) {
            fail(400, "Job description is empty. Add a description in Overview first.");
          }
          const c = { ...defaultBuddy(), ...(getConfig("careerBuddy") || {}) };
          if (!c.enabled) {
            fail(
              400,
              "Career Buddy is disabled. Enable Career Buddy in Settings to generate an AI summary.",
            );
          }
          assertConfigured(c);

          const systemPrompt = `You are an expert executive career summarizer. Analyze the provided job description and produce a structured role briefing formatted in Markdown with three distinct sections:

1. **Executive Summary**: A concise summary of approximately 100 words (80–120 words) detailing the core purpose, seniority/level, and organisational context of the position.
2. **Top 5 Skills**: Exactly 5 bullet points (- ...) highlighting the most critical technical capabilities, domain expertise, tools, or qualifications required.
3. **Key Responsibilities**: Exactly 5 bullet points (- ...) highlighting the top 5 primary duties, deliverables, and operational responsibilities.

Format:
[100-word executive summary paragraph]

### Top 5 Skills
- [Skill 1]
- [Skill 2]
- [Skill 3]
- [Skill 4]
- [Skill 5]

### Key Responsibilities
- [Responsibility 1]
- [Responsibility 2]
- [Responsibility 3]
- [Responsibility 4]
- [Responsibility 5]

Strict constraints:
- Ground all skills and responsibilities strictly in the source text; never invent or extrapolate unmentioned skills, tools, or requirements.
- Do not include conversational filler, greetings, preamble, or meta-commentary (do NOT say "Here is the summary", "Summary:", etc.).
- Output ONLY the markdown text or JSON matching ${JSON.stringify(BUDDY_SCHEMA)} with changes:[], draft:{kind:"none",title:"",content:""}, sourceIds:[], and reply containing the markdown.`;

          const userPrompt = `Role: ${record.role}\nCompany: ${record.company}\n\nJob Description:\n${record.description.slice(0, 30000)}`;

          let raw = "";
          try {
            raw = await callProvider(
              c,
              systemPrompt,
              [{ role: "user", content: userPrompt }],
              options.buddyFetch,
            );
          } catch (e) {
            throw buddyError(
              e.status || 502,
              `AI provider error: ${e.message || "Failed to generate summary"}`,
            );
          }

          let summary = "";
          try {
            const parsed = parseBuddyOutput(raw, []);
            summary = parsed.reply || "";
          } catch {
            summary = String(raw || "").trim();
          }

          summary = summary
            .replace(/^```(?:markdown|text)?\s*/i, "")
            .replace(/\s*```$/, "")
            .trim();

          if (!summary) {
            fail(502, "The AI provider returned an empty summary.");
          }

          record.aiSummary = summary;
          record.aiSummaryGeneratedAt = now();
          record.revision = (record.revision || 1) + 1;
          record.updatedAt = now();
          putRecord(record);
          return json(res, fullRecord(record));
        }
        const match = path.match(
          /^\/api\/opportunities\/([^/]+)(?:\/(events|activities)(?:\/([^/]+))?)?$/,
        );
        if (match) {
          if (!match[2] && method === "GET")
            return json(res, fullRecord(getRecord(match[1])));
          if (!match[2] && method === "DELETE") {
            const record = getRecord(match[1]);
            db.prepare("UPDATE documents SET data = json_set(data, '$.opportunityId', null) WHERE json_extract(data, '$.opportunityId') = ?").run(record.id);
            db.prepare("DELETE FROM tasks WHERE json_extract(data, '$.opportunityId') = ?").run(record.id);
            try {
              db.prepare("DELETE FROM decision_assessments WHERE opportunity_id = ?").run(record.id);
              db.prepare("DELETE FROM opportunity_automation WHERE opportunity_id = ?").run(record.id);
            } catch {}
            db.prepare("DELETE FROM records WHERE id = ?").run(record.id);
            return json(res, { deleted: true, id: record.id });
          }
          const body = await readBody(req);
          const record = getRecord(match[1]);
          if (!match[2] && method === "PATCH") {
            requireRevision(body, record);
            const oldStage = record.stage;
            const oldOutcome = record.outcome;
            const oldCompany = record.company;
            const oldRole = record.role;
            for (const key of textFields)
              if (body[key] !== undefined)
                record[key] = cleanText(
                  body[key],
                  key,
                  key === "description" ? 200000 : 10000,
                );
            if (!record.role || !record.company)
              fail(400, "Employer and role are required.");
            record.url = safeURL(record.url);
            if (body.deadline !== undefined) {
              if (record.deadline) {
                if (/^\d{4}-\d{2}-\d{2}$/.test(record.deadline)) {
                  dateOnly(record.deadline, "Deadline");
                } else {
                  if (!record.description.includes(record.deadline)) {
                    record.description = (record.description ? record.description + "\n\n" : "") + `Deadline: ${record.deadline}`;
                  }
                  record.deadline = "";
                }
              }
            }
            if (body.nextActionDate !== undefined) {
              if (record.nextActionDate) {
                if (/^\d{4}-\d{2}-\d{2}$/.test(record.nextActionDate)) {
                  dateOnly(record.nextActionDate, "Next action date");
                } else {
                  if (!record.description.includes(record.nextActionDate)) {
                    record.description = (record.description ? record.description + "\n\n" : "") + `Next action date: ${record.nextActionDate}`;
                  }
                  record.nextActionDate = "";
                }
              }
            }
            if (body.priority !== undefined)
              record.priority = choice(
                body.priority,
                ["normal", "high", "low"],
                "priority",
              );
            if (body.tags !== undefined) {
              if (!Array.isArray(body.tags) || body.tags.length > 30)
                fail(400, "Tags must be a list of up to 30 items.");
              record.tags = body.tags.map((t) => cleanText(t, "Tag", 100));
            }
            if (body.seniority !== undefined) {
              record.seniority = body.seniority
                ? choice(
                    body.seniority,
                    ["entry", "mid", "senior", "lead", "director", "executive"],
                    "seniority",
                  )
                : classifySeniority(record.role, record.description);
            }
            if (body.stage !== undefined)
              record.stage = choice(body.stage, stageIds, "stage");
            if (body.outcome !== undefined)
              record.outcome = choice(
                body.outcome,
                ["", ...outcomes],
                "outcome",
              );
            if (body.stage && body.stage !== "outcome") record.outcome = "";
            if (record.outcome) record.stage = "outcome";
            if (record.stage === "outcome" && !record.outcome)
              fail(400, "Choose an outcome.");
            if (oldStage !== record.stage || oldOutcome !== record.outcome) {
              const event = addEvent(record, body);
              record.stageEnteredAt = event.effectiveAt;
              record.currentStageEventId = event.id;
              if (body.nextAction === undefined && record.stage !== "outcome") {
                const s = settings();
                const plan = computeNextActionForStage(record.stage, {
                  today: calendarDay(new Date(), s.timezone),
                  followUpDays: s.defaultFollowUpDays,
                  role: record.role,
                  company: record.company,
                });
                record.nextAction = plan.nextAction;
                record.nextActionDate = plan.nextActionDate;
                if (s.autoGenerateTasks && plan.taskTitle) {
                  putTask({
                    id: randomUUID(),
                    title: plan.taskTitle,
                    notes: "",
                    dueDate: plan.nextActionDate,
                    completed: false,
                    opportunityId: record.id,
                    revision: 1,
                    createdAt: now(),
                    updatedAt: now(),
                    completedAt: "",
                  });
                }
              } else if (record.stage === "outcome") {
                record.nextAction = "";
                record.nextActionDate = "";
              }
            }
            if (record.company !== oldCompany || record.role !== oldRole) {
              const s = settings();
              const isCustomExport = Boolean(s.exportsPath && isAbsolute(s.exportsPath));
              const exportRoot = isCustomExport ? resolve(s.exportsPath) : filesDir;
              try {
                if (isCustomExport) {
                  folder(exportRoot, opportunityFolderPath(record));
                } else {
                  folder(filesDir, join(s.documentsSubdir, opportunityFolderPath(record)));
                }
              } catch {}
              try {
                const oppDocs = getDocuments().filter((d) => d.opportunityId === record.id);
                for (const doc of oppDocs) {
                  const root = doc.storageRoot && existsSync(doc.storageRoot) ? doc.storageRoot : exportRoot;
                  const folderPath = opportunityFolderPath(record);
                  const ext = (doc.name ? extname(doc.name) : "").replace(/[^.a-zA-Z0-9]/g, "");
                  const baseName = doc.name ? doc.name.replace(/[/\\]/g, "-").replace(extname(doc.name), "").trim() : "";
                  const fileName = baseName ? `${baseName}${ext}` : `${doc.id}${ext}`;
                  let targetRelPath = root === filesDir
                    ? buildOpportunityDocumentPath({
                        documentsSubdir: s.documentsSubdir,
                        opportunity: record,
                        documentId: doc.id,
                        name: doc.name,
                        kind: doc.kind,
                        status: doc.status,
                        category: doc.category,
                      })
                    : `${folderPath}/${fileName}`;
                  if (doc.relativePath === targetRelPath) continue;
                  const source = documentPath(doc);
                  if (!existsSync(source)) continue;
                  let target = safePath(root, targetRelPath);
                  if (existsSync(target) && target !== source) {
                    const disambiguated = baseName ? `${baseName}-${doc.id.slice(0, 8)}${ext}` : `${doc.id}${ext}`;
                    targetRelPath = root === filesDir
                      ? `${s.documentsSubdir}/${folderPath}/${disambiguated}`
                      : `${folderPath}/${disambiguated}`;
                    target = safePath(root, targetRelPath);
                  }
                  folder(root, dirname(targetRelPath));
                  copyFileSync(source, target);
                  unlinkSync(source);
                  pruneEmptyParents(dirname(source), root === filesDir ? join(filesDir, s.documentsSubdir) : root);
                  doc.relativePath = targetRelPath;
                  putDocument(doc);
                }
              } catch {}
            }
            return json(res, changed(record));
          }
          if (match[2] === "events") {
            if (method === "POST" && !match[3]) {
              addEvent(record, body, body.stage ?? record.stage);
              return json(res, changed(record));
            }
            if (method === "PATCH" && match[3]) {
              requireRevision(body, record);
              const event = record.events.find((e) => e.id === match[3]);
              if (!event) fail(404, "Timeline entry not found.");
              const wasCurrentStageDate =
                record.currentStageEventId === event.id;
              event.corrections ||= [];
              event.corrections.push({
                effectiveAt: event.effectiveAt,
                note: event.note,
                correctedAt: now(),
              });
              if (body.effectiveAt !== undefined)
                event.effectiveAt = /^\d{4}-\d{2}-\d{2}$/.test(body.effectiveAt)
                  ? dateOnly(body.effectiveAt, "Effective date")
                  : timestamp(body.effectiveAt, "Effective date");
              if (body.note !== undefined)
                event.note = cleanText(body.note, "Note", 50000);
              // Date correction of the most recent transition updates current stage date.
              if (wasCurrentStageDate)
                record.stageEnteredAt = event.effectiveAt;
              return json(res, changed(record));
            }
          }
          if (match[2] === "activities") {
            let activity;
            if (method === "POST" && !match[3])
              activity = {
                id: randomUUID(),
                kind: "interview",
                type: "video",
                title: "",
                scheduledAt: "",
                status: "planned",
                notes: "",
                contact: "",
                isFinal: false,
                createdAt: now(),
                history: [],
                direction: "",
                channel: "",
                followUp: "",
                followUpDate: "",
                followUpDone: false,
                documentIds: [],
              };
            else if (method === "PATCH" && match[3]) {
              requireRevision(body, record);
              activity = record.activities.find((a) => a.id === match[3]);
              if (!activity) fail(404, "Activity not found.");
              activity.history ||= [];
              const { history, ...previous } = structuredClone(activity);
              activity.history.push({ ...previous, changedAt: now() });
            } else fail(405, "Method not allowed.");
            for (const key of ["title", "notes", "contact", "followUp"])
              if (body[key] !== undefined)
                activity[key] = cleanText(body[key], key, 50000);
            if (!activity.title) fail(400, "Activity title is required.");
            if (body.kind !== undefined)
              activity.kind = choice(
                body.kind,
                ["interview", "communication"],
                "activity kind",
              );
            if (body.type !== undefined) {
              activity.type = cleanText(body.type, "Activity type", 100);
              if (!activity.type) fail(400, "Activity type is required.");
            }
            if (body.direction !== undefined)
              activity.direction = choice(
                body.direction,
                ["", "incoming", "outgoing"],
                "communication direction",
              );
            if (body.channel !== undefined)
              activity.channel = cleanText(body.channel, "Communication channel", 100);
            if (body.followUpDate !== undefined)
              activity.followUpDate = dateOnly(body.followUpDate, "Follow-up date");
            if (body.followUpDone !== undefined) {
              if (typeof body.followUpDone !== "boolean")
                fail(400, "Follow-up completed must be true or false.");
              activity.followUpDone = body.followUpDone;
            }
            if (activity.followUpDate && !activity.followUp)
              fail(400, "Describe the follow-up before setting its date.");
            if (body.documentIds !== undefined) {
              const ids = body.documentIds;
              if (
                !Array.isArray(ids) ||
                ids.length > 100 ||
                ids.some((id) => typeof id !== "string") ||
                new Set(ids).size !== ids.length
              )
                fail(400, "Choose up to 100 distinct attachments.");
              const documents = getDocuments();
              for (const id of ids) {
                const doc = documents.find((d) => d.id === id);
                if (!doc && activity.documentIds?.includes(id)) continue; // Retain a visibly unavailable old link.
                if (!doc || doc.opportunityId !== record.id)
                  fail(400, "Attachments must belong to this opportunity.");
              }
              activity.documentIds = [...ids];
            }
            if (body.status !== undefined)
              activity.status = choice(
                body.status,
                ["planned", "rescheduled", "completed", "cancelled"],
                "activity status",
              );
            if (body.scheduledAt !== undefined)
              activity.scheduledAt = body.scheduledAt
                ? /^\d{4}-\d{2}-\d{2}$/.test(body.scheduledAt)
                  ? dateOnly(body.scheduledAt, "Scheduled date")
                  : timestamp(body.scheduledAt, "Scheduled date")
                : "";
            if (body.isFinal !== undefined) {
              if (typeof body.isFinal !== "boolean")
                fail(400, "Final interview must be true or false.");
              activity.isFinal = body.isFinal;
            }
            if (method === "POST") record.activities.push(activity);
            if (activity.kind === "interview" && activity.status !== "cancelled") {
              const targetStage = activity.isFinal ? "final-interview" : "interviews";
              const reason = activity.isFinal ? "Final interview scheduled" : "Interview scheduled";
              autoAdvanceOpportunity(record, targetStage, reason);
            }
            return json(res, changed(record));
          }
          fail(405, "Method not allowed.");
        }
        if (path === "/api/uploads/workspace" && method === "GET") {
          let id=getConfig("uploadWorkspaceId");if(!id){id=randomUUID();putConfig("uploadWorkspaceId",id);}return json(res,{id});
        }
        if (path === "/api/documents" && method === "GET")
          return json(res, { documents: getDocuments().map(publicDocument) });
        if (path === "/api/documents/refresh" && method === "POST") {
          const result = { checked: 0, missing: 0, changed: 0, added: 0, unavailable: 0 };
          const docs = getDocuments().filter(d => !d.opportunityId);
          for (const doc of docs) {
            result.checked++;
            try {
              const file = documentPath(doc), st = statSync(file);
              if (!st.isFile()) throw new Error("Document path is not a file.");
              const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
              // Submitted snapshots must never be silently accepted as changed originals.
              const changed = hash !== doc.sha256;
              const storageState = changed && doc.status === "submitted" ? "changed" : "available";
              if (changed) result.changed++;
              if (changed || (doc.storageState && doc.storageState !== storageState)) {
                putDocument({ ...doc, storageState, ...(doc.status !== "submitted" ? { sha256: hash, size: st.size } : {}), revision: (doc.revision || 1) + 1 });
                if (changed) db.prepare("DELETE FROM document_text WHERE id=?").run(doc.id);
              }
            } catch (error) {
              // A detached drive or permission failure is different from a deleted file.
              const missing = error.code === "ENOENT" && existsSync(doc.storageRoot);
              const storageState = missing ? "missing" : "unavailable";
              result[missing ? "missing" : "unavailable"]++;
              if (doc.storageState !== storageState) putDocument({ ...doc, storageState, revision: (doc.revision || 1) + 1 });
              db.prepare("DELETE FROM document_text WHERE id=?").run(doc.id);
            }
          }
          const tracked = new Set(getDocuments().filter(d => resolve(d.storageRoot) === filesDir).map(d => d.relativePath));
          const library = settings().referenceSubdir;
          const privateRoots = [settings().documentsSubdir, settings().backupSubdir].map(p => resolve(filesDir, p));
          if (settings().exportsPath) privateRoots.push(resolve(settings().exportsPath));
          // Only discover inside the managed library. Application exports and backups stay private.
          function scan(subdir, depth = 0) {
            if (depth > 20 || result.added >= 500 || privateRoots.some(root => inside(root, resolve(filesDir, subdir)))) return;
            let entries;
            try { entries = readdirSync(safePath(filesDir, subdir), { withFileTypes: true }); } catch { return; }
            for (const entry of entries) {
              if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
              const path = subdir + "/" + entry.name;
              if (entry.isDirectory()) { scan(path, depth + 1); continue; }
              if (!entry.isFile() || tracked.has(path) || result.added >= 500) continue;
              try {
                const file = safePath(filesDir, path), st = statSync(file);
                if (st.size > 20 * 1024 * 1024) continue;
                const name = cleanDocumentName(path.slice(library.length + 1), true);
                const classification = inferDocumentClassification({ name });
                putDocument({ id: randomUUID(), name, ...classification, opportunityId: "", status: "", createdAt: now(), size: st.size, version: 1, revision: 1, notes: "", storageRoot: filesDir, relativePath: path, storageState: "available", sha256: createHash("sha256").update(readFileSync(file)).digest("hex") });
                tracked.add(path); result.added++;
              } catch { /* Leave unreadable files untouched. */ }
            }
          }
          scan(library);
          return json(res, result);
        }
        if (path === "/api/documents" && method === "DELETE") {
          const scope = parsed.searchParams.get("scope") || "library";
          const opportunityId =
            parsed.searchParams.get("opportunityId")?.trim() || "";
          if (scope !== "library" && !opportunityId)
            fail(
              400,
              "Specify scope=library or an opportunityId for bulk document deletion.",
            );
          const folderFilter = parsed.searchParams.get("folder");
          const tagFilter = parsed.searchParams.get("tag")?.trim() || "";
          const idsParam = parsed.searchParams.get("ids")?.trim() || "";
          const idSet = idsParam
            ? new Set(
                idsParam
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            : null;
          const matching = getDocuments().filter((d) => {
            if (
              opportunityId
                ? d.opportunityId !== opportunityId
                : d.opportunityId
            )
              return false;
            if (idSet && !idSet.has(d.id)) return false;
            if (folderFilter !== null) {
              const idx = d.name.lastIndexOf("/");
              const docFolder = idx > 0 ? d.name.slice(0, idx) : "__root__";
              if (
                docFolder !== folderFilter &&
                (folderFilter === "__root__" ||
                  !d.name.startsWith(`${folderFilter}/`))
              )
                return false;
            }
            if (tagFilter) {
              const tags = Array.isArray(d.tags)
                ? d.tags
                : inferDocumentTags(d.name || "", d.kind || "");
              if (
                !tags.some((t) => t.toLowerCase() === tagFilter.toLowerCase())
              )
                return false;
            }
            return true;
          });
          const removable = matching.filter((d) => d.status !== "submitted");
          for (const doc of removable) removeDocument(doc);
          return json(res, {
            ok: true,
            deletedCount: removable.length,
            preservedSubmittedCount: matching.length - removable.length,
          });
        }
        if (path === "/api/documents" && method === "POST") {
          const body = await readBody(req);
          const opportunityId = body.opportunityId
            ? cleanText(body.opportunityId, "Opportunity ID", 100)
            : "";
          if (opportunityId) getRecord(opportunityId);
          const name = cleanDocumentName(body.name, true);
          const inferred = inferDocumentClassification({ name, kind: body.kind, category: body.category, opportunityId });
          const kind = choice(
            body.kind ?? inferred.kind,
            ["jd", "cv", "cover", "reference", "other"],
            "document kind",
          );
          const status = choice(
            body.status ?? "",
            ["", "draft", "approved", "submitted"],
            "document status",
          );
          if (
            typeof body.contentBase64 !== "string" ||
            body.contentBase64.length % 4 !== 0 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(body.contentBase64)
          )
            fail(400, "Invalid document data.");
          const content = Buffer.from(body.contentBase64, "base64");
          if (content.length > 20 * 1024 * 1024)
            fail(413, "Maximum file size is 20 MB.");
          const importRequestId = body.importRequestId == null ? "" : cleanText(body.importRequestId, "Import request ID", 100);
          if (importRequestId) {
            if (!/^[a-zA-Z0-9-]{16,100}$/.test(importRequestId)) fail(400, "Invalid import request ID.");
            const existing = getDocuments().find((d) => d.importRequestId === importRequestId);
            if (existing) {
              const hash = createHash("sha256").update(content).digest("hex");
              if (existing.sha256 !== hash || existing.name !== name || existing.opportunityId !== opportunityId || existing.kind !== kind || existing.status !== status || existing.category !== inferred.category) fail(409, "Import request ID was already used for a different document.");
              return json(res, publicDocument(existing), 200);
            }
          }
          const document = saveDocument({
            name,
            kind,
            status,
            opportunityId,
            importRequestId,
            content,
            notes: cleanText(body.notes ?? "", "Notes", 50000),
            tags: body.tags,
            category:inferred.category,
          });
          return json(res, document, 201);
        }
        if(path==='/api/documents/categories'&&method==='POST'){
          const b=await readBody(req),category=validateCategory(b.category);
          if(!Array.isArray(b.documents)||!b.documents.length||b.documents.length>500||new Set(b.documents.map(d=>d?.id)).size!==b.documents.length)fail(400,'Choose 1 to 500 distinct documents.');
          const all=getDocuments(),changed=b.documents.map(item=>{const doc=all.find(d=>d.id===item?.id);if(!doc)fail(404,'A document is no longer available.');if(item.revision!==(doc.revision??1))fail(409,'A selected document changed. Reload before categorising.');return {...doc,category,revision:(doc.revision??1)+1};});
          db.exec('BEGIN');try{for(const d of changed)putDocument(d);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
          return json(res,{documents:changed.map(publicDocument)});
        }
        if (path === "/api/documents/move" && method === "POST") {
          const body = await readBody(req);
          if (
            !Array.isArray(body.documents) ||
            !body.documents.length ||
            body.documents.length > 500
          )
            fail(400, "Select between 1 and 500 library documents.");
          if (
            Object.keys(body).some(
              (key) => !["documents", "folder"].includes(key),
            )
          )
            fail(400, "Unsupported move option.");
          const rawFolder = cleanText(
            body.folder ?? "",
            "Destination folder",
            480,
          ).replace(/\\/g, "/");
          const destinationFolder = rawFolder
            ? cleanDocumentName(rawFolder + "/placeholder", true).slice(0, -12)
            : "";
          const seen = new Set();
          const allDocs = getDocuments();
          const planned = body.documents.map((item) => {
            if (
              !item ||
              typeof item !== "object" ||
              typeof item.id !== "string" ||
              !Number.isInteger(item.revision) ||
              Object.keys(item).some((k) => !["id", "revision"].includes(k)) ||
              seen.has(item.id)
            )
              fail(400, "Choose each document once with its current revision.");
            seen.add(item.id);
            const doc = getDocument(item.id);
            if (doc.opportunityId)
              fail(400, "Only Career Library documents can be moved here.");
            if (doc.status === "submitted")
              fail(
                409,
                "Submitted versions are preserved and cannot be moved.",
              );
            if (doc.revision !== item.revision)
              fail(
                409,
                "A document changed. Reload the library before moving it.",
              );
            const source = documentPath(doc);
            try {
              if (!statSync(source).isFile()) throw Error("not a file");
            } catch {
              fail(404, "A source file is unavailable. No files were moved.");
            }
            const filename = doc.name.split("/").pop();
            const name = cleanDocumentName(
              destinationFolder ? destinationFolder + "/" + filename : filename,
              true,
            );
            const subdir =
              settings().referenceSubdir +
              (destinationFolder ? "/" + destinationFolder : "");
            const relativePath =
              subdir +
              "/" +
              doc.id +
              extname(doc.relativePath).replace(/[^.a-zA-Z0-9]/g, "");
            return {
              doc,
              source,
              name,
              subdir,
              relativePath,
            };
          });
          const created = [];
          try {
            for (const item of planned) {
              folder(filesDir, item.subdir);
              item.target = safePath(filesDir, item.relativePath);
              if (resolve(item.source) === resolve(item.target)) continue;
              const bytes = readFileSync(item.source);
              item.sourceHash = createHash("sha256")
                .update(bytes)
                .digest("hex");
              let fd;
              try {
                fd = openSync(item.target, "wx", 0o600);
              } catch (error) {
                if (error.code === "EEXIST")
                  fail(
                    409,
                    "A destination file already exists. No files were moved.",
                  );
                throw error;
              }
              created.push(item.target);
              try {
                writeFileSync(fd, bytes);
                fsyncSync(fd);
              } finally {
                closeSync(fd);
              }
            }
            db.exec("BEGIN IMMEDIATE");
            try {
              for (const item of planned)
                putDocument({
                  ...item.doc,
                  name: item.name,
                  storageRoot: filesDir,
                  relativePath: item.relativePath,
                  revision: item.doc.revision + 1,
                });
              db.exec("COMMIT");
            } catch (error) {
              db.exec("ROLLBACK");
              throw error;
            }
          } catch (error) {
            for (const file of created)
              try {
                unlinkSync(file);
              } catch {}
            if (error instanceof HttpError) throw error;
            fail(
              500,
              "The move could not be completed. The original files were retained.",
            );
          }
          let retained = 0;
          for (const item of planned) {
            if (resolve(item.source) === resolve(item.target)) continue;
            const shared = allDocs.some(
              (d) =>
                !seen.has(d.id) &&
                d.storageRoot === item.doc.storageRoot &&
                d.relativePath === item.doc.relativePath,
            );
            if (shared || resolve(item.doc.storageRoot) !== resolve(filesDir)) {
              retained++;
              continue;
            }
            try {
              const current = readFileSync(item.source);
              if (
                createHash("sha256").update(current).digest("hex") !==
                item.sourceHash
              ) {
                retained++;
                continue;
              }
              unlinkSync(item.source);
            } catch {
              retained++;
            }
          }
          return json(res, {
            documents: planned.map((item) =>
              publicDocument(getDocument(item.doc.id)),
            ),
            retainedOriginals: retained,
          });
        }
        const organizeMatch = path.match(/^\/api\/opportunities\/([^/]+)\/organize-folders$/);
        if (organizeMatch && method === "POST") {
          const opportunity = getRecord(organizeMatch[1]);
          const allDocs = getDocuments();
          const oppDocs = allDocs.filter((d) => d.opportunityId === opportunity.id);
          const planned = [];
          for (const doc of oppDocs) {
            let targetRelPath = buildOpportunityDocumentPath({
              documentsSubdir: settings().documentsSubdir,
              opportunity,
              documentId: doc.id,
              name: doc.name,
              kind: doc.kind,
              status: doc.status,
              category: doc.category,
            });
            if (doc.relativePath === targetRelPath) continue;
            const source = documentPath(doc);
            try {
              if (!statSync(source).isFile()) throw Error("not a file");
            } catch {
              fail(404, `Document file for ${doc.name} is unavailable.`);
            }
            const checkTarget = safePath(filesDir, targetRelPath);
            if (
              resolve(source) !== resolve(checkTarget) &&
              (existsSync(checkTarget) || planned.some((p) => p.targetRelPath === targetRelPath))
            ) {
              const ext = extname(targetRelPath);
              const base = targetRelPath.slice(0, targetRelPath.length - ext.length);
              targetRelPath = `${base}-${doc.id.slice(0, 8)}${ext}`;
            }
            if (doc.relativePath === targetRelPath) continue;
            planned.push({
              doc,
              source,
              targetRelPath,
              targetDir: dirname(targetRelPath),
            });
          }
          if (!planned.length) {
            return json(res, {
              organizedCount: 0,
              documents: oppDocs.map(publicDocument),
            });
          }
          const created = [];
          try {
            for (const item of planned) {
              folder(filesDir, item.targetDir);
              item.target = safePath(filesDir, item.targetRelPath);
              if (resolve(item.source) === resolve(item.target)) continue;
              const bytes = readFileSync(item.source);
              item.sourceHash = createHash("sha256").update(bytes).digest("hex");
              let fd;
              try {
                fd = openSync(item.target, "wx", 0o600);
              } catch (error) {
                if (error.code === "EEXIST")
                  fail(409, "A destination file already exists. Folder organization aborted.");
                throw error;
              }
              created.push(item.target);
              try {
                writeFileSync(fd, bytes);
                fsyncSync(fd);
              } finally {
                closeSync(fd);
              }
            }
            db.exec("BEGIN IMMEDIATE");
            try {
              for (const item of planned) {
                putDocument({
                  ...item.doc,
                  storageRoot: filesDir,
                  relativePath: item.targetRelPath,
                  revision: (item.doc.revision || 1) + 1,
                });
              }
              db.exec("COMMIT");
            } catch (error) {
              db.exec("ROLLBACK");
              throw error;
            }
          } catch (error) {
            for (const file of created) {
              try { unlinkSync(file); } catch {}
            }
            if (error instanceof HttpError) throw error;
            fail(500, "Folder organization could not be completed. Original files were retained.");
          }
          let removed = 0;
          for (const item of planned) {
            if (resolve(item.source) === resolve(item.target)) continue;
            const shared = allDocs.some(
              (d) =>
                d.id !== item.doc.id &&
                d.storageRoot === item.doc.storageRoot &&
                d.relativePath === item.doc.relativePath,
            );
            if (shared || realpathSync(item.doc.storageRoot) !== realpathSync(filesDir)) continue;
            try {
              const current = readFileSync(item.source);
              if (createHash("sha256").update(current).digest("hex") === item.sourceHash) {
                unlinkSync(item.source);
                removed++;
                pruneEmptyParents(dirname(item.source), join(filesDir, settings().documentsSubdir));
              }
            } catch {}
          }
          const updatedDocs = getDocuments().filter((d) => d.opportunityId === opportunity.id);
          return json(res, {
            organizedCount: planned.length,
            retainedOriginals: planned.length - removed,
            documents: updatedDocs.map(publicDocument),
          });
        }
        const docMatch = path.match(/^\/api\/documents\/([^/]+)(?:\/(content|duplicate|reference))?$/);
        if (docMatch) {
          const doc = getDocument(docMatch[1]);
          if (docMatch[2] === "content" && method === "GET") {
            let file;
            try {
              file = documentPath(doc);
              if (!statSync(file).isFile())
                fail(404, "Document file is unavailable.");
            } catch (error) {
              if (error instanceof HttpError) throw error;
              fail(
                404,
                "Document file is unavailable. Check its storage location.",
              );
            }
            const content = readFileSync(file);
            const ext = extname(doc.name).toLowerCase();
            res.writeHead(200, {
              "Content-Type":
                ext === ".pdf"
                  ? "application/pdf"
                  : ext === ".md" || ext === ".markdown"
                  ? "text/markdown; charset=utf-8"
                  : ext === ".txt"
                  ? "text/plain; charset=utf-8"
                  : "application/octet-stream",
              "Content-Length": content.length,
              "Content-Disposition": `attachment; filename="${(doc.name.split("/").pop() || doc.name).replace(/[^a-zA-Z0-9._ -]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(doc.name.split("/").pop() || doc.name)}`,
            });
            return res.end(content);
          }
          if (docMatch[2] === "reference" && method === "POST") {
            const body = await readBody(req);
            if (body.revision !== doc.revision) fail(409, "Document changed. Refresh before saving a reference.");
            if (!doc.opportunityId || !["cv", "cover"].includes(doc.kind)) fail(400, "Choose an opportunity CV or cover letter.");
            const existing = getDocuments().find(d => d.referenceSourceId === doc.id);
            if (existing) return json(res, publicDocument(existing));
            const saved = saveDocument({ name: doc.name.split("/").pop(), kind: doc.kind, category: doc.kind === "cv" ? "reference-cv" : "reference-cover", status: "approved", opportunityId: "", content: readFileSync(documentPath(doc)), notes: doc.notes || "", tags: doc.tags });
            const reference = { ...getDocument(saved.id), referenceSourceId: doc.id };
            putDocument(reference);
            return json(res, publicDocument(reference), 201);
          }
          if (docMatch[2] === "duplicate" && method === "POST") {
            const body = req.headers["content-type"] ? await readBody(req) : {};
            if (body.revision !== undefined && body.revision !== doc.revision) fail(409, "Document changed. Refresh before copying.");
            const bytes = readFileSync(documentPath(doc));
            const oldName = doc.name;
            const dotIdx = oldName.lastIndexOf(".");
            const ext = dotIdx > 0 ? oldName.slice(dotIdx) : "";
            const baseName = dotIdx > 0 ? oldName.slice(0, dotIdx) : oldName;
            const newName = body.name === undefined ? cleanDocumentName(`${baseName} (copy)${ext}`, true) : cleanDocumentName(body.name, true);
            if (extname(newName).toLowerCase() !== extname(oldName).toLowerCase()) fail(400, "Document extension cannot be changed.");
            const duplicated = saveDocument({
              name: newName,
              kind: doc.kind,
              category: body.category === undefined ? doc.category : validateCategory(body.category),
              status: doc.status === "submitted" ? "draft" : (doc.status || "draft"),
              opportunityId: doc.opportunityId || "",
              content: bytes,
              notes: doc.notes || "",
              tags: Array.isArray(doc.tags) ? [...doc.tags] : undefined,
            });
            return json(res, publicDocument(duplicated), 201);
          }
          if (!docMatch[2] && method === "PATCH") {
            const body = await readBody(req);
            if (body.revision !== undefined && body.revision !== doc.revision)
              fail(409, "Document changed. Reload before saving.");
            if (
              Object.keys(body).some(
                (key) => !["status", "tags", "notes", "revision", "category", "name"].includes(key),
              )
            )
              fail(
                400,
                "Document contents cannot be overwritten. Upload a new version.",
              );
            if (doc.status === "submitted" && (body.status !== undefined || body.name !== undefined))
              fail(
                409,
                "Submitted document versions are preserved. Upload a new version to make changes.",
              );
            if (body.name !== undefined) {
              const cleanName = cleanDocumentName(body.name, true);
              const oldExt = extname(doc.name).toLowerCase();
              const newExt = extname(cleanName).toLowerCase();
              if (oldExt !== newExt) fail(400, "Document extension cannot be changed.");
              doc.name = cleanName;
            }
            if (body.status !== undefined)
              doc.status = choice(
                body.status,
                ["", "draft", "approved", "submitted"],
                "document status",
              );
            if(body.category!==undefined)doc.category=validateCategory(body.category);
            if (body.tags !== undefined)
              doc.tags = cleanDocumentTags(body.tags);
            if (body.notes !== undefined)
              doc.notes = cleanText(body.notes, "Notes", 50000);
            doc.revision++;
            putDocument(doc);
            return json(res, publicDocument(doc));
          }
          if (!docMatch[2] && method === "DELETE") {
            if (doc.status === "submitted")
              fail(
                409,
                "Submitted document versions are preserved and cannot be deleted.",
              );
            removeDocument(doc);
            return json(res, { ok: true, id: doc.id });
          }
          fail(405, "Method not allowed.");
        }
        if (path === "/api/system/folders" && method === "GET") {
          const query = new URL(req.url, "http://board").searchParams;
          const requestedPath = query.get("path");
          const home = homedir();
          let currentPath = requestedPath
            ? resolve(requestedPath)
            : (settings().exportsPath || home);
          let notFound = false;
          if (requestedPath) {
            try {
              if (!existsSync(currentPath) || !statSync(currentPath).isDirectory()) {
                notFound = true;
                currentPath = home;
              }
            } catch {
              notFound = true;
              currentPath = home;
            }
          } else {
            try {
              if (!existsSync(currentPath) || !statSync(currentPath).isDirectory()) {
                currentPath = home;
              }
            } catch {
              currentPath = home;
            }
          }

          let isWritable = false;
          try {
            accessSync(currentPath, constants.W_OK);
            isWritable = true;
          } catch {
            isWritable = false;
          }

          let folders = [];
          try {
            const entries = readdirSync(currentPath, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.name.startsWith(".")) continue;
              if (["node_modules", ".git", ".Trashes", "Library"].includes(entry.name)) continue;
              if (entry.name.startsWith("com.apple.TimeMachine")) continue;
              let isDir = false;
              if (entry.isDirectory()) {
                isDir = true;
              } else if (entry.isSymbolicLink()) {
                try {
                  const targetStat = statSync(join(currentPath, entry.name));
                  if (targetStat.isDirectory()) isDir = true;
                } catch {}
              }
              if (isDir) {
                folders.push({
                  name: entry.name,
                  path: join(currentPath, entry.name),
                });
              }
            }
            folders.sort((a, b) => a.name.localeCompare(b.name));
          } catch {}

          const volumes = [];
          if (existsSync("/Volumes")) {
            try {
              const entries = readdirSync("/Volumes", { withFileTypes: true });
              for (const entry of entries) {
                if (entry.name.startsWith(".") || entry.name.startsWith("com.apple.TimeMachine")) continue;
                const full = join("/Volumes", entry.name);
                try {
                  const st = statSync(full);
                  if (st.isDirectory()) {
                    volumes.push({ name: entry.name, path: full });
                  }
                } catch {}
              }
            } catch {}
          }
          for (const linuxMount of ["/media", "/mnt"]) {
            if (existsSync(linuxMount)) {
              try {
                const entries = readdirSync(linuxMount, { withFileTypes: true });
                for (const entry of entries) {
                  if (entry.name.startsWith(".")) continue;
                  const full = join(linuxMount, entry.name);
                  try {
                    const st = statSync(full);
                    if (st.isDirectory()) {
                      if (linuxMount === "/media") {
                        try {
                          const subEntries = readdirSync(full, { withFileTypes: true });
                          let hasSub = false;
                          for (const sub of subEntries) {
                            if (sub.name.startsWith(".")) continue;
                            const subFull = join(full, sub.name);
                            try {
                              const subSt = statSync(subFull);
                              if (subSt.isDirectory()) {
                                volumes.push({ name: `${entry.name}/${sub.name}`, path: subFull });
                                hasSub = true;
                              }
                            } catch {}
                          }
                          if (!hasSub) volumes.push({ name: entry.name, path: full });
                        } catch {
                          volumes.push({ name: entry.name, path: full });
                        }
                      } else {
                        volumes.push({ name: entry.name, path: full });
                      }
                    }
                  } catch {}
                }
              } catch {}
            }
          }
          volumes.sort((a, b) => a.name.localeCompare(b.name));

          const presets = [
            { label: "Home", path: home },
            ...(existsSync(join(home, "Documents"))
              ? [{ label: "Documents", path: join(home, "Documents") }]
              : []),
            ...(existsSync(join(home, "Desktop"))
              ? [{ label: "Desktop", path: join(home, "Desktop") }]
              : []),
            ...(existsSync(join(home, "Downloads"))
              ? [{ label: "Downloads", path: join(home, "Downloads") }]
              : []),
            ...(existsSync("/Volumes") ? [{ label: "Volumes", path: "/Volumes" }] : []),
            ...volumes.map((v) => ({ label: `Volume: ${v.name}`, path: v.path })),
            {
              label: "Document workspace",
              path: join(filesDir, settings().documentsSubdir || "opportunities"),
            },
          ];

          const parentPath =
            currentPath === "/" || currentPath === dirname(currentPath)
              ? null
              : dirname(currentPath);

          return json(res, {
            currentPath,
            parentPath,
            folders,
            presets,
            volumes,
            writable: isWritable,
            notFound,
          });
        }
        if (path === "/api/system/folders" && method === "POST") {
          const body = await readBody(req);
          const parent = cleanText(body.parentPath, "Parent folder", 4000);
          const name = cleanText(body.name, "Folder name", 200).replace(/[/\\]/g, "");
          if (!name || name.startsWith(".")) fail(400, "Enter a valid folder name.");
          if (!isAbsolute(parent)) fail(400, "Parent folder must be an absolute path.");
          const newPath = join(parent, name);
          mkdirSync(newPath, { recursive: true, mode: 0o700 });
          return json(res, { ok: true, path: newPath });
        }
        if (path === "/api/settings" && method === "GET")
          return json(res, settings());
        if (path === "/api/settings" && method === "PATCH") {
          const body = await readBody(req);
          const updated = settings();
          if (body.theme !== undefined)
            updated.theme = choice(
              body.theme,
              [
                "forest",
                "cappuccino",
                "ocean",
                "midnight",
                "lavender",
                "terracotta",
                "graphite",
                "plum",
                "espresso-cream",
                "harbour",
                "ink-paper",
                "moonlight",
                "alpine-mint",
                "sandstone-slate",
                "nordic-frost",
                "solar-dark",
                "emerald-dusk",
                "velvet-night",
                "cyber-porcelain",
                "rose-noir",
              ],
              "theme",
            );
          for (const key of ["themeAccent", "themeBackground"]) {
            if (body[key] !== undefined) {
              const color = body[key];
              if (
                typeof color !== "string" ||
                (color !== "" && !/^#[0-9a-f]{6}$/i.test(color))
              )
                fail(
                  400,
                  "Choose a six-digit hex colour or use the theme default.",
                );
              updated[key] = color.toLowerCase();
            }
          }
          if (body.timezone !== undefined) {
            const zone = cleanText(body.timezone, "Timezone", 100);
            try {
              new Intl.DateTimeFormat("en", { timeZone: zone });
            } catch {
              fail(400, "Choose a valid timezone.");
            }
            updated.timezone = zone;
          }
          const reqExports = body.exportsPath;
          if (reqExports !== undefined) {
            if (reqExports === "") {
              const oldExportsRoot =
                updated.exportsPath && isAbsolute(updated.exportsPath)
                  ? resolve(updated.exportsPath)
                  : null;
              updated.exportsPath = "";
              if (oldExportsRoot) {
                const newSub = updated.documentsSubdir || "opportunities";
                folder(filesDir, newSub);
                const oppDocs = getDocuments().filter((d) => d.opportunityId);
                for (const doc of oppDocs) {
                  const source = documentPath(doc);
                  const subRel = doc.relativePath;
                  const newRel = `${newSub}/${subRel}`;
                  const target = safePath(filesDir, newRel);
                  folder(filesDir, dirname(newRel));
                  if (existsSync(source)) {
                    copyFileSync(source, target);
                    unlinkSync(source);
                    pruneEmptyParents(dirname(source), oldExportsRoot);
                  }
                  doc.storageRoot = filesDir;
                  doc.relativePath = newRel;
                  putDocument(doc);
                }
              }
            } else {
              const rawExports = cleanText(reqExports, "Application export folder", 4000).replace(/[\r\n\0]/g, "");
              if (!isAbsolute(rawExports)) {
                fail(
                  400,
                  "Application export folder must be an absolute full-disk path (e.g. /Users/... or /Volumes/...).",
                );
              }
              const targetExports = resolve(rawExports);
              if (targetExports === "/" || targetExports === "\\") {
                fail(400, "Choose a specific folder for application exports.");
              }
              try {
                mkdirSync(targetExports, { recursive: true, mode: 0o700 });
              } catch (err) {
                fail(400, `Could not create or access export folder: ${err.message}`);
              }
              const oldExportsRoot =
                updated.exportsPath && isAbsolute(updated.exportsPath)
                  ? resolve(updated.exportsPath)
                  : safePath(filesDir, updated.documentsSubdir || "opportunities");
              if (oldExportsRoot !== targetExports) {
                const oppDocs = getDocuments().filter((d) => d.opportunityId);
                for (const doc of oppDocs) {
                  const source = documentPath(doc);
                  let subRel = doc.relativePath;
                  if (
                    doc.storageRoot === filesDir &&
                    doc.relativePath.startsWith(`${updated.documentsSubdir || "opportunities"}/`)
                  ) {
                    subRel = doc.relativePath.slice((updated.documentsSubdir || "opportunities").length + 1);
                  }
                  const target = safePath(targetExports, subRel);
                  folder(targetExports, dirname(subRel));
                  if (existsSync(source)) {
                    copyFileSync(source, target);
                    unlinkSync(source);
                    pruneEmptyParents(dirname(source), oldExportsRoot);
                  }
                  doc.storageRoot = targetExports;
                  doc.relativePath = subRel;
                  putDocument(doc);
                }
              }
              updated.exportsPath = targetExports;
            }
          }
          const reqDocSubdir = body.documentsSubdir ?? body.exportsSubdir;
          if (reqDocSubdir !== undefined) {
            const oldSub = updated.documentsSubdir || "opportunities";
            const newSub = cleanText(reqDocSubdir, "Folder", 500).replace(/\/+$/, "");
            if (!newSub) fail(400, "Choose a named subfolder.");
            folder(filesDir, newSub);
            updated.documentsSubdir = newSub;
            if (!updated.exportsPath && oldSub !== newSub) {
              const oppDocs = getDocuments().filter(
                (d) => d.opportunityId && d.relativePath && d.relativePath.startsWith(`${oldSub}/`),
              );
              for (const doc of oppDocs) {
                const rest = doc.relativePath.slice(oldSub.length + 1);
                const newRel = `${newSub}/${rest}`;
                const srcPath = safePath(filesDir, doc.relativePath);
                const dstPath = safePath(filesDir, newRel);
                if (existsSync(srcPath)) {
                  folder(filesDir, dirname(newRel));
                  renameSync(srcPath, dstPath);
                }
                doc.relativePath = newRel;
                putDocument(doc);
              }
              try {
                pruneEmptyParents(join(filesDir, oldSub), filesDir);
              } catch {}
            }
          }
          for (const key of [
            "referenceSubdir",
            "backupSubdir",
          ])
            if (body[key] !== undefined) {
              const sub = cleanText(body[key], "Folder", 500);
              if (!sub) fail(400, "Choose a named subfolder.");
              folder(filesDir, sub);
              updated[key] = sub.replace(/\/+$/, "");
            }
          for (const key of ["exclusionKeywords", "targetTitles", "targetSkills"]) {
            if (body[key] !== undefined) {
              if (!Array.isArray(body[key]))
                fail(400, `${key} must be an array of strings.`);
              updated[key] = body[key]
                .filter((item) => typeof item === "string" && item.trim())
                .map((item) => cleanText(item, key, 100));
            }
          }
          if (body.autoArchiveExcluded !== undefined) {
            updated.autoArchiveExcluded = Boolean(body.autoArchiveExcluded);
          }
          if (body.autoAdvanceStages !== undefined) {
            updated.autoAdvanceStages = Boolean(body.autoAdvanceStages);
          }
          if (body.autoGenerateTasks !== undefined) {
            updated.autoGenerateTasks = Boolean(body.autoGenerateTasks);
          }
          if (body.defaultFollowUpDays !== undefined) {
            const days = Number(body.defaultFollowUpDays);
            if (!Number.isInteger(days) || days < 1 || days > 365) {
              fail(400, "Default follow-up days must be an integer between 1 and 365.");
            }
            updated.defaultFollowUpDays = days;
          }
          if (body.dailyTarget !== undefined) {
            const target = Number(body.dailyTarget);
            if (!Number.isInteger(target) || target < 1 || target > 50) {
              fail(400, "Daily application target must be an integer between 1 and 50.");
            }
            updated.dailyTarget = target;
          }
          if (body.aiEnabled)
            fail(400, "Use the Career Buddy settings to configure AI.");
          let pending;
          if (body.pendingHostPath !== undefined) {
            pending = cleanText(body.pendingHostPath, "Host folder", 2000);
            if (
              pending &&
              (!isAbsolute(pending) ||
                pending.includes("\n") ||
                pending.includes("\r"))
            )
              fail(
                400,
                "Enter an absolute folder path on the hosting machine.",
              );
          }
          const stored = Object.fromEntries(
            Object.keys(settingDefaults)
              .filter((k) => k !== "pendingHostPath")
              .map((k) => [k, updated[k]]),
          );
          putConfig("settings", stored);
          if (pending !== undefined) {
            const requestPath = join(dataDir, "pending-storage.json");
            if (pending)
              writeAtomic(requestPath, JSON.stringify({ hostPath: pending }));
            else rmSync(requestPath, { force: true });
          }
          return json(res, settings());
        }
        if (path === "/api/export" && method === "GET") {
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="opportunity-board-records.json"',
          );
          return json(res, {
            format: "opportunity-board-records",
            version: 1,
            exportedAt: now(),
            limitations:
              "Records and document manifest only. File bytes, profile photo bytes, API keys, and authentication secrets are excluded. Use a full backup for managed files and the profile photo.",
            settings: settings(),
            profile: publicProfile(),
            tasks: listTasks(),
            careerBuddy: buddy.publicSettings(),
            conversations: buddy.exportMessages(),
            decisionAssessments: buddy.exportAssessments(),
            opportunityBriefings:summaries.export(),
            recordImports:recordImports.exportReports(),
            aiActivity:aiActivity.exportRequests(),
            aiTasks:aiScheduler.exportTasks(),
            aiUsageRates:publicRates(getConfig),
            buddyWorkspace:buddy.exportWorkspace(),
            buddyAttachments:buddy.exportAttachments(),
            decisionSettings: buddy.publicDecisionSettings(),
            fitCriteria: getConfig("fitCriteria"),
            feedback:getConfig("feedbackInbox")?.items||[],
            opportunities: listRecords(),
            documents: getDocuments().map(d=>({...publicDocument(d),sha256:d.sha256})),
          });
        }
        if (path === "/api/backups" && method === "GET") {
          const root = safePath(filesDir, settings().backupSubdir);
          try { return json(res, {backups: listBackups(root)}); } catch { fail(400, "Cannot read the configured backup folder."); }
        }
        if (path === "/api/backups/restore-isolated" && method === "POST") {
          const body = await readBody(req);
          if (body.confirm !== true) fail(400, "Confirm creation of a private isolated restore.");
          const root = safePath(filesDir, settings().backupSubdir);
          const destination = join(safePath(dataDir, "restores", {create:true}), "restore-" + randomUUID());
          try { return json(res, restoreIsolatedBackup(root, body.name, destination), 201); }
          catch { fail(400, "Restore could not be completed. Validate the backup and check available disk space."); }
        }
        if (path === "/api/backups/inspect" && method === "POST") {
          const body = await readBody(req);
          const root = safePath(filesDir, settings().backupSubdir);
          try { return json(res, inspectBackup(root, body.name)); } catch { fail(400, "Backup is incomplete, invalid, unreadable, or unsupported."); }
        }
        if (path === "/api/backup" && method === "POST") {await readBody(req);return json(res,createBackup());}
        if (path === "/api/restart/status" && method === "GET") {
          try { return json(res, JSON.parse(readFileSync(join(dataDir, "restart-status.json"), "utf8"))); }
          catch { return json(res, { state: "unknown" }); }
        }
        if (path === "/api/restart" && method === "POST") {
          await readBody(req);
          if (dataDir === "/data") {
            try {
              if (Date.now() - statSync(join(dataDir, ".watcher.heartbeat")).mtimeMs > 5000) throw Error();
            } catch {
              fail(503, "The host restart helper is not running. Start the board using its launcher, then try again.");
            }
          }
          const requestId = randomUUID();
          const requestedAt = now();
          if (dataDir === "/data") writeAtomic(join(dataDir, "restart-status.json"), JSON.stringify({ requestId, state: "queued" }));
          const currentSettings = settings();
          writeAtomic(
            join(dataDir, "pending-restart.json"),
            JSON.stringify({
              requestId,
              requestedAt,
              pendingHostPath: currentSettings.pendingHostPath || "",
            }),
          );
          res.once("finish", () => {
            if (options.onRestart) setImmediate(() => options.onRestart());
          });
          return json(
            res,
            {
              ok: true,
              restarting: true,
              requestId,
              hostManaged: dataDir === "/data",
              requestedAt,
              pendingHostPath: currentSettings.pendingHostPath || "",
            },
            202,
          );
        }
        if (path === "/api/demo" && method === "POST") {
          if (listRecords().length)
            fail(
              409,
              "Sample opportunities can only be added to an empty board.",
            );
          for (const [company, role, stage] of [
            [
              "Example Studio (fictional)",
              "Solutions Architect",
              "identification",
            ],
            ["Example Research (fictional)", "AI Consultant", "review"],
            [
              "Example Systems (fictional)",
              "Technology Director",
              "interviews",
            ],
          ])
            createOpportunity({
              company,
              role,
              stage,
              description:
                "Fictional sample opportunity. Replace this with a real application.",
              tags: ["Sample"],
            });
          return json(
            res,
            { opportunities: listRecords().map(fullRecord) },
            201,
          );
        }
        fail(404, "API route not found.");
      }
      if (!["GET", "HEAD"].includes(method)) fail(405, "Method not allowed.");
      let pathname;
      try {
        pathname = decodeURIComponent(path);
      } catch {
        fail(400, "Invalid URL.");
      }
      let target = resolve(distDir, "." + pathname);
      if (!inside(distDir, target)) fail(403, "Invalid file path.");
      if (!existsSync(target) || statSync(target).isDirectory())
        target = join(distDir, "index.html");
      if (!existsSync(target)) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        return res.end(
          "Frontend is not built. Run npm run build, or use the Vite development server.",
        );
      }
      const type =
        {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".ico": "image/x-icon",
        }[extname(target)] || "application/octet-stream";
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
      res.writeHead(200, { "Content-Type": type });
      res.end(method === "HEAD" ? undefined : readFileSync(target));
    } catch (error) {
      if (!res.headersSent)
        json(
          res,
          {
            error:
              error instanceof HttpError
                ? error.message
                : "The request could not be completed. Check the server logs.",
          },
          error instanceof HttpError ? error.status : 500,
        );
      else res.end();
      if (!(error instanceof HttpError)) console.error(error);
    } finally {
      if (trackedWrite) activeWrites--;
    }
  });
  let closed = false;
  return {
    server,
    db,
    scheduler: aiScheduler,
    updateChecker,
    close: async () => {
      if (closed) return;
      closed = true;
      aiScheduler.close();feedback.close();backupSchedule.close();
      await new Promise((done, reject) =>
        server.listening
          ? server.close((err) => (err ? reject(err) : done()))
          : done(),
      );
      studio.close();jobIntake.close();await buddy.close();
      db.close();
    },
  };
}
