import { useEffect, useState, type FormEvent } from "react";
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
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Career Buddy could not complete the request.";
export default function CareerBuddySettings({
  onError,
}: {
  onError: (error: unknown) => void;
}) {
  const [saved, setSaved] = useState<BuddySettings | null>(null),
    [form, setForm] = useState<BuddySettings | null>(null);
  const [key, setKey] = useState(""),
    [clearKey, setClearKey] = useState(false),
    [busy, setBusy] = useState(false),
    [testing, setTesting] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  async function load() {
    try {
      const result = await api<BuddySettings>("/buddy/settings");
      setSaved(result);
      setForm(result);
      setKey("");
      setClearKey(false);
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
        "/buddy/settings",
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
      setClearKey(false);
      setDirty(false);
      setNotice("Career Buddy settings saved.");
    } catch (error) {
      setError(errorText(error));
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setTesting(true);
    setError("");
    setNotice("");
    try {
      await api("/buddy/test", json({}));
      setNotice(
        "Connected successfully. No career records were sent for this test.",
      );
    } catch (error) {
      setError(errorText(error));
      onError(error);
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
          <h2>Career Buddy</h2>
          <p>
            Your optional AI partner for opportunities, interviews and
            application drafts.
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
            Enable Career Buddy
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
                    hasKey: false,
                  });
                  setKey("");
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
            <label className="field">
              <span>Model ID</span>
              <input
                value={form.model}
                maxLength={200}
                placeholder="Enter a model available to your account"
                onChange={(event) => update({ model: event.target.value })}
              />
              <small>
                Use the exact API model ID or an installed Ollama model name.
              </small>
            </label>
            <label className="field wide">
              <span>API base URL</span>
              <input
                value={form.baseUrl}
                readOnly={!["custom", "ollama"].includes(form.provider)}
                onChange={(event) => update({ baseUrl: event.target.value })}
                placeholder="https://your-api.example/v1"
              />
              <small>
                {form.provider === "ollama"
                  ? "For Ollama on the Docker host use http://host.docker.internal:11434. The model must already be installed."
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
                onChange={(event) => {
                  setKey(event.target.value);
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
            Chats send this opportunity and the document excerpts you select to
            this API. Career Buddy can suggest changes and create drafts; you
            review them before they are saved. Salary advice uses saved
            information, without live market research.
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
              Save Career Buddy
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => void test()}
              disabled={busy || testing || dirty || !saved?.model}
            >
              {testing ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <PlugZap size={16} />
              )}
              Test connection
            </button>
            {dirty && <small>Save before testing.</small>}
          </div>
        </form>
      )}
    </section>
  );
}
