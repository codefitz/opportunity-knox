# Application board — initial product plan

Product plan agreed 22 October 2026. Implementation has started; see `ROADMAP.md` for delivered features and remaining work. The plan below describes the full intended product, rather than claiming every feature is available in the first increment.

## Feature Requests

- [ ] Add a vectorised DB as a source - default preinstalled or choose a custom one.
- [ ] Ability to add obsidian vault as a source
- [ ] Ability to add a directory as a source
- [ ] Ability to drag and drop files and directories to the career library
- [ ] Career Buddy side bar option - open a chat which will allow you to describe projects and experience, which career buddy will turn into a CV bullet or Cover letter highlight.

## Confirmed direction

- A custom browser-based Kanban board for tracking job opportunities from identification through hire or rejection.
- Accessible across several devices through a privately hosted service.
- Easy to start and stop, with records and documents surviving shutdowns and upgrades.
- Docker is an implementation detail: routine operation uses a single launcher command or host shortcut, with no manual Compose, mount, or environment-file editing.
- Optional, pluggable AI support for identification, fit review, and document generation. Choose the provider later.
- Automatically dated stages with editable dates, optional notes, and a combined opportunity summary.
- Configurable document storage and a reusable library of previous JDs, CVs, and other evidence.

Initial assumption: one person using the board across several devices. Shared team access and unrelated project workflows can be considered later.

## Board and opportunity workflow

One card represents one application opportunity, including a stable ID so repeat applications to the same employer remain distinct. Cards show employer, role, current stage, priority, deadline, next action/date, and time in stage. Support drag-and-drop and a stage selector, plus a list view for smaller screens. Search/filter by employer, role, stage, outcome, tags, deadline, and overdue action.

| Stage | Information and behaviour |
| --- | --- |
| 1. Identification | Add a URL, upload a PDF/DOCX, or paste JD text. Capture role, employer, job reference, source, location, working arrangement, salary/rate/currency, employment type, contact, closing date, application route, requirements, and source documents. Unknown fields remain visibly unknown. |
| 2. Review | Optional AI-assisted comparison against selected career evidence and preferences. Record strengths, gaps, questions, recommendation, and the user's proceed/ignore decision with an optional reason. Allow proceed, ignore, or defer. |
| 3. Generate CV and cover letter | Select approved reference material and a template; create versioned drafts. Allow existing documents to be attached instead, and mark a cover letter as not required. |
| 4. Application review | Read and revise the application pack, supporting statements, and application answers. Record which exact document versions are approved. |
| 5. Application submitted | Explicitly record submission date, application route, reference/receipt, and the exact submitted pack. Reaching this stage is a user action; moving a card does not submit an application externally. |
| 6. Communications and interviews | Record communications and any number of interview/assessment entries. Each has its own type, scheduled date, status, contacts, preparation, notes, documents, and follow-up. |
| 7. Final interview | A milestone associated with a particular interview entry. Retain earlier interviews; support more than one final-stage meeting without losing history. |
| 8. Outcome | Hired or rejected, with date, reason/feedback where known, and relevant documents. Also support ignored, withdrawn, and role closed. Record an offer and its decision separately so an offer is not automatically counted as a hire. |

Ignored opportunities close directly from Review. Rejection, withdrawal, or role closure can occur at any stage. The default board shows active opportunities; a completed view retains closed records and their last active stage. Returning to an earlier stage or reopening an opportunity creates a new history event. Stages may be skipped when a hiring process does not require them; skipped stages do not acquire invented dates.

Interview types: text/written, phone, video, in-person, technical assessment, and custom. Statuses include planned, completed, cancelled, and rescheduled. Communications have incoming/outgoing direction and channel. Recording a communication does not send it.

## Dates, notes, and summaries

- On each stage transition, save the actual recording timestamp and a default effective date/time. The user can correct the effective date without erasing when the event was recorded or its correction history.
- Keep a separate event for each visit to a stage, with entry/exit dates and optional notes. Never overwrite an earlier visit when a card moves backwards.
- Separate scheduled interviews, deadlines, and next actions from completed events. Store timestamps consistently and display them in the configured timezone, initially Europe/London; retain date-only values as dates.
- Save notes on the relevant stage or event. The Summary tab assembles all notes, decisions, communications, interviews, and document links chronologically, with source dates. This works without AI.
- Optional AI summaries are derived views linked to their source events and show when they were generated. New events make an older summary visibly out of date.
- Provide overdue/deadline indicators and next-action dates. Email/calendar reminders are a later integration; the stopped service does not process background reminders or AI work.

## Main screens

1. Board/list: active opportunities, search, filters, add opportunity, next actions.
2. Opportunity detail: overview; stages/timeline; documents; communications/interviews; summary. Keep job source and employer/role identity easy to find.
3. Reference library: approved career evidence, master CVs, role-specific CVs, templates, prior JDs, supporting statements, and interview stories. Tag and select material for an individual AI task.
4. Settings: document locations, reference sources, AI connection and stage controls, timezone, backups, and export/import.

## Document storage and existing material

Separate the board database, application documents, reference library, and backups. A document record tracks its purpose, version, source, storage location, and relationship to an opportunity or generation task. Mark draft, approved, and submitted versions explicitly. Preserve submitted files as snapshots so later edits cannot change the recorded submission.

The current workspace has career evidence and approved assets under Career Transition, and current/historical application documents under Work/Applications. These are candidate reference sources, not an instruction to import every historical file. Preserve originals and let the user choose what becomes approved evidence.

Offer two document actions:

- Upload/copy into managed storage: available from every device through the board.
- Attach an existing document: use a configured server-accessible folder or supported cloud connector, with availability shown. A Google Docs link remains a cloud document rather than being treated as a local file.

Settings should expose an application-document root, one or more reference locations, and a backup destination. In a hosted installation, filesystem roots must be accessible to the host. A folder on the Mac is only usable by a separate server when it is mounted/synchronised there or connected through a suitable service. Selecting a folder on a client device does not give a remote server ongoing access to it.

The app owns document-location preferences. Use a server-side folder browser within available locations, clearly labelled as folders on the hosting machine. Browser uploads remain a separate way to bring files from the current device into the library. Save and validate preferences so they survive restarts. Docker exposure of a new host location is handled by the launcher as described below.

Proposed managed layout:

```text
<document-root>/
  references/
  opportunities/
    <stable-id>-<company>-<role>/
      job-description/
      drafts/
      approved/
      submitted/
      interviews/
      correspondence/
```

Keep document paths relative to the configured storage root where possible. Detect missing/offline files and allow relinking. Changing storage roots needs an explicit attach-existing or copy-and-validate workflow, retaining the old location until migration is checked.

Imports can identify likely duplicates using document hashes and job reference/URL/employer-role matches. Show possible duplicate opportunities for review; never silently merge separate applications.

## Pluggable AI design

Keep the core board fully usable with AI disabled. Provide one adapter boundary with capabilities for extracting opportunity details, reviewing fit, and generating documents. Support provider/model configuration and independent enablement for stages 1–3.

Stage 1 returns structured fields with source passages, missing information, and uncertainties. Preserve a copy of the JD because live listings may change or disappear. If a link cannot be retrieved, accept pasted text or an uploaded document; offer OCR when needed for scanned PDFs.

Stage 2 evaluates against user-defined criteria and selected reference evidence. Show must-have requirements, supported matches, gaps, and questions. A recommendation should be explained with evidence; the user decides whether to proceed or ignore. Previous JDs provide role context and do not establish the applicant's skills.

Stage 3 uses selected approved career evidence and templates. Preserve the chosen CV structure and page target; generate editable output and PDF. Keep claims traceable to reference evidence, identify unresolved gaps, and save each generation as a new version. Include document rendering/page-fit review before marking the pack ready.

Every AI run records provider/model, task and prompt version, selected source versions, output, status, and usage/cost if available. Credentials remain on the server. Support queued, running, completed, failed, cancelled, and interrupted states. After a shutdown, show interrupted work and offer retry; do not silently repeat a paid generation or create duplicate document versions.

An external-assistant route can initially export a task pack and import its result. A later API or agent integration can use the same task/result format. An existing chat does not automatically become connected to the hosted board.

## Launcher and first-run experience

The normal user interface is the web app. Package it with a host launcher so Docker commands and configuration files are maintained automatically. The commands below are proposed interface names, not commands available yet.

```text
./board start       # Start or open the existing instance
./board stop        # Stop without deleting data
./board restart     # Apply pending host-folder changes and restart
./board status      # Show running/stopped state and the board address
```

Supply a double-click Start Board shortcut where supported by the chosen host OS, using the same launcher. On a remote/headless host, show the board URL; open the browser automatically only when running on a host with a suitable desktop. Starting an already running instance should reuse it.

First launch should:

1. Check Docker/Compose availability and whether the engine is running. Where supported, start an already installed desktop engine; otherwise give a specific setup instruction. One-time installation, host folder-sharing permissions, or remote-access provisioning may still need host setup, which cannot be settled until the host is chosen.
2. Choose persistent state in an OS-appropriate local application-data directory and default documents under the host user's `OpportunityBoard` folder. Keep the live database separate from any subsequently selected cloud-synchronised document directory.
3. Allow an optional first-start document-folder argument, such as `./board start --files "/path/to/applications"`, or a simple first-run prompt. Accept the default without requiring custom input. Remember the choice rather than asking every time.
4. Create the default application-owned folders, validate configured locations, generate mount configuration, and start the packaged service. Use plain-language errors for missing folders, unavailable drives, write permissions, and occupied ports. Never silently replace a missing configured drive with an empty default location.
5. Wait for a health check, then display/open the board address and its initial in-app setup screen. Subsequent starts use the saved configuration and existing data.

There are two levels of folder configuration:

- Within folders already exposed to the app, users can choose document/reference/backup subfolders in Settings without restarting Docker. Changing an existing document root still uses the attach-existing or copy-and-validate workflow.
- An entirely new host folder must be exposed when the container is recreated. Settings can record the requested host path as pending; the launcher validates it, updates mounts, and applies it on `./board restart` or the next start. Until then, keep the current location active. The app cannot browse or validate an unexposed host directory itself. Do not advertise arbitrary host-folder access as an immediate in-app setting.

Use a structured pending-configuration file in persistent state for this handoff, not shell commands supplied by the web app. The host launcher validates requested paths and permissions. Expose selected document roots for writing and reference-only roots as read-only where appropriate. Do not require the web container to control Docker or mount the entire host filesystem just to support folder settings.

This keeps normal operation to one action. Adding a host folder outside the currently available locations requires one launcher restart, without manual Docker editing. In a remote installation that action runs on the hosting machine or its management interface. Retain existing document locations until any requested migration is validated; do not orphan files by replacing a mount prematurely.

## Hosting and persistence proposal

Recommend a responsive TypeScript/React frontend, a small Node.js API and background task runner, and SQLite on the host's local disk for the initial single-user service. All devices use the API; none opens the database file directly. Revisit PostgreSQL if hosting requires multiple application replicas or the product expands to substantial concurrent use.

Package the service with Docker Compose, persistent database storage, and document mounts managed by the launcher. Add private authenticated access through the chosen host's VPN or an HTTPS endpoint. The hosting machine and access route remain to be chosen. Access from different devices should serve documents through the application rather than depend on device-specific filesystem paths. Check record revisions on save to prevent a stale browser tab silently overwriting a newer edit from another device.

Provide simple Start Board / Stop Board controls through the host's management interface or launcher. Start/stop must not delete data. When stopped, the board is unavailable on all devices; stopping the board does not necessarily power off or stop billing for the host. A stopped application cannot restart itself from its own unavailable webpage.

Persist opportunities, event history, notes, settings, document metadata, approved reference selections, and AI task state independently of the running container. Documents also live outside the container's disposable layer. Keep the live database on server-local storage; use consistent snapshots for backup and cloud copying rather than synchronising an actively written database across devices.

Provide automated backups while running, a backup action before upgrades, and a portable export containing records, history, documents or a clearly identified external-document manifest, and configuration excluding secrets. Restoring a backup must restore document associations as well as cards. External cloud documents are only included in a full backup when explicitly exported/copied.

## Initial data model

- Opportunity: identity, source, job details, current stage, outcome, tags, priority, next action, revision.
- Stage event: opportunity, transition, effective and recording timestamps, corrections, notes.
- Activity: communication or interview, type/channel, dates, participants, status, notes, follow-up, final-stage marker.
- Document/version: opportunity or library association, type, storage reference, version/hash, approval state, submitted snapshot association.
- AI task: capability, provider/model, inputs and source versions, lifecycle, outputs, errors, usage.
- Settings and reference profiles: approved sources, templates, fit criteria, storage providers, display preferences.

## Delivery sequence

1. Core workflow: board/list, opportunity detail, all stages/outcomes, date history, notes/summary, interviews/comms, uploads/reference library, document version labels, and export/import. Include minimal private hosting, persistent storage, and start/stop from the outset.
2. Existing-workflow integration: configure the selected document/reference locations, add a previewed import of chosen historical records, and refine templates and document handling. Add backup/restore verification and concurrent-device editing checks before relying on the service for live applications.
3. AI integration: implement the task/result contract and selected adapter, then extraction, evidence-based fit review, and template-based generation in that order. Keep per-stage controls and human review of outputs.
4. Optional extensions: calendar/email integrations, reminders, richer reporting, more storage providers, and additional project templates if needed.

## Acceptance examples

- Create an opportunity on one device; reopen it on another with the same documents and history.
- Upload a JD and save unknown job fields without inventing values; complete them later.
- Move a card, correct its date, move it backwards, and verify that the complete history remains readable.
- Ignore an opportunity during Review or record rejection before interview without forcing it through later stages.
- Add a phone screen, two video interviews, an assessment, and an in-person final; reschedule one without losing its previous date.
- Read/export all notes and communications as one chronological summary with AI disabled.
- Submit version 2 of a CV; generate version 3 later; the submission record still opens the original version 2 snapshot.
- Stop and restart the service; verify cards, dates, notes, attachments, settings, and task state survive. Interrupted AI work must not silently rerun.
- Restore a backup into a clean installation and verify the same records and managed documents are accessible.
- Edit the same card from two devices and receive a clear conflict/reload choice rather than silently losing one edit.
- Start with the default launcher command, stop, and start again without editing Docker files or re-entering saved folders; verify the same board and documents reopen.
- Change a document subfolder in Settings and verify it persists. Request a new host folder outside current mounts, apply it with one launcher restart, and verify existing document links still work.
- Start while a configured drive is unavailable and receive an actionable message rather than an apparently empty replacement board or document library.

## Remaining choices

- Host: existing computer/home server/NAS or a private cloud server; confirm its OS, persistent disk, and remote-access method so the one-command launcher and optional desktop shortcut can be tailored appropriately.
- Storage: which existing folders should be connected, which documents should be copied into managed storage, and whether native Google Docs editing/export is required initially.
- AI: provider and model later; the adapter contract can be designed first.
- Document templates: identify the initial approved CV/cover templates and their layout requirements before implementing generation.

## Technical references

- [Docker persistent volumes](https://docs.docker.com/engine/storage/volumes/): stored data can survive the lifecycle of a container; host-visible documents may instead use bind mounts.
- [Docker Compose stop](https://docs.docker.com/reference/cli/docker/compose/stop/): stopping preserves containers, which can subsequently be started again.
- [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/): host folder access is configured at container creation and uses paths on the Docker host.
- [Compose variable interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/): the launcher can supply saved host-folder settings without requiring manual Compose edits.
- [SQLite network filesystem considerations](https://www.sqlite.org/useovernet.html): supports the proposal to keep database access local to the server and let browser clients use the API.
- [Browser directory picker compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker): direct browser folder access has compatibility and permission constraints; it does not replace hosted document storage.
