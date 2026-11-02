# CV styles and document previews

The previous standalone studio selector has been replaced in the interface by the **Tailor a new CV** expander. **Templates** and **Previous CVs** are separate horizontally scrollable thumbnail galleries. Previous Word CVs reuse typography, paragraph spacing and page settings in a new document; arbitrary tables, sidebars and fixed headers are not copied into the new CV. The original files are never changed.

Saved-file and CV thumbnails support DOCX and PDF; Google Workspace shortcuts use the board’s existing Google connection to export a PDF. Disconnected or unreadable files show a file icon with a preview-unavailable explanation. PDF and Google Doc CVs are selectable style references in the previous-CV gallery. Google Docs require the board’s Google connection. Image-only PDFs cannot supply text-based formatting and report an actionable error.

CV thumbnails show the actual first rendered page, are generated lazily, require authentication and use a bounded in-memory cache invalidated by document changes. Word CVs reuse native styles; PDF CVs recreate typography and page settings in a new editable document. Connected Google Docs use their Word export for style reuse. The existing document preview/export backend remains available; the technical reference below describes those endpoints and their safeguards.

# CV and cover-letter layout studio

Open Career Library, or an opportunity’s Documents tab, and expand **CV and cover-letter layout studio**. Save a Buddy-generated Word draft first, or upload an existing DOCX. Refresh documents if it was added in another tab.

Choose a source and a layout:

- **Keep existing Word layout** retains the original DOCX bytes and renders a PDF copy. Converter/font differences can still change pagination.
- **Classic** uses a clear single-column layout and generous spacing.
- **Compact** reduces spacing for a concise CV without cutting content.
- **Executive** uses the bundled Montserrat family and compact headings.
- **Cover letter** gives paragraphs more space.
- **Custom marked Word template** accepts an uploaded DOCX with exactly one paragraph containing only `{{content}}`. The paragraph may be inside a table. Other text, table structure, styles, margins, headers and footers remain in the template. Inserted paragraphs inherit its paragraph/run formatting, with bold headings and literal bullets; this is not arbitrary document reconstruction. Check fixed template text so old personal or role details are not carried over.

Built-in layouts have a **Download blank template** link with clearly marked prompts. Replace these prompts with verified career facts. Templates contain no personal CV content.

For new layouts, review/edit the draft text. Newly generated Buddy Word drafts retain their reviewed Markdown for reuse. Older/uploaded Word files use local extraction, which may lose heading/bullet structure. Use Markdown headings and bullets for built-in layouts. Keeping the original layout does not apply text edits.

Set a target of 1–10 pages, then **Render page preview**. The count is measured from the actual PDF. A target is a review budget: the app never silently cuts text or shrinks fonts to meet it. Inspect every page, check the facts and tick the review checkbox before saving a Word or PDF draft. Changing content/layout/target invalidates the preview. Saves create new versions; originals and submitted documents remain unchanged. Saving a preview repeatedly in one format reuses its already-created draft.

The renderer, PDF tools and fonts are bundled in Docker; no host installation is needed. Previewing is local and sends nothing to AI. Each conversion has a 60-second limit, with separate bounded page-image conversion. DOCX input is limited to 15 MB / 40 MB expanded; previews to 20 MB PDF and 30 pages, ten retained previews, 30-minute expiry. Preview files are temporary, disappear after restart and are not part of backups. Saved drafts use normal managed storage and backups.

Macros, embedded objects and externally linked media/templates are rejected. Hyperlinks remain links. Fonts unavailable in the image may be substituted. Exact Google Docs/Word pagination is not guaranteed: retain the source system’s PDF when it is the authoritative visual copy. Use **Open original Google Doc** when source metadata/notes contain its native link. This does not connect an account or edit the cloud document.

PDF conversion uses [LibreOffice’s Writer export](https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html). Montserrat is bundled from a checksum-pinned [Debian font package](https://packages.debian.org/en/stable/fonts/fonts-montserrat), with its license/copyright files retained by the package.
