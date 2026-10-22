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
