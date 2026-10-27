import { useEffect, useState, type FormEvent } from "react";
import { Database, LoaderCircle } from "lucide-react";
import { api, json } from "../api";
import type { BuddySettings } from "./CareerBuddySettings";
export default function EmbeddingSettings({
  onError,
}: {
  onError: (error: unknown) => void;
}) {
  const [saved, setSaved] = useState<BuddySettings | null>(null),
    [form, setForm] = useState<BuddySettings | null>(null),
    [key, setKey] = useState(""),
    [clearKey, setClearKey] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  async function load() {
    try {
      const result = await api<BuddySettings>("/buddy/embedding-settings");
      setSaved(result);
      setForm(result);
      setKey("");
      setClearKey(false);
    } catch (error) {
      onError(error);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await api<BuddySettings>(
        "/buddy/embedding-settings",
        json(
          {
            revision: form.revision,
            provider: form.provider,
            model: form.model,
            baseUrl: form.baseUrl,
            apiKey: key,
            clearKey,
          },
          "PATCH",
        ),
      );
      setSaved(result);
      setForm(result);
      setKey("");
      setClearKey(false);
      setNotice(
        "Embedding settings saved. Semantic indexing is not active yet.",
      );
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  if (!form)
    return (
      <section className="settings-section buddy-settings">
        <p>Loading embedding settings…</p>
      </section>
    );
  const sameEndpoint =
    saved?.provider === form.provider && saved?.baseUrl === form.baseUrl;
  return (
    <section
      className="settings-section buddy-settings"
      id="embedding-settings"
    >
      <div className="settings-section-heading">
        <Database size={24} />
        <div>
          <h2>Semantic search</h2>
          <p>
            Choose an embedding model independently of Career Buddy’s chat
            model.
          </p>
        </div>
        <span className="badge muted">Local indexing available</span>
      </div>
      <form onSubmit={save}>
        <div className="form-grid">
          <label className="field">
            <span>Embedding provider</span>
            <select
              value={form.provider}
              disabled={busy}
              onChange={(e) => {
                const provider = e.target.value;
                setForm({
                  ...form,
                  provider,
                  model:
                    provider === "builtin" ? "Xenova/all-MiniLM-L6-v2" : "",
                  baseUrl: form.providers[provider].baseUrl,
                });
                setKey("");
                setClearKey(false);
                setNotice("");
              }}
            >
              {Object.entries(form.providers).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {form.provider !== "builtin" && (
            <label className="field wide">
              <span>Embedding API base URL</span>
              <input
                value={form.baseUrl}
                required
                disabled={busy}
                readOnly={form.provider === "openai"}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder="http://your-server:11434"
              />
            </label>
          )}
          <label className="field">
            <span>Embedding model ID</span>
            <input
              value={form.model}
              readOnly={form.provider === "builtin"}
              required
              disabled={busy}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="Enter an embedding model ID"
            />
          </label>
          {form.provider !== "builtin" && (
            <label className="field wide">
              <span>Embedding API key</span>
              <input
                type="password"
                autoComplete="new-password"
                disabled={busy}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  sameEndpoint && saved?.hasKey
                    ? "Stored key retained when blank"
                    : "Optional for Ollama and local servers"
                }
              />
            </label>
          )}
        </div>
        {sameEndpoint && saved?.hasKey && (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={clearKey}
              disabled={busy}
              onChange={(e) => setClearKey(e.target.checked)}
            />
            Remove stored embedding API key
          </label>
        )}
        {form.provider === "builtin" && (
          <p className="buddy-muted">
            The bundled MiniLM model runs on this server’s CPU without an API
            key or network connection. No documents are indexed automatically.
          </p>
        )}
        <p className="buddy-muted">
          Saving these settings does not send documents or create an index. With
          external providers, future indexing will send selected text to the
          configured endpoint. External model discovery and connection testing
          are still pending.
        </p>
        <div className="form-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => void load()}
          >
            Reload embedding settings
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <>
                <LoaderCircle size={15} className="spin" /> Saving…
              </>
            ) : (
              "Save embedding settings"
            )}
          </button>
        </div>
        {saved?.provider === "builtin" && form.provider === "builtin" && (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await api<{ dimensions: number }>(
                  "/buddy/embedding-test",
                  json({}),
                );
                setNotice(
                  `Local model ready: ${result.dimensions} dimensions. Tested with fictional text only.`,
                );
              } catch (error) {
                onError(error);
              } finally {
                setBusy(false);
              }
            }}
          >
            Test built-in model
          </button>
        )}
        {notice && (
          <p className="inline-notice" role="status">
            {notice}
          </p>
        )}
      </form>
    </section>
  );
}
