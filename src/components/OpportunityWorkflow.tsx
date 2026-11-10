import { uploadId } from "../lib/upload-queue";
import DecisionReview from "./DecisionReview";
import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import {
  AlertCircle,
  Briefcase,
  Check,
  FilePlus2,
  LoaderCircle,
  MessageSquare,
  RotateCcw,
  Wrench,
  X,
} from "lucide-react";
import { api, editedTimestamp, formatDate, json, localInput } from "../api";
import type {
  BoardDocument,
  Opportunity,
  OpportunityOffer,
  OpportunityReview,
} from "../types";
type Props = {
  opportunity: Opportunity;
  timezone: string;
  busy: boolean;
  onError?: (e: unknown) => void;
  onNotice?: (message: string) => void;
  onAssessed?: (saved: Opportunity) => void;
  onOpenBuddyWithPrompt?: (prompt: string) => void;
  mutate: (path: string, body: unknown, method?: string) => Promise<boolean>;
};
const reviewLabels = { proceed: "Proceed", ignore: "Ignore", defer: "Defer" };
function ReviewSnapshot({
  value,
  timezone,
}: {
  value: OpportunityReview;
  timezone: string;
}) {
  return (
    <div className="workflow-snapshot">
      <p>
        <strong>
          {value.decision ? reviewLabels[value.decision] : "Not decided"}
        </strong>{" "}
        · {formatDate(value.effectiveAt, timezone, true)}
      </p>
      {value.reason && (
        <p className="preserve-lines">
          <strong>Reason:</strong> {value.reason}
        </p>
      )}
      {value.strengths && (
        <p className="preserve-lines">
          <strong>Strengths:</strong> {value.strengths}
        </p>
      )}
      {value.gaps && (
        <p className="preserve-lines">
          <strong>Gaps:</strong> {value.gaps}
        </p>
      )}
    </div>
  );
}
type ReviewFormState = {
  strengths: string;
  gaps: string;
  decision: string;
  reason: string;
  effectiveAt: string;
  applyStage: boolean;
};

function areReviewFormsEqual(a: ReviewFormState, b: ReviewFormState): boolean {
  return (
    a.strengths === b.strengths &&
    a.gaps === b.gaps &&
    a.decision === b.decision &&
    a.reason === b.reason &&
    a.effectiveAt === b.effectiveAt &&
    a.applyStage === b.applyStage
  );
}

export function OpportunityReviewForm({
  opportunity: o,
  timezone,
  busy,
  mutate,
  onError = () => {},
  onNotice,
  onAssessed,
  onOpenBuddyWithPrompt,
}: Props) {
  const [form, setForm] = useState<ReviewFormState>({
    strengths: o.review?.strengths || "",
    gaps: o.review?.gaps || "",
    decision: o.review?.decision || "",
    reason: o.review?.reason || "",
    effectiveAt: localInput(o.review?.effectiveAt || ""),
    applyStage: false,
  });
  const [undoStack, setUndoStack] = useState<ReviewFormState[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "undone" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [assessing, setAssessing] = useState(false);
  const [addressingGap, setAddressingGap] = useState<string | null>(null);
  const [gapNote, setGapNote] = useState("");
  const [gapProjectTitle, setGapProjectTitle] = useState("");
  const [gapBusy, setGapBusy] = useState<"" | "master-cv" | "project">("");

  const formRef = useRef(form);
  formRef.current = form;
  const lastSavedRef = useRef<ReviewFormState>(form);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const latestOppRef = useRef(o);
  latestOppRef.current = o;

  const performSave = useCallback(
    async (targetForm: ReviewFormState, isUndo = false) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (!isUndo && areReviewFormsEqual(targetForm, lastSavedRef.current)) {
        return true;
      }
      if (isSavingRef.current) {
        pendingSaveRef.current = true;
        return false;
      }
      isSavingRef.current = true;
      setSaveStatus("saving");

      const prior = lastSavedRef.current;
      const body = {
        ...targetForm,
        effectiveAt: editedTimestamp(targetForm.effectiveAt, latestOppRef.current.review?.effectiveAt),
        revision: latestOppRef.current.revision,
      };

      try {
        const ok = await mutate(`/opportunities/${latestOppRef.current.id}/review`, body, "PATCH");
        if (ok) {
          if (!isUndo) {
            setUndoStack((prev) => [...prev.slice(-19), prior]);
            setSaveStatus("saved");
            setStatusMessage("Review saved");
          } else {
            setSaveStatus("undone");
            setStatusMessage("Undid last change");
          }
          lastSavedRef.current = { ...targetForm };
        } else {
          setSaveStatus("error");
          setStatusMessage("Could not save review");
        }
        return ok;
      } catch {
        setSaveStatus("error");
        setStatusMessage("Could not save review");
        return false;
      } finally {
        isSavingRef.current = false;
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          void performSave(formRef.current);
        }
      }
    },
    [mutate],
  );

  const scheduleSave = useCallback(
    (updatedForm: ReviewFormState, delay = 600) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
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

  const set = (key: keyof ReviewFormState, value: string | boolean, delay = 600) => {
    const updated = { ...formRef.current, [key]: value };
    setForm(updated);
    scheduleSave(updated, delay);
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
            <span>{statusMessage || "Review saved"}</span>
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
            <span>{statusMessage || "Could not save review"}</span>
          </span>
        )}
      </div>
      <button
        type="button"
        className="button secondary small undo-button"
        disabled={undoStack.length === 0 || saveStatus === "saving" || busy || assessing}
        onClick={() => void handleUndo()}
        title="Undo last change (Cmd+Z or Ctrl+Z)"
      >
        <RotateCcw size={13} />
        Undo last change
      </button>
    </div>
  );

  const parsedGaps = form.gaps
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);

  return (
    <section className="workflow-section" aria-label="Fit assessment">
      <DecisionReview opportunity={o} onError={onError} disabled={busy} onBusy={setAssessing} onAssessed={(draft, savedOpportunity) => {
        const updated = {
          ...formRef.current,
          strengths: draft.strengths,
          gaps: draft.gaps,
          effectiveAt: localInput(draft.effectiveAt),
        };
        setForm(updated);
        lastSavedRef.current = updated;
        setSaveStatus("saved");
        setStatusMessage("Fit assessment saved");
        onAssessed?.(savedOpportunity);
      }}/>
      <div className="section-intro">
        <h3>Fit Summary: Strengths &amp; Gaps</h3>
        <p>
          Review your matched strengths and address any identified gaps by adding evidence to your Master CV, saving a Project in Career Docs, or refining with Career Buddy.
        </p>
      </div>
      {renderAutoSaveBar(true)}
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
        <fieldset className="workflow-fields" disabled={busy || assessing}>
          <div className="form-grid">
            <label className="field wide">
              <span>Strengths for this opportunity</span>
              <textarea
                rows={4}
                maxLength={50000}
                value={form.strengths}
                onChange={(e) => set("strengths", e.target.value, 600)}
                onBlur={handleBlur}
                placeholder="Relevant skills, achievements and experience…"
              />
            </label>
            <label className="field wide">
              <span>Gaps / areas to address</span>
              <textarea
                rows={4}
                maxLength={50000}
                value={form.gaps}
                onChange={(e) => set("gaps", e.target.value, 600)}
                onBlur={handleBlur}
                placeholder="Missing experience, unanswered questions or trade-offs…"
              />
            </label>
          </div>
        </fieldset>
        {renderAutoSaveBar(false)}
      </form>

      {parsedGaps.length > 0 && (
        <div className="fit-gaps-action-panel" style={{ marginTop: 18, padding: 16, border: "1px solid var(--line)", borderRadius: 10, background: "var(--surface)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <strong>Address Identified Gaps ({parsedGaps.length})</strong>
            <small className="text-muted">Click any gap to add supporting experience to your Master CV, a Project, or Career Buddy</small>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {parsedGaps.map((gapItem, idx) => (
              <li
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 12px",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  background: "var(--panel-soft)",
                }}
              >
                <span style={{ fontSize: 13, lineHeight: 1.45, flex: 1 }}>{gapItem}</span>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => {
                    setAddressingGap(gapItem);
                    setGapNote("");
                    setGapProjectTitle(
                      `Project Evidence - ${gapItem.slice(0, 48).replace(/[^\p{L}\p{N} _-]/gu, "").trim() || o.role}`,
                    );
                  }}
                >
                  <Wrench size={13} /> Address Gap
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {addressingGap && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (!gapBusy) setAddressingGap(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="address-gap-modal-title"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 620 }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h2 id="address-gap-modal-title" style={{ margin: 0, fontSize: 18 }}>
                Address Fit Gap
              </h2>
              <button
                type="button"
                className="icon-button"
                disabled={!!gapBusy}
                onClick={() => setAddressingGap(null)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                background: "var(--accent-soft)",
                border: "1px solid var(--line)",
                marginBottom: 14,
                fontSize: 13,
              }}
            >
              <strong>Gap / Requirement:</strong> {addressingGap}
            </div>

            <label className="field" style={{ marginBottom: 12 }}>
              <span>How does your experience or project work address this gap?</span>
              <textarea
                rows={5}
                autoFocus
                disabled={!!gapBusy}
                value={gapNote}
                onChange={(e) => setGapNote(e.target.value)}
                placeholder="Write a bullet point, achievement, or notes about relevant experience you have that addresses this gap…"
              />
            </label>

            <label className="field" style={{ marginBottom: 16 }}>
              <span>Project file title (if saving as a Project in Career Docs)</span>
              <input
                type="text"
                disabled={!!gapBusy}
                value={gapProjectTitle}
                onChange={(e) => setGapProjectTitle(e.target.value)}
                placeholder="Project Evidence"
              />
            </label>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="button secondary"
                disabled={!!gapBusy}
                onClick={() => {
                  const draftContext = gapNote.trim()
                    ? `Here is my draft experience for this gap:\n"${gapNote.trim()}"\n\nPlease help me refine this into a strong, factual achievement bullet and update my Master CV.`
                    : `Please help me brainstorm and refine how my existing career experience can address this gap, and propose an update for my Master CV.`;
                  const prompt = `I want to address this fit gap for ${o.role} at ${o.company}:\n"${addressingGap}"\n\n${draftContext}`;
                  setAddressingGap(null);
                  onOpenBuddyWithPrompt?.(prompt);
                }}
              >
                <MessageSquare size={15} />
                Chat with Career Buddy
              </button>

              <button
                type="button"
                className="button secondary"
                disabled={!!gapBusy || !gapNote.trim()}
                onClick={async () => {
                  setGapBusy("project");
                  try {
                    const cleanTitle =
                      (gapProjectTitle.trim() || "Project Evidence")
                        .replace(/[/\\:*?"<>|\0]/g, "-")
                        .replace(/\.md$/i, "") + ".md";
                    const mdContent = `# ${cleanTitle.replace(/\.md$/i, "")}\n\n**Target Role:** ${o.role} at ${o.company}\n**Addressed Requirement / Gap:** ${addressingGap}\n\n## Evidence & Achievements\n${gapNote.trim()}\n`;
                    const bytes = new TextEncoder().encode(mdContent);
                    let binary = "";
                    for (const b of bytes) binary += String.fromCharCode(b);
                    const contentBase64 = btoa(binary);
                    const created = await api<BoardDocument>(
                      "/documents",
                      json({
                        name: `Projects/${cleanTitle}`,
                        kind: "reference",
                        category: "project",
                        status: "draft",
                        contentBase64,
                        notes: `Project evidence addressing gap for ${o.company} (${o.role}).`,
                      }),
                    );
                    await api("/buddy/index", json({ documentIds: [created.id] })).catch(() => {});
                    onNotice?.(`Saved "${cleanTitle}" to Projects in Career Docs.`);
                    setAddressingGap(null);
                  } catch (err) {
                    onError(err);
                  } finally {
                    setGapBusy("");
                  }
                }}
              >
                {gapBusy === "project" ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Briefcase size={15} />
                )}
                Add to a Project
              </button>

              <button
                type="button"
                className="button primary"
                disabled={!!gapBusy || !gapNote.trim()}
                onClick={async () => {
                  setGapBusy("master-cv");
                  try {
                    const res = await api<{ message: string }>(
                      "/document-studio/master-cv/append",
                      json({
                        gap: addressingGap,
                        content: gapNote.trim(),
                        heading: "Additional Experience & Evidence",
                      }),
                    );
                    onNotice?.(res.message || "Added evidence to Master CV.");
                    setAddressingGap(null);
                  } catch (err) {
                    onError(err);
                  } finally {
                    setGapBusy("");
                  }
                }}
              >
                {gapBusy === "master-cv" ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <FilePlus2 size={15} />
                )}
                Add to Master CV
              </button>
            </div>
          </section>
        </div>
      )}

      {!!o.review?.history?.length && (
        <details className="workflow-history">
          <summary>
            {o.review.history.length} earlier review revision
            {o.review.history.length === 1 ? "" : "s"}
          </summary>
          {[...o.review.history].reverse().map((r, i) => (
            <article key={i}>
              <small>Changed {formatDate(r.changedAt, timezone, true)}</small>
              <ReviewSnapshot value={r} timezone={timezone} />
            </article>
          ))}
        </details>
      )}
    </section>
  );
}
const emptyOffer = {
  title: "",
  compensation: "",
  terms: "",
  contact: "",
  offeredAt: "",
  responseDueDate: "",
  startDate: "",
  decision: "pending",
  decidedAt: "",
  decisionReason: "",
  documentIds: [] as string[],
};
export function OpportunityOffers({
  opportunity: o,
  timezone,
  busy,
  mutate,
}: Props) {
  const [form, setForm] = useState(emptyOffer),
    [editing, setEditing] = useState(""),
    [open, setOpen] = useState(false),
    [requestId, setRequestId] = useState("");
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const docs = o.documents || [];
  function attachments(ids: string[] = []) {
    return ids.length ? (
      <ul className="activity-attachments">
        {ids.map((id) => {
          const d = docs.find((d) => d.id === id);
          return (
            <li key={id}>
              {d ? (
                <a
                  href={d.url || `/api/documents/${id}/content`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {d.name} · v{d.version}
                </a>
              ) : (
                <span>Offer document unavailable (removed document)</span>
              )}
            </li>
          );
        })}
      </ul>
    ) : null;
  }
  function start(offer?: OpportunityOffer) {
    setEditing(offer?.id || "");
    setRequestId(uploadId());
    setForm(
      offer
        ? {
            title: offer.title,
            compensation: offer.compensation,
            terms: offer.terms,
            contact: offer.contact,
            offeredAt: localInput(offer.offeredAt),
            responseDueDate: offer.responseDueDate,
            startDate: offer.startDate,
            decision: offer.decision,
            decidedAt: localInput(offer.decidedAt),
            decisionReason: offer.decisionReason,
            documentIds: offer.documentIds || [],
          }
        : emptyOffer,
    );
    setOpen(true);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    const previous = o.offers?.find((v) => v.id === editing);
    if (
      await mutate(
        `/opportunities/${o.id}/offers${editing ? `/${editing}` : ""}`,
        {
          ...form,
          offeredAt: editedTimestamp(form.offeredAt, previous?.offeredAt),
          decidedAt: editedTimestamp(form.decidedAt, previous?.decidedAt),
          revision: o.revision,
          ...(!editing ? { requestId } : {}),
        },
        editing ? "PATCH" : "POST",
      )
    ) {
      setOpen(false);
      setEditing("");
      setForm(emptyOffer);
    }
  }
  function details(offer: OpportunityOffer) {
    return (
      <div className="workflow-snapshot">
        <p>
          <strong>
            {offer.decision[0].toUpperCase() + offer.decision.slice(1)}
          </strong>{" "}
          · Offered {formatDate(offer.offeredAt, timezone, true)}
        </p>
        {offer.compensation && (
          <p className="preserve-lines">
            <strong>Compensation:</strong> {offer.compensation}
          </p>
        )}
        {offer.terms && (
          <p className="preserve-lines">
            <strong>Terms / conditions:</strong> {offer.terms}
          </p>
        )}
        {offer.contact && (
          <p>
            <strong>Contact:</strong> {offer.contact}
          </p>
        )}
        {offer.responseDueDate && (
          <p>
            <strong>Respond by:</strong>{" "}
            {formatDate(offer.responseDueDate, timezone)}
          </p>
        )}
        {offer.startDate && (
          <p>
            <strong>Proposed start:</strong>{" "}
            {formatDate(offer.startDate, timezone)}
          </p>
        )}
        {offer.decidedAt && (
          <p>
            <strong>Decision date:</strong>{" "}
            {formatDate(offer.decidedAt, timezone, true)}
          </p>
        )}
        {offer.decisionReason && (
          <p className="preserve-lines">
            <strong>Decision reason:</strong> {offer.decisionReason}
          </p>
        )}
        {attachments(offer.documentIds)}
      </div>
    );
  }
  return (
    <section aria-label="Offers and decisions">
      <div className="section-intro with-action">
        <div>
          <h3>Offers and decisions</h3>
          <p>
            Record each offer, its terms and your response. Recording or
            accepting an offer does not mark you as Hired; record the confirmed
            outcome in Overview.
          </p>
        </div>
        <button
          className="button secondary small"
          disabled={busy}
          onClick={() => start()}
        >
          Add offer
        </button>
      </div>
      {open && (
        <form className="inset-form" onSubmit={submit}>
          <fieldset className="workflow-fields" disabled={busy}>
            <div className="form-grid">
              <label className="field wide">
                <span>Offer title</span>
                <input
                  required
                  maxLength={200}
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                  placeholder="Initial offer, revised package…"
                />
              </label>
              <label className="field">
                <span>Offer date and time</span>
                <input
                  type="datetime-local"
                  value={form.offeredAt}
                  onChange={(e) => set("offeredAt", e.target.value)}
                />
                <small>
                  Leave empty to use the current time. Uses this device’s
                  timezone.
                </small>
              </label>
              <label className="field">
                <span>Response due date</span>
                <input
                  type="date"
                  value={form.responseDueDate}
                  onChange={(e) => set("responseDueDate", e.target.value)}
                />
              </label>
              <label className="field wide">
                <span>Compensation / package</span>
                <textarea
                  rows={2}
                  maxLength={5000}
                  value={form.compensation}
                  onChange={(e) => set("compensation", e.target.value)}
                  placeholder="Amount, currency, period, bonus and benefits…"
                />
              </label>
              <label className="field wide">
                <span>Terms / conditions</span>
                <textarea
                  rows={3}
                  maxLength={50000}
                  value={form.terms}
                  onChange={(e) => set("terms", e.target.value)}
                  placeholder="Working arrangement, conditions, outstanding questions…"
                />
              </label>
              <label className="field">
                <span>Offer contact</span>
                <input
                  maxLength={5000}
                  value={form.contact}
                  onChange={(e) => set("contact", e.target.value)}
                />
              </label>
              <label className="field">
                <span>Proposed start date</span>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => set("startDate", e.target.value)}
                />
              </label>
              <label className="field">
                <span>Offer decision</span>
                <select
                  value={form.decision}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      decision: e.target.value,
                      decidedAt: "",
                    }))
                  }
                >
                  <option value="pending">Pending</option>
                  <option value="accepted">Accepted</option>
                  <option value="declined">Declined</option>
                  <option value="withdrawn">Withdrawn by employer</option>
                  <option value="expired">Expired</option>
                </select>
              </label>
              {form.decision !== "pending" && (
                <label className="field">
                  <span>Offer decision date and time</span>
                  <input
                    type="datetime-local"
                    value={form.decidedAt}
                    onChange={(e) => set("decidedAt", e.target.value)}
                  />
                  <small>
                    Leave empty to use the current time. Uses this device’s
                    timezone.
                  </small>
                </label>
              )}
              <label className="field wide">
                <span>Offer decision reason / notes</span>
                <textarea
                  rows={3}
                  maxLength={10000}
                  value={form.decisionReason}
                  onChange={(e) => set("decisionReason", e.target.value)}
                />
              </label>
              <fieldset className="activity-document-picker">
                <legend>Offer documents</legend>
                <p className="quiet-empty">
                  Upload an offer letter in Documents, then link its version
                  here. Unlinking preserves the original.
                </p>
                {docs.map((d) => (
                  <label className="check-field" key={d.id}>
                    <input
                      type="checkbox"
                      checked={form.documentIds.includes(d.id)}
                      onChange={(e) =>
                        setForm((current) => ({
                          ...current,
                          documentIds: e.target.checked
                            ? [...current.documentIds, d.id]
                            : current.documentIds.filter((id) => id !== d.id),
                        }))
                      }
                    />
                    {d.name} · v{d.version}
                  </label>
                ))}
                {form.documentIds
                  .filter((id) => !docs.some((d) => d.id === id))
                  .map((id) => (
                    <label className="check-field" key={id}>
                      <input
                        type="checkbox"
                        checked
                        onChange={() =>
                          setForm((current) => ({
                            ...current,
                            documentIds: current.documentIds.filter(
                              (v) => v !== id,
                            ),
                          }))
                        }
                      />
                      Unavailable offer document — untick to unlink
                    </label>
                  ))}
              </fieldset>
            </div>
          </fieldset>
          <div className="form-actions">
            <button
              type="button"
              className="button secondary small"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button className="button primary small" disabled={busy}>
              {busy ? "Saving…" : "Save offer"}
            </button>
          </div>
        </form>
      )}
      <div className="workflow-offer-list">
        {[...(o.offers || [])].reverse().map((offer) => (
          <article className="workflow-offer" key={offer.id}>
            <div className="section-intro with-action">
              <h4>{offer.title}</h4>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => start(offer)}
              >
                Edit offer
              </button>
            </div>
            {details(offer)}
            {!!offer.history?.length && (
              <details className="workflow-history">
                <summary>
                  {offer.history.length} earlier offer revision
                  {offer.history.length === 1 ? "" : "s"}
                </summary>
                {[...offer.history].reverse().map((h, i) => (
                  <article key={i}>
                    <small>
                      Changed {formatDate(h.changedAt, timezone, true)}
                    </small>
                    <h4>{h.title}</h4>
                    {details(h)}
                  </article>
                ))}
              </details>
            )}
          </article>
        ))}
      </div>
      {!o.offers?.length && !open && (
        <div className="empty-state">
          <h3>No offers recorded yet</h3>
          <p>
            An offer can remain pending while you compare terms or negotiate.
          </p>
        </div>
      )}
    </section>
  );
}
