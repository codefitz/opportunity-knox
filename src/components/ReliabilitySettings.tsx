import { useEffect, useState } from "react";
import { api, ApiError, json, formatDate } from "../api";
type Schedule = {
  revision: number;
  enabled: boolean;
  intervalHours: number;
  nextRunAt: string;
  lastSuccessAt: string;
  lastBackup: string;
  lastError: string;
};
type Status = {
  phase: string;
  available?: boolean;
  planId?: string;
  kind?: string;
  documents?: number;
  bytes?: number;
  destination?: string;
  message?: string;
  backup?: string;
  warnings?: string[];
  input?: { destination: string; backupName: string };
};
export default function ReliabilitySettings({
  onError,
  timezone,
}: {
  onError: (e: unknown) => void;
  timezone: string;
}) {
  const [schedule, setSchedule] = useState<Schedule | null>(null),
    [status, setStatus] = useState<Status | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [kind, setKind] = useState("migrate"),
    [destination, setDestination] = useState(""),
    [backups, setBackups] = useState<{ name: string }[]>([]),
    [backupName, setBackupName] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const result = (s: Status) => {
    setStatus(s);
    if (s.phase === "previewed") {
      if (s.kind) setKind(s.kind);
      setDestination(s.input?.destination || "");
      setBackupName(s.input?.backupName || "");
    }
  };
  const invalidate = () => {
    setConfirmed(false);
    setStatus((s) => (s?.phase === "previewed" ? { ...s, phase: "stale" } : s));
  };
  const load = () =>
    Promise.all([
      api<Schedule>("/backups/schedule").then(setSchedule),
      api<Status>("/reliability/status").then(result),
    ]).catch(onError);
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!status || !["queued", "running"].includes(status.phase)) return;
    let active = true;
    const timer = window.setInterval(
      () =>
        void api<Status>("/reliability/status")
          .then((s) => {
            if (active) result(s);
          })
          .catch((e) => {
            if (e instanceof ApiError && e.status === 401) {
              setNotice(
                "The restored workspace is ready for sign-in. Reload the board and use the restored password.",
              );
            }
          }),
      1500,
    );
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [status?.phase]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const active =
    busy || (!!status && ["queued", "running"].includes(status.phase));
  return (
    <section className="settings-section" aria-label="Reliability and recovery">
      <div className="settings-section-heading">
        <div>
          <h2>Reliability & recovery</h2>
          <p>
            Recover upload queues, protect changes with backups, and switch
            storage through verified previews.
          </p>
        </div>
      </div>
      <div className="reliability-card">
        <h3>Automatic backups</h3>
        <p>
          Daily or weekly while the board is running. If it was stopped when
          due, one backup runs after startup. No old backups are deleted
          automatically.
        </p>
        {schedule && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                setSchedule(
                  await api<Schedule>(
                    "/backups/schedule",
                    json(
                      {
                        revision: schedule.revision,
                        enabled: schedule.enabled,
                        intervalHours: schedule.intervalHours,
                      },
                      "PATCH",
                    ),
                  ),
                );
                setNotice("Backup schedule saved.");
              });
            }}
          >
            <label className="check-field">
              <input
                type="checkbox"
                checked={schedule.enabled}
                onChange={(e) =>
                  setSchedule({ ...schedule, enabled: e.target.checked })
                }
              />
              Enable automatic backups
            </label>
            <label className="field">
              <span>Backup frequency</span>
              <select
                value={schedule.intervalHours}
                onChange={(e) =>
                  setSchedule({
                    ...schedule,
                    intervalHours: Number(e.target.value),
                  })
                }
              >
                <option value={24}>Daily</option>
                <option value={168}>Weekly</option>
              </select>
            </label>
            <div className="form-actions">
              <button className="button secondary small" disabled={active}>
                Save backup schedule
              </button>
              <button
                type="button"
                className="button secondary small"
                disabled={active}
                onClick={() =>
                  void run(async () => {
                    const r = await api<{ name: string; schedule: Schedule }>(
                      "/backups/schedule/run",
                      json({ confirm: true }),
                    );
                    setSchedule(r.schedule);
                    setNotice("Verified backup created: " + r.name);
                  })
                }
              >
                Run backup now
              </button>
            </div>
            {schedule.lastSuccessAt && (
              <p>
                Last successful backup:{" "}
                {formatDate(schedule.lastSuccessAt, timezone, true)}
              </p>
            )}
            {schedule.nextRunAt && (
              <p>
                Next backup: {formatDate(schedule.nextRunAt, timezone, true)}
              </p>
            )}
            {schedule.lastError && (
              <p className="alert error" role="alert">
                {schedule.lastError}
              </p>
            )}
          </form>
        )}
        <p>
          The launcher also verifies a full backup before rebuilding/restarting
          an existing installation. A failed backup stops the upgrade.
        </p>
      </div>
      <div className="reliability-card">
        <h3>Restore or change document storage</h3>
        <p>
          Preview first. The host helper checks every managed document and keeps
          the original files and a pre-change backup.
        </p>
        {status?.available === false && !active && (
          <p role="status">
            The host helper is unavailable or currently busy. Start the board
            with its launcher to use these controls.
          </p>
        )}
        <div className="form-grid">
          <label className="field">
            <span>Recovery action</span>
            <select
              disabled={active}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                invalidate();
              }}
            >
              <option value="migrate">Copy documents to a new folder</option>
              <option value="relink">
                Reconnect an existing document folder
              </option>
              <option value="restore">
                Activate a backup as the live workspace
              </option>
            </select>
          </label>
          {kind !== "restore" ? (
            <label className="field wide">
              <span>Destination folder on the hosting computer</span>
              <input
                value={destination}
                disabled={active}
                onChange={(e) => {
                  setDestination(e.target.value);
                  invalidate();
                }}
                placeholder="An existing absolute folder path"
              />
              <small>
                {kind === "migrate"
                  ? "A private workspace subfolder is created here; originals stay in place."
                  : "The folder must contain the recorded document paths with matching file hashes."}
              </small>
            </label>
          ) : (
            <>
              <label className="field wide">
                <span>Backup to activate</span>
                <select
                  value={backupName}
                  disabled={active}
                  onChange={(e) => {
                    setBackupName(e.target.value);
                    invalidate();
                  }}
                >
                  <option value="">Choose a completed backup</option>
                  {backups.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button secondary small"
                disabled={active}
                onClick={() =>
                  void run(async () =>
                    setBackups(
                      (await api<{ backups: { name: string }[] }>("/backups"))
                        .backups,
                    ),
                  )
                }
              >
                Find backups for activation
              </button>
              <p className="wide">
                Activation replaces live records and saved account settings with
                the backup. You will sign in using the restored password. The
                current workspace is backed up first; existing read-only source
                connections are not expanded automatically.
              </p>
            </>
          )}
        </div>
        <div className="form-actions">
          <button
            type="button"
            className="button secondary small"
            disabled={
              active ||
              !status?.available ||
              (kind === "restore" ? !backupName : !destination)
            }
            onClick={() =>
              void run(async () => {
                setConfirmed(false);
                const queued = await api<Status>(
                  "/reliability/preview",
                  json({ kind, destination, backupName }),
                );
                setStatus({ ...queued, phase: "queued" });
              })
            }
          >
            Preview verified change
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void load()}
          >
            Refresh recovery status
          </button>
        </div>
        {status && (
          <div role="status" className="reliability-result">
            <strong>Recovery: {status.phase}</strong>
            {status.message && <p>{status.message}</p>}
            {status.destination && <p>Destination: {status.destination}</p>}
            {status.documents !== undefined && (
              <p>
                {status.documents} documents ·{" "}
                {Math.round((status.bytes || 0) / 1024)} KB to verify/copy
              </p>
            )}
            {status.warnings?.map((w) => (
              <p key={w}>{w}</p>
            ))}
            {status.backup && (
              <p>Pre-change backup retained: {status.backup}</p>
            )}
          </div>
        )}
        {status?.phase === "previewed" && (
          <>
            <label className="check-field">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I have reviewed this preview and want to switch the active
              workspace/storage.
            </label>
            <p>
              The board briefly restarts. If verification fails, the host helper
              restores the previous workspace. Interrupted switches recover from
              a private rollback journal.
            </p>
            <button
              type="button"
              className="button primary small"
              disabled={!confirmed || active}
              onClick={() =>
                void run(async () => {
                  const queued = await api<Status>(
                    "/reliability/apply",
                    json({ planId: status.planId, confirm: true }),
                  );
                  setConfirmed(false);
                  setStatus({ ...queued, phase: "queued" });
                })
              }
            >
              Apply verified change
            </button>
          </>
        )}
        {status?.phase === "succeeded" && (
          <button
            type="button"
            className="button primary small"
            onClick={() => window.location.reload()}
          >
            Reload updated workspace
          </button>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
