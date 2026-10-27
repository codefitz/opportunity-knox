import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function regular(path, directory = false) {
  const stat = lstatSync(path);
  return !stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile());
}
export function listBackups(root) {
  if (!existsSync(root)) return [];
  if (!regular(root, true)) throw Error("Backup folder is unavailable.");
  return readdirSync(root, {withFileTypes:true}).filter((entry) => entry.isDirectory() && /^board-[a-zA-Z0-9-]+$/.test(entry.name)).map((entry) => ({name:entry.name})).sort((a,b) => b.name.localeCompare(a.name));
}
export function inspectBackup(root, name) {
  if (typeof name !== "string" || !/^board-[a-zA-Z0-9-]+$/.test(name)) throw Error("Choose a valid backup.");
  const dir = join(root, name);
  if (!regular(root,true) || !regular(dir,true) || !regular(join(dir,"manifest.json")) || !regular(join(dir,"board.sqlite")) || !regular(join(dir,"documents"),true)) throw Error("Backup is incomplete or contains an unsupported link.");
  const manifest = JSON.parse(readFileSync(join(dir,"manifest.json"),"utf8"));
  if (manifest.format !== "opportunity-board-backup" || manifest.version !== 1 || !Array.isArray(manifest.documents)) throw Error("Unsupported backup manifest.");
  const snapshot = new DatabaseSync(join(dir,"board.sqlite"), {readOnly:true});
  try {
    const integrity = snapshot.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok") throw Error("Database integrity check failed.");
    const counts = {};
    for (const table of ["records","documents","tasks","buddy_messages","document_text"]) counts[table] = Number(snapshot.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
    const docs = snapshot.prepare("SELECT id,data FROM documents").all();
    const manifestIds = new Set(manifest.documents.map((doc) => doc.id));
    const issues = [];
    if (manifestIds.size !== manifest.documents.length || docs.length !== manifestIds.size) issues.push("Document manifest and database counts do not match.");
    let checked = 0;
    for (const row of docs) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id) || !manifestIds.has(row.id)) {issues.push("Invalid or missing document entry."); continue;}
      const doc = JSON.parse(row.data), file = join(dir,"documents",row.id);
      try {
        if (doc.id !== row.id || !regular(file)) throw Error();
        const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
        if (!doc.sha256 || hash !== doc.sha256) issues.push(`Document ${row.id} does not match its recorded hash.`);
        else checked++;
      } catch { issues.push(`Document ${row.id} is missing or unreadable.`); }
    }
    return {name,createdAt:manifest.createdAt || "",counts,checked,issues,valid:issues.length === 0,containsPrivateCredentials:true};
  } finally {snapshot.close();}
}
