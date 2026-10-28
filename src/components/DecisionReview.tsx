import { useEffect, useState } from "react";
import { api, json } from "../api";
import type { Opportunity } from "../types";
type Criterion = { id: string; description: string; priority: string };
type Criteria = { revision: number; items: Criterion[] };
type Assessment = {
  id: string;
  createdAt: string;
  stale: boolean;
  summary: string;
  recommendation: string;
  criteria: Criteria;
  results: {
    id: string;
    status: string;
    reason: string;
    sourceIds: string[];
    questions: string[];
  }[];
  sources: { id: string; name: string }[];
  retrieval: { mode: string; reason: string; omittedChunks: number };
};
export function FitCriteria({ onError }: { onError: (e: unknown) => void }) {
  const [profile, setProfile] = useState<Criteria | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    void api<Criteria>("/buddy/fit-criteria").then(setProfile).catch(onError);
  }, []);
  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <div>
          <h2>Opportunity criteria</h2>
          <p>
            Describe what you need from your next role. Include salary and
            currency, locations, working arrangements, role preferences or
            exclusions. Make each criterion specific enough to assess.
          </p>
        </div>
      </div>
      {profile && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void api<Criteria>("/buddy/fit-criteria", json(profile, "PATCH"))
              .then((p) => {
                setProfile(p);
                setNotice(
                  "Criteria saved. Older assessments will be marked out of date.",
                );
              })
              .catch(onError)
              .finally(() => setBusy(false));
          }}
        >
          {profile.items.map((item, i) => (
            <div className="form-grid" key={item.id}>
              <label className="field">
                <span>Criterion {i + 1}</span>
                <textarea
                  required
                  maxLength={1000}
                  value={item.description}
                  disabled={busy}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      items: profile.items.map((c) =>
                        c.id === item.id
                          ? { ...c, description: e.target.value }
                          : c,
                      ),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Importance</span>
                <select
                  value={item.priority}
                  disabled={busy}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      items: profile.items.map((c) =>
                        c.id === item.id
                          ? { ...c, priority: e.target.value }
                          : c,
                      ),
                    })
                  }
                >
                  <option value="required">Required</option>
                  <option value="preferred">Preferred</option>
                </select>
              </label>
              <button
                type="button"
                className="button secondary small"
                disabled={busy}
                onClick={() =>
                  setProfile({
                    ...profile,
                    items: profile.items.filter((c) => c.id !== item.id),
                  })
                }
              >
                Remove criterion
              </button>
            </div>
          ))}
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy || profile.items.length >= 30}
              onClick={() =>
                setProfile({
                  ...profile,
                  items: [
                    ...profile.items,
                    {
                      id: crypto.randomUUID(),
                      description: "",
                      priority: "preferred",
                    },
                  ],
                })
              }
            >
              Add criterion
            </button>
            <button className="button primary" disabled={busy}>
              Save criteria
            </button>
          </div>
          <p role="status">{notice}</p>
        </form>
      )}
    </section>
  );
}
export default function DecisionReview({
  opportunity,
  onError,
}: {
  opportunity: Opportunity;
  onError: (e: unknown) => void;
}) {
  const [state, setState] = useState<{
      criteria: Criteria;
      settings: { enabled: boolean };
      documents: { id: string; name: string; generated: boolean }[];
      assessments: Assessment[];
    } | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  const [automation, setAutomation] = useState<{
    state: string;
    tags: string;
    fit: string;
  } | null>(null);
  const base = "/buddy/decisions/" + opportunity.id;
  async function load() {
    try {
      setState(await api(base));
      const result = await api<{ automation: typeof automation }>(
        "/buddy/automation/" + opportunity.id,
      );
      setAutomation(result.automation);
    } catch (e) {
      onError(e);
    }
  }
  useEffect(() => {
    void load();
  }, [opportunity.id, opportunity.revision]);
  useEffect(() => {
    if (!automation || !["queued", "running"].includes(automation.state))
      return;
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [automation?.state, opportunity.id]);
  return (
    <section className="buddy-panel">
      <div className="settings-section-heading">
        <div>
          <h2>Opportunity fit assessment</h2>
          <p>
            New or edited opportunities are automatically tagged and assessed
            against your saved criteria when a model is available. No criteria
            need selecting here.
          </p>
          {automation && (
            <p role="status">
              Automation: {automation.state} · Tags: {automation.tags} · Fit:{" "}
              {automation.fit}
            </p>
          )}
          <button
            type="button"
            className="button secondary small"
            disabled={
              busy ||
              automation?.state === "running" ||
              automation?.state === "queued"
            }
            onClick={() => {
              void api(
                "/buddy/automation/" + opportunity.id,
                json({ useLibrary: false }),
              )
                .then(() => load())
                .catch(onError);
            }}
          >
            Run / retry automatic review
          </button>
          <p>
            Compare this role with your saved criteria. Recommendations are
            advice; your opportunity stage and outcome stay under your control.
          </p>
        </div>
      </div>
      {!state ? (
        <p>Loading assessment settings…</p>
      ) : (
        <>
          <p>
            {state.criteria.items.length} saved criteria · Decision model{" "}
            {state.settings.enabled ? "enabled" : "off"}. Configure both in
            Settings.
          </p>
          <details>
            <summary>Saved criteria</summary>
            <ul>
              {state.criteria.items.map((c) => (
                <li key={c.id}>
                  {c.description} · {c.priority}
                </li>
              ))}
            </ul>
          </details>
          <details>
            <summary>
              Choose supporting career evidence ({selected.length}/20)
            </summary>
            <div className="buddy-source-picker">
              {state.documents
                .filter((d) => !d.generated)
                .map((d) => (
                  <label key={d.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(d.id)}
                      disabled={
                        busy ||
                        (!selected.includes(d.id) && selected.length >= 20)
                      }
                      onChange={(e) =>
                        setSelected((s) =>
                          e.target.checked
                            ? [...s, d.id]
                            : s.filter((id) => id !== d.id),
                        )
                      }
                    />
                    <span>{d.name}</span>
                  </label>
                ))}
            </div>
          </details>
          <div className="form-actions">
            <button
              type="button"
              className="button primary"
              disabled={
                busy || !state.settings.enabled || !state.criteria.items.length
              }
              onClick={() => {
                setBusy(true);
                void api(
                  base,
                  json({
                    revision: opportunity.revision,
                    criteriaRevision: state.criteria.revision,
                    documentIds: selected,
                  }),
                )
                  .then(() => load())
                  .catch(onError)
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Assessing…" : "Assess against my criteria"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void load()}
            >
              Refresh
            </button>
          </div>
          {!selected.length && (
            <p className="buddy-muted">
              Only the opportunity and your criteria will be assessed.
              Candidate-experience questions may remain unknown without
              supporting evidence.
            </p>
          )}
          {state.assessments.map((a) => (
            <article className="settings-section" key={a.id}>
              <h3>
                {a.recommendation.replaceAll("-", " ")}{" "}
                {a.stale && (
                  <span className="badge muted">Out of date — reassess</span>
                )}
              </h3>
              <p className="buddy-muted">
                {new Date(a.createdAt).toLocaleString()} · Criteria version{" "}
                {a.criteria.revision}
              </p>
              <p>{a.summary}</p>
              {a.results.map((row) => (
                <div key={row.id}>
                  <h4>
                    {a.criteria.items.find((c) => c.id === row.id)?.description}{" "}
                    · {a.criteria.items.find((c) => c.id === row.id)?.priority}{" "}
                    · {row.status}
                  </h4>
                  <p>{row.reason}</p>
                  <small>
                    Evidence:{" "}
                    {row.sourceIds
                      .map(
                        (id) => a.sources.find((s) => s.id === id)?.name || id,
                      )
                      .join(", ") || "No supporting source"}
                  </small>
                  {row.questions.length > 0 && (
                    <ul>
                      {row.questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              <p className="buddy-muted">
                Search: {a.retrieval.mode}
                {a.retrieval.reason
                  ? " · " + a.retrieval.reason.replaceAll("-", " ")
                  : ""}{" "}
                · {a.retrieval.omittedChunks} passages omitted by context
                limits.
              </p>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
