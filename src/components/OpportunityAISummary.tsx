import { useState, useEffect, useRef, useCallback } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Edit3,
  FileText,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Settings,
  Sparkles,
  Zap,
} from "lucide-react";
import { formatDate } from "../api";
import type { Opportunity } from "../types";
import { parseMarkdownBlocks } from "./MarkdownViewer";

function countWords(text?: string): number {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export default function OpportunityAISummary({
  opportunity: o,
  timezone,
  busy,
  mutate,
  onConfigureBuddy,
  onNavigateOverview,
}: {
  opportunity: Opportunity;
  timezone: string;
  busy: boolean;
  mutate: (path: string, body: unknown, method?: string) => Promise<boolean>;
  onConfigureBuddy?: () => void;
  onNavigateOverview?: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [engine, setEngine] = useState<"tfidf" | "llm">(
    o.aiSummaryEngine === "llm" ? "llm" : "tfidf",
  );
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(o.aiSummary || "");
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "undone" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  const editTextRef = useRef(editText);
  editTextRef.current = editText;
  const lastSavedRef = useRef(o.aiSummary || "");
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);

  useEffect(() => {
    setEditText(o.aiSummary || "");
    lastSavedRef.current = o.aiSummary || "";
  }, [o.aiSummary]);

  const descWordCount = countWords(o.description);
  const summaryWordCount = countWords(o.aiSummary);

  const handleGenerate = async (overrideEngine?: "tfidf" | "llm") => {
    if (generating || busy) return;
    const selectedEngine = overrideEngine || engine;
    if (overrideEngine) setEngine(overrideEngine);
    setGenerating(true);
    setError("");
    setSaveStatus("idle");

    try {
      const ok = await mutate(
        `/opportunities/${o.id}/description-summary`,
        { engine: selectedEngine },
        "POST",
      );
      if (!ok) {
        setError(
          selectedEngine === "llm"
            ? "Could not generate LLM summary. Verify your Career Buddy provider in Settings, or run Fast Local (TF-IDF / BM25)."
            : "Could not generate summary from the job description.",
        );
      } else {
        setIsEditing(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate summary.");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!o.aiSummary) return;
    try {
      await navigator.clipboard.writeText(o.aiSummary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback if clipboard API is restricted
      const el = document.createElement("textarea");
      el.value = o.aiSummary;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const performSaveEdit = useCallback(
    async (targetText: string, isUndo = false) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (!isUndo && targetText.trim() === lastSavedRef.current.trim()) {
        return true;
      }
      if (isSavingRef.current) return false;
      isSavingRef.current = true;
      setSaveStatus("saving");

      const prior = lastSavedRef.current;
      try {
        const ok = await mutate(
          `/opportunities/${o.id}`,
          { aiSummary: targetText, revision: o.revision },
          "PATCH",
        );
        if (ok) {
          if (!isUndo) {
            setUndoStack((prev) => [...prev.slice(-19), prior]);
            setSaveStatus("saved");
            setStatusMessage("Summary saved");
          } else {
            setSaveStatus("undone");
            setStatusMessage("Undid last change");
          }
          lastSavedRef.current = targetText;
        } else {
          setSaveStatus("error");
          setStatusMessage("Could not save summary");
        }
        return ok;
      } catch {
        setSaveStatus("error");
        setStatusMessage("Could not save summary");
        return false;
      } finally {
        isSavingRef.current = false;
      }
    },
    [mutate, o.id, o.revision],
  );

  const scheduleSaveEdit = useCallback(
    (nextText: string, delay = 600) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaveStatus("saving");
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void performSaveEdit(nextText);
      }, delay);
    },
    [performSaveEdit],
  );

  const handleBlur = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      void performSaveEdit(editTextRef.current);
    }
  }, [performSaveEdit]);

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0 || isSavingRef.current || busy) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setEditText(previous);
    await performSaveEdit(previous, true);
  }, [undoStack, busy, performSaveEdit]);

  const hasDescription = Boolean(o.description && o.description.trim());

  return (
    <section className="workflow-section ai-summary-container" aria-label="AI Summary">
      <div className="section-intro with-action">
        <div>
          <h3>Role summary &amp; breakdown</h3>
          <p>
            A concise 100-word executive summary of the job description, plus top 5 skills and 5 key responsibilities.
          </p>
        </div>
        {hasDescription && (
          <div className="ai-engine-selector-wrap">
            <span className="ai-engine-selector-label">AI Engine:</span>
            <div className="library-view-toggle ai-engine-toggle" role="group" aria-label="Summarization engine">
              <button
                type="button"
                className={engine === "tfidf" ? "active" : ""}
                disabled={generating || busy}
                onClick={() => setEngine("tfidf")}
                title="Instant local statistical extraction using TF-IDF & BM25 sentence and skill scoring (offline, zero token cost)"
              >
                <Zap size={12} />
                Fast Local (TF-IDF / BM25)
              </button>
              <button
                type="button"
                className={engine === "llm" ? "active" : ""}
                disabled={generating || busy}
                onClick={() => setEngine("llm")}
                title="Deep generative AI synthesis using your configured Career Buddy LLM"
              >
                <Sparkles size={12} />
                Generative AI (LLM)
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="alert error" role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span>{error}</span>
          {onConfigureBuddy && error.toLowerCase().includes("career buddy") && (
            <button
              type="button"
              className="button secondary small"
              onClick={onConfigureBuddy}
            >
              <Settings size={13} />
              Configure Career Buddy
            </button>
          )}
        </div>
      )}

      {!hasDescription ? (
        <div className="ai-summary-empty-box">
          <FileText size={32} style={{ opacity: 0.5, color: "var(--muted)" }} />
          <div>
            <h4 style={{ margin: "0 0 4px", fontSize: 15 }}>No job description added</h4>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
              Add the job listing or specification in the Overview tab to generate an AI summary.
            </p>
          </div>
          {onNavigateOverview && (
            <button
              type="button"
              className="button secondary small"
              onClick={onNavigateOverview}
              style={{ marginTop: 4 }}
            >
              Go to Overview tab
            </button>
          )}
        </div>
      ) : !o.aiSummary ? (
        <div className="ai-summary-empty-box">
          {engine === "tfidf" ? (
            <Zap size={32} style={{ color: "var(--accent)" }} />
          ) : (
            <Sparkles size={32} style={{ color: "var(--accent)" }} />
          )}
          <div>
            <h4 style={{ margin: "0 0 4px", fontSize: 15 }}>Ready to summarize</h4>
            <p style={{ margin: "0 0 4px", fontSize: 13, color: "var(--muted)" }}>
              Job description contains {descWordCount} words.
            </p>
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", maxWidth: 520 }}>
              {engine === "tfidf"
                ? "Run an instant Fast Local (TF-IDF / BM25) statistical summary first. If you want a deeper generative synthesis afterward, switch to Generative AI (LLM) and re-run."
                : "Generate a synthesized 100-word executive summary with top 5 skills and 5 key responsibilities using your configured Career Buddy LLM."}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 8 }}>
            <button
              type="button"
              className="button primary"
              disabled={generating || busy}
              onClick={() => void handleGenerate()}
            >
              {generating ? (
                <>
                  <LoaderCircle size={15} className="spin" />
                  {engine === "tfidf" ? "Extracting summary…" : "Generating with LLM…"}
                </>
              ) : engine === "tfidf" ? (
                <>
                  <Zap size={15} />
                  Run Fast Local Summary (TF-IDF / BM25)
                </>
              ) : (
                <>
                  <Sparkles size={15} />
                  Run LLM Summary
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="ai-summary-card">
          <div className="ai-summary-card-header">
            <div className="ai-summary-meta">
              <span className="word-count-badge">{summaryWordCount} words</span>
              <span
                className={`ai-engine-badge ${o.aiSummaryEngine === "tfidf" ? "engine-tfidf" : "engine-llm"}`}
                title={
                  o.aiSummaryEngine === "tfidf"
                    ? "Generated locally via TF-IDF / BM25 statistical extraction"
                    : "Generated via Career Buddy LLM"
                }
              >
                {o.aiSummaryEngine === "tfidf" ? (
                  <>
                    <Zap size={11} />
                    Fast Local (TF-IDF / BM25)
                  </>
                ) : (
                  <>
                    <Sparkles size={11} />
                    Generative AI (LLM)
                  </>
                )}
              </span>
              {o.aiSummaryGeneratedAt && (
                <span>
                  Generated {formatDate(o.aiSummaryGeneratedAt, timezone, true)}
                </span>
              )}
            </div>
            <div className="ai-summary-actions">
              <button
                type="button"
                className="button secondary small"
                onClick={() => void handleCopy()}
                title="Copy summary to clipboard"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                className="button secondary small"
                onClick={() => setIsEditing(!isEditing)}
                title={isEditing ? "View formatted summary" : "Edit summary text"}
              >
                <Edit3 size={13} />
                {isEditing ? "Done editing" : "Edit"}
              </button>
              {o.aiSummaryEngine === "tfidf" && engine === "tfidf" && (
                <button
                  type="button"
                  className="button primary small"
                  disabled={generating || busy}
                  onClick={() => void handleGenerate("llm")}
                  title="Not satisfied with the statistical summary? Re-run with your configured Generative AI (LLM) model."
                >
                  <Sparkles size={13} />
                  {generating ? "Running LLM…" : "Upgrade with LLM"}
                </button>
              )}
              <button
                type="button"
                className="button secondary small"
                disabled={generating || busy}
                onClick={() => void handleGenerate()}
                title={`Regenerate summary using ${engine === "tfidf" ? "Fast Local (TF-IDF / BM25)" : "Generative AI (LLM)"}`}
              >
                <RefreshCw size={13} className={generating ? "spin" : ""} />
                {generating
                  ? "Regenerating…"
                  : `Regenerate (${engine === "tfidf" ? "TF-IDF" : "LLM"})`}
              </button>
            </div>
          </div>

          {isEditing ? (
            <div>
              <textarea
                className="ai-summary-edit-textarea"
                rows={12}
                value={editText}
                onChange={(e) => {
                  const val = e.target.value;
                  setEditText(val);
                  scheduleSaveEdit(val, 600);
                }}
                onBlur={handleBlur}
                placeholder="Enter or refine the summary, skills, and responsibilities…"
              />
              <div className="auto-save-bar" style={{ marginTop: 8 }}>
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
                      <span>{statusMessage || "Summary saved"}</span>
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
                      <span>{statusMessage || "Could not save summary"}</span>
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="button secondary small undo-button"
                  disabled={undoStack.length === 0 || saveStatus === "saving" || busy}
                  onClick={() => void handleUndo()}
                  title="Undo last change (Cmd+Z or Ctrl+Z)"
                >
                  <RotateCcw size={13} />
                  Undo last change
                </button>
              </div>
            </div>
          ) : (
            <div className="markdown-rendered-body ai-summary-rendered">
              {parseMarkdownBlocks(o.aiSummary || "")}
            </div>
          )}

          {o.description && (
            <details className="ai-summary-source-details">
              <summary>
                <FileText size={13} />
                Original job description ({descWordCount} words)
              </summary>
              <div className="ai-summary-source-body">{o.description}</div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
