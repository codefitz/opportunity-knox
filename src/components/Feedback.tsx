import { uploadId } from "../lib/upload-queue";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, json } from "../api";
import { feedbackIssueDraft } from "../lib/feedback";

type Entry = { id: string; text: string; page: string };
type Issue = { title: string; body: string };

export default function Feedback({
  authenticated,
}: {
  authenticated: boolean;
}) {
  const [open, setOpen] = useState(false),
    [text, setText] = useState(""),
    [page, setPage] = useState("other"),
    [github, setGithub] = useState(false),
    [issue, setIssue] = useState<Issue | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    launcher = useRef<HTMLButtonElement>(null),
    issuePreview = useRef<HTMLElement>(null),
    saving = useRef(false),
    draftController = useRef<AbortController | null>(null),
    submission = useRef<{ key: string; id: string } | null>(null);
  const draft = issue ? feedbackIssueDraft(issue) : null;

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("knox-feedback-inbox", show);
    return () => window.removeEventListener("knox-feedback-inbox", show);
  }, []);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [open]);
  useEffect(() => {
    if (!authenticated) {
      draftController.current?.abort();
      setIssue(null);
    }
  }, [authenticated]);
  useEffect(() => () => draftController.current?.abort(), []);
  useEffect(() => {
    if (issue && busy !== "drafting") issuePreview.current?.focus();
  }, [!!issue, busy]);
  function close() {
    if (busy === "saving") return;
    draftController.current?.abort();
    setOpen(false);
    setIssue(null);
    setNotice("");
    launcher.current?.focus();
  }
  async function prepareIssue(entry: Entry) {
    setIssue(feedbackIssueDraft(entry));
    setBusy("drafting");
    const controller = new AbortController();
    draftController.current = controller;
    try {
      const result = await api<{ draft: Issue }>(
        "/feedback/" + entry.id + "/issue-draft",
        {
          ...json({ confirm: true, requestId: uploadId() }),
          signal: controller.signal,
        },
      );
      if (!controller.signal.aborted) setIssue(result.draft);
    } catch {
      if (!controller.signal.aborted)
        setError(
          "Your feedback is saved. Career Buddy could not fill out the issue. You can edit the draft below or check Career Buddy in Settings.",
        );
    } finally {
      if (draftController.current === controller)
        draftController.current = null;
    }
  }
  async function submit() {
    if (saving.current) return;
    saving.current = true;
    setBusy("saving");
    setError("");
    setNotice("");
    setIssue(null);
    const key = JSON.stringify([text.trim(), page]);
    if (submission.current?.key !== key)
      submission.current = { key, id: uploadId() };
    try {
      const result = await api<{ item: Entry }>(
        "/feedback",
        json({ text, page, requestId: submission.current.id }),
      );
      setText("");
      submission.current = null;
      setNotice("Feedback saved privately. Thank you.");
      if (github) await prepareIssue(result.item);
      setGithub(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy("");
    }
  }
  function begin() {
    const route =
      window.location.hash.replace(/^#\//, "").split(/[/?]/)[0] || "dashboard";
    if (!text.trim())
      setPage(
        authenticated
          ? [
              "dashboard",
              "opportunities",
              "board",
              "kanban",
              "tasks",
              "todos",
              "library",
              "buddy",
              "activity",
              "settings",
            ].includes(route)
            ? route
            : "other"
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
              disabled={busy === "saving"}
              onClick={close}
            >
              Close feedback
            </button>
          </div>
          <p>
            Share a problem or suggest an improvement. Saved privately on this
            board.
          </p>
          {!authenticated && <p>Sign in to submit feedback.</p>}
          {error && (
            <p className="feedback-error" role="alert">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
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
                rows={5}
                maxLength={6000}
                required
                disabled={!authenticated || !!busy}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setNotice("");
                  setError("");
                }}
                placeholder="What happened, or what would you improve?"
              />
            </label>
            <p className="buddy-muted">
              Page: {page} · {text.length}/6,000 characters
            </p>
            <label className="check-field">
              <input
                type="checkbox"
                checked={github}
                disabled={!authenticated || !!busy}
                onChange={(e) => setGithub(e.target.checked)}
              />
              Also prepare a GitHub issue
            </label>
            {github && (
              <p className="buddy-muted">
                Career Buddy will use only this feedback and page name to fill
                in an issue draft. Review it before opening GitHub, where issues
                may be public.
              </p>
            )}
            <div className="form-actions">
              <button
                className="button primary"
                disabled={!authenticated || !!busy || !text.trim()}
              >
                {busy === "saving"
                  ? "Saving…"
                  : busy === "drafting"
                    ? "Preparing issue…"
                    : "Submit feedback"}
              </button>
            </div>
          </form>
          {authenticated && issue && draft && (
            <section
              ref={issuePreview}
              tabIndex={-1}
              className="feedback-issue"
              aria-label="GitHub issue draft"
            >
              <h3>GitHub issue draft</h3>
              {busy === "drafting" ? (
                <>
                  <p role="status">Career Buddy is filling out the issue…</p>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => draftController.current?.abort()}
                  >
                    Cancel AI drafting
                  </button>
                </>
              ) : (
                <p>
                  Review or edit the title and description. Nothing has been
                  posted to GitHub.
                </p>
              )}
              <label className="field">
                <span>Issue title</span>
                <input
                  maxLength={100}
                  disabled={!!busy}
                  value={issue.title}
                  onChange={(e) =>
                    setIssue({ ...issue, title: e.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Issue text</span>
                <textarea
                  rows={7}
                  maxLength={12000}
                  disabled={!!busy}
                  value={issue.body}
                  onChange={(e) => setIssue({ ...issue, body: e.target.value })}
                />
              </label>
              {!draft.bodyIncluded && (
                <p>
                  This issue is too long for a prefilled link. Copy the issue
                  text and paste it into the GitHub draft.
                </p>
              )}
              {!busy && (
                <div className="library-tool-actions">
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(issue.body);
                        setNotice("Issue text copied.");
                      } catch {
                        setError(
                          "Could not copy automatically. Select and copy the issue text above.",
                        );
                      }
                    }}
                  >
                    Copy issue text
                  </button>
                  {issue.title.trim() && issue.body.trim() && (
                    <a
                      className="button secondary small"
                      href={draft.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Review & submit on GitHub
                    </a>
                  )}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setIssue(null);
                      setError("");
                    }}
                  >
                    Dismiss draft
                  </button>
                </div>
              )}
            </section>
          )}
        </dialog>,
        document.body,
      )}
    </>
  );
}
