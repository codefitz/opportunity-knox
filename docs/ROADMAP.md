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
