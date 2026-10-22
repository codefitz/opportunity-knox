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
  existsSync,
  realpathSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  statSync,
  copyFileSync,
  renameSync,
  unlinkSync,
  rmSync,
} from "node:fs";
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
import { createCareerBuddy } from "./career-buddy.mjs";

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
const outcomes = ["hired", "rejected", "ignored", "withdrawn", "closed"];
const textFields = [
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
const publicDocument = ({ storageRoot, relativePath, sha256, ...rest }) => ({
  ...rest,
  url: `/api/documents/${rest.id}/content`,
});
function writeAtomic(path, data) {
  const temp = path + "." + randomUUID() + ".tmp";
  writeFileSync(temp, data, { mode: 0o600 });
  renameSync(temp, path);
}

/** Creates an unbound HTTP server. Call server.listen(), and await close() to release server and SQLite. */
export function createApp(options = {}) {
  const lookupJob =
    options.jobLookup ||
    (async (url) => {
      const page = await fetchJobPage(url);
      return {
        ...parseJobPage(page.html, { url: page.url }),
        sourceUrl: url,
        resolvedUrl: page.url,
      };
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
    if (allowedRoots && !allowedRoots.has(resolve(doc.storageRoot)))
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
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL);",
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
      .map((row) => JSON.parse(row.data));
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
  const fullRecord = (record) => ({
    ...record,
    documents: getDocuments()
      .filter((d) => d.opportunityId === record.id)
      .map(publicDocument),
  });
  const listRecords = () =>
    db
      .prepare("SELECT data FROM records ORDER BY rowid DESC")
      .all()
      .map((row) => JSON.parse(row.data));
  const settingDefaults = {
    timezone: "Europe/London",
    theme: "forest",
    documentsSubdir: "opportunities",
    referenceSubdir: "references",
    backupSubdir: "backups",
    pendingHostPath: "",
    aiEnabled: false,
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
    return {
      ...settingDefaults,
      ...(getConfig("settings") || {}),
      aiEnabled: Boolean(getConfig("careerBuddy")?.enabled),
      pendingHostPath,
      hostDocumentsPath: hostFilesDir,
      storagePath: filesDir,
    };
  };
  for (const key of ["documentsSubdir", "referenceSubdir", "backupSubdir"])
    folder(filesDir, settings()[key]);
  const sessions = new Map();
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
      sessions.delete(key);
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
  function createOpportunity(body) {
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
    dateOnly(record.deadline, "Deadline");
    dateOnly(record.nextActionDate, "Next action date");
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
    const event = addEvent(record, body);
    record.stageEnteredAt = event.effectiveAt;
    record.currentStageEventId = event.id;
    putRecord(record);
    return fullRecord(record);
  }
  const saveDocument = ({
    name,
    kind,
    status,
    opportunityId,
    content,
    notes = "",
    generation,
  }) => {
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
    const baseSubdir = opportunityId
      ? `${settings().documentsSubdir}/${opportunityId}`
      : settings().referenceSubdir;
    folder(filesDir, baseSubdir);
    const relativePath = `${baseSubdir}/${id}${extname(name).replace(/[^.a-zA-Z0-9]/g, "")}`;
    const target = safePath(filesDir, relativePath);
    writeFileSync(target, content, { flag: "wx", mode: 0o600 });
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
      storageRoot: filesDir,
      relativePath,
      sha256: createHash("sha256").update(content).digest("hex"),
      revision: 1,
      ...(generation ? { generation } : {}),
    };
    try {
      putDocument(document);
    } catch (e) {
      unlinkSync(target);
      throw e;
    }
    return publicDocument(document);
  };
  const buddy = createCareerBuddy({
    db,
    getConfig,
    putConfig,
    getRecord,
    putRecord,
    fullRecord,
    getDocuments,
    documentPath,
    settings,
    saveDocument,
    buddyFetch: options.buddyFetch,
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
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    try {
      const parsed = new URL(req.url, "http://localhost");
      const path = parsed.pathname;
      const method = req.method;
      if (!["GET", "HEAD", "POST", "PATCH"].includes(method))
        fail(405, "Method not allowed.");
      if (["POST", "PATCH"].includes(method) && req.headers.origin) {
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
        if (cookie)
          sessions.delete(
            createHash("sha256").update(cookie.slice(14)).digest("hex"),
          );
        res.setHeader(
          "Set-Cookie",
          "board_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        );
        return json(res, { authenticated: false });
      }
      if (path.startsWith("/api/")) {
        if (!authCookie(req)) fail(401, "Sign in to access your board.");
        if (
          path.startsWith("/api/buddy/") ||
          /^\/api\/opportunities\/[^/]+\/buddy(?:\/|$)/.test(path)
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
            if (body.completed && !task.completed) task.completedAt = now();
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
          return json(res, {
            opportunities: listRecords().map(fullRecord),
            settings: settings(),
            stages,
            profile: publicProfile(),
            tasks: listTasks(),
            documentCount: documents.length,
            referenceCount: documents.filter(
              (document) => !document.opportunityId,
            ).length,
          });
        }
        if (path === "/api/opportunities" && method === "POST")
          return json(res, createOpportunity(await readBody(req)), 201);
        const match = path.match(
          /^\/api\/opportunities\/([^/]+)(?:\/(events|activities)(?:\/([^/]+))?)?$/,
        );
        if (match) {
          if (!match[2] && method === "GET")
            return json(res, fullRecord(getRecord(match[1])));
          const body = await readBody(req);
          const record = getRecord(match[1]);
          if (!match[2] && method === "PATCH") {
            requireRevision(body, record);
            const oldStage = record.stage;
            const oldOutcome = record.outcome;
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
            dateOnly(record.deadline, "Deadline");
            dateOnly(record.nextActionDate, "Next action date");
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
              };
            else if (method === "PATCH" && match[3]) {
              requireRevision(body, record);
              activity = record.activities.find((a) => a.id === match[3]);
              if (!activity) fail(404, "Activity not found.");
              activity.history ||= [];
              activity.history.push({
                scheduledAt: activity.scheduledAt,
                status: activity.status,
                notes: activity.notes,
                changedAt: now(),
              });
            } else fail(405, "Method not allowed.");
            for (const key of ["title", "notes", "contact"])
              if (body[key] !== undefined)
                activity[key] = cleanText(body[key], key, 50000);
            if (!activity.title) fail(400, "Activity title is required.");
            if (body.kind !== undefined)
              activity.kind = choice(
                body.kind,
                ["interview", "communication"],
                "activity kind",
              );
            if (body.type !== undefined)
              activity.type = choice(
                body.type,
                [
                  "text",
                  "phone",
                  "video",
                  "in-person",
                  "assessment",
                  "email",
                  "other",
                ],
                "activity type",
              );
            if (body.status !== undefined)
              activity.status = choice(
                body.status,
                ["planned", "completed", "cancelled"],
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
            return json(res, changed(record));
          }
          fail(405, "Method not allowed.");
        }
        if (path === "/api/documents" && method === "GET")
          return json(res, { documents: getDocuments().map(publicDocument) });
        if (path === "/api/documents" && method === "POST") {
          const body = await readBody(req);
          const opportunityId = body.opportunityId
            ? cleanText(body.opportunityId, "Opportunity ID", 100)
            : "";
          if (opportunityId) getRecord(opportunityId);
          const name = cleanText(body.name, "Filename", 250);
          if (!name || /[/\\]/.test(name) || name === "." || name === "..")
            fail(400, "Use a filename without folder separators.");
          const kind = choice(
            body.kind ?? "other",
            ["jd", "cv", "cover", "reference", "other"],
            "document kind",
          );
          const status = choice(
            body.status ?? "draft",
            ["draft", "approved", "submitted"],
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
          const document = saveDocument({
            name,
            kind,
            status,
            opportunityId,
            content,
            notes: cleanText(body.notes ?? "", "Notes", 50000),
          });
          return json(res, document, 201);
        }
        const docMatch = path.match(/^\/api\/documents\/([^/]+)(\/content)?$/);
        if (docMatch) {
          const doc = getDocument(docMatch[1]);
          if (docMatch[2] && method === "GET") {
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
            res.writeHead(200, {
              "Content-Type":
                extname(doc.name).toLowerCase() === ".pdf"
                  ? "application/pdf"
                  : "application/octet-stream",
              "Content-Length": content.length,
              "Content-Disposition": `attachment; filename="${doc.name.replace(/[^a-zA-Z0-9._ -]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
            });
            return res.end(content);
          }
          if (!docMatch[2] && method === "PATCH") {
            const body = await readBody(req);
            if (body.revision !== undefined && body.revision !== doc.revision)
              fail(409, "Document changed. Reload before saving.");
            if (doc.status === "submitted")
              fail(
                409,
                "Submitted document versions are preserved. Upload a new version to make changes.",
              );
            if (
              Object.keys(body).some(
                (key) => !["status", "revision"].includes(key),
              )
            )
              fail(
                400,
                "Document contents cannot be overwritten. Upload a new version.",
              );
            doc.status = choice(
              body.status,
              ["draft", "approved", "submitted"],
              "document status",
            );
            doc.revision++;
            putDocument(doc);
            return json(res, publicDocument(doc));
          }
          fail(405, "Method not allowed.");
        }
        if (path === "/api/settings" && method === "GET")
          return json(res, settings());
        if (path === "/api/settings" && method === "PATCH") {
          const body = await readBody(req);
          const updated = settings();
          if (body.theme !== undefined)
            updated.theme = choice(
              body.theme,
              ["forest", "cappuccino", "ocean", "midnight"],
              "theme",
            );
          if (body.timezone !== undefined) {
            const zone = cleanText(body.timezone, "Timezone", 100);
            try {
              new Intl.DateTimeFormat("en", { timeZone: zone });
            } catch {
              fail(400, "Choose a valid timezone.");
            }
            updated.timezone = zone;
          }
          for (const key of [
            "documentsSubdir",
            "referenceSubdir",
            "backupSubdir",
          ])
            if (body[key] !== undefined) {
              const sub = cleanText(body[key], "Folder", 500);
              if (!sub) fail(400, "Choose a named subfolder.");
              folder(filesDir, sub);
              updated[key] = sub.replace(/\/+$/, "");
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
            opportunities: listRecords(),
            documents: getDocuments().map(publicDocument),
          });
        }
        if (path === "/api/backup" && method === "POST") {
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
              manifest.push({
                ...publicDocument(doc),
                backupPath: `documents/${doc.id}`,
                storageRoot: doc.storageRoot,
                relativePath: doc.relativePath,
              });
            }
            // Serialize metadata and credentials into a standalone database snapshot before yielding.
            const snapshot = new DatabaseSync(
              join(destination, "board.sqlite"),
            );
            try {
              snapshot.exec(
                "CREATE TABLE records (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE documents (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE config (key TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE tasks (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE buddy_messages (id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE document_text (id TEXT PRIMARY KEY,data TEXT NOT NULL);",
              );
              for (const table of [
                "records",
                "documents",
                "config",
                "tasks",
                "buddy_messages",
                "document_text",
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
          return json(res, { name, createdAt, location: completedDestination });
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
    }
  });
  let closed = false;
  return {
    server,
    db,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise((done, reject) =>
        server.listening
          ? server.close((err) => (err ? reject(err) : done()))
          : done(),
      );
      db.close();
    },
  };
}
