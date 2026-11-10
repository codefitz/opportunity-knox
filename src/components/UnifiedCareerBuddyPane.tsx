import { useState } from "react";
import {
  BriefcaseBusiness,
  ChevronRight,
  FileText,
  FolderOpen,
  Maximize2,
  Minimize2,
  Smile,
  X,
} from "lucide-react";
import type { Opportunity } from "../types";
import BuddyAvatar, { BUDDY_AVATARS, useBuddyAvatar } from "./BuddyAvatar";
import CareerBuddy from "./CareerBuddy";
import BuddyWorkspace from "./BuddyWorkspace";

export default function UnifiedCareerBuddyPane({
  open,
  onToggleOpen,
  activeOpportunity,
  onUpdateOpportunity,
  focusedDocument,
  onClearFocusedDocument,
  activePageLabel,
  timezone,
  initialPrompt,
  onInitialPromptConsumed,
  onChanged,
  onNotice,
  onError,
  onConfigure,
}: {
  open: boolean;
  onToggleOpen: (next?: boolean) => void;
  activeOpportunity: Opportunity | null;
  onUpdateOpportunity: (o: Opportunity) => void;
  focusedDocument: { id: string; name: string } | null;
  onClearFocusedDocument: () => void;
  activePageLabel: string;
  timezone: string;
  initialPrompt: string;
  onInitialPromptConsumed: () => void;
  onChanged: () => void;
  onNotice: (message: string) => void;
  onError: (e: unknown) => void;
  onConfigure: () => void;
}) {
  const [avatarId, setAvatarId] = useBuddyAvatar();
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [wide, setWide] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className="unified-buddy-fab"
        onClick={() => onToggleOpen(true)}
        aria-label="Open Career Buddy right panel"
        title="Open Career Buddy"
      >
        <BuddyAvatar avatarId={avatarId} size={28} />
        <span className="unified-buddy-fab-label">Career Buddy</span>
        {activeOpportunity ? (
          <span className="unified-buddy-fab-context">
            {activeOpportunity.company}
          </span>
        ) : focusedDocument ? (
          <span className="unified-buddy-fab-context">
            {focusedDocument.name}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <aside
      className={`unified-buddy-pane ${wide ? "is-wide" : ""}`.trim()}
      aria-label="Career Buddy panel"
    >
      <header className="unified-buddy-pane-header">
        <div className="unified-buddy-pane-title">
          <button
            type="button"
            className="unified-buddy-avatar-trigger"
            onClick={() => setShowAvatarPicker((v) => !v)}
            title="Choose Career Buddy face icon"
            aria-label="Choose Career Buddy face icon"
          >
            <BuddyAvatar avatarId={avatarId} size={32} />
          </button>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <strong>Career Buddy</strong>
              <button
                type="button"
                className="text-button"
                style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 3 }}
                onClick={() => setShowAvatarPicker((v) => !v)}
                title="Change Career Buddy avatar"
              >
                <Smile size={12} /> Face
              </button>
            </div>
            <div className="unified-buddy-context-indicator">
              {activeOpportunity ? (
                <span className="unified-buddy-context-pill is-opportunity">
                  <BriefcaseBusiness size={12} />
                  <span>
                    Context: <strong>{activeOpportunity.role}</strong> at{" "}
                    <strong>{activeOpportunity.company}</strong>
                  </span>
                </span>
              ) : focusedDocument ? (
                <span className="unified-buddy-context-pill is-document">
                  <FileText size={12} />
                  <span>
                    Doc: <strong>{focusedDocument.name}</strong>
                  </span>
                  <button
                    type="button"
                    className="buddy-chip-remove"
                    onClick={onClearFocusedDocument}
                    title="Switch to general workspace context"
                  >
                    <X size={11} />
                  </button>
                </span>
              ) : (
                <span className="unified-buddy-context-pill is-workspace">
                  <FolderOpen size={12} />
                  <span>Context: {activePageLabel} &amp; Career Docs</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="unified-buddy-pane-actions">
          <button
            type="button"
            className="button secondary small"
            onClick={() => setWide((w) => !w)}
            title={wide ? "Standard panel width" : "Expand panel width"}
            aria-label={wide ? "Standard panel width" : "Expand panel width"}
          >
            {wide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            className="button secondary small"
            onClick={() => onToggleOpen(false)}
            title="Collapse Career Buddy panel"
            aria-label="Collapse Career Buddy panel"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </header>

      {showAvatarPicker && (
        <div
          className="unified-buddy-avatar-picker"
          role="region"
          aria-label="Choose a Career Buddy face icon"
        >
          <div className="unified-buddy-avatar-picker-header">
            <span>Choose a friendly face for Career Buddy</span>
            <button
              type="button"
              className="text-button"
              onClick={() => setShowAvatarPicker(false)}
            >
              Done
            </button>
          </div>
          <div className="unified-buddy-avatar-grid">
            {BUDDY_AVATARS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`unified-buddy-avatar-option ${avatarId === opt.id ? "is-selected" : ""}`}
                onClick={() => {
                  setAvatarId(opt.id);
                  setShowAvatarPicker(false);
                }}
              >
                <BuddyAvatar avatarId={opt.id} size={34} />
                <div>
                  <strong>{opt.name}</strong>
                  <small>{opt.tagline}</small>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="unified-buddy-pane-body">
        {activeOpportunity ? (
          <CareerBuddy
            opportunity={activeOpportunity}
            timezone={timezone}
            onUpdate={onUpdateOpportunity}
            onError={onError}
            onConfigure={onConfigure}
            initialPrompt={initialPrompt}
            onInitialPromptConsumed={onInitialPromptConsumed}
            onNotice={onNotice}
          />
        ) : (
          <BuddyWorkspace
            onError={onError}
            onChanged={onChanged}
            onNotice={onNotice}
            focusedDocument={focusedDocument}
            onClearFocusedDocument={onClearFocusedDocument}
            initialPrompt={initialPrompt}
            onInitialPromptConsumed={onInitialPromptConsumed}
            compact={true}
          />
        )}
      </div>
    </aside>
  );
}
