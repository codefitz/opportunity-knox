import { useEffect, useState, useRef, useCallback } from "react";
import { AlertCircle, Check, LoaderCircle, RotateCcw } from "lucide-react";
import { api, json } from "../api";

type Policy = {
  revision: number;
  intake: boolean;
  fit: boolean;
  drafting: boolean;
  autoFit: boolean;
  autoTags: boolean;
};

export default function AIWorkflowSettings({
  onError,
}: {
  onError: (e: unknown) => void;
}) {
  const [form, setForm] = useState<Policy | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoStack, setUndoStack] = useState<Policy[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "undone" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  const formRef = useRef(form);
  formRef.current = form;
  const isSavingRef = useRef(false);

  const load = () =>
    api<Policy>("/ai-workflow")
      .then((v) => {
        setForm(v);
        setSaveStatus("idle");
        setStatusMessage("");
      })
      .catch(onError);

  useEffect(() => {
    void load();
  }, []);

  const performSave = useCallback(
    async (nextPolicy: Policy, isUndo = false) => {
      if (isSavingRef.current) return;
      isSavingRef.current = true;
      setBusy(true);
      setSaveStatus("saving");

      const prior = formRef.current;
      try {
        const saved = await api<Policy>("/ai-workflow", {
          ...json(nextPolicy),
          method: "PATCH",
        });
        setForm(saved);
        if (!isUndo && prior) {
          setUndoStack((prev) => [...prev.slice(-19), prior]);
          setSaveStatus("saved");
          setStatusMessage("AI workflow saved");
        } else {
          setSaveStatus("undone");
          setStatusMessage("Undid last change");
        }
      } catch (e) {
        setSaveStatus("error");
        setStatusMessage("Could not save AI workflow");
        onError(e);
      } finally {
        isSavingRef.current = false;
        setBusy(false);
      }
    },
    [onError],
  );

  const handleToggle = (key: keyof Omit<Policy, "revision">, checked: boolean) => {
    if (!formRef.current) return;
    const next: Policy = { ...formRef.current, [key]: checked };
    setForm(next);
    void performSave(next);
  };

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0 || busy || isSavingRef.current) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setForm(previous);
    await performSave(previous, true);
  }, [undoStack, busy, performSave]);

  const choices: [keyof Omit<Policy, "revision">, string, string][] = [
    [
      "intake",
      "1. Job extraction",
      "On demand: runs only when you prepare an intake review with Career Buddy selected. Local reading and OCR remain available.",
    ],
    [
      "fit",
      "2. Fit and role advice",
      "Allows fit assessments and the fit, salary and skills prompts. Criteria and a configured model are still required where applicable.",
    ],
    [
      "drafting",
      "3. CV and cover-letter drafting",
      "On demand: creates reviewable drafts only when requested. Manual uploads and Document Studio remain available.",
    ],
    [
      "autoFit",
      "Assess new or changed opportunities automatically",
      "Requires stage 2 above, saved criteria and an enabled chat or decision model. Turning this off leaves manual assessment available.",
    ],
    [
      "autoTags",
      "Suggest tags automatically",
      "Uses the enabled chat model for new or changed opportunities. Existing tags are kept.",
    ],
  ];

  return (
    <section className="settings-section" aria-label="AI workflow">
      <div className="settings-section-heading">
        <div>
          <h2>AI workflow</h2>
          <p>
            Choose which career tasks may use AI. Switches save automatically across devices.
          </p>
        </div>
      </div>
      {form && (
        <form onSubmit={(e) => e.preventDefault()}>
          {choices.map(([key, label, hint]) => (
            <div key={key} style={{ marginBottom: 16 }}>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={form[key]}
                  disabled={busy}
                  onChange={(e) => handleToggle(key, e.target.checked)}
                />
                {label}
              </label>
              <p className="buddy-muted">{hint}</p>
            </div>
          ))}
          <p className="buddy-muted">
            Saving switches starts no work and does not change existing records or drafts.
            Disabled tasks reject unfinished results before saving. Plain coaching and interview updates remain available.
          </p>
          <div className="auto-save-bar">
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
                  <span>{statusMessage || "AI workflow saved"}</span>
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
                  <span>{statusMessage || "Could not save settings"}</span>
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                className="button secondary small undo-button"
                disabled={undoStack.length === 0 || busy}
                onClick={() => void handleUndo()}
                title="Undo last change (Cmd+Z or Ctrl+Z)"
              >
                <RotateCcw size={13} />
                Undo last change
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void load()}
              >
                Reload
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
