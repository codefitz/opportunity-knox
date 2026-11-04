import { useState, useEffect } from "react";
import { SlidersHorizontal, ShieldAlert, Target, Award, Zap, Plus, X } from "lucide-react";
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
  const [exclusionKeywords, setExclusionKeywords] = useState<string[]>(
    settings.exclusionKeywords || [],
  );
  const [targetTitles, setTargetTitles] = useState<string[]>(
    settings.targetTitles || [],
  );
  const [targetSkills, setTargetSkills] = useState<string[]>(
    settings.targetSkills || [],
  );
  const [autoAdvanceStages, setAutoAdvanceStages] = useState<boolean>(
    settings.autoAdvanceStages !== false,
  );
  const [autoGenerateTasks, setAutoGenerateTasks] = useState<boolean>(
    settings.autoGenerateTasks !== false,
  );
  const [defaultFollowUpDays, setDefaultFollowUpDays] = useState<number>(
    settings.defaultFollowUpDays || 7,
  );
  const [dailyTarget, setDailyTarget] = useState<number>(
    settings.dailyTarget || 3,
  );
  const [inputExclusion, setInputExclusion] = useState("");
  const [inputTitle, setInputTitle] = useState("");
  const [inputSkill, setInputSkill] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setExclusionKeywords(settings.exclusionKeywords || []);
    setTargetTitles(settings.targetTitles || []);
    setTargetSkills(settings.targetSkills || []);
    setAutoAdvanceStages(settings.autoAdvanceStages !== false);
    setAutoGenerateTasks(settings.autoGenerateTasks !== false);
    setDefaultFollowUpDays(settings.defaultFollowUpDays || 7);
    setDailyTarget(settings.dailyTarget || 3);
    setDirty(false);
  }, [
    settings.exclusionKeywords,
    settings.targetTitles,
    settings.targetSkills,
    settings.autoAdvanceStages,
    settings.autoGenerateTasks,
    settings.defaultFollowUpDays,
    settings.dailyTarget,
  ]);

  const addExclusion = (val: string) => {
    const term = val.trim();
    if (!term) return;
    if (!exclusionKeywords.some((k) => k.toLowerCase() === term.toLowerCase())) {
      setExclusionKeywords([...exclusionKeywords, term]);
      setDirty(true);
    }
    setInputExclusion("");
  };

  const removeExclusion = (term: string) => {
    setExclusionKeywords(
      exclusionKeywords.filter((k) => k.toLowerCase() !== term.toLowerCase()),
    );
    setDirty(true);
  };

  const addTitle = (val: string) => {
    const term = val.trim();
    if (!term) return;
    if (!targetTitles.some((t) => t.toLowerCase() === term.toLowerCase())) {
      setTargetTitles([...targetTitles, term]);
      setDirty(true);
    }
    setInputTitle("");
  };

  const removeTitle = (term: string) => {
    setTargetTitles(
      targetTitles.filter((t) => t.toLowerCase() !== term.toLowerCase()),
    );
    setDirty(true);
  };

  const addSkill = (val: string) => {
    const term = val.trim();
    if (!term) return;
    if (!targetSkills.some((s) => s.toLowerCase() === term.toLowerCase())) {
      setTargetSkills([...targetSkills, term]);
      setDirty(true);
    }
    setInputSkill("");
  };

  const removeSkill = (term: string) => {
    setTargetSkills(
      targetSkills.filter((s) => s.toLowerCase() !== term.toLowerCase()),
    );
    setDirty(true);
  };

  const save = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      const updated = await api<Settings>(
        "/settings",
        json(
          {
            exclusionKeywords,
            targetTitles,
            targetSkills,
            autoAdvanceStages,
            autoGenerateTasks,
            defaultFollowUpDays,
            dailyTarget,
          },
          "PATCH",
        ),
      );
      onSaved(updated);
      setDirty(false);
      onNotice("Targeting, filters, and workflow automation settings saved.");
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  };

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
                setAutoAdvanceStages(e.target.checked);
                setDirty(true);
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
                setAutoGenerateTasks(e.target.checked);
                setDirty(true);
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
                  setDefaultFollowUpDays(Math.max(1, Number(e.target.value) || 1));
                  setDirty(true);
                }}
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
                  setDailyTarget(Math.max(1, Number(e.target.value) || 1));
                  setDirty(true);
                }}
              />
            </label>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <button
          type="button"
          className="button primary small"
          disabled={!dirty || saving}
          onClick={() => save()}
        >
          {saving ? "Saving..." : "Save settings"}
        </button>
      </div>
    </section>
  );
}
