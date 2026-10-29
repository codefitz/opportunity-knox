import { createHash, randomBytes } from "node:crypto";
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const DOC = "application/vnd.google-apps.document";
const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const session = (req) =>
  createHash("sha256")
    .update(
      (req.headers.cookie || "").match(
        /(?:^|;\s*)board_session=([^;]+)/,
      )?.[1] || "",
    )
    .digest("hex");
const fileId = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value))
    fail(400, "Invalid Google document ID.");
  return value;
};
export function createGoogleDocuments({
  getConfig,
  putConfig,
  getDocuments,
  saveDocument,
  publicDocument = (d) => d,
  fetcher = fetch,
}) {
  const config = () =>
    getConfig("googleDocuments") || {
      revision: 1,
      clientId: "",
      clientSecret: "",
      redirectUri: "",
      tokens: null,
    };
  const status = () => {
    const c = config();
    return {
      revision: c.revision,
      clientId: c.clientId,
      hasSecret: Boolean(c.clientSecret),
      redirectUri: c.redirectUri,
      configured: Boolean(c.clientId && c.clientSecret && c.redirectUri),
      connected: Boolean(c.tokens?.refresh_token || c.tokens?.access_token),
      scope: SCOPE,
    };
  };
  async function request(url, options = {}, binary = false) {
    let response;
    try {
      response = await fetcher(url, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      fail(502, "Google could not be reached. Check the connection and retry.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      fail(
        response.status === 401 ? 401 : 502,
        response.status === 401
          ? "Google authorization expired. Reconnect your account."
          : "Google could not complete this request. Check access, API setup or quota.",
      );
    }
    const parts = [];
    let size = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 20 * 1024 * 1024) {
        await reader.cancel();
        fail(413, "Google document exceeds the 20 MB import limit.");
      }
      parts.push(value);
    }
    const bytes = Buffer.concat(parts);
    if (binary) return bytes;
    try {
      return JSON.parse(bytes.toString());
    } catch {
      fail(502, "Google returned an invalid response.");
    }
  }
  const tokenRequest = (body) =>
    request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
  let refreshing;
  async function accessToken() {
    const c = config();
    if (!c.tokens) fail(400, "Connect Google Docs first.");
    if (c.tokens.access_token && c.tokens.expiresAt > Date.now() + 30000)
      return c.tokens.access_token;
    if (!c.tokens.refresh_token)
      fail(401, "Reconnect Google Docs to renew access.");
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const t = await tokenRequest({
        client_id: c.clientId,
        client_secret: c.clientSecret,
        refresh_token: c.tokens.refresh_token,
        grant_type: "refresh_token",
      });
      if (config().revision !== c.revision || !config().tokens)
        fail(409, "The Google connection changed. Retry.");
      if (typeof t.access_token !== "string")
        fail(502, "Google did not return a usable access token.");
      c.tokens = {
        ...c.tokens,
        ...t,
        expiresAt: Date.now() + (Number(t.expires_in) || 3600) * 1000,
      };
      putConfig("googleDocuments", c);
      return c.tokens.access_token;
    })();
    try {
      return await refreshing;
    } finally {
      refreshing = null;
    }
  }
  const api = async (path, binary = false) =>
    request(
      "https://www.googleapis.com/drive/v3/" + path,
      { headers: { Authorization: "Bearer " + (await accessToken()) } },
      binary,
    );
  return {
    status,
    async handle(path, method, req, res, { json, readBody }) {
      if (path === "/api/connections/google/callback" && method === "GET") {
        const q = new URL(req.url, "http://board").searchParams,
          p = getConfig("googleOAuthPending");
        if (!p || p.state !== q.get("state") || p.expiresAt < Date.now())
          fail(
            400,
            "Google sign-in expired or did not match. Start connecting again.",
          );
        if (q.get("error")) p.error = "Google sign-in was declined.";
        else {
          const code = q.get("code");
          if (!code || code.length > 4096)
            fail(400, "Google did not return an authorization code.");
          p.code = code;
        }
        putConfig("googleOAuthPending", p);
        res.writeHead(303, {
          Location:
            new URL(config().redirectUri).origin +
            "/#/settings?googleState=" +
            encodeURIComponent(p.state),
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        });
        res.end();
        return true;
      }
      if (path === "/api/connections/google") {
        if (method === "GET") {
          json(res, status());
          return true;
        }
        if (method === "PATCH") {
          const b = await readBody(req),
            c = config();
          if (b.revision !== c.revision)
            fail(409, "Google configuration changed. Reload first.");
          if (
            typeof b.clientId !== "string" ||
            b.clientId.length > 1000 ||
            !b.clientId.endsWith(".apps.googleusercontent.com")
          )
            fail(400, "Enter a Google Web application OAuth client ID.");
          let uri;
          try {
            uri = new URL(b.redirectUri);
          } catch {
            fail(400, "Enter a valid redirect URI.");
          }
          if (
            (uri.protocol !== "https:" &&
              !(
                uri.protocol === "http:" &&
                ["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname)
              )) ||
            uri.username ||
            uri.password ||
            uri.search ||
            uri.hash ||
            uri.pathname !== "/api/connections/google/callback"
          )
            fail(
              400,
              "Use HTTPS (or localhost HTTP) with /api/connections/google/callback and no query or credentials.",
            );
          if (
            typeof b.clientSecret !== "string" ||
            b.clientSecret.length > 4000
          )
            fail(400, "Invalid OAuth client secret.");
          const changed =
            c.clientId !== b.clientId ||
            c.redirectUri !== uri.href ||
            Boolean(b.clientSecret && b.clientSecret !== c.clientSecret);
          if (c.clientId !== b.clientId) c.clientSecret = "";
          c.clientId = b.clientId;
          c.redirectUri = uri.href;
          if (b.clientSecret) c.clientSecret = b.clientSecret;
          if (changed) {
            c.tokens = null;
            putConfig("googleOAuthPending", null);
          }
          c.revision++;
          putConfig("googleDocuments", c);
          json(res, status());
          return true;
        }
      }
      if (path === "/api/connections/google/start" && method === "POST") {
        await readBody(req);
        const c = config();
        if (!c.clientId || !c.clientSecret || !c.redirectUri)
          fail(400, "Configure the Google OAuth client first.");
        const state = randomBytes(32).toString("base64url"),
          verifier = randomBytes(32).toString("base64url");
        putConfig("googleOAuthPending", {
          state,
          verifier,
          session: session(req),
          revision: c.revision,
          expiresAt: Date.now() + 600000,
        });
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.search = new URLSearchParams({
          client_id: c.clientId,
          redirect_uri: c.redirectUri,
          response_type: "code",
          scope: SCOPE,
          access_type: "offline",
          prompt: "consent",
          state,
          code_challenge: createHash("sha256")
            .update(verifier)
            .digest("base64url"),
          code_challenge_method: "S256",
        });
        json(res, { url: url.href });
        return true;
      }
      if (path === "/api/connections/google/finish" && method === "POST") {
        const b = await readBody(req),
          p = getConfig("googleOAuthPending"),
          c = config();
        if (
          !p ||
          b.state !== p.state ||
          p.session !== session(req) ||
          p.expiresAt < Date.now() ||
          p.revision !== c.revision
        )
          fail(
            400,
            "Google sign-in did not match this board session. Connect again.",
          );
        putConfig("googleOAuthPending", null);
        if (p.error) fail(400, p.error);
        if (!p.code) fail(400, "Google sign-in has not completed.");
        const t = await tokenRequest({
          client_id: c.clientId,
          client_secret: c.clientSecret,
          redirect_uri: c.redirectUri,
          code: p.code,
          code_verifier: p.verifier,
          grant_type: "authorization_code",
        });
        if (config().revision !== c.revision)
          fail(409, "The Google configuration changed. Connect again.");
        if (
          typeof t.access_token !== "string" ||
          !String(t.scope || "")
            .split(" ")
            .includes(SCOPE)
        )
          fail(403, "Google read-only Drive permission was not granted.");
        c.tokens = {
          ...t,
          expiresAt: Date.now() + (Number(t.expires_in) || 3600) * 1000,
        };
        c.revision++;
        putConfig("googleDocuments", c);
        json(res, status());
        return true;
      }
      if (path === "/api/connections/google/disconnect" && method === "POST") {
        await readBody(req);
        const c = config(),
          token = c.tokens?.refresh_token || c.tokens?.access_token;
        c.tokens = null;
        c.revision++;
        putConfig("googleDocuments", c);
        putConfig("googleOAuthPending", null);
        let revoked = false;
        if (token)
          try {
            const r = await fetcher("https://oauth2.googleapis.com/revoke", {
              method: "POST",
              redirect: "error",
              signal: AbortSignal.timeout(10000),
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ token }).toString(),
            });
            revoked = r.ok;
            await r.body?.cancel();
          } catch {}
        json(res, { ...status(), revoked });
        return true;
      }
      if (path === "/api/connections/google/search" && method === "POST") {
        const b = await readBody(req);
        if (
          typeof b.query !== "string" ||
          b.query.length > 300 ||
          (b.pageToken && typeof b.pageToken !== "string") ||
          String(b.pageToken || "").length > 4000
        )
          fail(400, "Enter a short Google Docs search.");
        const escaped = b.query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const params = new URLSearchParams({
          q:
            `trashed=false and mimeType='${DOC}'` +
            (escaped ? ` and name contains '${escaped}'` : ""),
          fields:
            "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,version)",
          pageSize: "50",
          orderBy: "modifiedTime desc",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
          ...(b.pageToken ? { pageToken: b.pageToken } : {}),
        });
        const result = await api("files?" + params);
        json(res, {
          files: (result.files || []).map((f) => ({
            id: f.id,
            name: f.name,
            modifiedTime: f.modifiedTime,
            webViewLink: f.webViewLink,
          })),
          nextPageToken: result.nextPageToken || null,
        });
        return true;
      }
      if (path === "/api/connections/google/import" && method === "POST") {
        const b = await readBody(req),
          id = fileId(b.id),
          revision = config().revision;
        if (!["reference", "cv", "jd"].includes(b.kind))
          fail(400, "Choose a document type.");
        const file = await api(
          "files/" +
            id +
            "?fields=id,name,mimeType,modifiedTime,version,webViewLink&supportsAllDrives=true",
        );
        if (file.mimeType !== DOC)
          fail(400, "Only Google Docs documents can be imported here.");
        const version = String(file.version || file.modifiedTime || "");
        const existing = getDocuments().find(
          (d) =>
            d.externalSource?.provider === "google-docs" &&
            d.externalSource.id === id &&
            d.externalSource.version === version &&
            d.kind === b.kind,
        );
        if (existing && version) {
          json(res, { document: publicDocument(existing), unchanged: true });
          return true;
        }
        const bytes = await api(
          "files/" + id + "/export?" + new URLSearchParams({ mimeType: DOCX }),
          true,
        );
        if (config().revision !== revision || !config().tokens)
          fail(409, "The Google connection changed before import completed.");
        const name =
          String(file.name || "Google document")
            .replace(/[\0\r\n]/g, " ")
            .slice(0, 200) + ".docx";
        const doc = saveDocument({
          name,
          kind: b.kind,
          status: "draft",
          content: bytes,
          notes: "Explicit Google Docs snapshot import. Original is unchanged.",
          externalSource: {
            provider: "google-docs",
            id,
            version,
            modifiedTime: file.modifiedTime || "",
            url: "https://docs.google.com/document/d/" + id + "/edit",
            importedAt: new Date().toISOString(),
          },
        });
        json(res, { document: doc, unchanged: false });
        return true;
      }
      return false;
    },
  };
}
