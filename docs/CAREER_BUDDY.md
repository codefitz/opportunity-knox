# Career Buddy

Career Buddy is optional. It reads the current opportunity and the career documents you select, and can propose changes or draft application documents. It does not submit applications, send communications or overwrite source/submitted documents.

## Connect a provider

1. Open **Settings → Career Buddy**.
2. Choose **OpenAI**, **Claude**, **Gemini**, **Ollama** or **Custom (OpenAI compatible)**.
3. Add an API key for cloud providers. Ollama and custom servers can use a key if their gateway requires one.
4. For Ollama/custom, enter the API base URL. Custom means an OpenAI-compatible `/chat/completions` API, usually with a `/v1` base path. Other arbitrary HTTP protocols are not supported.
5. Available models are discovered from the provider and offered in a list. For Ollama, the first likely local chat model is suggested automatically; check the choice and change it if you prefer. Models are never installed by the app. Use **Refresh models** to retry, or enter an exact model ID manually if the provider does not expose a list.
6. **Test connection** works with the settings currently shown, before or after saving. For Ollama it checks the installed model list without loading a model or sending career records. With a selected model, other providers receive a short test generation that may use the provider's normal allowance. Without a model, the test checks the provider's model-list API. Enable and save Career Buddy once you are happy with the settings.

OpenAI, Claude and Gemini use their official endpoints. The key stays on the host and is not returned to the browser. Leave the key blank to keep an existing key for the same provider/server; changing provider/server clears it unless you enter a replacement. Use Remove stored key to clear it explicitly. Switching Career Buddy off preserves its settings and previous chats.

For an Ollama server on the Docker host, start with `http://host.docker.internal:11434`. The launcher/Compose setup supplies the host mapping, including on Linux. The Ollama service must be reachable from the container: a Linux service bound only to host loopback may need its private host address instead. You can also enter a private network hostname such as `http://career-server.private:11434`; the name must resolve from the app container to private network addresses. A browser device's `localhost` is not the hosting machine. No model downloads or model-service configuration are performed by this app.

JSON schema is the default output mode. If a model rejects it, try JSON mode or Prompt only under Compatibility options. App validation and reviewed changes still apply in every mode. A successful connection test establishes reachability, not the model's reasoning quality.

## Read career evidence

Upload PDF, DOCX, TXT, Markdown, CSV or JSON files into the Career library, or attach them to an opportunity. **Prepare library text** extracts and chunks files locally without any API request. The first chat using an unprepared document also prepares it.

Each chat has a source picker. By default it selects up to twenty supported original library/current-opportunity files, excluding app-generated drafts. Review that selection before sending. Other opportunity document files are excluded. An optional checkbox adds short summaries of up to one hundred other opportunities; it does not send their documents or full histories.

The request includes the current opportunity's JD and recent timeline/interview entries, up to twelve recent chat messages, and selected source excerpts within a 36,000-character source budget. For selected sources indexed with the built-in MiniLM model, Career Buddy embeds the question and role locally, checks source/chunk fingerprints, and combines cosine similarity rankings with keyword rankings using equal-weight reciprocal-rank fusion. Source openings use at most half the hybrid context budget so they cannot crowd out relevant later passages. Unindexed sources still participate through keyword matching. No files are indexed automatically by chat.

Each answer's Source coverage shows which files and passage numbers were supplied, how passages were selected (meaning, keyword, opening or supporting context), extraction warnings and omitted chunks. It also records the search mode and any fallback reason. If vectors are absent/incompatible, indexing is busy, the local query model fails, or no usable semantic matches exist, Career Buddy uses keyword search. Changed, removed or deselected evidence is excluded before sending context; it requires explicit reindexing for new vectors. The local similarity cutoff is a retrieval heuristic, not a confidence or fit score. Original files remain unchanged; extracted text and vectors are stored in local SQLite. Only selected excerpts go to the configured chat provider when you send a message. External embedding providers are not used for query embeddings in this release. The library search box still filters names, notes and types rather than file contents.

Text extraction is limited to 300,000 characters per file, the first eighty PDF pages, and twenty XML parts in DOCX. A worker has a time/memory limit. Scanned PDFs need OCR before use. Locked/broken files, images and legacy `.doc` files are reported as unreadable/unsupported; their originals remain stored. Word images and layout are not read. Previously prepared files are checked against their current bytes when used again.

Job descriptions describe requirements. They do not establish the candidate's experience. Career Buddy is instructed to separate supported achievements from gaps, cite supplied sources, and avoid inventing facts. Model output still needs human review.

## Use an opportunity chat

Open an opportunity → **Career Buddy**. The presets prepare editable prompts for:

- Am I a good fit?
- What salary should I ask for?
- Which skills should I highlight?
- Tailor my CV.
- Tailor a cover letter.

Write a free message such as “Had the second interview today — they mentioned lack of Databricks experience.” Career Buddy proposes a dated interview and its feedback. Review/edit the date, type, status and notes, then choose **Apply reviewed changes**. Date-only entries remain date-only, with no invented exact time. The opportunity's stage/outcome changes only through an explicit reviewed proposal or normal editing.

Proposals are tied to the opportunity revision they used. A later edit makes an unapplied proposal stale; ask for a new proposal using the latest record. Applying the same saved proposal twice cannot duplicate an interview. Advice/drafting presets cannot include record edits. Replies and applied changes persist across browser/container restarts.

## Tailor documents

Select a readable source CV or candidate evidence before drafting. A JD alone is insufficient. Career Buddy returns an editable Markdown draft; review wording and factual support in the chat editor. **Save Word draft to Documents** creates a separate `.docx` version with draft status and generation/source metadata. Re-saving identical content returns the existing version; saving edited content creates another version. Existing submitted files remain immutable. **Download text** exports the editable Markdown.

Word export uses a simple A4 layout with a title, headings and bullets. It does not reproduce a source template's tables, fonts or two-page layout automatically. PDF export, built-in layouts and marked-template preservation are available in [Document Studio](DOCUMENT_STUDIO.md) after saving a Word draft. Arbitrary template fidelity and native Google Docs editing remain future work. Render/check the actual file before application use. The app does not automatically approve a document.

## Salary and data boundaries

Salary answers use saved information and model knowledge. There is no live market search; estimates should state assumptions, currency and base/total/contract terms rather than claim a verified benchmark.

Selected context is sent from the hosting machine to the configured API when you press Send. Provider retention, account permissions and usage charges follow that provider/account's terms. No API key is sent as model context. Model generation calls have a two-minute deadline; model listing has a 15-second deadline. Responses are bounded, TLS is verified, and redirects are not followed. Listing returns at most 1,000 models from one provider page and indicates when more are available. Custom/local URLs are deliberate host configuration, not addresses selected by model output. Public APIs require HTTPS; local/private IPs and hostnames that resolve exclusively to private network addresses can use HTTP. Hostname addresses are checked when connecting, so settings can also be saved while the server is offline.

Private SQLite state contains the provider key, chat history and extracted text. Record exports include chats and public provider settings, but exclude API keys, private image bytes and extracted text caches. Full private backups include keys, conversations, extracted text and managed documents; keep them private like credentials.

## API references

Adapters follow [OpenAI Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Claude Messages structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Gemini generation configuration](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig), and [Ollama Chat](https://docs.ollama.com/api/chat). Model discovery uses the providers' model-list endpoints. Model availability and structured-output support depend on the chosen provider/model.


### Local semantic indexing

Select **Built-in local · MiniLM** in embedding Settings, then open the Career Library’s **Semantic indexing** panel. Choose sources and click **Index selected sources**. This prepares text locally when needed and saves 384-dimensional vectors in the board’s SQLite database; it sends nothing to an external provider. A single job runs at a time (up to 10,000 selected sources per job). Cancel takes effect after the current batch; unfinished documents publish no partial vectors. Retry unfinished sources explicitly after cancellation, errors or restart. Use Refresh status after adding/changing files or changing vault selections. To remove all vectors without deleting files or prepared text, use Clear vectors. Unchecking the job source picker only changes the next job; deselecting a vault source in the vault settings deletes its prepared text and vectors. Career Buddy uses these vectors only when the source is selected for a conversation; no unselected library or vault content is added by semantic search.


### Criteria-based fit assessments

In Settings, add concrete Opportunity criteria, label each Required or Preferred, and Save criteria. Include explicit currency/base salary, acceptable locations, working arrangements, role types or exclusions as relevant. Configure and enable the separate Decision model using any supported chat provider; it does not inherit Career Buddy's key or require Career Buddy chat to be enabled. Its Test connection checks API model listing, not assessment quality.

Open an opportunity's Fit assessment tab, review the saved criteria, optionally select evidence, then Assess against my criteria. Only that opportunity, criteria and selected excerpts are supplied. Results are advisory and show met/unmet/unknown, evidence names, questions and proceed/consider/do-not-proceed/insufficient-information. No percentage fit or confidence score is invented. Required unmet/unknown facts cannot yield proceed. The user still controls proceeding, ignoring or deferring the opportunity. Refresh after changing inputs to see out-of-date labels; each historical result keeps its original criteria. Scanned/unreadable sources need extraction/OCR first. Model reasoning and cited claims still need human review.


### Standalone Career Buddy

Open Career Buddy in the sidebar and describe what you need; Buddy now infers coaching, STAR development, recruiter intake, updates or master-CV work. This uses Career Buddy settings (independent of the decision model). Select supporting library evidence explicitly; conversation history is now unified across prior modes. Start with a short project/achievement description; STAR mode asks for missing facts and can propose a story, CV bullet and cover-letter highlight. Review its facts before saving the draft to the library. Nothing is automatically added to a CV or cover letter.

Paste recruiter emails, notes or transcript text for intake. Confirm employer, role and dates in the proposed opportunity/action items before clicking Create opportunity and action items. Unknown due dates remain blank. For rejection/interview/other updates, choose the exact opportunity. Leaving it unselected prompts clarification; no update proposal can be applied without an explicit target. Review and confirm changes, or ask Buddy to correct its proposal. Stale opportunity revisions require a fresh proposal. Repeated saves do not create duplicate records. Coaching is career-focused and intended to be encouraging but candid; unsupported claims and fabricated impact metrics are forbidden by its prompt. Live AI outputs still need review.


### Codex through the board host

Choose Codex · local CLI in Career Buddy settings, select the default or manually enter an available Codex model ID, then save. No API key or endpoint is needed for this provider. The host must have Codex CLI installed and signed in with ChatGPT. The board launcher manages the helper; restart using the launcher after signing in. The helper runs locally but inference is remote at OpenAI, using your Codex account limits. Submitted messages and selected excerpts are supplied as context; the helper does not receive your document roots or database. Credentials remain on the host. The same reviewed proposal rules apply. The model picker queries the host CLI catalogue and shows its visible entries, plus Codex default. Refresh models fetches the catalogue again. Account/model access is checked when a request runs; a catalogue listing is not an entitlement guarantee. Hidden/internal models and model instructions are excluded. Manual IDs remain available if discovery is unsupported or the helper is busy. Codex has a five-minute request limit; this does not extend other providers’ timeouts.


### Updated conversational workflow

Use the standalone Buddy page naturally; manual modes have been removed from the UI. Select the exact related opportunity when proposing an update, or leave it unselected so Buddy asks for clarification. All prior standalone modes appear in one history; Load earlier history retrieves older turns. Failed requests preserve your message for retry.

Check Use career library to automatically retrieve relevant library/vault excerpts, or leave it off and work from your message/uploads. Upload supported documents or a CV template (five per message, 5 MB each), inspect extraction previews and warnings, and exclude files before sending if needed. Files remain selected for follow-ups until excluded. Stored chat attachments can be downloaded, reused or deleted; deletion removes originals/extraction, not text already present in chat history or prior backups. Files are never automatically indexed as career evidence.

Ask for a master CV from scratch or based on an uploaded/selected template. Buddy should ask about missing facts. Review the proposal, save it as a draft, and download its Word document. Only template text/headings/structure are reused; visual layout fidelity requires future work. The template picker searches tracked documents by name/configured folder; it is not a general host-file browser. Document connections now supports read-only server-folder browsing and Google Docs OAuth/search/import; see [setup instructions](DOCUMENT_CONNECTIONS.md). Selected folder files become available in-place; imported Google Docs become local draft Word snapshots.

New or changed opportunities are automatically tagged/reviewed when a model is enabled; the saved criteria profile is reused without choosing criteria per opportunity. Missing criteria/model results in a visible skipped state. Review progress or retry in Fit assessment. Automatic tags may add a revision, so stale editors must reload rather than overwrite newer data. Automatic reviews do not proceed/ignore/reject opportunities.


### Finding and starting conversations

Use Chat history beside the active conversation to search saved titles or choose an earlier chat. New conversation starts a separate model context; its title comes from the first submitted message. Existing messages from before this feature remain under Earlier chat history. The current chat has a scrollable message panel and scoped Load earlier history. Expand Sources, attachments and related opportunity when needed. Switching chats preserves unsent text within the current page, and resets library/template/attachment/target selections; browser reload does not preserve unsent drafts. On narrow screens, the collapsible history panel stacks above the chat. Opportunity-specific chats remain with their opportunities.


### Progress, cancellation and request limits

While standalone Buddy is working, the status line shows source preparation, provider waiting/response reading or Codex queued/running, plus elapsed time. These are stages: answers are still returned in full. Cancel request stops waiting and signals the transport/helper; a cancelled result cannot be saved as a new proposal. Your submitted text remains in history and the composer for explicit Retry. Closing the browser connection requests cancellation as well. Provider-side compute/usage is not guaranteed to stop when an HTTP connection closes.

Expand Request limits under the chat or decision model settings to configure AI response timeout (30–900 seconds), HTTP output tokens (512–8000) and source context characters (4000–36000). Save to persist changes. Connection testing uses the shown values. Existing unsaved defaults remain 120 seconds for HTTP or 300 for Codex. Context preparation may precede the provider timeout; reducing source/output budgets can help local models. The response-token setting does not control Codex CLI output. Manual opportunity/decision and background-review cancellation controls remain a separate follow-up.


### Career document categories

Use **Filter document category** in Career Library or an opportunity’s Documents tab. Categorise on upload, use the per-document Category selector, or select library files and apply a category to the batch (up to 500). This labels the purpose of a file; it does not move it, change its type/status, alter its contents or approve it. Bulk changes require all selected revisions to match; reload after a conflict. Submitted bytes remain preserved even when their category metadata changes.

Old documents get conservative defaults: known generated master CVs use Master CV, CVs linked to opportunities use Tailored CV, and other CVs use General CV. Filename guesses are not applied. Templates are excluded from automatic Buddy/fit evidence selection; choose them explicitly in the template picker for structure. Reclassifying does not delete extracted text/vectors. Custom category creation and category-driven background indexing are not implemented.
