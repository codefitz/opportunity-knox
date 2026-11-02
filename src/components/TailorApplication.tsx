import { useEffect, useState } from "react";
import { api, json } from "../api";
import type { Opportunity } from "../types";
import DocumentThumbnail from "./DocumentThumbnail";
import AIRequestProgress from "./AIRequestProgress";

const classic = new URL("../assets/templates/classic.png", import.meta.url).href;
const compact = new URL("../assets/templates/compact.png", import.meta.url).href;
const executive = new URL("../assets/templates/executive.png", import.meta.url).href;

type CVStyle = {
  id: string;
  name: string;
  revision: number;
  version: number;
  thumbnailUrl: string;
  reusable: boolean;
  format: string;
};

type Draft = {
  id: string;
  requestId: string;
  content: string;
  draft: { kind: string; title: string; content: string };
  editedDraft?: { title: string; content: string };
  tailoring: {
    styleDocumentId?: string;
    styleDocumentRevision?: number;
    styleDocumentName?: string;
    groupId?: string;
    sourceCvId: string;
    sourceCvName: string;
    layout: string;
  };
  savedDocuments: { id: string; name: string; url: string }[];
};

type BuddyInfo = {
  enabled: boolean;
  provider: string;
  model: string;
  providerName: string;
};

const templates = [
  { id: "classic", name: "Classic", description: "Spacious, single column", image: classic },
  { id: "compact", name: "Compact", description: "Concise, two-page target", image: compact },
  { id: "executive", name: "Executive", description: "Restrained Montserrat", image: executive },
];

function AINotesView({ content }: { content: string }) {
  if (!content.trim()) return null;

  const sections: { title: string; kind: "strengths" | "gaps" | "focus" | "general"; lines: string[] }[] = [];
  const lines = content.split("\n");
  let currentSection: { title: string; kind: "strengths" | "gaps" | "focus" | "general"; lines: string[] } = {
    title: "AI Analysis & Notes",
    kind: "general",
    lines: [],
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("###") || line.startsWith("##")) {
      if (currentSection.lines.length > 0 || currentSection.title !== "AI Analysis & Notes") {
        sections.push(currentSection);
      }
      const title = line.replace(/^#+\s*/, "");
      const lower = title.toLowerCase();
      const kind = lower.includes("gap") || lower.includes("missing")
        ? "gaps"
        : lower.includes("strength") || lower.includes("match")
        ? "strengths"
        : lower.includes("focus") || lower.includes("tailor") || lower.includes("strategy")
        ? "focus"
        : "general";
      currentSection = { title, kind, lines: [] };
    } else if (line) {
      currentSection.lines.push(line);
    }
  }
  if (currentSection.lines.length > 0 || sections.length === 0) {
    sections.push(currentSection);
  }

  return (
    <div className="ai-notes-panel" aria-label="AI Notes and Evidence">
      <div className="ai-notes-header">
        <strong>AI Analysis &amp; JD Match</strong>
      </div>
      <div className="ai-notes-content">
        {sections.map((sec, idx) => (
          <div key={idx} className={`ai-notes-section ai-notes-${sec.kind}`}>
            <h5 className={`section-title section-title-${sec.kind}`}>
              {sec.kind === "strengths" && <span className="section-icon">✓</span>}
              {sec.kind === "gaps" && <span className="section-icon">⚠</span>}
              {sec.kind === "focus" && <span className="section-icon">🎯</span>}
              {sec.title}
            </h5>
            {sec.lines.some((l) => l.startsWith("-") || l.startsWith("*")) ? (
              <ul>
                {sec.lines.map((l, lIdx) => (
                  <li key={lIdx}>{l.replace(/^[-*]\s*/, "")}</li>
                ))}
              </ul>
            ) : (
              sec.lines.map((l, lIdx) => <p key={lIdx}>{l}</p>)
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TailorApplication({
  opportunity,
  onSaved,
  onError,
}: {
  opportunity: Opportunity;
  onSaved: (ids: string[], cover: boolean) => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [layout, setLayout] = useState("auto");
  const [expanded, setExpanded] = useState(true);
  const [previousCVs, setPreviousCVs] = useState<CVStyle[]>([]);
  const [styleId, setStyleId] = useState("");
  const [cvQuery, setCVQuery] = useState("");
  const [shown, setShown] = useState(12);

  const [passToAi, setPassToAi] = useState(true);
  const [cover, setCover] = useState(false);
  const [buddyInfo, setBuddyInfo] = useState<BuddyInfo | null>(null);

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const base = `/opportunities/${opportunity.id}/buddy`;

  // Load available styles
  useEffect(() => {
    if (expanded) {
      void api<{ documents: CVStyle[] }>("/document-studio/cv-styles")
        .then((r) => setPreviousCVs(r.documents))
        .catch(onError);
    }
  }, [expanded, opportunity.revision]);

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

  // Restore previous drafts for this opportunity
  useEffect(() => {
    let live = true;
    void api<{ messages: Draft[] }>(base)
      .then((result) => {
        if (!live) return;
        const tailored = result.messages.filter(
          (m) => m.tailoring?.groupId && m.draft?.kind !== "none",
        );
        const group = tailored.at(-1)?.tailoring.groupId;
        if (group) {
          const restored = tailored
            .filter((m) => m.tailoring.groupId === group)
            .map((m) => ({
              ...m,
              draft: m.editedDraft ? { ...m.draft, ...m.editedDraft } : m.draft,
            }));
          setDrafts(restored);
          setLayout(restored[0].tailoring.layout);
          setStyleId(restored[0].tailoring.styleDocumentId || "");
          setCover(restored.some((m) => m.draft.kind === "cover"));
          setStatus("Restored existing drafts. Review or edit before saving.");
        }
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [opportunity.id]);

  async function generate() {
    setBusy(true);
    setError("");
    setSaved(false);
    const completed: Draft[] = [];
    try {
      for (const action of cover ? ["cv", "cover"] : ["cv"]) {
        setStatus(
          action === "cv"
            ? passToAi
              ? "Selecting source CV and tailoring new draft with AI…"
              : "Preparing initial draft from source CV…"
            : "Drafting cover letter…",
        );
        const id = crypto.randomUUID();
        setRequestId(id);
        const result = await api<{ messages: Draft[] }>(
          base + "/chat",
          json({
            action,
            requestId: id,
            tailoringGroupId: completed[0]?.requestId || id,
            autoTailor: true,
            passToAi,
            templateLayout: completed[0]?.tailoring.layout || layout,
            ...(completed[0]
              ? { sourceCvId: completed[0].tailoring.sourceCvId }
              : {}),
            ...(action === "cv" && styleId
              ? {
                  styleDocumentId: styleId,
                  styleDocumentRevision: previousCVs.find((d) => d.id === styleId)
                    ?.revision,
                }
              : {}),
            documentIds: [],
            includeOtherOpportunities: false,
            message:
              action === "cv"
                ? "Tailor a new complete CV for this opportunity using the best source CV and verified career evidence. Preserve factual history and identity."
                : "Write a concise cover letter for this opportunity using the chosen source CV and verified evidence.",
          }),
        );
        const draft = result.messages.find(
          (m) => m.requestId === id && m.draft?.kind === action,
        );
        if (!draft)
          throw new Error(
            "Did not return a complete document. Check Career Buddy for details before retrying.",
          );
        completed.push(draft);
        setDrafts([...completed]);
      }
      setStatus("Drafts ready for review. Make any edits before saving to Word.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not tailor documents.");
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    const ids: string[] = [];
    try {
      for (const draft of drafts) {
        const result = await api<{ messages: Draft[] }>(
          base + "/draft/" + draft.id,
          json({
            title: draft.draft.title,
            content: draft.draft.content,
            layout: draft.tailoring.layout,
          }),
        );
        const stored = result.messages.find((m) => m.id === draft.id)!;
        ids.push(stored.savedDocuments.at(-1)!.id);
        setDrafts((current) =>
          current.map((d) =>
            d.id === draft.id
              ? { ...d, savedDocuments: stored.savedDocuments }
              : d,
          ),
        );
      }
      await onSaved(ids, drafts.some((d) => d.draft.kind === "cover"));
      setSaved(true);
      setStatus("Saved editable Word (.docx) files to this opportunity.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save drafts.");
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  const matchingCVs = previousCVs.filter((d) =>
    d.name.toLowerCase().includes(cvQuery.toLowerCase()),
  );

  return (
    <details
      className="tailor-application"
      open={expanded}
      onToggle={(e) => {
        if (e.target === e.currentTarget) setExpanded(e.currentTarget.open);
      }}
    >
      <summary className="tailor-summary">
        <span>Tailor a new CV</span>
        {busy && <span className="tailor-working-pill">Working…</span>}
      </summary>

      <div className="tailor-flow-container">
        {/* Step 1: Choose a style */}
        <fieldset disabled={busy} className="cv-style-choices">
          <legend className="cv-section-legend">Choose a style reference</legend>

          <div className="cv-style-subgroup">
            <h4 className="cv-subgroup-title">Templates</h4>
            <div className="cv-style-strip" aria-label="CV templates" tabIndex={0}>
              <label
                className={`template-option template-auto ${
                  !styleId && layout === "auto" ? "selected" : ""
                }`}
              >
                <input
                  type="radio"
                  name={`template-${opportunity.id}`}
                  checked={!styleId && layout === "auto"}
                  onChange={() => {
                    setStyleId("");
                    setLayout("auto");
                  }}
                />
                <strong>Let AI choose</strong>
                <span>Match a layout to your CV and this role</span>
              </label>
              {templates.map((t) => (
                <label
                  key={t.id}
                  className={`template-option ${
                    !styleId && layout === t.id ? "selected" : ""
                  }`}
                >
                  <img
                    src={t.image}
                    alt={`${t.name} CV layout preview`}
                  />
                  <span>
                    <input
                      type="radio"
                      name={`template-${opportunity.id}`}
                      checked={!styleId && layout === t.id}
                      onChange={() => {
                        setStyleId("");
                        setLayout(t.id);
                      }}
                    />{" "}
                    <strong>{t.name}</strong>
                  </span>
                  <small>{t.description}</small>
                </label>
              ))}
            </div>
          </div>

          {previousCVs.length > 0 && (
            <div className="cv-style-subgroup">
              <div className="cv-subgroup-header">
                <h4 className="cv-subgroup-title">Previous CVs</h4>
                {previousCVs.length > 3 && (
                  <input
                    type="search"
                    className="cv-search-input"
                    value={cvQuery}
                    onChange={(e) => {
                      setCVQuery(e.target.value);
                      setShown(12);
                    }}
                    placeholder="Search previous CVs…"
                  />
                )}
              </div>
              <div
                className="cv-style-strip"
                aria-label="Previous CV styles"
                tabIndex={0}
              >
                {matchingCVs.slice(0, shown).map((d) => (
                  <label
                    key={d.id}
                    className={`template-option previous-cv-option ${
                      styleId === d.id ? "selected" : ""
                    }`}
                  >
                    {expanded && (
                      <DocumentThumbnail
                        key={`${d.id}:${d.revision}`}
                        id={d.id}
                        name={d.name}
                        revision={d.revision}
                      />
                    )}
                    <span>
                      <input
                        type="radio"
                        name={`template-${opportunity.id}`}
                        checked={styleId === d.id}
                        onChange={() => {
                          setStyleId(d.id);
                          setLayout("auto");
                        }}
                      />{" "}
                      <strong>{d.name}</strong>
                    </span>
                    <small>
                      {d.format.toUpperCase()} · v{d.version}
                    </small>
                  </label>
                ))}
                {matchingCVs.length > shown && (
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => setShown((v) => v + 12)}
                  >
                    More CVs
                  </button>
                )}
              </div>
            </div>
          )}

          {styleId && (
            <div className="selected-style-indicator">
              Selected style:{" "}
              <strong>
                {previousCVs.find((d) => d.id === styleId)?.name || "Previous CV"}
              </strong>
            </div>
          )}
        </fieldset>

        {/* Step 2: Generation Options */}
        <div className="cv-generation-options">
          <label className="check-label">
            <input
              type="checkbox"
              checked={passToAi}
              disabled={busy}
              onChange={(e) => setPassToAi(e.target.checked)}
            />
            <span>
              <strong>Pass generation to AI</strong>
              {buddyInfo && (
                <span className="cv-ai-badge">
                  {buddyInfo.provider === "codex"
                    ? "Codex (host CLI)"
                    : buddyInfo.providerName}
                  {buddyInfo.model && buddyInfo.model !== "default"
                    ? ` · ${buddyInfo.model}`
                    : ""}
                </span>
              )}
            </span>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={cover}
              disabled={busy}
              onChange={(e) => setCover(e.target.checked)}
            />
            <span>Include a cover letter</span>
          </label>
        </div>

        {/* Step 3: Action Button positioned under CV style selection & options */}
        <div className="tailor-action-bar">
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() => void generate()}
          >
            {busy
              ? "Working…"
              : drafts.length
              ? "Tailor a fresh version"
              : passToAi
              ? "Tailor CV with AI"
              : "Create document draft"}
          </button>
        </div>

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

        {/* Step 4: Review and Edit Drafts */}
        {drafts.map((d) => (
          <section className="tailored-draft" key={d.id}>
            <div className="tailored-draft-header">
              <h4>{d.draft.kind === "cv" ? "Tailored CV" : "Cover Letter"}</h4>
              <span className="tailored-draft-meta">
                Source: {d.tailoring.sourceCvName} · Layout:{" "}
                {d.draft.kind === "cover"
                  ? "Letter"
                  : d.tailoring.styleDocumentName || d.tailoring.layout}
              </span>
            </div>

            {d.content && <AINotesView content={d.content} />}

            <div className="draft-editor-fields">
              <label className="field">
                <span>Document title</span>
                <input
                  disabled={busy || saved}
                  value={d.draft.title}
                  maxLength={200}
                  onChange={(e) =>
                    setDrafts((current) =>
                      current.map((x) =>
                        x.id === d.id
                          ? { ...x, draft: { ...x.draft, title: e.target.value } }
                          : x,
                      ),
                    )
                  }
                />
              </label>

              <label className="field">
                <span>
                  Edit {d.draft.kind === "cv" ? "CV content" : "Cover letter content"}{" "}
                  (Markdown)
                </span>
                <textarea
                  rows={16}
                  disabled={busy || saved}
                  value={d.draft.content}
                  maxLength={60000}
                  onChange={(e) =>
                    setDrafts((current) =>
                      current.map((x) =>
                        x.id === d.id
                          ? { ...x, draft: { ...x.draft, content: e.target.value } }
                          : x,
                      ),
                    )
                  }
                />
              </label>
            </div>
          </section>
        ))}

        {/* Step 5: Save as Word documents card */}
        {drafts.length > 0 && (
          <div className="save-drafts-card">
            <h4>Save as Word documents (.docx)</h4>
            <p>
              Saves your tailored {drafts.length > 1 ? "CV and cover letter" : "CV"}{" "}
              as editable Word (.docx) documents in this opportunity's documents
              list and attaches them to this application pack.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="button primary"
                disabled={
                  busy ||
                  drafts.some(
                    (d) => !d.draft.title.trim() || !d.draft.content.trim(),
                  )
                }
                onClick={() => void save()}
              >
                {busy
                  ? "Saving Word files…"
                  : "Save to Opportunity Documents (.docx)"}
              </button>
            </div>

            {saved && (
              <div className="save-success-banner">
                <p role="status">
                  ✓ Saved to this opportunity's documents. You can download the
                  editable Word files below.
                </p>
                <div className="download-actions">
                  {drafts
                    .flatMap((d) => d.savedDocuments)
                    .map((doc) => (
                      <a
                        className="button secondary small"
                        key={doc.id}
                        href={doc.url}
                      >
                        Download {doc.name}
                      </a>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
