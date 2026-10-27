import { useEffect, useRef, useState } from "react";
import { api, json } from "../api";

type Source = {
  id: string;
  name: string;
  readOnly: boolean;
  status: string;
  chunks: number;
};
type Job = {
  id: string;
  status: string;
  items: {
    id: string;
    status: string;
    chunks: number;
    totalChunks?: number;
    error?: string;
  }[];
};
type Status = {
  model: string;
  revision: string;
  dimensions: number;
  sources: Source[];
  job: Job | null;
};
export default function VectorIndex({
  onError,
}: {
  onError: (error: unknown) => void;
}) {
  const [data, setData] = useState<Status | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [notice, setNotice] = useState("");
  const errorRef = useRef(onError);
  errorRef.current = onError;
  async function refresh() {
    try {
      setData(await api<Status>("/buddy/vector-index"));
    } catch (error) {
      errorRef.current(error);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  const active =
    data?.job?.status === "running" || data?.job?.status === "cancelling";
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [active]);
  async function act(body: object | undefined, clear = false) {
    setBusy(true);
    setNotice("");
    try {
      setData(
        await api<Status>(
          "/buddy/vector-index",
          clear ? { method: "DELETE" } : json(body),
        ),
      );
      setNotice(
        clear
          ? "Saved vectors cleared. Original files and prepared text are unchanged."
          : "Indexing status updated.",
      );
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  const sources = data?.sources || [],
    visible = sources.filter((s) =>
      s.name.toLowerCase().includes(query.toLowerCase()),
    ),
    available = new Set(sources.map((s) => s.id));
  const chosen = selected.filter((id) => available.has(id));
  const retry =
    data?.job?.items
      .filter((i) => i.status !== "indexed" && available.has(i.id))
      .map((i) => i.id) || [];
  return (
    <section
      className="settings-section buddy-settings vector-index"
      aria-label="Semantic indexing"
    >
      <div className="settings-section-heading">
        <div>
          <h2>Semantic indexing</h2>
          <p>
            Create local search vectors for the sources you choose. Originals
            stay unchanged. Career Buddy combines meaning-based and keyword
            matches from your selected sources when vectors are available.
          </p>
        </div>
      </div>
      <p>
        {sources.filter((s) => s.status === "indexed").length} of{" "}
        {sources.length} sources indexed · MiniLM · 384 dimensions · Local CPU
      </p>
      <details>
        <summary>Choose sources ({chosen.length} selected)</summary>
        <label className="field">
          Filter sources
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a file"
          />
        </label>
        <div className="library-tool-actions">
          <button
            type="button"
            className="button secondary small"
            onClick={() =>
              setSelected((current) => [
                ...new Set([...current, ...visible.map((s) => s.id)]),
              ])
            }
          >
            Select shown
          </button>
          <button
            type="button"
            className="button secondary small"
            onClick={() => setSelected([])}
          >
            Deselect all
          </button>
        </div>
        <div className="buddy-source-picker">
          {visible.map((source) => (
            <label key={source.id}>
              <input
                type="checkbox"
                checked={chosen.includes(source.id)}
                disabled={active || busy}
                onChange={(e) =>
                  setSelected((current) =>
                    e.target.checked
                      ? [...current, source.id]
                      : current.filter((id) => id !== source.id),
                  )
                }
              />
              <span>
                {source.name}
                {source.readOnly ? " · Read-only source" : ""}
                <small>
                  {" "}
                  · {source.status}
                  {source.chunks ? ` · ${source.chunks} chunks` : ""}
                </small>
              </span>
            </label>
          ))}
        </div>
        {!sources.length && (
          <p>Add library files or select read-only vault sources first.</p>
        )}
      </details>
      <div className="library-tool-actions">
        <button
          type="button"
          className="button primary small"
          disabled={busy || active || !chosen.length}
          onClick={() => void act({ documentIds: chosen })}
        >
          Index selected sources
        </button>
        <button
          type="button"
          className="button secondary small"
          disabled={busy || active || !retry.length}
          onClick={() => void act({ documentIds: retry })}
        >
          Retry unfinished sources
        </button>
        {active && (
          <button
            type="button"
            className="button secondary small"
            disabled={busy || data?.job?.status === "cancelling"}
            onClick={() => void act({ cancel: true })}
          >
            Cancel indexing
          </button>
        )}
        <button
          type="button"
          className="button secondary small"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Refresh status
        </button>
        <button
          type="button"
          className="button secondary small"
          disabled={busy || active}
          onClick={() => void act(undefined, true)}
        >
          Clear vectors
        </button>
      </div>
      <div role="status" aria-live="polite">
        {notice}
        {data?.job && (
          <p>
            Job: {data.job.status} ·{" "}
            {data.job.items.filter((i) => i.status === "indexed").length} /{" "}
            {data.job.items.length} sources completed ·{" "}
            {data.job.items.reduce((sum, i) => sum + i.chunks, 0)} chunks
            processed
            {active
              ? ". Cancellation takes effect after the current batch."
              : ""}
          </p>
        )}
      </div>
      {data?.job && (
        <details>
          <summary>Job details</summary>
          <ul>
            {data.job.items.map((item) => (
              <li key={item.id}>
                {sources.find((s) => s.id === item.id)?.name ||
                  "Removed source"}
                : {item.status} · {item.chunks}
                {item.totalChunks ? ` / ${item.totalChunks}` : ""} chunks
                {item.error ? ` · ${item.error}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="field-hint">
        Uses the built-in local model selected in Settings; external embedding
        providers will follow separately. Re-run indexing after changing files.
        Completed sources are reused when unchanged; cancelled or interrupted
        work waits for you to retry. Removing sources from this job selection
        does not delete their vectors; deselect vault sources in the vault
        source settings, or use Clear vectors above.
      </p>
    </section>
  );
}
