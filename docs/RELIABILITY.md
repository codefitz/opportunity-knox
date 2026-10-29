# Reliability and recovery

## Recoverable uploads

Career Library and opportunity Documents save queued file bytes, paths and upload options in this browser’s IndexedDB. Reloading or leaving the page retains the queue; select Upload to continue. Pause aborts the active client request and retains unresolved files. Successful files leave the queue. Each first attempt freezes its document options and retry identifier before sending; a retry after an unknown response recovers the existing server version instead of creating a duplicate. Unattempted files stay ahead of earlier failures, including optional batches of 500. Other tabs cannot take a live queue lease; an abandoned lease expires after 30 seconds.

The queue is scoped to this board and library/opportunity. It does not roam across devices and is not included in server backups. Browser quotas, private-session closure and clearing site data can remove browser storage; if saving fails, the UI reports it and originals remain unchanged. Files remain limited to 15 MB each in the browser, without a file-count cap. Other brief attachment composers are separate from this bulk queue.

## Backups

In Settings → Reliability & recovery, enable Daily or Weekly and save. Scheduling is off until selected. Backups run while the service is running; one due backup is caught up after startup, without replaying every missed interval. Failure retains the previous successful backup and records an error, with a one-hour retry backoff. Run backup now is also available. No completed backups are deleted automatically. Maintenance defers scheduled work until a workspace switch has committed.

The product launcher stops an existing board, verifies/copies every managed document and snapshots all SQLite tables before rebuild/restart. It refuses the upgrade if verification fails and attempts to restart the previous service/image. The latest pre-upgrade snapshot is recorded privately in application state. Incomplete snapshots retain no completed backup name. Hash-mismatched files cannot become a successful backup. Backups contain credentials and any saved API keys; keep the backup directory private. Read-only/in-place external originals are not copied unless they are managed documents; their selected caches/configuration follow the existing backup format.

## Preview and apply

Settings offers three host-managed actions:

1. **Copy documents to a new folder:** choose an existing host folder. A new private workspace subfolder is created there. Managed IDs/versions/submitted bytes are preserved; original files remain.
2. **Reconnect an existing document folder:** choose a folder containing the recorded relative file paths and exact hashes. This can recover a missing previous managed root without changing candidate bytes.
3. **Activate a backup as the live workspace:** find a completed full backup in the configured backup folder. The board validates an isolated copy first, previews it and, after confirmation, replaces the active SQLite workspace and remaps its managed originals to private restored storage. This replaces rather than merges records.

The preview shows the destination, document count and size. Review it, tick confirmation and apply. Edits to the live workspace or changed source bytes invalidate the preview. Previews expire after 30 minutes. Active AI/indexing/review work must finish or be cancelled first. Pending mount/restart requests must finish first too. Unavailable read-only mounts block the switch before the service is stopped. Read-only sources/vaults and symbolic-link backup escapes are rejected before write probes or copying.

The host helper stops the board, rechecks the snapshot, takes a complete pre-change backup, copies/verifies files, installs metadata atomically and checks the restarted service. The old folders remain. Older backups stay in their earlier locations; the new storage contains a portable full backup of the pre-change workspace. Failed activation restores the previous database/configuration. An interrupted preparation or database switch is recovered from a private transaction journal on launcher/helper restart. Refresh recovery status to resume observing an operation; interrupted work requires a new preview, not an automatic destructive retry.

Restore activation clears restored login sessions. Sign in using the restored workspace’s password. Saved API credentials belong to that backup. Existing host read-only source access is retained, without granting new host-folder access from restored metadata; reconnect unavailable external sources explicitly. Changed file metadata may require vector reindexing under the existing freshness checks. SQLite stays in private application state rather than the document folder.

## Portable restore

On a clean installation, use the launcher’s storage selection to choose a document root containing the transferred full backup under its backup subfolder. Set up/sign in to the clean board, find the backup and use Activate. Original-host file paths are not required for managed originals: they are validated from the backup and remapped. Native cloud documents, unselected external originals and the host’s Codex sign-in are outside managed-file backup/activation. Historical JSON record import/duplicate matching and record merging remain separate planned work.
