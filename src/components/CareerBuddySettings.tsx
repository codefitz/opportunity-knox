import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bot, Check, LoaderCircle, PlugZap } from "lucide-react";
import { api, json } from "../api";
import "../career-buddy.css";

export type BuddySettings = {
  revision: number;
  enabled: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  outputMode: string;
  hasKey: boolean;
  providers: Record<string, { name: string; baseUrl: string }>;
};
type ModelList = {
  models: { id: string; name: string }[];
  suggested: string;
  truncated: boolean;
};
type ConnectionResult = {
  check: "listing" | "inference";
  count?: number;
  truncated?: boolean;
};
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Career Buddy could not complete the request.";
export default function CareerBuddySettings({
  onError,
  decision = false,
}: {
  onError: (error: unknown) => void;
  decision?: boolean;
}) {
  const [saved, setSaved] = useState<BuddySettings | null>(null),
    [form, setForm] = useState<BuddySettings | null>(null);
  const [key, setKey] = useState(""),
    [clearKey, setClearKey] = useState(false),
    [busy, setBusy] = useState(false),
    [testing, setTesting] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [dirty, setDirty] = useState(false),
    [models, setModels] = useState<ModelList["models"]>([]),
    [modelHint, setModelHint] = useState(""),
    [findingModels, setFindingModels] = useState(false),
    [manualModel, setManualModel] = useState(false),
    [keyReady, setKeyReady] = useState(false),
    [refreshModels, setRefreshModels] = useState(0);
  const latest = useRef({ form, key, clearKey, manualModel });
  latest.current = { form, key, clearKey, manualModel };
  async function load() {
    try {
      const result = await api<BuddySettings>(
        decision ? "/buddy/decision-settings" : "/buddy/settings",
      );
      setSaved(result);
      setForm(result);
      setKey("");
      setClearKey(false);
      setKeyReady(false);
      setDirty(false);
      setError("");
    } catch (error) {
      setError(errorText(error));
      onError(error);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    setModels([]);
    setModelHint("");
    setFindingModels(false);
    if (!form) return;
    try {
      const url = new URL(form.baseUrl);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname) return;
    } catch {
      return;
    }
    const canKeepKey =
      saved?.hasKey &&
      saved.provider === form.provider &&
      saved.baseUrl === form.baseUrl &&
      !clearKey;
    if (
      (key && !keyReady) ||
      (["openai", "anthropic", "gemini"].includes(form.provider) &&
        !key &&
        !canKeepKey)
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
      outputMode: form.outputMode,
    };
    const timer = window.setTimeout(async () => {
      setFindingModels(true);
      try {
        const found = await api<ModelList>(
          decision ? "/buddy/decision-models" : "/buddy/models",
          {
            ...json(draft),
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        setModels(found.models);
        setModelHint(
          found.models.length
            ? `${found.models.length} models found${found.truncated ? " (list is incomplete)" : ""}. Choose one or enter an ID manually.`
            : "No models found. Enter an ID manually or install a model.",
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
          setDirty(true);
          setModelHint(
            `Suggested ${found.suggested}. ${found.models.length} models found${found.truncated ? " (list is incomplete)" : ""}; you can choose another.`,
          );
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setModelHint(
            errorText(error) + " You can enter a model ID manually.",
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
  const update = (patch: Partial<BuddySettings>) => {
    setForm((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
    setNotice("");
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<BuddySettings>(
        decision ? "/buddy/decision-settings" : "/buddy/settings",
        json(
          {
            revision: form.revision,
            enabled: form.enabled,
            provider: form.provider,
            model: form.model,
            baseUrl: form.baseUrl,
            outputMode: form.outputMode,
            apiKey: key,
            clearKey,
          },
          "PATCH",
        ),
      );
      setForm(result);
      setSaved(result);
      setKey("");
      setKeyReady(false);
      setClearKey(false);
      setDirty(false);
      setNotice(
        decision
          ? "Decision model settings saved."
          : "Career Buddy settings saved.",
      );
    } catch (error) {
      setError(errorText(error));
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    if (!form) return;
    setTesting(true);
    setError("");
    setNotice("");
    try {
      const result = await api<ConnectionResult>(
        decision ? "/buddy/decision-test" : "/buddy/test",
        json({
          revision: form.revision,
          provider: form.provider,
          baseUrl: form.baseUrl,
          model: form.model,
          outputMode: form.outputMode,
          apiKey: key,
          clearKey,
        }),
      );
      const current = latest.current;
      if (
        !current.form ||
        current.form.provider !== form.provider ||
        current.form.baseUrl !== form.baseUrl ||
        current.form.model !== form.model ||
        current.form.revision !== form.revision ||
        current.form.outputMode !== form.outputMode ||
        current.key !== key ||
        current.clearKey !== clearKey
      ) {
        setNotice(
          "Settings changed during the test. Test again to check the current settings.",
        );
        return;
      }
      setNotice(
        result.check === "listing"
          ? `Connected successfully. ${result.count} models available${result.truncated ? " in this list" : ""}; no model was run and no career records were sent.`
          : "Connected successfully. A short model test ran; no career records were sent.",
      );
    } catch (error) {
      const current = latest.current;
      if (
        !current.form ||
        current.form.provider !== form.provider ||
        current.form.baseUrl !== form.baseUrl ||
        current.form.model !== form.model ||
        current.form.revision !== form.revision ||
        current.form.outputMode !== form.outputMode ||
        current.key !== key ||
        current.clearKey !== clearKey
      ) {
        setNotice(
          "Settings changed during the test. Test again to check the current settings.",
        );
      } else {
        setError(errorText(error));
        onError(error);
      }
    } finally {
      setTesting(false);
    }
  }
  return (
    <section
      className="settings-section buddy-settings"
      id="career-buddy-settings"
    >
      <div className="settings-section-heading">
        <Bot size={24} />
        <div>
          <h2>{decision ? "Decision model" : "Career Buddy"}</h2>
          <p>
            {decision
              ? "An independently configured model for reviewing opportunities against your saved criteria. Saving does not run an assessment."
              : "Your optional AI partner for opportunities, interviews and application drafts."}
          </p>
        </div>
        <span className={"badge " + (saved?.enabled ? "green" : "muted")}>
          {saved?.enabled ? "Enabled" : "Off"}
        </span>
      </div>
      {!form ? (
        <p>{error || "Loading connection settings…"}</p>
      ) : (
        <form onSubmit={save} data-editing={dirty ? "true" : undefined}>
          <label className="buddy-toggle">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => update({ enabled: event.target.checked })}
            />
            Enable {decision ? "decision model" : "Career Buddy"}
          </label>
          <div className="form-grid">
            <label className="field">
              <span>API provider</span>
              <select
                value={form.provider}
                onChange={(event) => {
                  const provider = event.target.value;
                  update({
                    provider,
                    model: "",
                    baseUrl: form.providers[provider].baseUrl,
                    hasKey: Boolean(
                      saved?.hasKey &&
                      saved.provider === provider &&
                      saved.baseUrl === form.providers[provider].baseUrl,
                    ),
                  });
                  setKey("");
                  setKeyReady(false);
                  setManualModel(false);
                  setClearKey(false);
                }}
              >
                {Object.entries(form.providers).map(([id, provider]) => (
                  <option key={id} value={id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <label htmlFor="buddy-model">Model ID</label>
              {models.length > 0 && !manualModel ? (
                <select
                  id="buddy-model"
                  value={form.model}
                  onChange={(event) => update({ model: event.target.value })}
                >
                  <option value="">Choose a model</option>
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
                  id="buddy-model"
                  value={form.model}
                  maxLength={200}
                  placeholder="Enter a model available to your account"
                  onChange={(event) => update({ model: event.target.value })}
                />
              )}
              <small aria-live="polite">
                {findingModels
                  ? "Finding available models…"
                  : modelHint ||
                    "Models are discovered from the configured API; you can also enter an ID manually. Not every model supports chat."}
              </small>
              <div className="buddy-model-actions">
                <button
                  type="button"
                  className="text-button"
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
                    onClick={() => setManualModel(!manualModel)}
                  >
                    {manualModel
                      ? "Choose from list"
                      : "Enter model ID manually"}
                  </button>
                )}
              </div>
            </div>
            <label className="field wide">
              <span>API base URL</span>
              <input
                value={form.baseUrl}
                readOnly={!["custom", "ollama"].includes(form.provider)}
                onChange={(event) =>
                  update({
                    baseUrl: event.target.value,
                    hasKey: Boolean(
                      saved?.hasKey &&
                      saved.provider === form.provider &&
                      saved.baseUrl === event.target.value,
                    ),
                  })
                }
                placeholder="https://your-api.example/v1"
              />
              <small>
                {form.provider === "ollama"
                  ? "Use a private network URL such as http://your-server:11434, or http://host.docker.internal:11434 for Ollama on this host. The model must already be installed."
                  : form.provider === "custom"
                    ? "An OpenAI-compatible Chat Completions API. Include the base path (for example /v1), without /chat/completions."
                    : "Requests go to the provider’s official API endpoint."}
              </small>
            </label>
            <label className="field wide">
              <span>
                API key{" "}
                {["ollama", "custom"].includes(form.provider)
                  ? "(optional)"
                  : ""}
              </span>
              <input
                type="password"
                autoComplete="new-password"
                value={key}
                maxLength={4000}
                placeholder={
                  form.hasKey && !clearKey
                    ? "A key is stored. Leave blank to keep it."
                    : "Paste your API key"
                }
                onBlur={() => setKeyReady(true)}
                onChange={(event) => {
                  setKey(event.target.value);
                  setKeyReady(false);
                  setDirty(true);
                  setNotice("");
                }}
              />
              <small>
                Kept on your private host and excluded from record exports.
                Private backups include the key. Changing provider clears its
                stored key.
              </small>
            </label>
          </div>
          {form.hasKey && (
            <label className="buddy-toggle">
              <input
                type="checkbox"
                checked={clearKey}
                onChange={(event) => {
                  setClearKey(event.target.checked);
                  setDirty(true);
                }}
              />
              Remove the stored API key when saving
            </label>
          )}
          <details className="buddy-advanced">
            <summary>Compatibility options</summary>
            <label className="field">
              <span>Model output mode</span>
              <select
                value={form.outputMode}
                onChange={(event) => update({ outputMode: event.target.value })}
              >
                <option value="schema">JSON schema (recommended)</option>
                <option value="json">JSON mode</option>
                <option value="prompt">
                  Prompt only (legacy or custom models)
                </option>
              </select>
              <small>
                Use JSON or prompt only if the model rejects schema requests.
                Every proposed change is still validated by the app.
              </small>
            </label>
          </details>
          <p className="buddy-privacy">
            {decision
              ? "Assessments send your criteria, the opportunity and selected evidence to this API. Each result is saved for review; it never changes the opportunity. Unknown facts stay unknown. "
              : ""}
            {!decision && (
              <>
                Chats send this opportunity and the document excerpts you select
                to this API. Career Buddy can suggest changes and create drafts;
                you review them before they are saved. Salary advice uses saved
                information, without live market research.
              </>
            )}
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
            <p className="buddy-success" role="status">
              <Check size={15} />
              {notice}
            </p>
          )}
          <div className="buddy-buttons">
            <button
              className="button primary"
              disabled={busy || testing || !dirty}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Check size={16} />
              )}
              Save {decision ? "decision model" : "Career Buddy"}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => void test()}
              disabled={busy || testing}
            >
              {testing ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <PlugZap size={16} />
              )}
              Test connection
            </button>
            {dirty && (
              <small>
                Test uses the settings shown above, even before saving.
              </small>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
