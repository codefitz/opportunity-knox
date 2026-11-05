import { uploadId } from "../lib/upload-queue";
import AIRequestProgress from "./AIRequestProgress";
import { useEffect, useState, useRef, useCallback } from "react";
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
  AlertCircle,
  Check,
  LoaderCircle,
  RotateCcw,
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

export const SENIORITY_OPTIONS: { id: SeniorityLevel; label: string }[] = [
  { id: "entry", label: "Entry / Junior" },
  { id: "mid", label: "Mid-level" },
  { id: "senior", label: "Senior / Staff" },
  { id: "lead", label: "Lead / Principal" },
  { id: "director", label: "Director / Head of" },
  { id: "executive", label: "Executive / VP / C-Level" },
];

export const WORK_MODES: { id: "remote" | "hybrid" | "onsite"; label: string }[] = [
  { id: "remote", label: "Remote" },
  { id: "hybrid", label: "Hybrid" },
  { id: "onsite", label: "On-site" },
];

function areCriteriaProfilesEqual(a: Criteria, b: Criteria): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function FitCriteria({ onError }: { onError: (e: unknown) => void }) {
  const [profile, setProfile] = useState<Criteria | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoStack, setUndoStack] = useState<Criteria[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "undone" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [skillInput, setSkillInput] = useState("");

  const profileRef = useRef(profile);
  profileRef.current = profile;
  const lastSavedRef = useRef<Criteria | null>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef(false);

  useEffect(() => {
    void api<Criteria>("/buddy/fit-criteria")
      .then((p) => {
        setProfile(p);
        lastSavedRef.current = p;
      })
      .catch(onError);
  }, [onError]);

  const performSave = useCallback(
    async (targetProfile: Criteria, isUndo = false) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (!isUndo && lastSavedRef.current && areCriteriaProfilesEqual(targetProfile, lastSavedRef.current)) {
        return true;
      }
      if (isSavingRef.current) {
        pendingSaveRef.current = true;
        return false;
      }
      isSavingRef.current = true;
      setBusy(true);
      setSaveStatus("saving");

      const prior = lastSavedRef.current;
      try {
        const saved = await api<Criteria>("/buddy/fit-criteria", json(targetProfile, "PATCH"));
        setProfile(saved);
        lastSavedRef.current = saved;
        if (!isUndo && prior) {
          setUndoStack((prev) => [...prev.slice(-19), prior]);
          setSaveStatus("saved");
          setStatusMessage("Criteria saved");
        } else {
          setSaveStatus("undone");
          setStatusMessage("Undid last change");
        }
        return true;
      } catch (e) {
        setSaveStatus("error");
        setStatusMessage("Could not save criteria");
        onError(e);
        return false;
      } finally {
        isSavingRef.current = false;
        setBusy(false);
        if (pendingSaveRef.current && profileRef.current) {
          pendingSaveRef.current = false;
          void performSave(profileRef.current);
        }
      }
    },
    [onError],
  );

  const scheduleSave = useCallback(
    (nextProfile: Criteria, delay = 600) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaveStatus("saving");
      if (delay === 0) {
        saveTimerRef.current = null;
        void performSave(nextProfile);
      } else {
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          void performSave(nextProfile);
        }, delay);
      }
    },
    [performSave],
  );

  const handleBlur = useCallback(() => {
    if (saveTimerRef.current && profileRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      void performSave(profileRef.current);
    }
  }, [performSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current && profileRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void performSave(profileRef.current);
      }
    };
  }, [performSave]);

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0 || busy || isSavingRef.current) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setProfile(previous);
    await performSave(previous, true);
  }, [undoStack, busy, performSave]);

  const structured: StructuredCriteria = profile?.structured || {
    targetTitles: [],
    minSalary: null,
    salaryCurrency: "USD",
    salaryPeriod: "year",
    targetSeniorities: [],
    targetSkills: [],
    workModes: [],
  };

  const updateStructured = (partial: Partial<StructuredCriteria>, delay = 0) => {
    if (!profileRef.current) return;
    const next: Criteria = {
      ...profileRef.current,
      structured: {
        ...structured,
        ...partial,
      },
    };
    setProfile(next);
    scheduleSave(next, delay);
  };

  const addTitle = (val: string) => {
    const t = val.trim();
    if (!t) return;
    const curr = structured.targetTitles || [];
    if (!curr.some((x) => x.toLowerCase() === t.toLowerCase())) {
      updateStructured({ targetTitles: [...curr, t] }, 0);
    }
    setTitleInput("");
  };

  const removeTitle = (index: number) => {
    const curr = structured.targetTitles || [];
    updateStructured({ targetTitles: curr.filter((_, i) => i !== index) }, 0);
  };

  const addSkill = (val: string) => {
    const s = val.trim();
    if (!s) return;
    const curr = structured.targetSkills || [];
    if (!curr.some((x) => x.toLowerCase() === s.toLowerCase())) {
      updateStructured({ targetSkills: [...curr, s] }, 0);
    }
    setSkillInput("");
  };

  const removeSkill = (index: number) => {
    const curr = structured.targetSkills || [];
    updateStructured({ targetSkills: curr.filter((_, i) => i !== index) }, 0);
  };

  const toggleSeniority = (level: SeniorityLevel) => {
    const curr = structured.targetSeniorities || [];
    const next = curr.includes(level)
      ? curr.filter((l) => l !== level)
      : [...curr, level];
    updateStructured({ targetSeniorities: next }, 0);
  };

  const toggleWorkMode = (mode: "remote" | "hybrid" | "onsite") => {
    const curr = structured.workModes || [];
    const next = curr.includes(mode)
      ? curr.filter((m) => m !== mode)
      : [...curr, mode];
    updateStructured({ workModes: next }, 0);
  };

  const syncFromAlignment = async () => {
    try {
      const s = await api<Settings>("/settings");
      const updates: Partial<StructuredCriteria> = {};
      if (s.targetTitles?.length) updates.targetTitles = [...s.targetTitles];
      if (s.targetSkills?.length) updates.targetSkills = [...s.targetSkills];
      if (s.currency) updates.salaryCurrency = s.currency;
      updateStructured(updates, 0);
    } catch (e) {
      onError(e);
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
      setStatusMessage(
        "Specify role titles, salary, seniority, or skills above to generate criteria.",
      );
      return;
    }

    const existingIds = new Set(newItems.map((i) => i.id));
    const mergedItems = [
      ...newItems,
      ...profile.items.filter((item) => !existingIds.has(item.id)),
    ];

    const next: Criteria = {
      ...profile,
      items: mergedItems.slice(0, 30),
    };
    setProfile(next);
    scheduleSave(next, 0);
  };

  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <div>
          <h2>Opportunity criteria</h2>
          <p>
            Establish your fit assessment criteria through your desired
            selection preferences and custom evaluation criteria. Criteria changes save automatically.
          </p>
        </div>
      </div>
      {profile && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (profileRef.current) void performSave(profileRef.current);
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
                      updateStructured(
                        {
                          minSalary: e.target.value ? Number(e.target.value) : null,
                        },
                        600,
                      )
                    }
                    onBlur={handleBlur}
                  />
                  <select
                    value={structured.salaryCurrency || "USD"}
                    disabled={busy}
                    onChange={(e) =>
                      updateStructured({ salaryCurrency: e.target.value }, 0)
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
                      updateStructured(
                        {
                          salaryPeriod: e.target
                            .value as StructuredCriteria["salaryPeriod"],
                        },
                        0,
                      )
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
                  onChange={(e) => {
                    const next: Criteria = {
                      ...profile,
                      items: profile.items.map((c) =>
                        c.id === item.id
                          ? { ...c, description: e.target.value }
                          : c,
                      ),
                    };
                    setProfile(next);
                    scheduleSave(next, 600);
                  }}
                  onBlur={handleBlur}
                />
              </label>
              <label className="field">
                <span>Importance</span>
                <select
                  value={item.priority}
                  disabled={busy}
                  onChange={(e) => {
                    const next: Criteria = {
                      ...profile,
                      items: profile.items.map((c) =>
                        c.id === item.id
                          ? { ...c, priority: e.target.value as Criterion["priority"] }
                          : c,
                      ),
                    };
                    setProfile(next);
                    scheduleSave(next, 0);
                  }}
                >
                  <option value="required">Required</option>
                  <option value="preferred">Preferred</option>
                </select>
              </label>
              <button
                type="button"
                className="button secondary small"
                disabled={busy}
                onClick={() => {
                  const next: Criteria = {
                    ...profile,
                    items: profile.items.filter((c) => c.id !== item.id),
                  };
                  setProfile(next);
                  scheduleSave(next, 0);
                }}
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
                  <span>{statusMessage || "Criteria saved"}</span>
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
                  <span>{statusMessage || "Could not save criteria"}</span>
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
              <button
                type="button"
                className="button secondary small"
                disabled={busy || profile.items.length >= 30}
                onClick={() => {
                  const next: Criteria = {
                    ...profile,
                    items: [
                      ...profile.items,
                      {
                        id: uploadId(),
                        description: "",
                        priority: "preferred",
                      },
                    ],
                  };
                  setProfile(next);
                  scheduleSave(next, 0);
                }}
              >
                <Plus size={13} /> Add criterion
              </button>
            </div>
          </div>
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
        revision: opportunity.revision, requestId: id, generalFit: true, engine: "ml", documentIds: [],
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
    <p>Conventional ML analyzes your career library, extracted skills, target criteria and seniority, saves strengths, gaps and review date, and advances active opportunities to Fit review. You can edit the saved result.</p>
    <AIRequestProgress id={requestId} scope={"decision:" + opportunity.id} onError={onError}/>
    {error && <p role="alert" className="alert" style={{ marginTop: 10 }}>{error} Your review fields have been kept. You can retry the assessment.</p>}
    {notice && <p role="status" className="saved" style={{ marginTop: 10, display: "block" }}>{notice}</p>}
  </div>;
}
