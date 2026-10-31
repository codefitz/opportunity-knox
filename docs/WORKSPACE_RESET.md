# Opportunity deletion and workspace reset

| Control | Removes from the board | Keeps |
| --- | --- | --- |
| Delete opportunity, in opportunity details | That opportunity, timeline, interviews, offers, application packs, linked tasks, document links, assessments and associated AI history | Other opportunities, Career Hub, standalone chats, unlinked tasks, profile and settings |
| Clear all opportunities, above the list/Kanban board | All opportunities and their associated data, including completed and filtered-out records | Career Hub, standalone chats, unlinked tasks, profile and settings |
| Settings → Reset workspace | All opportunities, tasks, document links/prepared text/local vectors, conversations, attachments stored in the database, AI history, feedback, criteria, preferences and saved AI/connection credentials | Exact profile name/photo, sign-in, document/reference/backup folder locations, host mounts, existing files and backups |

These controls remove board records and links. They retain physical document files, including submitted versions, and do not change Google/Obsidian originals or remote vector stores. Reset clears their local configuration. This is a fresh-workspace reset, not secure erasure of files or backups.

## Confirmation and recovery

Each control first shows the subject, affected counts, removed/retained scope and backup requirement. Enter the exact displayed phrase: `DELETE OPPORTUNITY`, `CLEAR ALL OPPORTUNITIES` or `RESET WORKSPACE`. Cancelling the preview changes no records.

A verified private full backup is mandatory before removal. It includes the pre-action database, credentials and tracked document bytes, including submitted versions. If a required file cannot be backed up, the action stops without removing records. The success message gives the backup location. Use **Settings → Recovery** to inspect and restore that backup through the existing recovery workflow; restoration restores the saved workspace rather than merging selected records.

Reset returns preferences to application defaults and reloads the client, while keeping the current account signed in. Configure AI providers and connections again as needed. Older tabs reload when their next API response identifies the new workspace; writes carrying the previous workspace identity are rejected. Staged uploads from the previous workspace cannot be committed after reset.

## Server behaviour

Authenticated clients use `POST /api/workspace-actions/preview` with an action (`delete-opportunity`, `clear-opportunities` or `reset-workspace`) and an `opportunityId` for individual deletion. Apply with `POST /api/workspace-actions/apply`, the returned `planId`, `confirm: true` and exact `confirmation` phrase.

Preview plans expire after ten minutes, are bounded in memory and are consumed after success. Database changes after preview require a fresh review. Pending host changes, other saving requests, active AI requests/tasks/automation and indexing block both preview and apply. A disconnected client does not release the saving guard while its document processing continues.

Apply rechecks the database fingerprint under a SQLite write transaction, creates the backup and removes the selected rows atomically. Write failure rolls back database changes. Document preview caches are invalidated; reset also clears the in-memory index-job view and rotates the upload/workspace identity. Older API clients without the identity header remain supported.
