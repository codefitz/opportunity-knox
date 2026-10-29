import { useState, type FormEvent } from "react";
import { editedTimestamp, formatDate, localInput } from "../api";
import type {
  Opportunity,
  OpportunityOffer,
  OpportunityReview,
} from "../types";
type Props = {
  opportunity: Opportunity;
  timezone: string;
  busy: boolean;
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
export function OpportunityReviewForm({
  opportunity: o,
  timezone,
  busy,
  mutate,
}: Props) {
  const [form, setForm] = useState({
    strengths: o.review?.strengths || "",
    gaps: o.review?.gaps || "",
    decision: o.review?.decision || "",
    reason: o.review?.reason || "",
    effectiveAt: localInput(o.review?.effectiveAt || ""),
    applyStage: false,
  });
  const [saved, setSaved] = useState(false);
  const set = (key: string, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (
      await mutate(
        `/opportunities/${o.id}/review`,
        {
          ...form,
          effectiveAt: editedTimestamp(form.effectiveAt, o.review?.effectiveAt),
          revision: o.revision,
        },
        "PATCH",
      )
    )
      setSaved(true);
  }
  return (
    <section className="workflow-section" aria-label="Your review decision">
      <div className="section-intro">
        <h3>Your review decision</h3>
        <p>
          Keep your own strengths, gaps and decision alongside Career Buddy’s
          assessment. No AI is needed.
        </p>
      </div>
      <form onSubmit={submit}>
        <fieldset className="workflow-fields" disabled={busy}>
          <div className="form-grid">
            <label className="field wide">
              <span>Strengths for this opportunity</span>
              <textarea
                rows={3}
                maxLength={50000}
                value={form.strengths}
                onChange={(e) => set("strengths", e.target.value)}
                placeholder="Relevant skills, achievements and experience…"
              />
            </label>
            <label className="field wide">
              <span>Gaps / concerns</span>
              <textarea
                rows={3}
                maxLength={50000}
                value={form.gaps}
                onChange={(e) => set("gaps", e.target.value)}
                placeholder="Missing experience, unanswered questions or trade-offs…"
              />
            </label>
            <label className="field">
              <span>Your decision</span>
              <select
                value={form.decision}
                onChange={(e) => {
                  setForm((current) => ({
                    ...current,
                    decision: e.target.value,
                    effectiveAt: "",
                    applyStage: false,
                  }));
                  setSaved(false);
                }}
              >
                <option value="">Not decided</option>
                <option value="proceed">Proceed</option>
                <option value="ignore">Ignore</option>
                <option value="defer">Defer</option>
              </select>
            </label>
            <label className="field">
              <span>Review date and time</span>
              <input
                type="datetime-local"
                value={form.effectiveAt}
                onChange={(e) => set("effectiveAt", e.target.value)}
              />
              <small>
                Leave empty to use the current time. Uses this device’s
                timezone.
              </small>
            </label>
            <label className="field wide">
              <span>Decision reason</span>
              <textarea
                rows={3}
                required={!!form.decision}
                maxLength={50000}
                value={form.reason}
                onChange={(e) => set("reason", e.target.value)}
                placeholder="Why are you proceeding, ignoring or deferring?"
              />
            </label>
            {!!form.decision && !o.outcome && (
              <div className="wide">
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={form.applyStage}
                    onChange={(e) => set("applyStage", e.target.checked)}
                  />
                  Also update the workflow stage
                </label>
                <p className="quiet-empty">
                  {form.decision === "proceed"
                    ? "Move to CV & cover letter."
                    : form.decision === "ignore"
                      ? "Close this opportunity as Ignored."
                      : "Move to Review for later consideration."}{" "}
                  Leave unticked to record your decision at the current stage.
                </p>
              </div>
            )}
          </div>
        </fieldset>
        <div className="form-actions">
          {saved && (
            <span role="status" className="saved">
              Review saved
            </span>
          )}
          <button className="button primary small" disabled={busy}>
            {busy ? "Saving…" : "Save review"}
          </button>
        </div>
      </form>
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
    setRequestId(crypto.randomUUID());
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
