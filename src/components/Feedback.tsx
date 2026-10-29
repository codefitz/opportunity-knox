import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, json } from "../api";
type Entry = {
  id: string;
  text: string;
  page: string;
  status: string;
  revision: number;
  createdAt: string;
  reviewStatus: string;
  review?: {
    summary: string;
    priority: string;
    improvements: string[];
    questions: string[];
    reviewedAt: string;
    provider: string;
    model: string;
  };
};
export default function Feedback({
  authenticated,
}: {
  authenticated: boolean;
}) {
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState<"write" | "inbox">("write"),
    [text, setText] = useState(""),
    [page, setPage] = useState("other"),
    [items, setItems] = useState<Entry[]>([]),
    [aiAvailable, setAIAvailable] = useState(false),
    [reviewAfterSave, setReviewAfterSave] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [shown, setShown] = useState(20);
  const dialog = useRef<HTMLDialogElement>(null),
    launcher = useRef<HTMLButtonElement>(null),
    submission = useRef<{ key: string; id: string } | null>(null);
  async function load() {
    if (!authenticated) return;
    const r = await api<{ items: Entry[]; aiAvailable: boolean }>("/feedback");
    setItems(r.items);
    setAIAvailable(r.aiAvailable);
  }
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      if (authenticated) void load().catch((e) => setError(e.message));
    } else if (dialog.current?.open) dialog.current.close();
  }, [open, authenticated]);
  function close() {
    setOpen(false);
    launcher.current?.focus();
  }
  async function review(id: string) {
    setBusy(id);
    setError("");
    try {
      await api("/feedback/" + id + "/review", json({ confirm: true }));
      setNotice("AI suggestions saved for review. No app changes were made.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
      await load().catch((e) => setError(e.message));
    }
  }
  async function submit() {
    setBusy("saving");
    setError("");
    setNotice("");
    const key = JSON.stringify([text.trim(), page]);
    if (submission.current?.key !== key)
      submission.current = { key, id: crypto.randomUUID() };
    try {
      const r = await api<{ item: Entry }>(
        "/feedback",
        json({ text, page, requestId: submission.current.id }),
      );
      setText("");
      submission.current = null;
      setNotice("Feedback saved.");
      setTab("inbox");
      await load();
      if (reviewAfterSave) await review(r.item.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  function begin() {
    const route =
      window.location.hash.replace(/^#\//, "").split(/[/?]/)[0] || "dashboard";
    if (!text.trim())
      setPage(
        authenticated &&
          [
            "dashboard",
            "opportunities",
            "board",
            "kanban",
            "tasks",
            "todos",
            "library",
            "buddy",
            "settings",
          ].includes(route)
          ? route
          : authenticated
            ? "other"
            : "sign-in",
      );
    setOpen(true);
    setError("");
  }
  return (
    <>
      <button
        ref={launcher}
        type="button"
        className="feedback-launcher"
        onClick={begin}
      >
        Feedback
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          className="feedback-dialog"
          aria-labelledby="feedback-title"
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div className="feedback-heading">
            <h2 id="feedback-title">Feedback</h2>
            <button
              type="button"
              className="button secondary small"
              onClick={close}
            >
              Close feedback
            </button>
          </div>
          <p>Share a problem or suggest an improvement to Opportunity Knox.</p>
          {!authenticated && (
            <p>Sign in to save feedback and view the inbox.</p>
          )}
          <div className="library-tool-actions">
            <button
              type="button"
              className={
                "button " +
                (tab === "write" ? "primary" : "secondary") +
                " small"
              }
              onClick={() => setTab("write")}
            >
              Write feedback
            </button>
            <button
              type="button"
              className={
                "button " +
                (tab === "inbox" ? "primary" : "secondary") +
                " small"
              }
              disabled={!authenticated}
              onClick={() => {
                setTab("inbox");
                void load().catch((e) => setError(e.message));
              }}
            >
              Saved feedback ({items.length})
            </button>
          </div>
          {error && (
            <p className="feedback-error" role="alert">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {tab === "write" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <label className="field">
                <span>Your feedback</span>
                <textarea
                  autoFocus
                  rows={7}
                  maxLength={6000}
                  required
                  disabled={!authenticated || !!busy}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="What happened, what did you expect, or what would you improve?"
                />
              </label>
              <p>
                Page: {page} · {text.length}/6,000 characters. Saved privately
                on this board.
              </p>
              <label className="check-label">
                <input
                  type="checkbox"
                  disabled={!authenticated || !aiAvailable || !!busy}
                  checked={reviewAfterSave}
                  onChange={(e) => setReviewAfterSave(e.target.checked)}
                />{" "}
                Ask AI to review after saving
              </label>
              <p className="buddy-muted">
                AI review sends only this feedback and page name to your
                configured Career Buddy provider. It proposes improvements; it
                does not apply them. You can save without AI.
              </p>
              <div className="form-actions">
                <button
                  className="button primary"
                  disabled={!authenticated || !!busy || !text.trim()}
                >
                  {busy === "saving" ? "Saving…" : "Submit feedback"}
                </button>
              </div>
            </form>
          )}
          {tab === "inbox" && (
            <div>
              <div className="form-actions">
                <a
                  className="button secondary small"
                  href="/api/feedback/export"
                >
                  Export feedback JSON
                </a>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => void load().catch((e) => setError(e.message))}
                >
                  Refresh feedback
                </button>
              </div>
              {!items.length && <p>No feedback yet.</p>}
              {items.slice(0, shown).map((i) => (
                <article className="feedback-entry" key={i.id}>
                  <p>
                    <strong>{i.page}</strong> ·{" "}
                    {new Date(i.createdAt).toLocaleString()} · {i.status}
                  </p>
                  <p className="feedback-text">{i.text}</p>
                  <div className="library-tool-actions">
                    <label className="field">
                      <span>Feedback status</span>
                      <select
                        aria-label={"Status of feedback " + i.id}
                        value={i.status}
                        disabled={!!busy}
                        onChange={(e) => {
                          setBusy("status");
                          void api(
                            "/feedback/" + i.id,
                            json(
                              { revision: i.revision, status: e.target.value },
                              "PATCH",
                            ),
                          )
                            .then(() => load())
                            .catch((e) => setError(e.message))
                            .finally(() => setBusy(""));
                        }}
                      >
                        <option value="open">Open</option>
                        <option value="planned">Planned</option>
                        <option value="done">Done</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="button secondary small"
                      disabled={
                        !!busy || !aiAvailable || i.reviewStatus === "running"
                      }
                      onClick={() => void review(i.id)}
                    >
                      {busy === i.id
                        ? "Reviewing…"
                        : "Review with Career Buddy"}
                    </button>
                    {(busy === i.id || i.reviewStatus === "running") && (
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() =>
                          void api("/feedback/" + i.id + "/cancel", json({}))
                            .then(() => load())
                            .catch((e) => setError(e.message))
                        }
                      >
                        Cancel AI review
                      </button>
                    )}
                  </div>
                  <p>AI review: {i.reviewStatus}</p>
                  {i.review && (
                    <div>
                      <h3>
                        Proposed improvements · {i.review.priority} priority
                      </h3>
                      <p>{i.review.summary}</p>
                      <ul>
                        {i.review.improvements.map((s, j) => (
                          <li key={j}>{s}</li>
                        ))}
                      </ul>
                      {i.review.questions.length > 0 && (
                        <>
                          <h4>Questions</h4>
                          <ul>
                            {i.review.questions.map((s, j) => (
                              <li key={j}>{s}</li>
                            ))}
                          </ul>
                        </>
                      )}
                      <small>
                        {i.review.provider} · {i.review.model} ·{" "}
                        {new Date(i.review.reviewedAt).toLocaleString()}
                      </small>
                    </div>
                  )}
                </article>
              ))}
              {items.length > shown && (
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => setShown((n) => n + 20)}
                >
                  Show more feedback
                </button>
              )}
            </div>
          )}
        </dialog>,
        document.body,
      )}
    </>
  );
}
