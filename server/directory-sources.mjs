import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { resolve, join, sep, isAbsolute, extname, basename } from "node:path";
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const inside = (root, target) =>
  target === root || target.startsWith(root + sep);
const extensions = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".pdf",
  ".docx",
  ".pptx",
  ".html",
  ".htm",
  ".rtf",
  ".vtt",
  ".srt",
  ".csv",
  ".tsv",
  ".json",
  ".yaml",
  ".yml",
]);
export function createDirectorySources({
  db,
  getConfig,
  putConfig,
  dataDir,
  filesDir,
  hostFilesDir,
  mounts = [],
}) {
  const config = () =>
    getConfig("directorySources") || { revision: 1, roots: [] };
  const id = (root, path) =>
    "directory-" +
    createHash("sha256")
      .update(root.id + "\0" + path)
      .digest("hex");
  function local(root) {
    const mount = mounts.find((m) => m.hostPath === root.hostPath);
    if (mount) return realpathSync(mount.path);
    if (dataDir !== "/data") return realpathSync(root.hostPath);
    throw Error("pending");
  }
  function pathFor(root, relative = "") {
    if (
      typeof relative !== "string" ||
      relative.length > 4000 ||
      relative.includes("\\") ||
      relative.includes("\0") ||
      isAbsolute(relative) ||
      relative.split("/").some((p) => p === ".." || p.startsWith("."))
    )
      fail(400, "Choose a visible path inside the connected folder.");
    const base = local(root),
      target = resolve(base, relative);
    if (!inside(base, target)) fail(400, "Path outside source folder.");
    let current = base;
    for (const part of relative.split("/").filter(Boolean)) {
      current = join(current, part);
      if (lstatSync(current).isSymbolicLink())
        fail(400, "Symbolic links are not followed.");
    }
    if (!inside(base, realpathSync(target)))
      fail(400, "Path outside source folder.");
    return target;
  }
  function status() {
    return {
      ...config(),
      roots: config().roots.map((root) => {
        let state = "pending";
        try {
          state = statSync(local(root)).isDirectory()
            ? "connected"
            : "unavailable";
        } catch {
          if (
            mounts.some((m) => m.hostPath === root.hostPath) ||
            dataDir !== "/data"
          )
            state = "unavailable";
        }
        return { ...root, state, selectedCount: (root.selected || []).length };
      }),
    };
  }
  const clear = (paths) => {
    const remove = db.prepare("DELETE FROM document_text WHERE id=?");
    for (const [root, path] of paths) remove.run(id(root, path));
  };
  function sourceDocuments() {
    return config().roots.flatMap((root) =>
      (root.selected || []).flatMap((path) => {
        try {
          const file = pathFor(root, path),
            st = statSync(file);
          if (!st.isFile() || !extensions.has(extname(path).toLowerCase()))
            return [];
          return [
            {
              id: id(root, path),
              name: root.name + ": " + path,
              kind: "reference",
              status: "approved",
              opportunityId: "",
              size: st.size,
              readOnlyDirectorySource: true,
              readOnlyVaultSource: true,
              sourceRootId: root.id,
              sourcePath: path,
            },
          ];
        } catch {
          return [];
        }
      }),
    );
  }
  function sourcePath(doc) {
    const root = config().roots.find((r) => r.id === doc.sourceRootId);
    if (
      !root ||
      !root.selected.includes(doc.sourcePath) ||
      id(root, doc.sourcePath) !== doc.id
    )
      fail(404, "Directory source is no longer selected.");
    return pathFor(root, doc.sourcePath);
  }
  function pending() {
    const path = join(dataDir, "pending-sources.json"),
      temp = path + "." + randomUUID() + ".tmp";
    writeFileSync(
      temp,
      JSON.stringify({
        roots: config().roots.map(({ id, name, hostPath }) => ({
          id,
          name,
          hostPath,
        })),
      }),
      { mode: 0o600 },
    );
    renameSync(temp, path);
  }
  return {
    sourceDocuments,
    sourcePath,
    async handle(path, method, req, res, { json, readBody }) {
      if (path === "/api/connections/directories") {
        if (method === "GET") {
          json(res, status());
          return true;
        }
        if (method === "POST") {
          const b = await readBody(req),
            c = config();
          if (b.revision !== c.revision)
            fail(409, "Folder connections changed. Reload first.");
          if (
            typeof b.hostPath !== "string" ||
            !isAbsolute(b.hostPath) ||
            b.hostPath.length > 4000 ||
            b.hostPath === "/" ||
            /[\0\r\n]/.test(b.hostPath)
          )
            fail(
              400,
              "Enter an absolute career-source folder on the hosting computer.",
            );
          const hostPath = resolve(b.hostPath);
          if (
            [hostFilesDir, filesDir, dataDir]
              .filter(Boolean)
              .some(
                (p) =>
                  inside(resolve(p), hostPath) || inside(hostPath, resolve(p)),
              )
          )
            fail(
              400,
              "Read-only sources must be separate from application data and managed document folders.",
            );
          if (c.roots.length >= 20)
            fail(400, "Up to 20 independent source folders are supported.");
          if (c.roots.some((r) => r.hostPath === hostPath))
            fail(409, "This folder is already connected.");
          c.roots.push({
            id: randomUUID(),
            name:
              typeof b.name === "string" && b.name.trim()
                ? b.name.trim().slice(0, 100)
                : basename(hostPath),
            hostPath,
            selected: [],
          });
          c.revision++;
          putConfig("directorySources", c);
          pending();
          json(res, status());
          return true;
        }
      }
      const m = path.match(
        /^\/api\/connections\/directories\/([^/]+)(?:\/(browse|selection))?$/,
      );
      if (!m) return false;
      const c = config(),
        root = c.roots.find((r) => r.id === m[1]);
      if (!root) fail(404, "Source folder not found.");
      if (method === "DELETE" && !m[2]) {
        const b = await readBody(req);
        if (b.revision !== c.revision)
          fail(409, "Folder connections changed. Reload first.");
        clear(root.selected.map((p) => [root, p]));
        c.roots = c.roots.filter((r) => r.id !== root.id);
        c.revision++;
        putConfig("directorySources", c);
        pending();
        json(res, status());
        return true;
      }
      if (method === "GET" && m[2] === "browse") {
        const query = new URL(req.url, "http://board").searchParams,
          relative = query.get("path") || "",
          offset = Math.max(0, Number(query.get("offset")) || 0);
        let entries;
        try {
          entries = readdirSync(pathFor(root, relative), {
            withFileTypes: true,
          })
            .filter(
              (e) =>
                !e.name.startsWith(".") &&
                !["node_modules"].includes(e.name) &&
                !e.isSymbolicLink() &&
                (e.isDirectory() ||
                  extensions.has(extname(e.name).toLowerCase())),
            )
            .sort(
              (a, b) =>
                Number(b.isDirectory()) - Number(a.isDirectory()) ||
                a.name.localeCompare(b.name),
            );
        } catch (e) {
          if (e.status) throw e;
          fail(
            404,
            "Folder is unavailable or not mounted. Apply mounts with the launcher first.",
          );
        }
        json(res, {
          path: relative,
          entries: entries.slice(offset, offset + 200).map((e) => ({
            name: e.name,
            path: [relative, e.name].filter(Boolean).join("/"),
            directory: e.isDirectory(),
            selected: root.selected.includes(
              [relative, e.name].filter(Boolean).join("/"),
            ),
          })),
          nextOffset: offset + 200 < entries.length ? offset + 200 : null,
        });
        return true;
      }
      if (method === "POST" && m[2] === "selection") {
        const b = await readBody(req);
        if (b.revision !== c.revision)
          fail(409, "Folder selections changed. Reload first.");
        if (
          !Array.isArray(b.paths) ||
          b.paths.length > 10000 ||
          b.paths.some((p) => typeof p !== "string")
        )
          fail(400, "Choose up to 10,000 files per connected folder.");
        const selected = [...new Set(b.paths)];
        for (const path of selected) {
          let st;
          try {
            st = statSync(pathFor(root, path));
          } catch (e) {
            if (e.status) throw e;
            fail(404, "A selected file is unavailable.");
          }
          if (!st.isFile() || !extensions.has(extname(path).toLowerCase()))
            fail(400, "Select supported files, not directories.");
        }
        clear(
          root.selected
            .filter((p) => !selected.includes(p))
            .map((p) => [root, p]),
        );
        root.selected = selected;
        c.revision++;
        putConfig("directorySources", c);
        json(res, status());
        return true;
      }
      fail(405, "Method not supported.");
    },
  };
}
