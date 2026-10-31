# Plan completion audit

**Reconciled 30 October 2026.** This document accounts for the **39 original unchecked markers**, not 39 independent tasks. Current disposition: **21 complete, 10 partial, 6 open, 1 pending host choice and 1 deferred Google authorization check**. Completed scope is checked and struck through; mixed rows retain an explicit remaining reference.

Use [PLAN.md — Remaining work](PLAN.md#remaining-work) and [ROADMAP.md](ROADMAP.md) for the **13 deduplicated remaining work areas** and four choice/validation groups. R12 (optional chat-to-library copying) and R13 (JavaScript-only intake) were previously embedded future-work notes; they are now visible enhancements, not newly discovered regressions.

## Corrections made in this reconciliation

- [x] ~~Historical JSON import/merge is complete; original audit item 14 now includes it alongside restore and AI switches.~~
- [x] ~~Saved stale-aware opportunity briefings and source references are complete (item 12).~~
- [x] ~~Request activity, prompt-version/system-hash tracking, reported usage and saved-rate estimates are complete (items 24/28).~~ The universal scheduler remains R3.
- [x] ~~Portable clean-install activation, confirmed live replacement and managed-document reconciliation are complete (items 26/29/30/34).~~ Production remote hosting remains R10/V1.
- [x] ~~Configured-root browsing, read-only sources, manual decisions, document layouts/PDFs, packs, communications and offers are complete in their documented scopes.~~
- Live Google authorization (V2), real-provider/model quality and other manual acceptance checks (V4) are not inferred from implementation or fictional tests. Arbitrary cross-engine layout fidelity remains R7.

## Original-marker disposition

| # | Status | Original unchecked scope | Completed scope / remaining reference |
| --- | --- | --- | --- |
| 1 | Complete | ~~External embedding capability tests/model discovery~~ | [x] ~~Embedding-specific model discovery and fictional-text capability/dimension checks (`POST /api/buddy/embedding-models`, `POST /api/buddy/embedding-test`).~~ |
| 2 | Complete | ~~External embedding indexing/custom vector database~~ | [x] ~~External provider indexing (OpenAI, Ollama, custom) and optional external vector backends (Qdrant, custom HTTP) with local SQLite chunk/hash validation, selection scoping, and secret-safe settings.~~ |
| 3 | Will Not Do | Token streaming/cold-load timing/provider cancellation acknowledgement | [x] ~~HTTP live previews/timings and owned Codex process-termination acknowledgement.~~ **Will Not Do:** R5 deprioritised by user decision. |
| 4 | Complete | ~~Stage/tag/deadline/overdue toolbar filters~~ | [x] ~~Shared list/Kanban filters, counts, removable selections and validation.~~ |
| 5 | Complete | ~~Identification application-route field~~ | [x] ~~Editable application route in creation/Overview/export/Summary; submitted packs retain their recorded route.~~ |
| 6 | Complete | ~~Structured strengths/gaps/questions/recommendation/criteria/user reason~~ | [x] ~~Structured criteria/results plus manual strengths/gaps and dated proceed/ignore/defer decisions/history.~~ |
| 7 | Partial | Arbitrary template fidelity/cover-letter-not-required toggle | [x] ~~Cover-letter exemption and built-in/marked document layouts.~~ **Remaining:** R7. |
| 8 | Complete | ~~Supporting answers/formal application-pack approval~~ | [x] ~~Supporting answers/statements, pinned versions, formal pack approval and cover-letter exemption.~~ |
| 9 | Complete | ~~Submission receipt/route/linked submitted pack~~ | [x] ~~Recorded submission route/receipt/dates, linked event and preserved exact document versions.~~ |
| 10 | Complete | ~~Activity attachments/follow-up/direction/channel/custom types/rescheduled status~~ | [x] ~~Scoped attachments, dated follow-ups, directions/channels, custom/rescheduled interviews and revision snapshots.~~ |
| 11 | Complete | ~~Offer and acceptance/decline separate from hire~~ | [x] ~~Repeatable offers/terms/dates/documents and acceptance/decline history, separate from hire outcome.~~ |
| 12 | Complete | ~~Cached dated AI summaries with staleness~~ | [x] ~~Saved dated briefings, source references, freshness checks and explicit refresh.~~ |
| 13 | Complete | ~~Record JSON import/merge~~ | [x] ~~Reviewed historical JSON create/skip/selective merge UI, duplicate suggestions and retained source reports.~~ |
| 14 | Complete | ~~Settings record import/restore UI/per-stage AI controls~~ | [x] ~~Settings inspection/isolated restore/live activation, historical JSON import/merge and independent AI-stage switches.~~ |
| 15 | Partial | Existing in-place server/cloud documents | [x] ~~Configured read-only host/vault sources and Google snapshot connector.~~ **Remaining:** R6/V2. |
| 16 | Complete | ~~Multiple independent reference locations~~ | [x] ~~Multiple independently configured read-only source roots.~~ |
| 17 | Complete | ~~Server-side folder browser~~ | [x] ~~Paged browsing within configured roots; unrestricted host browsing was not supplied.~~ |
| 18 | Open | Employer/role-labelled folder naming and stage subfolders | [ ] **Remaining:** R9. Repeated scope refers to the same canonical work area. |
| 19 | Complete | ~~Missing/offline handling/relinking/storage migration~~ | [x] ~~Offline protections, previewed hash-checked relinking/migration, retained originals, backup and rollback.~~ |
| 20 | Complete | ~~Previewed historical import/content and opportunity duplicate matching~~ | [x] ~~Historical JSON preview/deduplication, explicit selected merges, full backup, conflict/replay checks and atomic writes.~~ |
| 21 | Complete | ~~Independent AI toggles for stages 1–3~~ | [x] ~~Independent stage 1–3 switches and automatic fit/tag policy checks.~~ |
| 22 | Complete | ~~Stage 1 AI field extraction/passages/snapshots/OCR~~ | [x] ~~Reviewed grounded JD extraction, passage/page quotes, original/text/report snapshots and bounded local PDF OCR.~~ |
| 23 | Open | Arbitrary unmarked template/cross-engine fidelity | [ ] **Remaining:** R7. Repeated scope refers to the same canonical work area. |
| 24 | Complete | ~~Background scheduler/prompt versions/usage/cost/lifecycle~~ | [x] ~~Universal persisted AI scheduler (`ai_tasks`), background task queue/retry/cancel/interrupted-on-restart, unified activity, per-attempt history, prompt versions/hashes, reported tokens and saved-rate estimates.~~ |
| 25 | Complete | ~~External-assistant task-pack export/result import~~ | [x] ~~Export ZIP/JSON task packs with opportunity context, evidence excerpts, instructions, and schema; validate, conflict-check, preview, apply mutations and save Word drafts with task records in `ai_tasks`.~~ |
| 26 | Complete | ~~Scheduled/pre-upgrade backups/portable restore~~ | [x] ~~Opt-in scheduled and verified pre-upgrade backups, portable activation/reconciliation and rollback.~~ |
| 27 | Open | Remote HTTPS/VPN deployment | [ ] **Remaining:** R10/V1. Repeated scope refers to the same canonical work area. |
| 28 | Complete | ~~AI task table/reference profiles/templates/criteria~~ | [x] ~~Universal `ai_tasks` SQLite table and scheduler, lifecycle records, saved criteria/templates and request usage/cost/prompt-version records.~~ (R11 named profile extension deprioritised as Will Not Do). |
| 29 | Complete | ~~Existing-workflow integration parent phase~~ | [x] ~~Defined existing-workflow phase, including historical JSON import and portable restore.~~ |
| 30 | Complete | ~~Historical import/in-place attachment/deduplication/restore verification~~ | [x] ~~Read-only in-place sources, isolated/portable restore checks and reviewed historical JSON matching.~~ |
| 31 | Partial | AI integration parent phase | [x] ~~Provider/retrieval/chat/drafting, controls, intake, assessments, request activity and external task packs.~~ **Remaining:** R7. |
| 32 | Partial | Stage 1/per-stage controls/templates/PDF/task packs | [x] ~~Reviewed intake/OCR, stage controls, built-in/marked layouts, PDF export and external task packs.~~ **Remaining:** R7. |
| 33 | Partial | Optional extensions parent phase | [x] ~~Dashboard, local vectors/hybrid retrieval, read-only sources, standalone Buddy/history, Google snapshot connector, activity reporting, external embedding discovery/capability checks, and external embedding indexing/vector backends.~~ **Remaining:** R6/R8 and V2/V3. |
| 34 | Complete | ~~Clean-installation guided restore acceptance~~ | [x] ~~Fictional clean-install Docker restore with login, records, files and exact submitted-byte verification.~~ |
| 35 | Choice | Production host/access-method decision | **Pending user choice:** R10/V1. Local hosting is complete. |
| 36 | Partial | Storage source/copy/cloud choices | [x] ~~Managed/read-only source architecture, configuration and verified migration/relinking.~~ **Remaining:** R6/V3. |
| 37 | Partial | Initial templates/approval/layout requirements | [x] ~~Built-in and marked templates, private CV reference, page previews and Word/PDF outputs.~~ **Remaining:** R7/V3. |
| 38 | Deferred validation | Board-owned live Google authorization verification | **Pending:** V2. User-owned board OAuth authorization remains deferred; simulated tests/separate Codex access do not complete it. |
| 39 | Open | P2 native cloud editing/unmarked reconstruction/pagination | [ ] **Remaining:** R6/R7/V2. Repeated scope refers to the same canonical work area. |

## Scope boundaries that stay visible

- Historical import activates JSON opportunity details/timeline/comms; foreign files, tasks and native offers/reviews/packs stay in source archives. Full workspace/file recovery uses full backup restore.
- AI activity covers registered requests, not every runnable/embedding job. Codex live text/token accounting remains R5; no per-request subscription charge is invented.
- Google setup/search/snapshot code is complete; live references/editing (R6) and user OAuth verification (V2) are not.
- Built-in/marked layouts and previews are complete; arbitrary templates/cross-engine equivalence (R7) and bespoke approval (V3) are not.
- Local browser/API multi-client capability is complete; actual remote-host selection and secured deployment (R10/V1) are not.

## Evidence checked

- Folder/source scopes: [directory-sources.mjs](../server/directory-sources.mjs), [obsidian-vault.mjs](../server/obsidian-vault.mjs), [launcher.py](../scripts/launcher.py), [DocumentConnections.tsx](../src/components/DocumentConnections.tsx).
- Backup/restore scope: [backup-inspect.mjs](../server/backup-inspect.mjs), [backup-restore.mjs](../server/backup-restore.mjs), [restore-isolated.mjs](../scripts/restore-isolated.mjs), Settings in [App.tsx](../src/App.tsx), [restore.test.mjs](../tests/restore.test.mjs) and isolated-restore API tests in [server.test.mjs](../tests/server.test.mjs).
- Criteria/request state: [decision-review.mjs](../server/decision-review.mjs), [buddy-requests.mjs](../server/buddy-requests.mjs), [opportunity-automation.mjs](../server/opportunity-automation.mjs), [codex_buddy.py](../scripts/codex_buddy.py).
- Templates/categories: [document-layout.mjs](../server/document-layout.mjs), [document-studio.mjs](../server/document-studio.mjs), [document-categories.mjs](../server/document-categories.mjs), [DOCUMENT_STUDIO.md](DOCUMENT_STUDIO.md).
- Google snapshot/live-authorization distinction: [google-documents.mjs](../server/google-documents.mjs), [DOCUMENT_CONNECTIONS.md](DOCUMENT_CONNECTIONS.md).
- Existing data model/API/UI and tests: [types.ts](../src/types.ts), [app.mjs](../server/app.mjs), [App.tsx](../src/App.tsx), [server.test.mjs](../tests/server.test.mjs).
- Historical build/test/browser/runtime evidence: [VERIFICATION.md](VERIFICATION.md). Older milestones describe their scope at the time; newer sections supersede their “still pending” notes.

- Saved briefings: [opportunity-summary.mjs](../server/opportunity-summary.mjs), [OpportunityBriefing.tsx](../src/components/OpportunityBriefing.tsx).
- Historical imports: [record-imports.mjs](../server/record-imports.mjs), [RecordImports.tsx](../src/components/RecordImports.tsx), [HISTORICAL_IMPORTS.md](HISTORICAL_IMPORTS.md).
- Activity/usage: [ai-activity.mjs](../server/ai-activity.mjs), [ai-usage.mjs](../server/ai-usage.mjs), [AIActivity.tsx](../src/components/AIActivity.tsx), [ai-usage.test.mjs](../tests/ai-usage.test.mjs), [AI_ACTIVITY.md](AI_ACTIVITY.md).
- Embedding discovery and capability checks: [buddy-provider.mjs](../server/buddy-provider.mjs), [career-buddy.mjs](../server/career-buddy.mjs), [EmbeddingSettings.tsx](../src/components/EmbeddingSettings.tsx), [buddy.test.mjs](../tests/buddy.test.mjs), [server.test.mjs](../tests/server.test.mjs).

## Validation of this documentation edit

No application code, runtime settings or personal data changed. No deployment or full test-suite rerun is needed for this Markdown-only reconciliation. Checked the 39 original IDs and disposition counts, consistency of the 13 current backlog IDs across plan/roadmap, completed-item strike-through coverage, local Markdown links and patch whitespace. Latest recorded implementation evidence remains 210 Node + 39 launcher/helper tests, fictional Docker/browser checks and the verified 1,761-document pre-upgrade backup; see VERIFICATION.md.
