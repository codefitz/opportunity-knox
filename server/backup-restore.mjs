import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectBackup } from './backup-inspect.mjs';

// Creates an offline workspace only. Never opens or replaces the running board.
export function restoreIsolatedBackup(root, name, destination) {
  const inspection = inspectBackup(root, name);
  if (!inspection.valid) throw Error('Backup failed validation. No restore was created.');
  const target = resolve(destination);
  const backupRoot = resolve(root);
  if (target === backupRoot || target.startsWith(backupRoot + sep) || backupRoot.startsWith(target + sep)) throw Error('Restore destination must be separate from the backup folder.');
  mkdirSync(target, { mode: 0o700 }); // Existing destinations are deliberately refused.
  let db;
  try {
    const state = join(target, 'state'), files = join(target, 'files');
    mkdirSync(state, { mode: 0o700 }); mkdirSync(files, { mode: 0o700 });
    const databasePath = join(state, 'board.sqlite');
    copyFileSync(join(root, name, 'board.sqlite'), databasePath);
    db = new DatabaseSync(databasePath);
    const documents = db.prepare('SELECT id,data FROM documents').all();
    db.exec('BEGIN');
    for (const row of documents) {
      const doc = JSON.parse(row.data);
      if (!/^[0-9a-f-]{36}$/i.test(row.id)) throw Error('Invalid document identifier.');
      const bytes = readFileSync(join(root, name, 'documents', row.id));
      if (createHash('sha256').update(bytes).digest('hex') !== doc.sha256) throw Error('A backup document changed during restore.');
      writeFileSync(join(files, row.id), bytes, { flag: 'wx', mode: 0o600 });
      db.prepare('UPDATE documents SET data=? WHERE id=?').run(JSON.stringify({...doc,storageRoot:files,relativePath:row.id}), row.id);
    }
    db.exec('COMMIT'); db.close(); db = null;
    const report = {backup:name, destination:target, validated:true, documentsRestored:documents.length, counts:inspection.counts, started:false, containsPrivateCredentials:true};
    writeFileSync(join(target,'restore-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    return report;
  } catch (error) {
    try { db?.close(); } catch {}
    rmSync(target, {recursive:true,force:true});
    throw error;
  }
}
