import { uploadId } from "../lib/upload-queue";
import AIRequestProgress from "./AIRequestProgress";
import { useEffect, useState } from "react";
import { api, json } from "../api";
import type {
  Opportunity,
  Criteria,
  Criterion,
  StructuredCriteria,
  SeniorityLevel,
  Settings,
} from "../types";
import { SENIORITY_LABELS } from "../lib/seniority";
import {
  Target,
  DollarSign,
  Award,
  Briefcase,
  Plus,
  X,
  Sparkles,
  RefreshCw,
  Building,
} from "lucide-react";

const SENIORITY_OPTIONS: { id: SeniorityLevel; label: string }[] = [
  { id: "entry", label: "Entry / Junior" },
  { id: "mid", label: "Mid-level" },
  { id: "senior", label: "Senior / Staff" },
  { id: "lead", label: "Lead / Principal" },
  { id: "director", label: "Director / Head of" },
  { id: "executive", label: "Executive / VP / C-Level" },
];

const WORK_MODES: { id: "remote" | "hybrid" | "onsite"; label: string }[] = [
  { id: "remote", label: "Remote" },
  { id: "hybrid", label: "Hybrid" },
  { id: "onsite", label: "On-site" },
];

export function FitCriteria({ onError }: { onError: (e: unknown) => void }) {
  const [profile, setProfile] = useState<Criteria | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [skillInput, setSkillInput] = useState("");

  useEffect(() => {
    void api<Criteria>("/buddy/fit-criteria").then(setProfile).catch(onError);
  }, []);

  const structured: StructuredCriteria = profile?.structured || {
    targetTitles: [],
    minSalary: null,
    salaryCurrency: "USD",
    salaryPeriod: "year",
    targetSeniorities: [],
    targetSkills: [],
    workModes: [],
  };

  const updateStructured = (partial: Partial<StructuredCriteria>) => {
    if (!profile) return;
    setProfile({
      ...profile,
      structured: {
        ...structured,
        ...partial,
      },
    });
  };

  const addTitle = (val: string) => {
    const t = val.trim();
    if (!t) return;
    const curr = structured.targetTitles || [];
    if (!curr.some((x) => x.toLowerCase() === t.toLowerCase())) {
      updateStructured({ targetTitles: [...curr, t] });
    }
    setTitleInput("");
  };

  const removeTitle = (index: number) => {
    const curr = structured.targetTitles || [];
    updateStructured({ targetTitles: curr.filter((_, i) => i !== index) });
  };

  const addSkill = (val: string) => {
    const s = val.trim();
    if (!s) return;
    const curr = structured.targetSkills || [];
    if (!curr.some((x) => x.toLowerCase() === s.toLowerCase())) {
      updateStructured({ targetSkills: [...curr, s] });
    }
    setSkillInput("");
  };

  const removeSkill = (index: number) => {
    const curr = structured.targetSkills || [];
    updateStructured({ targetSkills: curr.filter((_, i) => i !== index) });
  };

  const toggleSeniority = (level: SeniorityLevel) => {
    const curr = structured.targetSeniorities || [];
    const next = curr.includes(level)
      ? curr.filter((l) => l !== level)
      : [...curr, level];
    updateStructured({ targetSeniorities: next });
  };

  const toggleWorkMode = (mode: "remote" | "hybrid" | "onsite") => {
    const curr = structured.workModes || [];
    const next = curr.includes(mode)
      ? curr.filter((m) => m !== mode)
      : [...curr, mode];
    updateStructured({ workModes: next });
  };

  const syncFromAlignment = async () => {
    try {
      const s = await api<Settings>("/settings");
      const updates: Partial<StructuredCriteria> = {};
      if (s.targetTitles?.length) updates.targetTitles = [...s.targetTitles];
      if (s.targetSkills?.length) updates.targetSkills = [...s.targetSkills];
      if (s.currency) updates.salaryCurrency = s.currency;
      updateStructured(updates);
      setNotice("Imported target titles and skills from Alignment settings.");
    } catch (err) {
      onError(err);
    }
  };

  const generateCriteriaFromPreferences = () => {
    if (!profile) return;
    const s = structured;
    const newItems: Criterion[] = [];

    // 1. Role & Seniority criterion
    if (s.targetTitles?.length || s.targetSeniorities?.length) {
      const titlePart = s.targetTitles?.length
        ? `roles matching "${s.targetTitles.join(", ")}"`
        : "target roles";
      const seniorityPart = s.targetSeniorities?.length
        ? ` at ${s.targetSeniorities.map((sn) => SENIORITY_LABELS[sn] || sn).join(" or ")} level`
        : "";
      newItems.push({
        id: "role-seniority-fit",
        description: `Target role fit: Opportunity aligns with ${titlePart}${seniorityPart}.`,
        priority: "required",
      });
    }

    // 2. Compensation criterion
    if (s.minSalary && s.minSalary > 0) {
      const curr = s.salaryCurrency || "USD";
      const per = s.salaryPeriod || "year";
      newItems.push({
        id: "compensation-fit",
        description: `Compensation: Package meets or exceeds ${curr} ${s.minSalary.toLocaleString()} per ${per}.`,
        priority: "required",
      });
    }

    // 3. Core skills criterion
    if (s.targetSkills?.length) {
      newItems.push({
        id: "skills-alignment",
        description: `Skills alignment: Candidate career evidence demonstrates core target skills (${s.targetSkills.join(", ")}).`,
        priority: "preferred",
      });
    }

    // 4. Work arrangements criterion
    if (s.workModes?.length) {
      newItems.push({
        id: "work-mode-fit",
        description: `Working arrangement: Opportunity supports ${s.workModes.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" or ")} working arrangement.`,
        priority: "preferred",
      });
    }

    if (!newItems.length) {
      setNotice(
        "Specify role titles, salary, seniority, or skills above to generate criteria.",
      );
      return;
    }

    const existingIds = new Set(newItems.map((i) => i.id));
    const mergedItems = [
      ...newItems,
      ...profile.items.filter((item) => !existingIds.has(item.id)),
    ];

    setProfile({
      ...profile,
      items: mergedItems.slice(0, 30),
    });
    setNotice(
      "Generated criteria items from your structured preferences. Review or adjust importance below.",
    );
  };

  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <div>
          <h2>Opportunity criteria</h2>
          <p>
            Establish your fit assessment criteria through your desired
            selection preferences and custom evaluation criteria.
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
          {/* Structured Criteria Selection Builder */}
          <div className="structured-criteria-card">
            <div className="structured-criteria-header">
              <div>
                <h3>
                  <Target size={15} />
                  Structured Target Preferences
                </h3>
                <p>
                  Define your desired selection process across role titles,
                  salary, seniority, and skills to guide automated assessments.
                </p>
              </div>
              <div className="structured-criteria-actions">
                <button
                  type="button"
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => void syncFromAlignment()}
                  title="Import target titles, skills, and currency from Alignment settings"
                >
                  <RefreshCw size={12} />
                  Sync from Alignment
                </button>
                <button
                  type="button"
                  className="button primary small"
                  disabled={busy}
                  onClick={generateCriteriaFromPreferences}
                  title="Translate structured preferences into evaluatable criteria items"
                >
                  <Sparkles size={12} />
                  Generate Criteria
                </button>
              </div>
            </div>

            <div className="structured-criteria-grid">
              {/* Job Titles */}
              <div className="structured-group">
                <label className="structured-group-label">
                  <Briefcase size={12} />
                  Target Job Titles
                </label>
                <div className="tags-input-group">
                  <input
                    type="text"
                    value={titleInput}
                    disabled={busy}
                    placeholder="e.g. Solutions Architect, Lead Engineer"
                    onChange={(e) => setTitleInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTitle(titleInput);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={busy || !titleInput.trim()}
                    onClick={() => addTitle(titleInput)}
                  >
                    <Plus size={13} /> Add
                  </button>
                </div>
                <div className="active-tag-chips">
                  {(structured.targetTitles || []).map((t, idx) => (
                    <span key={idx} className="tag-chip title-chip">
                      {t}
                      <button
                        type="button"
                        aria-label={`Remove ${t}`}
                        disabled={busy}
                        onClick={() => removeTitle(idx)}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  {!structured.targetTitles?.length && (
                    <span className="empty-hint">No target titles set</span>
                  )}
                </div>
              </div>

              {/* Salary Range */}
              <div className="structured-group">
                <label className="structured-group-label">
                  <DollarSign size={12} />
                  Minimum Compensation Target
                </label>
                <div className="structured-salary-row">
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={structured.minSalary ?? ""}
                    disabled={busy}
                    placeholder="e.g. 100000"
                    onChange={(e) =>
                      updateStructured({
                        minSalary: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                  <select
                    value={structured.salaryCurrency || "USD"}
                    disabled={busy}
                    onChange={(e) =>
                      updateStructured({ salaryCurrency: e.target.value })
                    }
                  >
                    <option value="USD">USD ($)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="CAD">CAD ($)</option>
                    <option value="AUD">AUD ($)</option>
                    <option value="CHF">CHF (Fr)</option>
                  </select>
                  <select
                    value={structured.salaryPeriod || "year"}
                    disabled={busy}
                    onChange={(e) =>
                      updateStructured({
                        salaryPeriod: e.target
                          .value as StructuredCriteria["salaryPeriod"],
                      })
                    }
                  >
                    <option value="year">/ year</option>
                    <option value="month">/ month</option>
                    <option value="day">/ day</option>
                    <option value="hour">/ hour</option>
                  </select>
                </div>
              </div>

              {/* Seniority */}
              <div className="structured-group" style={{ gridColumn: "1 / -1" }}>
                <label className="structured-group-label">
                  <Award size={12} />
                  Target Seniority Levels
                </label>
                <div className="structured-chips-row">
                  {SENIORITY_OPTIONS.map((opt) => {
                    const isSelected = (
                      structured.targetSeniorities || []
                    ).includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        className={`structured-toggle-chip ${isSelected ? "selected" : ""}`}
                        disabled={busy}
                        onClick={() => toggleSeniority(opt.id)}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Core Skills */}
              <div className="structured-group">
                <label className="structured-group-label">
                  <Award size={12} />
                  Core Skills & Technologies
                </label>
                <div className="tags-input-group">
                  <input
                    type="text"
                    value={skillInput}
                    disabled={busy}
                    placeholder="e.g. TypeScript, AWS, System Design"
                    onChange={(e) => setSkillInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addSkill(skillInput);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={busy || !skillInput.trim()}
                    onClick={() => addSkill(skillInput)}
                  >
                    <Plus size={13} /> Add
                  </button>
                </div>
                <div className="active-tag-chips">
                  {(structured.targetSkills || []).map((sk, idx) => (
                    <span key={idx} className="tag-chip skill-chip">
                      {sk}
                      <button
                        type="button"
                        aria-label={`Remove ${sk}`}
                        disabled={busy}
                        onClick={() => removeSkill(idx)}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  {!structured.targetSkills?.length && (
                    <span className="empty-hint">No target skills set</span>
                  )}
                </div>
              </div>

              {/* Work Arrangements */}
              <div className="structured-group">
                <label className="structured-group-label">
                  <Building size={12} />
                  Desired Work Arrangements
                </label>
                <div className="structured-chips-row">
                  {WORK_MODES.map((wm) => {
                    const isSelected = (structured.workModes || []).includes(
                      wm.id,
                    );
                    return (
                      <button
                        key={wm.id}
                        type="button"
                        className={`structured-toggle-chip work-mode-chip ${isSelected ? "selected" : ""}`}
                        disabled={busy}
                        onClick={() => toggleWorkMode(wm.id)}
                      >
                        {wm.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Custom Evaluated Criteria List */}
          <div className="section-intro" style={{ marginBottom: 14 }}>
            <h3>Individual Evaluated Criteria</h3>
            <p>
              Criteria evaluated by AI models. Mark criteria as Required (roles
              failing these cannot proceed) or Preferred.
            </p>
          </div>

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
                          ? { ...c, priority: e.target.value as Criterion["priority"] }
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

          {!profile.items.length && (
            <p className="empty-hint" style={{ marginBottom: 16 }}>
              No criteria items defined. Use "Generate Criteria" above or click
              "Add criterion" to create custom criteria.
            </p>
          )}

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
              <Plus size={13} /> Add criterion
            </button>
            <button className="button primary" disabled={busy}>
              Save criteria
            </button>
          </div>
          {notice && <p role="status" className="saved" style={{ marginTop: 12, display: "block" }}>{notice}</p>}
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
