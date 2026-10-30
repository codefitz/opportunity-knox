# Application board — initial product plan

Product plan agreed 22 October 2026; reconciled against the repository on 29 October 2026. See `ROADMAP.md` for dated delivery history and [PLAN_AUDIT.md](PLAN_AUDIT.md) for the unchecked-item audit. Checked items mean the stated scope is implemented; runtime/provider/hosting verification is recorded separately. Unchecked parent delivery phases can contain completed sub-items. Repeated references to an open feature are not separate implementation tasks.

## Feature Requests

- [x] Global Feedback button/text box, private persistent inbox and JSON export, Open/Planned/Done tracking, and optional advisory AI review using only feedback/page context. Failed/cancelled/interrupted reviews preserve originals; no automatic application changes.

- [x] Separate embedding provider, endpoint, model and server-side API key configuration from Career Buddy chat settings (OpenAI, Ollama and custom compatible endpoints). No embedding requests or indexing are triggered by saving.
- [x] Bundle a pinned, checksum-verified local MiniLM embedding model in Docker with offline CPU inference and a fictional-text self-test. Use it by default for new embedding configurations; preserve saved external providers.
- [ ] External embedding endpoint capability tests and embedding-specific model discovery.
- [x] Independent decision-model settings and a saved required/preferred criteria profile. Opportunity Fit assessment records met/unmet/unknown results, evidence IDs, follow-up questions and a reviewable recommendation; retains criteria/model snapshots and marks changed inputs out of date. No automatic stage/outcome changes.
- [x] Semantic search step 2: persistent SQLite vectors from the bundled MiniLM model, explicit library/read-only source selection, background progress, cancellation, retry, restart persistence, source-change invalidation and removal/reset cleanup. No automatic indexing or original-file changes.
- [x] Semantic search step 3: combine local semantic and keyword retrieval in Career Buddy, scoped to selected sources, with passage references, visible fallback reasons, source freshness checks and fictional retrieval quality tests. Library list filtering remains metadata-only.
- [ ] External embedding endpoint indexing and optional custom vector database integration. The initial built-in vector store needs no additional service.
- [x] Connect an existing Obsidian vault, including a read-only host mount; explicitly sync eligible files into the Career Library when desired. Connecting alone does not automatically import files or make the vault searchable by Career Buddy.
- [x] Select files from a read-only vault for in-place Career Buddy use; selected file text is cached in the board and refreshed when changed. Removing a selection clears its text cache.
- [x] Independently mounted read-only general directories/multiple roots, folder browsing, explicit selections and cache cleanup.
- [x] Attach host directories as persistent in-place sources through the app and launcher; uploads remain separate managed copies.
- [x] Drag and drop files and directories to the Career Library, with a warning above 500 files and optional manually continued batches of 500.
- [x] Standalone Career Buddy sidebar workspace: realistic encouragement coaching, multi-turn STAR stories and CV/cover highlights, reviewed recruiter intake with linked tasks, and explicit-target opportunity updates. Conversations/proposals persist; changes need confirmation.

## Career Buddy follow-ups (28 October 2026)

- [x] Optional Codex CLI provider using the host’s ChatGPT sign-in, with a launcher-managed private queue, read-only ephemeral execution, bounded requests and existing review controls. Messages/selected excerpts go to OpenAI under Codex account limits; credentials remain outside Docker. User explicitly authorized this destination. Host CLI catalogue discovery and stage/elapsed progress/cancellation are implemented; token streaming and provider-side acknowledgement remain open. See `CODEX_BUDDY_DESIGN.md`.

- [x] Standalone chat attachments with extraction preview, original download/reuse/deletion and documented limits. Stored separately from the career library; no silent indexing. Optional attachment-to-library copying remains future work.
- [x] P1 standalone Buddy request controls: polled stage/elapsed progress, Cancel/retry, HTTP abort and owned Codex process termination, persisted secret-safe request diagnostics, restart interruption state, configurable AI response timeouts (30–900 seconds), HTTP response-token and source-context budgets. Existing defaults retained; no silent retries. Responses remain non-streaming.
- [x] Extend interactive progress/elapsed time, cancellation and explicit retry to opportunity-specific Buddy, manual decision assessments and automatic review jobs; recover persisted request status when reopening views and reject late cancelled results before saving.
- [x] HTTP-provider streaming with polled live answer previews in standalone/opportunity chat; incremental SSE/NDJSON parsing, bounded responses, explicit compatibility opt-out and complete-response validation before saving. Preview text remains memory-only and is cleared on cancellation/failure/completion.
- [x] Persisted source preparation/provider/first-output diagnostics and provider-reported Ollama loading/prefill/generation timings; Codex queue/execution timing and local process-termination acknowledgement. No prompts, keys or preview text enter these diagnostics.
- [ ] Codex live token output and genuine remote-provider cancellation acknowledgement. The CLI bridge still returns complete answers; transport/local-process termination cannot guarantee remote compute/billing stops.

## Confirmed direction

- [x] A custom browser-based Kanban board for tracking job opportunities from identification through hire or rejection.
- [x] Browser/API capability for private multi-device access, configurable host binding and conflict handling. Production remote HTTPS/VPN deployment remains unchecked below.
- [x] Easy to start and stop, with records and documents surviving shutdowns and upgrades.
- [x] Docker is an implementation detail: routine operation uses a single launcher command or host shortcut, with no manual Compose, mount, or environment-file editing.
- [x] Optional, pluggable AI support for identification, fit review, and document generation. Choose the provider later. *(Career Buddy supports OpenAI, Claude, Gemini, Ollama, and custom OpenAI-compatible APIs; Per-stage toggles are implemented; reviewed Stage 1 extraction is implemented.)*
- [x] Automatically dated stages with editable dates, optional notes, and a combined opportunity summary.
- [x] Configurable document storage and a reusable library of previous JDs, CVs, and other evidence.

Initial assumption: one person using the board across several devices. Shared team access and unrelated project workflows can be considered later.

## Board and opportunity workflow

One card represents one application opportunity, including a stable ID so repeat applications to the same employer remain distinct. Cards show employer, role, current stage, priority, deadline, next action/date, and time in stage. Support drag-and-drop and a stage selector, plus a list view for smaller screens. Search/filter by employer, role, stage, outcome, tags, deadline, and overdue action.

- [x] Opportunity cards with stable ID, employer, role, current stage, priority, deadline, next action/date, and time in stage.
- [x] Drag-and-drop Kanban board, stage selector in details, and a separate list view (`#/opportunities`).
- [x] Search by employer, role, tags, and location; filter by active, completed, and specific outcomes.
- [x] Shared list/Kanban toolbar filters for stage, multiple tags (all/any), deadline presets/inclusive date ranges, and overdue next actions/follow-ups/offer responses/linked to-dos. Composable with search/outcomes, removable selections, counts, range validation and reset.

| Stage | Information and behaviour |
| --- | --- |
| 1. Identification | [x] Add a URL, upload a PDF/DOCX, or paste JD text. Capture role, employer, job reference, source, location, working arrangement, salary/rate/currency, employment type, contact, closing date, requirements, and source documents. Unknown fields remain visibly unknown.<br>[x] Dedicated editable `applicationRoute` field on creation/Overview and in summaries; submitted packs retain their separately recorded route. |
| 2. Review | [x] Optional AI-assisted comparison against selected career evidence (via Career Buddy "Am I a good fit?" prompt) and manual proceed/ignore/defer transitions with notes.<br>[x] Separate editable strengths/gaps fields and a dated user proceed/ignore/defer decision/reason with revision history. Stage updates require an explicit choice. Saved criteria, per-criterion met/unmet/unknown results, questions, evidence, summary and model recommendation are already implemented in Fit assessment. |
| 3. Generate CV and cover letter | [x] Select reference material in Career Buddy and generate versioned editable `.docx` and `.md` drafts; allow existing documents to be uploaded/attached instead.<br>[x] Built-in and marked DOCX template layouts, measured page targets, previews and reviewed PDF/Word exports.<br>[ ] Full arbitrary-template fidelity. The cover-letter exemption is implemented in application packs. |
| 4. Application review | [x] Read and revise drafts in Career Buddy or upload revised versions; mark individual document versions as `draft`, `approved`, or `submitted`.<br>[x] Application packs with supporting statements/answers, pinned versions, explicit grouped approval, cover-letter exemption and ZIP downloads. |
| 5. Application submitted | [x] Reaching this stage is a user action; moving a card does not submit an application externally. Submitted documents are preserved as immutable snapshots.<br>[x] Pack submission date/recording time, route, receipt/reference and linked event, with exact submitted document versions preserved. |
| 6. Communications and interviews | [x] Record communications and any number of interview/assessment entries with type, scheduled date, status, contacts, preparation/notes, and revision history.<br>[x] Per-activity document attachments, dedicated follow-up with due date/completion, explicit `incoming`/`outgoing` direction and channel on communications, custom interview types, and `rescheduled` as a distinct status value. Follow-ups join the dated action queue; activity revisions are expandable. |
| 7. Final interview | [x] A milestone associated with a particular interview entry (`isFinal`). Retain earlier interviews; support more than one final-stage meeting without losing history. |
| 8. Outcome | [x] Hired or rejected, with date, reason/feedback in notes, and relevant documents. Also support ignored, withdrawn, and role closed.<br>[x] Record multiple offers, terms/package/contact, response/start dates, document versions and dated pending/accepted/declined/withdrawn/expired decisions with history. Offers and acceptances do not automatically change stage/outcome; pending response deadlines join the action queue. |

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
- [x] Optional saved Buddy briefings in Summary: dated sections with supporting source references, explicit refresh, stale markers for changed opportunity/events/activities/tasks/document metadata, cancellation and conflict protection. Chronological summaries remain available. Live-provider wording quality remains for user evaluation.
- [x] Provide overdue/deadline indicators and next-action dates (plus a dedicated To-do list and Dashboard queues).
- [ ] Email/calendar reminders (later integration; the stopped service does not process background reminders or AI work).

## Main screens

1. [x] **Board/list (plus Dashboard & To-do list added in v0.3):** active opportunities, search, filters, add opportunity, next actions, live statistics, and manual/linked tasks.
2. [x] **Opportunity detail:** overview; stages/timeline; documents; communications/interviews; summary; Career Buddy. Keeps job source and employer/role identity easy to find.
3. [x] **Reference library (`Career library`):** store CVs, prior JDs, certificates, project notes, and other career material; prepare local text chunks and select material for individual Career Buddy tasks.
   - [x] Automatic/editable tags and tag filters; independently collapsible prepared and unprepared views and folder groups.
   - [x] Structured categories for master/tailored/general CVs, templates, supporting statements and STAR/interview stories; upload/individual/bulk categorisation and category filtering.
4. [x] **Settings:** profile name/photo, light/dark and contrasting themes, automatically saved custom colours, document subfolder locations, pending host path, Career Buddy AI provider/model connection, timezone, backups, and record export.
   - [x] Backup listing, inspection/validation and confirmed isolated restore UI in Settings. The restored workspace is not automatically started or made live.
   - [x] Confirmed restore activation/replacement UI with hash-verified managed files, pre-change backup, rollback and fresh sign-in.
   - [x] Reviewed historical JSON import/merge UI in Settings; see HISTORICAL_IMPORTS.md.
   - [x] Per-stage AI enablement and separate automatic fit/tag controls in Settings → AI workflow.

## Document storage and existing material

- [x] Separate the board database, application documents, reference library, and backups.
- [x] A document record tracks its kind/purpose, version, sha256 hash, storage root, relative path, and relationship to an opportunity or AI generation task.
- [x] Mark `draft`, `approved`, and `submitted` versions explicitly. Preserve `submitted` files as immutable snapshots so later edits cannot change the recorded submission.
- [x] Preserve originals and let the user choose what becomes Career Buddy source evidence.

Offer two document actions:

- [x] Upload/copy into managed storage: available from every device through the board. File count is not capped by the upload queue; the existing 15 MB per-file browser limit and hidden/system-folder exclusions still apply. Library/opportunity Documents queues retain files/options in browser IndexedDB across reloads, with explicit resume and server retry IDs; browser storage limits and clearing site data still apply.
- [x] Move individual or selected library files between folders inside the configured library; preserve identifiers and prepared text. One bulk move is limited to 500 files; collision and submitted-document protections apply.
- [x] Connect an Obsidian host vault read-only for inspection and optional explicit sync into the library. The read-only mount blocks exports into the vault; a sync copies eligible files into managed library storage and prepares their text.
- [x] Select existing files in-place from read-only configured server folders or an Obsidian vault; resolve availability when browsing/using sources and cache selected text without copying originals.
- [x] Google Docs setup/search/explicit snapshot import is implemented; live app authorization remains deferred.
- [ ] Live in-place cloud-document references with availability/refresh tracking. Current Google Docs imports are local Word snapshots, not live cloud documents.

Storage configuration and folder browsing:

- [x] Settings exposes an application-document root, reference subfolder, backup destination, and pending host document root handoff.
- [x] Save and validate preferences so they survive restarts; retain earlier document roots when a new host root is applied.
- [x] Multiple independent read-only reference roots outside managed document storage, configured in the app and mounted by the launcher.
- [x] Paged server-side folder browsing inside configured read-only roots. This is not unrestricted browsing of the host filesystem.

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
- [x] Report unavailable source roots/files and reject missing configured drives rather than replacing them with empty defaults. Retain previous managed roots when changing storage.
- [x] Dedicated relinking and guided copy-and-validate migration between managed storage roots: preview/hash checks, explicit confirmation, originals retained, stale-plan rejection, full pre-change backup and rollback/restart recovery.
- [x] Previewed historical JSON opportunity import with record-content hash, manifest JD hash, source ID, job reference/URL/employer-role and within-file duplicate suggestions. Explicit skip/separate/selected-field/history/stage choices, full pre-import backup, conflict checks, atomic writes, durable replay protection and source archive/report. File bytes, tasks and native offers/reviews/packs are not activated by record import; use full restore for an entire workspace.
- [x] Durable library/opportunity Documents upload queues, retained bytes/options, explicit resume/pause, per-file retry idempotence, failure recovery and cross-tab leases.

## Pluggable AI design

- [x] Keep the core board fully usable with AI disabled.
- [x] Provide a clean provider adapter boundary (OpenAI, Claude, Gemini, Ollama, and custom OpenAI-compatible APIs) with automatic model discovery and connection testing.
- [x] Independent stage 1–3 AI switches, separate automatic fit/tag controls, conflict-safe saved settings and server enforcement; local tools remain available.
- [x] Stage 1 deterministic public URL lookup (`JobPosting` structured data + visible HTML) with source provenance and fallback to pasted text or uploaded document.
- [x] Stage 1 reviewed intake for public links (HTML/PDF), pasted text and PDF/DOCX/text/HTML uploads: optional grounded AI fields, supporting passage/page quotes, missing information/uncertainties, full original-source snapshots and bounded local English OCR for scanned PDF pages. Saving creates the opportunity and source/text/report documents atomically; typed fields are preserved. See JOB_INTAKE.md.
- [x] Stage 2 fit, salary, and skills evaluation in Career Buddy against selected reference evidence, separating supported matches from gaps and questions while leaving decisions to the user.
- [x] User-defined persistent fit criteria profile for Stage 2 reviews, with revision conflicts and assessment snapshots.
- [x] Stage 3 CV and cover letter drafting in Career Buddy using selected career evidence, saving editable `.docx` and `.md` versions without overwriting submitted files.
- [x] Stage 3 built-in/marked-template layout preservation, page-target review and PDF generation in Document Studio.
- [ ] Exact fidelity for arbitrary unmarked templates and Google Docs/Word pagination across rendering engines.
- [x] Record provider/model, source coverage, and prompt context on Career Buddy messages; keep API keys server-side and out of record exports.
- [x] Persist Buddy request lifecycle/diagnostics, automatic review queue/state and host Codex queue; progress/cancel/retry controls and interrupted-on-restart handling. These are workflow-specific mechanisms.
- [x] Unified AI request activity page, per-attempt history, explicit workflow review/retry links, prompt versions/system fingerprints, provider-reported token counters and optional saved-rate cost estimates. Covers Buddy chat/drafting, fit assessments, tags, summaries, intake, feedback reviews and inference connection tests. See AI_ACTIVITY.md.
- [ ] Unified persisted scheduler for all AI task types, including embedding jobs and deferred runnable work. The activity/request registry does not implement that scheduler.
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
- [x] Backup inspection and verified isolated restore, with copied managed files, remapped document roots and a restore report; offline command and browser confirmation are available.
- [x] Opt-in daily/weekly full backups while running, one overdue catch-up, failure backoff/status and manual run; verified pre-upgrade full backups in the launcher, with build/start refusal on verification failure and previous-image recovery.
- [x] Portable restore activation on a clean installation, confirmed live-workspace replacement, managed-document path/hash reconciliation and crash-recoverable rollback. Existing host read-only connections are retained without expanding access.
- [x] Historical JSON record merge/import with reviewed duplicate reconciliation (separate from full-workspace replacement).
- [ ] Production remote host selection and authenticated HTTPS reverse proxy or VPN deployment configuration.

## Initial data model

- [x] **Opportunity:** identity, source, job details, current stage, outcome, tags, priority, next action, revision.
- [x] **Stage event:** opportunity, transition, effective and recording timestamps, corrections, notes.
- [x] **Activity:** communication or interview, type, dates, participants, status, notes, revision history, final-stage marker.
- [x] **Document/version:** opportunity or library association, kind, storage root & relative path, version, sha256 hash, approval state (`draft`/`approved`/`submitted`), generation metadata.
- [x] **Task & Profile (added in v0.3):** persisted to-do items with due dates and opportunity links; workspace profile name and avatar.
- [x] **Career Buddy chat & prepared chunks (added in v0.4):** provider configuration, locally extracted document text chunks, conversation messages, reviewed change proposals, and saved draft references.
- [x] **Persisted AI request/review state:** `buddy_requests`, `opportunity_automation` and host Codex queue metadata; lifecycle diagnostics are retained.
- [x] **Criteria and templates:** saved required/preferred criteria profile, document categories, reusable marked DOCX templates and built-in layouts.
- [ ] **Remaining model extensions:** named reusable reference profiles and universal scheduled-job records. Request-level prompt/usage/cost records are implemented; see the unified scheduler item above.

## Delivery sequence

1. [x] **Core workflow:** board/list, opportunity detail, all stages/outcomes, date history, notes/summary, interviews/comms, uploads/reference library, document version labels, local backup, and JSON export, with private local hosting, persistent storage, and launcher start/stop.
2. [x] **Existing-workflow integration:**
   - [x] Concurrent-device editing checks (`409` revision handling), host-folder retention across restarts, and read-only Obsidian mounting with explicit optional sync.
   - [x] Organise uploaded library documents into folders and upload selections over 500 with optional batches.
   - [x] Attach-existing read-only folder/vault files, backup inspection and isolated restore with document verification.
   - [x] Portable restore activation and managed-document reconciliation, verified on an empty isolated installation.
   - [x] Historical JSON record import and duplicate matching (scope described above).
3. [ ] **AI integration:**
   - [x] Multi-provider adapter, model discovery, local PDF/DOCX/text chunk retrieval, grounded opportunity chat, reviewed record updates, fit/salary/skills prompts, and versioned Word/Markdown draft generation.
   - [x] Saved fit criteria, automatic reviews, standalone Buddy, request controls, built-in/marked-template layouts and PDF export.
   - [x] Stage 1 reviewed JD extraction with source passages, snapshots and bounded local PDF OCR.
   - [ ] Arbitrary-template fidelity and external-assistant task-pack exchange.
4. [ ] **Optional extensions:**
   - [x] Dashboard statistics, local SQLite vectors/hybrid retrieval, Obsidian/directory sources, standalone Buddy/history sidebar and Google Docs setup/snapshot connector.
   - [ ] Calendar/email/reminders, additional reporting, external vector backends/cloud providers and live Google app authorization (deferred).

## Acceptance examples

- [x] Create an opportunity on one device; reopen it on another with the same documents and history.
- [x] Upload a JD and save unknown job fields without inventing values; complete them later.
- [x] Move a card, correct its date, move it backwards, and verify that the complete history remains readable.
- [x] Ignore an opportunity during Review or record rejection before interview without forcing it through later stages.
- [x] Add a phone screen, two video interviews, an assessment, and an in-person final; reschedule one without losing its previous date.
- [x] Read/export all notes and communications as one chronological summary with AI disabled.
- [x] Submit version 2 of a CV; generate version 3 later; the submission record still opens the original version 2 snapshot.
- [x] Stop and restart the service; verify cards, dates, notes, attachments, settings, and task state survive. Interrupted AI work does not silently rerun.
- [x] Create a verified private isolated restore from a selected backup through Settings, with restored files and remapped paths; leave the running board unchanged. Covered by fictional restore tests.
- [x] Activate a transferred backup in a clean isolated installation and verify sign-in, records and submitted documents through the browser. Production remote hosting/access remains separate.
- [x] Edit the same card from two devices and receive a clear conflict/reload choice rather than silently losing one edit.
- [x] Start with the default launcher command, stop, and start again without editing Docker files or re-entering saved folders; verify the same board and documents reopen.
- [x] Change a document subfolder in Settings and verify it persists. Request a new host folder outside current mounts, apply it with one launcher restart, and verify existing document links still work.
- [x] Start while a configured drive is unavailable and receive an actionable message rather than an apparently empty replacement board or document library.

## Remaining choices

- [ ] **Host:** existing computer/home server/NAS or a private cloud server; confirm its OS, persistent disk, and remote-access method so the one-command launcher and optional desktop shortcut can be tailored appropriately.
- [x] **Storage approach:** managed copies plus selectable read-only folder/vault sources; Google Docs snapshot export/import available with app OAuth setup.
- [ ] **Storage choices:** further user-selected source locations/migrations and whether native cloud editing/live references are required. These are configuration/product choices, not missing root/browse support.
- [x] **AI adapter contract:** implemented in Career Buddy supporting OpenAI, Claude, Gemini, Ollama, and custom OpenAI-compatible servers (specific live provider/model choice remains configurable by the user in Settings).
- [x] **Initial template choice:** user requested built-in CV/cover templates and a recent Google Docs CV as private reference; presets, marked templates, previews and PDF export are implemented.
- [ ] **Bespoke template approval:** approve final tailored layouts and address source-system pagination differences; do not assume the private reference CV is an approved generated template.

## Technical references

- [Docker persistent volumes](https://docs.docker.com/engine/storage/volumes/): stored data can survive the lifecycle of a container; host-visible documents may instead use bind mounts.
- [Docker Compose stop](https://docs.docker.com/reference/cli/docker/compose/stop/): stopping preserves containers, which can subsequently be started again.
- [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/): host folder access is configured at container creation and uses paths on the Docker host.
- [Compose variable interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/): the launcher can supply saved host-folder settings without requiring manual Compose edits.
- [SQLite network filesystem considerations](https://www.sqlite.org/useovernet.html): supports the proposal to keep database access local to the server and let browser clients use the API.
- [Browser directory picker compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker): direct browser folder access has compatibility and permission constraints; it does not replace hosted document storage.


## Career Buddy workflow revision — 28 October 2026

- [x] Automatic opportunity tags when a configured chat model is available; retain existing tags, model provenance and visible failure state.
- [x] Automatically assess new/changed opportunities against the saved criteria profile; serialize/coalesce jobs, report skipped/interrupted/failed states, and leave stages/outcomes unchanged. Use the independent decision model when enabled, otherwise the enabled chat model. Library evidence is selected automatically when opted in; missing criteria/model is reported.
- [x] Expanded recruiter intake fields include contact names/email/phone, reference, work arrangement, employment type, deadline and action dates. Preserve submitted notes/extracted text in the description within documented limits; uploaded originals remain retrievable in chat storage.
- [x] Master CV creation from scratch or uploaded/library template structure, with follow-up questions, reviewed editable Word draft saves/downloads and explicit layout limitations. Document Studio now supports built-in and marked templates; arbitrary unmarked-template fidelity and cross-engine pagination remain pending.
- [x] Template lookup by filename/configured folder among tracked library and selected vault sources; uploaded templates supported.
- [x] General directory browsing/multiple roots and Google Docs OAuth configuration, setup instructions, read-only search and explicit versioned snapshot imports.
- [ ] Validate Google Docs with the user’s own OAuth client and account after setup; currently verified with simulated Google responses. Connected Codex tools are not the board’s Google login.
- [x] Chat file upload with extraction preview, retained original downloads, reuse/exclusion/deletion and limits (five files per message, 5 MB each, 100 stored). Conversation files live in separate SQLite tables/full backups; no automatic library import/indexing.
- [x] Replace Buddy’s supporting-document picker with Use career library and automatic relevance selection across available cached vectors/text/metadata, bounded to 20 sources plus an explicit template. Show source coverage; uploads work independently of the checkbox.
- [x] Infer coach/STAR/recruiter/update/master-CV intent conversationally. Keep explicit target confirmation for opportunity updates and reviewed action saves.
- [x] Unified history across prior modes, paginated earlier messages, prior proposals in model context, and persisted pending/failed user messages so timeouts do not erase submissions.


## Buddy conversation navigation

- [x] Accessible chat-history sidebar with title search, active-conversation indication, dates/message counts and New conversation. Active messages stay in a bounded scroll panel; source/upload controls fold away.
- [x] Separate persisted conversation IDs and model contexts. Existing ungrouped messages remain available as Earlier chat history without rewriting original rows. Scoped older-message pagination and restart persistence.
- [x] Preserve unsent text while switching chats in the current page; clear source/template/target selections to avoid accidental carry-over. Responsive sidebar stacks on narrow screens and can be collapsed.


## P2 CV and cover-letter layouts — 29 October 2026

- [x] Classic, Compact, Executive and Cover letter presets with downloadable blank Word templates.
- [x] Keep-existing-layout rendering, explicit marked-template insertion, editable draft text, actual page count/target warnings, page images, PDF/Word downloads and reviewed new-draft saves.
- [x] Bundled local renderer/fonts, bounded private previews, source revision checks and unchanged submitted originals.
- [ ] Native Google Docs editing, arbitrary unmarked template reconstruction and guaranteed cross-engine pagination. Preserve source-system PDF copies where fidelity matters.
