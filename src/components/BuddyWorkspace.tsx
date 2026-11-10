import { uploadId } from "../lib/upload-queue";
import BuddyRequestDetails, {
  requestStage,
  type BuddyRequestInfo,
} from "./BuddyRequestDetails";
import { useEffect, useState, useRef } from "react";
import { api, json, readFile, ApiError } from "../api";
import {
  UploadCloud,
  FilePlus2,
  FileText,
  X,
  Send,
  Plus,
  Check,
  LoaderCircle,
  BriefcaseBusiness,
  History,
  ChevronDown,
  Search,
  PanelLeft,
} from "lucide-react";
import BuddyAvatar from "./BuddyAvatar";

type Message = {
  id: string;
  role: string;
  mode: string;
  content: string;
  createdAt: string;
  cursor?: number;
  status?: string;
  requestId?: string;
  attachments?: { id: string; name: string }[];
  appliedAt?: string;
  result?: { id?: string };
  sourceIds?: string[];
  sources?: { id: string; name: string; index: number }[];
  proposal?: {
    opportunity: {
      company?: string;
      role?: string;
      location?: string;
      salary?: string;
      workMode?: string;
      employmentType?: string;
      deadline?: string;
      contact?: string;
      description?: string;
      jobReference?: string;
      tags?: string[];
    } | null;
    cv?: { title: string; content: string } | null;
    tasks: { title?: string; dueDate?: string; notes?: string }[];
    star: object | null;
    changes: object[];
    targetId: string;
    revision: number;
  };
};

type State = {
  messages: Message[];
  conversations: {
    id: string;
    title: string;
    updatedAt: string;
    count: number;
  }[];
  attachments: {
    id: string;
    name: string;
    status: string;
    preview: string;
    warnings: string[];
  }[];
  settings: { enabled: boolean };
  documents: { id: string; name: string; folder?: string; category?: string }[];
  opportunities: { id: string; company: string; role: string }[];
};

export default function BuddyWorkspace({
  onError,
  onChanged,
  onNotice,
  focusedDocument,
  onClearFocusedDocument,
  initialPrompt,
  onInitialPromptConsumed,
  compact = false,
}: {
  onError: (e: unknown) => void;
  onChanged: () => void;
  onNotice?: (message: string) => void;
  focusedDocument?: { id: string; name: string } | null;
  onClearFocusedDocument?: () => void;
  initialPrompt?: string;
  onInitialPromptConsumed?: () => void;
  compact?: boolean;
}) {
  const [conversationId, setConversationId] = useState(
    () => localStorage.getItem("knox-buddy-conversation") || "legacy",
  );
  const [historySearch, setHistorySearch] = useState("");
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [request, setRequest] = useState<BuddyRequestInfo | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const drafts = useRef<Record<string, string>>({});
  const loadSequence = useRef(0);

  const [state, setState] = useState<State | null>(null);
  const [attached, setAttached] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [olderAvailable, setOlderAvailable] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [appendedMasterIds, setAppendedMasterIds] = useState<Record<string, boolean>>({});
  const [customTitles, setCustomTitles] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<{
    message: string;
    requestId: string;
  } | null>(null);

  useEffect(() => {
    const pollingId = busy
      ? pending?.requestId
      : request?.finishedAt
        ? null
        : request?.id;
    if (!pollingId) return;
    const timer = window.setInterval(() => {
      void api<{ request: NonNullable<typeof request> }>(
        "/buddy/requests/" + pollingId,
      )
        .then((r) => {
          setRequest(r.request);
          setElapsed(
            Math.floor((Date.now() - Date.parse(r.request.startedAt)) / 1000),
          );
        })
        .catch(() => {});
    }, 750);
    return () => window.clearInterval(timer);
  }, [busy, pending?.requestId, request?.id, request?.finishedAt]);

  async function load(id = conversationId) {
    const sequence = ++loadSequence.current;
    const [result, latest] = await Promise.all([
      api<State>("/buddy/workspace?conversationId=" + encodeURIComponent(id)),
      api<{ request: BuddyRequestInfo | null }>(
        "/buddy/requests?scope=" + encodeURIComponent(id),
      ),
    ]);
    if (sequence !== loadSequence.current) return;
    setState(result);
    setRequest(latest.request);
    setOlderAvailable(result.messages.length >= 100);
  }

  useEffect(() => {
    void load().catch(onError);
  }, [conversationId]);

  useEffect(() => {
    if (initialPrompt && initialPrompt.trim()) {
      setInput(initialPrompt);
      onInitialPromptConsumed?.();
    }
  }, [initialPrompt]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [conversationId, state?.messages.at(-1)?.id, state?.messages.length]);

  function chooseConversation(id: string) {
    if (busy || id === conversationId) return;
    loadSequence.current++;
    setRequest(null);
    drafts.current[conversationId] = input;
    localStorage.setItem("knox-buddy-conversation", id);
    setState(null);
    setInput(drafts.current[id] || "");
    setPending(null);
    setAttached([]);
    setConversationId(id);
  }

  async function handleFiles(files: File[]) {
    if (!files.length) return;
    if (files.length + attached.length > 5) {
      onError(new Error("Choose up to five attachments per message."));
      return;
    }
    setBusy(true);
    try {
      const added: string[] = [];
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) {
          throw new Error(`"${file.name}" is larger than 5 MB.`);
        }
        const a = await api<State["attachments"][number]>(
          "/buddy/attachments",
          json({
            name: file.name,
            contentBase64: await readFile(file),
          }),
        );
        added.push(a.id);
      }
      setAttached((current) => [...current, ...added]);
      setPending(null);
      await load();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  async function send(overrideMessage?: string) {
    const textToSend = overrideMessage || input;
    if (!textToSend.trim() && !attached.length) return;
    setBusy(true);
    setRequest(null);
    setElapsed(0);
    const draft =
      pending?.message === (textToSend || "Please review the attached material.")
        ? pending
        : {
            message: textToSend || "Please review the attached material.",
            requestId: uploadId(),
          };
    setPending(draft);
    try {
      await api(
        "/buddy/workspace",
        json({
          ...draft,
          mode: "auto",
          conversationId,
          documentIds: focusedDocument?.id ? [focusedDocument.id] : [],
          useLibrary: true,
          attachmentIds: attached,
          templateId: "",
          targetId: "",
        }),
      );
      setPending(null);
      if (!overrideMessage) setInput("");
      setAttached([]);

      await load();
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 499)) onError(e);
      await load().catch(onError);
    } finally {
      try {
        const r = await api<{ request: NonNullable<typeof request> }>(
          "/buddy/requests/" + draft.requestId,
        );
        setRequest(r.request);
      } catch {}
      setBusy(false);
    }
  }

  async function applyOpportunity(messageId: string) {
    setBusy(true);
    try {
      await api(
        "/buddy/workspace/" + messageId + "/apply",
        json({ confirm: true }),
      );
      await load();
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  const latestUnappliedOpportunity = state?.messages
    ?.slice()
    .reverse()
    .find((m) => m.proposal?.opportunity && !m.appliedAt);

  return (
    <main className={`content-page buddy-workspace-page ${compact ? "is-compact-pane" : ""}`.trim()}>
      {!compact && (
        <div className="page-heading">
          <div>
            <div className="eyebrow">CAREER ASSISTANT</div>
            <h1>Career Buddy</h1>
            <p>
              Chat about your career documents, draft STAR stories, or extract opportunities from job descriptions.
            </p>
          </div>
        </div>
      )}

      <div className={`buddy-workspace-layout ${showSidebar && !compact ? "with-sidebar" : "full-width"}`}>
        {/* Optional Left Sidebar: Only when pinned */}
        {showSidebar && !compact && (
          <aside
            className="buddy-history-sidebar"
            aria-label="Chat history sidebar"
          >
            <div className="buddy-history-header">
              <strong>Chat history</strong>
              <button
                type="button"
                className="button primary small"
                disabled={busy}
                onClick={() => chooseConversation(uploadId())}
              >
                New conversation
              </button>
            </div>

            <label className="field" style={{ margin: "12px 0" }}>
              <input
                type="search"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search conversations…"
              />
            </label>

            <nav className="buddy-history-nav" aria-label="Saved Career Buddy conversations">
              {state?.conversations
                ?.filter((c) =>
                  c.title.toLowerCase().includes(historySearch.toLowerCase()),
                )
                .map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    disabled={busy}
                    aria-pressed={c.id === conversationId}
                    className="buddy-history-item"
                    onClick={() => chooseConversation(c.id)}
                  >
                    <strong>{c.title}</strong>
                    <small>
                      {new Date(c.updatedAt).toLocaleDateString()} · {c.count} messages
                    </small>
                  </button>
                ))}
              {state?.conversations?.length === 0 && (
                <p className="buddy-muted" style={{ padding: "8px 0" }}>
                  No saved chats yet.
                </p>
              )}
            </nav>
          </aside>
        )}

        {/* Main Chat Pane: Full width with Dynamic Pull-down Drawer */}
        <section
          className="buddy-chat-pane"
          aria-label="Active Career Buddy conversation"
        >
          {/* Top Header */}
          <header className="buddy-chat-header">
            <div className="buddy-chat-title-row">
              <div className="buddy-chat-heading-group">
                <button
                  type="button"
                  className={`buddy-history-pulldown-btn ${historyDrawerOpen ? "is-open" : ""}`}
                  onClick={() => setHistoryDrawerOpen(!historyDrawerOpen)}
                  aria-expanded={historyDrawerOpen}
                  title="Browse chat history"
                >
                  <History size={15} />
                  <span>Chats ({state?.conversations?.length || 0})</span>
                  <ChevronDown
                    size={14}
                    className={`buddy-chevron ${historyDrawerOpen ? "open" : ""}`}
                  />
                </button>
                <button
                  type="button"
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => {
                    chooseConversation(uploadId());
                    setHistoryDrawerOpen(false);
                  }}
                  title="Start a new chat"
                >
                  <Plus size={14} />
                  <span>New chat</span>
                </button>
                <h2>
                  {state?.conversations?.find((c) => c.id === conversationId)?.title ||
                    "New conversation"}
                </h2>
              </div>
              <div className="buddy-chat-header-actions">
                {!compact && (
                  <button
                    type="button"
                    className={`button secondary small ${showSidebar ? "active" : ""}`}
                    onClick={() => setShowSidebar(!showSidebar)}
                    title={showSidebar ? "Hide sidebar" : "Pin history to side"}
                  >
                    <PanelLeft size={14} />
                    <span>{showSidebar ? "Hide sidebar" : "Pin sidebar"}</span>
                  </button>
                )}
                {busy && (
                  <span className="badge green small">
                    <LoaderCircle size={12} className="spin" />
                    Buddy is thinking…
                  </span>
                )}
              </div>
            </div>

            {/* Dynamic Pull-down Drawer for Chat History */}
            {historyDrawerOpen && (
              <div className="buddy-history-pulldown">
                <div className="buddy-history-pulldown-bar">
                  <div className="buddy-history-search-wrap">
                    <Search size={14} className="text-muted" />
                    <input
                      type="search"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="Search previous chats…"
                      autoFocus
                    />
                  </div>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => setHistoryDrawerOpen(false)}
                  >
                    <X size={14} />
                    <span>Close</span>
                  </button>
                </div>
                <div className="buddy-history-pulldown-content">
                  {state?.conversations
                    ?.filter((c) =>
                      c.title.toLowerCase().includes(historySearch.toLowerCase()),
                    )
                    .map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        disabled={busy}
                        aria-pressed={c.id === conversationId}
                        className={`buddy-history-card ${c.id === conversationId ? "active" : ""}`}
                        onClick={() => {
                          chooseConversation(c.id);
                          setHistoryDrawerOpen(false);
                        }}
                      >
                        <div className="history-card-top">
                          <strong className="history-card-title">{c.title}</strong>
                          <span className="history-card-badge">{c.count} msg</span>
                        </div>
                        <div className="history-card-date">
                          {new Date(c.updatedAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </div>
                      </button>
                    ))}
                  {(!state?.conversations || state.conversations.length === 0) && (
                    <p className="buddy-muted" style={{ padding: "16px" }}>
                      No saved chats yet.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Single clean Upload or Drag & Drop option */}
            <div
              className={`buddy-dropzone ${isDragging ? "is-dragover" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const files = Array.from(e.dataTransfer.files || []);
                if (files.length) void handleFiles(files);
              }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              title="Click or drag files here to attach"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = "";
                  if (files.length) void handleFiles(files);
                }}
              />
              <UploadCloud size={16} />
              <span>
                {attached.length > 0
                  ? "Drop more files here or click to browse"
                  : "Drop a job description, CV, or recruiter notes here, or click to upload"}
              </span>
            </div>

            {focusedDocument && (
              <div className="buddy-attached-chips" style={{ marginBottom: 8 }}>
                <span className="buddy-file-chip" style={{ background: "var(--accent-soft)", borderColor: "var(--green)" }}>
                  <FileText size={13} />
                  <span className="buddy-chip-label">
                    Active Doc: <strong>{focusedDocument.name}</strong>
                  </span>
                  {onClearFocusedDocument && (
                    <button
                      type="button"
                      className="buddy-chip-remove"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        onClearFocusedDocument();
                      }}
                      title="Clear focused document"
                    >
                      <X size={12} />
                    </button>
                  )}
                </span>
              </div>
            )}

            {attached.length > 0 && (
              <div className="buddy-attached-chips">
                {attached.map((id) => {
                  const file = state?.attachments?.find((a) => a.id === id);
                  return (
                    <span key={id} className="buddy-file-chip">
                      <FileText size={13} />
                      <span className="buddy-chip-label">
                        {file ? file.name : "Attachment"}
                      </span>
                      <button
                        type="button"
                        className="buddy-chip-remove"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          setAttached((curr) => curr.filter((x) => x !== id));
                        }}
                        title="Remove attachment"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </header>

          {!state?.settings.enabled && (
            <p className="form-error" style={{ margin: "12px 18px" }}>
              Enable and configure Career Buddy in Settings to chat.
            </p>
          )}

          {/* Scrollable Messages Area */}
          <div
            className="buddy-chat-messages"
            ref={messagesContainerRef}
            aria-live="polite"
            aria-label="Messages in this conversation"
          >
            {olderAvailable && (state?.messages.length || 0) >= 100 && (
              <div style={{ textAlign: "center", marginBottom: "8px" }}>
                <button
                  type="button"
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => {
                    const before = state?.messages[0]?.cursor;
                    if (!before) return;
                    void api<State>(
                      "/buddy/workspace?conversationId=" +
                        encodeURIComponent(conversationId) +
                        "&before=" +
                        before,
                    )
                      .then((older) => {
                        setOlderAvailable(older.messages.length >= 100);
                        setState((current) =>
                          current
                            ? {
                                ...current,
                                messages: [...older.messages, ...current.messages],
                              }
                            : current,
                        );
                      })
                      .catch(onError);
                  }}
                >
                  Load earlier history
                </button>
              </div>
            )}

            {state?.messages.length === 0 && (
              <div className="buddy-empty-chat">
                <div style={{ marginBottom: "8px" }}>
                  <BuddyAvatar size={40} />
                </div>
                <h3>How can I help you today?</h3>
                <p>
                  {focusedDocument
                    ? `Ask questions about "${focusedDocument.name}", refine its bullets, or extract achievements for your Master CV.`
                    : "Ask career advice, drop a job description or recruiter message to add an opportunity, or work on a STAR achievement story together."}
                </p>
              </div>
            )}

            {state?.messages.map((m) => (
              <article className="buddy-chat-message" data-role={m.role} key={m.id}>
                <div className="buddy-msg-header">
                  {m.role === "user" ? (
                    <>
                      <div className="buddy-avatar user">You</div>
                      <span className="buddy-msg-time">
                        {new Date(m.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="buddy-avatar buddy" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <BuddyAvatar size={18} /> Career Buddy
                      </div>
                      <span className="buddy-msg-time">
                        {new Date(m.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </>
                  )}
                </div>

                <div className="buddy-msg-content">
                  <p style={{ whiteSpace: "pre-wrap", margin: "4px 0" }}>{m.content}</p>
                  {m.role === "assistant" && (
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="button secondary small"
                        disabled={busy || Boolean(appendedMasterIds[m.id])}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const res = await api<{ message: string }>(
                              "/document-studio/master-cv/append",
                              json({
                                content: m.content,
                                heading: focusedDocument
                                  ? `Notes from ${focusedDocument.name}`
                                  : "Career Buddy Evidence & Notes",
                              }),
                            );
                            setAppendedMasterIds((prev) => ({ ...prev, [m.id]: true }));
                            onNotice?.(res.message || "Added to Master CV.");
                            onChanged();
                          } catch (err) {
                            onError(err);
                          } finally {
                            setBusy(false);
                          }
                        }}
                        title="Append this response directly to your Master CV in Career Docs"
                      >
                        {appendedMasterIds[m.id] ? (
                          <Check size={13} />
                        ) : (
                          <FilePlus2 size={13} />
                        )}
                        {appendedMasterIds[m.id] ? "Added to Master CV" : "Add to Master CV"}
                      </button>
                    </div>
                  )}

                  {m.role === "user" &&
                    ["failed", "cancelled", "interrupted"].includes(m.status || "") && (
                      <div className="buddy-retry-notice" style={{ marginTop: "10px" }}>
                        <p className="buddy-muted">This message was not completed.</p>
                        <button
                          type="button"
                          className="button secondary small"
                          disabled={busy}
                          onClick={() => {
                            setInput(m.content);
                            setPending({
                              message: m.content,
                              requestId: m.requestId || uploadId(),
                            });
                            setAttached(
                              (m.attachments || [])
                                .map((a) => a.id)
                                .filter((id) =>
                                  state?.attachments.some((a) => a.id === id),
                                ),
                            );
                          }}
                        >
                          Review message for retry
                        </button>
                      </div>
                    )}

                  {!!m.attachments?.length && (
                    <div className="buddy-msg-attachments" style={{ marginTop: "8px" }}>
                      <FileText size={13} />
                      <span>
                        Attachments: {m.attachments.map((a) => a.name).join(", ")}
                      </span>
                    </div>
                  )}

                  {/* IMMEDIATELY VISIBLE Opportunity Proposal (NOT tucked behind a fold) */}
                  {m.proposal?.opportunity && (
                    <div className="buddy-opportunity-card">
                      <div className="buddy-opp-card-badge">
                        <BriefcaseBusiness size={14} />
                        <span>Opportunity Proposal</span>
                      </div>
                      <h4>
                        {m.proposal.opportunity.role || "Role"} at{" "}
                        {m.proposal.opportunity.company || "Company"}
                      </h4>
                      <div className="buddy-opp-card-meta">
                        {m.proposal.opportunity.location && (
                          <span>📍 {m.proposal.opportunity.location}</span>
                        )}
                        {m.proposal.opportunity.workMode && (
                          <span>💼 {m.proposal.opportunity.workMode}</span>
                        )}
                        {m.proposal.opportunity.salary && (
                          <span>💰 {m.proposal.opportunity.salary}</span>
                        )}
                        {m.proposal.opportunity.deadline && (
                          <span>📅 Deadline: {m.proposal.opportunity.deadline}</span>
                        )}
                        {m.proposal.opportunity.employmentType && (
                          <span>⏱ {m.proposal.opportunity.employmentType}</span>
                        )}
                      </div>

                      {m.proposal.tasks && m.proposal.tasks.length > 0 && (
                        <div className="buddy-opp-card-tasks">
                          <strong>Next actions:</strong>
                          <ul>
                            {m.proposal.tasks.map((t, idx) => (
                              <li key={idx}>
                                {t.title} {t.dueDate ? `· Due ${t.dueDate}` : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="buddy-opp-card-actions">
                        <button
                          type="button"
                          className="button primary small"
                          disabled={busy || !!m.appliedAt}
                          onClick={() => void applyOpportunity(m.id)}
                        >
                          {m.appliedAt ? (
                            <>
                              <Check size={14} /> Created on your board
                            </>
                          ) : (
                            <>
                              <Plus size={14} /> Create opportunity & action items
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* CV, STAR or Update proposals */}
                  {m.proposal &&
                    (m.proposal.cv ||
                      m.proposal.star ||
                      (m.proposal.changes && m.proposal.changes.length > 0)) && (
                      <details className="buddy-generic-proposal" open>
                        <summary>
                          {m.appliedAt ? "Saved proposal" : "Review proposal"}
                        </summary>
                        <ProposalPreview
                          value={
                            m.proposal.cv || m.proposal.star || m.proposal.changes
                          }
                        />
                        {m.proposal.star && !m.appliedAt && (
                          <label
                            className="field"
                            style={{ marginTop: "8px", marginBottom: "8px" }}
                          >
                            <span>Story title (optional file name in Career Docs)</span>
                            <input
                              type="text"
                              maxLength={100}
                              placeholder="Career STAR highlight"
                              value={customTitles[m.id] ?? ""}
                              disabled={busy}
                              onChange={(e) =>
                                setCustomTitles((prev) => ({
                                  ...prev,
                                  [m.id]: e.target.value,
                                }))
                              }
                            />
                          </label>
                        )}
                        <div className="buddy-buttons" style={{ marginTop: "12px" }}>
                          <button
                            type="button"
                            className="button primary small"
                            disabled={busy || !!m.appliedAt}
                            onClick={() => {
                              setBusy(true);
                              void api(
                                "/buddy/workspace/" + m.id + "/apply",
                                json({
                                  confirm: true,
                                  ...(m.proposal?.star && customTitles[m.id]?.trim()
                                    ? { title: customTitles[m.id].trim() }
                                    : {}),
                                }),
                              )
                                .then(async () => {
                                  await load();
                                  onChanged();
                                })
                                .catch(onError)
                                .finally(() => setBusy(false));
                            }}
                          >
                            {m.appliedAt
                              ? "Saved"
                              : m.proposal.cv
                                ? "Save master CV draft to library"
                                : m.proposal.star
                                  ? "Save STAR highlight to library"
                                  : "Confirm opportunity update"}
                          </button>
                          {m.proposal.cv && m.appliedAt && m.result?.id && (
                            <a
                              className="button secondary small"
                              href={"/api/documents/" + m.result.id + "/content"}
                            >
                              Download master CV
                            </a>
                          )}
                          {m.proposal.star && m.appliedAt && m.result?.id && (
                            <a
                              className="button secondary small"
                              href={"/api/documents/" + m.result.id + "/content"}
                            >
                              Download STAR story
                            </a>
                          )}
                        </div>
                      </details>
                    )}
                </div>
              </article>
            ))}
            <div ref={messagesEnd} />
          </div>

          {/* PINNED Composer at the Bottom of the Pane (Never scrolled out of view) */}
          <div className="buddy-composer-container">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className="buddy-composer-form"
            >
              <textarea
                className="buddy-composer-textarea"
                rows={2}
                maxLength={12000}
                disabled={busy}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setPending(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Message Career Buddy, ask for advice, or paste a job description…"
              />

              <div className="buddy-composer-actions">
                <div className="buddy-composer-status">
                  {busy && pending ? (
                    request ? (
                      <span className="buddy-muted">
                        {requestStage(request.stage)} · {elapsed}s elapsed
                      </span>
                    ) : (
                      <span className="buddy-muted">Starting request…</span>
                    )
                  ) : null}
                </div>

                <div className="buddy-composer-buttons">
                  {/* IMMEDIATELY VISIBLE Opportunity Button Next to Send Button */}
                  {latestUnappliedOpportunity ? (
                    <button
                      type="button"
                      className="button primary"
                      disabled={busy}
                      onClick={() =>
                        void applyOpportunity(latestUnappliedOpportunity.id)
                      }
                      title={`Create opportunity for ${latestUnappliedOpportunity.proposal?.opportunity?.role || "role"} at ${latestUnappliedOpportunity.proposal?.opportunity?.company || "company"}`}
                    >
                      <Plus size={15} />
                      Create opportunity
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy || (!input.trim() && !attached.length)}
                      onClick={() => {
                        const prompt = input.trim()
                          ? `Please extract this job information and create an opportunity with action items:\n\n${input}`
                          : "Please extract the job information from the attached file and create an opportunity with action items.";
                        void send(prompt);
                      }}
                      title="Extract and create an opportunity from your input or attachment"
                    >
                      <Plus size={15} />
                      Create opportunity
                    </button>
                  )}

                  {busy && pending ? (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={!request || request.stage === "cancelling"}
                      onClick={() => {
                        void api<{ request: NonNullable<typeof request> }>(
                          "/buddy/requests/" + pending.requestId,
                          json({ cancel: true }),
                        )
                          .then((r) => setRequest(r.request))
                          .catch(onError);
                      }}
                    >
                      Cancel
                    </button>
                  ) : null}

                  <button
                    type="submit"
                    className="button primary"
                    disabled={
                      busy ||
                      !state?.settings.enabled ||
                      (!input.trim() && !attached.length)
                    }
                  >
                    {busy ? (
                      <>
                        <LoaderCircle size={15} className="spin" />
                        Working…
                      </>
                    ) : pending ? (
                      "Retry message"
                    ) : (
                      <>
                        <Send size={15} />
                        Send
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
            <BuddyRequestDetails request={request} />
          </div>
        </section>
      </div>
    </main>
  );
}

function ProposalPreview({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value))
    return (
      <ol>
        {value.map((item, i) => (
          <li key={i}>
            <ProposalPreview value={item} />
          </li>
        ))}
      </ol>
    );
  if (typeof value === "object")
    return (
      <dl>
        {Object.entries(value).map(([key, item]) => (
          <div key={key}>
            <dt>
              <strong>
                {(
                  {
                    cvBullet: "CV bullet",
                    coverHighlight: "Cover-letter highlight",
                    kind: "Type",
                    field: "Field",
                    value: "New value",
                    dueDate: "Due date",
                  } as Record<string, string>
                )[key] ||
                  key
                    .replace(/([A-Z])/g, " $1")
                    .replace(/^./, (s) => s.toUpperCase())}
              </strong>
            </dt>
            <dd>
              <ProposalPreview value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return <p style={{ whiteSpace: "pre-wrap" }}>{String(value)}</p>;
}
