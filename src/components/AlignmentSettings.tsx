import { useState, useEffect, useRef, useCallback } from "react";
import { SlidersHorizontal, ShieldAlert, Target, Award, Zap, Plus, X, LoaderCircle, Check, RotateCcw, AlertCircle } from "lucide-react";
import { api, json } from "../api";
import type { Settings } from "../types";

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
  const [undoStack, setUndoStack] = useState<AlignmentState[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "undone" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  const stateRef = useRef(state);
  stateRef.current = state;
  const lastSavedRef = useRef<AlignmentState>(state);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef(false);

  const [inputExclusion, setInputExclusion] = useState("");
  const [inputTitle, setInputTitle] = useState("");
  const [inputSkill, setInputSkill] = useState("");

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
    lastSavedRef.current = next;
  }, [
    settings.exclusionKeywords,
    settings.targetTitles,
    settings.targetSkills,
    settings.autoAdvanceStages,
    settings.autoGenerateTasks,
    settings.defaultFollowUpDays,
    settings.dailyTarget,
  ]);

  const performSave = useCallback(
    async (targetState: AlignmentState, isUndo = false) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (!isUndo && areAlignmentStatesEqual(targetState, lastSavedRef.current)) {
        return true;
      }
      if (isSavingRef.current) {
        pendingSaveRef.current = true;
        return false;
      }
      isSavingRef.current = true;
      setSaveStatus("saving");

      const prior = lastSavedRef.current;
      try {
        const updated = await api<Settings>(
          "/settings",
          json(targetState, "PATCH"),
        );
        onSaved(updated);
        lastSavedRef.current = targetState;
        if (!isUndo) {
          setUndoStack((prev) => [...prev.slice(-19), prior]);
          setSaveStatus("saved");
          setStatusMessage("Settings saved");
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
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          void performSave(stateRef.current);
        }
      }
    },
    [onSaved, onError],
  );

  const scheduleSave = useCallback(
    (nextState: AlignmentState, delay = 600) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaveStatus("saving");
      if (delay === 0) {
        saveTimerRef.current = null;
        void performSave(nextState);
      } else {
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          void performSave(nextState);
        }, delay);
      }
    },
    [performSave],
  );

  const handleBlur = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      void performSave(stateRef.current);
    }
  }, [performSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void performSave(stateRef.current);
      }
    };
  }, [performSave]);

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0 || isSavingRef.current) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setState(previous);
    await performSave(previous, true);
  }, [undoStack, performSave]);

  const addExclusion = (val: string) => {
    const term = val.trim();
    if (!term) return;
    if (!state.exclusionKeywords.some((k) => k.toLowerCase() === term.toLowerCase())) {
      const next = { ...stateRef.current, exclusionKeywords: [...stateRef.current.exclusionKeywords, term] };
      setState(next);
      scheduleSave(next, 0);
    }
    setInputExclusion("");
  };

  const removeExclusion = (term: string) => {
    const next = {
      ...stateRef.current,
      exclusionKeywords: stateRef.current.exclusionKeywords.filter((k) => k.toLowerCase() !== term.toLowerCase()),
    };
    setState(next);
    scheduleSave(next, 0);
  };

  const addTitle = (val: string) => {
    const term = val.trim();
    if (!term) return;
    if (!state.targetTitles.some((t) => t.toLowerCase() === term.toLowerCase())) {
      const next = { ...stateRef.current, targetTitles: [...stateRef.current.targetTitles, term] };
      setState(next);
      scheduleSave(next, 0);
    }
    setInputTitle("");
  };

  const removeTitle = (term: string) => {
    const next = {
      ...stateRef.current,
      targetTitles: stateRef.current.targetTitles.filter((t) => t.toLowerCase() !== term.toLowerCase()),
    };
    setState(next);
    scheduleSave(next, 0);
  };

  const addSkill = (val: string) => {
    const term = val.trim();
    if (!term) return;
    if (!state.targetSkills.some((s) => s.toLowerCase() === term.toLowerCase())) {
      const next = { ...stateRef.current, targetSkills: [...stateRef.current.targetSkills, term] };
      setState(next);
      scheduleSave(next, 0);
    }
    setInputSkill("");
  };

  const removeSkill = (term: string) => {
    const next = {
      ...stateRef.current,
      targetSkills: stateRef.current.targetSkills.filter((s) => s.toLowerCase() !== term.toLowerCase()),
    };
    setState(next);
    scheduleSave(next, 0);
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
    <section className="settings-section alignment-settings-section">
      <div className="settings-section-heading">
        <SlidersHorizontal size={21} />
        <div>
          <h2>Alignment & Exclusion Filters</h2>
          <p>
            Filter out unwanted roles and score opportunities based on your target titles and skills.
          </p>
        </div>
      </div>

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

      <div className="settings-card">
        <div className="settings-card-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Target size={18} className="text-blue" />
            <div>
              <h3>Target Job Titles</h3>
              <p>
                Specify the role titles you are actively seeking. Used to calculate candidate-role title alignment.
              </p>
            </div>
          </div>
        </div>

        <div className="settings-card-body">
          <div className="tags-input-group">
            <input
              type="text"
              placeholder="e.g. Principal Architect, Staff Engineer, Head of Engineering…"
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

      <div className="settings-card">
        <div className="settings-card-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Award size={18} className="text-green" />
            <div>
              <h3>Target Skills & Technologies</h3>
              <p>
                Core competencies and tools to look for in job descriptions to calculate technical alignment.
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

      <div className="settings-card">
        <div className="settings-card-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Zap size={18} className="text-amber" />
            <div>
              <h3>Workflow Automation & Targets</h3>
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
                scheduleSave(next, 0);
              }}
            />
            <span>
              <strong>Auto-advance stages on milestone completion</strong>
              <small style={{ display: "block", color: "var(--ink-secondary)" }}>
                Automatically moves opportunities forward (e.g. to CV & cover letter when tailoring a document in Studio; to Interviews when scheduling an interview). Never moves cards backward.
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
                scheduleSave(next, 0);
              }}
            />
            <span>
              <strong>Auto-generate next actions & To-Do tasks</strong>
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
                  scheduleSave(next, 600);
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
                  scheduleSave(next, 600);
                }}
                onBlur={handleBlur}
              />
            </label>
          </div>
        </div>
      </div>

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
              <span>{statusMessage || "Settings saved"}</span>
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
