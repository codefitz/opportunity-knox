import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, json } from "../api";
type Action = "delete-opportunity" | "clear-opportunities" | "reset-workspace";
type Preview = {
  planId: string;
  subject: string;
  phrase: string;
  counts: { label: string; count: number }[];
  removes: string;
  keeps: string;
  backup: string;
};
export type WorkspaceActionResult = {
  action: Action;
  removedOpportunities: number;
  backup: { name: string; location: string };
};
export default function WorkspaceAction({
  action,
  opportunityId,
  label,
  onComplete,
  disabled = false,
}: {
  action: Action;
  opportunityId?: string;
  label: string;
  onComplete: (result: WorkspaceActionResult) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    applying = useRef(false);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  function close() {
    if (applying.current) return;
    setOpen(false);
    trigger.current?.focus();
  }
  async function review() {
    setOpen(true);
    setPreview(null);
    setConfirmation("");
    setError("");
    setBusy("preview");
    try {
      setPreview(
        await api<Preview>(
          "/workspace-actions/preview",
          json({ action, opportunityId }),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function apply() {
    if (!preview || confirmation !== preview.phrase || applying.current) return;
    applying.current = true;
    setBusy("apply");
    setError("");
    try {
      const result = await api<WorkspaceActionResult>(
        "/workspace-actions/apply",
        json({ planId: preview.planId, confirmation, confirm: true }),
      );
      setOpen(false);
      onComplete(result);
    } catch (e) {
      setError((e as Error).message);
      setConfirmation("");
    } finally {
      applying.current = false;
      setBusy("");
    }
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="button secondary small danger-text"
        disabled={disabled}
        onClick={() => void review()}
      >
        {label}
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          className="workspace-action-dialog"
          aria-labelledby={"workspace-action-" + action}
          onKeyDown={(e) => e.stopPropagation()}
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
        >
          <div className="feedback-heading">
            <h2 id={"workspace-action-" + action}>{label}</h2>
            <button
              type="button"
              className="button secondary small"
              disabled={busy === "apply"}
              onClick={close}
            >
              Cancel
            </button>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {busy === "preview" && <p role="status">Preparing preview…</p>}
          {preview && (
            <>
              <h3>{preview.subject}</h3>
              <ul className="workspace-action-counts">
                {preview.counts.map((item) => (
                  <li key={item.label}>
                    {item.label}: <strong>{item.count}</strong>
                  </li>
                ))}
              </ul>
              <p>
                <strong>Removed from this workspace:</strong> {preview.removes}
              </p>
              <p>
                <strong>Kept:</strong> {preview.keeps}
              </p>
              <p>
                {preview.backup} Existing files stay on disk; recover records
                through Settings → Recovery using the backup.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void apply();
                }}
              >
                <label className="field">
                  <span>Type {preview.phrase} to confirm</span>
                  <input
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    value={confirmation}
                    disabled={!!busy}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </label>
                <div className="form-actions">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={!!busy}
                    onClick={() => void review()}
                  >
                    Refresh preview
                  </button>
                  <button
                    className="button danger"
                    disabled={!!busy || confirmation !== preview.phrase}
                  >
                    {busy === "apply"
                      ? "Backing up and applying…"
                      : "Create backup & " + label.toLowerCase()}
                  </button>
                </div>
              </form>
            </>
          )}
          {!preview && !busy && (
            <button
              type="button"
              className="button secondary"
              onClick={() => void review()}
            >
              Try preview again
            </button>
          )}
        </dialog>,
        document.body,
      )}
    </>
  );
}
