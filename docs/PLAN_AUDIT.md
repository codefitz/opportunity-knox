# Unchecked plan audit

Reviewed 29 October 2026 against repository code, tests and dated verification notes. Subsequent application-pack, communications/interviews and opportunity-workflow and finding-opportunities delivery is reflected in items 4–11; reliability delivery updates items 14, 19, 20, 26, 29, 30 and 34. The original audit reconciled documentation; subsequent delivery has dated validation in VERIFICATION.md. Career Buddy response optimisations update item 3; reviewed job intake updates items 22, 31 and 32. All 39 unchecked markers from the pre-audit plan are accounted for below. Several markers combine multiple features or repeat earlier scope; their count is not a count of unique outstanding tasks.

## Corrections that matter

- Configured-root folder browsing and multiple independent read-only roots are implemented.
- Host/vault in-place selection is implemented; Google imports are snapshots, so live cloud-document references remain open.
- Saved criteria, structured criterion results/questions/recommendations and persistent AI request/review state exist. Manual decision fields are implemented; named reference profiles, a universal scheduler and usage accounting remain open.
- Built-in/marked templates and PDF/page-preview exports exist. Arbitrary template fidelity and source-system pagination equivalence remain open.
- Settings can inspect/create isolated restores and now preview/confirm activation, replace the live workspace and reconcile managed storage with rollback. Historical record merging remains open.
- Daily/weekly backup scheduling and the launcher’s verified pre-upgrade hook are now product features, separate from agent-performed deployment snapshots.
- Google access used through Codex to obtain a private CV is separate from signing the board’s own OAuth app into Google. The latter remains deferred.

## Item-by-item disposition

The numbers identify the 39 original unchecked markers in their original order, before compound items were split.

| # | Original unchecked scope | Confirmed disposition |
| --- | --- | --- |
| 1 | External embedding capability tests/model discovery | Remains open; chat model discovery is not embedding capability discovery. |
| 2 | External embedding indexing/custom vector database | Remains open; current persistent vectors use bundled MiniLM and SQLite. |
| 3 | Token streaming/cold-load timing/provider cancellation acknowledgement | Split: HTTP streaming/live previews, persisted timings (including provider-reported Ollama loading) and local Codex termination acknowledgement implemented. Codex live tokens and remote-compute cancellation acknowledgement remain open. |
| 4 | Stage/tag/deadline/overdue toolbar filters | Implemented and tested in shared list/Kanban controls: combinable search/outcome/stage/tags, deadline presets/inclusive custom ranges, overdue linked actions, removable selections, result counts and reset. |
| 5 | Identification application-route field | Implemented on creation/Overview, exports and Summary; existing submission packs keep their own recorded route. |
| 6 | Structured strengths/gaps/questions/recommendation/criteria/user reason | Implemented: existing AI criteria/results/recommendations plus independent strengths/gaps and dated user decision/reason/history. Stage movement is explicit. |
| 7 | Arbitrary template fidelity/cover-letter-not-required toggle | Split: cover-letter exemption now implemented in packs; arbitrary template fidelity remains open. |
| 8 | Supporting answers/formal application-pack approval | Now implemented: supporting text/answers, pinned versions and formal grouped pack approval. |
| 9 | Submission receipt/route/linked submitted pack | Now implemented: pack submission dates/route/receipt, linked event and preserved versions. |
| 10 | Activity attachments/follow-up/direction/channel/custom types/rescheduled status | Implemented and tested: scoped document-version links/uploads, follow-up dates/completion and action queue, communication direction/custom channels, custom interview types, rescheduled status and expandable revision snapshots. See COMMUNICATIONS.md and dated verification. |
| 11 | Offer and acceptance/decline separate from hire | Implemented with repeatable offers, terms/dates/contact/documents, decisions/history, pending response action queue and unchanged hire metrics until a separate outcome action. |
| 12 | Cached dated AI summaries with staleness | Implemented: saved Summary-tab briefings with generation metadata, source references, freshness fingerprints and explicit refresh; chronological summary retained. |
| 13 | Record JSON import/merge | Implemented in Settings: preview, source/URL/reference/employer-role/content duplicate suggestions and explicit create/skip/selective merge, preserving existing history and files. |
| 14 | Settings record import/restore UI/per-stage AI controls | Split: inspection, isolated restore and confirmed activation/replacement now implemented; JSON import/merge remains open; per-stage switches are implemented. |
| 15 | Existing in-place server/cloud documents | Split: configured host/vault selections implemented; Google snapshot connector implemented; live cloud-document references remain open. |
| 16 | Multiple independent reference locations | Marked complete for configured read-only roots. |
| 17 | Server-side folder browser | Marked complete within configured roots; unrestricted host browsing is not supplied. |
| 18 | Employer/role-labelled folder naming and stage subfolders | Remains open as an optional storage-layout enhancement. Existing stable-ID folders work. |
| 19 | Missing/offline handling/relinking/storage migration | Implemented: existing offline protections plus hash-checked relinking/migration with preview, confirmation, retained originals, stale-plan checks and rollback. |
| 20 | Previewed historical import/content and opportunity duplicate matching | Implemented for historical JSON records: reviewed duplicate candidates, selective merge/history/stage choices, automatic full backup, conflict/replay protection, atomic writes and preserved source archive. Document bytes and native packs/offers/reviews are not activated. |
| 21 | Independent AI toggles for stages 1–3 | Implemented in AI workflow settings, with separate automatic fit/tag controls and server checks. |
| 22 | Stage 1 AI field extraction/passages/snapshots/OCR | Implemented in New opportunity: optional grounded AI extraction from links/text/files, passage/page evidence, missing/uncertain values, immutable source/text/review artifacts and bounded local PDF OCR. Human selection/save remains explicit. |
| 23 | Arbitrary unmarked template/cross-engine fidelity | Remains open; repeats the fidelity portion of item 7. |
| 24 | Background scheduler/prompt versions/usage/cost/lifecycle | Split: persisted request/review/Codex state, unified request activity, per-attempt history, prompt versions/system hashes, reported token usage and saved-rate estimates implemented. Universal runnable scheduler and embedding-job coverage remain open. |
| 25 | External-assistant task-pack export/result import | Remains open. Codex provider transport is not task-pack exchange. |
| 26 | Scheduled/pre-upgrade backups/portable restore | Implemented for full-workspace replacement: opt-in scheduling, verified launcher pre-upgrade backups, portable activation/reconciliation and rollback. Historical JSON record merging is separately implemented with review and backup. |
| 27 | Remote HTTPS/VPN deployment | Remains open; bind settings and local password authentication do not establish a remotely deployed service. |
| 28 | AI task table/reference profiles/templates/criteria | Split: lifecycle tables, criteria, template layouts and request usage/cost/prompt-version records exist; named reference profiles and universal scheduled-job records remain open. |
| 29 | Existing-workflow integration parent phase | Implemented for the defined JSON historical import scope alongside verified portable restore and read-only source workflows. |
| 30 | Historical import/in-place attachment/deduplication/restore verification | Implemented: in-place sources, isolated/portable restore, and reviewed JSON historical matching. File bytes and complete-workspace state use full restore. |
| 31 | AI integration parent phase | Remains unchecked for task-pack exchange; per-stage controls are implemented; reviewed JD extraction/OCR/snapshots are now implemented and verified. |
| 32 | Stage 1/per-stage controls/templates/PDF/task packs | Split: reviewed Stage 1 intake/OCR and built-in/marked layouts/PDF implemented; per-stage controls are implemented; arbitrary template fidelity and task packs remain open. |
| 33 | Optional extensions parent phase | Split: dashboard, local vectors/hybrid retrieval, folder/vault sources, standalone Buddy and Google connector implemented; calendar/email, further reporting/backends and live Google authorization remain open. |
| 34 | Clean-installation guided restore acceptance | Verified on a separate empty Docker installation using a transferred fictional backup, restored login/records/documents and exact submitted bytes. Production remote hosting remains separate. |
| 35 | Production host/access-method decision | Remains open for remote deployment. The local installation and launcher already operate. |
| 36 | Storage source/copy/cloud choices | Split: architecture and source options implemented; further user-specific locations/migrations and live cloud editing remain choices. |
| 37 | Initial templates/approval/layout requirements | Split: built-ins chosen and implemented, private CV reference added; bespoke final layout approval/fidelity work remains open. |
| 38 | Board-owned live Google authorization verification | Remains deferred/open; simulated OAuth tests and separate Codex-assisted exports do not satisfy it. |
| 39 | P2 native cloud editing/unmarked reconstruction/pagination | Remains open; repeats items 15/23 and the documented P2 limitations. |

## Evidence checked

- Folder/source scopes: [directory-sources.mjs](../server/directory-sources.mjs), [obsidian-vault.mjs](../server/obsidian-vault.mjs), [launcher.py](../scripts/launcher.py), [DocumentConnections.tsx](../src/components/DocumentConnections.tsx).
- Backup/restore scope: [backup-inspect.mjs](../server/backup-inspect.mjs), [backup-restore.mjs](../server/backup-restore.mjs), [restore-isolated.mjs](../scripts/restore-isolated.mjs), Settings in [App.tsx](../src/App.tsx), [restore.test.mjs](../tests/restore.test.mjs) and isolated-restore API tests in [server.test.mjs](../tests/server.test.mjs).
- Criteria/request state: [decision-review.mjs](../server/decision-review.mjs), [buddy-requests.mjs](../server/buddy-requests.mjs), [opportunity-automation.mjs](../server/opportunity-automation.mjs), [codex_buddy.py](../scripts/codex_buddy.py).
- Templates/categories: [document-layout.mjs](../server/document-layout.mjs), [document-studio.mjs](../server/document-studio.mjs), [document-categories.mjs](../server/document-categories.mjs), [DOCUMENT_STUDIO.md](DOCUMENT_STUDIO.md).
- Google snapshot/live-authorization distinction: [google-documents.mjs](../server/google-documents.mjs), [DOCUMENT_CONNECTIONS.md](DOCUMENT_CONNECTIONS.md).
- Existing data model/API/UI and tests: [types.ts](../src/types.ts), [app.mjs](../server/app.mjs), [App.tsx](../src/App.tsx), [server.test.mjs](../tests/server.test.mjs).
- Historical build/test/browser/runtime evidence: [VERIFICATION.md](VERIFICATION.md). Older milestones describe their scope at the time; newer sections supersede their “still pending” notes.

No full test suite was rerun for this Markdown-only audit. Validation checks cover patch integrity, checkbox-item accounting and local documentation links. No deployment is required.
