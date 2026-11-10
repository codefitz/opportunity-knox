import { useState, useRef } from "react";
import { api, json } from "../api";
import {
  Columns,
  Type,
  Palette,
  Save,
  Download,
  Plus,
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Image as ImageIcon,
  Check,
  X,
  FileText,
  Sliders,
  ExternalLink,
  LoaderCircle,
} from "lucide-react";

export interface TemplateBlock {
  id: string;
  type: "header" | "summary" | "experience" | "education" | "skills" | "custom_text" | "image";
  column: number; // 0, 1, or 2
  title?: string;
  content?: string;
  items?: Array<{
    title: string;
    subtitle: string;
    date: string;
    bullets: string[];
  }>;
  imageUrl?: string;
  imageWidth?: number;
  imageAlignment?: "left" | "center" | "right";
}

export interface TemplateDefinition {
  id: string;
  title: string;
  layout: "1-column" | "2-column-left-sidebar" | "2-column-right-sidebar" | "3-column";
  margins: "narrow" | "standard" | "spacious";
  pageBg: string;
  sidebarBg: string;
  fontFamily: "Calibri" | "Arial" | "Georgia" | "Garamond" | "Inter" | "Montserrat";
  fontSize: "compact" | "standard" | "large";
  accentColor: string;
  blocks: TemplateBlock[];
}

const DEFAULT_BLOCKS: TemplateBlock[] = [
  {
    id: "block-header",
    type: "header",
    column: 0,
    title: "Alex Morgan",
    content: "London, UK • alex.morgan@example.com • +44 7700 900077 • linkedin.com/in/alexmorgan",
  },
  {
    id: "block-summary",
    type: "summary",
    column: 0,
    title: "Professional Summary",
    content:
      "Accomplished Software Engineer with over 7 years of experience designing resilient distributed systems and intuitive user interfaces. Proven track record leading agile cross-functional teams to deliver secure, scalable cloud architectures.",
  },
  {
    id: "block-skills",
    type: "skills",
    column: 0,
    title: "Core Competencies",
    content: "TypeScript, React, Node.js, Python, PostgreSQL, AWS, Docker, Microservices, CI/CD, System Design",
  },
  {
    id: "block-experience",
    type: "experience",
    column: 0,
    title: "Work Experience",
    items: [
      {
        title: "Senior Software Engineer",
        subtitle: "Nexus Tech Solutions",
        date: "2022 - Present",
        bullets: [
          "Led development of real-time event pipeline serving 1.2M daily events with 99.98% uptime.",
          "Spearheaded adoption of modular frontend architecture, reducing initial bundle size by 38%.",
          "Mentored 6 junior engineers and established peer code review standards.",
        ],
      },
      {
        title: "Software Engineer",
        subtitle: "Apex Digital Systems",
        date: "2019 - 2022",
        bullets: [
          "Built full-stack workflow automation tools saving customer support over 20 hours per week.",
          "Collaborated with product managers to deliver 14 high-impact feature releases on schedule.",
        ],
      },
    ],
  },
  {
    id: "block-education",
    type: "education",
    column: 0,
    title: "Education",
    items: [
      {
        title: "BSc (Hons) Computer Science",
        subtitle: "University of Bristol",
        date: "2015 - 2018",
        bullets: ["First Class Honours • Dissertation on Distributed Consensus Algorithms"],
      },
    ],
  },
];

export default function TemplateBuilder({
  initialTemplate,
  onClose,
  onSaved,
  onError,
  onNotice,
}: {
  initialTemplate?: Partial<TemplateDefinition>;
  onClose: () => void;
  onSaved?: (doc: any) => void;
  onError: (err: unknown) => void;
  onNotice?: (msg: string) => void;
}) {
  const [template, setTemplate] = useState<TemplateDefinition>(() => ({
    id: initialTemplate?.id || `template-${Date.now()}`,
    title: initialTemplate?.title || "Modern Professional CV",
    layout: initialTemplate?.layout || "2-column-left-sidebar",
    margins: initialTemplate?.margins || "standard",
    pageBg: initialTemplate?.pageBg || "#ffffff",
    sidebarBg: initialTemplate?.sidebarBg || "#f1f5f9",
    fontFamily: initialTemplate?.fontFamily || "Calibri",
    fontSize: initialTemplate?.fontSize || "standard",
    accentColor: initialTemplate?.accentColor || "#2e7d32",
    blocks:
      initialTemplate?.blocks && initialTemplate.blocks.length > 0
        ? initialTemplate.blocks
        : DEFAULT_BLOCKS.map((b) => ({
            ...b,
            column:
              initialTemplate?.layout === "2-column-left-sidebar"
                ? b.type === "skills" || b.type === "education"
                  ? 0
                  : 1
                : 0,
          })),
  }));

  const [saving, setSaving] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false);
  const [showStyleInspector, setShowStyleInspector] = useState(false);
  const [activeColumnForAdd, setActiveColumnForAdd] = useState<number>(0);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetBlockId, setUploadTargetBlockId] = useState<string | null>(null);

  // Layout switcher
  function handleLayoutChange(layout: TemplateDefinition["layout"]) {
    setTemplate((current) => {
      let updatedBlocks = [...current.blocks];
      if (layout === "1-column") {
        updatedBlocks = updatedBlocks.map((b) => ({ ...b, column: 0 }));
      } else if (layout === "2-column-left-sidebar") {
        updatedBlocks = updatedBlocks.map((b) => ({
          ...b,
          column: b.type === "skills" || b.type === "education" || b.type === "image" ? 0 : 1,
        }));
      } else if (layout === "2-column-right-sidebar") {
        updatedBlocks = updatedBlocks.map((b) => ({
          ...b,
          column: b.type === "skills" || b.type === "education" || b.type === "image" ? 1 : 0,
        }));
      } else if (layout === "3-column") {
        updatedBlocks = updatedBlocks.map((b) => ({
          ...b,
          column: b.type === "skills" ? 0 : b.type === "education" ? 2 : 1,
        }));
      }
      return { ...current, layout, blocks: updatedBlocks };
    });
  }

  // Block manipulation
  function updateBlock(id: string, updates: Partial<TemplateBlock>) {
    setTemplate((t) => ({
      ...t,
      blocks: t.blocks.map((b) => (b.id === id ? { ...b, ...updates } : b)),
    }));
  }

  function deleteBlock(id: string) {
    setTemplate((t) => ({
      ...t,
      blocks: t.blocks.filter((b) => b.id !== id),
    }));
  }

  function moveBlock(id: string, direction: "up" | "down") {
    setTemplate((t) => {
      const block = t.blocks.find((b) => b.id === id);
      if (!block) return t;
      const colBlocks = t.blocks.filter((b) => b.column === block.column);
      const idx = colBlocks.findIndex((b) => b.id === id);
      if (idx === -1) return t;
      if (direction === "up" && idx === 0) return t;
      if (direction === "down" && idx === colBlocks.length - 1) return t;

      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      const otherBlock = colBlocks[targetIdx];

      const globalIdxA = t.blocks.indexOf(block);
      const globalIdxB = t.blocks.indexOf(otherBlock);

      const copy = [...t.blocks];
      copy[globalIdxA] = otherBlock;
      copy[globalIdxB] = block;

      return { ...t, blocks: copy };
    });
  }

  function addBlock(type: TemplateBlock["type"], targetColumn: number) {
    const id = `block-${Date.now()}`;
    let newBlock: TemplateBlock;

    switch (type) {
      case "header":
        newBlock = {
          id,
          type,
          column: targetColumn,
          title: "Full Name",
          content: "Location • email@example.com • phone",
        };
        break;
      case "summary":
        newBlock = {
          id,
          type,
          column: targetColumn,
          title: "Professional Summary",
          content: "Enter your summary or key strengths here.",
        };
        break;
      case "skills":
        newBlock = {
          id,
          type,
          column: targetColumn,
          title: "Skills",
          content: "Skill 1, Skill 2, Skill 3",
        };
        break;
      case "experience":
        newBlock = {
          id,
          type,
          column: targetColumn,
          title: "Experience",
          items: [
            {
              title: "Job Title",
              subtitle: "Company Name",
              date: "2023 - Present",
              bullets: ["Key achievement or responsibility"],
            },
          ],
        };
        break;
      case "education":
        newBlock = {
          id,
          type,
          column: targetColumn,
          title: "Education",
          items: [
            {
              title: "Degree or Certification",
              subtitle: "Institution",
              date: "2020",
              bullets: ["Honours or key focus area"],
            },
          ],
        };
        break;
      case "image":
        newBlock = {
          id,
          type,
          column: targetColumn,
          title: "Profile Photo",
          imageWidth: 120,
          imageAlignment: "center",
        };
        break;
      case "custom_text":
      default:
        newBlock = {
          id,
          type: "custom_text",
          column: targetColumn,
          title: "Section Title",
          content: "Add your custom section content here.",
        };
        break;
    }

    setTemplate((t) => ({ ...t, blocks: [...t.blocks, newBlock] }));
    setShowAddMenu(false);
  }

  // Save to Career Docs
  async function handleSaveTemplate() {
    setSaving(true);
    try {
      const res = await api<{ ok: boolean; document: any }>(
        "/document-studio/templates/save",
        json({
          template,
          category: "cv-template",
        }),
      );
      onNotice?.(`Saved template "${template.title}" to Career Docs.`);
      onSaved?.(res.document);
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  }

  // Export as Word (.docx)
  async function handleExportDocx() {
    setExportingDocx(true);
    try {
      const response = await fetch("/api/document-studio/templates/export-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template }),
      });
      if (!response.ok) throw new Error("Failed to export template as Word document.");
      const blob = await response.blob();
      const filename = `${template.title.replace(/[^a-zA-Z0-9_-]/g, "_")}.docx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onNotice?.(`Downloaded ${filename}`);
    } catch (err) {
      onError(err);
    } finally {
      setExportingDocx(false);
    }
  }

  // Image Upload handler
  function triggerImageUpload(blockId: string) {
    setUploadTargetBlockId(blockId);
    fileInputRef.current?.click();
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uploadTargetBlockId) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      updateBlock(uploadTargetBlockId, { imageUrl: dataUrl });
      setUploadTargetBlockId(null);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  // Drag and drop handlers
  function handleDragStart(id: string) {
    setDraggedBlockId(id);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleDrop(targetColumn: number, targetBlockId?: string) {
    if (!draggedBlockId) return;
    setTemplate((t) => {
      const dragged = t.blocks.find((b) => b.id === draggedBlockId);
      if (!dragged) return t;

      const withoutDragged = t.blocks.filter((b) => b.id !== draggedBlockId);
      const updatedDragged = { ...dragged, column: targetColumn };

      if (!targetBlockId) {
        return { ...t, blocks: [...withoutDragged, updatedDragged] };
      }

      const targetIdx = withoutDragged.findIndex((b) => b.id === targetBlockId);
      if (targetIdx === -1) {
        return { ...t, blocks: [...withoutDragged, updatedDragged] };
      }

      const copy = [...withoutDragged];
      copy.splice(targetIdx, 0, updatedDragged);
      return { ...t, blocks: copy };
    });
    setDraggedBlockId(null);
  }

  // Column helpers
  const numColumns =
    template.layout === "3-column" ? 3 : template.layout === "1-column" ? 1 : 2;

  const isLeftSidebar = template.layout === "2-column-left-sidebar";
  const isRightSidebar = template.layout === "2-column-right-sidebar";

  return (
    <div className="template-builder-root">
      {/* Hidden file input for image uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFileSelected}
      />

      {/* Builder Top Bar */}
      <header className="template-builder-header">
        <div className="template-builder-title-group">
          <button
            type="button"
            className="button secondary small"
            onClick={onClose}
            title="Return to Document Studio"
          >
            ← Studio
          </button>
          <input
            type="text"
            className="template-name-input"
            value={template.title}
            onChange={(e) => setTemplate((t) => ({ ...t, title: e.target.value }))}
            placeholder="Template name…"
          />
        </div>

        {/* Layout Presets */}
        <div className="template-layout-presets">
          <button
            type="button"
            className={`preset-btn ${template.layout === "1-column" ? "active" : ""}`}
            onClick={() => handleLayoutChange("1-column")}
            title="Single column linear layout"
          >
            1 Column
          </button>
          <button
            type="button"
            className={`preset-btn ${template.layout === "2-column-left-sidebar" ? "active" : ""}`}
            onClick={() => handleLayoutChange("2-column-left-sidebar")}
            title="Left sidebar with right main body"
          >
            Left Sidebar
          </button>
          <button
            type="button"
            className={`preset-btn ${template.layout === "2-column-right-sidebar" ? "active" : ""}`}
            onClick={() => handleLayoutChange("2-column-right-sidebar")}
            title="Right sidebar with left main body"
          >
            Right Sidebar
          </button>
          <button
            type="button"
            className={`preset-btn ${template.layout === "3-column" ? "active" : ""}`}
            onClick={() => handleLayoutChange("3-column")}
            title="Executive 3-column layout"
          >
            3 Columns
          </button>
        </div>

        {/* Action Controls */}
        <div className="template-builder-actions">
          <button
            type="button"
            className={`button secondary small ${showStyleInspector ? "active" : ""}`}
            onClick={() => setShowStyleInspector(!showStyleInspector)}
            title="Customize fonts, colors, and margins"
          >
            <Sliders size={14} />
            <span>Style</span>
          </button>
          <button
            type="button"
            className="button secondary small"
            disabled={exportingDocx}
            onClick={() => void handleExportDocx()}
            title="Export directly to Microsoft Word (.docx)"
          >
            {exportingDocx ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Download size={14} />
            )}
            <span>Export Word</span>
          </button>
          <button
            type="button"
            className="button primary small"
            disabled={saving}
            onClick={() => void handleSaveTemplate()}
            title="Save as reusable template in Career Docs"
          >
            {saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}
            <span>Save to Career Docs</span>
          </button>
        </div>
      </header>

      {/* Style Inspector Bar */}
      {showStyleInspector && (
        <div className="template-style-inspector">
          <div className="inspector-field">
            <label>Margins</label>
            <select
              value={template.margins}
              onChange={(e) =>
                setTemplate((t) => ({ ...t, margins: e.target.value as any }))
              }
            >
              <option value="narrow">Narrow (0.5 in)</option>
              <option value="standard">Standard (0.75 in)</option>
              <option value="spacious">Spacious (1.0 in)</option>
            </select>
          </div>

          <div className="inspector-field">
            <label>Font Family</label>
            <select
              value={template.fontFamily}
              onChange={(e) =>
                setTemplate((t) => ({ ...t, fontFamily: e.target.value as any }))
              }
            >
              <option value="Calibri">Calibri</option>
              <option value="Arial">Arial</option>
              <option value="Georgia">Georgia</option>
              <option value="Garamond">Garamond</option>
              <option value="Inter">Inter</option>
              <option value="Montserrat">Montserrat</option>
            </select>
          </div>

          <div className="inspector-field">
            <label>Font Size</label>
            <select
              value={template.fontSize}
              onChange={(e) =>
                setTemplate((t) => ({ ...t, fontSize: e.target.value as any }))
              }
            >
              <option value="compact">Compact (9.5pt)</option>
              <option value="standard">Standard (11pt)</option>
              <option value="large">Spacious (12pt)</option>
            </select>
          </div>

          <div className="inspector-field">
            <label>Accent Colour</label>
            <div className="color-picker-wrap">
              <input
                type="color"
                value={template.accentColor}
                onChange={(e) =>
                  setTemplate((t) => ({ ...t, accentColor: e.target.value }))
                }
              />
              <span>{template.accentColor}</span>
            </div>
          </div>

          {numColumns > 1 && (
            <div className="inspector-field">
              <label>Sidebar Colour</label>
              <div className="color-picker-wrap">
                <input
                  type="color"
                  value={template.sidebarBg}
                  onChange={(e) =>
                    setTemplate((t) => ({ ...t, sidebarBg: e.target.value }))
                  }
                />
                <span>{template.sidebarBg}</span>
              </div>
            </div>
          )}

          <div className="inspector-field">
            <label>Page Background</label>
            <div className="color-picker-wrap">
              <input
                type="color"
                value={template.pageBg}
                onChange={(e) =>
                  setTemplate((t) => ({ ...t, pageBg: e.target.value }))
                }
              />
              <span>{template.pageBg}</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Canvas Area */}
      <div className="template-canvas-viewport">
        <div
          className={`template-page-sheet ${template.margins}`}
          style={{
            backgroundColor: template.pageBg,
            fontFamily: template.fontFamily,
          }}
        >
          <div
            className={`template-grid-container layout-${template.layout}`}
            style={{
              gap: template.margins === "narrow" ? "16px" : "24px",
            }}
          >
            {Array.from({ length: numColumns }).map((_, colIdx) => {
              const isSidebarCol =
                (isLeftSidebar && colIdx === 0) ||
                (isRightSidebar && colIdx === 1);

              const colBlocks = template.blocks.filter((b) => b.column === colIdx);

              return (
                <div
                  key={colIdx}
                  className={`template-column col-${colIdx} ${isSidebarCol ? "is-sidebar" : "is-main"}`}
                  style={{
                    backgroundColor: isSidebarCol ? template.sidebarBg : "transparent",
                    padding: isSidebarCol ? "18px 16px" : "8px 0",
                    borderRadius: isSidebarCol ? "6px" : "0",
                  }}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(colIdx)}
                >
                  {colBlocks.map((block) => (
                    <div
                      key={block.id}
                      className="template-block-card"
                      draggable
                      onDragStart={() => handleDragStart(block.id)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => {
                        e.stopPropagation();
                        handleDrop(colIdx, block.id);
                      }}
                    >
                      {/* Block Controls Bar */}
                      <div className="block-toolbar">
                        <div className="drag-handle" title="Drag to reposition">
                          <GripVertical size={13} />
                          <span className="block-type-tag">{block.type}</span>
                        </div>
                        <div className="block-actions">
                          <button
                            type="button"
                            onClick={() => moveBlock(block.id, "up")}
                            title="Move up"
                          >
                            <ChevronUp size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveBlock(block.id, "down")}
                            title="Move down"
                          >
                            <ChevronDown size={13} />
                          </button>
                          <button
                            type="button"
                            className="danger-btn"
                            onClick={() => deleteBlock(block.id)}
                            title="Remove section"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      {/* Block In-place Content Rendering */}
                      <div className="block-content-body">
                        {/* Title Field */}
                        {block.type !== "image" && (
                          <input
                            type="text"
                            className="block-title-input"
                            style={{ color: template.accentColor }}
                            value={block.title || ""}
                            onChange={(e) =>
                              updateBlock(block.id, { title: e.target.value })
                            }
                            placeholder="Section Title…"
                          />
                        )}

                        {/* Block Type specifics */}
                        {block.type === "header" && (
                          <textarea
                            className="block-text-input block-subtitle"
                            rows={2}
                            value={block.content || ""}
                            onChange={(e) =>
                              updateBlock(block.id, { content: e.target.value })
                            }
                            placeholder="Contact details, phone, email, links…"
                          />
                        )}

                        {(block.type === "summary" || block.type === "custom_text") && (
                          <textarea
                            className="block-text-input"
                            rows={4}
                            value={block.content || ""}
                            onChange={(e) =>
                              updateBlock(block.id, { content: e.target.value })
                            }
                            placeholder="Enter paragraph text…"
                          />
                        )}

                        {block.type === "skills" && (
                          <textarea
                            className="block-text-input"
                            rows={3}
                            value={block.content || ""}
                            onChange={(e) =>
                              updateBlock(block.id, { content: e.target.value })
                            }
                            placeholder="Skills separated by commas or lines…"
                          />
                        )}

                        {(block.type === "experience" || block.type === "education") && (
                          <div className="block-items-list">
                            {(block.items || []).map((item, itemIdx) => (
                              <div key={itemIdx} className="block-sub-item">
                                <div className="sub-item-header">
                                  <input
                                    type="text"
                                    className="sub-item-title"
                                    value={item.title}
                                    placeholder="Role or Degree"
                                    onChange={(e) => {
                                      const updatedItems = [...(block.items || [])];
                                      updatedItems[itemIdx] = {
                                        ...item,
                                        title: e.target.value,
                                      };
                                      updateBlock(block.id, { items: updatedItems });
                                    }}
                                  />
                                  <input
                                    type="text"
                                    className="sub-item-date"
                                    value={item.date}
                                    placeholder="Dates"
                                    onChange={(e) => {
                                      const updatedItems = [...(block.items || [])];
                                      updatedItems[itemIdx] = {
                                        ...item,
                                        date: e.target.value,
                                      };
                                      updateBlock(block.id, { items: updatedItems });
                                    }}
                                  />
                                </div>
                                <input
                                  type="text"
                                  className="sub-item-subtitle"
                                  value={item.subtitle}
                                  placeholder="Company or Institution"
                                  onChange={(e) => {
                                    const updatedItems = [...(block.items || [])];
                                    updatedItems[itemIdx] = {
                                      ...item,
                                      subtitle: e.target.value,
                                    };
                                    updateBlock(block.id, { items: updatedItems });
                                  }}
                                />
                                <div className="sub-item-bullets">
                                  {(item.bullets || []).map((bullet, bIdx) => (
                                    <div key={bIdx} className="bullet-row">
                                      <span>•</span>
                                      <input
                                        type="text"
                                        className="bullet-input"
                                        value={bullet}
                                        placeholder="Bullet point achievement…"
                                        onChange={(e) => {
                                          const updatedBullets = [...item.bullets];
                                          updatedBullets[bIdx] = e.target.value;
                                          const updatedItems = [...(block.items || [])];
                                          updatedItems[itemIdx] = {
                                            ...item,
                                            bullets: updatedBullets,
                                          };
                                          updateBlock(block.id, { items: updatedItems });
                                        }}
                                      />
                                      <button
                                        type="button"
                                        className="bullet-del-btn"
                                        onClick={() => {
                                          const updatedBullets = item.bullets.filter(
                                            (_, i) => i !== bIdx,
                                          );
                                          const updatedItems = [...(block.items || [])];
                                          updatedItems[itemIdx] = {
                                            ...item,
                                            bullets: updatedBullets,
                                          };
                                          updateBlock(block.id, { items: updatedItems });
                                        }}
                                      >
                                        ×
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    type="button"
                                    className="add-bullet-btn"
                                    onClick={() => {
                                      const updatedBullets = [
                                        ...(item.bullets || []),
                                        "",
                                      ];
                                      const updatedItems = [...(block.items || [])];
                                      updatedItems[itemIdx] = {
                                        ...item,
                                        bullets: updatedBullets,
                                      };
                                      updateBlock(block.id, { items: updatedItems });
                                    }}
                                  >
                                    + Add bullet
                                  </button>
                                </div>
                              </div>
                            ))}
                            <button
                              type="button"
                              className="button secondary small add-item-btn"
                              onClick={() => {
                                const newItem = {
                                  title: "New Role",
                                  subtitle: "Company",
                                  date: "2024",
                                  bullets: ["Achievement description"],
                                };
                                updateBlock(block.id, {
                                  items: [...(block.items || []), newItem],
                                });
                              }}
                            >
                              + Add {block.type === "experience" ? "Role" : "Degree"}
                            </button>
                          </div>
                        )}

                        {block.type === "image" && (
                          <div className="block-image-controls">
                            {block.imageUrl ? (
                              <div
                                className={`image-preview-wrap align-${block.imageAlignment || "center"}`}
                              >
                                <img
                                  src={block.imageUrl}
                                  alt="Block"
                                  style={{ width: `${block.imageWidth || 120}px` }}
                                />
                                <div className="image-edit-bar">
                                  <button
                                    type="button"
                                    className="button secondary small"
                                    onClick={() => triggerImageUpload(block.id)}
                                  >
                                    Change image
                                  </button>
                                  <label className="width-slider-label">
                                    <span>Size:</span>
                                    <input
                                      type="range"
                                      min={60}
                                      max={250}
                                      value={block.imageWidth || 120}
                                      onChange={(e) =>
                                        updateBlock(block.id, {
                                          imageWidth: Number(e.target.value),
                                        })
                                      }
                                    />
                                  </label>
                                </div>
                              </div>
                            ) : (
                              <div
                                className="image-empty-placeholder"
                                onClick={() => triggerImageUpload(block.id)}
                              >
                                <ImageIcon size={28} className="text-muted" />
                                <span>Click to upload image or photo</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Add Block button inside column */}
                  <div className="add-block-col-footer">
                    <button
                      type="button"
                      className="add-block-trigger-btn"
                      onClick={() => {
                        setActiveColumnForAdd(colIdx);
                        setShowAddMenu(true);
                      }}
                    >
                      <Plus size={14} />
                      <span>Add block to column {colIdx + 1}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Add Block Modal / Dropdown */}
      {showAddMenu && (
        <div
          className="add-block-backdrop"
          onClick={() => setShowAddMenu(false)}
        >
          <div
            className="add-block-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="add-block-header">
              <strong>Add Content Block (Col {activeColumnForAdd + 1})</strong>
              <button
                type="button"
                className="close-btn"
                onClick={() => setShowAddMenu(false)}
              >
                <X size={15} />
              </button>
            </div>
            <div className="add-block-grid">
              <button
                type="button"
                className="add-block-option"
                onClick={() => addBlock("header", activeColumnForAdd)}
              >
                <Type size={18} />
                <div>
                  <strong>Header / Contact</strong>
                  <small>Candidate name and contact details</small>
                </div>
              </button>
              <button
                type="button"
                className="add-block-option"
                onClick={() => addBlock("summary", activeColumnForAdd)}
              >
                <FileText size={18} />
                <div>
                  <strong>Summary / Profile</strong>
                  <small>Professional overview and strengths</small>
                </div>
              </button>
              <button
                type="button"
                className="add-block-option"
                onClick={() => addBlock("experience", activeColumnForAdd)}
              >
                <Columns size={18} />
                <div>
                  <strong>Work Experience</strong>
                  <small>Chronological job roles and accomplishments</small>
                </div>
              </button>
              <button
                type="button"
                className="add-block-option"
                onClick={() => addBlock("skills", activeColumnForAdd)}
              >
                <Check size={18} />
                <div>
                  <strong>Skills / Competencies</strong>
                  <small>Technical and functional skill lists</small>
                </div>
              </button>
              <button
                type="button"
                className="add-block-option"
                onClick={() => addBlock("education", activeColumnForAdd)}
              >
                <FileText size={18} />
                <div>
                  <strong>Education & Degrees</strong>
                  <small>Degrees, certifications, and institutions</small>
                </div>
              </button>
              <button
                type="button"
                className="add-block-option"
                onClick={() => addBlock("image", activeColumnForAdd)}
              >
                <ImageIcon size={18} />
                <div>
                  <strong>Image / Photo</strong>
                  <small>Profile portrait, logo, or signature</small>
                </div>
              </button>
              <button
                type="button"
                className="add-block-option"
                onClick={() => addBlock("custom_text", activeColumnForAdd)}
              >
                <Type size={18} />
                <div>
                  <strong>Custom Text Box</strong>
                  <small>Arbitrary heading and narrative paragraph</small>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
