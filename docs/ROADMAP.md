# Implementation roadmap

Started 22 October 2026. See `PLAN.md` for the agreed product plan. The private local board is running; production remote hosting remains to be configured.

## First increment — implemented

- [x] Password setup/login for a private personal board.
- [x] Eight-stage board, list view, search, outcomes, and opportunity details.
- [x] SQLite persistence and stage history with editable effective dates.
- [x] Repeatable interview and communication entries and combined notes summary.
- [x] Application/reference file uploads, downloads, and document status/version records.
- [x] In-app storage subdirectories and pending host-folder changes.
- [x] One-command Docker lifecycle with remembered storage, health checks, and desktop shortcuts.
- [x] Meaningful persistence/API and launcher tests, production build, browser review.
- [x] Record export and consistent local backup.

Verification details and limits are recorded in `VERIFICATION.md`. The automatic Docker Desktop startup path is implemented; this run started the installed engine directly before the first complete launcher test. The Mac shortcuts invoke the tested launcher but have not separately been double-clicked through Finder.

## Subsequent increments

Version 0.2 adds public job-link retrieval, structured/visible job details, preview before saving, and manual fallback for inaccessible listings. This includes a Docker/browser check against the supplied LinkedIn listing. See `VERIFICATION.md` for details.

Version 0.3 implements: Opportunity Knox branding; Forest/Cappuccino/Ocean/Midnight themes; distinct dashboard, opportunities, Kanban and to-do pages; profile name/photo; clearer career-material library and pending AI-indexing status; persisted tasks and statistics based on saved records. Integration requirements are recorded in `KNOX_CONTRACT.md`.

- Previewed import of chosen existing career/application folders, duplicate detection, and existing-file linking.
- Native Google Drive/Docs connectors and cloud-document editing/export.
- Server-side folder browsing, multiple independent reference roots, communications direction/channel refinements, and explicit review decisions beyond stage/outcome/notes.
- Further AI tools for JD extraction, approved CV templates, PDF export, and richer retrieval beyond the current local text chunks.
- OCR for scanned documents, JavaScript-rendered job pages, and complete original-page snapshots. The extracted job description and source provenance can be saved by link lookup; storing the full original HTML/PDF snapshot remains future work.
- Submission-pack approval and enforced snapshot workflow across all selected document versions.
- Portable backup/restore and export/import with document reconciliation across hosts.
- Authenticated remote hosting, chosen hostname/VPN, HTTPS, and deployment-specific verification.
- Calendar/email integration and reminders.

Version 0.4 implements Career Buddy provider/model settings and connection testing; local PDF/DOCX/text extraction and chunk retrieval; persistent opportunity chats; reviewed dated interview/communication/note/field updates; fit, salary and skills prompts; editable CV/cover drafts saved as versioned Word documents. API keys remain server-side and are excluded from record exports. See `CAREER_BUDDY.md` for setup and `VERIFICATION.md` for validation limits.

Version 0.4.2 adds automatic provider model discovery, an Ollama model suggestion, manual fallback, and testing unsaved connection settings without requiring a model first. Ollama connection checks list installed models without starting one. See `CAREER_BUDDY.md` and `VERIFICATION.md` for supported endpoints and limits.

A provider must be configured by the user. Real paid-provider credentials and live model output quality have not been tested in this run. External application submission and email sending are not implemented.

Version 0.4.3 adds Lavender, Terracotta, Graphite and Plum themes, plus a custom accent and background tint with preview, save and reset. Appearance settings persist with the workspace. The Career library continues to use locally extracted text chunks and keyword retrieval; vector embeddings and semantic search are not implemented.

Version 0.4.4 adds multi-file and directory drag-and-drop (plus a folder picker) to the Career library and opportunity Documents tabs, recursively reading dropped directories while skipping hidden/system folders (`.git`, `.obsidian`, `.trash`, `node_modules`) and preserving relative folder paths in document names. It expands local text extraction to PowerPoint (`.pptx` slides and speaker notes), Word footnotes/endnotes/comments (`.docx`), HTML, RTF, YAML/code, and video caption files (`.vtt`/`.srt`). It splits the Career library view between **Used (prepared)** and **Unused (unprepared)** sources with **Reset & re-prepare** (`DELETE /api/buddy/index`, `POST /api/buddy/index` with `force: true`), adds collapsible folder grouping (collapsed by default with **Expand all / Collapse all** controls) and a collapsible **Tags** section with automatic/editable tags, supports bulk deletion by folder and by tag as well as individual deletion and **Clear all** (`DELETE /api/documents`, preserving `submitted` snapshots), adds an **Obsidian Vault** integration (`/api/obsidian/*` and `server/obsidian-vault.mjs`) to create a new vault or connect an existing vault, export existing library sources into the vault (with companion Markdown notes and extracted text), and sync vault notes into the library, and provides an in-app **Update & restart board** control (`POST /api/restart`) that automatically refreshes the browser once the restarted server responds.


## Current follow-up work — 27 October 2026

- Appearance choices and custom colours save automatically; contrasting light/dark presets are available. Prepared and unprepared source sections fold independently. Individual or selected library documents can be moved between folders in the configured library; a bulk move is limited to 500 files.
- An existing Obsidian vault can be connected read-only. The host launcher mounts a separate host vault read-only, and the app blocks export to a read-only vault. Sync from the vault is an explicit action that copies eligible files into managed library storage; connecting alone does not add them to Career Buddy's sources. The vault is not a live, in-place retrieval source.
- The host restart handoff checks for a running watcher, reports failures, and waits for the requested restart to complete before refreshing. See `VERIFICATION.md` for the isolated test and live read-only mount check.
- Folder/file selection no longer has a 500-file count cap. Above 500 files the UI warns and offers manually continued batches of 500; files are uploaded one at a time and the remaining queue lives in the browser. The existing 15 MB per-file browser upload limit and hidden/system exclusions remain. This concerns upload batches, not AI text chunking.

Still open: vector or semantic search; in-place directory and vault sources; previewed imports with duplicate handling; persistent resumable uploads; guided backup restore; and production remote HTTPS/VPN deployment. The Obsidian sync, any optional export to a writable vault, and library uploads are distinct user actions.
