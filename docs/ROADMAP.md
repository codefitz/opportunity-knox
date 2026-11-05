# Implementation roadmap

## Extended Mixed-Contrast Themes — 5 November 2026

- Added four new mixed-contrast themes to the Theme picker in Settings:
  - **Alpine Mint:** Deep evergreen navigation (`#12221b`) with a crisp, daylight mint workspace (`#f2f7f4`).
  - **Sandstone & Slate:** Mineral slate navigation (`#1c2024`) beside a warm, sunlit sandstone workspace (`#f7f3ee`).
  - **Nordic Frost:** Midnight fjord blue-black navigation (`#0e1722`) with a bright glacial arctic workspace (`#f0f4f8`).
  - **Solar Dark:** Obsidian night workspace (`#15171c`) paired with warm parchment/ivory navigation (`#f9f5ec`).
- Implemented full CSS token sets with WCAG AA compliance across text, backgrounds, and stages in `src/themes.css`.
- Registered types in `src/types.ts`, server validation in `server/app.mjs`, and interactive theme preview cards in `src/components/ProfileSettings.tsx`.
- Verified persistence across server restarts and custom color tint overrides in `tests/server.test.mjs`.

## Structured Fit Assessment Criteria — 4 November 2026

- Introduced structured candidate fit criteria (`targetTitles`, `minSalary`, `salaryCurrency`, `salaryPeriod`, `targetSeniorities`, `targetSkills`, `workModes`) to define explicit parameters for opportunity evaluation alongside freeform criterion rules.
- **Backend & Persistence:**
  - Extended `server/decision-review.mjs` (`validateCriteria`) to normalize and validate structured criteria alongside `items[]`.
  - Added default fallback initialization in `GET /api/buddy/fit-criteria`.
  - Enhanced automated fit assessment context (`structuredCriteria`) and injected prompt guidance into `body.generalFit` review calls so LLMs explicitly evaluate candidate alignment with role titles, seniority expectations, salary thresholds, and core skills.
- **Frontend & Workflow Integration:**
  - Added interactive Structured Criteria builder to `FitCriteria` in `src/components/DecisionReview.tsx`.
  - Added 1-click "Sync from Alignment" action pulling target titles, skills, and currency from user Alignment settings.
  - Added 1-click "Generate Criteria" button translating structured parameters into evaluable Required / Preferred criterion cards.
  - Added responsive chip controls for seniority levels (`entry` through `executive`) and work arrangements (`remote`, `hybrid`, `onsite`), plus tag input for job titles and skills.
- **Verification:**
  - Unit and integration tests added in `tests/decision-review.test.mjs` verifying validation, persistence, and HTTP endpoints.
  - Full project check (`npm run check`) passing.

## Fit assessment & alignment contrast fix — 4 November 2026

- Replaced hardcoded HEX and transparent RGB colors across alignment match pills (`.card-alignment-pill`), seniority badges, target profile alignment overview cards, matched skill tags, exclusion badges, and streak badges with theme-aware design tokens (`var(--green)`, `var(--blue)`, `var(--amber)`, `var(--danger)`, `var(--accent-soft)`, `var(--panel-soft)`, `var(--line)`).
- Fixed low-contrast text and bright white card fallbacks on dark themes (`midnight`, `graphite`, `plum`, `moonlight`), ensuring all text, tags, and status notices adhere to WCAG AA contrast standards across both light and dark themes.
- Verified build and test suite passing (`npm run check`).


## Automated Actions & Application Targets (Theme 3) — 4 November 2026

Delivered milestone stage auto-advancement, intelligent automated next actions, linked To-Do task generation with two-way completion sync, and daily application targets with streak tracking:
- **Phase 1: Workflow Automation Settings & Core Engine:**
  - Extended SQLite settings schema and `PATCH /api/settings` with `autoAdvanceStages`, `autoGenerateTasks`, `defaultFollowUpDays`, and `dailyTarget`.
  - Implemented core progression rules (`STAGE_ORDER`, `canAutoAdvance`, `computeNextActionForStage`, `calculateDailyProgress` in `server/workflow-automation.mjs` and `src/lib/workflow-automation.ts`).
  - Added "Workflow Automation & Targets" configuration card in Settings (`AlignmentSettings.tsx`) with controls for milestone advancement, task generation, follow-up days, and daily application targets.
- **Phase 2: Milestone Stage Auto-Advancement & Safeguards:**
  - Auto-advances opportunities forward upon key milestone events:
    - Automated Fit Assessment: saves review and auto-advances to `review` stage.
    - Document Studio: tailoring a CV or cover letter auto-advances opportunity to `documents` stage.
    - Application Packs: pack submission advances opportunity to `submitted` stage with atomic document verification.
    - Activities: scheduling an interview auto-advances opportunity to `interviews` (or `final-interview` when marked final).
  - Preserves full audit trail: logs `"Auto-advanced: [Reason]"` events with effective timestamps. Never moves opportunities backward or modifies closed/outcome opportunities.
- **Phase 3: Automated Next Actions & Linked To-Do Tasks:**
  - Auto-populates context-appropriate `nextAction` and `nextActionDate` upon opportunity creation and stage transitions (e.g. 7-day follow-up after submission; interview prep upon scheduling).
  - Automatically creates linked To-Do tasks with due dates in the To-Do list when `autoGenerateTasks` is enabled.
  - Implemented two-way completion sync: completing a linked task via `PATCH /api/tasks/:id` automatically clears/satisfies the opportunity's corresponding next action.
- **Phase 4: Daily Application Target & Streak Tracking Widget:**
  - Added `DailyTargetCard` widget to the Dashboard (`src/components/Dashboard.tsx`) with responsive styling (`src/dashboard.css`).
  - Displays daily application submission progress bar and percentage, dynamic encouragement subtext, and active streak counter pill (`🔥 N-day streak`).
  - Features quick inline daily target selector (1–10/day) updating settings via `PATCH /api/settings`.
- **Phase 5: Verification & End-to-End Safety:**
  - Unit tests: `tests/workflow-automation.test.mjs` (3/3 passed).
  - Integration tests: `tests/theme3-integration.test.mjs` (3/3 passed).
  - Full check suite: clean build (`tsc --noEmit && vite build`), all Node integration tests, and launcher test suite verified.

## Automated fit review saving — 4 November 2026

- The automated Fit Assessment button saves strengths, gaps and the review date, and moves active opportunities to Fit review in the same database transaction as the assessment.
- Existing review history and stage dates are preserved; closed opportunities keep their outcome. The browser refreshes from the saved record.
- API persistence, stale-revision rejection, failed-response preservation, repeat-review history and closed-opportunity tests cover the behavior. Remote browser confirmation remains pending.

## Alignment, Seniority & Exclusion Filters (Theme 4) — 4 November 2026

Delivered comprehensive candidate targeting, dealbreaker exclusion keyword filtering, automatic seniority classification, and alignment scoring:
- **Phase 1: Exclusion Keywords Engine & Settings Management:**
  - Implemented boundary-safe keyword matching engine (`findExclusionMatches`, `checkOpportunityExclusions` in `server/exclusions.mjs` and `src/lib/exclusions.ts`) using whole-word boundary matching (`\b[term]\b`) with regex character escaping to prevent false positive substring collisions while safely handling technical terms (`.NET`, `C++`).
  - Extended SQLite settings schema and `PATCH /api/settings` with `exclusionKeywords` array.
  - Added red/amber exclusion warning badges on Opportunities table rows and Kanban cards.
  - Added exclusion alert banner in `OpportunityDetail` with one-click "Archive as ignored".
  - Added "Hide excluded" toggle filter and chip in `OpportunityFilters`.
- **Phase 2: Job Seniority Classification Engine & Filter:**
  - Implemented rule-based seniority classifier (`classifySeniority` in `server/seniority.mjs` and `src/lib/seniority.ts`) across 6 tiers: `entry`, `mid`, `senior`, `lead`, `director`, and `executive`.
  - Automatically classifies new opportunities during intake using role title patterns with fallback to job description context.
  - Added seniority badge on Kanban cards and table rows.
  - Added `seniority` to `AVAILABLE_COLUMNS` with custom sorting support in the Opportunities table.
  - Added Seniority dropdown filter (`All seniorities`, `Director`, `Lead`, `Senior`, `Mid`, `Entry`) in `OpportunityFilters`.
  - Added editable Seniority override field in Opportunity Overview.
- **Phase 3: Candidate Target Alignment & Skills Matching:**
  - Added `targetTitles` and `targetSkills` to Settings and candidate profile configuration.
  - Implemented composite alignment calculator (`calculateAlignment` in `server/alignment.mjs` and `src/lib/alignment.ts`) combining title similarity and skill keyword coverage into a 0–100% score and 4 tiers (`strong` ≥75%, `moderate` 50–74%, `reach` 25–49%, `mismatch` <25%).
  - Added alignment score badges on Kanban cards and table rows.
  - Added `alignment` to `AVAILABLE_COLUMNS` in the Opportunities table.
  - Added Alignment tier dropdown filter (`All alignment levels`, `Strong match`, `Moderate match`, `Reach / Partial`, `Low alignment`) in `OpportunityFilters`.
  - Added Target Profile Alignment overview card in `OpportunityDetail` displaying score tier and matched skills tags.
  - Added dedicated "Alignment & Filters" section in Settings (`AlignmentSettings.tsx`) with preset suggestions (`DV clearance`, `Inside IR35`, `WordPress`), tag chips, and instant add/remove controls.
- **Phase 4: Batch Action & Fast Archival for Excluded Roles:**
  - Added `POST /api/opportunities/archive-excluded` endpoint to batch-archive active opportunities matching exclusion keywords to `outcome: "ignored"` with dated stage events and provenance audit notes.
  - Added bulk action banner above the Opportunities view displaying the number of active excluded opportunities with one-click "Archive all excluded (N)" and "Show/Hide excluded" toggles.
- **Phase 5: Verification & Safety:**
  - Unit tests: `tests/exclusions.test.mjs` (3/3 passed), `tests/seniority.test.mjs` (4/4 passed), `tests/alignment.test.mjs` (3/3 passed), `tests/opportunity-filters.test.mjs` (6/6 passed), `tests/opportunity-columns.test.mjs` (7/7 passed).
  - API integration tests: `tests/theme4-integration.test.mjs` (2/2 passed) testing settings persistence, automatic classification, alignment scoring, and batch archival.
  - Full check suite: clean build (`tsc --noEmit && vite build`), all Node integration tests, and launcher test suite verified.

## Opportunity Organization & Views (Theme 2) — 4 November 2026

Delivered comprehensive opportunity organization, custom tabular views, duplicate detection with consolidation merge, and a target companies & roles wishlist:
- **Phase 1: Custom Columns & Sorting in Opportunities Table:**
  - Implemented `AVAILABLE_COLUMNS`, default visible columns, column persistence in `localStorage` (`knox_opportunity_columns`), and an interactive Columns picker dropdown in the Opportunities toolbar.
  - Added sortable `<th>` table headers with `ChevronUp`/`ChevronDown` indicators supporting column selection and directional sorting (asc/desc) across role, company, stage progression, priority, deadlines, and dates.
  - Supported customizable table columns for opportunity, company, stage, next action, deadline, priority, work mode, salary, location, date posted, applicant count, and application route.
- **Phase 2: Group by Company View:**
  - Added "Group by company" toggle button in the Opportunities toolbar with `localStorage` persistence (`knox_opportunity_group_by_company`).
  - Implemented collapsible company section rows with toggle state, company names, and opportunity counts.
- **Phase 3: Duplicate Detection & Intelligent Merge:**
  - Implemented robust multi-factor duplicate detection (`findDuplicateMap`, `findExistingDuplicate`, `areDuplicates`) across canonical URLs (normalizing tracking tokens) and normalized company + role titles.
  - Added visible duplicate badges on Kanban cards and Opportunities table rows.
  - Added duplicate alert banner in `OpportunityDetail` with one-click "Merge with duplicate" consolidation.
  - Implemented `POST /api/opportunities/:id/merge`: transfers stage events, history, activities, tasks, and documents; deduplicates tags; fills missing text fields; records audit event; and deletes duplicate record.
  - Added duplicate warning banner in `NewOpportunity` modal if an opportunity with the same role and company already exists, with an "Open existing" shortcut.
  - Added `DELETE /api/opportunities/:id` endpoint with safe document and task re-linking.
- **Phase 4: Target Companies & Roles Wishlist:**
  - Created `TargetCompany` data model and SQLite configuration storage (`server/target-companies.mjs`).
  - Added REST endpoints: `GET`, `POST`, `PATCH`, `DELETE` at `/api/target-companies`.
  - Added Opportunities subnav tabs to switch between "Active opportunities" and "Target wishlist" with live count badges.
  - Created `TargetWishlist.tsx` component with search, tier filters (Dream, Target, Safety), status tracking (Researching, Watching, Outreach initiated, Interviewing), target roles, careers links, notes, add/edit modal, and one-click "Create opportunity" conversion pre-filling company, role, and URL into the new opportunity form.
- **Phase 5: Verification & Safety:**
  - Unit tests: `tests/opportunity-columns.test.mjs`, `tests/duplicates.test.mjs`, `tests/target-companies.test.mjs`.
  - API integration tests: `tests/opportunity-merge-api.test.mjs` verifying target company CRUD, duplicate merge, and opportunity deletion.
  - Full suite: 323/323 Node tests passed, 45/45 launcher tests passed.
  - Production build: `npm run check` (`tsc --noEmit && vite build && npm test && npm run test:launcher`) passed cleanly with 0 errors.

## Smarter Job Intake & Parser Polish (Theme 1) — 3 November 2026

Delivered comprehensive job intake and parser extraction enhancements addressing user feedback across job boards, custom career CMS pages, and application ergonomics:
- **Phase 1: URL Cleaning & Auto-Fetch Engine:**
  - Implemented `cleanJobUrl` (`server/url-cleaner.mjs` and `src/lib/urls.ts`) to strip marketing tracking (`utm_*`), click/ad IDs (`gclid`, `fbclid`, `msclkid`, `dclid`), LinkedIn tracking (`trk`, `trackingId`, `refId`, `midToken`, `lici`), Indeed tokens (`tk`, `from`, `rjptk`, `xpse`, `xfps`, `xkcb`), Greenhouse referrer (`gh_src`), Lever/Workable query params, and tracking fragment hashes.
  - Strictly preserves essential job routing parameters (`jk`, `vjk`, `gh_jid`, `id`, `jobId`, `reqId`, `token`).
  - Integrated into `JobLookup` with automatic URL cleaning on paste and instant auto-fetching on paste when a valid HTTP/HTTPS link is supplied.
  - Integrated into backend fetchers and parsers (`fetchJobPage`, `parseJobPage`, and `safeURL`).
- **Phase 2: Add Opportunity Ergonomics & Direct Job Links:**
  - Reorganized the Add Opportunity modal layout: positioned primary "Add opportunity" button directly in the top action row alongside "Fetch", eliminating the need to scroll down to save imported listings.
  - Added a prominent AI Intake shortcut callout linking directly to the quote-backed Smarter AI Intake drawer.
  - Added dedicated "Open job link" action buttons across all touchpoints: inline within `JobLookup`, in `OpportunityDetail` modal header (`.detail-context`), Kanban cards (`.card-top-actions`), and the Opportunities table view.
- **Phase 3: Rich Parser Extraction Upgrades:**
  - **Work Mode:** Added multi-signal detection identifying `Remote`, `Hybrid`, and `On-site` across structured data (`jobLocationType`, `workplaceType`, `workMode`), topcard insight chips, job criteria subheaders, and job description summaries.
  - **Salary & Compensation:** Added regex pattern extraction and DOM selectors for LinkedIn topcard insights, Indeed attribute snippets, and currency period ranges (`£XXk-£YYk per annum`, `$XX,XXX - $YY,YYY a year`, `£XXX per day`), falling back to structured `estimatedSalary`.
  - **LinkedIn Easy Apply:** Detects Easy Apply badges and buttons, recording `applicationRoute: "LinkedIn Easy Apply"`.
  - **Date Posted & Applicants:** Extracts `datePosted` (ISO dates or relative age) and applicant counts (e.g. `Over 100 applicants`, `24 applicants`, `Be among the first 25 applicants`) from topcard captions and structured data, populating opportunity fields and lookup provenance notes.
  - **Structured Data Gap Filling:** When JSON-LD `JobPosting` data exists but omits salary, work mode, Easy Apply route, date posted, or applicants, visible page fallback elements seamlessly complement the missing fields without degrading structured parsing.
- **Phase 4: Headless Browser & Board-Specific Parser Fixes:**
  - Added `--virtual-time-budget=5000` to headless Chromium args in `renderJobPageWithBrowser` so client-side JavaScript, SPAs, and embeds have time to execute before capturing rendered DOM.
  - Supported Greenhouse embedded listings matching `gh_jid` parameters against embed token URLs.
  - Expanded CMS fallback selectors for corporate and agency careers templates (`.career-detail`, `.job-detail`, `.single-job-listing`, `.entry-content`, `[data-test="employer-name"]`, `.company__name`).
  - Upgraded HTTP fetch headers with standard modern browser `User-Agent` and `Accept-Language` headers to prevent bot-detection blocking on public listings.
- **Verification:**
  - Unit & parser tests: 308/308 tests passing (`node --test tests/*.test.mjs`), including 24 parser tests and headless browser flags.
  - Launcher test suite: 45/45 tests passing (`npm run test:launcher`).
  - Production build: `npm run build` passed cleanly (`tsc --noEmit && vite build`).


Completed Phase 5 of the Document Studio plan ([DOCUMENT_STUDIO_PLAN.md](DOCUMENT_STUDIO_PLAN.md)), delivering accessibility, responsive handling, empty/error state polish, persistence, safeguards, and verification:
- **Keyboard navigation:**
  - Added global `Escape` key handling to dismiss active modals (Google Drive conflict/search, version history, bulk category, move target, rename, upload, generate), close active overflow menus, and exit mobile preview.
  - Added `ArrowLeft` / `ArrowRight` (and `PageUp` / `PageDown`) page navigation shortcuts for multi-page previews when typing focus is not inside an input, textarea, select, or editable element.
  - Added keyboard selection on document list rows (`role="button"`, `tabIndex={0}`, `aria-pressed`, `aria-label`, and `Enter`/`Space` listeners with focus indicator styling).
  - Isolated action menu keyboard events from triggering row selection.
- **Empty & error state polish:**
  - Added onboarding empty state when the document library is empty (`docs.length === 0`), offering direct action buttons for *Upload Master CV*, *Upload Template*, and *Import from Drive* (when connected).
  - Differentiated whole-library empty state from active filter returning zero matching documents (with *Reset filters* CTA).
  - Added Studio Assistant empty thread greeting card with feature description and starter suggestion chips (*Tweak spacing*, *Create template*, *Draft cover letter*).
  - Added *Retry Preview* action alongside direct file download when document preview encounters an error or requires external conversion tools.
  - Added informative Google Drive search empty results messaging distinguishing between query-specific searches and general unsupported file lists.
- **Limits, validation, and safeguards:**
  - Added client-side pre-flight file size checks (> 20MB limit) and format validation before encoding or uploading.
  - Enforced server-side document file size limit (20MB) and streaming limits (30MB base64 JSON payload) returning HTTP 413.
  - Verified submitted application snapshot protections: documents with `status: "submitted"` cannot be deleted (HTTP 409) or renamed (HTTP 409), and are safely preserved during bulk library deletions.
- **Persistence & cleanup:**
  - Verified Document Studio defaults (`masterCvId`, `cvTemplateId`, `coverLetterTemplateId`) persist across server restarts on disk.
  - Preview folder lifecycle cleanup runs periodically and on server shutdown, with cache invalidation on document mutations.
- **Verification:**
  - Automated client build: `npm run build` passed (`tsc --noEmit && vite build`).
  - Unit & integration test suite: 287/287 tests passing (`node --test tests/*.test.mjs`), including dedicated Document Studio Phase 1–5 tests.
  - Launcher test suite: 43/43 tests passing (`python3 -m unittest discover -s tests -p 'test_*.py'`).
  - Per AGENTS.md, automated build and unit test success is distinguished from live browser and Docker container runtime verification.

## Document Studio Phase 4: Connected documents & button style polish — 3 November 2026

Implemented Phase 4 of the Document Studio plan ([DOCUMENT_STUDIO_PLAN.md](DOCUMENT_STUDIO_PLAN.md)) and polished UI controls across Document Studio:
- **Button & dialog styling polish:** Replaced ad-hoc/unstyled button classes (`btn-primary`, `btn-secondary`, `btn-ghost`, `btn-icon`) with the application's established design system (`.button.primary`, `.button.secondary`, `.button.secondary.small`, `.button.danger.small`, `.icon-button`, `.text-button`). Replaced unstyled custom modal tags with standard `.modal-overlay`, `.modal`, `.modal-heading`, and `.form-actions` across all modals (Generate, Upload, Rename, Move, Category, History, and Connected Sources).
- **Obsidian Vault integration:**
  - Added `GET /api/document-studio/connections` exposing real-time connection status for both Obsidian and Google Drive.
  - Added `POST /api/document-studio/obsidian/sync` triggering manual sync from the connected vault with imported/updated note counters.
  - Added `POST /api/document-studio/obsidian/export` enabling non-destructive document export to the configured writable vault location (`Generated/`), while respecting read-only vaults with explicit validation.
  - Added top-level Obsidian connection status badge, "Sync Obsidian" action, and contextual "Export to Obsidian" button in the document preview toolbar.
- **Google Drive integration & format support:**
  - Extended Drive discovery via `POST /api/document-studio/google/search` to search Google Docs (`.gdoc`), Word DOCX (`.docx`), and PDF files (`.pdf`).
  - Added `POST /api/document-studio/google/import` to snapshot external Drive files directly into the Studio library under chosen document categories (`master-cv`, `cv-template`, `cover-letter-template`, `reference`).
  - Added Drive Browse & Import modal with live search, format indicators, and role selection.
- **Conflict detection & non-destructive resolution:**
  - Added `POST /api/document-studio/google/refresh` comparing external revision/modified timestamps with local document state.
  - If external file is newer and local is unmodified, automatically refreshes the document and bumps version.
  - If both local and external files have changed, detects the conflict and presents 3 explicit choices:
    1. *Import as New Version* (`v{N+1}` preserving version lineage).
    2. *Save External Update as Separate Copy* (`[Name] (Google Drive Copy)`).
    3. *Keep Local Version* (acknowledges external update without altering local files).
  - Preserves local documents when Google Drive is disconnected.
- **Verification:** Added integration test in `tests/server.test.mjs` verifying connection reporting, Google Drive search/import/refresh, three-way conflict resolution, and Obsidian sync/export (both writable and read-only). Verified via `npm run build`, `npm test` (all 286 tests passing), and launcher tests (43/43 passing).

## Document Studio Phase 3: AI document workspace — 3 November 2026

Implemented Phase 3 of the Document Studio plan ([DOCUMENT_STUDIO_PLAN.md](DOCUMENT_STUDIO_PLAN.md)):
- **Template derivation engine:** Added `deriveTemplate` (`server/cv-template.mjs`) to convert existing DOCX CVs or cover letters into reusable templates. Strips hyperlink leak risks, identifies structural sections (Summary, Experience, Education, Skills), and replaces factual candidate details (names, contact lines, dates, companies, degree details, achievements) with neutral template placeholders (`[Candidate Full Name]`, `[Job Title] | [Company Name]`, `[Month Year – Present]`, etc.) while preserving 100% of OpenXML styles, tables, borders, and margins. Added `POST /api/document-studio/create-template`.
- **Contextual Studio Assistant chat:** Added `POST /api/document-studio/chat` with in-flight cancellation via `POST /api/document-studio/chat/cancel` (`AbortController`). Handles:
  - Template derivation requests ("Turn this into a template", "Derive cover letter template").
  - Contextual layout/spacing tweaks ("Make spacing tighter", "Compact layout", "Executive style", "Letter style").
  - Content revisions ("Shorten summary", "Strengthen tone") validating candidate facts without fabrication when AI is enabled, with clean offline fallback instructions when disabled.
- **Document version history & non-destructive restore:**
  - Added `GET /api/document-studio/documents/:id/history` tracking document lineage through `parentDocumentId` and base names.
  - Added `POST /api/document-studio/documents/:id/restore` allowing non-destructive restoration of previous revisions into new active versions without mutating or deleting original records.
- **Studio Assistant UI & version modal:**
  - Added toggleable Studio Assistant panel alongside the document preview with quick action chips (*"Turn into template"*, *"Tighter spacing"*, *"Executive layout"*, *"Shorten summary"*, *"Draft cover letter"*), streaming/cancellation indicator, and document draft action cards.
  - Added Version History modal displaying full lineage, active version badges, and one-click version restoration.
  - Contextual "Turn into Template" top action in document preview.
- **Verification:** Unit tests added in `tests/cv-template.test.mjs` and integration tests in `tests/server.test.mjs`.

## Document Studio Phase 2: Reliable generation and export — 3 November 2026

Implemented Phase 2 of the Document Studio plan ([DOCUMENT_STUDIO_PLAN.md](DOCUMENT_STUDIO_PLAN.md)):
- **Shared generation service:** Added `POST /api/document-studio/generate` serving both Document Studio and Opportunity workflows. Resolves source CV, candidate career evidence, target opportunity or role brief, and preferred or custom template.
- **Template-preserving layout mapping:** When slots exist and AI is configured, uses `populateCVTemplate`; when AI is disabled or an unslotted Word template is chosen, maps candidate facts via `layoutDraft` (`previous` reference mode or built-in layout presets: Classic, Compact, Executive, Letter). Preserves OpenXML tables, vertical cell merging (`<w:vMerge>`), and template formatting while replacing dummy/old employment content without XML corruption.
- **Exact-artifact saving & opportunity attachment:** Persists exact `.docx` bytes via `saveDocument`, links the generated document to the opportunity when specified, records generation metadata (`sourceCvId`, `templateId`, `opportunityId`, `layout`, `instructions`, `aiNotes`, `passToAi`), and immediately triggers multi-page preview generation.
- **Studio generation UI:** Added top-bar "Generate" button opening a generation modal with document role switcher (Tailored CV vs Cover Letter), source CV picker, template selector, target opportunity dropdown, and custom focus notes. Preview pane includes contextual "Generate with this template" and "Tailor from this CV" actions, and displays generation AI notes.
- **Verification:** Verified via `npm run check` with all 283 server tests and 43 launcher tests passing.

## Document Studio Phase 1: Studio workspace and library organisation — 3 November 2026

Implemented Phase 1 of the Document Studio plan ([DOCUMENT_STUDIO_PLAN.md](DOCUMENT_STUDIO_PLAN.md)):
- **Dedicated sidebar workspace:** Added Document Studio (`studio`) to the primary sidebar navigation beside Career Hub and Career Buddy.
- **Unified library organisation:** Studio uses the same underlying document storage and SQLite records as Career Hub without duplicate stores. Offers search, folder grouping, category filters (*All*, *Master CVs*, *Templates*, *Generated*), and multi-select bulk actions (Move, Assign Category, Delete).
- **Typed upload:** Top-bar upload modal supports explicit document roles on ingress: Master CV (`master-cv`), CV Template (`cv-template`), Cover Letter Template (`cover-letter-template`), and Other Reference (`reference`), with optional folder target.
- **Preferred defaults:** Added persisted configuration (`documentStudioDefaults`) for preferred Master CV, CV Template, and Cover Letter Template via `GET/PATCH /api/document-studio/defaults`, with header chips and one-click default assignment.
- **Document operations:** Added safe document renaming via `PATCH /api/documents/:id` (validating extensions and protecting submitted versions) and non-destructive duplication via `POST /api/documents/:id/duplicate` (allocating new versions/copies while preserving original links and attachments).
- **Multi-page preview:** Extended `/api/document-studio/preview` to support PDF, DOCX, and connected Google Doc shortcuts with page navigation (`Page X of Y`), direct original/PDF/Word downloads, and graceful fallback when headless LibreOffice is unavailable.
- **In-browser Markdown rendering:** Built a dedicated, secure Markdown viewer supporting frontmatter metadata, structured headings, task lists, tables, blockquotes, syntax code blocks, and a rendered/raw source view toggle. Directly fetches and renders `.md` and `.txt` files in the browser without headless converter overhead.
- **Filetype filter:** Added an explicit filetype filter (All, DOCX, PDF, Markdown, Text, Google Workspace) with document counts in the Studio browse bar, complemented by format badges on document rows.
- **Opportunity integration:** Added "Open Document Studio" action from opportunity Documents tabs.

Phase 3 (AI contextual chat) and Phase 4 (Connected documents) remain planned.

## Word CV template text replacement — 3 November 2026

AI-assisted tailoring with a selected Word template or Word-exported Google reference now supplies the template's paragraph text and example lengths to the model. Saving uses a separate structured text-replacement request and edits a copy of that Word package, retaining existing paragraphs, runs, tables, styles, headers/footers, graphics and page settings. All text slots must be returned exactly once; incomplete output fails without saving. Changed contact links are removed to avoid linking to a template author's address. Existing originals are untouched.

This is text population, not the full R7 visual document-authoring workflow. No font or spacing adjustments or rendered overflow correction are implemented here; content fit and factual completeness still need review with a real model and rendered pages. Example lengths and job counts are guidance, not limits: longer factual values and additional history can expand paragraphs within the existing section or table cell using its formatting. PDF references, AI-disabled copying and previously generated drafts retain their existing paths. A new draft is needed to use template text population.

## Structural CV template population and refined tailoring workflow — 3 November 2026

Resolved formatting/sidebar loss in AI-tailored CVs and refined the opportunity Documents tab creation workflow:
- **Automatic save on generation:** Clicking "Generate with AI" automatically creates the tailored CV/cover drafts and immediately saves the editable Word (.docx) files to Opportunity Documents without requiring a separate "Save" click. The manual "Save" action remains available for re-saving if edits are made in the collapsible draft review section.
- **Structural template preservation engine:** When tailoring against structured Word templates or previous CVs containing tables or sidebar columns (`<w:tbl>`, `<w:tc>`):
  - Parses candidate markdown into structured sections (Name, Role, Contact, Summary, Accomplishments, Skills, Experience, Education).
  - Replaces all header placeholder identity elements (e.g. multi-run names like `CHARLOTTE` + `EXECUTE`, subtitle/role lines, contact info, and narrative objectives) with verified candidate information.
  - Handles nested sidebar tables (e.g. Accomplishments and Competencies) by cloning paragraph styling and clearing all dummy items.
  - Handles multi-row table sections (e.g. Experience and Education) by detecting heading rows, cloning template row clusters (dates, company/institution, title/degree, duties/bullets), preserving vertical merge sidebar cells (`<w:vMerge/>`), and purging old template rows.
  - Handles sibling and in-cell paragraph sections across single-table and body layouts without leaving obsolete placeholders.
- **Compact document listbox:** Scaled down list font sizes (`0.83rem` title, `0.74rem` description, `0.65rem` badge) and compacted spacing (`0.38rem` vertical padding) to allow dense browsing of templates and previous CVs.
- **Clean titles without path clutter:** Cleaned up the document list display to show only clean titles and basenames, stripping folder paths both on the frontend and in `/api/document-studio/cv-styles`.
- **Conditional Google Docs shortcuts:** Filtered out `.gdoc` shortcuts from the listbox unless Google Drive is authenticated (`googleConnected`), preventing broken selections.
- **Streamlined action controls:** Removed the redundant "Pass to AI" checkbox (defaulting to enabled). Replaced the single "Tailor a fresh version" button with two distinct choices:
  - **Use this CV/Template (Download):** Directly downloads the selected preset or library template without AI invocation.
  - **Generate with AI:** Generates and auto-saves an ATS-aligned tailored draft preserving the selected template's structural layout.
- **Renamed save action:** Renamed "Save to Opportunity Documents" to "Save".
- **Collapsible pre-generation editor:** Tucked custom instructions and pre-generation tailoring adjustments away into an expandable `<details>` section placed before the action buttons, collapsed by default.
- Automated test suite passes (279 Node tests, 43 Python launcher tests); production build verified (`tsc --noEmit && vite build`). Running-container browser verification remains distinct.

## Listbox style selector and large preview pane on Opportunity Documents — 3 November 2026

Redesigned the CV creation and style selection experience in the Opportunity Documents tab (`TailorApplication.tsx`):
- **Single text list box with category filtering:** Replaced horizontal thumbnail strips with a clean listbox displaying all style options. Users can filter by **All**, **Templates** (built-in presets and library templates), or **Previous CVs**, with live text search across titles, descriptions, and formats.
- **Dedicated AI creation alternative:** Positioned "✨ Let AI choose / create" prominently at the top of the listbox, allowing users to opt for automatic ATS-optimized role matching at any time.
- **Large rendered thumbnail preview pane:** Added a prominent preview pane on the right that renders the single selected item:
  - For Word templates and previous CVs, renders a large first-page document thumbnail (via `/api/document-studio/thumbnails/:id`) showing page typography, headers, margins, and column layouts with high fidelity.
  - For built-in presets, renders high-resolution layout preview cards.
  - For AI generation, displays a structured layout strategy card highlighting role matching, ATS semantic headings, and evidence grounding.
- **Responsive & accessible:** Supports keyboard radio group navigation (`role="radiogroup"`, `role="radio"`, Enter/Space selection), sticky preview scrolling on desktop, and clean vertical stacking on mobile.
- Automated tests pass (277 Node tests, 43 Python launcher tests); production build verified (`tsc --noEmit && vite build`). Running-container browser verification remains distinct.

## Template selection in Opportunity Documents tab — 3 November 2026

Expanded the Opportunity Documents tab style picker to include library templates alongside built-in presets and previous CVs:
- **Library Templates strip:** Surfaces uploaded/saved templates from the Career Library (documents with category `template` or template markers), rendering lazy first-page thumbnails, search filtering, version badges, and radio selection.
- **Expanded built-in presets:** Added IT & Technical, Combination, and Career Change presets to the built-in layout options in Document Studio and tailoring.
- **Marked Word template (`{{content}}`) auto-detection:** When selecting a Word template containing a `{{content}}` placeholder, the tailoring draft engine routes to custom template insertion to preserve headers, borders, tables, and branding.
- **Server validation:** Enabled documents with category `template` as valid tailoring style references in `/api/opportunities/:id/buddy/chat`.
- Automated test suite passes (277 Node tests, 43 Python launcher tests); container browser verification remains distinct.

## Clean Career Buddy tab with top composer and bottom historic chats — 2 November 2026

The opportunity Career Buddy tab has been streamlined to eliminate embedded visual clutter and provide an intuitive conversational flow:
- **Composer & suggestions at the top:** Placed the immediate prompt suggestions ("Am I a good fit?", "What salary should I ask for?", "Which skills should I highlight?", "Tailor my CV", "Tailor a cover letter") and the 'Message Career Buddy' chat box right at the very top of the tab.
- **No auto-loading of old chats:** When opening an opportunity, past conversations do not take over the screen. The tab starts clean with the input box ready.
- **Selectable historic chats at the bottom:** All previous chats from past sessions are linked at the bottom as clean, selectable links showing titles, timestamps, and badges for proposed changes or drafts.
- **Dynamic window replacement:** Clicking an older chat opens that exchange below the composer with a "Close chat view" button. Sending a new prompt or clicking a suggestion resets the view and displays the new live response.
- **Discreet context configuration:** Compacted the source document selection and cross-opportunity toggle into an expandable details section below the composer, preventing document checklists from overwhelming the conversation.
- Automated test suite passes (277 Node tests, 43 Python launcher tests).

## Streamlined CV tailoring flow, AI toggle and gap analysis — 2 November 2026

The opportunity detail navigation and Documents tab tailoring interface have been reorganized into a clear, linear flow:
- **Restructured opportunity tabs:** Reordered tabs to match the hiring progression: **Overview > Fit Assessment > Documents > Interview & Comms > Timeline & Notes > Career Buddy** (with conditional access to Offers preserved when offers are recorded).
- **Merged Summary into Timeline & Notes:** Consolidated the chronological log and stage history. The Career Buddy briefing is now a discreet, expandable AI summary card within Timeline & Notes, accompanied by an instant plain-text chronological log download (`Download log (.txt)`).
- **Style selection & generation options first:** Users select a template or previous CV style reference, then configure generation options (`Pass generation to AI` showing the configured provider/model like Codex, and optional cover letter).
- **Logical action placement:** The `Tailor a fresh version` / `Tailor CV with AI` button is positioned directly under the style selection and options.
- **Clear AI Notes & JD Match:** The AI response prompt and UI now format a scannable breakdown highlighting **Matched Strengths** (`✓`), explicit **Missing from Experience (JD Gaps)** (`⚠`) comparing the candidate's verified evidence against the role requirements, and the **Tailoring Focus** (`🎯`).
- **Clarified Save Action:** Replaced confusing "Save reviewed drafts" button with a dedicated **Save as Word documents (.docx)** card explaining that editable Word files are saved to the opportunity documents and attached to the application pack, with direct `.docx` download buttons and confirmation upon saving.
- **De-cluttered interface:** Removed the superfluous "Review applications or use existing files" expander while preserving the "Add documents" upload section below. Stripped redundant explanatory prose throughout.
- Automated tests pass with 277 Node tests and 43 launcher tests; running-container browser verification remains distinct.

## Next priority: AI-created CV artifacts preserving structural layout — 2 November 2026

The user confirmed that the generation pipeline works but sidebar/structural formatting is lost in the final Word CV. Current style reuse reconstructs a linear document and does not establish full layout fidelity. R7 is now prioritized: pass actual reference files and rendered pages to a scoped Codex document-authoring job, render/check the generated files, and save its exact DOCX/PDF artifacts. See [AI_DOCUMENT_GENERATION_PLAN.md](AI_DOCUMENT_GENERATION_PLAN.md). This is planned work, not a delivered fix.

## Select PDF and Google CV style references — 2 November 2026

Previous PDF CVs are now selectable with the same radio controls as Word CVs. The bundled PDF tools extract first-page typography, colour, spacing and page settings into a formatting-only profile; saved drafts recreate those settings in editable Word files without copying the reference’s text. Complex graphics/sidebars are approximated, and image-only PDFs report that no readable style can be extracted. Connected Google Docs use a live Word export with a core-content/style snapshot check before saving. The source CV used for factual tailoring remains independent. Fictional automated coverage checks style transfer, source preservation and Google snapshot conflicts; a native Docker PDF→Word render was visually checked and the PDF selection/draft/save flow passed a disposable-browser test with a fixture model.

## Existing-file thumbnails and compact selection controls — 2 November 2026

Saved document rows now show lazy first-page thumbnails for Word/PDF and Google Workspace shortcuts when the board’s Google connection can export them. The previous-CV gallery includes PDF and Google Doc CVs as preview-only entries; native style reuse remains a Word operation. Thumbnails are private, bounded and cached; PDF/Word thumbnail rendering processes only the first page. Checkbox/radio controls use native 14px sizing, and text-field styling excludes those controls.

## Compact document workflow and previous CV styles — 2 November 2026

Tailoring and file uploads now start behind expanders. The old studio selector is replaced by separate horizontally scrollable template and previous Word CV thumbnail galleries, with filename filtering and bounded batches for larger libraries. Previous CV thumbnails render actual first pages under authenticated, bounded caching. New drafts can reuse previous CV typography, paragraph spacing and page settings while keeping factual source selection independent; old CV text, headers and sidebars are not copied. Revision/hash checks reject changed style sources. Existing originals and submission records are preserved; underlying preview/export APIs remain.

## Simple AI CV tailoring — 2 November 2026

The opportunity Documents tab now starts with Tailor a new CV, an optional cover-letter checkbox and rendered Classic/Compact/Executive template thumbnails (or Let AI choose). AI selects a readable source CV from a bounded shortlist, drafts against the full chosen CV plus retrieved evidence and shows the chosen source/layout. Editable text is reviewed before saving new Word drafts and automatically assembling their application. Previous draft groups restore on reopening; approval/submission and original-file preservation remain unchanged. Existing-file selection is an advanced, collapsed flow. Fictional server and browser checks cover source selection, layout override, optional cover drafting and saving; real-model document quality and final page layout require review.

## Host helper refresh on in-app restart — 2 November 2026

In-app restarts now close and reload the host Codex adapter after updating the board. Previously the long-running watcher retained its imported helper code, so rebuilding the container could leave Codex requests using an older command and no event diagnostics. Launcher regression coverage checks that both old and replacement helper lifecycles are handled.

## Incremental fit reviews and Codex diagnostics — 2 November 2026

Manual fit reviews request concise strengths/gaps and evidence references directly, using up to six automatically selected documents and 16,000 excerpt characters for the first pass. A model-requested focused search permits one additional pass (up to 12,000 extra characters) within the remaining request budget. Retrieval uses role requirements, removes duplicate excerpts and omits unrelated opportunity history. Fields remain editable before saving; invalid, cancelled or conflicting results are not applied. Codex uses JSON event diagnostics (activity count/time and bounded error categories), reported usage and low reasoning effort for fit reviews; prompt and reasoning text are not persisted in diagnostics. Live fictional helper smoke tests completed in 5.3 seconds with small context and 5.8 seconds with roughly 16,000 characters of evidence; these synthetic checks do not establish real-corpus or browser acceptance.

## Planned: chat-client MCP integration — 2 November 2026

[MCP_PLAN.md](MCP_PLAN.md) defines a small server exposing opportunity lookup, career evidence retrieval and revision-safe fit-review saving to a compatible chat client. This is a future implementation plan; no MCP server or client connection is delivered.

## One-click fit review — 2 November 2026

Run Automated Fit Assessment now appears at the top of the fit review and fills editable Strengths, Gaps and review date/time. It automatically selects relevant career evidence and assesses role requirements without requiring saved criteria or an evidence picker. Results remain reviewable before Save review; decisions and stage changes remain explicit. The enabled decision model falls back to the Career Buddy LLM. Existing saved assessments and optional background-review settings are preserved. Automated tests cover evidence selection, no-criteria operation, review fields and persistence; browser and real-provider acceptance remain separate.

## Manual fit assessment and optional decision reasons — 2 November 2026

The Fit assessment panel offers an explicit Assess fit with AI action using saved criteria and selected evidence. Manual and automatic assessments use the enabled decision model or fall back to the Career Buddy LLM. Manual assessment remains available with automatic fit disabled. Personal review decisions allow an empty reason while retaining dated history and explicit stage-change controls. Automated coverage checks model fallback, persistence, stale detection and reason-free decisions; live-provider and browser verification remain separate.

## Google Workspace (.gdoc, .gsheet, .gslides) support in Career Hub — 2 November 2026

Career Hub now supports Google Docs, Sheets, and Slides desktop shortcut and pointer files (`.gdoc`, `.gsheet`, `.gslides`) across uploads, read-only directory sources, Obsidian vault syncing, text preparation, semantic vector search, and standalone chat attachments. Uploaded or selected files automatically extract document IDs and URLs, infer document classification (e.g., CV or cover letter), and tag records with `Google Doc`, `Google Sheet`, or `Google Slides`. When Google Docs is connected via the app's OAuth configuration, text preparation exports and extracts live contents (DOCX for Docs, CSV for Sheets, PPTX for Slides); when offline, unconnected, or using public exports, Career Hub preserves pointer metadata, chunks, and direct Google Workspace links with open actions in the document list and Document Studio. Automated tests cover offline pointer parsing, live Google Drive export extraction, public export fallback, invalid file handling, and server upload/preparation workflows; live account consent remains separate.

## Document upload defaults — 2 November 2026

File and folder uploads start without a status. Type and category default to per-file inference from filenames and folder names, with manual overrides; unclear files use Other. Existing records retain their statuses, and approval/submission remain explicit later actions. Saved upload attempts retain their original options for safe retries. Automated coverage includes mixed imports, overrides, idempotent retries, restart persistence and approval/submission of documents imported without status; running-app/browser validation is separate.

**Current status — 30 October 2026.** Core workflow and the defined existing-workflow integration phase are complete. AI integration and optional extensions are partial; completed work is struck through below. [PLAN.md](PLAN.md#remaining-work) is the canonical backlog and [PLAN_AUDIT.md](PLAN_AUDIT.md) reconciles the original 39 markers.

## Delivered and verified within the documented scope

- [x] ~~Private local browser board, dashboard, Kanban/list, dated stages, notes, tasks, profile and themes.~~
- [x] ~~Career library uploads, categories/folders, large upload recovery, read-only directory/vault sources, local MiniLM vectors and hybrid retrieval.~~
- [x] ~~Career Buddy providers/Codex catalogue, chat attachments and history sidebar, automatic intent/evidence selection, reviewed updates, STAR stories and master/tailored document drafts.~~
- [x] ~~Criteria/fit assessments, automatic reviews/tags, communications/interviews, manual review decisions and offers.~~
- [x] ~~Built-in/marked templates, Document Studio previews/PDF export, application-pack review/approval/submission snapshots.~~
- [x] ~~Verified backup scheduling/upgrades, isolated and live/portable restore activation, storage migration/relinking and crash recovery.~~
- [x] ~~Smarter job intake with source passages/snapshots/OCR, independent AI workflow switches, and saved dated/stale-aware opportunity briefings.~~
- [x] ~~Historical JSON import with duplicate review, selective merges, pre-import backup, atomic writes and preserved source reports.~~
- [x] ~~AI activity with per-attempt history, prompt/model metadata, reported usage, optional saved-rate estimates, cancellation and workflow review/retry.~~
- [x] ~~Universal persisted AI task scheduler for background jobs (embeddings, opportunity automation, deferred work) with cooperative cancellation, interruption handling, and UI monitoring.~~
- [x] ~~External-assistant task-pack export (ZIP/JSON) and result import with schema validation, conflict preview, audit task recording, and Word draft generation.~~
- [x] ~~Private feedback form without visible history, backend export and opt-in AI-assisted GitHub issue drafts.~~

Latest implementation verification: **247 Node tests + 39 launcher/helper tests (286 total)**, production build and fictional-data tests; see [VERIFICATION.md](VERIFICATION.md) for which increments also include Docker/browser and live deployment checks.

## Remaining work

The same **13 work areas** appear in the plan. Optional/account-dependent items are labelled; completed imports, briefings and activity/usage work are not outstanding.

| ID | Remaining scope | Status / dependency | Completed boundary |
| --- | --- | --- | --- |
| R1 | [x] ~~External embedding capability checks and model discovery~~ | Complete | Separate from completed chat discovery and built-in MiniLM. |
| R2 | [x] ~~External embedding indexing and optional vector backends~~ | Complete | External provider indexing (OpenAI, Ollama, custom) and optional external vector backends (Qdrant, custom HTTP) with SQLite metadata and boundary validation. |
| R3 | [x] ~~Universal persisted AI task scheduler~~ | Complete | Runnable/deferred jobs, embedding-job and opportunity-automation coverage; unified persistent `ai_tasks` SQLite store, cooperative cancellation/retries, restart interruption, backup/export integration, and UI display in AI Activity. |
| R4 | [x] ~~External-assistant task-pack export/result import~~ | Complete | Export opportunity context, evidence excerpts, instructions, and JSON schema into ZIP/JSON task packs; validate, conflict-check, and preview external assistant results before applying mutations and saving document drafts with audit trail in `ai_tasks`. Separate from application-document packs and Codex runner. |
| R8 | [x] ~~Calendar ICS export for interviews~~ | Complete | Standard iCalendar (.ics) event and feed export for interviews and scheduled activities (single-event downloads, opportunity-scoped calendar, and global interview subscription feed); on-screen due-date queues and To-do list handle reminders. |
| R9 | [x] ~~Human-readable managed folder names and stage subfolders~~ | Complete | Saves opportunity documents under `<stable-id>-<company>-<role>/` formatted folder names with `job-description/`, `drafts/`, `approved/`, `submitted/`, `interviews/`, and `correspondence/` subdirectories; includes `POST /api/opportunities/:id/organize-folders` for transparent migration of existing files with hash verification and rollback protection, plus UI organize action. |
| R12 | [x] ~~Explicit chat-attachment & STAR story promotion to career library~~ | Complete | Promote STAR profile stories and chat attachments directly into the Career library as reusable reference evidence; explicit copy action for chat uploads and optional title/download for STAR stories. |
| R13 | [x] ~~Browser-rendered intake for JavaScript-only job pages~~ | Complete | Headless browser rendering for JS-rendered job boards (SPAs) with isolated temp user-data-dir, 15s budget, auto-detection across Chrome/Chromium/Brave/Edge, and clear fallback when blocked or unavailable. |

## Backburner / Deferred / Will Not Do scope

| ID | Scope | Disposition / Rationale |
| --- | --- | --- |
| R5 | Codex live output/token accounting and remote cancellation acknowledgement | Will Not Do. Local Codex process termination is complete; intermediate streaming and remote token tracking are unnecessary overhead. |
| R6 | Live cloud-document references and native editing | Deferred. Google Docs OAuth setup deferred; local snapshot and Markdown/Word workflows are complete. |
| R7 | Arbitrary unmarked templates and cross-engine layout fidelity | Backburner. Built-in and marked DOCX template layout preservation and PDF exports are complete and sufficient. |
| R10 | Private production remote hosting with HTTPS/VPN | Future direction. Standalone local server and private desktop hosting are the priority. |
| R11 | Named reusable criteria/evidence profiles | Will Not Do. The existing saved criteria profile and candidate evidence selection workflows are sufficient; multiple named criteria profiles add unnecessary complexity. |

## Choices and validation still pending

| ID | Choice or validation | Boundary |
| --- | --- | --- |
| V1 | Choose production host, OS, persistent disk and remote-access method | Required before R10. |
| V2 | Verify the board-owned Google OAuth app with the user’s client/account | Deferred by user choice; simulated OAuth tests and separate Codex access do not satisfy this. |
| V3 | Choose/approve any further storage locations, bespoke layouts or additional reporting scope | Configuration/product choices; existing storage controls, built-in layouts and dashboards are complete. |
| V4 | Complete live-provider, OCR/retrieval-corpus and host-shortcut acceptance checks | Implementation/fixture/browser evidence exists; real-model quality and Finder double-click checks are not inferred from it. |

## Delivery history — historical snapshots

The dated notes below describe what was true at each increment. Superseded pending statements are struck through or annotated. They are not an additional backlog; use the current tables above. Tests with fictional providers do not prove live-account authorization, real-model quality or production remote deployment.

<details>
<summary>Expand the delivery history (22–30 October 2026)</summary>

## First increment — implemented

- [x] ~~Password setup/login for a private personal board.~~
- [x] ~~Eight-stage board, list view, search, outcomes, and opportunity details.~~
- [x] ~~SQLite persistence and stage history with editable effective dates.~~
- [x] ~~Repeatable interview and communication entries and combined notes summary.~~
- [x] ~~Application/reference file uploads, downloads, and document status/version records.~~
- [x] ~~In-app storage subdirectories and pending host-folder changes.~~
- [x] ~~One-command Docker lifecycle with remembered storage, health checks, and desktop shortcuts.~~
- [x] ~~Meaningful persistence/API and launcher tests, production build, browser review.~~
- [x] ~~Record export and consistent local backup.~~

Verification details and limits are recorded in `VERIFICATION.md`. The automatic Docker Desktop startup path is implemented; this run started the installed engine directly before the first complete launcher test. The Mac shortcuts invoke the tested launcher but have not separately been double-clicked through Finder.

## Subsequent increments

Version 0.2 adds public job-link retrieval, structured/visible job details, preview before saving, and manual fallback for inaccessible listings. This includes a Docker/browser check against the supplied LinkedIn listing. See `VERIFICATION.md` for details.

Version 0.3 implements: Opportunity Knox branding; Forest/Cappuccino/Ocean/Midnight themes; distinct dashboard, opportunities, Kanban and to-do pages; profile name/photo; clearer career-material library and pending AI-indexing status; persisted tasks and statistics based on saved records. Integration requirements are recorded in `KNOX_CONTRACT.md`.

- [x] ~~Managed folder uploads, read-only existing-file selection and reviewed historical JSON record import/duplicate matching. These are separate delivered workflows; arbitrary folder-to-opportunity extraction is not supplied.~~
- [x] ~~Google Docs OAuth setup, read-only search and explicit local Word snapshot imports.~~
- [ ] Live cloud references/native editing (R6); live account verification is V2.
- [x] ~~Configured-root browsing, multiple read-only reference roots, communication direction/channels and explicit dated review decisions.~~
- [x] ~~Reviewed JD extraction, built-in/marked templates, PDF export and local vector/hybrid retrieval. Arbitrary-template fidelity is R7.~~
- [x] ~~Bounded local English PDF OCR and original HTML/PDF source snapshots in reviewed intake.~~
- [x] ~~Browser-rendered JavaScript-only job pages (R13).~~
- [x] ~~Application-pack approval, submission metadata, linked history and preserved submitted versions.~~
- [x] ~~Portable backup/restore activation and managed-document reconciliation; historical JSON import is record-only and retains source archives.~~
- [ ] Production remote HTTPS/VPN hosting (R10/V1).
- [ ] Calendar/email integration and reminders (R8).

Version 0.4 implements Career Buddy provider/model settings and connection testing; local PDF/DOCX/text extraction and chunk retrieval; persistent opportunity chats; reviewed dated interview/communication/note/field updates; fit, salary and skills prompts; editable CV/cover drafts saved as versioned Word documents. API keys remain server-side and are excluded from record exports. See `CAREER_BUDDY.md` for setup and `VERIFICATION.md` for validation limits.

Version 0.4.2 adds automatic provider model discovery, an Ollama model suggestion, manual fallback, and testing unsaved connection settings without requiring a model first. Ollama connection checks list installed models without starting one. See `CAREER_BUDDY.md` and `VERIFICATION.md` for supported endpoints and limits.

A provider must be configured by the user. Real paid-provider credentials and live model output quality have not been tested in this run. External application submission and email sending are not implemented.

Version 0.4.3 adds Lavender, Terracotta, Graphite and Plum themes, plus a custom accent and background tint with preview, save and reset. Appearance settings persist with the workspace. The Career library continues to use locally extracted text chunks and keyword retrieval; ~~vector embeddings and semantic search are not implemented~~. Superseded by completed local vector indexing and hybrid retrieval below.

Version 0.4.4 adds multi-file and directory drag-and-drop (plus a folder picker) to the Career library and opportunity Documents tabs, recursively reading dropped directories while skipping hidden/system folders (`.git`, `.obsidian`, `.trash`, `node_modules`) and preserving relative folder paths in document names. It expands local text extraction to PowerPoint (`.pptx` slides and speaker notes), Word footnotes/endnotes/comments (`.docx`), HTML, RTF, YAML/code, and video caption files (`.vtt`/`.srt`). It splits the Career library view between **Used (prepared)** and **Unused (unprepared)** sources with **Reset & re-prepare** (`DELETE /api/buddy/index`, `POST /api/buddy/index` with `force: true`), adds collapsible folder grouping (collapsed by default with **Expand all / Collapse all** controls) and a collapsible **Tags** section with automatic/editable tags, supports bulk deletion by folder and by tag as well as individual deletion and **Clear all** (`DELETE /api/documents`, preserving `submitted` snapshots), adds an **Obsidian Vault** integration (`/api/obsidian/*` and `server/obsidian-vault.mjs`) to create a new vault or connect an existing vault, export existing library sources into the vault (with companion Markdown notes and extracted text), and sync vault notes into the library, and provides an in-app **Update & restart board** control (`POST /api/restart`) that automatically refreshes the browser once the restarted server responds.


## Follow-up delivery snapshot — 27 October 2026

- Appearance choices and custom colours save automatically; contrasting light/dark presets are available. Prepared and unprepared source sections fold independently. Individual or selected library documents can be moved between folders in the configured library; a bulk move is limited to 500 files.
- An existing Obsidian vault can be connected read-only. The host launcher mounts a separate host vault read-only, and the app blocks export to a read-only vault. Sync from the vault is an explicit action that copies eligible files into managed library storage; connecting alone does not add them to Career Buddy's sources. The vault is not a live, in-place retrieval source.
- The host restart handoff checks for a running watcher, reports failures, and waits for the requested restart to complete before refreshing. See `VERIFICATION.md` for the isolated test and live read-only mount check.
- Folder/file selection no longer has a 500-file count cap. Above 500 files the UI warns and offers manually continued batches of 500; files are uploaded one at a time and the remaining queue lives in the browser. The existing 15 MB per-file browser upload limit and hidden/system exclusions remain. This concerns upload batches, not AI text chunking.

Still open: vector or semantic search; in-place directory and vault sources; previewed imports with duplicate handling; persistent resumable uploads; guided backup restore; and production remote HTTPS/VPN deployment. The Obsidian sync, any optional export to a writable vault, and library uploads are distinct user actions.


## Embedding configuration and decision-model planning

Embedding settings now have their own provider, endpoint, model ID and private API key, separate from Career Buddy chat settings. OpenAI, Ollama and custom compatible endpoints are configurable. Saving performs no network request and does not activate semantic indexing. External capability checks/discovery remain R1. ~~Local vector storage, hybrid retrieval and the criteria-based decision model remain open~~ — all three were subsequently delivered below.


The Docker image now bundles a pinned local MiniLM embedding model with CPU inference, remote model loading disabled and a built-in fictional-text test. New embedding configurations use it by default. Existing external embedding choices remain saved. ~~Library indexing and semantic retrieval still require implementation~~ — both were subsequently delivered in steps 2–3 below.


## Persistent local vector indexing — semantic search step 2

The Career Library now offers explicit selection of managed library files and selected read-only vault sources for local MiniLM indexing. Vectors, chunk hashes, model revision and source fingerprints persist in SQLite. Background jobs report document/chunk progress, allow cooperative cancellation between batches, retain completed documents, and offer explicit retry. Jobs interrupted by a restart stay stopped. Changed files are invalidated on status refresh and verified by hash before reuse/publication; deleted/reset/deselected sources lose their vectors. Unchanged completed sources reuse their vectors. Backups include the vector table. Restored or moved files may require reindexing when their file metadata changes. Originals remain unchanged.

This release requires the built-in local embedding provider for indexing; saved external settings are preserved but external indexing is still pending. ~~Career Buddy continues to use keyword retrieval; hybrid retrieval is next~~. Step 3 below subsequently delivered hybrid retrieval and passage references.


## Career Buddy hybrid retrieval — semantic search step 3

Career Buddy now combines semantic and keyword rankings for selected sources with saved compatible MiniLM vectors. Query embeddings run locally, passage rankings are fused within the existing context budget, and unindexed sources remain available through keyword matching. Replies persist search mode/fallback reasons and per-source passage references. Source hashes are rechecked after query inference; changed, deleted/deselected or reset sources cannot supply stale semantic evidence. No automatic document indexing or external embedding call is introduced.

Keyword fallback covers absent/incompatible indexes, busy indexing, model failure and unusable semantic matches. Library list filtering remains metadata-only. External embedding providers/custom vector stores remain R2; retrieval tuning against a user-approved corpus is an acceptance check (V4). ~~The separate criteria-based decision model remains open~~ — delivered below.


## Opportunity criteria and decision assessments

Settings now provides a saved criteria profile (up to 30 required/preferred criteria) and independent decision-model provider, endpoint, API key, model discovery and connection-listing test using the existing provider adapters. These settings default off and do not inherit chat credentials. Each opportunity has a Fit assessment tab with explicit evidence selection (up to 20 files). Assessments combine the current opportunity, criteria and selected excerpts using the existing hybrid retrieval; criteria can also be assessed against the opportunity alone, with missing candidate evidence left unknown.

Each dated result saves per-criterion met/unmet/unknown, cited source IDs, reasons, questions and a recommendation, alongside the exact criteria and model revisions. Unmet/unknown required criteria forbid an unqualified proceed recommendation. Invalid responses, missing criteria, unsupported citations, edit proposals and drafts are rejected without saving an assessment. Opportunity stages/outcomes never change automatically. Criteria, model, opportunity or selected-file changes mark prior results out of date on refresh. Assessments persist in SQLite, JSON exports and full backups; API keys remain private. Named profiles remain R11 and live-provider quality remains V4. ~~Formal manual decision reasons remain future work~~ — delivered in Opportunity workflow below.


## Standalone Career Buddy workspace

The sidebar Career Buddy page has four career-focused modes sharing the configured Career Buddy provider: realistic coaching, multi-turn STAR achievement development, recruiter email/transcript/notes intake, and opportunity updates. Coaching prompts require candid, evidence-based encouragement and pushback rather than praise or invented strengths. STAR prompts ask about situation, task, individual action and results before proposing a draft story, CV bullet and cover-letter highlight. Recruiter intake proposes an employer/role and linked tasks; unknown fields should prompt questions. Updates require an explicitly selected exact opportunity; company names alone cannot authorize a change.

Selected library/vault evidence uses hybrid retrieval; ~~no sources are selected automatically~~ is superseded by the opt-in Use career library workflow below. Recruiter/update modes include up to 200 recent employer/role summaries for clarification. Pasted email/transcript text is supported; ~~attachment parsing is not introduced~~ — later delivered with chat uploads. Email/calendar connections remain R8. ~~Modes have separate histories~~ — superseded by unified, conversation-scoped history below; reviewed proposals persist. Review controls save draft STAR Markdown into the library, create opportunities with tasks transactionally, or apply validated opportunity changes with revision conflicts. Repeated application of a proposal is idempotent. Existing employer/role duplicates block recruiter creation. Original documents are unchanged; no applications or communications are sent. Conversations and proposals persist in SQLite, backups and record exports. Coaching quality, follow-up quality and live-provider behaviour still need user evaluation; these are prompt-guided behaviours, not guaranteed model capabilities.


## Codex CLI provider

Career Buddy and the independent decision-model settings now offer Codex · local CLI. The launcher watcher owns a host worker and private file queue in the existing state mount; no additional network port is exposed and no Codex sign-in credentials are mounted into Docker. The worker requires ChatGPT CLI sign-in, ignores user configuration, uses ephemeral read-only execution in a temporary directory, disables shell/apps/plugins/memory/web features, and constrains output to the board schema. Existing validation and reviewed actions remain authoritative. Submitted conversation context/selected excerpts are sent to OpenAI and use Codex account limits; this data destination was explicitly authorized by the user.

The initial default/manual model support was followed by the actual account catalogue picker below. ~~The model list offers only the default~~ is superseded. Connection tests can run a fictional inference. Codex requests have a five-minute bounded deadline; other providers retain their existing deadlines. Missing/stale helper, sign-in/model errors and timeouts are surfaced. The launcher starts/stops the helper with the watcher. ~~Progress/cancel controls and broader model discovery remain pending~~ — subsequently delivered. Codex live output/token accounting and remote cancellation acknowledgement remain R5.


## Codex model catalogue picker

Codex model discovery now requests `codex debug models` through the private host queue (metadata only). The helper exposes only visible model IDs and display names, deduplicates entries and excludes internal/hidden models and all model instruction fields. The default remains selectable; manual IDs are still supported. Existing selected providers/models are preserved. Discovery uses a bounded metadata timeout, and unsupported CLI versions/errors remain visible with a manual-entry fallback. Catalogue visibility does not guarantee account/model entitlement.


## Conversational intake and automatic opportunity review

Standalone Buddy now infers coaching, STAR, recruiter, update or master-CV intent rather than requiring a mode selection. A Use career library checkbox selects relevant sources automatically using saved vectors and cached text/metadata; retrieval is bounded to 20 sources plus an explicit template. The checkbox defaults off. Uploads and an explicitly selected template are included independently. Unified chat history displays prior modes, paginates older turns and persists failed/pending user submissions. Opportunity-specific chats remain with their opportunities.

Chat uploads support five files per message, 5 MB each and 100 retained originals. Original base64 bytes are in a separate SQLite table from extraction metadata, included in full backups and excluded from JSON record exports. Users can preview extraction, exclude/reuse files or delete originals; conversation text already saved is not erased by file deletion. Files are not silently imported into the career library or vector index.

Recruiter proposals now retain contact details, work arrangement, employment type, reference, closing/action dates, tags and source notes/extracted text. Reviewed master-CV proposals save editable Word drafts from scratch or using template structure; exact source formatting is not preserved. Templates can be uploaded or located by name/configured folder among available library/vault documents. ~~General directory browsing and Google Docs connector implementation remain pending~~ — delivered in Document connections below. User-owned live Google authorization remains V2.

New/edited opportunities queue automatic tags and saved-criteria assessment when a model is enabled. Existing tags are preserved. Decisions use the enabled decision model or fall back to the enabled chat model. No criterion profile is invented. Assessment does not change stage/outcome. Job state and retry are exposed in Fit assessment; jobs are serialized/coalesced and interrupted work does not automatically resume. Library evidence is used when explicitly opted into the triggering recruiter/update chat; manual opportunity edits default to opportunity-only assessment. No existing opportunities are bulk-processed on upgrade.


## Buddy history sidebar

Saved standalone conversations are now listed beside the active chat, with title search, dates/counts and a new-conversation control. Current messages scroll within their own panel, and attachment/source controls are folded away by default. New conversations have independent persistent IDs and model context; legacy messages are retained under Earlier chat history. Conversation selection is remembered in the browser. Older-message paging is scoped to the chosen conversation; unsent text survives switches in the current page, while source/target choices reset. The sidebar can collapse and stacks above the chat on narrower layouts. No existing message rows are rewritten by upgrade.


## P1 — standalone Buddy request controls

Standalone chat reports preparing sources, waiting for provider, reading response, Codex queued/running, response validation and final states, with elapsed time and the configured AI response deadline. Progress is stage-based, not a fabricated token stream/percentage. Cancel aborts the HTTP transport or writes a cancellation marker that the host worker polls, terminating only its owned Codex process group. A cancellation check before response validation prevents a late provider result from creating an assistant proposal. Browser disconnection also requests cancellation. Submitted user text remains available for explicit retry; no automatic retries are introduced.

Settings exposes timeout 30–900 seconds, HTTP response budget 512–8000 tokens and source budget 4000–36000 characters. Defaults remain 120 seconds for HTTP and 300 for Codex unless explicitly saved. Response timeout applies to the provider/queue wait, not preceding document extraction. Codex output length remains CLI-controlled. Request metadata (provider/model/stage/timestamps/duration/error category) is stored in SQLite/full backups without prompts or keys. Unfinished requests/messages are marked interrupted after restart. HTTP cancellation closes the client connection; providers may continue remote work and usage may still accrue. Other Buddy/decision provider calls share timeout/output settings, and now also have interactive progress/cancel controls.


## Document connections — 29 October 2026

Career Library and Settings now offer multiple independently mounted read-only folders, paged browsing, explicit source selection and detach/cache cleanup. The launcher applies mounts and restarts without manual Docker changes. Folder originals stay in place. Google Docs has app-owned OAuth setup fields/instructions, session-bound PKCE sign-in, server-side tokens/refresh, paged native-document search, explicit DOCX draft snapshot imports and version-based duplicate detection. Originals are never edited. Live Google authorization remains pending the user’s OAuth client and consent; tests simulate Google responses. See [Document connections](DOCUMENT_CONNECTIONS.md).


## P1 request controls across opportunity workflows — 29 October 2026

Opportunity chat and manual assessments share the standalone request registry, provider abort signal, progress stages, elapsed time and persisted terminal diagnostics. Views recover the latest scoped status after reopening; explicit retries use the existing send/assess controls. Cancelling prevents late provider replies/assessments from being saved. Automatic review supports cancelling queued or running work, aborting current tag/fit calls and skipping subsequent steps. Already completed tags/assessments remain; cancellation is not a rollback. Queued requests are not automatically retried after restart. ~~HTTP token streaming remains pending~~ — delivered in response optimisations below. Codex live output and remote compute cancellation acknowledgement remain R5.


## P2 document layouts and PDF export — 29 October 2026

Document Studio is available in Career Library and opportunity Documents. It supplies four built-in layouts/blank templates, keep-original rendering and a single marked-paragraph custom template workflow. New Buddy drafts retain reviewed text for layout reuse. Actual PDF page counts, target warnings, page images and source revision checks precede explicitly reviewed Word/PDF draft saves. LibreOffice/Poppler/fonts are bundled; no AI is called. Originals/submitted files remain unchanged. Temporary previews expire; saved drafts use existing storage/backups. Exact cross-engine pagination and arbitrary unmarked template reconstruction remain pending; use source-system PDFs as faithful visual copies. See [Document Studio](DOCUMENT_STUDIO.md).

## P3 career document categories — 29 October 2026

Structured categories distinguish master/tailored/general CVs, cover letters, templates, supporting statements, STAR/interview stories, job descriptions, references and other documents. Categories are independent of file kind, tags, approval status and physical folders. Uploads accept categories; document rows allow individual edits; library selections support atomic batches up to 500 with revision conflicts checked before any write. Category filtering combines with the existing folder/preparation/tag views. Legacy defaults are derived without rewriting stored rows; known master/tailored generation context supplies reliable defaults. Templates remain selectable explicitly but are excluded from automatic standalone Buddy/fit evidence. Reclassifying a source as a template makes its prior fit assessment stale. Studio copies inherit source category. Files and submitted bytes are preserved.


## Plan reconciliation — 29 October 2026

Audited all 39 previously unchecked markers against code, tests and dated verification notes. Corrected stale entries for configured-root browsing/in-place selection, fit-criteria/assessment structure, request state, templates/PDF export and restore UI. Split partial items rather than marking broad milestones complete: isolated restore was implemented at that point; ~~clean-install activation, live-board replacement and reconciliation remain open~~ were subsequently delivered in Reliability/Historical import. Production remote hosting remains R10. Google app authorization remains deferred despite separate connector-assisted private exports. No implementation or runtime state changed during this documentation audit.


## Application packs — 29 October 2026

Opportunity Documents groups exact file versions, supporting text and answers into reviewed/approved packs. Recording external submission retains route/receipt/dates, creates a linked event and locks selected versions as submitted. Copy-to-draft preserves earlier packs. Metadata/hash preflight and atomic writes prevent partial submission; repeat submit is idempotent. ZIPs include pinned files and text/manifest. Existing exports/backups retain pack data without a migration. No AI or external sending is added. See [APPLICATION_PACKS.md](APPLICATION_PACKS.md).


## Feedback inbox — 29 October 2026

A shared right-edge Feedback button is available on all workspace pages and sign-in/loading/error screens. Signed-in users save messages/page context privately, track Open/Planned/Done and export JSON. Optional Career Buddy provider review returns advisory priority/improvements/questions without career data or automatic code changes. Cancellation, restart interruption, idempotent submission and revision conflicts preserve feedback. Full backups and record exports include the inbox. See [FEEDBACK.md](FEEDBACK.md).


## Communications and interviews — 29 October 2026

Activity forms now record incoming/outgoing communications and custom channels, custom interview types, a distinct rescheduled status, follow-up text/due dates/completion, and links to opportunity document versions. Files can be uploaded in the activity form or selected from existing opportunity documents. Unlinking an attachment preserves its original; deleted originals are shown as unavailable. New activity edits retain full previous field snapshots, with expandable history; earlier limited history is preserved as recorded. Follow-ups appear by due date in the dashboard/to-do action queue; completed follow-ups, cancelled activities and closed opportunities are excluded. Rescheduled interviews remain in the dashboard preparation list. Existing Career Buddy activity proposals remain compatible; the new fields are manually editable, with no new AI calls or external communications. See [COMMUNICATIONS.md](COMMUNICATIONS.md).


## Opportunity workflow — 29 October 2026

Creation and Overview now expose a dedicated application route; existing submitted packs keep their own recorded route. Fit assessment includes a separate manual strengths/gaps editor and dated proceed/ignore/defer decision with a required reason, revision snapshots and timeline entries. An explicit checkbox can advance to CV & cover letter, close as Ignored or move to Review; recording alone does not move stages. Closed opportunities require explicit reopening before a review can move them.

A new Offers tab stores multiple offers, compensation/package, terms, contact, received/response/start dates, linked opportunity document versions, and pending/accepted/declined/withdrawn/expired decisions with editable dates, reasons and retained history. Creating or accepting an offer does not mark Hired or close/move the opportunity. Pending response deadlines appear in the dated dashboard/to-do queues and disappear after a response or closed outcome. Timeline and Summary include reviews/offers; record exports/full backups preserve their metadata and histories. Workflow saves do not start new AI requests or send communications. See [OPPORTUNITY_WORKFLOW.md](OPPORTUNITY_WORKFLOW.md).


## Finding opportunities — 29 October 2026

The opportunity list and Kanban board now share combined search/outcome/stage, multi-tag (all/any), application-deadline and overdue-action filters. Deadline choices include passed/today/next 7 or 30 days/dated/undated and inclusive custom ranges with visible validation. Overdue work includes overview next actions, unfinished activity follow-ups, pending offer responses and linked open to-dos on active opportunities; the workspace overdue count uses the same rule. Selected filters have removable chips, a matching-record count, a shared no-results explanation and reset to the default active view. Selections survive navigation/list-board switching while the app remains open; reloading resets them. Filtering uses loaded metadata without AI requests or record changes. Responsive control styles are provided. See [FINDING_OPPORTUNITIES.md](FINDING_OPPORTUNITIES.md).


## Reliability — 29 October 2026

Library/opportunity Documents upload queues now retain file bytes and options in browser IndexedDB, scoped to the server workspace and document context. Explicit resume/pause, frozen attempt options and request IDs recover interrupted uploads without duplicate versions; cross-tab leases and unattempted-before-failed ordering preserve batch behaviour. Browser storage limits apply; clearing site data/private browsing can clear this browser-only queue, which is outside server backups.

Settings adds opt-in daily/weekly full backups with one overdue catch-up, failure backoff and status, while the launcher verifies a full private backup before rebuilding/restarting an existing installation. Failure blocks an upgrade and attempts previous-image/config recovery. Backup document hashes are checked before publication.

The launcher-managed recovery flow previews and confirms migration, relinking or backup activation. It checks paths/hashes, rejects changed/expired plans and unavailable/read-only target conflicts before stopping, preserves originals and a portable pre-change backup, remaps managed documents, restarts the selected service and rolls back failures. A transaction journal recovers interrupted preparation/switching. Restore activation signs out restored sessions and preserves the current host’s source-access configuration; historical record import/merge remains separate. Verified with fictional Docker migration/relink/replacement and a transferred full backup into a separate empty installation, including browser sign-in/records/documents and exact submitted bytes. See [RELIABILITY.md](RELIABILITY.md).


## Career Buddy response optimisations — 29 October 2026

Standalone and opportunity chat now request streaming from OpenAI Responses, Claude Messages, Gemini, Ollama and compatible custom chat APIs. Incremental SSE/NDJSON parsing handles fragmented UTF-8/framing, filters non-answer reasoning, bounds wire/text sizes and requires a complete terminal response. The browser polls a memory-only, decoded reply preview; nested standalone reply metadata, draft bodies and proposed changes are not exposed as previews. The usual complete-answer/schema/source checks run before messages/proposals are saved. Cancellation, failed validation, truncation and restart discard previews. JSON-only responses remain compatible without an automatic second inference; HTTP providers have a saved Show live answer previews opt-out for servers that reject streaming.

Response details retains numeric source-preparation/provider/first-output timings, provider-reported Ollama loading/prompt-evaluation/generation timings, and Codex helper wait/execution time. It records whether only a transport stop or an owned Codex process termination was confirmed; remote computation/usage may continue. Codex waits briefly for the worker’s termination acknowledgement rather than claiming success from sending a cancellation marker. Its CLI bridge still returns full replies; live Codex tokens and remote-provider compute cancellation acknowledgement remain open. No chat provider/model, timeout or evidence selection is changed on upgrade.


## Smarter job intake — 29 October 2026

New opportunity offers an optional source review from a public URL, pasted description or PDF/DOCX/HTML/UTF-8 text upload. Existing quick deterministic lookup/manual entry remain available. Reviewed intake can retain full HTML/PDF source bytes (including direct public PDF links), read native PDF pages and OCR sparse/scanned pages locally using bundled Poppler/Tesseract English. Existing pinned public-address/redirect/size rules remain in place. Local reading is available with AI disabled; no career-library evidence is sent.

The selected chat provider may extract supported fields with passage IDs and quotes. Values/quotes must match supplied source text; explicitly supported named-month/ISO dates may be normalized. Unsupported/repeated values are omitted and flagged. Missing fields and model/source warnings remain visible. The UI selects which fields to use and preserves typed values. Only an explicit opportunity save creates three managed draft documents: the untouched source, extracted text and provenance/review JSON including both suggested and saved values. Creation is transactional, removes partial managed files on failure and replays a successful identical intake save idempotently. No stage/outcome decision is made by extraction.

Private unused previews expire after 30 minutes, are bounded to 20 pending reviews and are not part of backups. Saved source artifacts use normal managed storage/export/backup/restore. PDF reading supports the first 40 native-text pages, OCR only among the first 12 pages, a 90-second OCR preparation budget and 15 MB sources. Truncation/OCR warnings require checking the full original. OCR/model semantic accuracy still needs human review; fixture/model responses are fictional in verification. Per-stage enablement remains separate. See [JOB_INTAKE.md](JOB_INTAKE.md).


## Independent AI workflow controls
Settings → AI workflow provides persisted revision-checked switches for job extraction, fit/role assessment and CV/cover drafting, plus independent automatic fit and tagging switches. Defaults retain previous behaviour without writing settings or starting jobs on upgrade. Provider enablement/credentials remain separate requirements. Intake AI, fit/salary/skills actions, decision assessments and generated CV/cover proposals enforce stage policy on the server; unfinished model results are rechecked before publishing, and draft saves respect current policy. Plain chat/coaching, local OCR/reading, manual uploads and Document Studio remain available. Natural-language auto chat is guided by policy and generated recruiter/CV proposals are rejected when disabled; switches do not classify or censor every free-text coaching answer. Existing work is retained and turning switches on does not bulk-process old records.

## Saved opportunity briefings — 29 October 2026

- [x] ~~Saved opportunity Buddy briefings: source references, generation date/provider/model, stale indication and explicit refresh, alongside the chronological summary.~~

## Historical record import and duplicate reconciliation — 30 October 2026

Settings now accepts board JSON record exports and a downloadable historical JSON template (8 MB / 1,000 opportunities per file). Every row starts skipped. Matching suggests existing source IDs, record-field hashes, manifest JD hashes, normalized job URLs, employer/reference and employer/role pairs; within-file duplicates are also flagged. Suggestions never select or merge automatically. Users choose separate creation or a candidate target and individual fields, timeline/comms history and/or current stage. Historical later-stage dates must be supplied rather than invented. Existing histories, submitted bytes, packs and unrelated fields are preserved.

A synchronous verified full backup precedes one SQLite transaction. Preview fingerprints reject concurrent record/document/task changes; preview tokens expire after an hour, survive restart and reject older replaced previews. Applied content hashes persist receipts and make exact retries idempotent. At most five pending source previews are retained; completed source archives/receipts persist in full backups and JSON exports. Reports can be downloaded from Settings. No AI work is started by importing.

This is record-only import, not workspace restore: document manifests and linked tasks are retained in the source archive; foreign file paths are never opened, attachments are not rebound, and tasks/chats/offers/reviews/application packs are not activated. Native cloud editing and arbitrary folder/CSV extraction are not added. See [HISTORICAL_IMPORTS.md](HISTORICAL_IMPORTS.md).

## AI request activity and usage — 30 October 2026

AI activity is available in the sidebar. It lists recorded requests with task/provider/status/rolling-period filters, 25-row pagination, per-filter totals, active cancellation and original-workflow review/retry links. The list is read-only and never replays prompts. Standalone failed/interrupted/cancelled user messages can be restored for review before an explicit send, with target/template/library options reviewed afresh. Model discovery, embedding jobs and local document exports are outside this log; the universal scheduler remains open.

New records carry task/action metadata, prompt version, system-only SHA-256 fingerprint, requested and reported model IDs where supplied, duration/status, numeric usage and optional rate snapshots. Buffered and streamed OpenAI/Claude/Gemini/Ollama/custom accounting is normalized; cumulative stream counters replace earlier snapshots. Missing and partial usage stay distinct from zero. Codex's current text-only helper supplies no token accounting; account usage has no per-request price here. Legacy records remain unchanged and unreported metadata is not reconstructed.

Optional exact provider/requested-model rates are user-entered, currency-specific, revision-protected and saved with each new request. Older estimates retain their rates. Flat estimates omit cache/service-tier/tool/tax differences; partial usage and unavailable rates have no cost estimate. Different currencies are never added together. Retry IDs still work with existing clients, while previous terminal attempts are archived separately and late callbacks cannot overwrite a newer attempt. Request records/rates survive restart, full backup/restore and JSON export. No prompt text, response body, endpoint or API key is added to activity diagnostics. See [AI_ACTIVITY.md](AI_ACTIVITY.md).

## External embedding capability checks and model discovery — 30 October 2026

Settings → Semantic search now discovers embedding models from OpenAI, Ollama and custom OpenAI-compatible endpoints (`POST /api/buddy/embedding-models`), filtering out chat, image, speech and reranker entries while keeping manual model ID entry available. Capability testing (`POST /api/buddy/embedding-test`) works before or after saving for both the built-in local MiniLM model and external providers, sending a short fictional phrase to `/embeddings` or `/api/embed` and verifying non-zero finite vectors and their dimensions. Stored keys are retained only when provider and base URL match. Neither discovery nor capability testing starts vector indexing or sends career documents; external provider indexing remains R2.

</details>

## Settings sections and Career Hub — 31 October 2026

Settings and Career Hub now use shared, responsive section navigation rather than one long pane. Career Library is renamed Career Hub throughout the interface; existing library routes and stored folder names are retained. Documents is the Hub default, with preparation, semantic search, connections and Obsidian separated. Panels remain mounted across section changes to preserve drafts and ongoing work. Section URLs support browser history and direct links, including opportunity/AI activity links to Career Buddy configuration.

## Build-aware update detection — 31 October 2026

The launcher records immutable source/commit build metadata and publishes host-side source fingerprint observations through the existing private state mount. The GUI polls separately from board refresh, including while Settings is open. Local edits are detected without a version bump or repository mount; remote checks use versions and fast-forward commit comparisons with a five-minute cache. Update messages distinguish local rebuilds from upstream changes requiring a host pull. No automatic source pulls or upgrades were added.

## Development build identity — 31 October 2026

Main now identifies as `0.4.7-dev.0`, with `v0.4.6` retained as the published stable release. Sidebar and Settings show the running version, development/release label, linked short build commit and optional uncommitted-changes marker, plus a latest-release link. Launcher Docker metadata records commit and dirty state; direct Node development runs capture their Git identity at startup. README distinguishes stable releases from main development. A stable release supersedes its same-numbered development prerelease.

## Restart connection handling — 31 October 2026

Board/update polling pauses during a requested restart. A synchronous restart ref also protects requests already in flight: temporary transport and gateway errors do not create the global red banner during expected downtime. Rejected restart requests, host-reported failures and timeout errors remain visible; genuine failures clear the restarting progress notice.

## Simplified feedback — 31 October 2026

Feedback uses one pane with a text box, an opt-in GitHub checkbox and Submit. No history, status or export controls are visible. Submission saves feedback privately first; the GitHub option then uses Career Buddy to fill out an editable issue draft. Provider failure/cancellation preserves the private feedback and leaves a manual fallback. Original entries and historical reviews stay stored; the user reviews and submits any issue on GitHub.

## Settings typography and spacing — 31 October 2026

Settings uses consistent heading, paragraph, label, help-text and control sizes, with more room between expandable groups and numbered instructions. Google Docs setup guidance has an inset panel and wrapping redirect URLs. Narrow-screen Settings forms stack into one column. The shared document-connections panel uses the same formatting in Career Hub.

## Opportunity deletion and workspace reset — 31 October 2026

Opportunity details now offer individual deletion; list/Kanban views offer clear-all, including completed and filtered-out records. Settings → Reset workspace clears board data, conversations, feedback, preferences and saved credentials while preserving the exact profile, sign-in and storage locations. Every action previews its scope, requires typed confirmation and creates a verified private full backup before atomic removal. Existing files, external originals and earlier backups are retained. Active work and stale previews are rejected; reset invalidates old staged uploads and protects against stale tabs. See [WORKSPACE_RESET.md](WORKSPACE_RESET.md) for scope and recovery.

## Focused Kanban layout — 31 October 2026

Kanban now uses the full viewport, replacing the sidebar, large heading, totals and footer with a compact toolbar. Search, outcome selection and Add opportunity remain visible; detailed filters expand in place and clear-all remains in the actions menu. Stage columns scroll independently while headings stay visible. Horizontal scrolling supports keyboard navigation; the back arrow returns to the standard opportunity list with shared filters retained.

## Collapsible workspace sidebar — 1 November 2026

This supersedes the sidebar removal in the focused Kanban increment. Kanban retains workspace navigation by default. The shared hide/show control slides the sidebar away and expands content, with a visible restore button, keyboard operation, hidden-navigation focus protection and reduced-motion support. On phones the same control hides/restores the existing bottom navigation. The choice remains while navigating within the app; reload starts with navigation visible.

## Sidebar Document Studio — 3 November 2026

Delivered all 5 phases of Document Studio: Phase 1 (dedicated Studio navigation, document library organisation, typed uploads with default roles, rename/duplication, multi-page preview, in-browser Markdown rendering, and format/category filtering), Phase 2 (unified document generation service, template-preserving layout mapping, exact-artifact saving, opportunity attachment and multi-page preview/download), Phase 3 (AI document workspace, Studio Assistant chat, OpenXML template derivation with neutral placeholders, contextual layout/content revisions, in-flight cancellation, and version lineage/restore), Phase 4 (connected documents: Obsidian vault sync/export, Google Drive search/import for Docs/Word/PDF, and non-destructive conflict resolution with native UI controls), and Phase 5 (accessibility & responsiveness: Escape dismiss, Arrow preview pagination, Enter/Space list keyboard selection; library, filter & assistant empty states; file size (>20MB) & format checks; preview retry; defaults persistence across restarts; submitted document safeguards).

## High-fidelity AI layout preservation (R7) — 3 November 2026

Implements the Codex document-generation pipeline preserving reference structural formatting (sidebars, multi-column tables, margins, typography and page structure):
- Host bridge (`scripts/codex_buddy.py`): added `kind='document-generation'` with `--sandbox workspace-write`, shell tools, `-i` rendered reference page images, strictly checked bounded job folders, and manifest OpenXML validation.
- Server queue (`server/codex-local.mjs`): implemented `runCodexDocumentGeneration` staging `inputs/reference.docx`, `inputs/source_cv.txt`, `inputs/job_context.json`, and `workspace/draft.docx`. Validates manifest paths against traversal, verifies OpenXML package structure with `safeWord`, and returns exact artifacts without linear Markdown flattening.
- Opportunity tailoring (`server/career-buddy.mjs` & `src/components/TailorApplication.tsx`): wires `runCodexDocumentGeneration` into the CV tailoring flow when Codex is configured with a reference style document. Bypasses text flattening, saves exact OpenXML bytes, displays high-fidelity artifact badges with page counts and review notes, and preserves idempotent saves and 409 conflict checks.
- Comprehensive automated verification: unit tests in `tests/test_codex_buddy.py` (45/45 launcher tests passing) and `tests/codex-local.test.mjs` (7/7 tests passing); end-to-end integration test in `tests/server.test.mjs` verifying fictional two-column sidebar Word reference retention, candidate factual history preservation, and exact-artifact saving (290/290 Node tests passing).

## Opportunity Knox MCP Server — 3 November 2026

Delivers Model Context Protocol (MCP) server integration for Claude Desktop via local stdio (`server/mcp-server.mjs`) using `@modelcontextprotocol/sdk`:
- Tool suite:
  - `search_opportunities`: search by keyword or filter by stage with paginated summaries.
  - `get_opportunity`: full description, requirements, existing strengths/gaps review, and revision.
  - `search_career_evidence`: hybrid keyword/vector search across verified career library documents, excluding templates and job descriptions.
  - `read_career_evidence`: retrieve full prepared text or indexed excerpts by passage index, enforcing workspace and security bounds.
  - `save_fit_review`: attach validated strengths, gaps, and review timestamps to Opportunity cards; protects against concurrent edits with 409 revision checks and supports idempotent retries. Preserves user decision, reason, stage, and outcome without mutation.
- Settings UI (`src/components/MCPSettings.tsx`): enable/disable toggle, write permission toggle, API key generation and rotation, and one-click copyable `claude_desktop_config.json` snippet with macOS/Windows setup instructions.
- Automated verification: `tests/mcp-server.test.mjs` verifies Settings API, Bearer token authentication, 401/403/409 enforcement, and live end-to-end communication with an actual MCP client over `StdioClientTransport` (293/293 Node tests and 45/45 Python launcher tests passing).


