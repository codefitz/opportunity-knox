#!/usr/bin/env node
import { restoreIsolatedBackup } from '../server/backup-restore.mjs';
const [root, name, destination, ...extra] = process.argv.slice(2);
if (!root || !name || !destination || extra.length) {
  console.error('Usage: node scripts/restore-isolated.mjs <backup-folder> <backup-name> <new-workspace-folder>');
  process.exitCode = 1;
} else {
  try { console.log(JSON.stringify(restoreIsolatedBackup(root,name,destination),null,2)); }
  catch (error) { console.error('Restore refused: '+error.message); process.exitCode=1; }
}
