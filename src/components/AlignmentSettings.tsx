import { useState, useEffect, useRef, useCallback } from "react";
import {
  SlidersHorizontal,
  ShieldAlert,
  Target,
  Award,
  Zap,
  Plus,
  X,
  LoaderCircle,
  Check,
  RotateCcw,
  AlertCircle,
  Briefcase,
  DollarSign,
  Building,
  Sparkles,
  Trash2,
  ListChecks,
} from "lucide-react";
import { api, json } from "../api";
import type {
  Settings,
  Criteria,
  Criterion,
  StructuredCriteria,
  SeniorityLevel,
} from "../types";
import { SENIORITY_OPTIONS, WORK_MODES } from "./DecisionReview";
import { SENIORITY_LABELS } from "../lib/seniority";

const POPULAR_EXCLUSIONS = [
  "DV clearance",
  "SC clearance",
  "Inside IR35",
  "WordPress",
  "Contract only",
  "Shift work",
  "Weekend work",
];

type AlignmentState = {
  exclusionKeywords: string[];
  targetTitles: string[];
  targetSkills: string[];
  autoAdvanceStages: boolean;
  autoGenerateTasks: boolean;
  defaultFollowUpDays: number;
  dailyTarget: number;
};

function areAlignmentStatesEqual(a: AlignmentState, b: AlignmentState): boolean {
  if (a.autoAdvanceStages !== b.autoAdvanceStages) return false;
  if (a.autoGenerateTasks !== b.autoGenerateTasks) return false;
  if (a.defaultFollowUpDays !== b.defaultFollowUpDays) return false;
  if (a.dailyTarget !== b.dailyTarget) return false;
  if (a.exclusionKeywords.length !== b.exclusionKeywords.length) return false;
  if (a.targetTitles.length !== b.targetTitles.length) return false;
  if (a.targetSkills.length !== b.targetSkills.length) return false;
  if (a.exclusionKeywords.some((v, i) => v !== b.exclusionKeywords[i])) return false;
  if (a.targetTitles.some((v, i) => v !== b.targetTitles[i])) return false;
  if (a.targetSkills.some((v, i) => v !== b.targetSkills[i])) return false;
  return true;
}

export default function AlignmentSettings({
  settings,
  onSaved,
  onError,
  onNotice,
}: {
  settings: Settings;
  onSaved: (s: Settings) => void;
  onError: (e: unknown) => void;
  onNotice: (s: string) => void;
}) {
  const [state, setState] = useState<AlignmentState>({
    exclusionKeywords: settings.exclusionKeywords || [],
    targetTitles: settings.targetTitles || [],
    targetSkills: settings.targetSkills || [],
    autoAdvanceStages: settings.autoAdvanceStages !== false,
    autoGenerateTasks: settings.autoGenerateTasks !== false,
    defaultFollowUpDays: settings.defaultFollowUpDays || 7,
    dailyTarget: settings.dailyTarget || 3,
  });

  const [criteriaProfile, setCriteriaProfile] = useState<Criteria | null>(null);
  const [undoStack, setUndoStack] = useState<{ state: AlignmentState; criteria?: Criteria | null }[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "undone" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  const stateRef = useRef(state);
  stateRef.current = state;
  const criteriaRef = useRef(criteriaProfile);
  criteriaRef.current = criteriaProfile;

  const lastSavedStateRef = useRef<AlignmentState>(state);
  const lastSavedCriteriaRef = useRef<Criteria | null>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);

  const [inputExclusion, setInputExclusion] = useState("");
  const [inputTitle, setInputTitle] = useState("");
  const [inputSkill, setInputSkill] = useState("");
  const [newCriterionDesc, setNewCriterionDesc] = useState("");
  const [newCriterionPriority, setNewCriterionPriority] = useState<Criterion["priority"]>("required");

  // Load criteria profile on mount
  useEffect(() => {
    void api<Criteria>("/buddy/fit-criteria")
      .then((p) => {
        setCriteriaProfile(p);
        lastSavedCriteriaRef.current = p;
      })
      .catch(onError);
  }, [onError]);

  useEffect(() => {
    const next: AlignmentState = {
      exclusionKeywords: settings.exclusionKeywords || [],
      targetTitles: settings.targetTitles || [],
      targetSkills: settings.targetSkills || [],
      autoAdvanceStages: settings.autoAdvanceStages !== false,
      autoGenerateTasks: settings.autoGenerateTasks !== false,
      defaultFollowUpDays: settings.defaultFollowUpDays || 7,
      dailyTarget: settings.dailyTarget || 3,
    };
    setState(next);
    lastSavedStateRef.current = next;
  }, [
    settings.exclusionKeywords,
    settings.targetTitles,
    settings.targetSkills,
    settings.autoAdvanceStages,
    settings.autoGenerateTasks,
    settings.defaultFollowUpDays,
    settings.dailyTarget,
  ]);

  const performUnifiedSave = useCallback(
    async (
      targetState: AlignmentState,
      targetCriteria: Criteria | null | undefined,
      isUndo = false,
    ) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      const stateChanged = !isUndo && !areAlignmentStatesEqual(targetState, lastSavedStateRef.current);
      const criteriaChanged =
        !isUndo &&
        targetCriteria &&
        JSON.stringify(targetCriteria) !== JSON.stringify(lastSavedCriteriaRef.current);

      if (!isUndo && !stateChanged && !criteriaChanged) {
        return true;
      }

      setSaveStatus("saving");
      isSavingRef.current = true;

      const priorState = lastSavedStateRef.current;
      const priorCriteria = lastSavedCriteriaRef.current;

      try {
        let updatedSettings = settings;
        if (stateChanged || isUndo) {
          updatedSettings = await api<Settings>(
            "/settings",
            json(targetState, "PATCH"),
          );
          onSaved(updatedSettings);
          lastSavedStateRef.current = targetState;
        }

        if (targetCriteria && (criteriaChanged || isUndo)) {
          const savedCrit = await api<Criteria>(
            "/buddy/fit-criteria",
            json(targetCriteria, "PATCH"),
          );
          setCriteriaProfile(savedCrit);
          lastSavedCriteriaRef.current = savedCrit;
        }

        if (!isUndo) {
          setUndoStack((prev) => [
            ...prev.slice(-19),
            { state: priorState, criteria: priorCriteria },
          ]);
          setSaveStatus("saved");
          setStatusMessage("Changes saved");
        } else {
          setSaveStatus("undone");
          setStatusMessage("Undid last change");
        }
        return true;
      } catch (err) {
        setSaveStatus("error");
        setStatusMessage("Could not save settings");
        onError(err);
        return false;
      } finally {
        isSavingRef.current = false;
      }
    },
    [settings, onSaved, onError],
  );

  const scheduleUnifiedSave = useCallback(
    (
      nextState: AlignmentState,
      nextCriteria: Criteria | null | undefined,
      delay = 600,
    ) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaveStatus("saving");
      if (delay === 0) {
        saveTimerRef.current = null;
        void performUnifiedSave(nextState, nextCriteria);
      } else {
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          void performUnifiedSave(nextState, nextCriteria);
        }, delay);
      }
    },
    [performUnifiedSave],
  );

  const handleBlur = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      void performUnifiedSave(stateRef.current, criteriaRef.current);
    }
  }, [performUnifiedSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void performUnifiedSave(stateRef.current, criteriaRef.current);
      }
    };
  }, [performUnifiedSave]);

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0 || isSavingRef.current) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setState(previous.state);
    if (previous.criteria !== undefined) {
      setCriteriaProfile(previous.criteria);
    }
    await performUnifiedSave(previous.state, previous.criteria, true);
  }, [undoStack, performUnifiedSave]);

  // Target Titles helper
  const addTitle = (val: string) => {
    const term = val.trim();
    if (!term) return;
    const currTitles = state.targetTitles || [];
    if (!currTitles.some((t) => t.toLowerCase() === term.toLowerCase())) {
      const nextTitles = [...currTitles, term];
      const nextState = { ...stateRef.current, targetTitles: nextTitles };
      setState(nextState);

      let nextCriteria = criteriaRef.current;
      if (nextCriteria) {
        nextCriteria = {
          ...nextCriteria,
          structured: {
            ...(nextCriteria.structured || {}),
            targetTitles: nextTitles,
          },
        };
        setCriteriaProfile(nextCriteria);
      }
      scheduleUnifiedSave(nextState, nextCriteria, 0);
    }
    setInputTitle("");
  };

  const removeTitle = (term: string) => {
    const nextTitles = stateRef.current.targetTitles.filter(
      (t) => t.toLowerCase() !== term.toLowerCase(),
    );
    const nextState = { ...stateRef.current, targetTitles: nextTitles };
    setState(nextState);

    let nextCriteria = criteriaRef.current;
    if (nextCriteria) {
      nextCriteria = {
        ...nextCriteria,
        structured: {
          ...(nextCriteria.structured || {}),
          targetTitles: nextTitles,
        },
      };
      setCriteriaProfile(nextCriteria);
    }
    scheduleUnifiedSave(nextState, nextCriteria, 0);
  };

  // Target Skills helper
  const addSkill = (val: string) => {
    const term = val.trim();
    if (!term) return;
    const currSkills = state.targetSkills || [];
    if (!currSkills.some((s) => s.toLowerCase() === term.toLowerCase())) {
      const nextSkills = [...currSkills, term];
      const nextState = { ...stateRef.current, targetSkills: nextSkills };
      setState(nextState);

      let nextCriteria = criteriaRef.current;
      if (nextCriteria) {
        nextCriteria = {
          ...nextCriteria,
          structured: {
            ...(nextCriteria.structured || {}),
            targetTitles: stateRef.current.targetTitles || [],
            targetSkills: nextSkills,
          },
        };
        setCriteriaProfile(nextCriteria);
      }
      scheduleUnifiedSave(nextState, nextCriteria, 0);
    }
    setInputSkill("");
  };

  const removeSkill = (term: string) => {
    const nextSkills = stateRef.current.targetSkills.filter(
      (s) => s.toLowerCase() !== term.toLowerCase(),
    );
    const nextState = { ...stateRef.current, targetSkills: nextSkills };
    setState(nextState);

    let nextCriteria = criteriaRef.current;
    if (nextCriteria) {
      nextCriteria = {
        ...nextCriteria,
        structured: {
          ...(nextCriteria.structured || {}),
          targetTitles: stateRef.current.targetTitles || [],
          targetSkills: nextSkills,
        },
      };
      setCriteriaProfile(nextCriteria);
    }
    scheduleUnifiedSave(nextState, nextCriteria, 0);
  };

  // Exclusion keywords helper
  const addExclusion = (val: string) => {
    const term = val.trim();
    if (!term) return;
    if (!state.exclusionKeywords.some((k) => k.toLowerCase() === term.toLowerCase())) {
      const next = {
        ...stateRef.current,
        exclusionKeywords: [...stateRef.current.exclusionKeywords, term],
      };
      setState(next);
      scheduleUnifiedSave(next, criteriaRef.current, 0);
    }
    setInputExclusion("");
  };

  const removeExclusion = (term: string) => {
    const next = {
      ...stateRef.current,
      exclusionKeywords: stateRef.current.exclusionKeywords.filter(
        (k) => k.toLowerCase() !== term.toLowerCase(),
      ),
    };
    setState(next);
    scheduleUnifiedSave(next, criteriaRef.current, 0);
  };

  // Structured Criteria (Seniority, Work modes, Salary)
  const structured: StructuredCriteria = {
    targetTitles: criteriaProfile?.structured?.targetTitles || state.targetTitles || [],
    targetSkills: criteriaProfile?.structured?.targetSkills || state.targetSkills || [],
    minSalary: criteriaProfile?.structured?.minSalary ?? null,
    salaryCurrency: criteriaProfile?.structured?.salaryCurrency || "USD",
    salaryPeriod: criteriaProfile?.structured?.salaryPeriod || "year",
    targetSeniorities: criteriaProfile?.structured?.targetSeniorities || [],
    workModes: criteriaProfile?.structured?.workModes || [],
  };

  const updateStructured = (partial: Partial<StructuredCriteria>, delay = 0) => {
    if (!criteriaRef.current) return;
    const next: Criteria = {
      ...criteriaRef.current,
      structured: {
        ...structured,
        ...partial,
        targetTitles: partial.targetTitles ?? structured.targetTitles,
      },
    };
    setCriteriaProfile(next);
    scheduleUnifiedSave(stateRef.current, next, delay);
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

  // Criteria Items helpers
  const generateCriteriaFromPreferences = () => {
    if (!criteriaProfile) return;
    const s = structured;
    const newItems: Criterion[] = [];

    if (state.targetTitles?.length || s.targetSeniorities?.length) {
      const titlePart = state.targetTitles?.length
        ? `roles matching "${state.targetTitles.join(", ")}"`
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

    if (s.minSalary && s.minSalary > 0) {
      const curr = s.salaryCurrency || "USD";
      const per = s.salaryPeriod || "year";
      newItems.push({
        id: "compensation-fit",
        description: `Compensation: Package meets or exceeds ${curr} ${s.minSalary.toLocaleString()} per ${per}.`,
        priority: "required",
      });
    }

    if (state.targetSkills?.length) {
      newItems.push({
        id: "skills-alignment",
        description: `Skills alignment: Candidate evidence demonstrates core skills (${state.targetSkills.join(", ")}).`,
        priority: "preferred",
      });
    }

    if (s.workModes?.length) {
      newItems.push({
        id: "work-mode-fit",
        description: `Working arrangement: Opportunity supports ${s.workModes.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" or ")} arrangement.`,
        priority: "preferred",
      });
    }

    if (!newItems.length) {
      onNotice("Add target titles, salary, seniority, or skills to generate criteria.");
      return;
    }

    const existingIds = new Set(newItems.map((i) => i.id));
    const mergedItems = [
      ...newItems,
      ...(criteriaProfile.items || []).filter((item) => !existingIds.has(item.id)),
    ];

    const next: Criteria = {
      ...criteriaProfile,
      items: mergedItems.slice(0, 30),
    };
    setCriteriaProfile(next);
    scheduleUnifiedSave(stateRef.current, next, 0);
  };

  const addCriterion = () => {
    const text = newCriterionDesc.trim();
    if (!text || !criteriaProfile) return;
    const id = "crit-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    const next: Criteria = {
      ...criteriaProfile,
      items: [
        ...(criteriaProfile.items || []),
        { id, description: text, priority: newCriterionPriority },
      ].slice(0, 30),
    };
    setCriteriaProfile(next);
    setNewCriterionDesc("");
    scheduleUnifiedSave(stateRef.current, next, 0);
  };

  const removeCriterion = (id: string) => {
    if (!criteriaProfile) return;
    const next: Criteria = {
      ...criteriaProfile,
      items: (criteriaProfile.items || []).filter((c) => c.id !== id),
    };
    setCriteriaProfile(next);
    scheduleUnifiedSave(stateRef.current, next, 0);
  };

  const {
    exclusionKeywords,
    targetTitles,
    targetSkills,
    autoAdvanceStages,
    autoGenerateTasks,
    defaultFollowUpDays,
    dailyTarget,
  } = state;

  return (
    <section className="settings-section alignment-settings-section" aria-label="Target roles & criteria">
      <div className="settings-section-heading">
        <SlidersHorizontal size={21} />
        <div>
          <h2>Target Roles, Fit &amp; Criteria</h2>
          <p>
            Unified preferences for role titles, technical skills, seniority, working arrangements, fit criteria, and exclusion filters.
          </p>
        </div>
      </div>

      {/* Top Auto-Save Status Bar */}
      <div className="auto-save-bar" style={{ marginBottom: 16 }}>
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
              <span>{statusMessage || "All preferences saved"}</span>
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
        <button
          type="button"
          className="button secondary small undo-button"
          disabled={undoStack.length === 0 || saveStatus === "saving"}
          onClick={() => void handleUndo()}
          title="Undo last change (Cmd+Z or Ctrl+Z)"
        >
          <RotateCcw size={13} />
          Undo last change
        </button>
      </div>

      {/* 1. Target Job Titles */}
      <div className="settings-card">
        <div className="settings-card-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Target size={18} className="text-blue" />
            <div>
              <h3>Target Job Titles</h3>
              <p>
                The job titles you are actively pursuing. Used to score role relevance and assess fit.
              </p>
            </div>
          </div>
        </div>

        <div className="settings-card-body">
          <div className="tags-input-group">
            <input
              type="text"
              placeholder="e.g. Solutions Architect, Staff Engineer, Head of Engineering…"
              value={inputTitle}
              onChange={(e) => setInputTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTitle(inputTitle);
                }
              }}
            />
            <button
              type="button"
              className="button secondary small"
              onClick={() => addTitle(inputTitle)}
              disabled={!inputTitle.trim()}
            >
              <Plus size={14} /> Add title
            </button>
          </div>

          <div className="active-tag-chips">
            {targetTitles.length === 0 ? (
              <span className="empty-hint">No target titles configured yet.</span>
            ) : (
              targetTitles.map((title) => (
                <span key={title} className="tag-chip title-chip">
                  <span>{title}</span>
                  <button
                    type="button"
                    aria-label={`Remove target title ${title}`}
                    onClick={() => removeTitle(title)}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 2. Target Seniority Levels */}
      <div className="settings-card">
        <div className="settings-card-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Award size={18} className="text-amber" />
            <div>
              <h3>Target Seniority Levels</h3>
              <p>
                Seniority levels that match your background and current search.
              </p>
            </div>
          </div>
        </div>
        <div className="settings-card-body">
          <div className="structured-chips-row">
            {SENIORITY_OPTIONS.map((opt) => {
              const isSelected = (structured.targetSeniorities || []).includes(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`structured-toggle-chip ${isSelected ? "selected" : ""}`}
                  onClick={() => toggleSeniority(opt.id)}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 3. Core Skills & Technologies */}
      <div className="settings-card">
        <div className="settings-card-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Award size={18} className="text-green" />
            <div>
              <h3>Target Skills &amp; Technologies</h3>
              <p>
                Core competencies and tools to look for in job descriptions to calculate alignment.
              </p>
            </div>
          </div>
        </div>

        <div className="settings-card-body">
          <div className="tags-input-group">
            <input
              type="text"
              placeholder="e.g. TypeScript, React, Python, AWS, System Design…"
              value={inputSkill}
              onChange={(e) => setInputSkill(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSkill(inputSkill);
                }
              }}
            />
            <button
              type="button"
              className="button secondary small"
              onClick={() => addSkill(inputSkill)}
              disabled={!inputSkill.trim()}
            >
              <Plus size={14} /> Add skill
            </button>
          </div>

          <div className="active-tag-chips">
            {targetSkills.length === 0 ? (
              <span className="empty-hint">No target skills configured yet.</span>
            ) : (
              targetSkills.map((skill) => (
                <span key={skill} className="tag-chip skill-chip">
                  <span>{skill}</span>
                  <button
                    type="button"
                    aria-label={`Remove target skill ${skill}`}
                    onClick={() => removeSkill(skill)}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 4. Working Arrangements & Compensation */}
      <div className="settings-card">
        <div className="settings-card-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Building size={18} style={{ color: "var(--accent)" }} />
            <div>
              <h3>Work Arrangements &amp; Compensation Target</h3>
              <p>
                Working modes and minimum compensation baseline used when evaluating opportunities.
              </p>
            </div>
          </div>
        </div>

        <div className="settings-card-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="structured-group">
            <label className="structured-group-label">
              <Building size={12} />
              Desired Work Arrangements
            </label>
            <div className="structured-chips-row">
              {WORK_MODES.map((wm) => {
                const isSelected = (structured.workModes || []).includes(wm.id);
                return (
                  <button
                    key={wm.id}
                    type="button"
                    className={`structured-toggle-chip work-mode-chip ${isSelected ? "selected" : ""}`}
                    onClick={() => toggleWorkMode(wm.id)}
                  >
                    {wm.label}
                  </button>
                );
              })}
            </div>
          </div>

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
                onChange={(e) =>
                  updateStructured(
                    {
                      salaryPeriod: e.target.value as StructuredCriteria["salaryPeriod"],
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
        </div>
      </div>

      {/* 5. Custom Fit & Evaluation Criteria */}
      <div className="settings-card">
        <div className="settings-card-header">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", width: "100%", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ListChecks size={18} style={{ color: "var(--accent)" }} />
              <div>
                <h3>Fit Assessment Criteria</h3>
                <p>
                  Specific criteria evaluated during fit assessments. Required criteria act as hard gates.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="button secondary small"
              onClick={generateCriteriaFromPreferences}
              title="Translate above titles, skills, salary and arrangements into criteria"
            >
              <Sparkles size={13} />
              Generate from preferences
            </button>
          </div>
        </div>

        <div className="settings-card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Add new criterion row */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="text"
              style={{ flex: 1, minWidth: 220 }}
              placeholder="e.g. Modern tech stack (AWS, Kubernetes, Go)"
              value={newCriterionDesc}
              onChange={(e) => setNewCriterionDesc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCriterion();
                }
              }}
            />
            <select
              value={newCriterionPriority}
              onChange={(e) => setNewCriterionPriority(e.target.value as Criterion["priority"])}
              style={{ width: "auto" }}
            >
              <option value="required">Required</option>
              <option value="preferred">Preferred</option>
            </select>
            <button
              type="button"
              className="button primary small"
              onClick={addCriterion}
              disabled={!newCriterionDesc.trim()}
            >
              <Plus size={13} /> Add Criterion
            </button>
          </div>

          {/* Criteria items list */}
          {criteriaProfile?.items && criteriaProfile.items.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {criteriaProfile.items.map((item, idx) => (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    background: "var(--panel-soft)",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", width: 20 }}>
                    #{idx + 1}
                  </span>
                  <input
                    type="text"
                    style={{ flex: 1, fontSize: 13 }}
                    value={item.description}
                    onChange={(e) => {
                      if (!criteriaRef.current) return;
                      const next = {
                        ...criteriaRef.current,
                        items: (criteriaRef.current.items || []).map((c) =>
                          c.id === item.id ? { ...c, description: e.target.value } : c,
                        ),
                      };
                      setCriteriaProfile(next);
                      scheduleUnifiedSave(stateRef.current, next, 600);
                    }}
                    onBlur={handleBlur}
                  />
                  <select
                    value={item.priority}
                    style={{ width: "auto", fontSize: 12 }}
                    onChange={(e) => {
                      if (!criteriaRef.current) return;
                      const next = {
                        ...criteriaRef.current,
                        items: (criteriaRef.current.items || []).map((c) =>
                          c.id === item.id ? { ...c, priority: e.target.value as Criterion["priority"] } : c,
                        ),
                      };
                      setCriteriaProfile(next);
                      scheduleUnifiedSave(stateRef.current, next, 0);
                    }}
                  >
                    <option value="required">Required</option>
                    <option value="preferred">Preferred</option>
                  </select>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => removeCriterion(item.id)}
                    title="Remove criterion"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <span className="empty-hint">No custom criteria items added yet. Click &ldquo;Generate from preferences&rdquo; or add one above.</span>
          )}
        </div>
      </div>

      {/* 6. Exclusion Keywords (Dealbreakers) */}
      <div className="settings-card">
        <div className="settings-card-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldAlert size={18} className="text-amber" />
            <div>
              <h3>Exclusion Keywords (Dealbreakers)</h3>
              <p>
                Roles containing these words in their title or description will be flagged with an exclusion badge and can be hidden or archived with one click.
              </p>
            </div>
          </div>
        </div>

        <div className="settings-card-body">
          <div className="tags-input-group">
            <input
              type="text"
              placeholder="e.g. DV clearance, Inside IR35, WordPress…"
              value={inputExclusion}
              onChange={(e) => setInputExclusion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addExclusion(inputExclusion);
                }
              }}
            />
            <button
              type="button"
              className="button secondary small"
              onClick={() => addExclusion(inputExclusion)}
              disabled={!inputExclusion.trim()}
            >
              <Plus size={14} /> Add keyword
            </button>
          </div>

          <div className="popular-presets">
            <span className="preset-label">Quick add suggestions:</span>
            <div className="preset-chips">
              {POPULAR_EXCLUSIONS.filter(
                (p) => !exclusionKeywords.some((k) => k.toLowerCase() === p.toLowerCase()),
              ).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="preset-chip"
                  onClick={() => addExclusion(preset)}
                >
                  + {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="active-tag-chips">
            {exclusionKeywords.length === 0 ? (
              <span className="empty-hint">No exclusion keywords configured yet.</span>
            ) : (
              exclusionKeywords.map((kw) => (
                <span key={kw} className="tag-chip exclusion-chip">
                  <span>{kw}</span>
                  <button
                    type="button"
                    aria-label={`Remove exclusion keyword ${kw}`}
                    onClick={() => removeExclusion(kw)}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 7. Progression Automation & Application Targets */}
      <div className="settings-card">
        <div className="settings-card-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Zap size={18} className="text-amber" />
            <div>
              <h3>Workflow Automation &amp; Targets</h3>
              <p>
                Streamline stage transitions, next action scheduling, and daily application momentum.
              </p>
            </div>
          </div>
        </div>

        <div className="settings-card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label className="check-field">
            <input
              type="checkbox"
              checked={autoAdvanceStages}
              onChange={(e) => {
                const next = { ...stateRef.current, autoAdvanceStages: e.target.checked };
                setState(next);
                scheduleUnifiedSave(next, criteriaRef.current, 0);
              }}
            />
            <span>
              <strong>Auto-advance stages on milestone completion</strong>
              <small style={{ display: "block", color: "var(--ink-secondary)" }}>
                Automatically moves opportunities forward (e.g. to CV &amp; cover letter when tailoring a document in Studio; to Interviews when scheduling an interview). Never moves cards backward.
              </small>
            </span>
          </label>

          <label className="check-field">
            <input
              type="checkbox"
              checked={autoGenerateTasks}
              onChange={(e) => {
                const next = { ...stateRef.current, autoGenerateTasks: e.target.checked };
                setState(next);
                scheduleUnifiedSave(next, criteriaRef.current, 0);
              }}
            />
            <span>
              <strong>Auto-generate next actions &amp; To-Do tasks</strong>
              <small style={{ display: "block", color: "var(--ink-secondary)" }}>
                Populates intelligent next actions and creates linked tasks on stage transitions (e.g. 7-day follow-up after submission; interview preparation).
              </small>
            </span>
          </label>

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", paddingTop: 4 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Default follow-up (days)</span>
              <input
                type="number"
                min={1}
                max={90}
                style={{ width: 140 }}
                value={defaultFollowUpDays}
                onChange={(e) => {
                  const val = Math.max(1, Number(e.target.value) || 1);
                  const next = { ...stateRef.current, defaultFollowUpDays: val };
                  setState(next);
                  scheduleUnifiedSave(next, criteriaRef.current, 600);
                }}
                onBlur={handleBlur}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Daily application target</span>
              <input
                type="number"
                min={1}
                max={50}
                style={{ width: 140 }}
                value={dailyTarget}
                onChange={(e) => {
                  const val = Math.max(1, Number(e.target.value) || 1);
                  const next = { ...stateRef.current, dailyTarget: val };
                  setState(next);
                  scheduleUnifiedSave(next, criteriaRef.current, 600);
                }}
                onBlur={handleBlur}
              />
            </label>
          </div>
        </div>
      </div>

      {/* Bottom Auto-Save Status Bar */}
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
              <span>{statusMessage || "All preferences saved"}</span>
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
        <button
          type="button"
          className="button secondary small undo-button"
          disabled={undoStack.length === 0 || saveStatus === "saving"}
          onClick={() => void handleUndo()}
          title="Undo last change (Cmd+Z or Ctrl+Z)"
        >
          <RotateCcw size={13} />
          Undo last change
        </button>
      </div>
    </section>
  );
}
