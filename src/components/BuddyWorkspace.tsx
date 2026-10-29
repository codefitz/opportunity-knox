import { useEffect, useState, useRef } from "react";
import { api, json, readFile, ApiError } from "../api";
type Message = {
  id: string;
  role: string;
  mode: string;
  content: string;
  createdAt: string;
  cursor?: number;
  status?: string;
  attachments?: { id: string; name: string }[];
  appliedAt?: string;
  result?: { id?: string };
  sourceIds?: string[];
  sources?: { id: string; name: string; index: number }[];
  proposal?: {
    opportunity: object | null;
    cv?: { title: string; content: string } | null;
    tasks: object[];
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
  documents: { id: string; name: string; folder?: string;category?:string }[];
  opportunities: { id: string; company: string; role: string }[];
};
export default function BuddyWorkspace({
  onError,
  onChanged,
}: {
  onError: (e: unknown) => void;
  onChanged: () => void;
}) {
  const [conversationId, setConversationId] = useState(
    () => localStorage.getItem("knox-buddy-conversation") || "legacy",
  );
  const [historySearch, setHistorySearch] = useState("");
  const [request, setRequest] = useState<{
    stage: string;
    startedAt: string;
    timeoutSeconds: number;
    errorCode?: string;
  } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const drafts = useRef<Record<string, string>>({});
  const [state, setState] = useState<State | null>(null),
    [useLibrary, setUseLibrary] = useState(false),
    [attached, setAttached] = useState<string[]>([]),
    [templateId, setTemplateId] = useState(""),
    [templateQuery, setTemplateQuery] = useState(""),
    [olderAvailable, setOlderAvailable] = useState(true),
    [input, setInput] = useState(""),
    [target, setTarget] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<{
      message: string;
      requestId: string;
    } | null>(null);
  useEffect(() => {
    if (!busy || !pending?.requestId) return;
    const timer = window.setInterval(() => {
      void api<{ request: NonNullable<typeof request> }>(
        "/buddy/requests/" + pending.requestId,
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
  }, [busy, pending?.requestId]);
  async function load(id = conversationId) {
    const result = await api<State>(
      "/buddy/workspace?conversationId=" + encodeURIComponent(id),
    );
    setState(result);
    setOlderAvailable(result.messages.length >= 100);
  }
  useEffect(() => {
    void load().catch(onError);
  }, [conversationId]);
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ block: "nearest" });
  }, [conversationId, state?.messages.at(-1)?.id]);
  function chooseConversation(id: string) {
    if (busy || id === conversationId) return;
    drafts.current[conversationId] = input;
    localStorage.setItem("knox-buddy-conversation", id);
    setState(null);
    setInput(drafts.current[id] || "");
    setTemplateId("");
    setUseLibrary(false);
    setPending(null);
    setAttached([]);
    setTarget("");
    setConversationId(id);
  }
  async function send() {
    if (!input.trim() && !attached.length) return;
    setBusy(true);
    setRequest(null);
    setElapsed(0);
    const draft =
      pending?.message === (input || "Please review the attached material.")
        ? pending
        : {
            message: input || "Please review the attached material.",
            requestId: crypto.randomUUID(),
          };
    setPending(draft);
    try {
      await api(
        "/buddy/workspace",
        json({
          ...draft,
          mode: "auto",
          conversationId,
          documentIds: [],
          useLibrary,
          attachmentIds: attached,
          templateId,
          targetId: target,
        }),
      );
      setPending(null);
      setInput("");

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
  return (
    <main className="content-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR CAREER COMPANION</div>
          <h1>Career Buddy</h1>
          <p>
            A candid coach, an achievement notebook and a helping hand with
            opportunities.
          </p>
        </div>
      </div>
      <div className="buddy-workspace-layout">
        <aside
          className="buddy-history-sidebar"
          aria-label="Chat history sidebar"
        >
          <details open>
            <summary>Chat history</summary>
            <button
              type="button"
              className="button primary small"
              disabled={busy}
              onClick={() => chooseConversation(crypto.randomUUID())}
            >
              New conversation
            </button>
            <label className="field">
              <span>Find a conversation</span>
              <input
                type="search"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search history titles"
              />
            </label>
            <nav aria-label="Saved Career Buddy conversations">
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
                      {new Date(c.updatedAt).toLocaleDateString()} · {c.count}{" "}
                      messages
                    </small>
                  </button>
                ))}
            </nav>
            {state?.conversations?.length === 0 && (
              <p>No saved conversations yet.</p>
            )}
          </details>
        </aside>
        <section
          className="settings-section buddy-active-conversation"
          aria-label="Active Career Buddy conversation"
        >
          <h2>
            {state?.conversations?.find((c) => c.id === conversationId)
              ?.title || "New conversation"}
          </h2>
          <details className="buddy-conversation-options">
            <summary>Sources, attachments and related opportunity</summary>

            <div className="form-grid">
              <label className="field">
                <span>Related opportunity</span>
                <select
                  disabled={busy}
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setPending(null);
                  }}
                >
                  <option value="">Not sure — ask me to clarify</option>
                  {state?.opportunities.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.company} · {o.role}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p>
              Talk naturally about a setback, achievement, recruiter message,
              opportunity update or master CV. Buddy will identify the task and
              ask questions where needed.
            </p>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={useLibrary}
                disabled={busy}
                onChange={(e) => {
                  setUseLibrary(e.target.checked);
                  setPending(null);
                }}
              />
              Use career library — automatically find relevant evidence
            </label>
            <p className="buddy-muted">
              When checked, Buddy chooses relevant library/folder/vault sources and
              sends bounded excerpts to your configured provider. Attachments
              and an explicitly chosen template are included independently.
              Originals stay unchanged.
            </p>
            <details>
              <summary>CV template and document sources</summary>
              <label className="field">
                <span>Template from configured career library or vault</span>
                <input
                  aria-label="Find a template by name or configured folder"
                  placeholder="Find a template by name or configured folder"
                  value={templateQuery}
                  onChange={(e) => setTemplateQuery(e.target.value)}
                />
                <select
                  aria-label="CV template"
                  value={templateId}
                  disabled={busy}
                  onChange={(e) => {
                    setTemplateId(e.target.value);
                    setPending(null);
                  }}
                >
                  <option value="">
                    No template — start from scratch or use an upload
                  </option>
                  {state?.documents
                    .filter(
                      (d) =>
                        (d.name + " " + d.folder)
                          .toLowerCase()
                          .includes(templateQuery.toLowerCase()) ||
                        d.id === templateId,
                    )
                    .map((d) => (
                      <option value={d.id} key={d.id}>
                        {d.folder ? d.folder + " / " : ""}
                        {d.category==="template"?"Template · ":""}{d.name}
                      </option>
                    ))}
                </select>
              </label>
              <p className="buddy-muted">
                Upload a template below or choose a document already in your
                configured folders. Ask Buddy to use its headings/structure.
                Use Document Studio after saving a Word draft to apply layouts and export PDFs. Mark reusable templates in the library to keep them out of automatic career-evidence selection.
              </p>
            </details>
            <label className="field">
              <span>
                Attach a JD, recruiter email/text, project notes or CV template
                (up to five files, 5 MB each)
              </span>
              <input
                type="file"
                multiple
                disabled={busy}
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = "";
                  if (files.length + attached.length > 5) {
                    onError(
                      new Error("Choose up to five attachments per message."),
                    );
                    return;
                  }
                  setBusy(true);
                  void (async () => {
                    try {
                      const added: string[] = [];
                      for (const file of files) {
                        if (file.size > 5 * 1024 * 1024)
                          throw Error("Each attachment must be 5 MB or less.");
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
                  })();
                }}
              />
            </label>
            {attached.map((id) => {
              const file = state?.attachments?.find((a) => a.id === id);
              return (
                file && (
                  <details key={id} open>
                    <summary>
                      {file.name} · {file.status}
                    </summary>
                    <p>{file.warnings.join(" ")}</p>
                    <pre style={{ whiteSpace: "pre-wrap" }}>
                      {file.preview ||
                        "No readable text. OCR or a text copy may be needed."}
                    </pre>
                    <button
                      type="button"
                      className="button secondary small"
                      disabled={busy}
                      onClick={() =>
                        setAttached((current) =>
                          current.filter((x) => x !== id),
                        )
                      }
                    >
                      Exclude from message
                    </button>
                  </details>
                )
              );
            })}
            <details>
              <summary>Stored chat attachments</summary>
              <p>
                Chat attachments are stored privately with the board and
                included in full backups. They are not added to or indexed in
                the career library. Deleting a file does not remove conversation
                text already saved in history.
              </p>
              {state?.attachments?.map((a) => (
                <p key={a.id}>
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={
                      busy || (!attached.includes(a.id) && attached.length >= 5)
                    }
                    onClick={() =>
                      setAttached((ids) =>
                        ids.includes(a.id)
                          ? ids.filter((id) => id !== a.id)
                          : [...ids, a.id],
                      )
                    }
                  >
                    {attached.includes(a.id)
                      ? "Exclude from message"
                      : "Include in message"}
                  </button>{" "}
                  <a href={"/api/buddy/attachments/" + a.id + "/content"}>
                    {a.name}
                  </a>{" "}
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={busy}
                    onClick={() => {
                      void api("/buddy/attachments/" + a.id, {
                        method: "DELETE",
                      })
                        .then(async () => {
                          setAttached((ids) => ids.filter((id) => id !== a.id));
                          await load();
                        })
                        .catch(onError);
                    }}
                  >
                    Delete attachment
                  </button>
                </p>
              ))}
            </details>
          </details>
          {!state?.settings.enabled && (
            <p className="form-error">
              Enable and configure Career Buddy in Settings to chat.
            </p>
          )}
          <div
            className="buddy-chat-messages"
            aria-live="polite"
            aria-label="Messages in this conversation"
          >
            {olderAvailable && (state?.messages.length || 0) >= 100 && (
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
                              messages: [
                                ...older.messages,
                                ...current.messages,
                              ],
                            }
                          : current,
                      );
                    })
                    .catch(onError);
                }}
              >
                Load earlier history
              </button>
            )}
            {state?.messages.map((m) => (
              <article
                className="buddy-chat-message"
                data-role={m.role}
                key={m.id}
              >
                <strong>{m.role === "user" ? "You" : "Career Buddy"}</strong>
                <p style={{ whiteSpace: "pre-wrap" }}>{m.content}</p>
                {!!m.attachments?.length && (
                  <p>
                    Attachments: {m.attachments.map((a) => a.name).join(", ")}
                  </p>
                )}
                {!!m.sources?.length && (
                  <details>
                    <summary>Evidence passages</summary>
                    <ul>
                      {m.sources.map((s, i) => (
                        <li key={i}>
                          {s.name} · passage {s.index}
                          {m.sourceIds?.includes(s.id)
                            ? " · cited by Buddy"
                            : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {m.proposal &&
                  (m.proposal.cv ||
                    m.proposal.opportunity ||
                    m.proposal.star ||
                    m.proposal.changes.length > 0) && (
                    <details>
                      <summary>
                        {m.appliedAt
                          ? "Saved proposal"
                          : "Review proposed changes"}
                      </summary>
                      {m.proposal.targetId && (
                        <p>
                          Target:{" "}
                          {
                            state.opportunities.find(
                              (o) => o.id === m.proposal?.targetId,
                            )?.company
                          }{" "}
                          ·{" "}
                          {
                            state.opportunities.find(
                              (o) => o.id === m.proposal?.targetId,
                            )?.role
                          }
                        </p>
                      )}
                      <ProposalPreview
                        value={
                          m.proposal.opportunity
                            ? {
                                opportunity: m.proposal.opportunity,
                                actionItems: m.proposal.tasks,
                              }
                            : m.proposal.cv ||
                              m.proposal.star ||
                              m.proposal.changes
                        }
                      />
                      <p>
                        Check names, facts, dates and impact. Ask Buddy for a
                        corrected proposal before saving if anything is wrong.
                      </p>
                      <button
                        type="button"
                        className="button primary small"
                        disabled={busy || !!m.appliedAt}
                        onClick={() => {
                          setBusy(true);
                          void api(
                            "/buddy/workspace/" + m.id + "/apply",
                            json({ confirm: true }),
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
                              : m.proposal.opportunity
                                ? "Create opportunity and action items"
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
                    </details>
                  )}
              </article>
            ))}
            <div ref={messagesEnd} />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="field">
              <span>Your message, notes or transcript</span>
              <textarea
                rows={4}
                maxLength={12000}
                required={!attached.length}
                disabled={busy}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setPending(null);
                }}
              />
            </label>
            <div className="form-actions">
              <button
                className="button primary"
                disabled={
                  busy ||
                  !state?.settings.enabled ||
                  (!input.trim() && !attached.length)
                }
              >
                {busy
                  ? "Buddy is working…"
                  : pending
                    ? "Retry message"
                    : "Send to Career Buddy"}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => void load().catch(onError)}
              >
                Refresh history
              </button>
              {busy && pending && (
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
                  Cancel request
                </button>
              )}
            </div>
          </form>
          <p role="status" aria-live="polite">
            {busy && pending
              ? request
                ? `${({ preparing: "Preparing sources", "waiting-provider": "Waiting for AI response (not streamed)", "reading-response": "Reading AI response", "queued-codex": "Waiting for the Codex helper", "running-codex": "Codex is running (not streamed)", validating: "Checking the response", cancelling: "Cancelling request" } as Record<string, string>)[request.stage] || request.stage} · ${elapsed}s elapsed · ${request.timeoutSeconds}s AI response limit`
                : "Starting request…"
              : request
                ? `Last request: ${request.stage}${request.errorCode && request.errorCode !== request.stage ? " · " + request.errorCode : ""}`
                : ""}
          </p>
          <p className="buddy-muted">
            Each conversation keeps its own context; earlier history is
            accessible in the sidebar. Opportunity chats remain with their
            opportunity. Buddy never sends emails or applications. Proposals
            need your confirmation; saved STAR stories are draft reference
            material, not independently verified evidence.
          </p>
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
