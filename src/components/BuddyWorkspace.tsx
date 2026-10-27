import { useEffect, useState } from "react";
import { api, json } from "../api";
type Message = {
  id: string;
  role: string;
  mode: string;
  content: string;
  createdAt: string;
  appliedAt?: string;
  sourceIds?: string[];
  sources?: { id: string; name: string; index: number }[];
  proposal?: {
    opportunity: object | null;
    tasks: object[];
    star: object | null;
    changes: object[];
    targetId: string;
    revision: number;
  };
};
type State = {
  messages: Message[];
  settings: { enabled: boolean };
  documents: { id: string; name: string }[];
  opportunities: { id: string; company: string; role: string }[];
};
const modes = {
  coach: {
    name: "Encouragement coach",
    hint: "Talk through a setback or remind yourself of your strengths. Buddy will stay realistic, use evidence and challenge unsupported assumptions.",
  },
  star: {
    name: "Build a STAR highlight",
    hint: "Tell Buddy what you did. It will ask about the situation, your task, your actions and the result before drafting a reusable story.",
  },
  recruiter: {
    name: "Recruiter intake",
    hint: "Paste an email, call transcript or notes. Review a proposed opportunity and dated action items before saving.",
  },
  update: {
    name: "Opportunity update",
    hint: "Choose the exact opportunity and describe what happened. If you are unsure which role it relates to, leave it unselected and ask Buddy to help clarify.",
  },
};
export default function BuddyWorkspace({
  onError,
  onChanged,
}: {
  onError: (e: unknown) => void;
  onChanged: () => void;
}) {
  const [state, setState] = useState<State | null>(null),
    [mode, setMode] = useState<keyof typeof modes>("coach"),
    [input, setInput] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [target, setTarget] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<{
      message: string;
      requestId: string;
    } | null>(null);
  async function load() {
    setState(await api<State>("/buddy/workspace"));
  }
  useEffect(() => {
    void load().catch(onError);
  }, []);
  async function send() {
    if (!input.trim()) return;
    setBusy(true);
    const draft =
      pending?.message === input
        ? pending
        : { message: input, requestId: crypto.randomUUID() };
    setPending(draft);
    try {
      await api(
        "/buddy/workspace",
        json({
          ...draft,
          mode,
          documentIds: selected,
          targetId: mode === "update" ? target : "",
        }),
      );
      setPending(null);
      setInput("");
      await load();
    } catch (e) {
      onError(e);
    } finally {
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
      <section className="settings-section">
        <div className="form-grid">
          <label className="field">
            <span>What would you like to work on?</span>
            <select
              disabled={busy}
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as keyof typeof modes);
                setPending(null);
              }}
            >
              {Object.entries(modes).map(([id, m]) => (
                <option key={id} value={id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          {mode === "update" && (
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
          )}
        </div>
        <p>{modes[mode].hint}</p>
        <details>
          <summary>
            Supporting career evidence ({selected.length}/20 selected)
          </summary>
          <p className="buddy-muted">
            Only selected library excerpts are sent. Recruiter/update modes also
            include up to 200 recent opportunity names to help identify existing
            roles. Paste email or transcript text below; attachments are not
            read automatically.
          </p>
          <div className="buddy-source-picker">
            {state?.documents.map((d) => (
              <label key={d.id}>
                <input
                  type="checkbox"
                  disabled={
                    busy || (selected.length >= 20 && !selected.includes(d.id))
                  }
                  checked={selected.includes(d.id)}
                  onChange={(e) => {
                    setSelected((s) =>
                      e.target.checked
                        ? [...s, d.id]
                        : s.filter((id) => id !== d.id),
                    );
                    setPending(null);
                  }}
                />
                <span>{d.name}</span>
              </label>
            ))}
          </div>
        </details>
        {!state?.settings.enabled && (
          <p className="form-error">
            Enable and configure Career Buddy in Settings to chat.
          </p>
        )}
        <div aria-live="polite">
          {state?.messages
            .filter((m) => m.mode === mode)
            .map((m) => (
              <article className="settings-section" key={m.id}>
                <strong>{m.role === "user" ? "You" : "Career Buddy"}</strong>
                <p style={{ whiteSpace: "pre-wrap" }}>{m.content}</p>
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
                  (m.proposal.opportunity ||
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
                            : m.proposal.star || m.proposal.changes
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
                          : m.proposal.star
                            ? "Save STAR highlight to library"
                            : m.proposal.opportunity
                              ? "Create opportunity and action items"
                              : "Confirm opportunity update"}
                      </button>
                    </details>
                  )}
              </article>
            ))}
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
              rows={6}
              maxLength={12000}
              required
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
              disabled={busy || !state?.settings.enabled || !input.trim()}
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
          </div>
        </form>
        <p className="buddy-muted">
          Conversation history is saved by mode. Buddy never sends emails or
          applications. Proposals need your confirmation; saved STAR stories are
          draft reference material, not independently verified evidence.
        </p>
      </section>
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
