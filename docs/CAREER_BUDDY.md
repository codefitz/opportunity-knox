# Career Buddy

Career Buddy is optional. It reads the current opportunity and the career documents you select, and can propose changes or draft application documents. It does not submit applications, send communications or overwrite source/submitted documents.

## Connect a provider

1. Open **Settings → Career Buddy**.
2. Choose **OpenAI**, **Claude**, **Gemini**, **Ollama** or **Custom (OpenAI compatible)**.
3. Enter an exact model ID available to your account or Ollama server. Models are not installed or selected automatically.
4. Add an API key for cloud providers. Ollama and custom servers can use a key if their gateway requires one.
5. For Ollama/custom, enter the API base URL. Custom means an OpenAI-compatible `/chat/completions` API, usually with a `/v1` base path. Other arbitrary HTTP protocols are not supported.
6. Enable and save Career Buddy. **Test connection** sends a tiny request without career records. It uses the saved model and its normal API allowance.

OpenAI, Claude and Gemini use their official endpoints. The key stays on the host and is not returned to the browser. Leave the key blank to keep an existing key for the same provider/server; changing provider/server clears it unless you enter a replacement. Use Remove stored key to clear it explicitly. Switching Career Buddy off preserves its settings and previous chats.

For an Ollama server on the Docker host, start with `http://host.docker.internal:11434`. The launcher/Compose setup supplies the host mapping, including on Linux. The Ollama service must be reachable from the container: a Linux service bound only to host loopback may need its private host address instead. You can also point at a reachable private Ollama host. A browser device's `localhost` is not the hosting machine. No model downloads or model-service configuration are performed by this app.

JSON schema is the default output mode. If a model rejects it, try JSON mode or Prompt only under Compatibility options. App validation and reviewed changes still apply in every mode. A successful connection test establishes reachability, not the model's reasoning quality.

## Read career evidence

Upload PDF, DOCX, TXT, Markdown, CSV or JSON files into the Career library, or attach them to an opportunity. **Prepare library text** extracts and chunks files locally without any API request. The first chat using an unprepared document also prepares it.

Each chat has a source picker. By default it selects up to twenty supported original library/current-opportunity files, excluding app-generated drafts. Review that selection before sending. Other opportunity document files are excluded. An optional checkbox adds short summaries of up to one hundred other opportunities; it does not send their documents or full histories.

The request includes the current opportunity's JD and recent timeline/interview entries, up to twelve recent chat messages, and selected source excerpts. Local retrieval gives each readable selected document an opening excerpt, then ranks other chunks by words shared with the question and role description, within a 36,000-character source budget. Source coverage on each answer shows which files supplied excerpts, extraction warnings, omitted chunks and any other-opportunity summary count. This is local text retrieval; no embedding model or external vector database is used.

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

Word export uses a simple A4 layout with a title, headings and bullets. It does not reproduce a source template's tables, fonts or two-page layout automatically. PDF export, approved template fidelity and native Google Docs editing remain future work. Render/check the actual file before application use. The app does not automatically approve a document.

## Salary and data boundaries

Salary answers use saved information and model knowledge. There is no live market search; estimates should state assumptions, currency and base/total/contract terms rather than claim a verified benchmark.

Selected context is sent from the hosting machine to the configured API when you press Send. Provider retention, account permissions and usage charges follow that provider/account's terms. No API key is sent as model context. Network calls have a two-minute deadline, bounded responses, verified TLS, and no redirect following. Custom/local URLs are deliberate host configuration, not addresses selected by model output. Remote APIs require HTTPS; local/private IPs and the Docker host name can use HTTP.

Private SQLite state contains the provider key, chat history and extracted text. Record exports include chats and public provider settings, but exclude API keys, private image bytes and extracted text caches. Full private backups include keys, conversations, extracted text and managed documents; keep them private like credentials.

## API references

Adapters follow [OpenAI Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Claude Messages structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Gemini generation configuration](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig), and [Ollama Chat](https://docs.ollama.com/api/chat). Model availability and structured-output support depend on the chosen provider/model.
