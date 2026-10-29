# Application packs

Open an opportunity’s **Documents → Application packs**. Create a draft, select exact managed document versions from this opportunity or Career Library, and add supporting text/application answers. The picker defaults to application document types; use its filename search/Show all option for other files. Include a cover letter or mark it not required. A text-only portal application is supported with that exemption.

Save, review the exact files/text and explicitly approve. Draft documents become approved; already submitted versions retain their status. Approved packs cannot be edited in place. Copy to new draft for revisions. Missing/changed files or revisions block approval/submission without partial changes.

After applying outside the board, record the submission date/time, route and receipt/reference. Confirm it happened externally, and optionally move the opportunity to Submitted (default only for earlier stages). Closed opportunities must first be reopened. This action creates a linked timeline event, retains the recording time and marks selected versions submitted. It does not send an application or run AI.

Submitted pack text, version/hash manifest and submission details are immutable. Selected files cannot be deleted/moved/overwritten through normal board actions. Notes/categories can still be edited separately; the pack retains its recorded manifest. Repeated submit clicks return the original event. Copy to a new draft for another application.

Download pack ZIP includes hash-checked file bytes, a JSON manifest, supporting-statement text and question/answer text. ZIPs are limited to 80 MB; individual downloads remain available. Limits: 30 files, 20 answers and 20 packs per opportunity, with bounded text/record sizes. Only draft packs can be removed through the API. Supporting text is not automatically formatted into a PDF.

Packs live in opportunity records. Record exports include manifests/text; full backups also include managed file bytes. No schema migration is needed. Pack content is excluded from automatic Buddy/fit contexts. Recording dates use a device-local input and are stored as timestamps; displayed dates use the board timezone.
