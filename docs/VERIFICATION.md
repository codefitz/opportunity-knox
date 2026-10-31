# Initial increment verification — 22 October 2026

Only fictional data and temporary document folders were used for runtime testing. No existing career documents or applications were imported.

## Automated checks

`npm run check` runs the production TypeScript/Vite build, seven real HTTP API integration tests, and fourteen launcher tests. The API tests bind loopback ports and use temporary SQLite databases and files.

Coverage includes password setup/login, setup-token checks, request origin validation, record persistence across server recreation, dated transitions and corrections, revisiting a stage, simultaneous-edit conflicts, concurrent notes, variable interviews and rescheduling, versioned uploads, immutable submitted files, retained storage roots, invalid/symlink-escape paths, selected backup locations, complete snapshots and failed-backup cleanup. Launcher tests cover flags, saved configuration, folder validation, stable mounts, literal dollar escaping, host UID/GID, pending requests, and preserving configuration after failed startup.

## Docker runtime checks

- Built the actual Node 24 production image and started it through `./board start` from the requested Git repository. Container health checks passed.
- Created an isolated password and fictional opportunities through the running API.
- Uploaded a test JD, then requested a new host folder in Settings.
- Applied the change through `./board restart`. The new path included both spaces and a literal dollar sign.
- Verified the old JD still downloaded byte-for-byte through its retained mount, uploaded a new document into the new location, and checked stage history and interview entries remained intact.
- Created a complete database/document backup under the selected `private/backups` subfolder and verified an empty pending-folder setting removes the restart request.
- Stopped and restarted the service with its saved configuration; verified records and attachments again afterward.

## Browser checks

Reviewed the Docker-served application in the in-app browser: signed in, opened an opportunity, changed stage, added a note and an interview, and inspected the combined chronological summary. The board preview in `preview.png` contains clearly labelled fictional test records.

This was a desktop browser smoke check. Exhaustive browser/mobile compatibility, the native double-click shortcuts, reverse-proxy/VPN deployment, automatic engine startup from a fully stopped desktop environment, and guided restore have not been independently verified. AI and cloud connectors remain unimplemented as described in `ROADMAP.md`.

## Version 0.2 — job-link lookup

The production build passes. All 37 Node tests (including 14 page-parser, 14 safe-transport, and 9 API integration tests) and 14 launcher tests pass.

Parser fixtures cover structured JobPosting fields, nested graphs/references, readable paragraphs/bullets, salaries and valid deadlines, multiple-job ambiguity, page-content fallback, LinkedIn public/guest markup, optional sign-in overlays, and rejecting login/challenge pages. Transport tests cover public DNS pinning, URL/address tricks, private redirects, mixed DNS answers, compression/body limits, total deadlines, TLS failures, and useful PDF/manual fallbacks. API tests cover authenticated preview without card creation, saving extracted fields/provenance, persistence and bounded concurrency.

The actual production Docker image retrieved and parsed the user-supplied public LinkedIn listing for Software Delivery Analyst - Orchestro at McKinsey & Company. It returned the company, role, London location, Full-time employment type and the full 6,836-character description; unknown salary/deadline fields remained blank. The browser check fetched the listing into the new opportunity form, preserved a manually entered employer label, saved the reviewed draft in isolated test storage, and displayed its source/retrieval note in Summary. No career documents or user application records were sent for lookup or imported into the Git repository.

Only publicly readable HTML is supported. JavaScript-only pages, site access restrictions, OCR/PDF extraction and complete original-page snapshots remain outside this increment. A successful check of one LinkedIn listing does not establish that every LinkedIn listing will be publicly accessible.


## Version 0.3 — Opportunity Knox workspace

`npm run check` passes: production TypeScript/Vite build, 50 Node tests and 14 Python launcher tests. This includes eight dashboard/date/queue calculation tests and fourteen HTTP API integration tests. The API tests require permission to bind temporary loopback ports.

New coverage checks all four theme values without resetting existing settings, profile validation and stale revisions, PNG/JPEG/WebP signatures and invalid/oversized image rejection, task date/link validation, complete/reopen behaviour, due-date ordering, database recreation, task/photo inclusion in private backups, and export exclusion of private image bytes. A database with only the old tables is opened and upgraded without changing its opportunity history or settings.

Statistics checks cover empty data, date-only values, workspace-midnight/DST/leap-day boundaries, activity windows, repeated and backdated submitted-stage entries, distinct opportunity counts, outcome denominators, task ordering and completed/closed exclusion. The submission series uses the first recorded Submitted-stage event for each opportunity; later notes and revisits do not shift that first application date. Outcome share is hired divided by hired plus rejected; an empty denominator displays no rate.

Browser checks use a separate Docker container and entirely fictional records/documents, without reading or changing the user's career files. Verified dashboard totals against six opportunities, four recorded submissions, five open manual tasks and one planned interview; checked the activity period selector and pipeline drill-down. Verified standalone Kanban/list/library/settings/to-do routes, browser back/reload, task creation/editing/completion/reopening, native due-date editing and ordering, and profile name/photo upload. Profile, tasks and theme persist after recreating the container. Ocean and Cappuccino theme persistence and Midnight forms/charts were inspected. The library visibly says AI indexing is not connected and invites all career-related material for future extraction/chunking/retrieval.

Desktop and 390-pixel phone layouts are smoke-tested. The activity chart measures its available width so axis labels retain their size on narrow screens. `preview.png` shows the Cappuccino dashboard with fictional QA records. Exhaustive browser/device compatibility, external private hosting and AI processing remain outside this increment.

The existing installation was upgraded with `./board restart --no-open`. Docker reports a healthy container running package version 0.3.0 at port 4318. Before upgrading, a private SQLite backup was saved under the installation state directory. Afterward, every existing row in records, documents and configuration was compared with that snapshot and matched; the new task table was added without resetting previous data. Installation folders, mounts and launcher commands retain their previous names for compatibility.

## Version 0.4 — Career Buddy

`npm run check` passes: the production TypeScript/Vite build, 75 Node tests and 14 launcher tests (89 tests total). New tests cover all five provider request/response adapters, JSON/schema/prompt modes, masked settings and stale configuration revisions, safe endpoint configuration and header authentication, bounded/no-redirect transport, controlled error messages, incomplete/refused responses, local UTF-8/PDF/DOCX extraction, chunk retrieval, structured-output validation and allowed source IDs. The dependency install reports zero known vulnerabilities.

The 23 HTTP integration tests include Career Buddy settings persistence/off mode, key exclusion from exports, private backup inclusion, source scoping to library/current-opportunity files, explicit optional other-opportunity summaries, advice requests that cannot edit records, candidate-evidence requirements for drafting (including free chat), persisted chat, duplicate-request replay, reviewed date/feedback application, duplicate-apply protection, stale proposals, concurrent setting edits, a manual edit while the model is thinking, versioned Word drafts, submitted-original preservation, and concurrent duplicate-save protection.

An isolated Docker container was connected to a private mock API on an internal Docker network, using only fictional opportunities and source files. Browser checks configured the custom API through Settings, saved it, ran the connection test, used all five presets, entered the supplied second-interview/Databricks example, edited the proposed interview type, applied it, and verified its date/feedback under Interviews & comms. CV and cover-letter drafts were saved and displayed as Draft Word documents with download links. Library preparation and source coverage were checked. Desktop and 390-pixel phone layouts were inspected in Cappuccino and Midnight, including configuration navigation and horizontal overflow. The browser recorded no warnings/errors during the checks. `career-buddy-preview.png` shows fictional data and a mock model, not a live paid-provider result.

The app was recreated from its production Docker image, then settings, twelve prior chat messages, the applied interview and both Word drafts were verified after login. PDF extraction was exercised in the Node 24 container against a rendered fictional PDF and returned readable chunks. The generated fictional CV and cover-letter DOCX files were rendered with the bundled LibreOffice/document renderer and every page inspected: both were readable one-page samples without clipping or overlap. The Word output is an editable clean layout, not reproduction of an uploaded CV template. A sample render does not prove every future model-generated document will fit a chosen page count.

No real career files, API keys, personal chat or paid-provider calls were used. Native provider API contracts are covered by deterministic transport fixtures; actual account/model access, Ollama server reachability and live model quality still require the user's configured connection. Salary answers have no live market lookup. OCR, automated PDF export and template-fidelity rendering remain future work.

The main installation was upgraded with the existing `./board restart --no-open` command. Docker reports a healthy service running 0.4.0 at port 4318. A pre-update SQLite snapshot was saved; every existing row in opportunities, documents, configuration and tasks matched it afterward. The new chat/text tables were empty, and Career Buddy remained unconfigured/off. No mock configuration or test data was copied into the user's board.


## Version 0.4.1 — private network hostnames

`npm run check` passes: the production build, 77 Node tests and 14 launcher tests. Tests exercise saving an HTTP hostname offline, an actual loopback request with a private DNS result, and rejection before connection when results are public, mixed, or link-local. Hostnames are resolved and checked at connection time, and the validated addresses are used directly by the socket.

The user's supplied hostname resolved to a private address on both the Mac and in the Docker container. The remote Ollama `/api/tags` endpoint returned HTTP 200. An isolated Node 24 application container saved the hostname through the settings UI and sent a connection request with a deliberately nonexistent model; Ollama returned the expected HTTP 404 for that model, confirming the request reached the server. No career records were sent. Installed model names were read, but no live model generation was run or automatically loaded.

The main service was rebuilt and restarted with `./board restart --no-open`. Docker reports version 0.4.1 healthy. Existing records, documents, tasks, settings, chats and extracted-text caches matched a pre-update SQLite snapshot. A second request through the running application's adapter reached Ollama and returned the expected 404 for the nonexistent test model. No live model was loaded and no user settings were changed.


## Version 0.4.2 — model discovery and connection testing

`npm run check` passes: production build, 82 Node tests and 14 launcher tests. New tests exercise model-list protocols for all five providers, Gemini chat-capability filtering, pagination indicators, bounded/no-redirect transport, errors, temporary unsaved settings, authentication, stale revisions, and preventing saved credentials from being sent to a different provider. Provider API account access is represented by fixtures, not live paid credentials.

An isolated Docker installation with separate fictional data connected to the user's private Ollama server. The Settings page discovered 16 installed models, suggested a likely chat model, enabled a connection test before saving, and reported success without loading a model. Another listed model was selected, saved and verified after reloading. A deliberately nonexistent manual model produced the expected clear error. No career records or model-generation prompts were sent. A suggested model is a heuristic, not proof it supports structured output or runs adequately on the host. The list can contain non-chat models; the app does not install models. Each provider list is limited to one page (up to 1,000 models); incomplete pages are identified, and manual entry remains available.

The existing installation was rebuilt and restarted with `./board restart --no-open`; Docker reported it healthy at version 0.4.2. Opportunities, documents, tasks, settings, chats and extracted-text caches exactly matched a private SQLite snapshot taken immediately before the update. The existing Ollama provider and server URL were preserved. Restarting invalidated the browser session. After the user signed in, Career Buddy showed enabled with a discovered model saved; the live Settings connection test succeeded and reported 16 models without loading one or sending career records.


## Version 0.4.3 — theme variety and custom colours

`npm run check` passes: the production TypeScript/Vite build, 83 Node tests and 14 launcher tests. The API tests cover all added theme IDs, colour validation and normalisation, independent colour changes, reset, legacy defaults, persistence after a server restart, and preserving unrelated settings and opportunities.

A separate Docker installation with fictional data was checked in the browser. Lavender and the dark Plum and Graphite presets were previewed. Custom accent and background tint choices were made with the native colour picker, saved and verified after reloading. Preview-only changes did not change the appearance on another page and reappeared when returning to Settings; reset preserved the selected preset and was saved after review. A simulated second device changed the accent while a theme change was pending, and the two independent changes survived the save. Graphite and the saved accent persisted after restarting the test container. Simultaneous changes to the same field still use last-writer-wins.

An independent simulation exercised the actual theme application code against all eight preset palettes and 280 combinations of tints and accents. It checked text contrast against the main surfaces and the generated accent, soft surface and button text combinations. This calculation supplements, rather than replaces, desktop visual checks. The new library copy describes keyword matching and the absence of vector or semantic search. The existing responsive layout is retained; this increment was not separately tested in a phone browser.

The existing installation was rebuilt and restarted with `./board restart --no-open`; Docker reported it healthy at version 0.4.3. Opportunities, documents, tasks, settings, chats and prepared-text caches exactly matched a private SQLite snapshot taken immediately before the update. The existing appearance and Career Buddy settings were preserved. Restarting invalidated the browser session, so the user must sign in again to use the updated interface.


## Version 0.4.5 — automatic appearance and library organisation

`npm run check` passes: the production build, 94 Node tests and 16 launcher tests. New integration tests move single and multiple fictional library files, verify their document IDs, hashes, notes, tags and prepared text remain linked, and verify persistence after restart. Tests reject traversal, stale revisions, duplicate selections, submitted versions and destination collisions without losing originals or overwriting existing files. Moving from a previous storage root keeps the old copy.

A separate Docker installation with fictional documents was checked in the browser. Theme and custom accent changes saved automatically, including rapid changes, survived reload, and showed a retry control after a simulated outage. The used and unused source sections folded independently. Two sources were moved together to a nested library folder and one moved back to the top level; prepared text remained ready. An invalid destination produced an in-dialog error. These are isolated test data and do not verify arbitrary host folders: the supported destination is within the configured Career Library folder.

The existing service was updated to 0.4.5 using the tested image. Its prior server and frontend matched the current repository snapshot before this change, and its environment, storage mounts and port binding were preserved. Opportunities, documents, tasks, settings, chats and prepared-text caches matched the private pre-update database snapshot. The other uncommitted repository changes were retained.


## Read-only Obsidian and large uploads — 27 October 2026

The combined production build and test suite passed: 97 Node tests and 18 launcher tests. Collection tests cover 1,007 fictional files for both folder-picker and dropped-directory paths. Read-only vault tests check that connecting and a rejected export leave a fictional vault unchanged; launcher tests check the read-only mount and failed-restart reporting.

A separate Docker board with a fictional vault completed the host restart handoff, and its vault mount was confirmed read-only with its test contents unchanged. The user's already selected vault was subsequently connected in read-only mode; the running container's mount was verified read-only, and no vault import or export was performed. This is a mount/connection check, not a test of syncing the user's vault contents.

A second isolated Docker board and browser test selected 501 fictional files, displayed the large-upload warning, uploaded 500 with batching selected, retained the final file in the queue, and uploaded it on the next action. Automated collection tests cover more than 1,000 selections; they do not establish a performance guarantee for arbitrarily large folders. The queue is in browser memory, and existing per-file size and hidden-folder rules still apply. The isolated test board was removed; no fictional documents were added to the user's board.


## Isolated restore foundation — 27 October 2026

The offline restore command validates a backup, refuses an existing destination or a destination inside the backup folder, copies its database and documents into a new workspace, and remaps document storage paths. It writes a restore report without starting a server. The isolated fictional test verifies submitted bytes, remapped document access, unchanged source database, damaged-backup rejection and existing-destination protection. The full project check passed. No user backup was restored in this test. Restored databases retain private credentials and conversations; the command does not launch them. A browser restore workflow and deployment validation remain unfinished.


## Embedding settings

The production build and full test suite passed after adding embedding configuration. A fictional integration test verifies authentication, independent chat settings, revision conflicts, secret-safe responses and exports, persistence after restart, and clearing keys when changing provider. No embedding request or real document indexing was performed.


## Bundled embedding model

The production image includes Transformers.js 3.8.1 and quantized Xenova/all-MiniLM-L6-v2 at revision 751bff37182d3f1213fa05d7196b954e230abad9. Build downloads verify recorded SHA-256 hashes; the model card, Apache-2.0 licence text and revision/hash manifest ship with the model. A read-only production container with networking disabled produced deterministic, finite, normalized 384-dimensional vectors from repeated fictional text. The full project check passed (104 Node tests and 18 launcher tests). No user documents were embedded. Existing saved external provider choices are preserved; new configurations default to the bundled model. Vector indexing and semantic retrieval are still pending.


## Persistent vector indexing

The production build and all 108 Node tests plus 18 launcher tests pass. New fictional-data tests verify authenticated explicit indexing, finite normalized 384-dimensional output validation, SQLite restart persistence and unchanged-vector reuse, changed-source invalidation, text reset/removal cleanup, cancellation without publishing partial documents, concurrent-job refusal, retry, safe failure on source edits during inference, stopped interrupted jobs, backup inclusion and unchanged original file content.

An isolated read-only production container with networking disabled indexed a fictional text document into three real MiniLM vectors, verified their dimensions/normalization, verified the original file hash, and retained the index across an application restart. No personal documents were indexed. Live browser inspection was unavailable (`browser.user is unavailable`); visual confirmation remains pending. Semantic/keyword retrieval integration remains separate and pending.

The tested image was deployed to the existing board after an online SQLite backup. Docker reported the service healthy, the `/vault` mount remained read-only, and the live vector table contained zero sources immediately after deployment. No indexing job was started for user documents.


## Hybrid semantic/keyword retrieval

The production build and all 112 Node tests plus 18 launcher tests pass. Fictional tests verify synonym passage recovery under a tight context budget, source identity and unchanged inputs, selected-source isolation (including an indexed but unselected file), suppression of unsupported source IDs, mixed indexed/unindexed sources, model failure fallback, incompatible models/chunk hashes, and exclusion of evidence changed, cleared or deselected during query inference. Chat retrieval mode, passage references and source coverage persist after restart.

In a read-only production container with networking disabled, the real bundled MiniLM model ranked the expected passage first for three fictional synonym queries: people management, infrastructure modernisation and information stewardship. Hybrid retrieval included each expected passage within a 140-character budget, retaining source/passage references; clearing the index produced an honest no-index fallback. This is a small regression corpus, not an accuracy benchmark for personal career documents. No personal documents were indexed or sent to a model during these tests. Browser inspection remained unavailable (`browser.user is unavailable`), so visual confirmation is pending.

The tested image was deployed after an online SQLite backup. The service is healthy; checksums of records, document metadata, tasks, chats, prepared text, all 1,617 saved vector sources and configuration matched the pre-update snapshot. The vault remained mounted read-only. Deployment did not start an indexing job. The existing completed indexing job had 142 sources with no readable text; these need extraction/OCR before semantic indexing.


## Criteria and independent decision-model assessments

The production build and all 115 Node tests plus 18 launcher tests pass. Fictional tests validate criterion IDs/priorities/revision conflicts; complete per-criterion results; real allowed citation IDs; no proceed with unmet/unknown required criteria; independent model configuration and private API keys; selected source context; rejection of record edits; unchanged opportunity revision; criteria and changed-source staleness; persisted historical snapshots; secret-safe exports; and assessment table inclusion in full backups.

A read-only production container with networking disabled ran the authenticated workflow using fictional records and a simulated provider. It verified independent model activation without enabling chat, unknown criteria and follow-up questions, saved assessments across restart, unchanged opportunity state, stale criteria and secret-safe exports. No live AI provider or real career documents were used in this verification. Live-provider assessment quality and browser visual checks remain pending.

The tested decision-review image was deployed after an online SQLite backup. Docker reported healthy; checksums of records, documents, tasks, chats, prepared text, vectors and configuration matched the pre-update snapshot. The vault remained read-only. The new assessment table was empty and the decision model remained disabled. Browser inspection returned `browser.user is unavailable`; no live provider or user-data assessment was run.


## Standalone Career Buddy workspace

The production build and all 116 Node tests plus 18 launcher tests pass. New fictional integration coverage verifies authentication, coaching prompt constraints, no coach record edits, no update proposal without an explicit target, reviewed STAR library saves, idempotent saves, recruiter intake with linked tasks, no creation before confirmation, rejection update confirmation, stale-update conflicts, history across restart, JSON export and full backup table inclusion.

An isolated read-only production container with networking disabled and a simulated provider exercised recruiter intake, verified no opportunity existed before confirmation, saved one opportunity and linked task, repeated confirmation without duplicates, restarted and verified applied conversation history and export. No real career documents or live AI calls were used. Live-provider coaching/STAR quality and browser visual verification remain pending.

The tested workspace image was deployed after an online SQLite backup. Docker reported healthy. Checksums for existing records, documents, tasks, opportunity chats, text/vector caches, decision assessments and configuration matched the pre-update snapshot; the vault remained read-only. The standalone history table was empty: no user-data conversation, document generation or opportunity update was run during deployment.


## Authorized Codex provider

The production build and all 118 Node tests plus 20 launcher/helper tests pass. Fictional tests cover provider key clearing, fixed internal bridge location, helper readiness/staleness, invalid model IDs, private queue cleanup, fake CLI lifecycle, and read-only/ephemeral/tool-disabled command construction. Existing Career Buddy/decision tests still pass.

With explicit user authorization, the installed codex-cli 0.164.0 completed a fictional structured-output request using ChatGPT sign-in. JSONL events contained only an agent message, with no command/tool items. A second fictional request through the real host queue returned the actual Career Buddy JSON schema. No personal records or career files were supplied. These checks verify connectivity/schema transport, not coaching quality. Browser visual checks remain pending.

The tested Codex image was deployed after an online SQLite backup. The host launcher watcher was restarted with the Codex worker, and Career Buddy alone was switched to enabled Codex/default with no API key. The deployed Docker board completed a fictional real Codex inference through the private host queue and returned valid Career Buddy JSON. All tracked records, documents, tasks, chats, text/vector caches, assessments and standalone history matched backup checksums; careerBuddy was the only changed configuration key. The helper was ready, request/response test files were cleaned, and the vault remained read-only. No personal career content was used for these checks.


## Codex catalogue model selection

The full check passes: 119 Node tests and 21 launcher/helper tests. Added tests cover metadata request routing, bounded expiry, transient-file cleanup, catalogue visibility filtering, deduplication, invalid IDs and exclusion of model instruction fields. The final UI-copy change also passed the production build. A real host-worker metadata request returned eight visible models plus the default option; no inference prompt or career data was sent. Browser visual verification remains pending.

The catalogue-capable helper and tested board image were deployed after an online SQLite backup while Codex/indexing were idle. Docker reported healthy. A metadata-only query from the deployed container returned eight visible CLI models plus default. Existing records/caches/assessments/histories/configuration checksum comparison: unchanged. No saved model was intentionally changed.


## Buddy conversational workflow revision

The production build and 121 Node tests plus 21 launcher/helper tests pass. New fictional integration tests verify inferred recruiter/CV intent, attachment extraction/original downloads/removal and backup inclusion, contact/reference/work-mode/tag retention, original intake text, automatic library/template evidence, concurrent idempotent master-CV saves, unified cursor-paginated history, persisted failed submissions, and automatic tag/profile assessment using the chat-model fallback without changing outcomes.

A real Codex call in an isolated container read only a fictional recruiter attachment, inferred recruiter intent, retained contact/reference/tags, and saved a reviewed opportunity with source notes and visible unified history. No personal career material was supplied. A disposable UI with a simulated provider was inspected in the browser: prior coaching and STAR turns appeared together, the mode selector/supporting-source picker were absent, and library checkbox/upload/template controls were visible. Screenshot and accessibility inspection confirmed the layout.

Google Docs authentication/search, arbitrary host-directory browsing and exact template formatting remain unimplemented. Existing historical records will not be auto-processed merely by deployment.

A second isolated real-Codex run enabled automation: it generated role tags and assessed a saved London-location criterion as met, using the chat-model fallback. No user records or career-library files were mounted into the test container; only the authorized helper queue was shared. The final extraction-warning context change passed the complete test suite.

The tested workflow image was deployed after an online SQLite backup while Codex/indexing were idle. Docker reported healthy. Existing records, documents, tasks, chats, text/vector caches, fit assessments, standalone history and configuration matched backup checksums; the vault remained read-only. New attachment/original/automation tables were empty, confirming that deployment did not bulk-process existing user opportunities or upload personal files. The disposable fictional UI container and tab were removed after verification.


## Buddy sidebar conversations

The production build and all 122 Node tests plus 21 launcher/helper tests pass. New fictional tests verify legacy-history grouping, independent conversation IDs and model context, identical request IDs scoped to different chats, cursor pagination within one conversation, empty new conversations, invalid IDs and restart persistence. Existing record/history compatibility tests continue to pass.

A disposable browser installation with fictional records and a simulated provider was inspected: the sidebar showed earlier history, New conversation opened an empty chat, sending a message created a separate titled history entry, and selecting earlier history restored the original coaching/STAR turns without the newer conversation. Screenshot/accessibility inspection confirmed the two-column layout, active selection and bounded chat panel. Responsive CSS is implemented; a phone-size browser check was not performed. No personal data or real AI calls were needed for this change.

The verified sidebar image was deployed after an online SQLite backup with AI/indexing jobs idle. Docker reported healthy. All tracked records, documents, tasks, chats, caches, assessments, attachment originals/metadata, automation state and settings matched pre-update checksums. Legacy messages were not rewritten. The disposable browser preview was removed.


## P1 — request progress, cancellation and limits

The production build and all 127 Node tests plus 22 launcher/helper tests pass. Fictional regression tests verify configured bounds/output budgets, HTTP transport abort, board deadline vs cancellation, authenticated status retrieval, safe request metadata, no saved proposal after cancel, explicit retry/persistence, restart interruption state, Codex cancel marker/queue cleanup and actual termination of a simulated owned CLI process. No real career records or AI inference were required.

A disposable browser preview with a deliberately slow simulated provider showed waiting stage, elapsed time, AI response limit and Cancel request. Cancel returned the UI to Retry, preserved the user submission and showed cancelled status without a failure alert. Settings exposed limits and accepted/saved a changed timeout. Screenshot/accessibility checks confirmed the controls. The final settings-test correction and cancellation label cleanup passed the full check. Shared settings apply to other provider calls, but interactive cancellation/status controls are currently standalone-chat scope.

P1 was deployed after an online SQLite backup while AI/indexing were idle; the host watcher/helper was restarted with process cancellation support. Docker reported healthy. A fictional prompt from the deployed container completed through real Codex and reported queued-codex then running-codex. All existing records, chats, documents, caches, assessments, attachments, automation state and configuration matched pre-update checksums. Existing provider choices/default limits were not changed. The disposable preview was removed.


## Document connections — 29 October 2026

- `npm run check`: production TypeScript/Vite build, 129 Node tests and 24 Python launcher/helper tests passed. New tests use fictional folders/documents and simulated Google responses.
- Verified folder path containment, hidden/symlink exclusion, persistent selection, local text preparation without original changes, deselection cache cleanup and detach preservation. Launcher tests verify independent read-only bind configuration and rejection of state/managed-root overlap.
- Google tests verify private configuration redaction, OAuth state/PKCE, mismatched board-session rejection, replay rejection, token refresh, native-document search/export, version duplicate handling, restart persistence, disconnect/revocation and record-export credential exclusion. No live Google account was connected.
- Isolated read-only Docker preview with disposable state: browser verified nested folder browsing, checkbox selection/save, automatic semantic-source count refresh, collapsible Google setup instructions, masked client-secret/configuration fields and disabled Connect until configured. Existing personal documents/vault were not used for testing.
- Live Google OAuth acceptance/export still requires the user's own Google Cloud client and consent. General folder mount behavior is covered by launcher tests; real personal roots remain unconfigured.

Deployment: tested image installed on the running board after an online SQLite backup. All persisted table checksums matched before/after deployment; existing vault mount remained read-only. Launcher watcher refreshed for source-mount requests. Google remains unconfigured; no user files imported, indexed or submitted to AI during verification.


## Opportunity AI request controls — 29 October 2026

`npm run check`: production build, 133 Node tests and 24 Python launcher/helper tests. New delayed fictional-provider regressions cover opportunity cancellation with late-response rejection and retry/restart persistence, manual decision cancellation without saving, and automatic tag cancellation without late mutations. Scoped status lookup is verified. Isolated Docker/browser check confirmed waiting-provider/elapsed display, cancellation, retained message for immediate resend, enabled send controls after cancellation, and persisted cancelled status after switching tabs. No personal documents or live AI accounts used. Manual/automatic cancellation is covered through API tests; their full live-provider playthrough remains pending.

P1 deployment: online database backup created before the update; tested image healthy on port 4318. All existing SQLite table checksums matched before/after. Existing read-only vault mount retained. No real AI requests or personal-source indexing used for verification.


## P2 document studio — 29 October 2026

- `npm run check`: TypeScript/Vite production build, 139 Node tests and 24 Python launcher/helper tests passed. New tests cover built-in content/style differences, template tables/style preservation and XML escaping, required unique content markers, unsafe package rejection, protected previews, page-target warnings, reviewed/idempotent saves, source conflicts and original-byte preservation. Renderer failures do not publish drafts.
- Isolated Docker renders use actual LibreOffice, PDF metadata and page PNGs. Fictional Classic/Compact/Executive/letter pages were visually inspected. The document skill renderer also rendered a fictional Word sample successfully with the bundled workspace Python.
- Isolated browser verification: source/layout/page-target controls, real one-page preview, explicit review before save, saved new PDF draft and disabled saves after changing settings. Preview does not approve or submit a document.
- A user-authorized private Google Docs CV was exported for layout comparison. Its native PDF has two pages; DOCX-to-PDF conversion produced four, including overflow. This is a known cross-engine fidelity limitation, not a verified reproduction. The original cloud file is unchanged; personal exports are kept outside Git. The faithful source PDF is retained alongside the editable snapshot in private managed storage.

P2 deployment: tested image healthy after an online SQLite backup. All existing table checksums matched before/after deployment and the vault remains read-only. Both explicitly requested private CV snapshots were uploaded through the signed-in library; saved hashes match source exports, with draft status and native Google Docs provenance in notes. Live studio presence and authenticated endpoint protection verified. No personal files are part of Git or the image.


## P3 document categories — 29 October 2026

`npm run check`: production build, 143 Node tests and 24 Python launcher/helper tests passed. Added API regressions cover category persistence, unchanged submitted bytes/type/status, invalid/stale edits, atomic bulk conflicts and duplicate IDs, legacy defaults without stored-row rewrites, and template exclusion from automatic Buddy evidence while preserving explicit template use.

Isolated Docker/browser check with fictional CV/story documents verified individual category saves/count refresh, category filtering and bulk categorisation across both files. Category metadata does not move files or alter their approval status. Defaults are conservative; personal historical documents are not guessed into new categories.

P3 deployment: online SQLite backup created; tested image is healthy on port 4318. All persisted table checksums matched before/after the update, and the existing vault mount remains read-only. No personal document files were changed or categorised speculatively during deployment. Category endpoint remains authenticated.


## Application packs — 29 October 2026

`npm run check`: production build, 146 Node tests and 24 Python launcher/helper tests passed. Fictional API regressions cover grouped approval/submission, pinned hashes/ZIP bytes, submitted-file protection, linked route/receipt/event, idempotence, export/restart persistence, copying, source scoping, cover requirements, stale edits and changed-file rejection without partial mutations. Isolated Docker/browser verification created, reviewed and approved a fictional CV/text/answer pack, recorded a fictional external submission and verified its Submitted state, route/reference and ZIP action. No personal application was created or submitted during verification.

Application-pack deployment: online SQLite backup created before installing the tested image. All persisted table checksums matched before/after and the vault remains mounted read-only. Live health and pack authentication verified. No personal packs were created or documents approved/submitted during deployment.


## Feedback — 29 October 2026

`npm run check`: production build, 149 Node tests and 24 Python launcher/helper tests passed. Fictional tests verify authentication, duplicate-request replay/conflicts, safe page validation, persistent status/revision conflicts, JSON/full-backup inclusion, restart interruption without retry, feedback-only AI context, advisory output and cancelled/invalid-review preservation.

Isolated Docker/browser verification confirmed the button on Dashboard, Opportunities, Kanban, To-do, Career Library, Career Buddy, Settings and sign-in. The native modal opens/closes correctly; sign-in is required to submit. Saved fictional feedback appeared in the inbox without AI, then a simulated provider supplied priority/improvements/questions. No real AI account, career evidence or user feedback was used.

Feedback deployment: tested image installed after an online SQLite backup with AI/indexing/reviews idle. All existing table checksums matched before/after; the vault remains read-only. Live health/authentication checks passed. No personal feedback or real AI requests were created during verification.


## Communications and interviews — 29 October 2026

`npm run check` passes: production TypeScript/Vite build, 152 Node tests and 24 Python launcher tests. New API checks use fictional records and temporary storage to verify custom types/channels/direction, follow-up validation, authentication, stale-revision conflicts, no partial write after validation failure, attachment ownership/duplicate checks, unlinking without deleting originals, complete rescheduling snapshots, unavailable attachment handling, export and restart persistence. Dashboard tests cover rescheduled interviews and date-sorted follow-ups, completion/cancellation/outcome exclusion and the action-visibility toggle.

An isolated Docker browser preview verified a saved incoming LinkedIn communication with contact/notes, existing document selection and a new file upload through the activity form, dated follow-up visibility in the to-do list, a custom final interview type, explicit rescheduling, expandable original date/contact/attachment history, the combined notes summary and continued dashboard interview visibility. Browser testing caught and corrected a file-selection event-lifetime issue; the corrected picker queued and saved the fictional file. Native date-change events were used because the browser automation fill operation alone did not notify React for date controls. No personal records or documents were used and no AI calls or external messages were sent.

Deployment: the tested Docker image was installed after an online SQLite backup with AI/indexing/reviews idle. All persisted table checksums matched before/after deployment; the vault mount remains read-only and the launcher watcher was refreshed. Live health and unauthenticated-access checks passed. Fictional browser-preview containers were removed after verification.


## Opportunity workflow — 29 October 2026

`npm run check` passes: production TypeScript/Vite build, 155 Node tests and 24 launcher tests. Fictional API checks cover application-route creation/editing, manual review validation/required reason, optional stage movement, closed-opportunity protection, stage/event dates and snapshots, authentication, revision conflicts and failed writes without persistence. Offer checks cover independent outcomes/hire metrics, repeatable offers, strict dates/statuses, ownership of linked documents, unlinking without file deletion, idempotent create/reused-key conflicts, decisions/history, exports, full-backup snapshots and restart persistence. Queue tests exclude accepted/declined/undated offers, closed opportunities and hidden derived actions.

An isolated Docker/browser workspace verified a strengths/gaps/proceed review saved without movement, explicit advance to CV & cover letter, retained review history, offer terms/contact and document selection, automatic dates and editable response/start dates, a pending offer deadline in the to-do list, recorded acceptance with the earlier pending version retained, current review/offer and timeline content in Summary, removal of the responded deadline and an unchanged Hired count of zero. Only fictional records/files were used; no external communications, real offer decisions or AI requests were made.

Deployment: the tested opportunity-workflow image was installed after an online SQLite backup while AI/indexing/reviews were idle. All persisted table checksums matched before/after; the vault stayed read-only and the launcher watcher was refreshed. Live health and workflow authentication checks passed. The fictional browser preview was removed after verification.


## Finding opportunities — 29 October 2026

`npm run check` passes: production TypeScript/Vite build, 160 Node tests and 24 launcher tests. Five focused filter tests cover default active/all/completed/specific outcomes, intersections with stage/search, stable record order and no mutation, case/whitespace-normalised all/any tags and deduplicated counts, valid deadlines and inclusive/open ranges, reversed/invalid range errors, seven/thirty-day boundaries and workspace midnight across a daylight-saving boundary. Overdue tests cover overview next actions, unfinished follow-ups, pending offers and linked open tasks, with deduplication, legacy missing fields and closed/completed/cancelled/unlinked exclusions.

An isolated Docker browser workspace with six fictional opportunities verified combined filters, all/any tags, search, result counts, persistence between list and Kanban, shared no-match feedback, reset, completed outcomes, removable chips, and a reversed custom range with an explanatory alert. The overdue filter showed all four distinct actionable opportunities, including the activity, offer and task sources. Desktop layout was visually reviewed; responsive rules were inspected, but a mobile browser/device was not exercised. No private records or files were used, and no AI requests or record changes were caused by filtering.

Deployment: the tested finding-opportunities image was installed after an online SQLite backup with AI/indexing/reviews idle. All persisted table checksums matched before/after deployment; the vault stayed read-only and the launcher watcher was refreshed. Live health/authentication checks passed. Fictional preview containers were removed after verification.


## Reliability and recovery — 29 October 2026

`npm run check` passes: production TypeScript/Vite build, 167 Node tests and 39 Python launcher/recovery tests. Fictional persistent-queue checks cover retained bytes/options, workspace scoping, stable retry IDs, frozen attempted options, atomic quota failures, failed-file ordering and cross-tab leases. Scheduler checks cover default-off, daily/weekly revision conflicts, deferred maintenance, overdue catch-up and failure backoff. Host tests exercise submitted-byte preservation, copy/missing-root relink/restore, changed-preview rejection, read-only destinations before write probes, symlink backup escapes, unavailable mounts, pre-upgrade verification refusal, failed-build image recovery and restart/crash rollback.

Actual isolated Docker services verified full migration, relinking and restore activation across container recreation with real SQLite/documents/mount remapping. A separate empty installation received a transferred full backup, replaced its empty workspace, recovered restored credentials and retained exact submitted CV bytes. These checks used fictional data only, including an account deliberately reset by restore; no real AI/provider account was called.

Browser verification on those fictional services confirmed that a selected file and its notes survived reload, resumed upload and remained cleared after completion/reload. Settings saved a weekly schedule and ran a verified backup. The migration preview displayed the document count/bytes, disabled Apply until confirmation and completed a real restart. The clean restored installation showed its opportunity, Career Library document and unchanged submitted v1 CV through the browser. A themed preview is retained at `/private/tmp/opportunity-knox-reliability-preview.png`. No production restore/migration or read-only vault write was performed. Before deployment, all 1,761 live managed document locations/hashes passed a read-only preflight.

Deployment: the normal product launcher created and verified a full pre-upgrade backup containing all 1,761 managed documents before rebuilding/restarting. Re-reading every backed-up document confirmed its saved hash; all live persisted-table checksums matched both the pre-upgrade workspace and backup database. The read-only vault mount was preserved, the refreshed host helper was available, and live health/protected-endpoint checks passed. A browser check of deployed Settings confirmed the new controls and that automatic scheduling remains disabled until selected. The two fictional test services and all verification-only browser tabs were removed. No production restore/migration, scheduling preference change or AI request was performed.


## Career Buddy response optimisations — 29 October 2026

`npm run check` passes: production TypeScript/Vite build, 179 Node tests and 39 Python launcher/helper tests. New framing tests cover OpenAI/Claude/Gemini/custom SSE and Ollama NDJSON, byte-by-byte fragmented UTF-8/CRLF, omitted thinking, partial nested reply decoding, terminal/truncation/error checks, response limits, abort of stalled streams and JSON-only compatibility. Explicit stream rejection produces opt-out guidance without an automatic second request. Registry/API checks prove previews are authenticated, visible before completion, memory-only and cleared on cancellation/failure/completion; complete replies alone create saved messages, retries are idempotent and timings persist across restart. Codex tests distinguish an acknowledgement from a cancellation marker and verify owned-process termination plus execution timing. The full run also exposed a pre-existing cross-batch timestamp-order defect; monotonic queue ordering and a frozen-clock regression test fix it.

An isolated Docker service used a local HTTP Ollama simulator (no real model/account) to verify streaming over the actual HTTP transport. Browser checks confirmed a standalone live preview before saving, cancellation removing that preview with a preserved user message, explicit subsequent completion in history, reported model-load/prompt/generation timings and restored request details after container restart/page reload. The opportunity chat also displayed a live preview and removed it on cancellation without recording a message/proposal/change. The screenshot `/private/tmp/opportunity-knox-buddy-live-preview.png` shows the fictional standalone preview. Reported simulator timings validate handling/display, not real model performance. No production records/evidence were sent to AI, no real inference or external messages were issued, and no vault originals were changed. Codex live text output and remote-provider compute/billing cancellation acknowledgement remain unimplemented.

Deployment: the normal launcher created a verified full pre-upgrade backup with all 1,761 managed documents, then rebuilt/restarted the board and refreshed the host Codex helper. All persisted table contents matched the pre-upgrade workspace and backup database, so provider/model/limits, records and prior chat history were preserved. The vault remained read-only, live health passed and recovery endpoints retained authentication. The fictional HTTP simulator/container and its verification-only browser tab were removed. No real AI call was made during deployment or verification.


## Smarter job intake — 29 October 2026

`npm run check` passes: production TypeScript/Vite build, 189 Node tests and 39 Python launcher/helper tests. Focused checks cover grounded quotes/values, invalid/missing-year dates, duplicate/unknown/invented fields, page passage limits, native/OCR selection, immutable inputs, partial managed-file rollback, authentication, source-only/failed-AI fallback without retries, preserved manually reviewed values, tampered source refusal, idempotent creation/conflicts, request cancellation, retry after temporary storage refusal, backup inclusion and restart persistence. Public PDF download/byte-retention options preserve the existing private-address rejection and standard lookup behaviour.

Actual Docker Poppler/Tesseract execution read a fictional mixed two-page PDF: page 1 required English OCR and page 2 retained native text; original bytes were unchanged. The generated scanned fixture was visually inspected for legibility. An isolated browser workspace with a simulated AI provider showed passage/page/OCR citations, missing/uncertain fields, reviewed field application and a manually typed employer preserved through save. Its three original/text/report documents were visible in Documents. The review expired during an extended pause and correctly refused saving; explicitly refreshing the source allowed completion. A separate API check compared original PDF bytes, confirmed both OCR/native page evidence and the saved/manual-vs-suggested report, then verified all three artifacts through a full backup and isolated restore. Screenshot: `/private/tmp/opportunity-knox-intake-documents.png`. No personal source was used or sent to AI; no real inference, external messages or vault writes occurred. Model extraction quality and OCR accuracy beyond these fictional fixtures remain for user evaluation.

Deployment: the product launcher verified a full pre-upgrade backup containing all 1,761 existing managed documents, then rebuilt/restarted the board. All persisted table contents matched the pre-upgrade workspace and backup database, preserving provider settings, records and history. The vault remained read-only and health/authentication checks passed. A live browser check confirmed Smarter job intake in Add opportunity without submitting a source or calling AI. The fictional Docker/browser service was removed; the live opportunities page was left ready. No real source was imported and no model account was exercised during deployment.


## AI workflow controls
Production build and full checks passed with fictional data. API regression verifies authentication, default compatibility, stale-setting conflicts, boolean validation, persisted disabled switches after restart, denied stage-specific actions before provider calls and continued local source reading without AI. Existing automation and drafting suites remain passing. Provider settings, credentials and existing data are not changed by default policy reads. Live deployment verification is recorded below.

Deployment: 190 Node and 39 Python tests passed. Normal launcher verified a full backup of 1,761 documents; all persisted tables matched before/after and the vault stayed read-only. Live Settings displayed all five workflow controls without changing preferences or running AI. Screenshot: /private/tmp/opportunity-knox-ai-workflow.png.

## Saved opportunity briefings — 29 October 2026

Production build and 193 Node HTTP/unit tests plus 39 launcher tests passed. Fictional-data tests cover source-ID validation, linked task/document/event fingerprints, source scoping, generation revisions, stale-source conflicts, cancellation, previous-output preservation, JSON export and restart persistence. Browser testing against the production Docker image with a simulated provider confirmed generation, supporting-note expansion, dated metadata, the unchanged chronological summary, and the outdated marker after a saved edit. No real model call or private career evidence was used for this check. Model wording quality still needs user evaluation.

Deployment through the normal launcher completed with a verified pre-upgrade full backup of 1,761 documents. All database table contents matched before/after and the backup; the vault remained read-only, host helper healthy and protected endpoints authenticated. No production briefing was generated during verification.

## Historical JSON opportunity import — 30 October 2026

Production build and 200 Node HTTP/unit tests plus 39 launcher tests passed. Fictional import tests cover authenticated preview; no native record/task/file changes before confirmation; exact dated timeline/correction and activity revision retention; cleared foreign attachment links; selected-field/history/stage merges; preserved existing approved application packs and submitted bytes; record/JD-manifest hash, URL, reference and employer-role duplicate signals; within-file matches; all-or-none writes under an injected SQLite failure; failed-backup protection; replacement/expiration/conflict/replay safeguards; restart-persistent previews/receipts; full-backup archive persistence and record-export inclusion; invalid schema/URL/date/history and later-stage missing-date rejection; ignored foreign settings/AI credentials. Browser verification against the production Docker image used a fictional JSON upload, one selective merge, one separate creation, confirmation, automatic backup and completed receipt. No personal records were imported and no AI endpoint was called.

Deployment via the normal launcher completed with a verified full pre-upgrade backup of 1,761 documents. All database table contents matched before/after and the backup; the vault stayed read-only and the host helper remained healthy. The live service serves the historical-import build and rejects unauthenticated import-list/preview requests. No production records were imported during verification.

## AI request activity and usage — 30 October 2026

Production build and 210 Node HTTP/unit tests plus 39 launcher tests passed. Fictional checks cover all five HTTP providers' buffered/streamed usage formats, cumulative/split cache accounting, numeric validation, partial/error reports, system fingerprints without raw prompt/output/key retention, terminal-state safety and separate archived retry attempts, saved pricing/currency/revision semantics, authenticated filtering/pagination/exports, active cancellation without late publication, feedback/local-reader registration, and restart/full-backup persistence.

Browser verification used the production Docker image with fictional career evidence and a simulated custom provider. It confirmed sidebar navigation, request totals and USD/GBP estimate coverage, filters, cancellation of a held request, original-opportunity Buddy review navigation without replay, rate editing without changing old estimates, restart persistence, and restoration of a failed standalone message without sending it. No live AI request or private career evidence was used. The universal runnable scheduler and actual Codex token reporting remain outside this increment.

Deployment through the normal launcher completed with a verified full backup of 1,761 documents. All persisted tables matched before/after and the backup, the vault remained read-only and the host helper stayed healthy. The live service serves the activity build and rejects unauthenticated activity/rate reads. No production AI task was started and no production rates were changed during verification.

## External embedding capability checks and model discovery — 30 October 2026

`npm run check` passes: production TypeScript/Vite build, 213 Node tests and 39 launcher/helper tests. Fictional-provider unit and API tests cover OpenAI/Ollama/custom embedding model discovery (`POST /api/buddy/embedding-models`), filtering out chat, speech, image and reranker models, embedding model suggestions, custom model fallback when IDs do not contain `embed`, secret redaction from model IDs/labels/errors, and capability testing (`POST /api/buddy/embedding-test`) against `/embeddings` and `/api/embed` with fictional text, vector dimension/normalization reporting, invalid/NaN/zero-norm rejection, same-endpoint stored-key retention, cleared keys on provider/URL change, and unchanged saved settings/vector index when testing unsaved drafts. Live Docker container rebuild and browser verification have not been rerun in this step.

## External embedding indexing and optional vector backends — 30 October 2026

`npm run check` passes: production TypeScript/Vite build, 217 Node tests and 39 launcher/helper tests (256 total). Fictional-provider unit, vector index and server integration tests cover:
- Embedding settings and capability testing with optional external vector store backends (`qdrant` and `custom` HTTP vector stores alongside built-in `sqlite`), private network validation, URL/collection sanitization, and secret-safe API key storage excluded from browser state, settings and `/api/export`.
- Explicit library and read-only source indexing with external embedding providers (`openai`, `ollama`, `custom`) and dynamic vector dimensions (8–16384), automatic L2 unit normalization, source freshness checks, and chunk hash verification.
- Optional external vector store integration with Qdrant and custom HTTP backends: collection auto-creation/dimension checks, raw text exclusion (storing only hashes and IDs in the external vector store), client-side boundary and selection-scoped retrieval filtering, chunk hash tamper rejection, and remote point deletion/cleanup on source clear.
- Full hybrid retrieval and candidate source selection in Career Buddy (`/api/buddy/workspace` and `/api/opportunities/{id}/buddy`) combining external vector search scores with keyword ranking.
- Live Docker container rebuild and browser verification have not been rerun in this step.

## Universal persisted AI task scheduler — 31 October 2026

`npm run check` passes: production TypeScript/Vite build, 220 Node tests and 39 launcher/helper tests (259 total). Fictional-provider unit, scheduler and server integration tests cover:
- Persistent SQLite table `ai_tasks(id TEXT PRIMARY KEY, data TEXT NOT NULL)` storing background tasks with lifecycle statuses (`queued`, `running`, `cancelling`, `completed`, `completed-with-errors`, `failed`, `cancelled`, `interrupted`).
- Non-auto-restart rule: on startup, all incomplete tasks (`queued`, `running`, `cancelling`) transition strictly to `interrupted`, with no silent work replay.
- Unified task management endpoints: `GET /api/ai-tasks`, `GET /api/ai-tasks/:id`, `POST /api/ai-tasks/:id/cancel` (cooperative AbortController abortion), and `POST /api/ai-tasks/:id/retry` (runner dispatch with backoff/retry count increments).
- Full integration with background workers: vector embedding indexing batches (`server/vector-index.mjs`) and opportunity automation workflows (`server/opportunity-automation.mjs`).
- Complete data safety: `ai_tasks` snapshot inclusion in `/api/backup`, table copy into portable/isolated restores, and secret-safe sanitization (`apiKey`, `vectorApiKey`, `secret` stripped) in `/api/export`.
- User interface: "Scheduled & background tasks" pane in AI Activity view (`src/components/AIActivity.tsx`), displaying task kind, subject, badges, phase/progress, enqueued/started/finished timestamps, error diagnostics, and Cancel/Retry controls with 5-second polling.
- Live Docker container rebuild and browser verification have not been rerun in this step.
