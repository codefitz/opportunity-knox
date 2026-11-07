import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  posix,
  resolve,
  sep,
} from "node:path";

const SUPPORTED_VAULT_EXTS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".pdf",
  ".docx",
  ".dotx",
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
  ".gdoc",
  ".gsheet",
  ".gslides",
]);

const MARKDOWN_EXTS = new Set([".md", ".markdown"]);
const TEXT_NOTE_EXTS = new Set([".md", ".markdown", ".txt"]);
const SKIP_DIRS = new Set([
  ".obsidian",
  ".trash",
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  ".DS_Store",
]);

const inside = (root, target) =>
  target === root || target.startsWith(root + sep);

function writeAtomic(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temp = `${filePath}.${randomUUID()}.tmp`;
  writeFileSync(temp, content, { mode: 0o600 });
  renameSync(temp, filePath);
}

function escapeYaml(str) {
  return JSON.stringify(String(str ?? ""));
}

function sanitizeNoteStem(filename) {
  const ext = extname(filename);
  const stem = ext ? filename.slice(0, -ext.length) : filename;
  return (
    stem
      .replace(/[\\/:*?"<>|#^\[\]]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180) || "Note"
  );
}

function cleanVaultSubpath(raw, fail) {
  if (
    typeof raw !== "string" ||
    !raw.trim() ||
    raw.includes("\0") ||
    raw.includes("\\") ||
    isAbsolute(raw.trim())
  )
    fail(400, "Choose a relative subfolder name inside your document folder.");
  const parts = raw
    .trim()
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    !parts.length ||
    parts.some((p) => p === "." || p === ".." || p.startsWith("."))
  )
    fail(
      400,
      "Choose a valid relative folder name without hidden or parent segments.",
    );
  return parts.join("/");
}

function safeVaultChild(vaultRoot, relPosixPath, { createDirs = false } = {}) {
  const base = realpathSync(vaultRoot);
  const segments = relPosixPath.split("/").filter(Boolean);
  if (
    !segments.length ||
    segments.some((s) => s === "." || s === ".." || s.includes("\0"))
  )
    throw new Error("Invalid vault path");
  let current = base;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    current = join(current, seg);
    if (existsSync(current)) {
      const actual = realpathSync(current);
      if (!inside(base, actual)) throw new Error("Path escapes vault root");
    } else if (!isLast && createDirs) {
      mkdirSync(current, { recursive: true });
    }
  }
  if (!inside(base, resolve(current)))
    throw new Error("Path escapes vault root");
  return current;
}

function ensureObsidianMetadata(vaultDir) {
  const obsidianDir = join(vaultDir, ".obsidian");
  mkdirSync(obsidianDir, { recursive: true });
  const appJsonPath = join(obsidianDir, "app.json");
  if (!existsSync(appJsonPath)) {
    writeAtomic(
      appJsonPath,
      JSON.stringify(
        {
          attachmentFolderPath: "Attachments",
          newFileLocation: "folder",
          newFileFolderPath: "Career Library",
          alwaysUpdateLinks: true,
          showFrontmatter: true,
        },
        null,
        2,
      ) + "\n",
    );
  }
}

function walkVaultFiles(vaultRoot, { strict = false } = {}) {
  const base = realpathSync(vaultRoot);
  const files = [];
  const folderSet = new Set();

  function walk(currentDir, relPrefix) {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch (error) {
      if (strict) throw error;
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      const fullPath = join(currentDir, entry.name);
      try {
        if (lstatSync(fullPath).isSymbolicLink()) continue;
        const actual = realpathSync(fullPath);
        if (!inside(base, actual)) continue;
      } catch (error) {
        if (strict) throw error;
        continue;
      }
      const relPath = relPrefix
        ? posix.join(relPrefix, entry.name)
        : entry.name;
      if (entry.isDirectory()) {
        folderSet.add(relPath);
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (SUPPORTED_VAULT_EXTS.has(ext)) {
          files.push({ fullPath, relPath, ext, name: entry.name });
        }
      }
    }
  }

  walk(base, "");
  return {
    files,
    folders: [...folderSet].sort((a, b) => a.localeCompare(b)),
  };
}

function inspectVault(vaultDir) {
  if (!vaultDir || !existsSync(vaultDir)) {
    return {
      exists: false,
      hasObsidianConfig: false,
      markdownCount: 0,
      attachmentCount: 0,
      totalFiles: 0,
      folders: [],
    };
  }
  try {
    if (!statSync(vaultDir).isDirectory()) {
      return {
        exists: false,
        hasObsidianConfig: false,
        markdownCount: 0,
        attachmentCount: 0,
        totalFiles: 0,
        folders: [],
      };
    }
    const hasObsidianConfig = existsSync(join(vaultDir, ".obsidian"));
    const { files, folders } = walkVaultFiles(vaultDir);
    const markdownCount = files.filter((f) => MARKDOWN_EXTS.has(f.ext)).length;
    const attachmentCount = files.length - markdownCount;
    return {
      exists: true,
      hasObsidianConfig,
      markdownCount,
      attachmentCount,
      totalFiles: files.length,
      folders: folders.slice(0, 50),
    };
  } catch {
    return {
      exists: false,
      hasObsidianConfig: false,
      markdownCount: 0,
      attachmentCount: 0,
      totalFiles: 0,
      folders: [],
    };
  }
}

export function createObsidianIntegration({
  dataDir,
  filesDir,
  hostFilesDir,
  vaultDir: envVaultDir,
  hostVaultDir: envHostVaultDir,
  getConfig,
  putConfig,
  getDocuments,
  putDocument,
  saveDocument,
  documentPath,
  safePath,
  buddy,
  deleteSourceCache,
  replaceDocumentContent,
  fail,
}) {
  const defaults = {
    enabled: false,
    locationType: "subpath",
    subpath: "obsidian-vault",
    hostPath: "",
    vaultName: "Opportunity Knox Vault",
    readOnly: false,
    lastSyncedAt: "",
    lastImportedToVaultAt: "",
  };

  function getSettings() {
    return {
      ...defaults,
      ...(getConfig("obsidian") || {}),
    };
  }

  function pendingVaultRequest() {
    try {
      return JSON.parse(
        readFileSync(join(dataDir, "pending-vault.json"), "utf8"),
      );
    } catch {
      return null;
    }
  }

  function resolveActiveVault(cfg = getSettings()) {
    const pending = pendingVaultRequest();
    const pendingHostPath = pending?.hostPath || "";

    if (!cfg.enabled) {
      return {
        localDir: "",
        resolvedHostPath:
          cfg.locationType === "hostPath"
            ? cfg.hostPath
            : join(hostFilesDir, cfg.subpath || "obsidian-vault"),
        mountPending: false,
        pendingHostPath,
      };
    }

    if (cfg.locationType === "subpath") {
      const sub = cfg.subpath || "obsidian-vault";
      let localDir = "";
      try {
        localDir = safePath(filesDir, sub, { create: false });
      } catch {
        localDir = join(filesDir, sub);
      }
      const resolvedHostPath = join(hostFilesDir, sub);
      return {
        localDir,
        resolvedHostPath,
        mountPending: false,
        pendingHostPath: "",
      };
    }

    // hostPath mode
    const targetHostPath = cfg.hostPath;
    if (dataDir === "/data" && cfg.readOnly && process.env.BOARD_VAULT_READ_ONLY !== "1") {
      return { localDir: "", resolvedHostPath: targetHostPath, mountPending: true, pendingHostPath: pendingHostPath || targetHostPath };
    }
    // 1. Check if container launcher mounted it at envVaultDir
    if (
      envVaultDir &&
      envHostVaultDir &&
      resolve(envHostVaultDir) === resolve(targetHostPath) &&
      existsSync(envVaultDir)
    ) {
      return {
        localDir: realpathSync(envVaultDir),
        resolvedHostPath: targetHostPath,
        mountPending: false,
        pendingHostPath,
      };
    }
    // 2. Check if targetHostPath is inside hostFilesDir (already mounted at filesDir!)
    if (
      hostFilesDir &&
      (targetHostPath === hostFilesDir ||
        targetHostPath.startsWith(hostFilesDir + sep))
    ) {
      const rel = targetHostPath
        .slice(hostFilesDir.length)
        .replace(/^[/\\]+/, "")
        .replace(/\\/g, "/");
      const localDir = rel
        ? safePath(filesDir, rel, { create: false })
        : filesDir;
      return {
        localDir,
        resolvedHostPath: targetHostPath,
        mountPending: false,
        pendingHostPath: "",
      };
    }
    // 3. Check if directly accessible on disk (local non-Docker execution or test environment)
    if (existsSync(targetHostPath) && dataDir !== "/data") {
      try {
        return {
          localDir: realpathSync(targetHostPath),
          resolvedHostPath: targetHostPath,
          mountPending: false,
          pendingHostPath: "",
        };
      } catch {
        // fall through
      }
    }
    return {
      localDir: "",
      resolvedHostPath: targetHostPath,
      mountPending: Boolean(pendingHostPath || dataDir === "/data"),
      pendingHostPath: pendingHostPath || targetHostPath,
    };
  }

  function status() {
    const cfg = getSettings();
    const resolved = resolveActiveVault(cfg);
    const vaultStats = cfg.enabled
      ? inspectVault(resolved.localDir)
      : {
          exists: false,
          hasObsidianConfig: false,
          markdownCount: 0,
          attachmentCount: 0,
          totalFiles: 0,
          folders: [],
        };
    const obsidianUrl = resolved.resolvedHostPath
      ? `obsidian://open?path=${encodeURIComponent(resolved.resolvedHostPath)}`
      : "";
    const libraryIds = cfg.enabled ? new Set(getDocuments().filter(d => !d.opportunityId).map(d => d.id)) : new Set();
    return {
      enabled: cfg.enabled,
      readOnly: Boolean(cfg.readOnly),
      locationType: cfg.locationType,
      subpath: cfg.subpath,
      hostPath: cfg.hostPath,
      vaultName:
        cfg.vaultName ||
        basename(resolved.resolvedHostPath || cfg.subpath || "Obsidian Vault"),
      resolvedHostPath: resolved.resolvedHostPath,
      obsidianUrl,
      mountPending: resolved.mountPending,
      pendingHostPath: resolved.pendingHostPath,
      vaultStats,
      linkedDocuments: cfg.enabled ? Object.keys(readInventory(cfg).entries).filter(id => libraryIds.has(id)).length : 0,
      lastSyncedAt: cfg.lastSyncedAt || "",
      lastImportedToVaultAt: cfg.lastImportedToVaultAt || "",
    };
  }

  function writeHubNote(vaultDir, vaultName) {
    const docs = getDocuments().filter((d) => !d.opportunityId);
    let linked = {};
    try {
      const cfg = getSettings(), active = resolveActiveVault(cfg).localDir;
      if (cfg.enabled && active && realpathSync(active) === realpathSync(vaultDir)) linked = readInventory(cfg).entries;
    } catch { /* A new or unavailable vault has no matching inventory yet. */ }
    const byFolder = new Map();
    for (const doc of docs) {
      const idx = doc.name.lastIndexOf("/");
      const folder = idx > 0 ? doc.name.slice(0, idx) : "General";
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      byFolder.get(folder).push(doc);
    }
    const lines = [
      "---",
      `title: ${escapeYaml(`${vaultName} — Opportunity Knox Hub`)}`,
      "tags:",
      "  - opportunity-knox",
      "  - career-vault",
      `updated: ${escapeYaml(new Date().toISOString())}`,
      "---",
      "",
      `# ${vaultName}`,
      "",
      "This Obsidian vault is connected to **Opportunity Knox**.",
      "",
      "- **Career Library/** — Markdown notes and extracted companion notes for your career sources.",
      "- **Attachments/** — Original PDF, Word, PowerPoint, and transcript files linked from your notes.",
      "",
      "## Library Index",
      "",
    ];
    if (!docs.length) {
      lines.push(
        "_No library sources imported yet. Add notes directly in Obsidian or use **Import sources to vault** in Opportunity Knox._",
      );
    } else {
      for (const [folderName, group] of [...byFolder.entries()].sort(
        ([a], [b]) => a.localeCompare(b),
      )) {
        lines.push(`### ${folderName}`);
        for (const doc of group) {
          const baseName = doc.name.split("/").pop() || doc.name;
          const stem = sanitizeNoteStem(baseName);
          const entry = linked[doc.id];
          const existing = entry?.companions?.[0] || entry?.vaultPath;
          const relNote = existing
            ? existing.replace(/\.md$/i, "")
            : folderName === "General"
              ? `Career Library/${stem}`
              : `Career Library/${folderName}/${stem}`;
          const tagList = (doc.tags || [])
            .map((t) => `#${t.replace(/\s+/g, "-")}`)
            .join(" ");
          lines.push(
            `- [[${relNote}|${baseName}]] (${doc.kind} · ${doc.status})${tagList ? ` — ${tagList}` : ""}`,
          );
        }
        lines.push("");
      }
    }
    const hubPath = safeVaultChild(vaultDir, "00 - Opportunity Knox Hub.md");
    writeAtomic(hubPath, lines.join("\n") + "\n");
  }

  // Inventory is stored in the workspace database, keyed by the host vault path.
  // It records actual successful transfers; pre-existing files are never matched by name alone.
  function inventoryKey(cfg) {
    const host = resolveActiveVault(cfg).resolvedHostPath;
    return createHash("sha256").update(resolve(host)).digest("hex");
  }
  function readInventory(cfg) {
    const inventories = getConfig("obsidianSyncInventories") || {};
    return inventories[inventoryKey(cfg)] || { version: 1, entries: {} };
  }
  function recordTransfer(cfg, doc, remotePath, localBytes, remoteBytes, companions = []) {
    const inventories = getConfig("obsidianSyncInventories") || {}, key = inventoryKey(cfg);
    const inventory = inventories[key] || { version: 1, entries: {} };
    // A single path cannot establish identity for two documents (e.g. same filename).
    const collision = Object.values(inventory.entries).find(entry => entry.vaultPath === remotePath && entry.documentId !== doc.id);
    if (collision || inventory.ambiguousPaths?.includes(remotePath)) {
      if (collision) delete inventory.entries[collision.documentId];
      delete inventory.entries[doc.id];
      inventory.ambiguousPaths = [...new Set([...(inventory.ambiguousPaths || []), remotePath])];
      inventories[key] = inventory; putConfig("obsidianSyncInventories", inventories);
      return;
    }
    const previous = inventory.entries[doc.id], companionBaselines = {};
    const root = realpathSync(resolveActiveVault(cfg).localDir);
    for (const path of companions) {
      if (previous?.companions?.includes(path)) companionBaselines[path] = previous.companionBaselines?.[path] ?? null;
      else { try { companionBaselines[path] = createHash("sha256").update(readFileSync(safeVaultChild(root,path))).digest("hex"); } catch { companionBaselines[path] = null; } }
    }
    inventory.entries[doc.id] = { documentId: doc.id, vaultPath: remotePath,
      localHash: createHash("sha256").update(localBytes).digest("hex"),
      vaultHash: createHash("sha256").update(remoteBytes).digest("hex"),
      companions, companionBaselines, vaultOwned: previous?.vaultOwned ?? !remotePath.startsWith("OppKnox Inbox/"), syncedAt: new Date().toISOString() };
    inventories[key] = inventory; putConfig("obsidianSyncInventories", inventories);
  }
  function inventoryStatus() {
    const cfg = getSettings(), resolved = resolveActiveVault(cfg);
    if (!cfg.enabled || resolved.mountPending || !resolved.localDir || !existsSync(resolved.localDir)) fail(409, "Connect the vault to inspect its sync inventory.");
    const root = realpathSync(resolved.localDir), docs = new Map(getDocuments().filter(d => !d.opportunityId).map(d => [d.id, d]));
    return Object.values(readInventory(cfg).entries).map(entry => {
      const doc = docs.get(entry.documentId);
      let localHash = null, vaultHash = null, vaultUnavailable = false;
      try { if (doc) localHash = createHash("sha256").update(readFileSync(documentPath(doc))).digest("hex"); } catch {}
      try { vaultHash = createHash("sha256").update(readFileSync(safeVaultChild(root, entry.vaultPath))).digest("hex"); } catch (error) { vaultUnavailable = error.code !== "ENOENT"; }
      const companionHashes = (entry.companions || []).map(path => { try { return [path, createHash("sha256").update(readFileSync(safeVaultChild(root, path))).digest("hex")]; } catch (error) { if (error.code !== "ENOENT") throw error; return [path, null]; } });
      return { ...entry, name: doc?.name || null, currentRevision: doc?.revision ?? null, documentExists: !!doc, localExists: localHash !== null, vaultExists: vaultHash !== null, vaultUnavailable, companionHashes,
        currentLocalHash: localHash, currentVaultHash: vaultHash,
        localChanged: localHash !== null && localHash !== entry.localHash, vaultChanged: vaultHash !== null && vaultHash !== entry.vaultHash };
    });
  }

  function syncPreview() {
    const cfg = getSettings(), resolved = resolveActiveVault(cfg);
    if (!cfg.enabled || resolved.mountPending || !resolved.localDir || !existsSync(resolved.localDir)) fail(409, "Connect the vault before reviewing sync.");
    const root = realpathSync(resolved.localDir), inventory = readInventory(cfg), tracked = inventoryStatus();
    const docs = getDocuments().filter(d => !d.opportunityId), docIds = new Set(tracked.map(e => e.documentId));
    const paths = new Set(tracked.flatMap(e => [e.vaultPath, ...(e.companions || [])]));
    const changes = [];
    for (const entry of tracked) {
      let type;
      if (entry.vaultUnavailable || (entry.documentExists && !entry.localExists)) type = "unavailable";
      else if (!entry.vaultExists && !entry.documentExists) type = "missing-both";
      else if (!entry.vaultExists) type = entry.localChanged ? "conflict" : "missing-vault";
      else if (!entry.documentExists) type = entry.vaultChanged ? "conflict" : "missing-local";
      else if (entry.localChanged && entry.vaultChanged) type = "conflict";
      else if (entry.localChanged) type = "changed-local";
      else if (entry.vaultChanged) type = "changed-vault";
      else type = "unchanged";
      changes.push({ type, name: entry.name || entry.vaultPath, documentId: entry.documentId, vaultPath: entry.vaultPath });
      for (const [path, hash] of entry.companionHashes || []) {
        const baseline = entry.companionBaselines?.[path];
        if (!baseline) changes.push({type:"companion-unverified",name:path,documentId:entry.documentId,vaultPath:path});
        else if (hash !== baseline) changes.push({type:"companion-changed",name:path,documentId:entry.documentId,vaultPath:path});
      }
    }
    const localUnlinked = docs.filter(d => !docIds.has(d.id)).map(d => {
      let hash = null; try { hash = createHash("sha256").update(readFileSync(documentPath(d))).digest("hex"); } catch {}
      return { id: d.id, name: d.name, revision: d.revision, hash };
    });
    for (const doc of localUnlinked) changes.push({ type: doc.hash ? "unlinked-local" : "unavailable", name: doc.name, documentId: doc.id });
    const vaultUnlinked = [];
    for (const file of walkVaultFiles(root, { strict: true }).files) {
      if (paths.has(file.relPath) || !file.relPath.startsWith("OppKnox Inbox/")) continue;
      let hash = null; try { hash = createHash("sha256").update(readFileSync(file.fullPath)).digest("hex"); } catch {}
      vaultUnlinked.push({ path: file.relPath, hash });
      changes.push({ type: hash ? "unlinked-vault" : "unavailable", name: file.relPath, vaultPath: file.relPath });
    }
    for (const path of inventory.ambiguousPaths || []) changes.push({type:"ambiguous",name:path,vaultPath:path});
    changes.sort((a,b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name) || (a.documentId || "").localeCompare(b.documentId || ""));
    localUnlinked.sort((a,b)=>a.id.localeCompare(b.id));vaultUnlinked.sort((a,b)=>a.path.localeCompare(b.path));
    tracked.sort((a,b)=>a.documentId.localeCompare(b.documentId));
    const token = createHash("sha256").update(JSON.stringify({vault:inventoryKey(cfg),readOnly:cfg.readOnly,tracked,localUnlinked,vaultUnlinked,ambiguousPaths:inventory.ambiguousPaths || []})).digest("hex");
    return { changes, token };
  }

  async function importSourcesToVault({
    onlyPrepared = false,
    includeExtractedText = true,
  } = {}) {
    const cfg = getSettings();
    if (!cfg.enabled) fail(400, "Configure or create an Obsidian vault first.");
    if (cfg.readOnly) fail(403, "This vault is connected read-only; writing to it is disabled.");
    const resolved = resolveActiveVault(cfg);
    if (
      resolved.mountPending ||
      !resolved.localDir ||
      !existsSync(resolved.localDir)
    )
      fail(
        409,
        "The Obsidian vault folder is waiting to be mounted. Click Update & restart to attach the host folder first.",
      );
    const vaultDir = realpathSync(resolved.localDir);
    ensureObsidianMetadata(vaultDir);
    mkdirSync(join(vaultDir, "Career Library"), { recursive: true });
    mkdirSync(join(vaultDir, "Attachments"), { recursive: true });
    mkdirSync(join(vaultDir, "OppKnox Inbox"), { recursive: true });

    const allLibraryDocs = getDocuments().filter((d) => !d.opportunityId);
    const selectedDocs = onlyPrepared
      ? allLibraryDocs.filter(
          (d) => buddy.getDocumentText(d.id)?.status === "ready",
        )
      : allLibraryDocs;

    let importedNotesCount = 0;
    let copiedAttachmentsCount = 0;
    let skippedCount = 0;

    for (const doc of selectedDocs) {
      // Inbox links remain anchored to their original files until tracked two-way sync exists.
      if (readInventory(cfg).entries[doc.id]?.vaultPath?.startsWith("OppKnox Inbox/")) { skippedCount++; continue; }
      let sourceFile;
      let bytes;
      try {
        sourceFile = documentPath(doc);
        bytes = readFileSync(sourceFile);
        if (createHash("sha256").update(bytes).digest("hex") !== doc.sha256) { skippedCount++; continue; }
      } catch {
        skippedCount++;
        continue;
      }

      const idx = doc.name.lastIndexOf("/");
      const folderPart = idx > 0 ? doc.name.slice(0, idx) : "";
      const fileName = idx > 0 ? doc.name.slice(idx + 1) : doc.name;
      const ext = extname(fileName).toLowerCase();
      const stem = sanitizeNoteStem(fileName);
      const inventory = readInventory(cfg), tracked = inventory.entries[doc.id];
      const key = `${folderPart}/${stem}`.normalize("NFC").toLowerCase();
      const duplicate = allLibraryDocs.some(other => {
        if (other.id === doc.id) return false;
        const index = other.name.lastIndexOf("/");
        const folder = index > 0 ? other.name.slice(0, index) : "";
        const name = index > 0 ? other.name.slice(index + 1) : other.name;
        return `${folder}/${sanitizeNoteStem(name)}`.normalize("NFC").toLowerCase() === key;
      });
      const suffix = duplicate ? ` -- ${doc.id}` : "";
      const noteName = `${stem}${suffix}.md`;
      let noteRelPath = folderPart ? `Career Library/${folderPart}/${noteName}` : `Career Library/${noteName}`;
      const docTags = Array.isArray(doc.tags) ? doc.tags : [];
      const safeAttachmentName = (fileName.replace(/[\\/:*?"<>|]+/g, "_") || `${doc.id}${ext}`);
      const attachmentName = suffix ? `${safeAttachmentName.slice(0, safeAttachmentName.length - ext.length)}${suffix}${ext}` : safeAttachmentName;
      let attachmentRelPath = folderPart ? `Attachments/${folderPart}/${attachmentName}` : `Attachments/${attachmentName}`;
      // Keep already-linked paths stable if a same-named document is added later.
      if (tracked) {
        if (TEXT_NOTE_EXTS.has(ext) && tracked.vaultPath.startsWith("Career Library/")) noteRelPath = tracked.vaultPath;
        if (!TEXT_NOTE_EXTS.has(ext) && tracked.vaultPath.startsWith("Attachments/")) {
          attachmentRelPath = tracked.vaultPath;
          if (tracked.companions?.length === 1) noteRelPath = tracked.companions[0];
        }
      }
      const primary = TEXT_NOTE_EXTS.has(ext) ? noteRelPath : attachmentRelPath;
      const primaryFile = safeVaultChild(vaultDir, primary);
      const noteFile = safeVaultChild(vaultDir, noteRelPath);
      const primaryExists = existsSync(primaryFile), noteExists = existsSync(noteFile);
      const owner = Object.values(inventory.entries).find(e => e.vaultPath === primary || (e.companions || []).includes(primary));
      const otherOwner = Object.values(inventory.entries).find(e => e.documentId !== doc.id && (e.vaultPath === noteRelPath || (e.companions || []).includes(noteRelPath)));
      if ((owner && owner.documentId !== doc.id) || otherOwner) {
        const inventories = getConfig("obsidianSyncInventories") || {}, key = inventoryKey(cfg);
        inventory.ambiguousPaths = [...new Set([...(inventory.ambiguousPaths || []), otherOwner ? noteRelPath : primary])];
        inventories[key] = inventory; putConfig("obsidianSyncInventories", inventories); skippedCount++; continue;
      }
      if ((inventory.ambiguousPaths || []).includes(primary) || (inventory.ambiguousPaths || []).includes(noteRelPath)) { skippedCount++; continue; }
      if (primaryExists && (!tracked || tracked.vaultPath !== primary || lstatSync(primaryFile).isSymbolicLink() || createHash("sha256").update(readFileSync(primaryFile)).digest("hex") !== tracked.vaultHash)) { skippedCount++; continue; }
      if (!TEXT_NOTE_EXTS.has(ext) && noteExists && (!tracked || !(tracked.companions || []).includes(noteRelPath) || lstatSync(noteFile).isSymbolicLink())) { skippedCount++; continue; }

      if (TEXT_NOTE_EXTS.has(ext)) {
        const rawText = bytes.toString("utf8");
        const hasFrontmatter = /^---\r?\n[\s\S]*?\r?\n---/.test(rawText);
        let noteContent = rawText;
        if (!hasFrontmatter) {
          const fm = [
            "---",
            `title: ${escapeYaml(stem)}`,
            `kind: ${escapeYaml(doc.kind)}`,
            `status: ${escapeYaml(doc.status)}`,
            `knox_document_id: ${escapeYaml(doc.id)}`,
            `updated: ${escapeYaml(doc.createdAt)}`,
            ...(docTags.length
              ? ["tags:", ...docTags.map((t) => `  - ${escapeYaml(t)}`)]
              : []),
            "---",
            "",
          ].join("\n");
          noteContent = fm + rawText;
        }
        const targetNote = safeVaultChild(vaultDir, noteRelPath, {
          createDirs: true,
        });
        writeAtomic(targetNote, noteContent);
        recordTransfer(cfg, doc, noteRelPath, bytes, Buffer.from(noteContent));
        importedNotesCount++;
      } else {
        // Copy binary/rich attachment into Attachments/ and create a companion Markdown note
        const targetAttachment = safeVaultChild(vaultDir, attachmentRelPath, {
          createDirs: true,
        });
        writeAtomic(targetAttachment, bytes);
        copiedAttachmentsCount++;

        let extractedText = "";
        if (includeExtractedText) {
          let cached = buddy.getDocumentText(doc.id);
          if (!cached || cached.status !== "ready") {
            try {
              await buddy.indexDocuments([doc.id], false);
              cached = buddy.getDocumentText(doc.id);
            } catch {
              // ignore indexing failure on unsupported binary
            }
          }
          if (cached?.status === "ready" && cached.text) {
            extractedText = cached.text;
          }
        }

        const companionLines = [
          "---",
          `title: ${escapeYaml(stem)}`,
          `kind: ${escapeYaml(doc.kind)}`,
          `status: ${escapeYaml(doc.status)}`,
          `knox_document_id: ${escapeYaml(doc.id)}`,
          `knox_companion_for: ${escapeYaml(attachmentRelPath)}`,
          `updated: ${escapeYaml(doc.createdAt)}`,
          ...(docTags.length
            ? ["tags:", ...docTags.map((t) => `  - ${escapeYaml(t)}`)]
            : []),
          "---",
          "",
          `# ${stem}`,
          "",
          `Original file: ![[${attachmentRelPath}]]`,
          "",
        ];
        if (doc.notes) {
          companionLines.push("## Notes", "", doc.notes, "");
        }
        if (extractedText) {
          companionLines.push("## Extracted Content", "", extractedText, "");
        }
        const targetNote = safeVaultChild(vaultDir, noteRelPath, {
          createDirs: true,
        });
        // Companion notes can contain the user's edits; keep them when re-exporting.
        if (!noteExists) writeAtomic(targetNote, companionLines.join("\n"));
        recordTransfer(cfg, doc, attachmentRelPath, bytes, bytes, [noteRelPath]);
        importedNotesCount++;
      }
    }

    writeHubNote(vaultDir, cfg.vaultName || "Opportunity Knox Vault");
    const nextCfg = {
      ...cfg,
      lastImportedToVaultAt: new Date().toISOString(),
    };
    putConfig("obsidian", nextCfg);
    return {
      ok: true,
      importedNotesCount,
      copiedAttachmentsCount,
      skippedCount,
      obsidian: status(),
    };
  }

  function inboxPreview() {
    const cfg = getSettings(), resolved = resolveActiveVault(cfg);
    if (!cfg.enabled || resolved.mountPending || !resolved.localDir || !existsSync(resolved.localDir)) fail(409, "Connect the vault before reviewing the Inbox.");
    const root = realpathSync(resolved.localDir), inventory = readInventory(cfg);
    const linkedPaths = new Set(Object.values(inventory.entries).flatMap(e => [e.vaultPath, ...(e.companions || [])]));
    for (const path of inventory.ambiguousPaths || []) linkedPaths.add(path);
    const files = [], possibleMoves = [];
    const missingLinks = inventoryStatus().filter(entry => !entry.vaultExists && !entry.vaultUnavailable && entry.documentExists);
    const inboxDir = join(root, "OppKnox Inbox");
    if (existsSync(inboxDir) && (lstatSync(inboxDir).isSymbolicLink() || !statSync(inboxDir).isDirectory())) fail(409, "OppKnox Inbox must be a regular folder in the vault.");
    const inboxFiles = existsSync(inboxDir) ? walkVaultFiles(inboxDir, { strict: true }).files.map(item => ({ ...item, relPath: "OppKnox Inbox/" + item.relPath })) : [];
    for (const item of inboxFiles) {
      if (linkedPaths.has(item.relPath)) continue;
      const st = statSync(item.fullPath);
      if (st.size === 0 || st.size > 20 * 1024 * 1024) continue;
      const file = { path: item.relPath, size: st.size, sha256: createHash("sha256").update(readFileSync(item.fullPath)).digest("hex") };
      const matches = missingLinks.filter(entry => entry.vaultHash === file.sha256).map(entry => entry.documentId).sort();
      if (matches.length) possibleMoves.push({ ...file, matches }); else files.push(file);
    }
    files.sort((a,b) => a.path.localeCompare(b.path)); possibleMoves.sort((a,b) => a.path.localeCompare(b.path));
    if (files.length + possibleMoves.length > 500) fail(413, "Move at most 500 new files into OppKnox Inbox at a time.");
    const token = createHash("sha256").update(JSON.stringify({ vault: inventoryKey(cfg), files, possibleMoves, linked: [...linkedPaths].sort() })).digest("hex");
    return { files, possibleMoves, token, inboxExists: existsSync(join(root, "OppKnox Inbox")) };
  }

  async function syncFromVault({ autoPrepare = true } = {}) {
    const cfg = getSettings();
    if (!cfg.enabled) fail(400, "Configure or create an Obsidian vault first.");
    const resolved = resolveActiveVault(cfg);
    if (
      resolved.mountPending ||
      !resolved.localDir ||
      !existsSync(resolved.localDir)
    )
      fail(
        409,
        "The Obsidian vault folder is waiting to be mounted. Click Update & restart to attach the host folder first.",
      );
    const vaultDir = realpathSync(resolved.localDir);
    const { files } = walkVaultFiles(vaultDir);
    const inventory = readInventory(cfg);
    const allowedInbox = new Set(inboxPreview().files.map(file => file.path));
    const linkedPaths = new Set(Object.values(inventory.entries).flatMap(e => [e.vaultPath, ...(e.companions || [])]));
    for (const path of inventory.ambiguousPaths || []) linkedPaths.add(path);

    let importedCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    const touchedIds = [];

    for (const item of files) {
      if (!allowedInbox.has(item.relPath) || linkedPaths.has(item.relPath)) continue;
      let bytes;
      try {
        const st = statSync(item.fullPath);
        if (!st.isFile() || st.size === 0 || st.size > 20 * 1024 * 1024)
          continue;
        bytes = readFileSync(item.fullPath);
      } catch {
        continue;
      }

      // Skip generated companion notes that wrap an attachment so we don't duplicate the attachment
      if (MARKDOWN_EXTS.has(item.ext) && bytes.length < 512000) {
        const head = bytes.subarray(0, 4096).toString("utf8");
        if (/^---\r?\n[\s\S]*?^knox_companion_for:\s*.+/m.test(head)) {
          continue;
        }
      }

      // Normalize library document name (strip leading "Career Library/" or "Attachments/" if exported by Knox)
      let normalizedName = item.relPath.slice("OppKnox Inbox/".length);
      if (normalizedName.startsWith("Career Library/")) {
        normalizedName = normalizedName.slice("Career Library/".length);
      } else if (normalizedName.startsWith("Attachments/")) {
        normalizedName = normalizedName.slice("Attachments/".length);
      }

      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const requestId = "obsidian-inbox-" + createHash("sha256").update(inventoryKey(cfg) + "\0" + item.relPath + "\0" + sha256).digest("hex");
      const priorImport = getDocuments().find(d => d.importRequestId === requestId);
      if (priorImport) {
        recordTransfer(cfg, priorImport, item.relPath, bytes, bytes);
        unchangedCount++; touchedIds.push(priorImport.id); continue;
      }

      const saved = saveDocument({
        name: normalizedName,
        kind: "reference",
        status: "approved",
        opportunityId: "",
        content: bytes,
        notes: `Imported from Obsidian Inbox (${cfg.vaultName || "Vault"})`,
        importRequestId: requestId,
      });
      // Ensure "Obsidian" tag is included alongside inferred frontmatter/folder tags
      const docRecord = getDocuments().find((d) => d.id === saved.id);
      if (docRecord) {
        const tags = Array.isArray(docRecord.tags) ? docRecord.tags : [];
        if (!tags.some((t) => t.toLowerCase() === "obsidian")) {
          docRecord.tags = ["Obsidian", ...tags].slice(0, 30);
          putDocument(docRecord);
        }
      }
      recordTransfer(cfg, docRecord, item.relPath, bytes, bytes);
      importedCount++;
      touchedIds.push(saved.id);
    }

    let preparedCount = 0;
    if (autoPrepare && touchedIds.length > 0) {
      const toPrepare = touchedIds.filter(
        (id) => buddy.getDocumentText(id)?.status !== "ready",
      );
      for (let i = 0; i < toPrepare.length; i += 50) {
        await buddy.indexDocuments(toPrepare.slice(i, i + 50), false);
      }
      preparedCount = touchedIds.filter(
        (id) => buddy.getDocumentText(id)?.status === "ready",
      ).length;
    }

    const nextCfg = {
      ...cfg,
      lastSyncedAt: new Date().toISOString(),
    };
    putConfig("obsidian", nextCfg);
    return {
      ok: true,
      importedCount,
      updatedCount,
      unchangedCount,
      preparedCount,
      obsidian: status(),
    };
  }

  async function configure(body) {
    const action = body.action || "create";
    if (!["create", "connect", "disconnect"].includes(action))
      fail(400, "Choose a valid vault action: create, connect, or disconnect.");

    if (action === "disconnect") {
      const current = getSettings();
      const next = {
        ...current,
        enabled: false,
      };
      for (const id of current.sourceIds || []) deleteSourceCache(id);
      next.sourceIds = [];
      putConfig("obsidian", next);
      rmSync(join(dataDir, "pending-vault.json"), { force: true });
      return { ok: true, obsidian: status() };
    }

    const locationType =
      body.locationType === "hostPath" ? "hostPath" : "subpath";
    const readOnly = action === "connect" && Boolean(body.readOnly);
    const importExisting = !readOnly && Boolean(body.importExisting);
    const importOnlyPrepared = Boolean(body.importOnlyPrepared);
    const shouldSyncFromVault = Boolean(body.syncFromVault);

    let subpath = "obsidian-vault";
    let hostPath = "";
    let vaultName =
      typeof body.vaultName === "string"
        ? body.vaultName.trim().slice(0, 120)
        : "";

    if (locationType === "subpath") {
      subpath = cleanVaultSubpath(body.subpath || "obsidian-vault", fail);
      if (!vaultName) vaultName = basename(subpath);
      if (action === "connect") {
        let existingDir;
        try {
          existingDir = safePath(filesDir, subpath, { create: false });
        } catch {
          fail(
            400,
            `Folder "${subpath}" was not found inside your document folder. Choose "Create new vault" or enter an existing folder.`,
          );
        }
        if (!existsSync(existingDir) || !statSync(existingDir).isDirectory()) {
          fail(
            400,
            `Folder "${subpath}" does not exist inside your document folder.`,
          );
        }
        if (!readOnly) ensureObsidianMetadata(existingDir);
      } else {
        // action === "create"
        const createdDir = safePath(filesDir, subpath, { create: true });
        ensureObsidianMetadata(createdDir);
        mkdirSync(join(createdDir, "Career Library"), { recursive: true });
        mkdirSync(join(createdDir, "Attachments"), { recursive: true });
        mkdirSync(join(createdDir, "OppKnox Inbox"), { recursive: true });
        writeHubNote(createdDir, vaultName);
      }
      rmSync(join(dataDir, "pending-vault.json"), { force: true });
    } else {
      // locationType === "hostPath"
      const rawHost =
        typeof body.hostPath === "string" ? body.hostPath.trim() : "";
      if (
        !rawHost ||
        !isAbsolute(rawHost) ||
        rawHost.includes("\0") ||
        rawHost.includes("\n") ||
        rawHost.includes("\r")
      ) {
        fail(
          400,
          "Enter an absolute folder path on the hosting machine for your Obsidian vault.",
        );
      }
      hostPath = rawHost.replace(/\/+$/, "") || "/";
      if (!vaultName) vaultName = basename(hostPath) || "Obsidian Vault";

      // Check if we can access/create directly (local mode, test mode, or inside filesDir)
      const inDockerContainer = dataDir === "/data";
      const insideMountedFiles =
        hostFilesDir &&
        (hostPath === hostFilesDir || hostPath.startsWith(hostFilesDir + sep));
      const alreadyMountedVault =
        envVaultDir &&
        envHostVaultDir &&
        resolve(envHostVaultDir) === resolve(hostPath) &&
        existsSync(envVaultDir) &&
        (!inDockerContainer || !readOnly || process.env.BOARD_VAULT_READ_ONLY === "1");

      if (!inDockerContainer || (insideMountedFiles && !readOnly) || alreadyMountedVault) {
        const targetLocal = alreadyMountedVault
          ? envVaultDir
          : insideMountedFiles
            ? hostPath === hostFilesDir
              ? filesDir
              : safePath(
                  filesDir,
                  hostPath
                    .slice(hostFilesDir.length)
                    .replace(/^[/\\]+/, "")
                    .replace(/\\/g, "/"),
                  { create: action === "create" },
                )
            : hostPath;

        if (action === "connect") {
          if (
            !existsSync(targetLocal) ||
            !statSync(targetLocal).isDirectory()
          ) {
            fail(
              400,
              `Obsidian vault folder not found at ${hostPath}. Check the path or choose "Create new vault".`,
            );
          }
          if (!readOnly) {
            const probe = join(targetLocal, `.board-write-check-${randomUUID()}`);
            try {
              writeFileSync(probe, "");
              unlinkSync(probe);
            } catch {
              fail(400, `Obsidian vault folder is not writable: ${hostPath}`);
            }
            ensureObsidianMetadata(targetLocal);
          }
        } else {
          // action === "create"
          try {
            mkdirSync(targetLocal, { recursive: true });
          } catch {
            fail(
              400,
              `Could not create Obsidian vault folder at ${hostPath}. Check permissions.`,
            );
          }
          ensureObsidianMetadata(targetLocal);
          mkdirSync(join(targetLocal, "Career Library"), { recursive: true });
          mkdirSync(join(targetLocal, "Attachments"), { recursive: true });
          mkdirSync(join(targetLocal, "OppKnox Inbox"), { recursive: true });
          writeHubNote(targetLocal, vaultName);
        }
        rmSync(join(dataDir, "pending-vault.json"), { force: true });
      } else {
        // Running inside Docker and pointing to an unmounted host path: write pending-vault.json for launcher
        writeAtomic(
          join(dataDir, "pending-vault.json"),
          JSON.stringify(
            {
              hostPath,
              create: action === "create",
              readOnly,
              requestedAt: new Date().toISOString(),
            },
            null,
            2,
          ) + "\n",
        );
      }
    }

    const prev = getSettings();
    const changingSource = prev.enabled && (prev.locationType !== locationType || (locationType === "hostPath" ? prev.hostPath !== hostPath : prev.subpath !== subpath) || !readOnly);
    if (changingSource) for (const id of prev.sourceIds || []) deleteSourceCache(id);
    const nextCfg = {
      ...prev,
      ...(changingSource ? {sourceIds: []} : {}),
      enabled: true,
      locationType,
      subpath,
      hostPath,
      vaultName,
      readOnly,
    };
    putConfig("obsidian", nextCfg);

    let importResult = null;
    let syncResult = null;
    const currentStatus = status();
    if (!currentStatus.mountPending && currentStatus.vaultStats.exists) {
      if (importExisting) {
        importResult = await importSourcesToVault({
          onlyPrepared: importOnlyPrepared,
          includeExtractedText: true,
        });
      }
      if (shouldSyncFromVault) {
        syncResult = await syncFromVault({ autoPrepare: true });
      }
    }

    return {
      ok: true,
      obsidian: status(),
      ...(importResult ? { importedToVault: importResult } : {}),
      ...(syncResult ? { syncedFromVault: syncResult } : {}),
    };
  }

  function availableSources() {
    const cfg = getSettings();
    const resolved = resolveActiveVault(cfg);
    if (!cfg.enabled || !cfg.readOnly || resolved.mountPending || !resolved.localDir || !existsSync(resolved.localDir)) return [];
    const root = realpathSync(resolved.localDir);
    const identity = resolved.resolvedHostPath;
    return walkVaultFiles(root).files.map((item) => ({
      id: "vault-" + createHash("sha256").update(identity + "\0" + item.relPath).digest("hex"),
      path: item.relPath,
      fullPath: item.fullPath,
    }));
  }
  function sourceDocuments() {
    const cfg = getSettings();
    const selected = new Set(cfg.sourceIds || []);
    if (!selected.size) return [];
    return availableSources().filter((item) => selected.has(item.id)).map((item) => ({
      id: item.id, name: "Obsidian: " + item.path, kind: "reference", status: "approved",
      opportunityId: "", readOnlyVaultSource: true, sourcePath: item.path,
    }));
  }
  function sourcePath(doc) {
    const item = availableSources().find((entry) => entry.id === doc.id && entry.path === doc.sourcePath);
    if (!item) throw Error("Read-only source unavailable");
    return item.fullPath;
  }
  function staleVaultSources() {
    const cfg = getSettings(), resolved = resolveActiveVault(cfg);
    if (!cfg.enabled || cfg.readOnly) fail(403, "Connect a writable vault to clean up exported sources.");
    if (resolved.mountPending || !resolved.localDir || !existsSync(resolved.localDir)) fail(409, "Reconnect the vault before cleaning up.");
    const root = realpathSync(resolved.localDir), live = new Set(getDocuments().map(d => d.id));
    const candidates = new Set(), protectedAttachments = new Set();
    const field = (text, key) => { const raw = text.match(new RegExp("^" + key + ":\\s*(.+)$", "m"))?.[1]?.trim(); if (!raw) return ""; try { return JSON.parse(raw); } catch { return raw; } };
    for (const file of walkVaultFiles(root).files) {
      if (!file.relPath.startsWith("Career Library/") || file.ext !== ".md") continue;
      const text = readFileSync(file.fullPath, "utf8"), fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
      if (!fm) continue;
      const id = field(fm, "knox_document_id"), attachment = field(fm, "knox_companion_for");
      if (typeof attachment === "string" && attachment.startsWith("Attachments/") && (!id || live.has(id))) protectedAttachments.add(attachment);
      if (typeof id !== "string" || !id || live.has(id)) continue;
      candidates.add(file.relPath);
      if (typeof attachment === "string" && attachment.startsWith("Attachments/")) {
        const path = safeVaultChild(root, attachment);
        if (existsSync(path) && !lstatSync(path).isSymbolicLink() && statSync(path).isFile()) candidates.add(attachment);
      }
    }
    const files = [...candidates].filter(p => !protectedAttachments.has(p)).sort();
    const token = createHash("sha256").update(root + JSON.stringify(files.map(p => [p, createHash("sha256").update(readFileSync(safeVaultChild(root,p))).digest("hex")]))).digest("hex");
    return { root, files, token };
  }

  function wipeVaultPlan() {
    const cfg = getSettings(), resolved = resolveActiveVault(cfg);
    if (!cfg.enabled || cfg.readOnly) fail(403, "Connect a writable vault first.");
    if (resolved.mountPending || !resolved.localDir || !existsSync(resolved.localDir)) fail(409, "Reconnect the vault first.");
    const root = realpathSync(resolved.localDir), inventory = readInventory(cfg), files = new Set();
    for (const entry of Object.values(inventory.entries)) {
      // Inbox originals were created by the user and must survive Wipe Vault.
      if (entry.vaultOwned === false || entry.vaultPath.startsWith("OppKnox Inbox/")) continue;
      for (const rel of [entry.vaultPath, ...(entry.companions || [])]) {
        const full = safeVaultChild(root, rel);
        if (existsSync(full) && !lstatSync(full).isSymbolicLink() && statSync(full).isFile()) files.add(rel);
      }
    }
    for (const file of walkVaultFiles(root, { strict: true }).files) {
      if (file.relPath === "00 - Opportunity Knox Hub.md") {
        if (/^  - opportunity-knox$/m.test(readFileSync(file.fullPath, "utf8"))) files.add(file.relPath);
        continue;
      }
      if (!file.relPath.startsWith("Career Library/") || file.ext !== ".md") continue;
      const fm = readFileSync(file.fullPath,"utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
      if (!fm || !/^knox_document_id:\s*.+$/m.test(fm)) continue;
      files.add(file.relPath);
      const raw = fm.match(/^knox_companion_for:\s*(.+)$/m)?.[1]?.trim();
      if (!raw) continue;
      let companion; try { companion = JSON.parse(raw); } catch { companion = raw; }
      if (typeof companion !== "string" || !companion.startsWith("Attachments/")) continue;
      const full = safeVaultChild(root,companion);
      if (existsSync(full) && !lstatSync(full).isSymbolicLink() && statSync(full).isFile()) files.add(companion);
    }
    const selected = [...files].sort();
    const token = createHash("sha256").update(root + JSON.stringify(selected.map(path=>[path,createHash("sha256").update(readFileSync(safeVaultChild(root,path))).digest("hex")]))).digest("hex");
    return { root, files:selected, token };
  }

  async function handle(path, method, req, res, { json, readBody }) {
    if (path === "/api/obsidian/export-linked-change" && method === "POST") {
      const body = await readBody(req), cfg = getSettings();
      if (cfg.readOnly) fail(403, "Connect a writable vault first.");
      const preview = syncPreview();
      if (typeof body.token !== "string" || body.token !== preview.token) fail(409, "Documents or vault files changed. Review again.");
      if (typeof body.documentId !== "string") fail(400, "Choose a linked document.");
      const change = preview.changes.find(c => c.documentId === body.documentId);
      if (!change || change.type !== "changed-local") fail(409, "This document no longer has a local-only change. Review again.");
      const entry = inventoryStatus().find(e => e.documentId === body.documentId), doc = getDocuments().find(d => d.id === body.documentId);
      if (!entry || !doc || doc.sha256 !== entry.currentLocalHash) fail(409, "Refresh storage before exporting the changed local file.");
      const bytes = readFileSync(documentPath(doc));
      if (createHash("sha256").update(bytes).digest("hex") !== entry.currentLocalHash) fail(409, "The local file changed. Review again.");
      const root = realpathSync(resolveActiveVault(cfg).localDir), target = safeVaultChild(root, entry.vaultPath);
      const prior = readFileSync(target);
      if (createHash("sha256").update(prior).digest("hex") !== entry.currentVaultHash) fail(409, "The vault file changed. Review again.");
      const archive = ".trash/Opportunity Knox/" + randomUUID() + "/" + entry.vaultPath;
      const saved = safeVaultChild(root, archive, {createDirs:true});
      renameSync(target, saved);
      try { writeAtomic(target, bytes); } catch(error) { renameSync(saved, target); throw error; }
      recordTransfer(cfg, doc, entry.vaultPath, bytes, bytes, entry.companions || []);
      json(res, {ok:true,archive}); return true;
    }
    if (path === "/api/obsidian/import-linked-change" && method === "POST") {
      const body = await readBody(req), preview = syncPreview();
      if (typeof body.token !== "string" || body.token !== preview.token) fail(409, "Documents or vault files changed. Review again.");
      if (typeof body.documentId !== "string") fail(400, "Choose a linked document.");
      const change = preview.changes.find(c => c.documentId === body.documentId);
      if (!change || change.type !== "changed-vault") fail(409, "This document no longer has a vault-only change. Review again.");
      const cfg = getSettings(), entry = inventoryStatus().find(e => e.documentId === body.documentId);
      const doc = getDocuments().find(d => d.id === body.documentId);
      if (!entry || !doc || doc.status === "submitted") fail(409, "This document cannot be updated.");
      const root = realpathSync(resolveActiveVault(cfg).localDir), bytes = readFileSync(safeVaultChild(root, entry.vaultPath));
      if (createHash("sha256").update(bytes).digest("hex") !== entry.currentVaultHash) fail(409, "The vault file changed. Review again.");
      const result = replaceDocumentContent(doc.id, entry.currentRevision, entry.currentLocalHash, bytes);
      recordTransfer(cfg, doc, entry.vaultPath, bytes, bytes, entry.companions || []);
      json(res, {ok:true, backup:result.backup}); return true;
    }
    if (path === "/api/obsidian/inbox/create" && method === "POST") {
      await readBody(req); const cfg = getSettings(), resolved = resolveActiveVault(cfg);
      if (!cfg.enabled || cfg.readOnly) fail(403, "Connect a writable vault to create an Inbox.");
      if (resolved.mountPending || !resolved.localDir || !existsSync(resolved.localDir)) fail(409, "Reconnect the vault first.");
      safeVaultChild(realpathSync(resolved.localDir), "OppKnox Inbox/.placeholder", { createDirs: true });
      json(res, { ok: true }); return true;
    }
    if (path === "/api/obsidian/inbox" && method === "POST") {
      const body = await readBody(req), preview = inboxPreview();
      if (body.token === undefined) { json(res, preview); return true; }
      if (typeof body.token !== "string" || body.token !== preview.token) fail(409, "The Inbox changed. Review it again before importing.");
      json(res, await syncFromVault({ autoPrepare: true })); return true;
    }

    if (path === "/api/obsidian/wipe" && method === "POST") {
      const body = await readBody(req), plan = wipeVaultPlan();
      if (body.token === undefined) { json(res,{ files:plan.files, token:plan.token }); return true; }
      if (typeof body.token !== "string" || body.token !== plan.token) fail(409, "The vault changed. Review the list again.");
      const archive = ".trash/Opportunity Knox/" + randomUUID(), moved = [];
      try {
        for (const path of plan.files) {
          const source=safeVaultChild(plan.root,path), target=safeVaultChild(plan.root,archive+"/"+path,{createDirs:true});
          renameSync(source,target); moved.push({source,target});
        }
      } catch (error) { for (const item of moved.reverse()) renameSync(item.target,item.source); throw error; }
      json(res,{removedCount:moved.length,archive}); return true;
    }
    if (path === "/api/obsidian/cleanup" && method === "POST") {
      const body = await readBody(req), plan = staleVaultSources();
      if (!body.token) { json(res, { files: plan.files, token: plan.token }); return true; }
      if (body.token !== plan.token) fail(409, "Vault sources changed. Review the cleanup again.");
      const archive = ".trash/Opportunity Knox/" + randomUUID(), moved = [];
      try {
        for (const file of plan.files) {
          const source = safeVaultChild(plan.root, file), target = safeVaultChild(plan.root, archive + "/" + file, { createDirs: true });
          renameSync(source, target); moved.push({ source, target });
        }
      } catch (error) { for (const item of moved.reverse()) renameSync(item.target, item.source); throw error; }
      writeHubNote(plan.root, getSettings().vaultName);
      json(res, { removedCount: moved.length, archive }); return true;
    }
    if (path === "/api/obsidian/sync-preview" && method === "POST") {
      const body = await readBody(req), preview = syncPreview();
      if (body.token !== undefined) {
        if (typeof body.token !== "string" || body.token !== preview.token) fail(409, "Documents or vault files changed. Review the sync again.");
        json(res, { valid: true });
      } else json(res, preview);
      return true;
    }
    if (path === "/api/obsidian/sync-inventory" && method === "GET") {
      json(res, { entries: inventoryStatus(), ambiguousPaths: readInventory(getSettings()).ambiguousPaths || [] }); return true;
    }
    if (path === "/api/obsidian" && method === "GET") {
      json(res, status());
      return true;
    }
    if (path === "/api/obsidian/sources" && method === "GET") {
      const selected = new Set(getSettings().sourceIds || []);
      json(res, { sources: availableSources().map(({ id, path }) => ({ id, path, selected: selected.has(id) })) });
      return true;
    }
    if (path === "/api/obsidian/sources" && method === "POST") {
      const body = await readBody(req);
      if (!Array.isArray(body.ids) || body.ids.length > 1000 || body.ids.some((id) => typeof id !== "string")) fail(400, "Choose up to 1,000 vault sources.");
      const allowed = new Set(availableSources().map((item) => item.id));
      if (body.ids.some((id) => !allowed.has(id))) fail(400, "One or more vault sources are unavailable.");
      const previous = getSettings();
      for (const id of previous.sourceIds || []) if (!body.ids.includes(id)) deleteSourceCache(id);
      putConfig("obsidian", { ...previous, sourceIds: [...new Set(body.ids)] });
      json(res, { ok: true });
      return true;
    }
    if (path === "/api/obsidian/configure" && method === "POST") {
      const body = await readBody(req);
      json(res, await configure(body));
      return true;
    }
    if (path === "/api/obsidian/import-to-vault" && method === "POST") {
      const body = await readBody(req);
      json(
        res,
        await importSourcesToVault({
          onlyPrepared: Boolean(body.onlyPrepared),
          includeExtractedText: body.includeExtractedText !== false,
        }),
      );
      return true;
    }
    if (path === "/api/obsidian/sync-from-vault" && method === "POST") {
      const body = await readBody(req);
      json(
        res,
        await syncFromVault({
          autoPrepare: body.autoPrepare !== false,
        }),
      );
      return true;
    }
    return false;
  }

  async function exportDocumentToVault(doc, { subfolder = "Generated" } = {}) {
    const cfg = getSettings();
    if (!cfg.enabled) fail(400, "Obsidian vault is not enabled.");
    if (cfg.readOnly) fail(400, "Obsidian vault is configured as read-only. Export is disabled.");
    const resolved = resolveActiveVault(cfg);
    if (resolved.mountPending || !resolved.localDir || !existsSync(resolved.localDir)) {
      fail(400, "Obsidian vault directory is currently unavailable.");
    }
    const vaultDir = realpathSync(resolved.localDir);
    const fileName = basename(doc.name);
    const targetRelPath = subfolder ? `${subfolder}/${fileName}` : fileName;
    const targetFile = safeVaultChild(vaultDir, targetRelPath, { createDirs: true });
    const bytes = readFileSync(documentPath(doc));
    writeAtomic(targetFile, bytes);
    return { ok: true, relPath: targetRelPath, vaultName: cfg.vaultName || "Opportunity Knox Vault" };
  }

  return {
    status,
    sourceDocuments,
    sourcePath,
    configure,
    importSourcesToVault,
    syncFromVault,
    exportDocumentToVault,
    handle,
  };
}
