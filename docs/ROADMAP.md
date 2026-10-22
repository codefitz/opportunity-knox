# Implementation roadmap

Started 22 October 2026. See `PLAN.md` for the agreed product plan. This is a first working increment; production hosting remains to be configured.

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

- Previewed import of chosen existing career/application folders, duplicate detection, and existing-file linking.
- Native Google Drive/Docs connectors and cloud-document editing/export.
- Server-side folder browsing, multiple independent reference roots, communications direction/channel refinements, and explicit review decisions beyond stage/outcome/notes.
- AI adapter/task protocol and provider selection, then JD extraction, fit review, CV/cover generation and rendered document checks.
- OCR/PDF text extraction, JavaScript-rendered job pages, and complete original-page snapshots. The extracted job description and source provenance can be saved by link lookup; storing the full original HTML/PDF snapshot remains future work.
- Submission-pack approval and enforced snapshot workflow across all selected document versions.
- Portable backup/restore and export/import with document reconciliation across hosts.
- Authenticated remote hosting, chosen hostname/VPN, HTTPS, and deployment-specific verification.
- Calendar/email integration and reminders.

No AI provider is connected in this increment. External application submission and email sending are not implemented.
