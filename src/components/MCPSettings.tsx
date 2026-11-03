import { useEffect, useState } from "react";
import { api, json } from "../api";
import { Copy, Check, RefreshCw, Key, Shield, HelpCircle, Terminal } from "lucide-react";

type MCPSettingsData = {
  enabled: boolean;
  hasKey: boolean;
  apiKey: string;
  allowWrite: boolean;
  createdAt?: string;
  lastUsedAt?: string;
  clientConfig?: {
    mcpServers: Record<
      string,
      {
        command: string;
        args: string[];
        env: Record<string, string>;
      }
    >;
  };
};

export default function MCPSettings({
  onError,
}: {
  onError: (e: unknown) => void;
}) {
  const [settings, setSettings] = useState<MCPSettingsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [rotateConfirm, setRotateConfirm] = useState(false);
  const [message, setMessage] = useState("");

  const load = () => {
    setBusy(true);
    api<MCPSettingsData>("/mcp/settings")
      .then((data) => {
        setSettings(data);
        setMessage("");
      })
      .catch(onError)
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    load();
  }, []);

  const updateSetting = async (patch: Partial<MCPSettingsData>) => {
    if (!settings) return;
    setBusy(true);
    try {
      const updated = await api<MCPSettingsData>("/mcp/settings", json(patch));
      setSettings(updated);
      setMessage("Settings saved.");
      setTimeout(() => setMessage(""), 3000);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const rotateKey = async () => {
    setBusy(true);
    try {
      const res = await api<{ success: boolean; apiKey: string; createdAt: string }>(
        "/mcp/settings/rotate-key",
        json({}),
      );
      if (settings) {
        setSettings({
          ...settings,
          apiKey: res.apiKey,
          hasKey: true,
          createdAt: res.createdAt,
          lastUsedAt: "",
          clientConfig: {
            mcpServers: {
              "opportunity-knox": {
                command: "node",
                args: ["server/mcp-server.mjs"],
                env: {
                  OPKNOX_URL: window.location.origin,
                  OPKNOX_API_KEY: res.apiKey,
                },
              },
            },
          },
        });
      }
      setRotateConfirm(false);
      setMessage("API key rotated. Update your Claude Desktop configuration.");
      setTimeout(() => setMessage(""), 4000);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const copyText = (text: string, type: "key" | "config") => {
    navigator.clipboard.writeText(text).then(() => {
      if (type === "key") {
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 2000);
      } else {
        setCopiedConfig(true);
        setTimeout(() => setCopiedConfig(false), 2000);
      }
    });
  };

  if (!settings) {
    return (
      <section className="settings-section">
        <p className="loading-state">Loading MCP settings…</p>
      </section>
    );
  }

  const configJson = settings.clientConfig
    ? JSON.stringify(settings.clientConfig, null, 2)
    : "";

  return (
    <section className="settings-section" aria-label="MCP Server Settings">
      <div className="settings-section-heading">
        <div>
          <h2>Model Context Protocol (MCP) Server</h2>
          <p>
            Connect Claude Desktop to Opportunity Knox using local stdio. Search opportunities,
            retrieve candidate career evidence, and save candidate fit assessments directly from chat.
          </p>
        </div>
      </div>

      {message && (
        <div className="save-success-banner" role="status">
          <p>{message}</p>
        </div>
      )}

      <div className="settings-action">
        <div>
          <strong>Enable MCP Server</strong>
          <p>
            Allow local MCP clients (such as Claude Desktop) to connect using an authenticated Bearer token.
          </p>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={busy}
            onChange={(e) => updateSetting({ enabled: e.target.checked })}
          />
          <span className="toggle-slider" />
        </label>
      </div>

      <div className="settings-action">
        <div>
          <strong>Allow AI fit review writing</strong>
          <p>
            Permit Claude Desktop to save verified strengths, gaps and review dates to Opportunity
            cards. Workflow stage, decision, reason and prior review history remain preserved.
          </p>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={settings.allowWrite}
            disabled={busy || !settings.enabled}
            onChange={(e) => updateSetting({ allowWrite: e.target.checked })}
          />
          <span className="toggle-slider" />
        </label>
      </div>

      {settings.enabled && (
        <>
          <div className="mcp-credentials-card">
            <div className="mcp-card-header">
              <div className="mcp-card-title">
                <Key size={16} />
                <strong>MCP Authentication Token</strong>
              </div>
              <div className="mcp-card-actions">
                {settings.apiKey && (
                  <button
                    type="button"
                    className="button secondary sm"
                    onClick={() => copyText(settings.apiKey, "key")}
                    title="Copy API key to clipboard"
                  >
                    {copiedKey ? <Check size={14} /> : <Copy size={14} />}
                    {copiedKey ? "Copied" : "Copy key"}
                  </button>
                )}
                <button
                  type="button"
                  className="button secondary sm"
                  disabled={busy}
                  onClick={() => setRotateConfirm(true)}
                  title="Generate a fresh token"
                >
                  <RefreshCw size={14} />
                  Rotate key
                </button>
              </div>
            </div>

            {rotateConfirm && (
              <div className="mcp-warning-box">
                <p>
                  Rotating this token revokes existing access immediately. Existing Claude Desktop
                  configurations will stop working until updated with the new token.
                </p>
                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                  <button
                    type="button"
                    className="button primary sm"
                    disabled={busy}
                    onClick={rotateKey}
                  >
                    Confirm rotation
                  </button>
                  <button
                    type="button"
                    className="button secondary sm"
                    disabled={busy}
                    onClick={() => setRotateConfirm(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="mcp-key-field">
              <code>{settings.apiKey || "No token generated yet"}</code>
            </div>

            {settings.createdAt && (
              <p className="mcp-meta-text">
                Token generated: {new Date(settings.createdAt).toLocaleString()}
                {settings.lastUsedAt && (
                  <span> · Last used: {new Date(settings.lastUsedAt).toLocaleString()}</span>
                )}
              </p>
            )}
          </div>

          <div className="mcp-config-box">
            <div className="mcp-card-header">
              <div className="mcp-card-title">
                <Terminal size={16} />
                <strong>Claude Desktop Configuration</strong>
              </div>
              <button
                type="button"
                className="button secondary sm"
                onClick={() => copyText(configJson, "config")}
                title="Copy configuration JSON"
              >
                {copiedConfig ? <Check size={14} /> : <Copy size={14} />}
                {copiedConfig ? "Copied config" : "Copy config JSON"}
              </button>
            </div>
            <p className="mcp-meta-text">
              Add this block to your <code>claude_desktop_config.json</code> under the <code>mcpServers</code> section:
            </p>
            <pre className="mcp-code-block">{configJson}</pre>

            <div className="mcp-instructions">
              <h4>
                <HelpCircle size={15} /> Setup Guide
              </h4>
              <ol>
                <li>
                  Open your Claude Desktop configuration file:
                  <ul>
                    <li>
                      <strong>macOS:</strong>{" "}
                      <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>
                    </li>
                    <li>
                      <strong>Windows:</strong> <code>%APPDATA%\Claude\claude_desktop_config.json</code>
                    </li>
                  </ul>
                </li>
                <li>Paste the configuration block above into the file and save.</li>
                <li>Restart Claude Desktop.</li>
                <li>
                  Test in Claude Desktop with a prompt:
                  <blockquote className="mcp-example-prompt">
                    “Find the Principal Engineer opportunity, assess my fit using my career library,
                    and save the strengths and gaps.”
                  </blockquote>
                </li>
              </ol>
            </div>

            <div className="mcp-privacy-note">
              <Shield size={16} />
              <div>
                <strong>Local &amp; Private Boundaries</strong>
                <p>
                  Communication uses standard input/output (stdio) with the local server over
                  loopback (<code>127.0.0.1</code>). Career library documents are retrieved only when
                  relevant passages match query requirements. Resetting your workspace revokes this
                  access token.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
