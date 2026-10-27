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

function walkVaultFiles(vaultRoot) {
  const base = realpathSync(vaultRoot);
  const files = [];
  const folderSet = new Set();

  function walk(currentDir, relPrefix) {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      const fullPath = join(currentDir, entry.name);
      try {
        if (lstatSync(fullPath).isSymbolicLink()) continue;
        const actual = realpathSync(fullPath);
        if (!inside(base, actual)) continue;
      } catch {
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
      lastSyncedAt: cfg.lastSyncedAt || "",
      lastImportedToVaultAt: cfg.lastImportedToVaultAt || "",
    };
  }

  function writeHubNote(vaultDir, vaultName) {
    const docs = getDocuments().filter((d) => !d.opportunityId);
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
          const relNote =
            folderName === "General"
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
      let sourceFile;
      let bytes;
      try {
        sourceFile = documentPath(doc);
        bytes = readFileSync(sourceFile);
      } catch {
        skippedCount++;
        continue;
      }

      const idx = doc.name.lastIndexOf("/");
      const folderPart = idx > 0 ? doc.name.slice(0, idx) : "";
      const fileName = idx > 0 ? doc.name.slice(idx + 1) : doc.name;
      const ext = extname(fileName).toLowerCase();
      const stem = sanitizeNoteStem(fileName);
      const noteRelPath = folderPart
        ? `Career Library/${folderPart}/${stem}.md`
        : `Career Library/${stem}.md`;
      const docTags = Array.isArray(doc.tags) ? doc.tags : [];

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
        importedNotesCount++;
      } else {
        // Copy binary/rich attachment into Attachments/ and create a companion Markdown note
        const safeAttachmentName =
          fileName.replace(/[\\/:*?"<>|]+/g, "_") || `${doc.id}${ext}`;
        const attachmentRelPath = folderPart
          ? `Attachments/${folderPart}/${safeAttachmentName}`
          : `Attachments/${safeAttachmentName}`;
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
        writeAtomic(targetNote, companionLines.join("\n"));
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
    const existingDocs = getDocuments().filter((d) => !d.opportunityId);

    let importedCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    const touchedIds = [];

    for (const item of files) {
      if (item.relPath === "00 - Opportunity Knox Hub.md") continue;
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
      let normalizedName = item.relPath;
      if (normalizedName.startsWith("Career Library/")) {
        normalizedName = normalizedName.slice("Career Library/".length);
      } else if (normalizedName.startsWith("Attachments/")) {
        normalizedName = normalizedName.slice("Attachments/".length);
      }

      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const sameFile = existingDocs.find(
        (d) =>
          (d.name === normalizedName || d.name === item.relPath) &&
          d.sha256 === sha256,
      );
      if (sameFile) {
        const currentTags = Array.isArray(sameFile.tags) ? sameFile.tags : [];
        if (!currentTags.some((t) => t.toLowerCase() === "obsidian")) {
          sameFile.tags = ["Obsidian", ...currentTags].slice(0, 30);
          sameFile.revision = (sameFile.revision || 1) + 1;
          putDocument(sameFile);
        }
        unchangedCount++;
        touchedIds.push(sameFile.id);
        continue;
      }

      const hadPriorVersion = existingDocs.some(
        (d) => d.name === normalizedName,
      );
      const saved = saveDocument({
        name: normalizedName,
        kind: "reference",
        status: "approved",
        opportunityId: "",
        content: bytes,
        notes: `Synced from Obsidian vault (${cfg.vaultName || "Vault"})`,
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
      if (hadPriorVersion) updatedCount++;
      else importedCount++;
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
  async function handle(path, method, req, res, { json, readBody }) {
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

  return {
    status,
    sourceDocuments,
    sourcePath,
    configure,
    importSourcesToVault,
    syncFromVault,
    handle,
  };
}
