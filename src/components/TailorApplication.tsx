import { uploadId } from "../lib/upload-queue";
import { useEffect, useMemo, useState } from "react";
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

type StyleOption = {
  key: string;
  category: "ai" | "template" | "previous";
  id: string;
  name: string;
  description: string;
  badge: string;
  format?: string;
  version?: number;
  revision?: number;
  image?: string;
};

type Draft = {
  id: string;
  requestId: string;
  content: string;
  draft: { kind: string; title: string; content: string };
  editedDraft?: { title: string; content: string };
  artifactBytes?: string | null;
  artifactManifest?: {
    outputDocx: string;
    outputPdf?: string;
    pageCount: number;
    notes?: string;
    layoutCompromises?: string;
  } | null;
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

function getDocumentTitle(name: string): string {
  return String(name || "").split(/[/\\]/).pop() || name;
}

const templates = [
  { id: "classic", name: "Classic", description: "Spacious, single column", image: classic },
  { id: "compact", name: "Compact", description: "Concise, two-page target", image: compact },
  { id: "executive", name: "Executive", description: "Restrained Montserrat", image: executive },
  { id: "it-technical", name: "IT & Technical", description: "Skills matrix and project highlights", image: compact },
  { id: "combination", name: "Combination", description: "Core skills grid and career summary", image: classic },
  { id: "career-change", name: "Career Change", description: "Transferable skills and achievements", image: executive },
];

export function AINotesView({ content }: { content: string }) {
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
  const [libraryTemplates, setLibraryTemplates] = useState<CVStyle[]>([]);
  const [styleId, setStyleId] = useState("");
  const [filterCategory, setFilterCategory] = useState<
    "all" | "templates" | "previous"
  >("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [googleConnected, setGoogleConnected] = useState(false);
  const [editExpanded, setEditExpanded] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");
  const [cover, setCover] = useState(false);
  const [buddyInfo, setBuddyInfo] = useState<BuddyInfo | null>(null);

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const base = `/opportunities/${opportunity.id}/buddy`;

  // Load available styles and templates
  useEffect(() => {
    if (expanded) {
      void api<{
        documents: CVStyle[];
        templates?: CVStyle[];
        googleConnected?: boolean;
      }>("/document-studio/cv-styles")
        .then((r) => {
          setGoogleConnected(Boolean(r.googleConnected));
          const filterGDoc = (d: CVStyle) =>
            Boolean(r.googleConnected) || d.format !== "gdoc";
          setPreviousCVs((r.documents || []).filter(filterGDoc));
          setLibraryTemplates((r.templates || []).filter(filterGDoc));
        })
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

  async function saveDrafts(targetDrafts: Draft[]) {
    setBusy(true);
    setError("");
    const ids: string[] = [];
    try {
      for (const draft of targetDrafts) {
        setStatus(`Saving ${draft.draft.kind === "cv" ? "CV" : "cover letter"} to Word (.docx)…`);
        const result = await api<{ messages: Draft[] }>(
          base + "/draft/" + draft.id,
          json({
            title: draft.draft.title,
            content: draft.draft.content,
            layout: draft.tailoring.layout,
          }),
        );
        const stored = result.messages.find((m) => m.id === draft.id)!;
        const savedDoc = stored.savedDocuments.at(-1)!;
        ids.push(savedDoc.id);
        try {
          await api(
            `/documents/${savedDoc.id}/reference`,
            json({ revision: 1 }),
          );
        } catch {}
        setDrafts((current) =>
          current.map((d) =>
            d.id === draft.id
              ? { ...d, savedDocuments: stored.savedDocuments }
              : d,
          ),
        );
      }
      await onSaved(ids, targetDrafts.some((d) => d.draft.kind === "cover"));
      setSaved(true);
      setStatus("Saved editable Word (.docx) files to this opportunity and Career Docs (Reference).");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save drafts.");
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setError("");
    setSaved(false);
    const completed: Draft[] = [];
    try {
      for (const action of cover ? ["cv", "cover"] : ["cv"]) {
        setStatus(
          action === "cv"
            ? "Selecting source CV and tailoring new draft with AI…"
            : "Drafting cover letter with AI…",
        );
        const id = uploadId();
        setRequestId(id);
        const result = await api<{ messages: Draft[] }>(
          base + "/chat",
          json({
            action,
            requestId: id,
            tailoringGroupId: completed[0]?.requestId || id,
            autoTailor: true,
            passToAi: true,
            templateLayout: completed[0]?.tailoring.layout || layout,
            ...(completed[0]
              ? { sourceCvId: completed[0].tailoring.sourceCvId }
              : {}),
            ...(action === "cv" && styleId
              ? {
                  styleDocumentId: styleId,
                  styleDocumentRevision: (
                    libraryTemplates.find((d) => d.id === styleId) ||
                    previousCVs.find((d) => d.id === styleId)
                  )?.revision,
                }
              : {}),
            documentIds: [],
            includeOtherOpportunities: false,
            message:
              action === "cv"
                ? "Tailor a new complete CV for this opportunity using the best source CV and verified career evidence. " +
                  (customInstructions.trim()
                    ? "Candidate focus instructions: " +
                      customInstructions.trim() +
                      ". "
                    : "") +
                  "Preserve factual history and identity."
                : "Write a concise cover letter for this opportunity using the chosen source CV and verified evidence." +
                  (customInstructions.trim()
                    ? " Candidate focus: " + customInstructions.trim()
                    : ""),
          }),
        );
        const draft = result.messages.find(
          (m) => m.requestId === id && m.draft?.kind === action,
        );
        if (!draft) {
          const explanation = result.messages.find(
            (m) => m.requestId === id && m.draft,
          )?.content;
          throw new Error(
            explanation || "The AI returned no document draft. Please retry.",
          );
        }
        completed.push(draft);
        setDrafts([...completed]);
      }
      // Automatically save drafts when Generate with AI is clicked
      await saveDrafts(completed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not tailor documents.");
      onError(e);
      setBusy(false);
    }
  }

  async function save() {
    await saveDrafts(drafts);
  }

  const aiOption: StyleOption = useMemo(
    () => ({
      key: "ai:auto",
      category: "ai",
      id: "",
      name: "Let AI choose / create",
      description:
        "Analyzes role requirements and automatically designs the most effective ATS-friendly layout for your verified career evidence.",
      badge: "AI Powered",
      format: "Dynamic Layout",
    }),
    [],
  );

  const builtinOptions: StyleOption[] = useMemo(
    () =>
      templates.map((t) => ({
        key: `builtin:${t.id}`,
        category: "template",
        id: t.id,
        name: t.name,
        description: t.description,
        badge: "Template",
        format: "Built-in Preset",
        image: t.image,
      })),
    [],
  );

  const libraryOptions: StyleOption[] = useMemo(
    () =>
      libraryTemplates.map((d) => ({
        key: `template:${d.id}`,
        category: "template",
        id: d.id,
        name: getDocumentTitle(d.name),
        description: `Custom Word template (${d.format.toUpperCase()} · v${d.version}). Headings and margins preserved.`,
        badge: "Template",
        format: d.format.toUpperCase(),
        version: d.version,
        revision: d.revision,
      })),
    [libraryTemplates],
  );

  const previousOptions: StyleOption[] = useMemo(
    () =>
      previousCVs.map((d) => ({
        key: `previous:${d.id}`,
        category: "previous",
        id: d.id,
        name: getDocumentTitle(d.name),
        description: `Previous CV reference (${d.format.toUpperCase()} · v${d.version}). Layout and styling replicated.`,
        badge: "Previous CV",
        format: d.format.toUpperCase(),
        version: d.version,
        revision: d.revision,
      })),
    [previousCVs],
  );

  const allOptions: StyleOption[] = useMemo(
    () => [aiOption, ...builtinOptions, ...libraryOptions, ...previousOptions],
    [aiOption, builtinOptions, libraryOptions, previousOptions],
  );

  const selectedKey = useMemo(() => {
    if (styleId) {
      if (libraryTemplates.some((t) => t.id === styleId)) {
        return `template:${styleId}`;
      }
      return `previous:${styleId}`;
    }
    if (layout && layout !== "auto") {
      return `builtin:${layout}`;
    }
    return "ai:auto";
  }, [styleId, layout, libraryTemplates]);

  const selectedOption: StyleOption = useMemo(() => {
    return (
      allOptions.find((opt) => opt.key === selectedKey) ||
      (styleId
        ? {
            key: `template:${styleId}`,
            category: "template" as const,
            id: styleId,
            name:
              libraryTemplates.find((d) => d.id === styleId)?.name ||
              previousCVs.find((d) => d.id === styleId)?.name ||
              "Custom CV Reference",
            description: "Custom style reference",
            badge: "Reference",
            format: "DOCX",
          }
        : aiOption)
    );
  }, [allOptions, selectedKey, styleId, aiOption, libraryTemplates, previousCVs]);

  const query = searchQuery.trim().toLowerCase();

  const filterMatches = (opt: StyleOption) => {
    if (!query) return true;
    return (
      opt.name.toLowerCase().includes(query) ||
      opt.description.toLowerCase().includes(query) ||
      (opt.format && opt.format.toLowerCase().includes(query))
    );
  };

  const filteredListItems = useMemo(() => {
    let baseList: StyleOption[] = [];
    if (filterCategory === "all") {
      baseList = [...builtinOptions, ...libraryOptions, ...previousOptions];
    } else if (filterCategory === "templates") {
      baseList = [...builtinOptions, ...libraryOptions];
    } else if (filterCategory === "previous") {
      baseList = previousOptions;
    }
    return baseList.filter(filterMatches);
  }, [filterCategory, builtinOptions, libraryOptions, previousOptions, query]);

  function handleSelect(item: StyleOption) {
    if (item.category === "ai") {
      setStyleId("");
      setLayout("auto");
    } else if (item.key.startsWith("builtin:")) {
      setStyleId("");
      setLayout(item.id);
    } else {
      setStyleId(item.id);
      setLayout("auto");
    }
  }

  const canDownloadSelected =
    Boolean(selectedOption.id) || selectedOption.key.startsWith("builtin:");

  function handleDownloadSelected() {
    if (selectedOption.id) {
      window.open(
        `/api/documents/${encodeURIComponent(selectedOption.id)}/content`,
        "_blank",
      );
    } else if (selectedOption.key.startsWith("builtin:")) {
      window.open(
        `/api/document-studio/templates/${encodeURIComponent(selectedOption.id)}`,
        "_blank",
      );
    }
  }

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

          <div className="cv-selector-split">
            {/* Left Pane: Filter and Text Listbox */}
            <div className="cv-list-pane">
              <div className="cv-filter-bar">
                <div
                  className="cv-filter-tabs"
                  role="tablist"
                  aria-label="Style category filter"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={filterCategory === "all"}
                    className={`cv-filter-btn ${
                      filterCategory === "all" ? "active" : ""
                    }`}
                    onClick={() => setFilterCategory("all")}
                  >
                    All ({templates.length + libraryTemplates.length + previousCVs.length})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={filterCategory === "templates"}
                    className={`cv-filter-btn ${
                      filterCategory === "templates" ? "active" : ""
                    }`}
                    onClick={() => setFilterCategory("templates")}
                  >
                    Templates ({templates.length + libraryTemplates.length})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={filterCategory === "previous"}
                    className={`cv-filter-btn ${
                      filterCategory === "previous" ? "active" : ""
                    }`}
                    onClick={() => setFilterCategory("previous")}
                  >
                    Previous CVs ({previousCVs.length})
                  </button>
                </div>
                <input
                  type="search"
                  className="cv-search-input"
                  placeholder="Filter by name or style…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Filter CV styles and templates"
                />
              </div>

              {/* One text list box with AI alternative at top */}
              <div
                className="cv-listbox"
                role="radiogroup"
                aria-label="CV styles and templates"
              >
                <div
                  className={`cv-list-item cv-ai-option ${
                    selectedKey === "ai:auto" ? "selected" : ""
                  }`}
                  onClick={() => handleSelect(aiOption)}
                  role="radio"
                  aria-checked={selectedKey === "ai:auto"}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSelect(aiOption);
                    }
                  }}
                >
                  <input
                    type="radio"
                    name={`template-${opportunity.id}`}
                    checked={selectedKey === "ai:auto"}
                    onChange={() => handleSelect(aiOption)}
                    aria-label="Let AI choose or create a layout"
                  />
                  <div className="cv-item-text">
                    <div className="cv-item-header">
                      <strong className="cv-item-title">✨ Let AI choose / create</strong>
                      <span className="cv-badge cv-badge-ai">AI Automatic</span>
                    </div>
                    <div className="cv-item-meta-row">
                      <span className="cv-item-desc">
                        Auto-selects optimal structure based on this role and ATS requirements
                      </span>
                    </div>
                  </div>
                </div>

                <div className="cv-listbox-divider" role="separator" />

                {filteredListItems.length === 0 ? (
                  <div className="cv-empty-filter">
                    No {filterCategory === "previous" ? "previous CVs" : "templates"} found.
                  </div>
                ) : (
                  filteredListItems.map((item) => {
                    const isSelected = selectedKey === item.key;
                    return (
                      <div
                        key={item.key}
                        className={`cv-list-item ${isSelected ? "selected" : ""}`}
                        onClick={() => handleSelect(item)}
                        role="radio"
                        aria-checked={isSelected}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSelect(item);
                          }
                        }}
                      >
                        <input
                          type="radio"
                          name={`template-${opportunity.id}`}
                          checked={isSelected}
                          onChange={() => handleSelect(item)}
                          aria-label={item.name}
                        />
                        <div className="cv-item-text">
                          <div className="cv-item-header">
                            <strong className="cv-item-title">{item.name}</strong>
                            <span
                              className={`cv-badge ${
                                item.category === "template"
                                  ? "cv-badge-template"
                                  : "cv-badge-previous"
                              }`}
                            >
                              {item.badge}
                            </span>
                          </div>
                          <div className="cv-item-meta-row">
                            <span className="cv-item-desc">{item.description}</span>
                            {item.format && (
                              <span className="cv-item-format">{item.format}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Pane: Large Rendered Preview */}
            <div className="cv-preview-pane" aria-live="polite">
              <div className="cv-preview-header">
                <div className="cv-preview-title-row">
                  <h4 className="cv-preview-title">{selectedOption.name}</h4>
                  <div className="cv-preview-badges">
                    <span
                      className={`cv-badge ${
                        selectedOption.category === "ai"
                          ? "cv-badge-ai"
                          : selectedOption.category === "template"
                          ? "cv-badge-template"
                          : "cv-badge-previous"
                      }`}
                    >
                      {selectedOption.badge}
                    </span>
                    {selectedOption.format && (
                      <span className="cv-badge cv-badge-format">
                        {selectedOption.format}
                      </span>
                    )}
                  </div>
                </div>
                <p className="cv-preview-desc">{selectedOption.description}</p>
              </div>

              <div className="cv-preview-frame">
                {selectedOption.category === "ai" ? (
                  <div className="cv-ai-preview-card">
                    <div className="cv-ai-preview-mockup">
                      <div className="cv-mockup-header">
                        <div className="cv-mockup-line cv-mockup-line-lg" />
                        <div className="cv-mockup-line cv-mockup-line-sm" />
                      </div>
                      <div className="cv-mockup-section">
                        <span className="cv-mockup-sec-title">PROFESSIONAL SUMMARY</span>
                        <div className="cv-mockup-line" />
                        <div className="cv-mockup-line" />
                      </div>
                      <div className="cv-mockup-section">
                        <span className="cv-mockup-sec-title">CORE COMPETENCIES &amp; SKILLS</span>
                        <div className="cv-mockup-grid">
                          <span className="cv-mockup-pill">Role Match</span>
                          <span className="cv-mockup-pill">Verified Facts</span>
                          <span className="cv-mockup-pill">ATS Semantic</span>
                        </div>
                      </div>
                      <div className="cv-mockup-section">
                        <span className="cv-mockup-sec-title">EXPERIENCE &amp; ACHIEVEMENTS</span>
                        <div className="cv-mockup-line" />
                        <div className="cv-mockup-line cv-mockup-line-md" />
                        <div className="cv-mockup-line" />
                      </div>
                    </div>
                    <div className="cv-ai-preview-features">
                      <div className="cv-ai-feat-item">
                        <span className="cv-feat-check">✓</span>
                        <div>
                          <strong>Role-Tailored Structure</strong>
                          <p>
                            Dynamically chooses single or multi-column layout
                            matching the seniority and job description.
                          </p>
                        </div>
                      </div>
                      <div className="cv-ai-feat-item">
                        <span className="cv-feat-check">✓</span>
                        <div>
                          <strong>Evidence Grounded</strong>
                          <p>
                            Strictly preserves your real career history and verified
                            documents — zero fabrication.
                          </p>
                        </div>
                      </div>
                      <div className="cv-ai-feat-item">
                        <span className="cv-feat-check">✓</span>
                        <div>
                          <strong>Word &amp; ATS Compatible</strong>
                          <p>
                            Generates clean, parseable Word headings and standard
                            formatting for applicant tracking systems.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : selectedOption.image ? (
                  <img
                    src={selectedOption.image}
                    alt={`${selectedOption.name} layout preview`}
                    className="cv-large-preview-img"
                  />
                ) : (
                  <DocumentThumbnail
                    key={`${selectedOption.id}:${selectedOption.revision || 1}`}
                    id={selectedOption.id}
                    name={selectedOption.name}
                    revision={selectedOption.revision || 1}
                    className="cv-large-preview-img"
                  />
                )}
              </div>

              <div className="cv-preview-status">
                <span className="cv-status-check">✓</span>
                <span>
                  Selected for tailoring: <strong>{selectedOption.name}</strong>
                </span>
              </div>
            </div>
          </div>
        </fieldset>

        {/* Step 2: Tailored CV / draft editor (tucked away, collapsed by default) */}
        <details
          className="tailored-cv-expander"
          open={editExpanded}
          onToggle={(e) => {
            if (e.target === e.currentTarget) setEditExpanded(e.currentTarget.open);
          }}
        >
          <summary className="tailored-expander-summary">
            <span>
              {drafts.length > 0
                ? "Review & edit tailored drafts"
                : "Edit tailored content & instructions before generating"}
            </span>
            {drafts.length > 0 && (
              <span className="tailor-draft-badge">
                {drafts.length} {drafts.length === 1 ? "draft ready" : "drafts ready"}
              </span>
            )}
          </summary>

          <div className="tailored-expander-content">
            {drafts.length === 0 ? (
              <div className="pre-generate-guidance">
                <label className="field">
                  <span>Tailoring focus or specific instructions for AI (optional)</span>
                  <textarea
                    placeholder="e.g. Emphasize cloud architecture and system performance; highlight recent achievements in cross-functional leadership..."
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                    rows={3}
                  />
                </label>
              </div>
            ) : (
              drafts.map((d) => (
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

                  {d.artifactManifest && (
                    <div className="artifact-banner" role="status">
                      <div className="artifact-banner-badge">
                        ✨ High-Fidelity Word Artifact
                      </div>
                      <div className="artifact-banner-text">
                        <strong>
                          Multi-column layout, sidebar and typography preserved from reference
                        </strong>
                        {d.artifactManifest.pageCount > 0 && (
                          <span> · {d.artifactManifest.pageCount} {d.artifactManifest.pageCount === 1 ? "page" : "pages"}</span>
                        )}
                        {d.artifactManifest.notes && (
                          <p className="artifact-banner-notes">{d.artifactManifest.notes}</p>
                        )}
                        {d.artifactManifest.layoutCompromises && (
                          <p className="artifact-banner-compromises">
                            ⚠ Layout notes: {d.artifactManifest.layoutCompromises}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

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

                    {!d.artifactBytes ? (
                      <label className="field">
                        <span>
                          Edit {d.draft.kind === "cv" ? "CV content" : "Cover letter content"}{" "}
                          (Markdown)
                        </span>
                        <textarea
                          rows={14}
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
                    ) : (
                      <div className="artifact-saved-preview">
                        <p className="artifact-preview-desc">
                          Word package generated directly. Exact sidebars, table cells, and document structure are preserved.
                        </p>
                        {d.savedDocuments && d.savedDocuments.length > 0 && (
                          <div className="artifact-preview-actions">
                            <a
                              href={d.savedDocuments[0].url}
                              className="button secondary"
                              download={d.savedDocuments[0].name}
                            >
                              Download {d.savedDocuments[0].name}
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              ))
            )}
          </div>
        </details>

        {/* Step 3: Actions (Use/Download, Generate, Save) */}
        <div className="tailor-action-bar">
          <div className="tailor-buttons-row">
            <button
              type="button"
              className="button secondary"
              disabled={!canDownloadSelected}
              title={
                canDownloadSelected
                  ? "Download selected template or CV file"
                  : "Select a template or previous CV to download"
              }
              onClick={handleDownloadSelected}
            >
              Use this CV/Template (Download)
            </button>

            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => void generate()}
            >
              {busy ? "Generating with AI…" : "Generate with AI"}
            </button>

            {drafts.length > 0 && (
              <button
                type="button"
                className="button primary save-button"
                disabled={
                  busy ||
                  drafts.some(
                    (d) => !d.draft.title.trim() || !d.draft.content.trim(),
                  )
                }
                title="Save to Opportunity Documents and Career Docs (Reference)"
                onClick={() => void save()}
              >
                {busy
                  ? "Saving…"
                  : saved
                    ? "✓ Saved to Career Docs (Reference)"
                    : "Save to Career Docs (Reference)"}
              </button>
            )}
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              title="Open or reveal the local folder where this opportunity's CV and cover letter files are stored"
              onClick={async () => {
                try {
                  const res = await api<{
                    ok: boolean;
                    folderPath: string;
                    openedOnHost: boolean;
                    message: string;
                  }>(`/opportunities/${encodeURIComponent(opportunity.id)}/open-folder`, json({}));
                  if (!res.openedOnHost && navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(res.folderPath).catch(() => {});
                  }
                  setStatus(
                    res.openedOnHost
                      ? res.message
                      : `${res.message} (Path copied to clipboard)`,
                  );
                } catch (e) {
                  onError(e);
                }
              }}
            >
              Open local folder
            </button>
          </div>

          <label className="check-label cover-checkbox">
            <input
              type="checkbox"
              checked={cover}
              disabled={busy}
              onChange={(e) => setCover(e.target.checked)}
            />
            <span>Include a cover letter</span>
          </label>
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

        {saved && drafts.length > 0 && (
          <div className="save-success-banner">
            <p role="status">
              ✓ Saved to this opportunity's documents and Career Docs (Reference).
              {opportunity.outputFolder ? (
                <>
                  {" "}Local folder: <code>{opportunity.outputFolder}</code>
                </>
              ) : null}
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
              <button
                type="button"
                className="button secondary small"
                onClick={async () => {
                  try {
                    const res = await api<{
                      ok: boolean;
                      folderPath: string;
                      openedOnHost: boolean;
                      message: string;
                    }>(`/opportunities/${encodeURIComponent(opportunity.id)}/open-folder`, json({}));
                    if (!res.openedOnHost && navigator.clipboard?.writeText) {
                      await navigator.clipboard.writeText(res.folderPath).catch(() => {});
                    }
                    setStatus(
                      res.openedOnHost
                        ? res.message
                        : `${res.message} (Path copied to clipboard)`,
                    );
                  } catch (e) {
                    onError(e);
                  }
                }}
              >
                Open local folder
              </button>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
