import { useState, useRef } from "react";
import {
  Sparkles,
  FolderInput,
  Tag,
  ShieldCheck,
  Trash2,
  X,
  LoaderCircle,
  Plus,
  Minus,
  CheckSquare,
} from "lucide-react";
import { api, json } from "../api";
import { STAGES, OUTCOMES, stageLabel, type Opportunity } from "../types";
import { uploadId } from "../lib/upload-queue";

type BulkActionsBarProps = {
  selectedIds: string[];
  allFilteredCount: number;
  opportunities: Opportunity[];
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
  onReload: () => Promise<void>;
  onError: (err: unknown) => void;
  onNotice: (msg: string) => void;
};

export default function BulkActionsBar({
  selectedIds,
  allFilteredCount,
  opportunities,
  onSelectAllFiltered,
  onClearSelection,
  onReload,
  onError,
  onNotice,
}: BulkActionsBarProps) {
  const [busy, setBusy] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [showTagPopover, setShowTagPopover] = useState(false);
  const [assessing, setAssessing] = useState(false);
  const [assessProgress, setAssessProgress] = useState<{
    current: number;
    total: number;
    currentRole: string;
  } | null>(null);
  const cancelAssessRef = useRef(false);

  const selectedOpps = opportunities.filter((o) => selectedIds.includes(o.id));
  const isAllFilteredSelected =
    allFilteredCount > 0 && selectedIds.length === allFilteredCount;

  // 1. Bulk Stage Change
  const handleStageChange = async (targetStage: string) => {
    if (!targetStage || busy) return;
    setBusy(true);
    try {
      const res = await api<{ count: number }>("/opportunities/batch", {
        method: "POST",
        body: JSON.stringify({
          action: "stage",
          stage: targetStage,
          ids: selectedIds,
        }),
      });
      onNotice(
        `Moved ${res.count} ${res.count === 1 ? "opportunity" : "opportunities"} to ${stageLabel(targetStage)}.`,
      );
      onClearSelection();
      await onReload();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  // 2. Bulk Outcome Change
  const handleOutcomeChange = async (targetOutcome: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api<{ count: number }>("/opportunities/batch", {
        method: "POST",
        body: JSON.stringify({
          action: "outcome",
          outcome: targetOutcome,
          ids: selectedIds,
        }),
      });
      const outcomeLabel =
        OUTCOMES.find((o) => o.id === targetOutcome)?.label ||
        (targetOutcome ? targetOutcome : "cleared");
      onNotice(
        `Updated outcome for ${res.count} ${res.count === 1 ? "opportunity" : "opportunities"} (${outcomeLabel}).`,
      );
      onClearSelection();
      await onReload();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  // 3. Bulk Add Tag
  const handleAddTag = async () => {
    const t = tagInput.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const res = await api<{ count: number }>("/opportunities/batch", {
        method: "POST",
        body: JSON.stringify({
          action: "add-tag",
          tag: t,
          ids: selectedIds,
        }),
      });
      onNotice(`Added tag "${t}" to ${res.count} opportunities.`);
      setTagInput("");
      setShowTagPopover(false);
      await onReload();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  // 4. Bulk Remove Tag
  const handleRemoveTag = async (t: string) => {
    const tagToRemove = t.trim();
    if (!tagToRemove || busy) return;
    setBusy(true);
    try {
      const res = await api<{ count: number }>("/opportunities/batch", {
        method: "POST",
        body: JSON.stringify({
          action: "remove-tag",
          tag: tagToRemove,
          ids: selectedIds,
        }),
      });
      onNotice(`Removed tag "${tagToRemove}" from ${res.count} opportunities.`);
      setShowTagPopover(false);
      await onReload();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  // 5. Bulk Delete
  const handleDelete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api<{ count: number }>(
        "/opportunities/batch",
        json({
          action: "delete",
          ids: selectedIds,
        }),
      );
      onNotice(
        `Deleted ${res.count} ${res.count === 1 ? "opportunity" : "opportunities"}.`,
      );
      onClearSelection();
      await onReload();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  // 6. Bulk Automated Fit Assessment
  const handleBulkFitAssess = async () => {
    if (assessing || busy) return;
    cancelAssessRef.current = false;
    setAssessing(true);

    let successCount = 0;
    const oppsToAssess = selectedOpps;
    const total = oppsToAssess.length;

    for (let i = 0; i < total; i++) {
      if (cancelAssessRef.current) break;
      const opp = oppsToAssess[i];
      setAssessProgress({
        current: i + 1,
        total,
        currentRole: `${opp.role} at ${opp.company}`,
      });

      try {
        const reqId = uploadId();
        await api<{ reviewDraft: unknown; opportunity: Opportunity }>(
          "/buddy/decisions/" + opp.id,
          json({
            revision: opp.revision,
            requestId: reqId,
            generalFit: true,
            engine: "ml",
            documentIds: [],
          }),
        );
        successCount++;
      } catch (err) {
        // Continue with subsequent assessments if one fails
        console.warn(`Fit assessment failed for ${opp.role}:`, err);
      }
    }

    setAssessing(false);
    setAssessProgress(null);
    onNotice(
      `Completed fit assessments for ${successCount} of ${total} ${total === 1 ? "opportunity" : "opportunities"}.`,
    );
    await onReload();
  };

  // Common tags among selected
  const commonTags = Array.from(
    new Set(selectedOpps.flatMap((o) => o.tags || [])),
  ).slice(0, 10);

  return (
    <aside
      className="bulk-actions-bar"
      role="toolbar"
      aria-label="Bulk actions for selected opportunities"
    >
      <div className="bulk-actions-selection-info">
        <span className="bulk-selected-pill">
          <CheckSquare size={13} />
          <strong>{selectedIds.length}</strong> selected
        </span>

        {!isAllFilteredSelected && allFilteredCount > selectedIds.length && (
          <button
            type="button"
            className="bulk-link-btn"
            disabled={busy || assessing}
            onClick={onSelectAllFiltered}
            title={`Select all ${allFilteredCount} filtered opportunities`}
          >
            Select all ({allFilteredCount})
          </button>
        )}
      </div>

      <div className="bulk-actions-divider" />

      {/* Assessing Progress Banner */}
      {assessing && assessProgress ? (
        <div className="bulk-assessing-indicator">
          <LoaderCircle size={15} className="spinner" />
          <span>
            Assessing {assessProgress.current} of {assessProgress.total}:{" "}
            <strong>{assessProgress.currentRole}</strong>
          </span>
          <button
            type="button"
            className="button secondary small"
            onClick={() => {
              cancelAssessRef.current = true;
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="bulk-actions-buttons">
          {/* Fit Assessment */}
          <button
            type="button"
            className="button primary small bulk-action-btn"
            disabled={busy || assessing}
            onClick={() => void handleBulkFitAssess()}
            title="Run automated fit assessment for all selected opportunities"
          >
            <Sparkles size={13} />
            <span>Fit Assessment</span>
          </button>

          {/* Move Stage Selector */}
          <div className="bulk-select-wrapper">
            <FolderInput size={13} className="bulk-select-icon" />
            <select
              disabled={busy || assessing}
              value=""
              onChange={(e) => {
                if (e.target.value) void handleStageChange(e.target.value);
              }}
              title="Move selected opportunities to stage"
              aria-label="Move stage"
            >
              <option value="" disabled>
                Move stage…
              </option>
              {STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Tags Popover Trigger */}
          <div className="bulk-tag-container">
            <button
              type="button"
              className={`button secondary small bulk-action-btn ${showTagPopover ? "active" : ""}`}
              disabled={busy || assessing}
              onClick={() => setShowTagPopover(!showTagPopover)}
              title="Add or remove tags for selected opportunities"
            >
              <Tag size={13} />
              <span>Tags</span>
            </button>

            {showTagPopover && (
              <div className="bulk-tag-popover" role="dialog" aria-label="Bulk Tag Editor">
                <div className="bulk-tag-input-row">
                  <input
                    type="text"
                    placeholder="Tag name…"
                    value={tagInput}
                    disabled={busy}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleAddTag();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={busy || !tagInput.trim()}
                    onClick={() => void handleAddTag()}
                    title="Add tag to selected"
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>

                {commonTags.length > 0 && (
                  <div className="bulk-common-tags">
                    <span className="bulk-common-tags-label">Tags in selection:</span>
                    <div className="bulk-common-chips">
                      {commonTags.map((t) => (
                        <span key={t} className="tag-chip">
                          {t}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleRemoveTag(t)}
                            title={`Remove "${t}" from selected`}
                            aria-label={`Remove tag ${t}`}
                          >
                            <Minus size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Set Outcome Selector */}
          <div className="bulk-select-wrapper">
            <ShieldCheck size={13} className="bulk-select-icon" />
            <select
              disabled={busy || assessing}
              value=""
              onChange={(e) => {
                if (e.target.value !== undefined)
                  void handleOutcomeChange(e.target.value);
              }}
              title="Set outcome for selected opportunities"
              aria-label="Set outcome"
            >
              <option value="" disabled>
                Set outcome…
              </option>
              {OUTCOMES.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
              <option value="">Clear outcome (reactivate)</option>
            </select>
          </div>

          {/* Delete Button */}
          <button
            type="button"
            className="button secondary small danger-button bulk-action-btn"
            disabled={busy || assessing}
            onClick={() => void handleDelete()}
            title="Delete selected opportunities"
          >
            <Trash2 size={13} />
            <span>Delete</span>
          </button>
        </div>
      )}

      <div className="bulk-actions-divider" />

      {/* Deselect All */}
      <button
        type="button"
        className="icon-button bulk-close-btn"
        disabled={busy || assessing}
        onClick={onClearSelection}
        title="Deselect all (Esc)"
        aria-label="Clear selection"
      >
        <X size={15} />
      </button>
    </aside>
  );
}
