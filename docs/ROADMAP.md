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


## Embedding configuration and decision-model planning

Embedding settings now have their own provider, endpoint, model ID and private API key, separate from Career Buddy chat settings. OpenAI, Ollama and custom compatible endpoints are configurable. Saving performs no network request and does not activate semantic indexing. Embedding capability testing, model discovery, vector storage and hybrid retrieval remain open. The plan also contains a separate decision-model placeholder for user-defined fit criteria and evidence-based, reviewable recommendations.


The Docker image now bundles a pinned local MiniLM embedding model with CPU inference, remote model loading disabled and a built-in fictional-text test. New embedding configurations use it by default. Existing external embedding choices remain saved. Library indexing and semantic retrieval still require implementation.


## Persistent local vector indexing — semantic search step 2

The Career Library now offers explicit selection of managed library files and selected read-only vault sources for local MiniLM indexing. Vectors, chunk hashes, model revision and source fingerprints persist in SQLite. Background jobs report document/chunk progress, allow cooperative cancellation between batches, retain completed documents, and offer explicit retry. Jobs interrupted by a restart stay stopped. Changed files are invalidated on status refresh and verified by hash before reuse/publication; deleted/reset/deselected sources lose their vectors. Unchanged completed sources reuse their vectors. Backups include the vector table. Restored or moved files may require reindexing when their file metadata changes. Originals remain unchanged.

This release requires the built-in local embedding provider for indexing; saved external settings are preserved but external indexing is still pending. Career Buddy continues to use keyword retrieval. Step 3 is hybrid semantic/keyword retrieval with source references and quality tests.


## Career Buddy hybrid retrieval — semantic search step 3

Career Buddy now combines semantic and keyword rankings for selected sources with saved compatible MiniLM vectors. Query embeddings run locally, passage rankings are fused within the existing context budget, and unindexed sources remain available through keyword matching. Replies persist search mode/fallback reasons and per-source passage references. Source hashes are rechecked after query inference; changed, deleted/deselected or reset sources cannot supply stale semantic evidence. No automatic document indexing or external embedding call is introduced.

Keyword fallback covers absent/incompatible indexes, busy indexing, model failure and unusable semantic matches. Library list filtering remains metadata-only. External embedding providers/custom vector stores, retrieval tuning against a user-approved corpus, and the separate criteria-based decision model remain open.


## Opportunity criteria and decision assessments

Settings now provides a saved criteria profile (up to 30 required/preferred criteria) and independent decision-model provider, endpoint, API key, model discovery and connection-listing test using the existing provider adapters. These settings default off and do not inherit chat credentials. Each opportunity has a Fit assessment tab with explicit evidence selection (up to 20 files). Assessments combine the current opportunity, criteria and selected excerpts using the existing hybrid retrieval; criteria can also be assessed against the opportunity alone, with missing candidate evidence left unknown.

Each dated result saves per-criterion met/unmet/unknown, cited source IDs, reasons, questions and a recommendation, alongside the exact criteria and model revisions. Unmet/unknown required criteria forbid an unqualified proceed recommendation. Invalid responses, missing criteria, unsupported citations, edit proposals and drafts are rejected without saving an assessment. Opportunity stages/outcomes never change automatically. Criteria, model, opportunity or selected-file changes mark prior results out of date on refresh. Assessments persist in SQLite, JSON exports and full backups; API keys remain private. Multiple named profiles, formal manual decision reasons and live-provider quality validation remain future work.


## Standalone Career Buddy workspace

The sidebar Career Buddy page has four career-focused modes sharing the configured Career Buddy provider: realistic coaching, multi-turn STAR achievement development, recruiter email/transcript/notes intake, and opportunity updates. Coaching prompts require candid, evidence-based encouragement and pushback rather than praise or invented strengths. STAR prompts ask about situation, task, individual action and results before proposing a draft story, CV bullet and cover-letter highlight. Recruiter intake proposes an employer/role and linked tasks; unknown fields should prompt questions. Updates require an explicitly selected exact opportunity; company names alone cannot authorize a change.

Selected library/vault evidence uses hybrid retrieval; no sources are selected automatically. Recruiter/update modes include up to 200 recent employer/role summaries for clarification. Pasted email/transcript text is supported; attachment parsing and email/calendar connections are not introduced. Modes have separate conversation histories and saved proposals. Review controls save draft STAR Markdown into the library, create opportunities with tasks transactionally, or apply validated opportunity changes with revision conflicts. Repeated application of a proposal is idempotent. Existing employer/role duplicates block recruiter creation. Original documents are unchanged; no applications or communications are sent. Conversations and proposals persist in SQLite, backups and record exports. Coaching quality, follow-up quality and live-provider behaviour still need user evaluation; these are prompt-guided behaviours, not guaranteed model capabilities.


## Codex CLI provider

Career Buddy and the independent decision-model settings now offer Codex · local CLI. The launcher watcher owns a host worker and private file queue in the existing state mount; no additional network port is exposed and no Codex sign-in credentials are mounted into Docker. The worker requires ChatGPT CLI sign-in, ignores user configuration, uses ephemeral read-only execution in a temporary directory, disables shell/apps/plugins/memory/web features, and constrains output to the board schema. Existing validation and reviewed actions remain authoritative. Submitted conversation context/selected excerpts are sent to OpenAI and use Codex account limits; this data destination was explicitly authorized by the user.

The default model and manual model IDs are supported; the model list intentionally offers only the default, not a fabricated account catalogue. Connection tests can run a fictional inference. Codex requests have a five-minute bounded deadline; other providers retain their existing deadlines. Missing/stale helper, sign-in/model errors and timeouts are surfaced. The launcher starts/stops the helper with the watcher. Full streaming/progress/cancel controls and broader model discovery remain pending.


## Codex model catalogue picker

Codex model discovery now requests `codex debug models` through the private host queue (metadata only). The helper exposes only visible model IDs and display names, deduplicates entries and excludes internal/hidden models and all model instruction fields. The default remains selectable; manual IDs are still supported. Existing selected providers/models are preserved. Discovery uses a bounded metadata timeout, and unsupported CLI versions/errors remain visible with a manual-entry fallback. Catalogue visibility does not guarantee account/model entitlement.


## Conversational intake and automatic opportunity review

Standalone Buddy now infers coaching, STAR, recruiter, update or master-CV intent rather than requiring a mode selection. A Use career library checkbox selects relevant sources automatically using saved vectors and cached text/metadata; retrieval is bounded to 20 sources plus an explicit template. The checkbox defaults off. Uploads and an explicitly selected template are included independently. Unified chat history displays prior modes, paginates older turns and persists failed/pending user submissions. Opportunity-specific chats remain with their opportunities.

Chat uploads support five files per message, 5 MB each and 100 retained originals. Original base64 bytes are in a separate SQLite table from extraction metadata, included in full backups and excluded from JSON record exports. Users can preview extraction, exclude/reuse files or delete originals; conversation text already saved is not erased by file deletion. Files are not silently imported into the career library or vector index.

Recruiter proposals now retain contact details, work arrangement, employment type, reference, closing/action dates, tags and source notes/extracted text. Reviewed master-CV proposals save editable Word drafts from scratch or using template structure; exact source formatting is not preserved. Templates can be uploaded or located by name/configured folder among available library/vault documents. General directory browsing and authenticated Google Docs integration remain pending.

New/edited opportunities queue automatic tags and saved-criteria assessment when a model is enabled. Existing tags are preserved. Decisions use the enabled decision model or fall back to the enabled chat model. No criterion profile is invented. Assessment does not change stage/outcome. Job state and retry are exposed in Fit assessment; jobs are serialized/coalesced and interrupted work does not automatically resume. Library evidence is used when explicitly opted into the triggering recruiter/update chat; manual opportunity edits default to opportunity-only assessment. No existing opportunities are bulk-processed on upgrade.


## Buddy history sidebar

Saved standalone conversations are now listed beside the active chat, with title search, dates/counts and a new-conversation control. Current messages scroll within their own panel, and attachment/source controls are folded away by default. New conversations have independent persistent IDs and model context; legacy messages are retained under Earlier chat history. Conversation selection is remembered in the browser. Older-message paging is scoped to the chosen conversation; unsent text survives switches in the current page, while source/target choices reset. The sidebar can collapse and stacks above the chat on narrower layouts. No existing message rows are rewritten by upgrade.


## P1 — standalone Buddy request controls

Standalone chat reports preparing sources, waiting for provider, reading response, Codex queued/running, response validation and final states, with elapsed time and the configured AI response deadline. Progress is stage-based, not a fabricated token stream/percentage. Cancel aborts the HTTP transport or writes a cancellation marker that the host worker polls, terminating only its owned Codex process group. A cancellation check before response validation prevents a late provider result from creating an assistant proposal. Browser disconnection also requests cancellation. Submitted user text remains available for explicit retry; no automatic retries are introduced.

Settings exposes timeout 30–900 seconds, HTTP response budget 512–8000 tokens and source budget 4000–36000 characters. Defaults remain 120 seconds for HTTP and 300 for Codex unless explicitly saved. Response timeout applies to the provider/queue wait, not preceding document extraction. Codex output length remains CLI-controlled. Request metadata (provider/model/stage/timestamps/duration/error category) is stored in SQLite/full backups without prompts or keys. Unfinished requests/messages are marked interrupted after restart. HTTP cancellation closes the client connection; providers may continue remote work and usage may still accrue. Other Buddy/decision provider calls share timeout/output settings, and now also have interactive progress/cancel controls.


## Document connections — 29 October 2026

Career Library and Settings now offer multiple independently mounted read-only folders, paged browsing, explicit source selection and detach/cache cleanup. The launcher applies mounts and restarts without manual Docker changes. Folder originals stay in place. Google Docs has app-owned OAuth setup fields/instructions, session-bound PKCE sign-in, server-side tokens/refresh, paged native-document search, explicit DOCX draft snapshot imports and version-based duplicate detection. Originals are never edited. Live Google authorization remains pending the user’s OAuth client and consent; tests simulate Google responses. See [Document connections](DOCUMENT_CONNECTIONS.md).


## P1 request controls across opportunity workflows — 29 October 2026

Opportunity chat and manual assessments share the standalone request registry, provider abort signal, progress stages, elapsed time and persisted terminal diagnostics. Views recover the latest scoped status after reopening; explicit retries use the existing send/assess controls. Cancelling prevents late provider replies/assessments from being saved. Automatic review supports cancelling queued or running work, aborting current tag/fit calls and skipping subsequent steps. Already completed tags/assessments remain; cancellation is not a rollback. Queued requests are not automatically retried after restart. Token streaming and provider-side cancellation acknowledgement remain pending.


## P2 document layouts and PDF export — 29 October 2026

Document Studio is available in Career Library and opportunity Documents. It supplies four built-in layouts/blank templates, keep-original rendering and a single marked-paragraph custom template workflow. New Buddy drafts retain reviewed text for layout reuse. Actual PDF page counts, target warnings, page images and source revision checks precede explicitly reviewed Word/PDF draft saves. LibreOffice/Poppler/fonts are bundled; no AI is called. Originals/submitted files remain unchanged. Temporary previews expire; saved drafts use existing storage/backups. Exact cross-engine pagination and arbitrary unmarked template reconstruction remain pending; use source-system PDFs as faithful visual copies. See [Document Studio](DOCUMENT_STUDIO.md).

## P3 career document categories — 29 October 2026

Structured categories distinguish master/tailored/general CVs, cover letters, templates, supporting statements, STAR/interview stories, job descriptions, references and other documents. Categories are independent of file kind, tags, approval status and physical folders. Uploads accept categories; document rows allow individual edits; library selections support atomic batches up to 500 with revision conflicts checked before any write. Category filtering combines with the existing folder/preparation/tag views. Legacy defaults are derived without rewriting stored rows; known master/tailored generation context supplies reliable defaults. Templates remain selectable explicitly but are excluded from automatic standalone Buddy/fit evidence. Reclassifying a source as a template makes its prior fit assessment stale. Studio copies inherit source category. Files and submitted bytes are preserved.
