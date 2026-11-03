# Document Studio — action plan

Requested 3 November 2026. Status: planned; this document does not mark implementation complete.

## Outcome

Add **Document Studio** to the main sidebar beside Career Hub and Career Buddy. Give the user one place to organise CVs and cover letters, maintain templates, generate documents with AI, preview every page, and download Word or PDF files.

Keep Career Hub focused on career evidence and the profile. Document Studio owns document creation and organisation, using the same underlying library and records. Opportunity Documents continues to show application-specific files and can open the Studio with the opportunity, master CV and template already selected. Avoid duplicate document stores or competing generators.

## Clean interface

- **Top bar:** search, **Upload**, **Create**. Upload offers CV template, master CV, cover-letter template or other document; Create offers CV, cover letter or template.
- **Document list:** compact rows with name, type, source and last edited date. Simple filters: All, Master CVs, Templates, Generated. Optional folders and a small overflow menu keep secondary actions out of the main view.
- **Preview:** selecting a document opens its rendered pages with a simple page navigator. Show only relevant actions: Download, Generate from template, Edit with AI. Version history and connection details stay under secondary controls.
- **AI chat:** open on demand beside the preview. Display the selected document and factual source as small, replaceable chips. Suggested actions help users start without exposing prompt configuration.
- **Mobile:** list first; selecting a document opens its preview, with chat as a separate view. Preserve selection and unfinished work when switching.
- **Connections:** a compact status/control opens Obsidian and Google Drive settings. Show setup instructions only when needed.

Primary generation flow: **choose master CV → choose template → optionally select opportunity or paste role brief → generate → preview → download**. Remember sensible defaults, including a preferred master CV and templates, but make their names visible and easy to change.

## Document behaviour

### Upload and organise

- Upload/select a master CV, upload a CV template, and upload a cover-letter template. Allow an existing document to be assigned one of these roles without uploading it again.
- Start with DOCX and PDF inputs plus existing readable career sources. Explain when a scanned PDF needs OCR or a PDF layout must be reconstructed.
- Provide folders, search, rename, move, duplicate, document-type assignment and delete with recovery or existing deletion safeguards. Support a small set of bulk actions: move, assign type and delete.
- Reuse stable IDs, versions, managed storage, backup and opportunity links. Moving or renaming must not break application attachments or submitted snapshots.
- Organisation of externally linked documents is local to OppKnox unless the user explicitly chooses an export/update operation. Mark unavailable external originals clearly.

### Templates and AI chat

Treat **template editing** and **document generation** as distinct actions:

- **Generate:** template supplies presentation; selected master CV and verified career evidence supply facts. Replace text in a copy and make only light fitting adjustments. Example name lengths and sample job counts are guidance, never hard limits. Repeat existing formatted paragraphs or job blocks where needed. Preserve material history and qualifications.
- **Edit template:** chat can deliberately change the design, spacing, typography or sections because the user requested a template change. Save a new template version; show the revised pages before the user chooses it as the default.
- **Create template:** start from a built-in layout, a short description, or an uploaded CV/cover letter. Derive a reusable CV or cover-letter template with neutral placeholders rather than retaining the upload's private facts as sample text.
- **Create or revise cover letter:** use the selected master CV/evidence and optional role brief. Support an uploaded existing letter as the starting document, and a separate letter template for presentation.
- Chat examples: “Create a CV template from this document”, “Make the section spacing slightly tighter”, “Turn this into a cover-letter template”, “Draft a letter for this opportunity”, “Shorten this paragraph without removing the achievement”.
- Show progress, cancellation and retry. If the AI cannot produce a document, show its actual explanation in the Studio. Preserve completed CV output if a companion letter fails.
- AI remains optional for uploading, organisation, previewing and conversion.

### Preview, fitting and download

- Use the existing Word package as the starting point for DOCX template generation; preserve tables, columns, styles, headers, footers, graphics and page settings.
- Complete the scoped document-authoring/render/review path in [AI_DOCUMENT_GENERATION_PLAN.md](AI_DOCUMENT_GENERATION_PLAN.md). Current text replacement is a foundation, not evidence of complete visual fitting.
- Render every output page and check for clipped text, broken tables, extra blank pages, orphan headings, leftover example claims and excessive shrinking. Prefer concise wording and modest spacing changes; never silently discard factual history to hit a page target.
- Save the exact reviewed artifact. Download, reopening and application attachment must use those bytes rather than rebuilding from Markdown.
- Offer **Word (.docx)** and **PDF** downloads, including both files when useful. “Doc” is assumed to mean modern Word DOCX; legacy `.doc` is not in the first delivery.
- DOCX → PDF uses the existing renderer. PDF → editable DOCX requires reconstruction and a checked preview; disclose differences. Preserve an uploaded PDF when downloading its original format.

### Obsidian and Google Drive

- **Obsidian:** reuse the existing connected-vault import/export paths and source selection. Add Studio entry points, manual Sync, last-sync status and changed-file summaries. Respect read-only vaults. Export generated documents/templates only to the configured writable location.
- **Google Drive:** reuse the existing account connection and native Google Docs import/export-to-local capability. Add selected-file refresh and version comparison first, then extend discovery/import to supported Drive DOCX/PDF files.
- Add explicit save-back/export to a chosen Drive folder as a later part of the sync phase. It requires a write-capable connection and user consent; the existing read-only connection cannot write to Drive.
- First delivery uses **Sync now** for selected files. Later offer opt-in scheduled refresh of those selections, using the existing task scheduler. Do not scan or synchronise the entire account by default.
- Track external ID, version and last synced local revision. If both sides changed, offer keep local, import as a new version, or export a separate copy; never silently overwrite either side. Disconnected accounts leave local documents usable. Removing a local reference must not delete the external original.

## Delivery sequence

| Phase | Work | Completion check |
| --- | --- | --- |
| 1 — Studio and library | Sidebar route; document list and preview; typed upload; select/default master CV and templates; basic organisation. Reuse Career Hub storage and existing previews. | Upload all three document roles, find and preview them, rename/move/duplicate without breaking an opportunity link, and reopen the Studio with selection/defaults preserved. |
| 2 — Reliable generation and export | One shared CV/cover-letter generation service for Studio and opportunities; template-preserving editing; bounded rendering and visual correction; exact-artifact saving; DOCX/PDF download and conversion. | A fictional sidebar CV retains its layout and complete history, a letter uses its own template, and preview/download/attachment match the saved output. Longer names and additional jobs succeed. |
| 3 — AI document workspace | Contextual chat for generation, uploaded-document revision, template creation and explicit design tweaks; version comparison and restore; progress/cancel/retry. | Create a template from an upload, tweak it in chat, generate a CV and letter, and restore an earlier version without altering the source file. |
| 4 — Connected documents | Studio controls for existing Obsidian paths; selected Google refresh and supported Drive-file import; conflict handling; explicit outbound Drive export after connection permissions are implemented. | Import, refresh and export supported documents; changed-on-both-sides conflicts require a choice; read-only/disconnected states remain usable and clear. |
| 5 — Finish and verify | Responsive and keyboard checks, useful empty/error states, conversion limits, cleanup, persistence and upgrade checks. Update documentation and launcher-managed runtime. | Automated checks pass, rendered pages are inspected, a real-provider flow is completed, and the updated running app is separately verified. |

Ship each phase as a usable increment. Phase 2 is the quality gate for reliable generated files; do not call the full Studio complete while chat editing or connected sync remains planned.

## Implementation starting points

- `src/App.tsx`: sidebar routing, Career Hub document controls and existing Obsidian UI.
- `src/components/TailorApplication.tsx`: reuse generation selection and opportunity context; route both entry points through the same service.
- `src/components/BuddyWorkspace.tsx`: reuse chat interaction patterns and source selection.
- `server/document-studio.mjs`: preview/conversion and exact-file saving primitives.
- `server/cv-template.mjs`, `server/document-layout.mjs`, `server/career-buddy.mjs`: template population and existing drafting; remove duplicated generation paths as the shared service takes over.
- `server/codex-local.mjs`, `scripts/codex_buddy.py`: scoped artifact jobs, rendering and result validation described in the R7 plan.
- `server/obsidian-vault.mjs`, `server/google-documents.mjs`, existing managed-folder/document endpoints: connections and organisation.

Prefer existing components, storage and task tracking. Extract shared code only where Studio and opportunity generation actually need the same behaviour. No separate file-manager framework or second AI orchestration system is required.

## Verification and boundaries

Use fictional career data and templates for tests. Verify complete history, separate factual and visual sources, template example removal, multiline expansion, table/sidebar preservation, header/footer details, safe links, stale references, duplicate saves, cancelled/failed jobs and retained partial success. Check organisation persistence, submitted snapshot integrity and connected-source conflicts.

Run `npm run check` for implementation. Record separately: automated results, all-page rendered inspection, real-model generation, actual Obsidian/Google account flows, browser/mobile checks and running-app deployment. A simulated provider or Google response does not establish live quality or account permission.

This plan extends R7 and brings the relevant R6 connected-document work into active scope. Existing Google OAuth verification remains a live-account prerequisite; the user-facing setup should remain inside the app. No implementation or deployment is performed by writing this plan.
