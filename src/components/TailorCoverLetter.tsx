import { uploadId } from "../lib/upload-queue";
import { useEffect, useState } from "react";
import { api, json } from "../api";
import type { Opportunity } from "../types";
import AIRequestProgress from "./AIRequestProgress";
import { AINotesView } from "./TailorApplication";
import {
  Download,
  FileText,
  Folder,
  Mail,
  Sparkles,
  Check,
  Cloud,
  Copy,
  ExternalLink,
  X,
} from "lucide-react";

type Draft = {
  id: string;
  requestId: string;
  content: string;
  draft: { kind: string; title: string; content: string };
  editedDraft?: { title: string; content: string };
  savedDocuments: { id: string; name: string; url: string }[];
  tailoring?: {
    styleDocumentId?: string;
    styleDocumentRevision?: number;
    styleDocumentName?: string;
  };
};

type TemplateOption = {
  id: string;
  name: string;
  fullName: string;
  revision: number;
  format: string;
  category?: string;
};

type BuddyInfo = {
  enabled: boolean;
  provider: string;
  model: string;
  providerName: string;
};

export default function TailorCoverLetter({
  opportunity,
  onSaved,
  onUpdate,
  onError,
  onOpenStudio,
}: {
  opportunity: Opportunity;
  onSaved: (ids: string[], hasCover: boolean) => Promise<void>;
  onUpdate?: (o: Opportunity) => void;
  onError: (e: unknown) => void;
  onOpenStudio?: (opId?: string, docId?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");
  const [buddyInfo, setBuddyInfo] = useState<BuddyInfo | null>(null);

  // Template selection
  const [coverTemplates, setCoverTemplates] = useState<TemplateOption[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // Google Drive & Docs integration
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleModalOpen, setGoogleModalOpen] = useState(false);
  const [googleExporting, setGoogleExporting] = useState<"api" | "local" | null>(null);
  const [googleDocUrl, setGoogleDocUrl] = useState<string | null>(null);
  const [googleExportResult, setGoogleExportResult] = useState<{
    mode: "api" | "local";
    url?: string;
    filePath?: string;
    message: string;
  } | null>(null);

  const base = `/opportunities/${opportunity.id}/buddy`;

  // Detect Google Drive connection & load master cover letter templates
  useEffect(() => {
    void api<{
      googleConnected?: boolean;
      coverTemplates?: TemplateOption[];
      templates?: TemplateOption[];
      defaults?: { coverLetterTemplateId?: string };
    }>("/document-studio/cv-styles")
      .then((r) => {
        setGoogleConnected(Boolean(r.googleConnected));
        const list =
          r.coverTemplates && r.coverTemplates.length > 0
            ? r.coverTemplates
            : (r.templates || []).filter(
                (t) =>
                  /\b(cover|letter)\b/i.test(t.name) ||
                  t.category === "cover-letter-template" ||
                  t.category === "master-cover-letter",
              );
        setCoverTemplates(list);
        const preferredId =
          r.defaults?.coverLetterTemplateId || (list.length > 0 ? list[0].id : "");
        setDefaultTemplateId(preferredId);
        setSelectedTemplateId((curr) => curr || preferredId);
      })
      .catch(() => {});
  }, []);

  // Sync Google Doc URL from opportunity documents
  useEffect(() => {
    const coverDoc = (opportunity.documents || []).find(
      (d) => d.kind === "cover" && (d.originalUrl || d.externalSource?.url),
    );
    if (coverDoc) {
      setGoogleDocUrl(coverDoc.originalUrl || coverDoc.externalSource?.url || null);
    }
  }, [opportunity.documents]);

  // Load configured AI provider details
  useEffect(() => {
    void api<{
      enabled: boolean;
      provider: string;
      model: string;
      providers?: Record<string, { name: string }>;
    }>("/buddy/settings")
      .then((s) => {
        const pName =
          s.providers?.[s.provider]?.name ||
          (s.provider === "codex" ? "Codex (host CLI)" : s.provider.toUpperCase());
        setBuddyInfo({
          enabled: s.enabled,
          provider: s.provider,
          model: s.model || "default",
          providerName: pName,
        });
      })
      .catch(() => {});
  }, []);

  // Restore previous cover letter draft for this opportunity if one exists
  useEffect(() => {
    let live = true;
    void api<{ messages: Draft[] }>(base)
      .then((result) => {
        if (!live) return;
        const coverDrafts = (result.messages || []).filter(
          (m) => m.draft?.kind === "cover" && m.draft?.content,
        );
        if (coverDrafts.length > 0) {
          const latest = coverDrafts.at(-1)!;
          const restored = {
            ...latest,
            draft: latest.editedDraft ? { ...latest.draft, ...latest.editedDraft } : latest.draft,
          };
          setDraft(restored);
          if (latest.tailoring?.styleDocumentId) {
            setSelectedTemplateId(latest.tailoring.styleDocumentId);
          }
          if (restored.savedDocuments && restored.savedDocuments.length > 0) {
            setSaved(true);
          }
          setStatus("Restored existing cover letter draft. Review or edit before saving.");
        }
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [opportunity.id]);

  async function saveDraft(targetDraft: Draft) {
    setBusy(true);
    setError("");
    try {
      setStatus("Saving cover letter to Word (.docx)…");
      const result = await api<{ messages: Draft[]; opportunity?: Opportunity }>(
        base + "/draft/" + targetDraft.id,
        json({
          title: targetDraft.draft.title,
          content: targetDraft.draft.content,
          layout: "letter",
        }),
      );
      const stored = result.messages.find((m) => m.id === targetDraft.id);
      if (!stored || !stored.savedDocuments?.length) {
        throw new Error("Could not save cover letter document.");
      }
      const savedDoc = stored.savedDocuments.at(-1)!;
      try {
        await api(`/documents/${savedDoc.id}/reference`, json({ revision: 1 }));
      } catch {}

      setDraft({
        ...targetDraft,
        savedDocuments: stored.savedDocuments,
      });

      if (result.opportunity && onUpdate) {
        onUpdate(result.opportunity);
      }

      await onSaved([savedDoc.id], true);
      setSaved(true);
      setStatus("Saved editable Word (.docx) cover letter to this opportunity and Career Docs (Reference).");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save cover letter draft.");
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  async function generateCoverLetter() {
    setBusy(true);
    setError("");
    setSaved(false);
    setStatus("Drafting cover letter with AI…");
    const id = uploadId();
    setRequestId(id);

    const selectedTpl = coverTemplates.find((t) => t.id === selectedTemplateId);

    try {
      const result = await api<{ messages: Draft[] }>(
        base + "/chat",
        json({
          action: "cover",
          requestId: id,
          tailoringGroupId: id,
          autoTailor: true,
          passToAi: true,
          templateLayout: "letter",
          styleDocumentId: selectedTpl ? selectedTpl.id : undefined,
          styleDocumentRevision: selectedTpl ? selectedTpl.revision : undefined,
          documentIds: [],
          includeOtherOpportunities: false,
          message:
            "Write a concise, compelling cover letter for this opportunity using the chosen source CV and verified evidence." +
            (customInstructions.trim()
              ? " Candidate focus: " + customInstructions.trim()
              : ""),
        }),
      );

      const generatedDraft = result.messages.find(
        (m) => m.requestId === id && m.draft?.kind === "cover",
      );

      if (!generatedDraft) {
        const explanation = result.messages.find(
          (m) => m.requestId === id && m.draft,
        )?.content;
        throw new Error(
          explanation || "The AI returned no cover letter draft. Please retry.",
        );
      }

      setDraft(generatedDraft);
      // Automatically save to Word (.docx) and register document
      await saveDraft(generatedDraft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate cover letter.");
      onError(e);
      setBusy(false);
    }
  }

  async function handleOpenLocalFolder() {
    try {
      const res = await api<{
        ok: boolean;
        folderPath: string;
        openedOnHost?: boolean;
        opened?: boolean;
        message: string;
      }>(`/opportunities/${encodeURIComponent(opportunity.id)}/open-folder`, json({}));
      const wasOpened = Boolean(res.openedOnHost ?? res.opened);
      if (!wasOpened && navigator.clipboard?.writeText && res.folderPath) {
        await navigator.clipboard.writeText(res.folderPath).catch(() => {});
      }
      setStatus(
        wasOpened
          ? res.message
          : `${res.message} (Path copied to clipboard)`,
      );
    } catch (e) {
      onError(e);
    }
  }

  async function handleExportGoogle(mode: "api" | "local") {
    const savedDoc = draft?.savedDocuments?.at(-1);
    if (!savedDoc) return;
    setGoogleExporting(mode);
    setGoogleExportResult(null);
    try {
      const res = await api<{
        ok: boolean;
        mode: "api" | "local";
        url?: string;
        filePath?: string;
        message: string;
      }>("/document-studio/google/export", json({ documentId: savedDoc.id, mode }));
      setGoogleExportResult(res);
      if (res.url) {
        setGoogleDocUrl(res.url);
      }
      try {
        const refreshed = await api<Opportunity>(`/opportunities/${opportunity.id}`);
        if (refreshed && onUpdate) {
          onUpdate(refreshed);
        }
      } catch {}
      await onSaved([savedDoc.id], true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not export to Google Docs.");
      onError(e);
    } finally {
      setGoogleExporting(null);
    }
  }

  return (
    <details
      className="tailor-application tailor-cover-letter"
      open={expanded}
      onToggle={(e) => {
        if (e.target === e.currentTarget) setExpanded(e.currentTarget.open);
      }}
    >
      <summary className="tailor-summary">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Mail size={16} />
          <span>Create a cover letter</span>
        </span>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {draft && !busy && (
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: "10px",
                background: "var(--accent-soft, rgba(41, 102, 77, 0.12))",
                color: "var(--accent)",
              }}
            >
              Draft ready
            </span>
          )}
          {busy && <span className="tailor-working-pill">Working…</span>}
        </div>
      </summary>

      <div className="tailor-flow-container">
        <div className="section-intro" style={{ marginBottom: 4 }}>
          <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
            Draft a tailored cover letter for <strong>{opportunity.role}</strong> at <strong>{opportunity.company}</strong> using your verified career evidence and source CV.
          </p>
        </div>

        {/* Cover Letter Master Template Selection */}
        <div
          className="pre-generate-guidance"
          style={{
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "10px 14px",
            background: "var(--panel-soft)",
            marginBottom: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
            <label
              htmlFor={`cover-template-${opportunity.id}`}
              style={{ fontWeight: 600, fontSize: "0.88rem", display: "flex", alignItems: "center", gap: 6, margin: 0 }}
            >
              <FileText size={15} />
              <span>Cover Letter Master Template</span>
            </label>
            {selectedTemplateId && (
              <span
                style={{
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: "10px",
                  background: "var(--accent-soft, rgba(41, 102, 77, 0.12))",
                  color: "var(--accent)",
                }}
              >
                {selectedTemplateId === defaultTemplateId ? "★ Default Master Template" : "Active Template"}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <select
              id={`cover-template-${opportunity.id}`}
              value={selectedTemplateId}
              disabled={busy}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              style={{ flex: 1, minWidth: 240 }}
            >
              {coverTemplates.length > 0 ? (
                coverTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} {t.id === defaultTemplateId ? "★ (Default Master Template)" : ""}
                  </option>
                ))
              ) : (
                <option value="">Built-in Standard Letter Template</option>
              )}
              {coverTemplates.length > 0 && (
                <option value="">Built-in Standard Letter Template</option>
              )}
            </select>

            {onOpenStudio && (
              <button
                type="button"
                className="button secondary small"
                onClick={() => onOpenStudio(opportunity.id)}
                title="Manage or upload master cover letter templates in Doc Studio"
              >
                Manage templates
              </button>
            )}
          </div>

          <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
            {selectedTemplateId && coverTemplates.find((t) => t.id === selectedTemplateId)
              ? `Formatting, letterhead, typography, and paragraph layout will be preserved from "${coverTemplates.find((t) => t.id === selectedTemplateId)?.name}".`
              : "Uses standard letter formatting. Assign a master template in Doc Studio to match your custom document design."}
          </p>
        </div>

        {/* Focus Instructions */}
        <div className="pre-generate-guidance">
          <label htmlFor={`cover-focus-${opportunity.id}`} style={{ fontWeight: 600, fontSize: "0.88rem" }}>
            Key points to emphasize (Optional)
          </label>
          <textarea
            id={`cover-focus-${opportunity.id}`}
            rows={3}
            placeholder="e.g. Highlight my 5+ years of distributed systems experience, why I want to work at this company, and my recent leadership of the cloud migration project…"
            value={customInstructions}
            disabled={busy}
            onChange={(e) => setCustomInstructions(e.target.value)}
          />
        </div>

        {/* Action bar */}
        <div className="tailor-action-bar">
          <div className="tailor-buttons-row">
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => void generateCoverLetter()}
            >
              <Sparkles size={15} />
              {busy ? "Drafting with AI…" : draft ? "Re-draft with AI" : "Draft cover letter with AI"}
            </button>

            {draft && (
              <button
                type="button"
                className="button primary save-button"
                disabled={busy || !draft.draft.title.trim() || !draft.draft.content.trim()}
                onClick={() => void saveDraft(draft)}
              >
                <Check size={14} />
                {busy ? "Saving…" : saved ? "✓ Saved to Career Docs" : "Save changes"}
              </button>
            )}

            {saved && draft?.savedDocuments?.length ? (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setGoogleExportResult(null);
                  setGoogleModalOpen(true);
                }}
                title="Open in Google Drive / Export to Google Docs"
              >
                <Cloud size={14} />
                {googleDocUrl ? "Open in Google Drive" : "Google Drive"}
              </button>
            ) : null}

            <a
              className="button secondary"
              href="/api/document-studio/templates/letter"
              download="cover-letter-template.docx"
              title="Download a blank Word (.docx) cover letter template"
            >
              <Download size={14} />
              Download blank template (.docx)
            </a>

            {onOpenStudio && (
              <button
                type="button"
                className="button secondary"
                onClick={() => onOpenStudio(opportunity.id)}
                title="Open this opportunity in Doc Studio for advanced formatting and manual editing"
              >
                <FileText size={14} />
                Open in Doc Studio
              </button>
            )}

            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void handleOpenLocalFolder()}
              title="Open the local folder where this opportunity's documents are saved"
            >
              <Folder size={14} />
              Open local folder
            </button>
          </div>
        </div>

        {/* Progress, Errors, Status */}
        <AIRequestProgress id={requestId} onError={onError} />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {status && (
          <p className="form-notice" role="status">
            {status}
          </p>
        )}

        {/* Draft Review & Edit */}
        {draft && (
          <div className="tailored-draft">
            <div className="tailored-draft-header">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Mail size={16} />
                <h4>Cover Letter Draft</h4>
              </div>
              <span className="tailored-draft-meta">
                {draft.draft.content.split(/\s+/).filter(Boolean).length} words ·{" "}
                {draft.draft.content.length} characters
                {draft.tailoring?.styleDocumentName ? ` · Template: ${draft.tailoring.styleDocumentName}` : ""}
              </span>
            </div>

            <div className="draft-editor-fields">
              <label className="field">
                <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>Document Title (.docx)</span>
                <input
                  type="text"
                  value={draft.draft.title}
                  disabled={busy}
                  onChange={(e) => {
                    const title = e.target.value;
                    setDraft((curr) => (curr ? { ...curr, draft: { ...curr.draft, title } } : null));
                    setSaved(false);
                  }}
                />
              </label>

              <label className="field">
                <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>Letter Content (Markdown / Text)</span>
                <textarea
                  rows={14}
                  value={draft.draft.content}
                  disabled={busy}
                  onChange={(e) => {
                    const content = e.target.value;
                    setDraft((curr) => (curr ? { ...curr, draft: { ...curr.draft, content } } : null));
                    setSaved(false);
                  }}
                />
              </label>
            </div>

            <AINotesView content={draft.content} />
          </div>
        )}

        {/* Saved Success Banner */}
        {saved && draft && draft.savedDocuments && draft.savedDocuments.length > 0 && (
          <div className="save-success-banner">
            <p role="status">
              ✓ Saved to this opportunity's documents and Career Docs (Reference).
              {opportunity.outputFolder ? (
                <>
                  {" "}Local folder: <code>{opportunity.outputFolder}</code>
                </>
              ) : null}
            </p>
            <div className="download-actions" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {draft.savedDocuments.map((doc) => (
                <a className="button secondary small" key={doc.id} href={doc.url}>
                  <Download size={13} />
                  Download {doc.name}
                </a>
              ))}
              {googleDocUrl ? (
                <a
                  href={googleDocUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="button secondary small"
                  title="Open this cover letter directly in Google Docs"
                >
                  <ExternalLink size={13} />
                  Open in Google Docs
                </a>
              ) : (
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => {
                    setGoogleExportResult(null);
                    setGoogleModalOpen(true);
                  }}
                  title="Open in Google Drive / Export to Google Docs"
                >
                  <Cloud size={13} />
                  Open in Google Drive
                </button>
              )}
              <a
                href="https://drive.google.com/drive/my-drive"
                target="_blank"
                rel="noreferrer"
                className="button secondary small"
                title="Open Google Drive in browser"
              >
                <ExternalLink size={13} />
                Google Drive
              </a>
              <button
                type="button"
                className="button secondary small"
                onClick={() => void handleOpenLocalFolder()}
              >
                <Folder size={13} />
                Open local folder
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Google Drive & Docs Export Modal */}
      {googleModalOpen && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (!googleExporting) setGoogleModalOpen(false);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Google Drive & Docs"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560 }}
          >
            <div className="modal-heading">
              <div>
                <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Google Drive &amp; Docs</h3>
                <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
                  Cover letter for <strong>{opportunity.company}</strong> — <strong>{opportunity.role}</strong>
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close dialog"
                disabled={Boolean(googleExporting)}
                onClick={() => setGoogleModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            {googleExportResult && (
              <div
                className="alert"
                style={{
                  background: "var(--panel-soft)",
                  border: "1px solid var(--green, #10b981)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  marginBottom: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "var(--green, #10b981)" }}>
                  <Check size={16} />
                  <span>{googleExportResult.message}</span>
                </div>
                {googleExportResult.url && (
                  <div>
                    <a
                      href={googleExportResult.url}
                      target="_blank"
                      rel="noreferrer"
                      className="button primary small"
                    >
                      <ExternalLink size={14} /> Open in Google Docs
                    </a>
                  </div>
                )}
                {googleExportResult.filePath && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
                    <div>Saved to: <code>{googleExportResult.filePath}</code></div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => {
                          void navigator.clipboard?.writeText(googleExportResult.filePath || "");
                          setStatus("Copied local file path to clipboard.");
                        }}
                      >
                        <Copy size={13} /> Copy file path
                      </button>
                      <a
                        href="https://drive.google.com/drive/my-drive"
                        target="_blank"
                        rel="noreferrer"
                        className="button secondary small"
                      >
                        <ExternalLink size={13} /> Open Google Drive
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}

            {googleDocUrl && !googleExportResult && (
              <div
                style={{
                  background: "var(--panel-soft)",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 14,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Google Doc available</div>
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>This cover letter is already exported to Google Docs.</div>
                </div>
                <a
                  href={googleDocUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="button primary small"
                >
                  <ExternalLink size={14} /> Open in Google Docs
                </a>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14 }}>
              {/* Direct API */}
              <div
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  padding: 14,
                  background: "var(--panel-soft)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                      <Cloud size={16} />
                      <span>Direct Google Drive API</span>
                    </div>
                    <span className={`badge ${googleConnected ? "badge-green" : "badge-neutral"}`} style={{ fontSize: "0.7rem", padding: "1px 6px" }}>
                      {googleConnected ? "Connected" : "Not connected"}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)", lineHeight: 1.4 }}>
                    Uploads the cover letter directly to Google Drive and converts it into a native, editable Google Doc.
                  </p>
                </div>
                <button
                  type="button"
                  className="button primary small"
                  disabled={Boolean(googleExporting) || !draft?.savedDocuments?.length}
                  onClick={() => void handleExportGoogle("api")}
                >
                  {googleExporting === "api" ? "Uploading…" : (
                    <>
                      <Cloud size={13} />
                      {googleDocUrl ? "Re-upload to Google Docs" : "Upload to Google Docs"}
                    </>
                  )}
                </button>
              </div>

              {/* Local Copy */}
              <div
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  padding: 14,
                  background: "var(--panel-soft)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, marginBottom: 4 }}>
                    <Folder size={16} />
                    <span>Local Copy (Drive Sync)</span>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)", lineHeight: 1.4 }}>
                    Saves a <code>.docx</code> copy to your exports folder for Google Drive Desktop sync or manual drag-and-drop.
                  </p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={Boolean(googleExporting) || !draft?.savedDocuments?.length}
                    onClick={() => void handleExportGoogle("local")}
                  >
                    {googleExporting === "local" ? "Saving…" : "Save to Google Drive Folder"}
                  </button>
                  <a
                    href="https://drive.google.com/drive/my-drive"
                    target="_blank"
                    rel="noreferrer"
                    className="button secondary small"
                    style={{ textAlign: "center", justifyContent: "center" }}
                  >
                    <ExternalLink size={12} /> Open Google Drive
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </details>
  );
}
