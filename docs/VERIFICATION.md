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
