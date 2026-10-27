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
