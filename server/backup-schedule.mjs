const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
export function createBackupSchedule({
  getConfig,
  putConfig,
  createBackup,
  clock = () => Date.now(),
  timers = true,
  canRun = () => true,
}) {
  const defaults = {
    revision: 1,
    enabled: false,
    intervalHours: 24,
    nextRunAt: "",
    lastSuccessAt: "",
    lastAttemptAt: "",
    lastBackup: "",
    lastError: "",
  };
  const read = () => ({ ...defaults, ...getConfig("backupSchedule") });
  let running = false;
  function run() {
    if (!canRun())
      fail(503, "Wait for workspace maintenance to finish before backing up.");
    if (running) fail(409, "A scheduled backup is already running.");
    running = true;
    let c = read();
    try {
      const result = createBackup();
      c = {
        ...c,
        lastSuccessAt: new Date(clock()).toISOString(),
        lastAttemptAt: new Date(clock()).toISOString(),
        lastBackup: result.name,
        lastError: "",
        nextRunAt: c.enabled
          ? new Date(clock() + c.intervalHours * 3600000).toISOString()
          : "",
      };
      putConfig("backupSchedule", c);
      return { ...result, schedule: c };
    } catch (e) {
      c = {
        ...c,
        lastAttemptAt: new Date(clock()).toISOString(),
        lastError:
          "Backup could not complete. Check document locations and free disk space.",
        nextRunAt: c.enabled ? new Date(clock() + 3600000).toISOString() : "",
      };
      putConfig("backupSchedule", c);
      throw e;
    } finally {
      running = false;
    }
  }
  function tick() {
    if (!canRun()) return;
    const c = read();
    if (c.enabled && c.nextRunAt && Date.parse(c.nextRunAt) <= clock())
      try {
        run();
      } catch {}
  }
  const timer = timers ? setInterval(tick, 60000) : null;
  timer?.unref();
  return {
    tick,
    close() {
      if (timer) clearInterval(timer);
    },
    async handle(path, method, req, res, { json, readBody }) {
      if (
        path !== "/api/backups/schedule" &&
        path !== "/api/backups/schedule/run"
      )
        return false;
      if (path.endsWith("/run")) {
        if (method !== "POST") fail(405, "Use Run backup now.");
        const body = await readBody(req);
        if (body.confirm !== true) fail(400, "Confirm the backup.");
        json(res, run());
        return true;
      }
      if (method === "GET") {
        json(res, read());
        return true;
      }
      if (method !== "PATCH") fail(405, "Use Save backup schedule.");
      const body = await readBody(req),
        c = read();
      if (body.revision !== c.revision)
        fail(409, "Backup settings changed. Refresh first.");
      if (
        typeof body.enabled !== "boolean" ||
        ![24, 168].includes(body.intervalHours)
      )
        fail(400, "Choose daily or weekly backups.");
      if (
        Object.keys(body).some(
          (k) => !["revision", "enabled", "intervalHours"].includes(k),
        )
      )
        fail(400, "Unsupported backup setting.");
      const next = {
        ...c,
        enabled: body.enabled,
        intervalHours: body.intervalHours,
        revision: c.revision + 1,
        nextRunAt: body.enabled
          ? new Date(clock() + body.intervalHours * 3600000).toISOString()
          : "",
      };
      putConfig("backupSchedule", next);
      json(res, next);
      return true;
    },
  };
}
