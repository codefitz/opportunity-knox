import { useEffect, useMemo, useState, useRef } from "react";
import {
  Briefcase,
  Copy,
  ClipboardPaste,
  Scissors,
  FileText,
  Folder,
  FolderInput,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  Trash2,
  Pencil,
  Download,
  X,
  Star,
  Mail,
  StickyNote,
  Layers,
} from "lucide-react";
import { api, json } from "../api";
import type { BoardDocument } from "../types";
import DocumentThumbnail from "./DocumentThumbnail";
import categories from "../lib/document-categories";
import "./career-file-manager.css";

function TextThumbnail({ document }: { document: BoardDocument }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(document.url, { signal: controller.signal })
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => setText(t.slice(0, 650)))
      .catch(() => {});
    return () => controller.abort();
  }, [document.url, document.revision]);
  return (
    <span className="career-text-thumbnail" aria-label="Text preview">
      {text || <FileText size={24} />}
    </span>
  );
}

const groups = [
  {
    id: "master-cv",
    label: "Master CV",
    icon: Star,
    categories: ["master-cv"],
  },
  {
    id: "master-cover-letter",
    label: "Master cover letter",
    icon: Mail,
    categories: ["master-cover-letter"],
  },
  {
    id: "cv-template",
    label: "CV templates",
    icon: Layers,
    categories: ["cv-template", "template"],
  },
  {
    id: "cover-letter-template",
    label: "Cover letter templates",
    icon: Mail,
    categories: ["cover-letter-template"],
  },
  {
    id: "project",
    label: "Project files",
    icon: Briefcase,
    categories: ["project"],
  },
  {
    id: "note",
    label: "Note files",
    icon: StickyNote,
    categories: [
      "note",
      "other",
      "job-description",
      "star-story",
      "supporting-statement",
      "reference",
    ],
  },
  {
    id: "reference-cv",
    label: "Reference CVs",
    icon: FileText,
    categories: ["reference-cv", "cv", "tailored-cv"],
  },
  {
    id: "reference-cover",
    label: "Reference covers",
    icon: Mail,
    categories: ["reference-cover", "cover-letter"],
  },
];
const groupOf = (d: BoardDocument) =>
  groups.find((g) => g.categories.includes(d.category || "other")) || groups[5];
const leaf = (d: BoardDocument) => d.name.split("/").pop() || d.name;
const dir = (d: BoardDocument) =>
  d.name.includes("/") ? d.name.slice(0, d.name.lastIndexOf("/")) : "";
const unavailable = (d: BoardDocument) =>
  !!d.storageState && d.storageState !== "available";

export default function CareerFileManager({
  documents,
  onChanged,
  onError,
  onNotice,
}: {
  documents: BoardDocument[];
  onChanged: () => void;
  onError: (e: unknown) => void;
  onNotice: (s: string) => void;
}) {
  const [group, setGroup] = useState(""),
    [search, setSearch] = useState(""),
    [folder, setFolder] = useState<string | null>(null);
  const [view, setView] = useState(
      () => localStorage.getItem("knox-file-view") || "grid",
    ),
    [sort, setSort] = useState("name"),
    [format, setFormat] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [clipboard, setClipboard] = useState<{
      docs: BoardDocument[];
      cut: boolean;
    } | null>(null);
  const [dialog, setDialog] = useState<"rename" | "move" | "delete" | null>(
      null,
    ),
    [value, setValue] = useState(""),
    [category, setCategory] = useState("");
  useEffect(() => {
    setSelected((ids) =>
      ids.filter((id) => documents.some((d) => d.id === id)),
    );
  }, [documents]);
  const modal = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement;
    modal.current?.querySelector<HTMLElement>("input,button")?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = modal.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),input:not(:disabled)",
      );
      if (!items?.length) return;
      const first = items[0],
        last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [dialog]);
  const picked = documents.filter((d) => selected.includes(d.id));
  const visible = useMemo(
    () =>
      documents
        .filter(
          (d) =>
            (group === "missing"
              ? unavailable(d)
              : !unavailable(d) && (!group || groupOf(d).id === group)) &&
            (folder === null || dir(d) === folder) &&
            (!format || d.name.toLowerCase().endsWith("." + format)) &&
            `${d.name} ${d.notes} ${(d.tags || []).join(" ")}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "date"
            ? b.createdAt.localeCompare(a.createdAt)
            : sort === "type"
              ? groupOf(a).label.localeCompare(groupOf(b).label) ||
                a.name.localeCompare(b.name)
              : a.name.localeCompare(b.name),
        ),
    [documents, group, folder, format, search, sort],
  );
  const folders = [
    ...new Set(documents.filter((d) => !unavailable(d)).map(dir)),
  ].sort();
  const canEdit =
    picked.length > 0 && picked.every((d) => d.status !== "submitted");
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function categorise(ids: string[], target: string) {
    const docs = documents.filter((d) => ids.includes(d.id));
    if (!docs.length) return;
    await api(
      "/documents/categories",
      json({
        category: target,
        documents: docs.map((d) => ({ id: d.id, revision: d.revision ?? 1 })),
      }),
    );
  }
  function switchGroup(id: string) {
    setGroup(id);
    setFolder(null);
    setSelected([]);
  }
  async function paste() {
    if (!clipboard) return;
    const destination = folder ?? "";
    if (clipboard.cut) {
      const moved = await api<{ documents: BoardDocument[] }>(
        "/documents/move",
        json({
          folder: destination,
          documents: clipboard.docs.map((d) => ({
            id: d.id,
            revision: d.revision ?? 1,
          })),
        }),
      );
      if (group && group !== "missing")
        await api(
          "/documents/categories",
          json({
            category: group,
            documents: moved.documents.map((d) => ({
              id: d.id,
              revision: d.revision,
            })),
          }),
        );
      setClipboard(null);
    } else {
      for (const d of clipboard.docs) {
        const name =
          (destination ? destination + "/" : "") +
          leaf(d).replace(/(\.[^.]+)?$/, " (copy)$1");
        await api(
          `/documents/${d.id}/duplicate`,
          json({
            revision: d.revision,
            name,
            ...(group && group !== "missing" ? { category: group } : {}),
          }),
        );
      }
    }
    onNotice("Files pasted.");
  }
  return (
    <section
      className="career-files"
      aria-label="Career file manager"
      onKeyDown={(e) => {
        if (
          (e.target as HTMLElement).closest(
            "input:not([type=checkbox]),select,textarea,a",
          )
        )
          return;
        if (
          (e.ctrlKey || e.metaKey) &&
          ["c", "x", "v"].includes(e.key.toLowerCase())
        ) {
          e.preventDefault();
          if (e.key.toLowerCase() === "v") {
            if (!busy && clipboard) void run(paste);
          } else if (
            picked.length &&
            !picked.some(unavailable) &&
            (e.key.toLowerCase() === "c" || canEdit)
          )
            setClipboard({ docs: picked, cut: e.key.toLowerCase() === "x" });
        }
      }}
      tabIndex={0}
    >
      <aside className="career-files-sidebar" aria-label="Document types">
        <button
          className={!group ? "active" : ""}
          onClick={() => switchGroup("")}
        >
          <Folder size={18} />
          All files{" "}
          <span>{documents.filter((d) => !unavailable(d)).length}</span>
        </button>
        {groups.map((g) => (
          <button
            key={g.id}
            className={group === g.id ? "active" : ""}
            onClick={() => switchGroup(g.id)}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("application/x-knox-documents"))
                e.preventDefault();
            }}
            onDrop={(e) => {
              const raw = e.dataTransfer.getData(
                "application/x-knox-documents",
              );
              if (!raw) return;
              e.preventDefault();
              e.stopPropagation();
              void run(async () => {
                await categorise(JSON.parse(raw), g.id);
                switchGroup(g.id);
              });
            }}
          >
            <g.icon size={18} />
            {g.label}
            <span>
              {
                documents.filter(
                  (d) => !unavailable(d) && groupOf(d).id === g.id,
                ).length
              }
            </span>
          </button>
        ))}
        <button
          className={group === "missing" ? "active" : ""}
          onClick={() => switchGroup("missing")}
        >
          <RefreshCw size={18} />
          Needs attention <span>{documents.filter(unavailable).length}</span>
        </button>
      </aside>
      <div className="career-files-main">
        <div className="career-files-toolbar">
          <label className="search-input">
            <Search size={16} />
            <input
              aria-label="Search files"
              placeholder="Search files…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button
            className="button secondary small"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await api<{
                  checked: number;
                  missing: number;
                  changed: number;
                  added: number;
                  unavailable: number;
                }>("/documents/refresh", json({}));
                onNotice(
                  `Storage refreshed · ${r.added} new · ${r.changed} changed · ${r.missing} missing · ${r.unavailable} unavailable`,
                );
              })
            }
          >
            <RefreshCw size={15} className={busy ? "spin" : ""} />
            Refresh storage
          </button>
          <div
            className="library-view-toggle"
            role="group"
            aria-label="File display"
          >
            {["grid", "list"].map((v) => (
              <button
                key={v}
                aria-label={v === "grid" ? "Thumbnails" : "List"}
                aria-pressed={view === v}
                className={view === v ? "active" : ""}
                onClick={() => {
                  setView(v);
                  localStorage.setItem("knox-file-view", v);
                }}
              >
                {v === "grid" ? <LayoutGrid size={17} /> : <List size={17} />}
              </button>
            ))}
          </div>
        </div>
        <div className="career-files-toolbar">
          <strong>
            {group === "missing"
              ? "Needs attention"
              : groups.find((g) => g.id === group)?.label || "All files"}
          </strong>
          <span className="muted">{visible.length} files</span>
          <select
            aria-label="Browse folder"
            value={folder ?? "*"}
            onChange={(e) => {
              setFolder(e.target.value === "*" ? null : e.target.value);
              setSelected([]);
            }}
          >
            <option value="*">All folders</option>
            <option value="">Top level</option>
            {folders.filter(Boolean).map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select
            aria-label="File format"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            <option value="">All formats</option>
            {[
              ...new Set(
                documents.map((d) => d.name.split(".").pop()?.toLowerCase()),
              ),
            ]
              .sort()
              .map((f) => (
                <option key={f} value={f}>
                  {f?.toUpperCase()}
                </option>
              ))}
          </select>
          <select
            aria-label="Sort files"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="name">Name A–Z</option>
            <option value="date">Newest first</option>
            <option value="type">Document type</option>
          </select>
        </div>
        <div className="career-files-actions">
          <label>
            <input
              type="checkbox"
              aria-label="Select visible files"
              checked={
                visible.length > 0 &&
                visible.every((d) => selected.includes(d.id))
              }
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? visible.slice(0, 500).map((d) => d.id)
                    : [],
                )
              }
            />{" "}
            {selected.length ? `${selected.length} selected` : "Select"}
          </label>
          <button
            title="Copy (Ctrl/Cmd+C)"
            disabled={busy || !picked.length || picked.some(unavailable)}
            onClick={() => setClipboard({ docs: picked, cut: false })}
          >
            <Copy size={16} />
            Copy
          </button>
          <button
            title="Cut (Ctrl/Cmd+X)"
            disabled={busy || !canEdit || picked.some(unavailable)}
            onClick={() => setClipboard({ docs: picked, cut: true })}
          >
            <Scissors size={16} />
            Cut
          </button>
          <button
            title="Paste (Ctrl/Cmd+V)"
            disabled={busy || !clipboard || group === "missing"}
            onClick={() => void run(paste)}
          >
            <ClipboardPaste size={16} />
            Paste{clipboard ? ` (${clipboard.docs.length})` : ""}
          </button>
          <button
            disabled={busy || !canEdit || picked.some(unavailable)}
            onClick={() => {
              setValue(folder ?? "");
              setDialog("move");
            }}
          >
            <FolderInput size={16} />
            Move
          </button>
          <button
            disabled={busy || !canEdit || picked.length !== 1}
            onClick={() => {
              setValue(picked[0].name);
              setDialog("rename");
            }}
          >
            <Pencil size={16} />
            Rename
          </button>
          <button
            disabled={busy || !canEdit}
            onClick={() => setDialog("delete")}
          >
            <Trash2 size={16} />
            Delete
          </button>
          {picked.length > 0 && (
            <select
              aria-label="Change selected document type"
              disabled={busy}
              value={category}
              onChange={(e) => {
                const next = e.target.value;
                setCategory(next);
                void run(async () => {
                  await categorise(selected, next);
                  setCategory("");
                });
              }}
            >
              <option value="">Change type…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </div>
        {group === "missing" && (
          <p className="muted">
            Missing files are hidden from the main view. Reconnect unavailable
            storage and refresh. Master and submitted records stay preserved.
          </p>
        )}
        <div
          className={`career-file-items ${view}`}
          aria-label="Files"
          aria-busy={busy}
        >
          {visible.map((d) => {
            const g = groupOf(d),
              chosen = selected.includes(d.id),
              ext = d.name.split(".").pop()?.toUpperCase();
            return (
              <article
                key={d.id}
                className={`career-file ${chosen ? "selected" : ""} type-${g.id}`}
                draggable={!unavailable(d) && d.status !== "submitted"}
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    "application/x-knox-documents",
                    JSON.stringify(chosen ? selected : [d.id]),
                  );
                  e.dataTransfer.effectAllowed = "move";
                }}
              >
                <label className="career-file-check">
                  <input
                    type="checkbox"
                    aria-label={`Select ${leaf(d)}`}
                    checked={chosen}
                    disabled={!chosen && selected.length >= 500}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, d.id]
                          : ids.filter((id) => id !== d.id),
                      )
                    }
                  />
                </label>
                <a
                  className="career-file-preview"
                  href={d.url}
                  aria-label={`Open ${leaf(d)}`}
                  onClick={(e) => {
                    if (unavailable(d)) e.preventDefault();
                  }}
                >
                  {view === "grid" &&
                  /\.(txt|md|markdown|csv)$/i.test(d.name) &&
                  d.size <= 256 * 1024 &&
                  !unavailable(d) ? (
                    <TextThumbnail document={d} />
                  ) : view === "grid" ? (
                    <DocumentThumbnail
                      key={`${d.id}:${d.revision}`}
                      id={d.id}
                      name={d.name}
                      revision={d.revision}
                    />
                  ) : (
                    <g.icon size={26} />
                  )}
                  <span className="career-file-format">{ext}</span>
                </a>
                <div className="career-file-info">
                  <a href={d.url} title={d.name}>
                    {leaf(d)}
                  </a>
                  <span className="career-file-type">
                    <g.icon size={13} />
                    {g.label}
                  </span>
                  <small title={dir(d)}>
                    {dir(d) || "Top level"} ·{" "}
                    {Math.max(1, Math.round(d.size / 1024))} KB
                  </small>
                  {unavailable(d) && <strong>{d.storageState}</strong>}
                  {d.status === "submitted" && (
                    <small>Submitted · preserved</small>
                  )}
                </div>
                <a
                  className="icon-button"
                  href={d.url}
                  download
                  aria-label={`Download ${leaf(d)}`}
                >
                  <Download size={15} />
                </a>
              </article>
            );
          })}
        </div>
        {!visible.length && (
          <div className="career-files-empty">
            <Folder size={34} />
            <p>
              {search || format ? "No matching files" : "No files here yet"}
            </p>
            <small>
              Upload files below, or drag files onto a type to organise them.
            </small>
          </div>
        )}
      </div>
      {dialog && (
        <div className="modal-overlay">
          <section
            ref={modal}
            className="modal career-file-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="career-file-dialog-title"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) setDialog(null);
            }}
          >
            <button
              className="icon-button"
              aria-label="Close"
              disabled={busy}
              onClick={() => setDialog(null)}
            >
              <X size={18} />
            </button>
            <h2 id="career-file-dialog-title">
              {dialog === "delete"
                ? `Delete ${picked.length} file${picked.length === 1 ? "" : "s"}?`
                : dialog === "rename"
                  ? "Rename file"
                  : "Move files"}
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  if (dialog === "delete")
                    for (const d of picked)
                      await api(`/documents/${d.id}`, { method: "DELETE" });
                  if (dialog === "rename")
                    await api(
                      `/documents/${picked[0].id}`,
                      json(
                        { revision: picked[0].revision, name: value },
                        "PATCH",
                      ),
                    );
                  if (dialog === "move")
                    await api(
                      "/documents/move",
                      json({
                        folder: value,
                        documents: picked.map((d) => ({
                          id: d.id,
                          revision: d.revision ?? 1,
                        })),
                      }),
                    );
                  setDialog(null);
                  setSelected([]);
                  onNotice("Files updated.");
                });
              }}
            >
              {dialog === "delete" ? (
                <p>
                  These files will be removed from storage. Keep your Master CV
                  unless you have a replacement.
                </p>
              ) : (
                <label className="field">
                  <span>
                    {dialog === "rename" ? "File name" : "Destination folder"}
                  </span>
                  <input
                    autoFocus
                    required={dialog === "rename"}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Folder / Subfolder"
                  />
                  {dialog === "move" && (
                    <small>
                      Enter an existing or new folder. Leave blank for top
                      level.
                    </small>
                  )}
                </label>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setDialog(null)}
                >
                  Cancel
                </button>
                <button
                  className={`button ${dialog === "delete" ? "danger" : "primary"}`}
                  disabled={busy}
                >
                  {busy
                    ? "Saving…"
                    : dialog === "delete"
                      ? "Delete"
                      : dialog === "rename"
                        ? "Save name"
                        : "Move"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
