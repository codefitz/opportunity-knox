import { randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { join, isAbsolute } from "node:path";
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const read = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
};
function atomic(path, value) {
  const t = path + ".tmp-" + randomUUID();
  writeFileSync(t, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  renameSync(t, path);
}
export function createReliability({ dataDir, settings, createRestore }) {
  const statusPath = join(dataDir, "maintenance-status.json"),
    pending = join(dataDir, "pending-maintenance.json");
  const status = () => read(statusPath, { phase: "idle" });
  const available = () => {
    try {
      return (
        Date.now() - statSync(join(dataDir, ".watcher.heartbeat")).mtimeMs <
        10000
      );
    } catch {
      return false;
    }
  };
  return {
    applying: () =>
      ["queued", "running"].includes(status().phase) &&
      status().action === "apply",
    async handle(path, method, req, res, { json, readBody }) {
      if (!path.startsWith("/api/reliability/")) return false;
      if (path === "/api/reliability/status" && method === "GET") {
        json(res, { ...status(), available: available() });
        return true;
      }
      if (
        method !== "POST" ||
        !["/api/reliability/preview", "/api/reliability/apply"].includes(path)
      )
        fail(405, "Unsupported reliability action.");
      const body = await readBody(req);
      if (!available())
        fail(
          503,
          "The host helper is unavailable. Start the board through its launcher.",
        );
      if (
        existsSync(pending) ||
        existsSync(join(dataDir, "pending-restart.json")) ||
        [
          "pending-storage.json",
          "pending-vault.json",
          "pending-sources.json",
        ].some((name) => existsSync(join(dataDir, name))) ||
        ["queued", "running"].includes(status().phase)
      )
        fail(409, "A host operation is already in progress.");
      const requestId = randomUUID();
      let request;
      if (path.endsWith("/apply")) {
        if (
          body.confirm !== true ||
          typeof body.planId !== "string" ||
          !/^[a-f0-9-]{36}$/.test(body.planId)
        )
          fail(400, "Review and explicitly confirm a valid preview first.");
        if (
          !existsSync(
            join(dataDir, "maintenance", "plan-" + body.planId + ".json"),
          )
        )
          fail(404, "Preview was not found. Preview again.");
        request = { requestId, action: "apply", planId: body.planId };
      } else {
        if (!["migrate", "relink", "restore"].includes(body.kind))
          fail(400, "Choose migration, relinking or restore.");
        request = { requestId, action: "preview", kind: body.kind };
        if (body.kind === "restore") {
          try {
            request.restoreId = createRestore(body.backupName);
            request.backupName = body.backupName;
          } catch {
            fail(400, "Backup could not be validated and restored.");
          }
        } else {
          if (
            typeof body.destination !== "string" ||
            !isAbsolute(body.destination) ||
            body.destination.length > 2000 ||
            /[\0\r\n]/.test(body.destination)
          )
            fail(
              400,
              "Choose an absolute destination folder on the hosting computer.",
            );
          request.destination = body.destination;
        }
      }
      mkdirSync(join(dataDir, "maintenance"), { recursive: true, mode: 0o700 });
      atomic(statusPath, {
        requestId,
        action: request.action,
        kind: request.kind,
        phase: "queued",
      });
      atomic(pending, request);
      json(res, { requestId, phase: "queued" }, 202);
      return true;
    },
  };
}
