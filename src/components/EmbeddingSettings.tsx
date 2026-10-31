import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Database, LoaderCircle, PlugZap } from "lucide-react";
import { api, json } from "../api";
import type { BuddySettings } from "./CareerBuddySettings";

type EmbeddingSettingsState = BuddySettings & {
  vectorBackend?: string;
  vectorUrl?: string;
  vectorCollection?: string;
  hasVectorKey?: boolean;
  vectorBackends?: Record<string, { name: string; baseUrl: string }>;
};

type EmbeddingModelList = {
  models: { id: string; name: string }[];
  suggested: string;
  truncated: boolean;
};

type EmbeddingTestResult = {
  ok: boolean;
  provider?: string;
  model?: string;
  reportedModel?: string;
  check?: "embedding";
  dimensions: number;
  normalized?: boolean;
  vectorBackend?: string;
  vectorCollection?: string;
  vectorStoreOk?: boolean;
};

const DEFAULT_VECTOR_BACKENDS: Record<
  string,
  { name: string; baseUrl: string }
> = {
  sqlite: { name: "Local SQLite (built-in)", baseUrl: "" },
  qdrant: { name: "Qdrant vector database", baseUrl: "http://localhost:6333" },
  custom: { name: "Custom HTTP vector store", baseUrl: "" },
};

const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Embedding request could not be completed.";

export default function EmbeddingSettings({
  onError,
}: {
  onError: (error: unknown) => void;
}) {
  const [saved, setSaved] = useState<EmbeddingSettingsState | null>(null),
    [form, setForm] = useState<EmbeddingSettingsState | null>(null),
    [key, setKey] = useState(""),
    [clearKey, setClearKey] = useState(false),
    [vectorKey, setVectorKey] = useState(""),
    [clearVectorKey, setClearVectorKey] = useState(false),
    [busy, setBusy] = useState(false),
    [testing, setTesting] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [models, setModels] = useState<EmbeddingModelList["models"]>([]),
    [modelHint, setModelHint] = useState(""),
    [findingModels, setFindingModels] = useState(false),
    [manualModel, setManualModel] = useState(false),
    [keyReady, setKeyReady] = useState(false),
    [refreshModels, setRefreshModels] = useState(0);
  const latest = useRef({
    form,
    key,
    clearKey,
    vectorKey,
    clearVectorKey,
    manualModel,
  });
  latest.current = {
    form,
    key,
    clearKey,
    vectorKey,
    clearVectorKey,
    manualModel,
  };

  async function load() {
    try {
      const result = await api<EmbeddingSettingsState>(
        "/buddy/embedding-settings",
      );
      setSaved(result);
      setForm(result);
      setKey("");
      setClearKey(false);
      setVectorKey("");
      setClearVectorKey(false);
      setKeyReady(false);
      setError("");
    } catch (err) {
      setError(errorText(err));
      onError(err);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setModels([]);
    setModelHint("");
    setFindingModels(false);
    if (!form || form.provider === "builtin") return;
    try {
      const url = new URL(form.baseUrl);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname) return;
    } catch {
      return;
    }
    const canKeepKey =
      Boolean(saved?.hasKey) &&
      saved?.provider === form.provider &&
      saved?.baseUrl === form.baseUrl &&
      !clearKey;
    if (
      (key && !keyReady) ||
      (form.provider === "openai" && !key && !canKeepKey)
    )
      return;
    const controller = new AbortController();
    const draft = {
      revision: form.revision,
      provider: form.provider,
      baseUrl: form.baseUrl,
      model: form.model,
      apiKey: key,
      clearKey,
    };
    const timer = window.setTimeout(async () => {
      setFindingModels(true);
      try {
        const found = await api<EmbeddingModelList>(
          "/buddy/embedding-models",
          {
            ...json(draft),
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        setModels(found.models);
        setModelHint(
          found.models.length
            ? `${found.models.length} embedding model${found.models.length === 1 ? "" : "s"} found${found.truncated ? " (list is incomplete)" : ""}. Choose one or enter an ID manually.`
            : "No embedding models found in the provider list. Enter a model ID manually or install an embedding model.",
        );
        if (
          found.suggested &&
          !latest.current.form?.model &&
          !latest.current.manualModel
        ) {
          setForm((current) =>
            current && !current.model
              ? { ...current, model: found.suggested }
              : current,
          );
          setModelHint(
            `Suggested ${found.suggested}. ${found.models.length} embedding model${found.models.length === 1 ? "" : "s"} found${found.truncated ? " (list is incomplete)" : ""}; you can choose another.`,
          );
        }
      } catch (err) {
        if (!controller.signal.aborted)
          setModelHint(
            errorText(err) + " You can enter an embedding model ID manually.",
          );
      } finally {
        if (!controller.signal.aborted) setFindingModels(false);
      }
    }, 700);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    form?.provider,
    form?.baseUrl,
    form?.revision,
    saved?.hasKey,
    saved?.provider,
    saved?.baseUrl,
    key,
    clearKey,
    keyReady,
    refreshModels,
  ]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const result = await api<EmbeddingSettingsState>(
        "/buddy/embedding-settings",
        json(
          {
            revision: form.revision,
            provider: form.provider,
            model: form.model,
            baseUrl: form.baseUrl,
            apiKey: key,
            clearKey,
            vectorBackend: form.vectorBackend || "sqlite",
            vectorUrl: form.vectorUrl || "",
            vectorCollection: form.vectorCollection || "opportunity_knox_chunks",
            vectorApiKey: vectorKey,
            clearVectorKey,
          },
          "PATCH",
        ),
      );
      setSaved(result);
      setForm(result);
      setKey("");
      setKeyReady(false);
      setClearKey(false);
      setVectorKey("");
      setClearVectorKey(false);
      const backendLabel =
        result.vectorBackend && result.vectorBackend !== "sqlite"
          ? result.vectorBackends?.[result.vectorBackend]?.name ||
            result.vectorBackend
          : "local SQLite";
      setNotice(
        result.provider === "builtin"
          ? `Embedding settings saved. Local MiniLM indexing with ${backendLabel} is ready in the Career Hub.`
          : `Embedding settings saved (${result.model || result.provider} with ${backendLabel}). Saving does not start indexing or send documents.`,
      );
    } catch (err) {
      setError(errorText(err));
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (!form) return;
    setTesting(true);
    setNotice("");
    setError("");
    try {
      const result = await api<EmbeddingTestResult>(
        "/buddy/embedding-test",
        json({
          revision: form.revision,
          provider: form.provider,
          baseUrl: form.baseUrl,
          model: form.model,
          apiKey: key,
          clearKey,
          vectorBackend: form.vectorBackend || "sqlite",
          vectorUrl: form.vectorUrl || "",
          vectorCollection: form.vectorCollection || "opportunity_knox_chunks",
          vectorApiKey: vectorKey,
          clearVectorKey,
        }),
      );
      const current = latest.current;
      if (
        !current.form ||
        current.form.provider !== form.provider ||
        current.form.baseUrl !== form.baseUrl ||
        current.form.model !== form.model ||
        current.form.vectorBackend !== form.vectorBackend ||
        current.form.vectorUrl !== form.vectorUrl ||
        current.form.vectorCollection !== form.vectorCollection ||
        current.form.revision !== form.revision ||
        current.key !== key ||
        current.clearKey !== clearKey ||
        current.vectorKey !== vectorKey ||
        current.clearVectorKey !== clearVectorKey
      ) {
        setNotice(
          "Settings changed during the test. Test again to check the current settings.",
        );
        return;
      }
      const backendSuffix =
        result.vectorBackend && result.vectorBackend !== "sqlite"
          ? ` Vector store ready (${result.vectorBackend}${result.vectorCollection ? `: ${result.vectorCollection}` : ""}).`
          : "";
      if (form.provider === "builtin") {
        setNotice(
          `Local model ready: ${result.dimensions} dimensions.${backendSuffix} Tested with fictional text only.`,
        );
      } else {
        const modelLabel = result.reportedModel || result.model || form.model;
        setNotice(
          `Embedding endpoint ready (${modelLabel}: ${result.dimensions} dimensions${result.normalized ? ", normalized" : ""}).${backendSuffix} Tested with fictional text only; no career documents were sent.`,
        );
      }
    } catch (err) {
      const current = latest.current;
      if (
        !current.form ||
        current.form.provider !== form.provider ||
        current.form.baseUrl !== form.baseUrl ||
        current.form.model !== form.model ||
        current.form.vectorBackend !== form.vectorBackend ||
        current.form.vectorUrl !== form.vectorUrl ||
        current.form.vectorCollection !== form.vectorCollection ||
        current.form.revision !== form.revision ||
        current.key !== key ||
        current.clearKey !== clearKey ||
        current.vectorKey !== vectorKey ||
        current.clearVectorKey !== clearVectorKey
      ) {
        setNotice(
          "Settings changed during the test. Test again to check the current settings.",
        );
      } else {
        setError(errorText(err));
        onError(err);
      }
    } finally {
      setTesting(false);
    }
  }

  if (!form)
    return (
      <section className="settings-section buddy-settings">
        <p>{error || "Loading embedding settings…"}</p>
      </section>
    );
  const sameEndpoint =
    saved?.provider === form.provider && saved?.baseUrl === form.baseUrl;
  const vectorBackends = form.vectorBackends || DEFAULT_VECTOR_BACKENDS;
  const vectorBackend = form.vectorBackend || "sqlite";
  const sameVectorEndpoint =
    (saved?.vectorBackend || "sqlite") === vectorBackend &&
    (saved?.vectorUrl || "") === (form.vectorUrl || "");
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
            Choose an embedding model and optional vector database independently
            of Career Buddy’s chat model.
          </p>
        </div>
        <span className="badge muted">
          {form.provider === "builtin" && vectorBackend === "sqlite"
            ? "Local indexing active"
            : "Custom semantic indexing"}
        </span>
      </div>
      <form onSubmit={save}>
        <div className="form-grid">
          <label className="field">
            <span>Embedding provider</span>
            <select
              value={form.provider}
              disabled={busy || testing}
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
                setKeyReady(false);
                setManualModel(false);
                setClearKey(false);
                setNotice("");
                setError("");
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
                disabled={busy || testing}
                readOnly={form.provider === "openai"}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(e) => {
                  setForm({ ...form, baseUrl: e.target.value });
                  setNotice("");
                  setError("");
                }}
                placeholder="http://your-server:11434"
              />
            </label>
          )}
          <div className="field">
            <label htmlFor="embedding-model-id">Embedding model ID</label>
            {form.provider !== "builtin" && models.length > 0 && !manualModel ? (
              <select
                id="embedding-model-id"
                value={form.model}
                required
                disabled={busy || testing}
                aria-describedby="embedding-model-hint"
                onChange={(e) => {
                  setForm({ ...form, model: e.target.value });
                  setNotice("");
                  setError("");
                }}
              >
                <option value="">Choose an embedding model</option>
                {form.model && !models.some((m) => m.id === form.model) && (
                  <option value={form.model}>
                    {form.model} (entered manually)
                  </option>
                )}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="embedding-model-id"
                value={form.model}
                readOnly={form.provider === "builtin"}
                required
                disabled={busy || testing}
                maxLength={200}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-describedby={
                  form.provider !== "builtin"
                    ? "embedding-model-hint"
                    : undefined
                }
                onChange={(e) => {
                  setForm({ ...form, model: e.target.value });
                  setNotice("");
                  setError("");
                }}
                placeholder="Enter an embedding model ID"
              />
            )}
            {form.provider !== "builtin" && (
              <>
                <small id="embedding-model-hint" aria-live="polite">
                  {findingModels
                    ? "Finding available embedding models…"
                    : modelHint ||
                      "Embedding models are discovered from the configured API; you can also enter an ID manually."}
                </small>
                <div className="buddy-model-actions">
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy || testing}
                    onClick={() => {
                      setKeyReady(true);
                      setRefreshModels((n) => n + 1);
                    }}
                  >
                    Refresh models
                  </button>
                  {models.length > 0 && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy || testing}
                      onClick={() => setManualModel(!manualModel)}
                    >
                      {manualModel
                        ? "Choose from list"
                        : "Enter model ID manually"}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          {form.provider !== "builtin" && (
            <label className="field wide">
              <span>Embedding API key</span>
              <input
                type="password"
                autoComplete="new-password"
                disabled={busy || testing}
                value={key}
                maxLength={4000}
                onBlur={() => setKeyReady(true)}
                onChange={(e) => {
                  setKey(e.target.value);
                  setKeyReady(false);
                  setNotice("");
                  setError("");
                }}
                placeholder={
                  sameEndpoint && saved?.hasKey
                    ? "Stored key retained when blank"
                    : "Optional for Ollama and local servers"
                }
              />
            </label>
          )}
          <label className="field">
            <span>Vector store backend</span>
            <select
              value={vectorBackend}
              disabled={busy || testing}
              onChange={(e) => {
                const nextBackend = e.target.value;
                setForm({
                  ...form,
                  vectorBackend: nextBackend,
                  vectorUrl:
                    nextBackend === "sqlite"
                      ? ""
                      : vectorBackends[nextBackend]?.baseUrl || "",
                  vectorCollection:
                    form.vectorCollection || "opportunity_knox_chunks",
                });
                setVectorKey("");
                setClearVectorKey(false);
                setNotice("");
                setError("");
              }}
            >
              {Object.entries(vectorBackends).map(([id, b]) => (
                <option key={id} value={id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          {vectorBackend !== "sqlite" && (
            <>
              <label className="field wide">
                <span>Vector store URL</span>
                <input
                  value={form.vectorUrl || ""}
                  required
                  disabled={busy || testing}
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={(e) => {
                    setForm({ ...form, vectorUrl: e.target.value });
                    setNotice("");
                    setError("");
                  }}
                  placeholder={
                    vectorBackend === "qdrant"
                      ? "http://localhost:6333"
                      : "http://your-vector-store:8080"
                  }
                />
              </label>
              <label className="field">
                <span>Vector collection name</span>
                <input
                  value={form.vectorCollection || "opportunity_knox_chunks"}
                  required
                  disabled={busy || testing}
                  maxLength={120}
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={(e) => {
                    setForm({ ...form, vectorCollection: e.target.value });
                    setNotice("");
                    setError("");
                  }}
                  placeholder="opportunity_knox_chunks"
                />
              </label>
              <label className="field wide">
                <span>Vector store API key (optional)</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  disabled={busy || testing}
                  value={vectorKey}
                  maxLength={4000}
                  onChange={(e) => {
                    setVectorKey(e.target.value);
                    setNotice("");
                    setError("");
                  }}
                  placeholder={
                    sameVectorEndpoint && saved?.hasVectorKey
                      ? "Stored key retained when blank"
                      : "Optional for local Qdrant or custom vector store"
                  }
                />
              </label>
            </>
          )}
        </div>
        {sameEndpoint && saved?.hasKey && (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={clearKey}
              disabled={busy || testing}
              onChange={(e) => setClearKey(e.target.checked)}
            />
            Remove stored embedding API key
          </label>
        )}
        {vectorBackend !== "sqlite" &&
          sameVectorEndpoint &&
          saved?.hasVectorKey && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={clearVectorKey}
                disabled={busy || testing}
                onChange={(e) => setClearVectorKey(e.target.checked)}
              />
              Remove stored vector store API key
            </label>
          )}
        {form.provider === "builtin" && vectorBackend === "sqlite" && (
          <p className="buddy-muted">
            The bundled MiniLM model and local SQLite vector store run on this
            server without an API key, external database, or network connection.
            No documents are indexed automatically.
          </p>
        )}
        <p className="buddy-muted">
          Saving these settings does not send documents or create an index.
          Model discovery checks the endpoint’s model list, and capability
          testing sends a short fictional phrase to verify embedding output,
          vector dimensions, and optional vector store reachability. Indexing in
          the Career Hub uses the saved embedding provider and vector store
          backend only when you explicitly start an indexing job.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}{" "}
            <button
              type="button"
              className="text-button"
              onClick={() => void load()}
            >
              Reload saved settings
            </button>
          </p>
        )}
        {notice && (
          <p className="inline-notice" role="status">
            <Check size={15} /> {notice}
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy || testing}
            onClick={() => void load()}
          >
            Reload embedding settings
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy || testing}
            onClick={() => void test()}
          >
            {testing ? (
              <>
                <LoaderCircle size={15} className="spin" /> Testing…
              </>
            ) : (
              <>
                <PlugZap size={15} />{" "}
                {form.provider === "builtin" && vectorBackend === "sqlite"
                  ? "Test built-in model"
                  : "Test embedding capability"}
              </>
            )}
          </button>
          <button className="button primary" disabled={busy || testing}>
            {busy ? (
              <>
                <LoaderCircle size={15} className="spin" /> Saving…
              </>
            ) : (
              "Save embedding settings"
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
