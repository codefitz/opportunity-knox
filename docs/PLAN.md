# Application board — initial product plan

Product plan agreed 22 October 2026. Implementation has started; see `ROADMAP.md` for delivered features and remaining work. The plan below describes the full intended product, rather than claiming every feature is available in the first increment.

## Feature Requests

- [x] Separate embedding provider, endpoint, model and server-side API key configuration from Career Buddy chat settings (OpenAI, Ollama and custom compatible endpoints). No embedding requests or indexing are triggered by saving.
- [x] Bundle a pinned, checksum-verified local MiniLM embedding model in Docker with offline CPU inference and a fictional-text self-test. Use it by default for new embedding configurations; preserve saved external providers.
- [ ] External embedding endpoint capability tests and embedding-specific model discovery.
- [ ] Decision model placeholder: independently configurable provider/model for criteria-based opportunity assessments (for example, “does this opportunity fit my criteria?”). Define saved user criteria, evidence, uncertainty and reviewable recommendations; keep this separate from chat and embedding models. Detailed contract and implementation remain open.
- [x] Semantic search step 2: persistent SQLite vectors from the bundled MiniLM model, explicit library/read-only source selection, background progress, cancellation, retry, restart persistence, source-change invalidation and removal/reset cleanup. No automatic indexing or original-file changes.
- [x] Semantic search step 3: combine local semantic and keyword retrieval in Career Buddy, scoped to selected sources, with passage references, visible fallback reasons, source freshness checks and fictional retrieval quality tests. Library list filtering remains metadata-only.
- [ ] External embedding endpoint indexing and optional custom vector database integration. The initial built-in vector store needs no additional service.
- [x] Connect an existing Obsidian vault, including a read-only host mount; explicitly sync eligible files into the Career Library when desired. Connecting alone does not automatically import files or make the vault searchable by Career Buddy.
- [x] Select files from a read-only vault for in-place Career Buddy use; selected file text is cached in the board and refreshed when changed. Removing a selection clears its text cache.
- [ ] Extend in-place read-only sources to independently mounted general directories and multiple roots.
- [ ] Attach a host directory as a persistent in-place source. Folder uploads copy selected files into managed library storage instead.
- [x] Drag and drop files and directories to the Career Library, with a warning above 500 files and optional manually continued batches of 500.
- [ ] Career Buddy side bar option - open a chat which will allow you to describe projects and experience, which career buddy will turn into a CV bullet or Cover letter highlight.

## Confirmed direction

- [x] A custom browser-based Kanban board for tracking job opportunities from identification through hire or rejection.
- [x] Accessible across several devices through a privately hosted service.
- [x] Easy to start and stop, with records and documents surviving shutdowns and upgrades.
- [x] Docker is an implementation detail: routine operation uses a single launcher command or host shortcut, with no manual Compose, mount, or environment-file editing.
- [x] Optional, pluggable AI support for identification, fit review, and document generation. Choose the provider later. *(Career Buddy supports OpenAI, Claude, Gemini, Ollama, and custom OpenAI-compatible APIs; Stage 1 AI extraction and per-stage toggles remain open.)*
- [x] Automatically dated stages with editable dates, optional notes, and a combined opportunity summary.
- [x] Configurable document storage and a reusable library of previous JDs, CVs, and other evidence.

Initial assumption: one person using the board across several devices. Shared team access and unrelated project workflows can be considered later.

## Board and opportunity workflow

One card represents one application opportunity, including a stable ID so repeat applications to the same employer remain distinct. Cards show employer, role, current stage, priority, deadline, next action/date, and time in stage. Support drag-and-drop and a stage selector, plus a list view for smaller screens. Search/filter by employer, role, stage, outcome, tags, deadline, and overdue action.

- [x] Opportunity cards with stable ID, employer, role, current stage, priority, deadline, next action/date, and time in stage.
- [x] Drag-and-drop Kanban board, stage selector in details, and a separate list view (`#/opportunities`).
- [x] Search by employer, role, tags, and location; filter by active, completed, and specific outcomes.
- [ ] Dedicated toolbar filters for stage, tags, deadline, and overdue action.

| Stage | Information and behaviour |
| --- | --- |
| 1. Identification | [x] Add a URL, upload a PDF/DOCX, or paste JD text. Capture role, employer, job reference, source, location, working arrangement, salary/rate/currency, employment type, contact, closing date, requirements, and source documents. Unknown fields remain visibly unknown.<br>[ ] Dedicated `applicationRoute` field (currently captured in notes/description). |
| 2. Review | [x] Optional AI-assisted comparison against selected career evidence (via Career Buddy "Am I a good fit?" prompt) and manual proceed/ignore/defer transitions with notes.<br>[ ] Dedicated structured fields for strengths, gaps, questions, recommendation, user-defined fit criteria, and proceed/ignore/defer decision reason outside chat/notes. |
| 3. Generate CV and cover letter | [x] Select reference material in Career Buddy and generate versioned editable `.docx` and `.md` drafts; allow existing documents to be uploaded/attached instead.<br>[ ] Template selection preserving custom layout/page targets, PDF generation, and an explicit "cover letter not required" toggle. |
| 4. Application review | [x] Read and revise drafts in Career Buddy or upload revised versions; mark individual document versions as `draft`, `approved`, or `submitted`.<br>[ ] Dedicated fields for supporting statements / application answers and formal application-pack approval grouping. |
| 5. Application submitted | [x] Reaching this stage is a user action; moving a card does not submit an application externally. Submitted documents are preserved as immutable snapshots.<br>[ ] Dedicated submission receipt/reference and application route fields on the submission record, and explicit linking of a multi-document submitted pack to the submission event. |
| 6. Communications and interviews | [x] Record communications and any number of interview/assessment entries with type, scheduled date, status, contacts, preparation/notes, and revision history.<br>[ ] Per-activity document attachments, dedicated follow-up field on activities, explicit `incoming`/`outgoing` direction and channel on communications, custom interview types, and `rescheduled` as a distinct status value. |
| 7. Final interview | [x] A milestone associated with a particular interview entry (`isFinal`). Retain earlier interviews; support more than one final-stage meeting without losing history. |
| 8. Outcome | [x] Hired or rejected, with date, reason/feedback in notes, and relevant documents. Also support ignored, withdrawn, and role closed.<br>[ ] Record an offer and its decision separately so an offer is not automatically counted as a hire. |

- [x] Ignored opportunities close directly from Review. Rejection, withdrawal, or role closure can occur at any stage.
- [x] The default board filter shows active opportunities; completed/outcome filters retain closed records.
- [x] Returning to an earlier stage or reopening an opportunity creates a new history event.
- [x] Stages may be skipped when a hiring process does not require them; skipped stages do not acquire invented dates.
- [x] Recording a communication does not send it externally.

## Dates, notes, and summaries

- [x] On each stage transition, save the actual recording timestamp and a default effective date/time. The user can correct the effective date without erasing when the event was recorded or its correction history.
- [x] Keep a separate event for each visit to a stage, with entry dates and optional notes. Never overwrite an earlier visit when a card moves backwards.
- [x] Separate scheduled interviews, deadlines, and next actions from completed events. Store timestamps consistently and display them in the configured timezone, initially Europe/London; retain date-only values as dates.
- [x] Save notes on the relevant stage or event. The Summary tab assembles all notes, decisions, communications, interviews, and document links chronologically, with source dates. This works without AI.
- [ ] Optional AI summaries as derived views linked to their source events that show when they were generated and visibly mark themselves out of date when new events arrive. *(Currently Career Buddy provides interactive chat rather than a cached derived summary view.)*
- [x] Provide overdue/deadline indicators and next-action dates (plus a dedicated To-do list and Dashboard queues).
- [ ] Email/calendar reminders (later integration; the stopped service does not process background reminders or AI work).

## Main screens

1. [x] **Board/list (plus Dashboard & To-do list added in v0.3):** active opportunities, search, filters, add opportunity, next actions, live statistics, and manual/linked tasks.
2. [x] **Opportunity detail:** overview; stages/timeline; documents; communications/interviews; summary; Career Buddy. Keeps job source and employer/role identity easy to find.
3. [x] **Reference library (`Career library`):** store CVs, prior JDs, certificates, project notes, and other career material; prepare local text chunks and select material for individual Career Buddy tasks.
   - [x] Automatic/editable tags and tag filters; independently collapsible prepared and unprepared views and folder groups.
   - [ ] Dedicated structured categories for master CVs, role-specific CVs, templates, supporting statements, and interview stories.
4. [x] **Settings:** profile name/photo, light/dark and contrasting themes, automatically saved custom colours, document subfolder locations, pending host path, Career Buddy AI provider/model connection, timezone, backups, and record export.
   - [ ] Record import / backup restore UI and per-stage AI enablement controls.

## Document storage and existing material

- [x] Separate the board database, application documents, reference library, and backups.
- [x] A document record tracks its kind/purpose, version, sha256 hash, storage root, relative path, and relationship to an opportunity or AI generation task.
- [x] Mark `draft`, `approved`, and `submitted` versions explicitly. Preserve `submitted` files as immutable snapshots so later edits cannot change the recorded submission.
- [x] Preserve originals and let the user choose what becomes Career Buddy source evidence.

Offer two document actions:

- [x] Upload/copy into managed storage: available from every device through the board. File count is not capped by the upload queue; the existing 15 MB per-file browser limit and hidden/system-folder exclusions still apply. A large queue is held in the browser until uploaded and is lost on reload.
- [x] Move individual or selected library files between folders inside the configured library; preserve identifiers and prepared text. One bulk move is limited to 500 files; collision and submitted-document protections apply.
- [x] Connect an Obsidian host vault read-only for inspection and optional explicit sync into the library. The read-only mount blocks exports into the vault; a sync copies eligible files into managed library storage and prepares their text.
- [ ] Attach an existing document in-place from a configured server-accessible folder or supported cloud connector (e.g. Google Docs link remaining a cloud document with availability shown).

Storage configuration and folder browsing:

- [x] Settings exposes an application-document root, reference subfolder, backup destination, and pending host document root handoff.
- [x] Save and validate preferences so they survive restarts; retain earlier document roots when a new host root is applied.
- [ ] Multiple independent reference locations (e.g. read-only reference roots outside the main document root).
- [ ] Server-side folder browser within available locations on the hosting machine.

Proposed managed layout:

```text
<document-root>/
  references/
  opportunities/
    <stable-id>-<company>-<role>/
      job-description/
      drafts/
      approved/
      submitted/
      interviews/
      correspondence/
```

- [x] Keep document paths relative to the configured storage root (`opportunities/<id>/` and `references/`).
- [ ] Use `<stable-id>-<company>-<role>/` folder naming with `job-description/`, `drafts/`, `approved/`, `submitted/`, `interviews/`, and `correspondence/` subdirectories.
- [ ] Detect missing/offline files in the UI with a relinking workflow, and provide a guided attach-existing or copy-and-validate migration workflow when changing storage roots.
- [ ] Previewed import of existing folders (`Career Transition`, `Work/Applications`) with duplicate detection using document hashes and job reference/URL/employer-role matches.

## Pluggable AI design

- [x] Keep the core board fully usable with AI disabled.
- [x] Provide a clean provider adapter boundary (OpenAI, Claude, Gemini, Ollama, and custom OpenAI-compatible APIs) with automatic model discovery and connection testing.
- [ ] Independent per-stage enablement toggles for Stages 1–3.
- [x] Stage 1 deterministic public URL lookup (`JobPosting` structured data + visible HTML) with source provenance and fallback to pasted text or uploaded document.
- [ ] Stage 1 AI-assisted extraction returning structured fields with source passages, missing information, uncertainties, full original HTML/PDF page snapshots, and OCR for scanned PDFs.
- [x] Stage 2 fit, salary, and skills evaluation in Career Buddy against selected reference evidence, separating supported matches from gaps and questions while leaving decisions to the user.
- [ ] User-defined persistent fit criteria profile for Stage 2 reviews.
- [x] Stage 3 CV and cover letter drafting in Career Buddy using selected career evidence, saving editable `.docx` and `.md` versions without overwriting submitted files.
- [ ] Stage 3 template layout/font/table preservation, page-target fit review inside the app, and direct PDF generation.
- [x] Record provider/model, source coverage, and prompt context on Career Buddy messages; keep API keys server-side and out of record exports.
- [ ] Background AI task queue recording prompt version, token/cost usage, and `queued`/`running`/`completed`/`failed`/`cancelled`/`interrupted` states across restarts.
- [ ] External-assistant task-pack export and result import.

## Launcher and first-run experience

The normal user interface is the web app, packaged with a host launcher so Docker commands and configuration files are maintained automatically:

```text
./board start       # Start or open the existing instance
./board stop        # Stop without deleting data
./board restart     # Apply pending host-folder changes and restart
./board status      # Show running/stopped state and the board address
./board logs        # Show container logs
```

- [x] `./board start`, `./board stop`, `./board restart`, `./board status`, and `./board logs` implemented in `./board` and `scripts/launcher.py`.
- [x] Double-click macOS shortcuts (`scripts/Start Board.command` and `scripts/Stop Board.command`).
- [x] Check Docker/Compose availability and start an installed Docker Desktop where supported; give plain-language setup instructions otherwise.
- [x] Store persistent SQLite state in an OS-appropriate local application-data directory (`~/Library/Application Support/OpportunityBoard` on macOS, `~/.local/share/opportunity-board` on Linux) separate from `~/OpportunityBoard` documents.
- [x] Support `--files "/path/to/applications"`, `--port`, `--bind`, and `--no-open` on `./board start`, remembering choices across runs.
- [x] Create default application-owned folders, validate configured locations and write permissions, generate mount configuration, and refuse to silently replace a missing configured drive with an empty default location.
- [x] Wait for `/api/health`, then display/open the board address with the initial `#setup=<token>` credential when needed.
- [x] Two-level folder configuration: immediate in-app subfolder updates inside exposed roots, and structured `pending-storage.json` handoff for new host folders applied on `./board restart` while retaining earlier mounts.
- [x] In-app **Update & restart board** action (`POST /api/restart`) hands off to the host watcher, checks its heartbeat, and waits for the matching result before refreshing; failed host restarts are reported and pending mount settings remain available for retry.

## Hosting and persistence proposal

- [x] Responsive TypeScript/React frontend, Node.js API, and local SQLite (`node:sqlite` with WAL mode) accessed exclusively through the API.
- [x] Packaged with Docker Compose, persistent database storage, and launcher-managed document mounts running with the host user's UID/GID.
- [x] Optimistic concurrency (`revision` checks returning `409 Conflict`) so a stale browser tab on another device cannot silently overwrite newer edits.
- [x] Persist opportunities, event history, notes, settings, profile, tasks, document metadata, extracted text chunks, and Career Buddy chat history independently of the container.
- [x] On-demand consistent SQLite + managed document backup (`POST /api/backup`) and secret-free JSON record/manifest export (`GET /api/export`).
- [ ] Automated scheduled backups while running, automatic pre-upgrade backup hook in the launcher, and guided portable restore/import with document reconciliation.
- [ ] Production remote host selection and authenticated HTTPS reverse proxy or VPN deployment configuration.

## Initial data model

- [x] **Opportunity:** identity, source, job details, current stage, outcome, tags, priority, next action, revision.
- [x] **Stage event:** opportunity, transition, effective and recording timestamps, corrections, notes.
- [x] **Activity:** communication or interview, type, dates, participants, status, notes, revision history, final-stage marker.
- [x] **Document/version:** opportunity or library association, kind, storage root & relative path, version, sha256 hash, approval state (`draft`/`approved`/`submitted`), generation metadata.
- [x] **Task & Profile (added in v0.3):** persisted to-do items with due dates and opportunity links; workspace profile name and avatar.
- [x] **Career Buddy chat & prepared chunks (added in v0.4):** provider configuration, locally extracted document text chunks, conversation messages, reviewed change proposals, and saved draft references.
- [ ] **Standalone AI task table & reference profiles:** background task lifecycle/usage records, reusable CV/cover templates, and saved fit criteria profiles.

## Delivery sequence

1. [x] **Core workflow:** board/list, opportunity detail, all stages/outcomes, date history, notes/summary, interviews/comms, uploads/reference library, document version labels, local backup, and JSON export, with private local hosting, persistent storage, and launcher start/stop.
2. [ ] **Existing-workflow integration:**
   - [x] Concurrent-device editing checks (`409` revision handling), host-folder retention across restarts, and read-only Obsidian mounting with explicit optional sync.
   - [x] Organise uploaded library documents into folders and upload selections over 500 with optional batches.
   - [ ] Previewed import of chosen historical records (`Career Transition`, `Work/Applications`), attach-existing file workflow, duplicate detection, and guided backup/restore verification.
3. [ ] **AI integration:**
   - [x] Multi-provider adapter, model discovery, local PDF/DOCX/text chunk retrieval, grounded opportunity chat, reviewed record updates, fit/salary/skills prompts, and versioned Word/Markdown draft generation.
   - [ ] Stage 1 AI extraction, per-stage controls, template-preserving generation, PDF export, and external-assistant task-pack export/import.
4. [ ] **Optional extensions:** calendar/email integrations, reminders, richer reporting, cloud storage providers (Google Drive/Docs), vector DB / Obsidian / directory sources, and Career Buddy sidebar chat.

## Acceptance examples

- [x] Create an opportunity on one device; reopen it on another with the same documents and history.
- [x] Upload a JD and save unknown job fields without inventing values; complete them later.
- [x] Move a card, correct its date, move it backwards, and verify that the complete history remains readable.
- [x] Ignore an opportunity during Review or record rejection before interview without forcing it through later stages.
- [x] Add a phone screen, two video interviews, an assessment, and an in-person final; reschedule one without losing its previous date.
- [x] Read/export all notes and communications as one chronological summary with AI disabled.
- [x] Submit version 2 of a CV; generate version 3 later; the submission record still opens the original version 2 snapshot.
- [x] Stop and restart the service; verify cards, dates, notes, attachments, settings, and task state survive. Interrupted AI work does not silently rerun.
- [ ] Restore a backup into a clean installation through a guided restore workflow and verify the same records and managed documents are accessible *(backups are created with SQLite + files, but guided restore is not yet implemented)*.
- [x] Edit the same card from two devices and receive a clear conflict/reload choice rather than silently losing one edit.
- [x] Start with the default launcher command, stop, and start again without editing Docker files or re-entering saved folders; verify the same board and documents reopen.
- [x] Change a document subfolder in Settings and verify it persists. Request a new host folder outside current mounts, apply it with one launcher restart, and verify existing document links still work.
- [x] Start while a configured drive is unavailable and receive an actionable message rather than an apparently empty replacement board or document library.

## Remaining choices

- [ ] **Host:** existing computer/home server/NAS or a private cloud server; confirm its OS, persistent disk, and remote-access method so the one-command launcher and optional desktop shortcut can be tailored appropriately.
- [ ] **Storage:** which existing folders should be connected, which documents should be copied into managed storage, and whether native Google Docs editing/export is required initially.
- [x] **AI adapter contract:** implemented in Career Buddy supporting OpenAI, Claude, Gemini, Ollama, and custom OpenAI-compatible servers (specific live provider/model choice remains configurable by the user in Settings).
- [ ] **Document templates:** identify the initial approved CV/cover templates and their layout requirements before implementing template-preserving generation and PDF export.

## Technical references

- [Docker persistent volumes](https://docs.docker.com/engine/storage/volumes/): stored data can survive the lifecycle of a container; host-visible documents may instead use bind mounts.
- [Docker Compose stop](https://docs.docker.com/reference/cli/docker/compose/stop/): stopping preserves containers, which can subsequently be started again.
- [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/): host folder access is configured at container creation and uses paths on the Docker host.
- [Compose variable interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/): the launcher can supply saved host-folder settings without requiring manual Compose edits.
- [SQLite network filesystem considerations](https://www.sqlite.org/useovernet.html): supports the proposal to keep database access local to the server and let browser clients use the API.
- [Browser directory picker compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker): direct browser folder access has compatibility and permission constraints; it does not replace hosted document storage.
