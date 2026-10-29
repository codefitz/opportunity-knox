import { useEffect, useState } from "react";
import { api, json } from "../api";
type Root = {
  id: string;
  name: string;
  hostPath: string;
  state: string;
  selected: string[];
  selectedCount: number;
};
type Directories = { revision: number; roots: Root[] };
type Entry = {
  name: string;
  path: string;
  directory: boolean;
  selected: boolean;
};
type Google = {
  revision: number;
  clientId: string;
  hasSecret: boolean;
  redirectUri: string;
  configured: boolean;
  connected: boolean;
  scope: string;
};
type GoogleFile = {
  id: string;
  name: string;
  modifiedTime: string;
  webViewLink?: string;
};
export default function DocumentConnections({
  onError,
  onChanged,
  onRestart,
  restarting = false,
}: {
  onError: (e: unknown) => void;
  onChanged?: () => void;
  onRestart?: () => void;
  restarting?: boolean;
}) {
  const [folders, setFolders] = useState<Directories | null>(null),
    [google, setGoogle] = useState<Google | null>(null),
    [hostPath, setHostPath] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [active, setActive] = useState(""),
    [folderPath, setFolderPath] = useState(""),
    [entries, setEntries] = useState<Entry[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [nextOffset, setNextOffset] = useState<number | null>(null),
    [filter, setFilter] = useState("");
  const [clientId, setClientId] = useState(""),
    [secret, setSecret] = useState(""),
    [redirect, setRedirect] = useState(
      window.location.origin + "/api/connections/google/callback",
    ),
    [query, setQuery] = useState(""),
    [files, setFiles] = useState<GoogleFile[]>([]),
    [nextPage, setNextPage] = useState<string | null>(null),
    [kind, setKind] = useState("reference");
  async function load() {
    const [f, g] = await Promise.all([
      api<Directories>("/connections/directories"),
      api<Google>("/connections/google"),
    ]);
    setFolders(f);
    setGoogle(g);
    setClientId(g.clientId);
    setRedirect(
      g.redirectUri ||
        window.location.origin + "/api/connections/google/callback",
    );
  }
  useEffect(() => {
    void (async () => {
      try {
        const marker = new URLSearchParams(
          window.location.hash.split("?")[1] || "",
        ).get("googleState");
        if (marker) {
          try {
            await api("/connections/google/finish", json({ state: marker }));
          } finally {
            window.history.replaceState(
              null,
              "",
              window.location.pathname + window.location.search + "#/settings",
            );
          }
          setNotice("Google Docs connected with read-only access.");
        }
        await load();
      } catch (e) {
        onError(e);
        await load().catch(onError);
      }
    })();
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function browse(id: string, path = "", append = false) {
    const result = await api<{
      entries: Entry[];
      path: string;
      nextOffset: number | null;
    }>(
      "/connections/directories/" +
        id +
        "/browse?" +
        new URLSearchParams({
          path,
          offset: String(append ? nextOffset || 0 : 0),
        }),
    );
    setActive(id);
    setFolderPath(result.path);
    setEntries((current) =>
      append ? [...current, ...result.entries] : result.entries,
    );
    setNextOffset(result.nextOffset);
    if (!append && id !== active)
      setSelected(folders?.roots.find((r) => r.id === id)?.selected || []);
  }
  async function search(append = false) {
    const result = await api<{
      files: GoogleFile[];
      nextPageToken: string | null;
    }>(
      "/connections/google/search",
      json({ query, pageToken: append ? nextPage : undefined }),
    );
    setFiles((current) =>
      append ? [...current, ...result.files] : result.files,
    );
    setNextPage(result.nextPageToken);
  }
  return (
    <section className="settings-section" aria-label="Document connections">
      <div className="settings-section-heading">
        <div>
          <h2>Document connections</h2>
          <p>
            Use existing career folders read-only, or connect Google Docs and
            import selected snapshots. Connecting alone never indexes files or
            sends them to AI.
          </p>
        </div>
      </div>
      <details open>
        <summary>Read-only source folders</summary>
        <p className="buddy-muted">
          Locations are on the hosting computer. Select only files you want
          available to Career Buddy; originals remain in place. Hidden files,
          symbolic links and unsupported formats are excluded.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              const result = await api<Directories>(
                "/connections/directories",
                json({ revision: folders?.revision, name, hostPath }),
              );
              setFolders(result);
              setHostPath("");
              setName("");
              setNotice(
                "Source folder requested. Apply mounts and restart before browsing if marked pending.",
              );
            });
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>Folder label</span>
              <input
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                placeholder="Career archive"
              />
            </label>
            <label className="field">
              <span>Host folder path</span>
              <input
                required
                value={hostPath}
                onChange={(e) => setHostPath(e.target.value)}
                placeholder="/path/to/career-documents"
              />
            </label>
          </div>
          <div className="form-actions">
            <button
              className="button primary small"
              disabled={busy || !folders}
            >
              Add read-only folder
            </button>
            {onRestart && (
              <button
                type="button"
                className="button secondary small"
                disabled={busy || restarting}
                onClick={onRestart}
              >
                {restarting ? "Restarting…" : "Apply mounts & restart"}
              </button>
            )}
          </div>
        </form>
        <ul>
          {folders?.roots.map((root) => (
            <li key={root.id}>
              <strong>{root.name}</strong> · {root.state} · {root.selectedCount}{" "}
              selected<p className="buddy-muted">{root.hostPath}</p>
              <div className="library-tool-actions">
                <button
                  type="button"
                  className="button secondary small"
                  disabled={busy || root.state !== "connected"}
                  onClick={() => void action(() => browse(root.id))}
                >
                  Browse files
                </button>
                <button
                  type="button"
                  className="button secondary small"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      setFolders(
                        await api<Directories>(
                          "/connections/directories/" + root.id,
                          json({ revision: folders.revision }, "DELETE"),
                        ),
                      );
                      if (active === root.id) {
                        setActive("");
                        setEntries([]);
                      }
                      onChanged?.();
                      setNotice(
                        "Folder detached; original files remain unchanged. Apply mounts and restart to remove its mount.",
                      );
                    })
                  }
                >
                  Detach folder
                </button>
              </div>
            </li>
          ))}
        </ul>
        {active && (
          <div>
            <h3>
              {folders?.roots.find((r) => r.id === active)?.name} /{" "}
              {folderPath || "root"}
            </h3>
            <p>{selected.length} selected across this source folder</p>
            <div className="library-tool-actions">
              <button
                type="button"
                className="button secondary small"
                disabled={busy || !folderPath}
                onClick={() =>
                  void action(() =>
                    browse(
                      active,
                      folderPath.split("/").slice(0, -1).join("/"),
                    ),
                  )
                }
              >
                Parent folder
              </button>
              <button
                type="button"
                className="button secondary small"
                disabled={busy}
                onClick={() =>
                  setSelected((current) => [
                    ...new Set([
                      ...current,
                      ...entries
                        .filter(
                          (e) =>
                            !e.directory &&
                            e.name.toLowerCase().includes(filter.toLowerCase()),
                        )
                        .map((e) => e.path),
                    ]),
                  ])
                }
              >
                Select shown files
              </button>
              <button
                type="button"
                className="button secondary small"
                disabled={busy}
                onClick={() => setSelected([])}
              >
                Deselect all
              </button>
            </div>
            <label className="field"><span>Filter connected folder files</span><input
              aria-label="Filter connected folder files"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter shown entries"
            /></label>
            <div className="buddy-source-picker">
              {entries
                .filter((e) =>
                  e.name.toLowerCase().includes(filter.toLowerCase()),
                )
                .map((entry) =>
                  entry.directory ? (
                    <button
                      type="button"
                      className="button secondary small"
                      key={entry.path}
                      disabled={busy}
                      onClick={() =>
                        void action(() => browse(active, entry.path))
                      }
                    >
                      {entry.name} /
                    </button>
                  ) : (
                    <label key={entry.path}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={selected.includes(entry.path)}
                        onChange={(e) =>
                          setSelected((current) =>
                            e.target.checked
                              ? [...current, entry.path]
                              : current.filter((p) => p !== entry.path),
                          )
                        }
                      />
                      <span>{entry.name}</span>
                    </label>
                  ),
                )}
            </div>
            <div className="form-actions">
              {nextOffset !== null && (
                <button
                  type="button"
                  className="button secondary small"
                  disabled={busy}
                  onClick={() =>
                    void action(() => browse(active, folderPath, true))
                  }
                >
                  Load more files
                </button>
              )}
              <button
                type="button"
                className="button primary small"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const result = await api<Directories>(
                      "/connections/directories/" + active + "/selection",
                      json({ revision: folders?.revision, paths: selected }),
                    );
                    setFolders(result);
                    onChanged?.();
                    setNotice(
                      "Selected read-only files are now available to Buddy. Indexing remains explicit.",
                    );
                  })
                }
              >
                Save source selection
              </button>
            </div>
          </div>
        )}
      </details>
      <details>
        <summary>
          Google Docs — {google?.connected ? "connected" : "not connected"}
        </summary>
        <p>
          Read-only Google Drive permission is needed to search Google Docs and
          export selected documents. This app never edits originals. Imported
          files are local Word snapshots; no background Google sync or automatic
          AI indexing occurs.
        </p>
        <details>
          <summary>One-time Google setup instructions</summary>
          <ol>
            <li>
              Create/select a project in Google Cloud Console and enable the
              Google Drive API.
            </li>
            <li>
              Configure the OAuth consent screen for your own use. If the app is
              in testing, add your Google account as a test user. Google may
              require additional review before wider use.
            </li>
            <li>
              Create an OAuth client of type Web application. Add this exact
              authorized redirect URI: <code>{redirect}</code>
            </li>
            <li>
              Enter that client ID and secret below, save, then choose Connect
              Google Docs and review Google’s consent screen yourself.
            </li>
          </ol>
          <p className="buddy-muted">
            Client secrets and refresh tokens stay server-side and are excluded
            from record exports. Private full backups contain connection
            credentials. For non-local hosting, use HTTPS and register the exact
            externally reachable URL. Google testing-mode grants may require
            reconnecting periodically.
          </p>
        </details>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              const result = await api<Google>(
                "/connections/google",
                json(
                  {
                    revision: google?.revision,
                    clientId,
                    clientSecret: secret,
                    redirectUri: redirect,
                  },
                  "PATCH",
                ),
              );
              setGoogle(result);
              setSecret("");
              setNotice(
                "Google OAuth settings saved. Changed credentials require reconnecting.",
              );
            });
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>Google OAuth client ID</span>
              <input
                required
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="…apps.googleusercontent.com"
              />
            </label>
            <label className="field">
              <span>Google OAuth client secret</span>
              <input
                type="password"
                autoComplete="new-password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={
                  google?.hasSecret
                    ? "Stored — leave blank to keep"
                    : "Enter client secret"
                }
              />
            </label>
            <label className="field wide">
              <span>Authorized redirect URI</span>
              <input
                required
                value={redirect}
                onChange={(e) => setRedirect(e.target.value)}
              />
            </label>
          </div>
          <div className="form-actions">
            <button className="button primary small" disabled={busy || !google}>
              Save Google setup
            </button>
            <button
              type="button"
              className="button secondary small"
              disabled={busy || !google?.configured}
              onClick={() =>
                void action(async () => {
                  const result = await api<{ url: string }>(
                    "/connections/google/start",
                    json({}),
                  );
                  window.location.assign(result.url);
                })
              }
            >
              Connect Google Docs
            </button>
            {google?.connected && (
              <button
                type="button"
                className="button secondary small"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const result = await api<Google & { revoked: boolean }>(
                      "/connections/google/disconnect",
                      json({}),
                    );
                    setGoogle(result);
                    setFiles([]);
                    setNotice(
                      result.revoked
                        ? "Google access disconnected and revoked."
                        : "Disconnected locally. Remote revocation could not be confirmed; remove access in your Google account if needed.",
                    );
                  })
                }
              >
                Disconnect Google
              </button>
            )}
          </div>
        </form>
        {google?.connected && (
          <div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(() => search());
              }}
            >
              <label className="field">
                <span>Find Google Docs by name</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  maxLength={300}
                />
              </label>
              <label className="field">
                <span>Import as</span>
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="reference">Career reference / template</option>
                  <option value="cv">CV</option>
                  <option value="jd">Job description</option>
                </select>
              </label>
              <button className="button secondary small" disabled={busy}>
                Search Google Docs
              </button>
            </form>
            <ul>
              {files.map((file) => (
                <li key={file.id}>
                  <strong>{file.name}</strong> · {file.modifiedTime}
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const result = await api<{ unchanged: boolean }>(
                          "/connections/google/import",
                          json({ id: file.id, kind }),
                        );
                        onChanged?.();
                        setNotice(
                          result.unchanged
                            ? "This version is already imported."
                            : "Google Docs snapshot imported into the Career Library. The original is unchanged.",
                        );
                      })
                    }
                  >
                    Import snapshot
                  </button>
                </li>
              ))}
            </ul>
            {nextPage && (
              <button
                type="button"
                className="button secondary small"
                disabled={busy}
                onClick={() => void action(() => search(true))}
              >
                Load more Google Docs
              </button>
            )}
          </div>
        )}
      </details>
      <div className="form-actions">
        <button
          type="button"
          className="button secondary small"
          disabled={busy}
          onClick={() => void action(load)}
        >
          Refresh connections
        </button>
      </div>
      <p role="status">{notice}</p>
    </section>
  );
}
