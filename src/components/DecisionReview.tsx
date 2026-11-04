import { uploadId } from "../lib/upload-queue";
import AIRequestProgress from "./AIRequestProgress";
import { useEffect, useState } from "react";
import { api, json } from "../api";
import type { Opportunity } from "../types";
type Criterion = { id: string; description: string; priority: string };
type Criteria = { revision: number; items: Criterion[] };
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
                      id: uploadId(),
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
export type FitDraft = { strengths: string; gaps: string; effectiveAt: string };
export default function DecisionReview({ opportunity, onError, onAssessed, onBusy, disabled = false }: {
  opportunity: Opportunity;
  onError: (e: unknown) => void;
  onAssessed: (draft: FitDraft, saved: Opportunity) => void;
  disabled?: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  async function assess() {
    setBusy(true);
    onBusy(true);
    setNotice("");
    setError("");
    const id = uploadId();
    setRequestId(id);
    try {
      const result = await api<{reviewDraft: FitDraft; opportunity: Opportunity}>("/buddy/decisions/" + opportunity.id, json({
        revision: opportunity.revision, requestId: id, generalFit: true, documentIds: [],
      }));
      onAssessed(result.reviewDraft, result.opportunity);
      setNotice("Assessment saved. Active opportunities move to Fit review.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The fit assessment failed. Please retry.");
      onError(e);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return <div className="section-intro">
    <button type="button" className="button primary" disabled={busy || disabled} onClick={() => void assess()}>
      {busy ? "Assessing…" : "Run Automated Fit Assessment"}
    </button>
    <p>AI selects relevant career evidence, saves strengths, gaps and the review date, and moves active opportunities to Fit review. You can edit the saved result.</p>
    <AIRequestProgress id={requestId} scope={"decision:" + opportunity.id} onError={onError}/>
    {error && <p role="alert" className="alert" style={{ marginTop: 10 }}>{error} Your review fields have been kept. You can retry the assessment.</p>}
    {notice && <p role="status" className="saved" style={{ marginTop: 10, display: "block" }}>{notice}</p>}
  </div>;
}
