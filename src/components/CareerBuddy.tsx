import AIRequestProgress from "./AIRequestProgress";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Bot,
  Check,
  Download,
  FileText,
  Import,
  LoaderCircle,
  Send,
  Settings2,
  Sparkles,
} from "lucide-react";
import { api, ApiError, download, formatDate, json } from "../api";
import type { Opportunity } from "../types";
import type { BuddySettings } from "./CareerBuddySettings";
import "../career-buddy.css";
export type BuddySource = {
  id: string;
  name: string;
  kind: string;
  status: string;
  opportunityId: string;
  generated: boolean;
  extraction: { status: string; chunkCount: number; warnings: string[] };
};
type Change = {
  kind: string;
  title: string;
  date: string;
  type: string;
  status: string;
  notes: string;
  field: string;
  value: string;
  isFinal: boolean;
};
export type BuddyMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  baseRevision: number;
  changes: Change[];
  appliedChanges?: Change[];
  draft: { kind: string; title: string; content: string };
  editedDraft?: { title: string; content: string };
  provider: string;
  model: string;
  appliedAt: string;
  sources: {
    id: string;
    name: string;
    status: string;
    included: boolean;
    warnings: string[];
    excerpts?: { index: number; matchedBy: string[] }[];
  }[];
  context?: {
    retrieval?: { mode: string; reason: string; indexedSources: number };
    characters: number;
    omittedChunks: number;
    otherOpportunities: number;
  };
  savedDocuments: { id: string; name: string; url: string }[];
};
type State = {
  settings: BuddySettings;
  documents: BuddySource[];
  messages: BuddyMessage[];
};
const prompts = [
  {
    action: "fit",
    label: "Am I a good fit?",
    prompt:
      "Am I a good fit for this role? Compare the requirements with my career evidence. Explain supported strengths, gaps and questions before recommending whether to proceed.",
  },
  {
    action: "salary",
    label: "What salary should I ask for?",
    prompt:
      "What salary range should I ask for in this role? Use the saved salary, location and employment type. Explain assumptions and missing information. Label any unverified estimates clearly.",
  },
  {
    action: "skills",
    label: "Which skills should I highlight?",
    prompt:
      "What key skills should I highlight for this role? Link each to my actual evidence and distinguish the requirements I have not demonstrated.",
  },
  {
    action: "cv",
    label: "Tailor my CV",
    prompt:
      "Tailor my CV for this role using my selected source CV and career evidence. Preserve factual employment history, dates and qualifications. Return a complete editable CV draft and identify any gaps separately.",
  },
  {
    action: "cover",
    label: "Tailor a cover letter",
    prompt:
      "Tailor a cover letter for this role using the selected career evidence. Return a complete editable letter in my voice, using only supported experience. Identify missing details separately.",
  },
];
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Career Buddy could not complete the request.";
function Text({ value }: { value: string }) {
  return (
    <div className="buddy-prose">
      {value.split("\n").map((line, index) => (
        <p key={index}>
          {line
            .split(/(\*\*[^*]+\*\*)/g)
            .map((part, i) =>
              part.startsWith("**") ? (
                <strong key={i}>{part.slice(2, -2)}</strong>
              ) : (
                part
              ),
            )}
        </p>
      ))}
    </div>
  );
}
export default function CareerBuddy({
  opportunity: o,
  timezone,
  onUpdate,
  onError,
  onConfigure,
}: {
  opportunity: Opportunity;
  timezone: string;
  onUpdate: (o: Opportunity) => void;
  onError: (e: unknown) => void;
  onConfigure: () => void;
}) {
  const [state, setState] = useState<State | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [others, setOthers] = useState(false),
    [input, setInput] = useState(""),
    [action, setAction] = useState("chat"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const retry = useRef<{ payload: string; id: string } | null>(null),
    end = useRef<HTMLDivElement>(null);
  const base = "/opportunities/" + o.id + "/buddy";
  async function load() {
    try {
      const next = await api<State>(base);
      setState(next);
      setSelected(
        next.documents
          .filter(
            (doc) =>
              !doc.generated && /\.(pdf|docx|txt|md|csv|json)$/i.test(doc.name),
          )
          .slice(0, 20)
          .map((doc) => doc.id),
      );
    } catch (error) {
      setActiveRequest(null);
      setError(errorText(error));
      onError(error);
    }
  }
  useEffect(() => {
    void load();
  }, [o.id]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [state?.messages.length, busy]);
  const changed = (result: {
    opportunity: Opportunity;
    messages: BuddyMessage[];
  }) => {
    onUpdate(result.opportunity);
    setState((current) =>
      current ? { ...current, messages: result.messages } : current,
    );
  };
  const [activeRequest,setActiveRequest]=useState<string|null>(null);
  const [taskPackOpen, setTaskPackOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<{
    valid: boolean;
    baseRevision: number;
    reply: string;
    changes: Change[];
    draft: { kind: string; title: string; content: string };
    sourceIds: string[];
  } | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [taskAction, setTaskAction] = useState<string>("general");
  const [taskInstructions, setTaskInstructions] = useState<string>("");
  const [packBusy, setPackBusy] = useState(false);

  async function downloadTaskPack() {
    setPackBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/opportunities/${encodeURIComponent(o.id)}/assistant-pack`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: taskAction,
            sourceIds: selected,
            includeOtherOpportunities: others,
            customInstructions: taskInstructions.trim(),
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Download failed with status ${res.status}`);
      }
      const blob = await res.blob();
      const filename = `task-pack-${(o.company || "opportunity").replace(/[^a-zA-Z0-9_-]/g, "_")}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setTaskPackOpen(false);
    } catch (err) {
      setError(errorText(err));
      onError(err);
    } finally {
      setPackBusy(false);
    }
  }

  async function previewAssistantResult() {
    if (!importText.trim()) return;
    setImportBusy(true);
    setImportError("");
    try {
      const res = await api<{
        valid: boolean;
        baseRevision: number;
        reply: string;
        changes: Change[];
        draft: { kind: string; title: string; content: string };
        sourceIds: string[];
      }>(
        `/api/opportunities/${encodeURIComponent(o.id)}/assistant-pack/preview`,
        json({
          baseRevision: o.revision,
          resultText: importText.trim(),
        }),
      );
      setImportPreview(res);
    } catch (err) {
      setImportError(errorText(err));
      setImportPreview(null);
    } finally {
      setImportBusy(false);
    }
  }

  async function applyAssistantResult() {
    if (!importText.trim() || !importPreview) return;
    setImportBusy(true);
    setImportError("");
    try {
      const res = await api<{
        success: boolean;
        opportunity: Opportunity;
      }>(
        `/api/opportunities/${encodeURIComponent(o.id)}/assistant-pack/apply`,
        json({
          baseRevision: o.revision,
          resultText: importText.trim(),
          confirm: true,
        }),
      );
      onUpdate(res.opportunity);
      setImportOpen(false);
      setImportText("");
      setImportPreview(null);
      await load();
    } catch (err) {
      setImportError(errorText(err));
    } finally {
      setImportBusy(false);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!input.trim() || busy) return;
    setBusy(true);
    setError("");
    const payload = JSON.stringify({
      message: input.trim(),
      action,
      documentIds: selected,
      includeOtherOpportunities: others,
    });
    if (retry.current?.payload !== payload)
      retry.current = { payload, id: crypto.randomUUID() };
    setActiveRequest(retry.current!.id);
    try {
      const result = await api<{ messages: BuddyMessage[] }>(
        base + "/chat",
        json({ ...JSON.parse(payload), requestId: retry.current!.id }),
      );
      setState((current) =>
        current ? { ...current, messages: result.messages } : current,
      );
      setInput("");
      setAction("chat");
      retry.current = null;
    } catch (error) {
      setError(errorText(error));
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  if (!state)
    return (
      <div className="buddy-empty">{error || "Opening Career Buddy…"}</div>
    );
  const active = state.settings.enabled;
  return (
    <section className="buddy-chat" aria-label="Career Buddy chat">
      <div className="buddy-chat-heading">
        <div className="buddy-identity">
          <span className="buddy-icon">
            <Bot size={24} />
          </span>
          <div>
            <h3>Career Buddy</h3>
            <p>
              {active
                ? state.settings.providers[state.settings.provider]?.name +
                  " · " +
                  state.settings.model
                : "Your career assistant is switched off."}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            type="button"
            className="button secondary small"
            title="Export structured task pack with context, documents, and instructions for external tools"
            onClick={() => setTaskPackOpen(true)}
          >
            <Download size={14} />
            Export task pack
          </button>
          <button
            type="button"
            className="button secondary small"
            title="Import and review assistant output"
            onClick={() => {
              setImportOpen(true);
              setImportPreview(null);
              setImportError("");
            }}
          >
            <Import size={14} />
            Import result
          </button>
          <button
            type="button"
            className="button secondary small"
            onClick={onConfigure}
          >
            <Settings2 size={14} />
            Configure
          </button>
        </div>
      </div>
      {!active && (
        <div className="buddy-callout">
          Choose a provider and model in Settings, then enable Career Buddy.
          Your board continues to work while it is off.
          <button type="button" className="text-button" onClick={onConfigure}>
            Open Career Buddy settings
          </button>
        </div>
      )}
      <details className="buddy-context">
        <summary>
          Sources for your next message <span>{selected.length} selected</span>
        </summary>
        <p>
          This opportunity and these selected document excerpts will be sent to{" "}
          <strong>
            {state.settings.providers[state.settings.provider]?.name}
          </strong>
          . Files are read locally first. Select up to 20; use a source CV for
          tailoring.
        </p>
        {state.documents.length === 0 ? (
          <p className="buddy-muted">
            Add a CV or career evidence in the Career Hub or this
            opportunity’s Documents tab.
          </p>
        ) : (
          <div className="buddy-source-picker">
            {state.documents.map((doc) => (
              <label key={doc.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(doc.id)}
                  disabled={
                    busy ||
                    (!selected.includes(doc.id) && selected.length >= 20)
                  }
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, doc.id]
                        : current.filter((id) => id !== doc.id),
                    )
                  }
                />
                <span>
                  <strong>{doc.name}</strong>
                  <small>
                    {doc.kind} ·{" "}
                    {doc.generated ? "AI draft, not verified evidence · " : ""}
                    {doc.extraction.status === "ready"
                      ? doc.extraction.chunkCount + " text chunks"
                      : doc.extraction.status === "pending"
                        ? "Prepared when sent"
                        : doc.extraction.warnings.join(" ") ||
                          doc.extraction.status}
                  </small>
                </span>
              </label>
            ))}
          </div>
        )}
        <label className="buddy-toggle">
          <input
            type="checkbox"
            checked={others}
            disabled={busy}
            onChange={(event) => setOthers(event.target.checked)}
          />
          Also include short summaries of my other opportunities
        </label>
        <small>
          Original files stay unchanged. Scanned PDFs need OCR; legacy .doc
          files need a .docx or text copy. Long sources use selected excerpts.
        </small>
      </details>
      <div className="buddy-conversation" aria-live="polite">
        {!state.messages.length && (
          <div className="buddy-welcome">
            <Sparkles size={23} />
            <h3>A little support for your next step.</h3>
            <p>
              Ask a question, draft an application, or tell me what happened.
              For example: “Had the second interview today — they mentioned lack
              of Databricks experience.”
            </p>
          </div>
        )}
        {state.messages.map((message) =>
          message.role === "user" ? (
            <article className="buddy-message is-user" key={message.id}>
              <div className="buddy-message-byline">
                You · {formatDate(message.createdAt, timezone, true)}
              </div>
              <Text value={message.content} />
            </article>
          ) : (
            <Reply
              key={message.id}
              message={message}
              opportunity={o}
              timezone={timezone}
              base={base}
              onChanged={changed}
              onError={onError}
            />
          ),
        )}
        <AIRequestProgress id={activeRequest} scope={"opportunity:"+o.id} onError={onError}/>
        {busy && (
          <div className="buddy-working" role="status">
            <LoaderCircle size={16} className="spin" />
            Career Buddy is reading your selected sources and thinking…
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="buddy-presets" aria-label="Career Buddy prompts">
        {prompts.map((p) => (
          <button
            key={p.action}
            type="button"
            disabled={busy || !active}
            onClick={() => {
              setAction(p.action);
              setInput(p.prompt);
            }}
          >
            <Sparkles size={13} />
            {p.label}
          </button>
        ))}
      </div>
      <form
        className="buddy-composer"
        onSubmit={send}
        data-editing={input ? "true" : undefined}
      >
        <label className="field">
          <span>
            Message Career Buddy
            {action !== "chat"
              ? " · " + prompts.find((p) => p.action === action)?.label
              : ""}
          </span>
          <textarea
            rows={3}
            maxLength={12000}
            value={input}
            disabled={busy || !active}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask anything about this opportunity, or describe an update…"
          />
        </label>
        <div className="buddy-composer-bottom">
          <small>
            Changes are proposed for review. Drafts need a factual and layout
            check before use.
          </small>
          <button
            className="button primary"
            disabled={busy || !active || !input.trim()}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Send size={15} />
            )}
            Send
          </button>
        </div>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {taskPackOpen && (
        <div className="task-pack-modal-backdrop" onClick={() => !packBusy && setTaskPackOpen(false)}>
          <div className="task-pack-modal" role="dialog" aria-labelledby="task-pack-title" onClick={(e) => e.stopPropagation()}>
            <div className="task-pack-modal-header">
              <h3 id="task-pack-title">Export task pack for external assistants</h3>
              <button
                type="button"
                className="button secondary small"
                disabled={packBusy}
                onClick={() => setTaskPackOpen(false)}
              >
                Close
              </button>
            </div>
            <p className="task-pack-desc">
              Package opportunity details, selected career evidence, instructions, and the required schema into a ZIP bundle to use with Claude Desktop, offline LLMs, or other tools without API keys or credentials.
            </p>
            <div className="task-pack-form">
              <label className="field">
                <span>Task action</span>
                <select
                  value={taskAction}
                  disabled={packBusy}
                  onChange={(e) => setTaskAction(e.target.value)}
                >
                  <option value="general">General advice / question</option>
                  <option value="fit">Assess candidate fit & criteria</option>
                  <option value="salary">Estimate salary & negotiation</option>
                  <option value="skills">Review skills & evidence match</option>
                  <option value="cv">Tailor CV draft</option>
                  <option value="cover">Tailor cover letter draft</option>
                </select>
              </label>
              <label className="field">
                <span>Custom instructions / request (optional)</span>
                <textarea
                  rows={3}
                  value={taskInstructions}
                  disabled={packBusy}
                  onChange={(e) => setTaskInstructions(e.target.value)}
                  placeholder="e.g. Focus on our distributed systems achievements and leadership experience…"
                />
              </label>
              <div className="task-pack-summary">
                <small>
                  Sources included: <strong>{selected.length} document(s)</strong> selected.
                  {others ? " · Other opportunity summaries included." : ""}
                </small>
              </div>
            </div>
            <div className="task-pack-modal-actions">
              <button
                type="button"
                className="button secondary"
                disabled={packBusy}
                onClick={() => setTaskPackOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button primary"
                disabled={packBusy}
                onClick={() => void downloadTaskPack()}
              >
                {packBusy ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
                Download ZIP task pack
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="task-pack-modal-backdrop" onClick={() => !importBusy && setImportOpen(false)}>
          <div className="task-pack-modal" role="dialog" aria-labelledby="import-result-title" onClick={(e) => e.stopPropagation()}>
            <div className="task-pack-modal-header">
              <h3 id="import-result-title">Import external assistant result</h3>
              <button
                type="button"
                className="button secondary small"
                disabled={importBusy}
                onClick={() => setImportOpen(false)}
              >
                Close
              </button>
            </div>
            <p className="task-pack-desc">
              Paste the structured JSON response or markdown output returned by your external assistant. Results will be validated against this opportunity’s revision before applying.
            </p>
            <div className="task-pack-form">
              <label className="field">
                <span>Assistant response text or JSON</span>
                <textarea
                  rows={6}
                  value={importText}
                  disabled={importBusy}
                  onChange={(e) => {
                    setImportText(e.target.value);
                    setImportPreview(null);
                  }}
                  placeholder="Paste response here (raw JSON or ```json ... ``` codeblock)..."
                />
              </label>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  type="button"
                  className="button secondary small"
                  disabled={importBusy || !importText.trim()}
                  onClick={() => void previewAssistantResult()}
                >
                  {importBusy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
                  Validate & preview
                </button>
                <input
                  type="file"
                  accept=".json,.txt,.md"
                  style={{ display: "none" }}
                  id="import-result-file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = () => {
                        setImportText(String(reader.result || ""));
                        setImportPreview(null);
                      };
                      reader.readAsText(file);
                    }
                  }}
                />
                <label htmlFor="import-result-file" className="button secondary small" style={{ cursor: "pointer", margin: 0 }}>
                  Upload file
                </label>
              </div>

              {importError && (
                <p className="form-error" role="alert">
                  {importError}
                </p>
              )}

              {importPreview && (
                <div className="task-pack-preview-box">
                  <h4>Preview of assistant response</h4>
                  <p className="task-pack-preview-reply">{importPreview.reply}</p>
                  {importPreview.changes.length > 0 && (
                    <div className="task-pack-preview-changes">
                      <h5>Proposed record changes ({importPreview.changes.length}):</h5>
                      <ul>
                        {importPreview.changes.map((c, i) => (
                          <li key={i}>
                            <strong>{c.kind}:</strong> {c.field || c.title} {c.value ? `→ "${c.value}"` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {importPreview.draft && importPreview.draft.kind !== "none" && (
                    <div className="task-pack-preview-draft">
                      <h5>Generated document draft:</h5>
                      <p>
                        <strong>{importPreview.draft.kind === "cv" ? "CV" : "Cover letter"}:</strong> {importPreview.draft.title}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="task-pack-modal-actions">
              <button
                type="button"
                className="button secondary"
                disabled={importBusy}
                onClick={() => setImportOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button primary"
                disabled={importBusy || !importPreview}
                onClick={() => void applyAssistantResult()}
              >
                {importBusy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}
                Apply reviewed changes & draft
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
function Reply({
  message: m,
  opportunity: o,
  timezone,
  base,
  onChanged,
  onError,
}: {
  message: BuddyMessage;
  opportunity: Opportunity;
  timezone: string;
  base: string;
  onChanged: (result: {
    opportunity: Opportunity;
    messages: BuddyMessage[];
  }) => void;
  onError: (e: unknown) => void;
}) {
  const [changes, setChanges] = useState(m.appliedChanges || m.changes),
    [content, setContent] = useState(m.editedDraft?.content || m.draft.content),
    [title, setTitle] = useState(m.editedDraft?.title || m.draft.title),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const stale = o.revision !== m.baseRevision;
  const update = (index: number, patch: Partial<Change>) =>
    setChanges((current) =>
      current.map((change, i) =>
        i === index ? { ...change, ...patch } : change,
      ),
    );
  async function mutate(kind: "apply" | "draft") {
    setBusy(kind);
    setError("");
    try {
      onChanged(
        await api(
          base + "/" + kind + "/" + m.id,
          json(
            kind === "apply"
              ? { revision: o.revision, changes }
              : { title, content },
          ),
        ),
      );
    } catch (error) {
      setError(errorText(error));
      if (error instanceof ApiError && error.status === 409) {
        try {
          const [opportunity, history] = await Promise.all([
            api<Opportunity>("/opportunities/" + o.id),
            api<{ messages: BuddyMessage[] }>(base),
          ]);
          onChanged({ opportunity, messages: history.messages });
        } catch (refreshError) {
          onError(refreshError);
        }
      }
      onError(error);
    } finally {
      setBusy("");
    }
  }
  return (
    <article className="buddy-message is-assistant">
      <div className="buddy-message-byline">
        <Bot size={14} />
        Career Buddy · {formatDate(m.createdAt, timezone, true)}
      </div>
      <Text value={m.content} />
      {!!changes.length && (
        <details className="buddy-proposal" open={!m.appliedAt}>
          <summary>
            {m.appliedAt ? (
              <>
                <Check size={15} />
                Changes applied
              </>
            ) : (
              <>
                <FileText size={15} />
                Review proposed changes ({changes.length})
              </>
            )}
          </summary>
          <div className="buddy-proposal-body">
            {changes.map((change, index) => (
              <fieldset disabled={!!m.appliedAt || !!busy} key={index}>
                <legend>
                  {change.kind === "update"
                    ? "Update " + change.field
                    : change.kind === "note"
                      ? "Timeline note"
                      : change.kind === "interview"
                        ? "Interview"
                        : "Communication"}
                </legend>
                {change.kind === "update" ? (
                  <label className="field">
                    <span>{change.field}</span>
                    <textarea
                      rows={2}
                      value={change.value}
                      onChange={(event) =>
                        update(index, { value: event.target.value })
                      }
                    />
                  </label>
                ) : (
                  <>
                    <div className="form-grid">
                      <label className="field">
                        <span>Title</span>
                        <input
                          value={change.title}
                          maxLength={300}
                          onChange={(event) =>
                            update(index, { title: event.target.value })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Date</span>
                        <input
                          type="date"
                          value={change.date}
                          onChange={(event) =>
                            update(index, { date: event.target.value })
                          }
                        />
                      </label>
                      {change.kind !== "note" && (
                        <>
                          <label className="field">
                            <span>Type</span>
                            <select
                              value={change.type}
                              onChange={(event) =>
                                update(index, { type: event.target.value })
                              }
                            >
                              {[
                                "text",
                                "phone",
                                "video",
                                "in-person",
                                "assessment",
                                "email",
                                "other",
                              ].map((type) => (
                                <option key={type}>{type}</option>
                              ))}
                            </select>
                          </label>
                          <label className="field">
                            <span>Status</span>
                            <select
                              value={change.status}
                              onChange={(event) =>
                                update(index, { status: event.target.value })
                              }
                            >
                              {["planned", "completed", "cancelled"].map(
                                (status) => (
                                  <option key={status}>{status}</option>
                                ),
                              )}
                            </select>
                          </label>
                        </>
                      )}
                    </div>
                    <label className="field">
                      <span>Notes and feedback</span>
                      <textarea
                        rows={3}
                        value={change.notes}
                        maxLength={12000}
                        onChange={(event) =>
                          update(index, { notes: event.target.value })
                        }
                      />
                    </label>
                    {change.kind === "interview" && (
                      <label className="buddy-toggle">
                        <input
                          type="checkbox"
                          checked={change.isFinal}
                          onChange={(event) =>
                            update(index, { isFinal: event.target.checked })
                          }
                        />
                        Final interview
                      </label>
                    )}
                  </>
                )}
              </fieldset>
            ))}
            {!m.appliedAt && (
              <>
                <p className="buddy-muted">
                  {stale
                    ? "The opportunity has changed since this proposal. Ask Career Buddy for a fresh proposal using the latest record."
                    : "Review the date, feedback and fields above, then apply to this opportunity."}
                </p>
                <button
                  type="button"
                  className="button primary small"
                  disabled={!!busy || stale}
                  onClick={() => void mutate("apply")}
                >
                  {busy === "apply" ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  Apply reviewed changes
                </button>
              </>
            )}
          </div>
        </details>
      )}
      {m.draft.kind !== "none" && (
        <details className="buddy-draft" open>
          <summary>
            <FileText size={15} />
            {m.draft.kind === "cv"
              ? "Tailored CV draft"
              : "Tailored cover letter draft"}
          </summary>
          <div className="buddy-proposal-body">
            <label className="field">
              <span>Draft title</span>
              <input
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Edit your draft</span>
              <textarea
                className="buddy-draft-editor"
                rows={16}
                maxLength={60000}
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
            </label>
            <p className="buddy-muted">
              Word export uses a clean layout with headings and bullets.
              Original source formatting is not copied. Review the wording and
              layout before approving it.
            </p>
            <div className="buddy-buttons">
              <button
                type="button"
                className="button primary small"
                disabled={!!busy || !content.trim() || !title.trim()}
                onClick={() => void mutate("draft")}
              >
                {busy === "draft" ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <FileText size={14} />
                )}
                Save Word draft to Documents
              </button>
              <button
                type="button"
                className="button secondary small"
                onClick={() =>
                  download(
                    (title.replace(/[^a-zA-Z0-9 _-]/g, "") || "career-draft") +
                      ".md",
                    content,
                    "text/markdown",
                  )
                }
              >
                Download text
              </button>
            </div>
            {m.savedDocuments?.map((doc) => (
              <a className="buddy-draft-link" key={doc.id} href={doc.url}>
                Download {doc.name}
              </a>
            ))}
          </div>
        </details>
      )}
      {!!m.sources?.length && (
        <details className="buddy-sources">
          <summary>
            Source coverage ·{" "}
            {m.sources.filter((source) => source.included).length} documents
            sent as excerpts
          </summary>
          {m.context?.retrieval && (
            <p>
              {m.context.retrieval.mode === "hybrid"
                ? `Meaning + keyword search · ${m.context.retrieval.indexedSources} indexed sources checked`
                : "Keyword search"}
              {m.context.retrieval.reason &&
                " · " +
                  ({
                    "not-indexed":
                      "Selected sources have no saved vectors. Index them in the Career Hub to enable meaning-based matches.",
                    "external-provider":
                      "Local semantic search requires the built-in embedding provider in Settings.",
                    "model-unavailable":
                      "The local embedding model was unavailable; keyword search was used.",
                    "indexing-in-progress":
                      "An indexing job is running; keyword search was used.",
                    "no-semantic-matches":
                      "No usable meaning-based matches; keyword search was used.",
                  }[m.context.retrieval.reason] ||
                    "Keyword fallback was used.")}
            </p>
          )}
          <ul>
            {m.sources.map((source) => (
              <li key={source.id}>
                <strong>{source.name}</strong> ·{" "}
                {source.included ? "Excerpts sent" : "Not included"}
                {!!source.excerpts?.length && (
                  <small>
                    Passages:{" "}
                    {source.excerpts
                      .map(
                        (excerpt) =>
                          `${excerpt.index} (${excerpt.matchedBy.map((method) => (method === "semantic" ? "meaning" : method === "source-opening" ? "opening" : method)).join(" + ")})`,
                      )
                      .join(", ")}
                  </small>
                )}
                {source.warnings.length > 0
                  ? " · " + source.warnings.join(" ")
                  : ""}
              </li>
            ))}
          </ul>
          {!!m.context?.omittedChunks && (
            <p>
              {m.context.omittedChunks} chunks were outside this request’s
              context limit. Narrow your selection to focus on them.
            </p>
          )}
          <small>
            {m.provider} · {m.model}
            {m.context?.otherOpportunities
              ? " · " +
                m.context.otherOpportunities +
                " other opportunity summaries"
              : ""}
          </small>
        </details>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
