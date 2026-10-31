import { useEffect, useState } from "react";
import { api, json } from "../api";
import type { Opportunity } from "../types";
type Doc = {
  id: string;
  name: string;
  version: number;
  status: string;
  category?: string;
  kind: string;
  url: string;
};
type Pack = {
  id: string;
  title: string;
  state: string;
  documents: (Doc & { sha256: string })[];
  supportingStatement: string;
  answers: { question: string; answer: string }[];
  coverLetterNotRequired: boolean;
  approvedAt?: string;
  submission?: {
    submittedAt: string;
    recordedAt: string;
    applicationRoute: string;
    receipt: string;
    eventId: string;
  };
};
export default function ApplicationPacks({
  opportunity,
  onChanged,
  onError,
  timezone,
}: {
  opportunity: Opportunity;
  timezone: string;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const [data, setData] = useState<{
      opportunityRevision: number;
      packs: Pack[];
      documents: Doc[];
    } | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [title, setTitle] = useState("Application pack"),
    [ids, setIds] = useState<string[]>([]),
    [statement, setStatement] = useState(""),
    [answers, setAnswers] = useState<{ question: string; answer: string }[]>(
      [],
    ),
    [noCover, setNoCover] = useState(false),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(""),
    [submitId, setSubmitId] = useState(""),
    [date, setDate] = useState(""),
    [route, setRoute] = useState(""),
    [receipt, setReceipt] = useState(""),
    [advance, setAdvance] = useState(true),
    [notice, setNotice] = useState("");
  const [documentQuery, setDocumentQuery] = useState(""),
    [allTypes, setAllTypes] = useState(false);
  const matching = (data?.documents || []).filter(
    (d) =>
      ids.includes(d.id) ||
      ((allTypes ||
        ["cv", "cover"].includes(d.kind) ||
        [
          "master-cv",
          "tailored-cv",
          "cv",
          "cover-letter",
          "supporting-statement",
        ].includes(d.category || "")) &&
        d.name.toLowerCase().includes(documentQuery.toLowerCase())),
  );
  const visibleDocuments = [
    ...matching.filter((d) => ids.includes(d.id)),
    ...matching.filter((d) => !ids.includes(d.id)),
  ].slice(0, 100);
  const base = "/opportunities/" + opportunity.id + "/packs";
  async function load() {
    setData(await api(base));
  }
  useEffect(() => {
    void load().catch(onError);
  }, [opportunity.id, opportunity.revision]);
  function edit(p?: Pack) {
    setEditing(p?.id || "new");
    setTitle(p?.title || "Application pack");
    setIds(p?.documents.map((d) => d.id) || []);
    setStatement(p?.supportingStatement || "");
    setAnswers(p?.answers || []);
    setNoCover(p?.coverLetterNotRequired || false);
    setConfirmed("");
  }
  async function action(path: string, body: object, method = "POST") {
    if (!data) return;
    setBusy(true);
    setNotice("");
    try {
      await api(
        base + path,
        json({ revision: data.opportunityRevision, ...body }, method),
      );
      setEditing(null);
      setSubmitId("");
      setConfirmed("");
      await load();
      onChanged();
      setNotice("Application pack saved in the board.");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="application-packs">
      <h3>Application packs</h3>
      <p>
        Group exact document versions, supporting text and application answers.
        Approve a pack after review, then record a submission you made outside
        the board. Submitted packs and their file versions are preserved.
      </p>
      <div className="form-actions">
        <button
          type="button"
          className="button primary small"
          disabled={busy || editing !== null}
          onClick={() => edit()}
        >
          New application pack
        </button>
        <button
          type="button"
          className="button secondary small"
          disabled={busy}
          onClick={() => void load().catch(onError)}
        >
          Refresh packs
        </button>
      </div>
      {editing !== null && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(
              editing === "new" ? "" : "/" + editing,
              {
                title,
                documentIds: ids,
                supportingStatement: statement,
                answers,
                coverLetterNotRequired: noCover,
              },
              editing === "new" ? "POST" : "PATCH",
            );
          }}
        >
          <div className="form-grid">
            <label className="field wide">
              <span>Pack title</span>
              <input
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <fieldset className="field wide">
              <legend>Exact document versions</legend>
              <label className="field">
                <span>Find pack documents</span>
                <input
                  value={documentQuery}
                  onChange={(e) => setDocumentQuery(e.target.value)}
                  placeholder="Search by filename"
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={allTypes}
                  onChange={(e) => setAllTypes(e.target.checked)}
                />{" "}
                Show all eligible document types
              </label>
              <p>
                {ids.length}/30 selected · showing {visibleDocuments.length} of{" "}
                {matching.length} matches. Selected versions remain visible.
              </p>
              {visibleDocuments.map((d) => (
                <label className="check-label" key={d.id}>
                  <input
                    type="checkbox"
                    checked={ids.includes(d.id)}
                    onChange={(e) =>
                      setIds((v) =>
                        e.target.checked
                          ? [...v, d.id]
                          : v.filter((id) => id !== d.id),
                      )
                    }
                  />
                  {d.name} · v{d.version} · {d.status}
                </label>
              ))}
              {!data?.documents.length && (
                <p>
                  Upload documents below or add them to Career Hub first.
                </p>
              )}
            </fieldset>
            <label className="check-label">
              <input
                type="checkbox"
                checked={noCover}
                onChange={(e) => setNoCover(e.target.checked)}
              />{" "}
              Cover letter not required
            </label>
            <label className="field wide">
              <span>Supporting statement</span>
              <textarea
                maxLength={50000}
                rows={6}
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
              />
            </label>
          </div>
          {answers.map((a, i) => (
            <div className="form-grid" key={i}>
              <label className="field">
                <span>Question {i + 1}</span>
                <textarea
                  maxLength={1000}
                  required
                  value={a.question}
                  onChange={(e) =>
                    setAnswers((v) =>
                      v.map((x, j) =>
                        j === i ? { ...x, question: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <label className="field">
                <span>Answer {i + 1}</span>
                <textarea
                  maxLength={10000}
                  rows={5}
                  required
                  value={a.answer}
                  onChange={(e) =>
                    setAnswers((v) =>
                      v.map((x, j) =>
                        j === i ? { ...x, answer: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="button secondary small"
                onClick={() => setAnswers((v) => v.filter((_, j) => j !== i))}
              >
                Remove answer {i + 1}
              </button>
            </div>
          ))}
          <div className="form-actions">
            <button
              type="button"
              className="button secondary small"
              disabled={answers.length >= 20 || busy}
              onClick={() =>
                setAnswers((v) => [...v, { question: "", answer: "" }])
              }
            >
              Add application answer
            </button>
            <button
              type="button"
              className="button secondary small"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              Cancel editing
            </button>
            <button className="button primary small" disabled={busy}>
              Save draft pack
            </button>
          </div>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {data?.packs.map((p) => (
        <details key={p.id}>
          <summary>
            {p.title} · {p.state}
          </summary>
          <p>
            {p.coverLetterNotRequired
              ? "Cover letter not required"
              : "Cover letter required"}
            {p.approvedAt
              ? " · Approved " +
                new Date(p.approvedAt).toLocaleString(undefined, {
                  timeZone: timezone,
                })
              : ""}
          </p>
          <ul>
            {p.documents.map((d) => (
              <li key={d.id}>
                <a href={"/api/documents/" + d.id + "/content"}>
                  {d.name} · v{d.version}
                </a>
                <small> · SHA-256 {d.sha256}</small>
              </li>
            ))}
          </ul>
          {p.supportingStatement && (
            <div className="pack-text">
              <h4>Supporting statement</h4>
              {p.supportingStatement}
            </div>
          )}
          {p.answers.map((a, i) => (
            <div className="pack-text" key={i}>
              <h4>{a.question}</h4>
              {a.answer}
            </div>
          ))}
          {p.submission && (
            <div>
              <p>
                Submitted:{" "}
                {new Date(p.submission.submittedAt).toLocaleString(undefined, {
                  timeZone: timezone,
                })}
              </p>
              <p>
                Recorded:{" "}
                {new Date(p.submission.recordedAt).toLocaleString(undefined, {
                  timeZone: timezone,
                })}
              </p>
              <p>Route: {p.submission.applicationRoute || "Not recorded"}</p>
              <p>Receipt/reference: {p.submission.receipt || "Not recorded"}</p>
            </div>
          )}
          <div className="form-actions">
            {p.state === "draft" && (
              <button
                type="button"
                className="button secondary small"
                disabled={busy || editing !== null}
                onClick={() => edit(p)}
              >
                Edit draft
              </button>
            )}
            <button
              type="button"
              className="button secondary small"
              disabled={busy || editing !== null}
              onClick={() => void action("/" + p.id + "/copy", {})}
            >
              Copy to new draft
            </button>
            <a
              className="button secondary small"
              href={"/api" + base + "/" + p.id + "/download"}
            >
              Download pack ZIP
            </a>
          </div>
          {p.state === "draft" && (
            <div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={confirmed === p.id}
                  onChange={(e) => setConfirmed(e.target.checked ? p.id : "")}
                />{" "}
                I reviewed these exact files, supporting text and answers.
                Approve this pack and its draft documents.
              </label>
              <button
                type="button"
                className="button primary small"
                disabled={busy || editing !== null || confirmed !== p.id}
                onClick={() =>
                  void action("/" + p.id + "/approve", { confirm: true })
                }
              >
                Approve application pack
              </button>
            </div>
          )}
          {p.state === "approved" && submitId !== p.id && (
            <button
              type="button"
              className="button primary small"
              disabled={busy}
              onClick={() => {
                setSubmitId(p.id);
                setConfirmed("");
                const d = new Date();
                setDate(
                  new Date(d.getTime() - d.getTimezoneOffset() * 60000)
                    .toISOString()
                    .slice(0, 16),
                );
                setAdvance(
                  [
                    "identification",
                    "review",
                    "documents",
                    "application-review",
                  ].includes(opportunity.stage),
                );
              }}
            >
              Record submitted application
            </button>
          )}
          {p.state === "approved" && submitId === p.id && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action("/" + p.id + "/submit", {
                  confirm: true,
                  submittedAt: new Date(date).toISOString(),
                  applicationRoute: route,
                  receipt,
                  advanceStage: advance,
                });
              }}
            >
              <div className="form-grid">
                <label className="field">
                  <span>Submission date and time (this device)</span>
                  <input
                    type="datetime-local"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Application route</span>
                  <input
                    maxLength={1000}
                    placeholder="Employer portal, recruiter, email…"
                    value={route}
                    onChange={(e) => setRoute(e.target.value)}
                  />
                </label>
                <label className="field wide">
                  <span>Receipt or reference</span>
                  <input
                    maxLength={2000}
                    value={receipt}
                    onChange={(e) => setReceipt(e.target.value)}
                  />
                </label>
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={advance}
                  onChange={(e) => setAdvance(e.target.checked)}
                />{" "}
                Move opportunity to Submitted
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={confirmed === p.id}
                  onChange={(e) => setConfirmed(e.target.checked ? p.id : "")}
                />{" "}
                I submitted this application outside the board. Preserve these
                file versions as submitted.
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => setSubmitId("")}
                >
                  Cancel
                </button>
                <button
                  className="button primary small"
                  disabled={busy || confirmed !== p.id}
                >
                  Confirm submission record
                </button>
              </div>
            </form>
          )}
        </details>
      ))}
    </section>
  );
}
