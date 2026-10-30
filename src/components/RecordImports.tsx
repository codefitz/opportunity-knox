import { useEffect, useState } from "react";
import { FileInput } from "lucide-react";
import { api, json, download, formatDate } from "../api";
import type { Opportunity } from "../types";
import "./RecordImports.css";
type Choice = {
  index: number;
  action: "skip" | "create" | "merge";
  targetId: string;
  fields: string[];
  includeHistory: boolean;
  includeStage: boolean;
};
type Match = {
  id: string;
  company: string;
  role: string;
  revision: number;
  reasons: string[];
  stage: string;
  outcome: string;
};
type Row = {
  index: number;
  sourceId: string;
  record: Opportunity;
  matches: Match[];
  relatedRows: number[];
  totalMatches: number;
  warnings: string[];
  documentCount: number;
};
type Receipt = {
  sourceHash: string;
  label: string;
  importedAt: string;
  backup: string;
  created: number;
  merged: number;
  skipped: number;
  replayed?: boolean;
};
type Preview = {
  id: string;
  sourceHash: string;
  label: string;
  warning: string;
  rows: Row[];
  receipt?: Receipt;
  alreadyApplied?: boolean;
};
const fields: Record<string, string> = {
  company: "Employer",
  role: "Role",
  url: "Job link",
  jobReference: "Job reference",
  applicationRoute: "Application route",
  location: "Location",
  workMode: "Working arrangement",
  salary: "Salary / rate",
  employmentType: "Employment type",
  contact: "Contact",
  deadline: "Closing date",
  description: "Job description",
  nextAction: "Next action",
  nextActionDate: "Next action date",
  priority: "Priority",
  tags: "Tags",
};
const display = (v: unknown) =>
  Array.isArray(v)
    ? v.map((t) => "• " + String(t)).join("\n")
    : String(v ?? "");
export default function RecordImports({
  timezone,
  onImported,
}: {
  timezone: string;
  onImported: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null),
    [choices, setChoices] = useState<Choice[]>([]),
    [targets, setTargets] = useState<Record<string, Opportunity>>({}),
    [reports, setReports] = useState<Receipt[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const loadReports = () =>
    api<{ imports: Receipt[] }>("/record-imports")
      .then((v) => setReports(v.imports))
      .catch((e) => setError(e.message));
  useEffect(() => {
    void loadReports();
  }, []);
  function edit(index: number, patch: Partial<Choice>) {
    setChoices((v) =>
      v.map((c) => (c.index === index ? { ...c, ...patch } : c)),
    );
    setConfirmed(false);
  }
  async function target(index: number, id: string) {
    edit(index, { targetId: id, fields: [] });
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      const value = await api<Opportunity>("/opportunities/" + id);
      setTargets((v) => ({ ...v, [id]: value }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load match");
    } finally {
      setBusy(false);
    }
  }
  async function downloadReport(hash: string) {
    setError("");
    try {
      download(
        "opportunity-knox-import-report.json",
        JSON.stringify(await api("/record-imports/" + hash), null, 2),
        "application/json",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download report");
    }
  }
  return (
    <section
      className="settings-section record-imports"
      aria-label="Historical record imports"
    >
      <div className="settings-section-heading">
        <FileInput size={21} />
        <div>
          <h2>Historical record imports</h2>
          <p>
            Bring in earlier opportunities without replacing your workspace.
          </p>
        </div>
      </div>
      <p>
        Choose an Opportunity Knox record export, or use the historical JSON
        template. Review every record, then skip it, create a separate
        opportunity, or merge selected information into an existing one. A full
        backup is required before changes.
      </p>
      <p>
        File bytes, tasks, chats, offers, assessments and application pack
        approvals are not activated by this import. Original records and linked
        document manifests/tasks are archived for reference. Use full backup
        restore when you need an entire workspace and its files.
      </p>
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={() =>
          download(
            "opportunity-knox-historical-template.json",
            JSON.stringify(
              {
                format: "opportunity-knox-historical",
                version: 1,
                opportunities: [
                  {
                    id: "your-source-record-id",
                    company: "Fictional Example Ltd",
                    role: "Example role",
                    url: "https://example.com/jobs/example",
                    jobReference: "EXAMPLE-1",
                    stage: "identification",
                    createdAt: "2026-10-01T12:00:00Z",
                    events: [
                      {
                        id: "source-note-1",
                        stage: "identification",
                        effectiveAt: "2026-10-01T12:00:00Z",
                        recordedAt: "2026-10-01T12:00:00Z",
                        note: "Replace these fictional details with your own historical record.",
                      },
                    ],
                  },
                ],
              },
              null,
              2,
            ),
            "application/json",
          )
        }
      >
        Download JSON template
      </button>
      <label className="field">
        <span>Record export JSON (up to 8 MB, 1,000 opportunities)</span>
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setError("");
            setPreview(null);
            setChoices([]);
            setConfirmed(false);
            if (file.size > 8000000) {
              setError(
                "Choose a file up to 8 MB. Split larger exports into smaller record files.",
              );
              return;
            }
            setBusy(true);
            try {
              const source = JSON.parse(await file.text());
              const result = await api<Preview>(
                "/record-imports/preview",
                json({ source, label: file.name }),
              );
              setPreview(result);
              setTargets({});
              setChoices(
                result.rows.map((r) => ({
                  index: r.index,
                  action: "skip",
                  targetId: "",
                  fields: [],
                  includeHistory: false,
                  includeStage: false,
                })),
              );
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : "Could not preview JSON file",
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {busy && <p role="status">Working…</p>}
      {preview && !preview.receipt && (
        <>
          <h3>
            Review {preview.rows.length} records from {preview.label}
          </h3>
          <p>{preview.warning}</p>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setChoices((v) =>
                v.map((c) => ({
                  ...c,
                  action:
                    preview.rows[c.index].matches.length ||
                    preview.rows[c.index].relatedRows.length
                      ? "skip"
                      : "create",
                })),
              );
              setConfirmed(false);
            }}
          >
            Select unmatched records as new
          </button>
          {preview.rows.map((row) => {
            const c = choices[row.index],
              current = targets[c.targetId];
            return (
              <article className="record-import-row" key={row.index}>
                <h4>
                  {row.index + 1}. {row.record.role} — {row.record.company}
                </h4>
                <p>
                  From file: {row.record.stage}
                  {row.record.outcome ? " / " + row.record.outcome : ""} ·{" "}
                  {row.record.events?.length || 0} timeline entries ·{" "}
                  {row.record.activities?.length || 0} communications/interviews
                  · {row.documentCount} document references (files not included)
                </p>
                <p>
                  Created: {formatDate(row.record.createdAt, timezone, true)} ·
                  Current stage dated:{" "}
                  {formatDate(row.record.stageEnteredAt, timezone, true)}
                </p>
                {row.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
                {row.relatedRows.length > 0 && (
                  <p>
                    Possible duplicates within this file: records{" "}
                    {row.relatedRows.map((i) => i + 1).join(", ")}. Repeat
                    applications can be kept separately.
                  </p>
                )}
                {row.matches.length > 0 ? (
                  <details>
                    <summary>
                      {row.totalMatches} possible existing matches
                      {row.totalMatches > 25
                        ? " (showing the strongest 25)"
                        : ""}
                    </summary>
                    <ul>
                      {row.matches.map((m) => (
                        <li key={m.id}>
                          {m.role} — {m.company}: {m.reasons.join("; ")}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <p>No existing matches found.</p>
                )}
                <details>
                  <summary>Review imported details and history</summary>
                  <dl>
                    {Object.entries(fields).map(([key, label]) => (
                      <div key={key}>
                        <dt>{label}</dt>
                        <dd>
                          {display(
                            (row.record as unknown as Record<string, unknown>)[
                              key
                            ],
                          ) || "Not recorded"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="record-import-history">
                    {row.record.events?.map((e) => (
                      <div key={e.id}>
                        <strong>
                          {e.title || e.stage} ·{" "}
                          {formatDate(e.effectiveAt, timezone, true)}
                        </strong>
                        <p>{e.note}</p>
                        <p>
                          {e.corrections?.length || 0} date corrections retained
                        </p>
                      </div>
                    ))}
                    {row.record.activities?.map((a) => (
                      <div key={a.id}>
                        <strong>
                          {a.kind}: {a.title} · {a.status}
                        </strong>
                        <p>
                          {a.scheduledAt
                            ? formatDate(a.scheduledAt, timezone, true)
                            : "No scheduled date"}{" "}
                          · {a.type} · {a.contact}
                        </p>
                        <p>{a.notes}</p>
                        <p>
                          {a.followUp} {a.followUpDate}{" "}
                          {a.followUpDone ? "(completed)" : ""} ·{" "}
                          {a.history?.length || 0} revisions retained ·
                          attachment files not included
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
                <label className="field">
                  <span>Import action for record {row.index + 1}</span>
                  <select
                    disabled={busy}
                    value={c.action}
                    onChange={(e) =>
                      edit(row.index, {
                        action: e.target.value as Choice["action"],
                      })
                    }
                  >
                    <option value="skip">Skip</option>
                    <option value="create">Create separate opportunity</option>
                    <option value="merge" disabled={!row.matches.length}>
                      Merge selected information
                    </option>
                  </select>
                </label>
                {c.action === "merge" && (
                  <>
                    <label className="field">
                      <span>Merge target for record {row.index + 1}</span>
                      <select
                        value={c.targetId}
                        disabled={busy}
                        onChange={(e) => void target(row.index, e.target.value)}
                      >
                        <option value="">Choose an existing opportunity</option>
                        {row.matches.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.role} — {m.company} · {m.stage}
                          </option>
                        ))}
                      </select>
                    </label>
                    {current && (
                      <fieldset>
                        <legend>
                          Choose fields to replace in record {row.index + 1}
                        </legend>
                        <p>
                          Only differing fields are listed. Unchecked fields
                          stay as they are. History is appended without changing
                          existing entries. Repeated employer/role names can
                          represent separate applications.
                        </p>
                        {Object.entries(fields).map(([key, label]) => {
                          const before = (
                              current as unknown as Record<string, unknown>
                            )[key],
                            after = (
                              row.record as unknown as Record<string, unknown>
                            )[key];
                          if (
                            JSON.stringify(before ?? "") ===
                            JSON.stringify(after ?? "")
                          )
                            return null;
                          return (
                            <div key={key}>
                              <label className="checkbox-row">
                                <input
                                  type="checkbox"
                                  disabled={busy}
                                  checked={c.fields.includes(key)}
                                  onChange={(e) =>
                                    edit(row.index, {
                                      fields: e.target.checked
                                        ? [...c.fields, key]
                                        : c.fields.filter((k) => k !== key),
                                    })
                                  }
                                />
                                <span>Replace {label.toLowerCase()}</span>
                              </label>
                              <details>
                                <summary>Compare {label.toLowerCase()}</summary>
                                <p>
                                  Existing:{" "}
                                  <span className="record-import-value">
                                    {display(before) || "Not recorded"}
                                  </span>
                                </p>
                                <p>
                                  From file:{" "}
                                  <span className="record-import-value">
                                    {display(after) || "Not recorded"}
                                  </span>
                                </p>
                              </details>
                            </div>
                          );
                        })}
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            disabled={busy}
                            checked={c.includeHistory}
                            onChange={(e) =>
                              edit(row.index, {
                                includeHistory: e.target.checked,
                              })
                            }
                          />
                          <span>
                            Append timeline and communication/interview history
                            for record {row.index + 1}
                          </span>
                        </label>
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            disabled={busy}
                            checked={c.includeStage}
                            onChange={(e) =>
                              edit(row.index, {
                                includeStage: e.target.checked,
                              })
                            }
                          />
                          <span>
                            Replace current stage/outcome for record{" "}
                            {row.index + 1}: {current.stage} /{" "}
                            {current.outcome || "active"} → {row.record.stage} /{" "}
                            {row.record.outcome || "active"}
                            <br />
                            Stage date:{" "}
                            {formatDate(
                              current.stageEnteredAt,
                              timezone,
                              true,
                            )}{" "}
                            →{" "}
                            {formatDate(
                              row.record.stageEnteredAt,
                              timezone,
                              true,
                            )}
                          </span>
                        </label>
                      </fieldset>
                    )}
                  </>
                )}
              </article>
            );
          })}
          <p>
            {choices.filter((c) => c.action === "create").length} new ·{" "}
            {choices.filter((c) => c.action === "merge").length} merges ·{" "}
            {choices.filter((c) => c.action === "skip").length} skipped
          </p>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              I have reviewed these choices. Create a full backup, then apply
              this import.
            </span>
          </label>
          <button
            type="button"
            className="button"
            disabled={
              busy ||
              !confirmed ||
              choices.every((c) => c.action === "skip") ||
              choices.some(
                (c) =>
                  c.action === "merge" &&
                  (!c.targetId ||
                    !targets[c.targetId] ||
                    (!c.fields.length && !c.includeHistory && !c.includeStage)),
              )
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const receipt = await api<Receipt>(
                  "/record-imports/apply",
                  json({
                    id: preview.id,
                    sourceHash: preview.sourceHash,
                    choices,
                    confirm: true,
                  }),
                );
                setPreview({ ...preview, receipt });
                setConfirmed(false);
                void loadReports();
                onImported();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Import failed");
                setConfirmed(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Back up and import reviewed records
          </button>
        </>
      )}
      {preview?.receipt && (
        <div role="status">
          <h3>
            {preview.alreadyApplied
              ? "This file was already imported."
              : "Import completed."}
          </h3>
          <p>
            {preview.receipt.created} created · {preview.receipt.merged} merged
            · {preview.receipt.skipped} skipped. Backup:{" "}
            {preview.receipt.backup}
          </p>
          <button
            type="button"
            className="button secondary"
            onClick={() => void downloadReport(preview.receipt!.sourceHash)}
          >
            Download source and import report
          </button>
        </div>
      )}
      {reports.length > 0 && (
        <details>
          <summary>Completed imports ({reports.length})</summary>
          <ul>
            {reports.map((r) => (
              <li key={r.sourceHash}>
                {r.label} · {formatDate(r.importedAt, timezone, true)} ·{" "}
                {r.created} created / {r.merged} merged{" "}
                <button
                  type="button"
                  className="text-link"
                  onClick={() => void downloadReport(r.sourceHash)}
                >
                  Download report and source
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
