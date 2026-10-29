import { useEffect, useState } from "react";
import { api, json, ApiError } from "../api";
type Source = {
  id: string;
  name: string;
  revision: number;
  category?: string;
  opportunityId?: string;
  originalUrl?: string;
};
type Preview = {
  id: string;
  pages: number;
  pageTarget: number;
  overTarget: boolean;
  pdfUrl: string;
  wordUrl: string;
  images: string[];
  warnings: string[];
  sourceName: string;
};
export default function DocumentStudio({
  onError,
  onChanged,
  opportunityId,
}: {
  onError: (e: unknown) => void;
  onChanged: () => void;
  opportunityId?: string;
}) {
  const [data, setData] = useState<{
      documents: Source[];
      layouts: { id: string; name: string; description: string }[];
    } | null>(null),
    [sourceId, setSourceId] = useState(""),
    [layout, setLayout] = useState("original"),
    [templateId, setTemplateId] = useState(""),
    [target, setTarget] = useState(2),
    [content, setContent] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [notice, setNotice] = useState("");
  const [renderedSignature, setRenderedSignature] = useState("");
  const signature = JSON.stringify([
    sourceId,
    layout,
    templateId,
    target,
    content,
  ]);
  const stale = Boolean(preview) && renderedSignature !== signature;
  async function load() {
    setData(await api("/document-studio"));
  }
  useEffect(() => {
    void load().catch(onError);
  }, []);
  async function choose(id: string) {
    setSourceId(id);
    setContent("");
    setNotice("");
    if (!id) return;
    setBusy(true);
    try {
      const r = await api<{ content: string; warning: string }>(
        "/document-studio/source/" + id,
      );
      setContent(r.content);
      setNotice(r.warning);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function closePreview() {
    if (preview) {
      try {
        await api("/document-studio/" + preview.id, { method: "DELETE" });
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 404) throw e;
      }
    }
    setPreview(null);
    setReviewed(false);
  }
  async function render() {
    const source = data?.documents.find((d) => d.id === sourceId);
    if (!source) return;
    setBusy(true);
    setNotice("");
    try {
      await closePreview();
      setRenderedSignature(signature);
      setPreview(
        await api(
          "/document-studio/preview",
          json({
            documentId: source.id,
            revision: source.revision,
            layout,
            templateId,
            pageTarget: target,
            ...(layout !== "original" ? { content } : {}),
          }),
        ),
      );
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function save(format: string) {
    if (!preview) return;
    setBusy(true);
    try {
      await api(
        "/document-studio/" + preview.id + "/save",
        json({ confirm: reviewed, format }),
      );
      setNotice(
        "Saved a new " +
          format.toUpperCase() +
          " draft. Review and approve it separately.",
      );
      onChanged();
      await load();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  const source = data?.documents.find((d) => d.id === sourceId);
  return (
    <details className="document-studio">
      <summary>CV and cover-letter layout studio</summary>
      <p>
        Choose a Word draft, apply a built-in layout or keep its existing
        formatting, then inspect every page. Originals and submitted files stay
        unchanged.
      </p>
      <button
        className="button secondary small"
        type="button"
        onClick={() => void load().catch(onError)}
        disabled={busy}
      >
        Refresh documents
      </button>
      <div className="form-grid">
        <label className="field">
          <span>Source Word document</span>
          <select
            value={sourceId}
            disabled={busy}
            onChange={(e) => void choose(e.target.value)}
          >
            <option value="">Choose a document</option>
            {data?.documents
              .filter(
                (d) =>
                  !opportunityId ||
                  d.opportunityId === opportunityId ||
                  !d.opportunityId,
              )
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Layout template</span>
          <select
            value={layout}
            disabled={busy}
            onChange={(e) => setLayout(e.target.value)}
          >
            <option value="original">Keep existing Word layout</option>
            {data?.layouts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
            <option value="custom">Custom marked Word template</option>
          </select>
          <small>
            {data?.layouts.find((l) => l.id === layout)?.description}
          </small>
        </label>
        <label className="field">
          <span>Target pages</span>
          <input
            type="number"
            min={1}
            max={10}
            value={target}
            disabled={busy}
            onChange={(e) => setTarget(Number(e.target.value))}
          />
          <small>
            A review target; no content is automatically cut or shrunk.
          </small>
        </label>
        {layout === "custom" && (
          <label className="field">
            <span>Custom template</span>
            <select
              value={templateId}
              disabled={busy}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">Choose a template</option>
              {data?.documents
                .filter((d) => d.id !== sourceId)
                .sort(
                  (a, b) =>
                    Number(b.category === "template") -
                    Number(a.category === "template"),
                )
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
            <small>
              Upload a DOCX with one paragraph containing only {"{{content}}"}.
              Headers, tables and surrounding template content remain. Content
              inherits the marked paragraph formatting.
            </small>
          </label>
        )}
        {layout !== "original" && (
          <label className="field wide">
            <span>Draft content for this layout</span>
            <textarea
              rows={14}
              maxLength={60000}
              value={content}
              disabled={busy}
              onChange={(e) => setContent(e.target.value)}
            />
            <small>
              Review facts, headings and bullets before rendering. Use Markdown
              headings and bullets with built-in layouts.
            </small>
          </label>
        )}
      </div>
      {source?.originalUrl && (
        <p>
          <a href={source.originalUrl} target="_blank" rel="noreferrer">
            Open original Google Doc
          </a>
        </p>
      )}
      <div className="form-actions">
        {data?.layouts.some((l) => l.id === layout) && (
          <a
            className="button secondary small"
            href={"/api/document-studio/templates/" + layout}
          >
            Download blank template
          </a>
        )}
        <button
          type="button"
          className="button primary small"
          disabled={busy || !sourceId || (layout === "custom" && !templateId)}
          onClick={() => void render()}
        >
          {busy ? "Working…" : "Render page preview"}
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {preview && (
        <section aria-label="Document page preview">
          <h3>
            {preview.sourceName} · {preview.pages}{" "}
            {preview.pages === 1 ? "page" : "pages"} · target{" "}
            {preview.pageTarget}
            {preview.overTarget ? " · Over target" : ""}
          </h3>
          {stale && (
            <p role="status">
              Draft or layout settings changed. Render again before saving.
            </p>
          )}
          {preview.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          <div className="form-actions">
            <a className="button secondary small" href={preview.wordUrl}>
              Download Word
            </a>
            <a
              className="button secondary small"
              href={preview.pdfUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open PDF
            </a>
            <button
              type="button"
              className="button secondary small"
              disabled={busy}
              onClick={() => void closePreview().catch(onError)}
            >
              Close preview
            </button>
          </div>
          <div className="studio-pages">
            {preview.images.map((url, i) => (
              <figure key={url}>
                <img
                  src={url}
                  alt={"Document page " + (i + 1)}
                  loading="lazy"
                />
                <figcaption>
                  Page {i + 1} of {preview.pages}
                </figcaption>
              </figure>
            ))}
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={stale || busy}
              onChange={(e) => setReviewed(e.target.checked)}
            />{" "}
            I have checked the facts and every page of this preview.
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="button primary small"
              disabled={busy || !reviewed || stale}
              onClick={() => void save("docx")}
            >
              Save Word draft
            </button>
            <button
              type="button"
              className="button secondary small"
              disabled={busy || !reviewed || stale}
              onClick={() => void save("pdf")}
            >
              Save PDF draft
            </button>
          </div>
        </section>
      )}
    </details>
  );
}
