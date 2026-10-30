# AI activity and usage

Open AI activity in the sidebar. New work appears as recorded requests start; it is not a list of all queued/runnable jobs. The page refreshes every five seconds while open. Filter by status, task, provider and rolling period; totals cover the entire filtered result, not only the current 25-row page. Each retry attempt counts separately.

## Coverage and actions

The shared request registry covers opportunity and standalone Buddy chats, CV/cover drafting (including CV output inferred by standalone Buddy), structured fit assessments, automatic tags, saved opportunity summaries, AI/local job intake, feedback reviews and HTTP inference connection tests. Source/model discovery, embedding jobs, local document conversion and a universal scheduler are outside this increment. Queued Codex requests appear after entering the registry; automatic-review children appear when their request starts. Historical operations that were never registered cannot be reconstructed.

Cancel uses the same owned controller as the original request. Cancellation of app transport or a local process does not guarantee remote billing stops. Review & retry opens the relevant opportunity tab, standalone conversation, intake form, feedback inbox or settings. It never sends the old payload from activity. Review the current opportunity, evidence, attachments and settings before explicitly submitting again. Intake failures require source reselection. If an opportunity was removed, its activity remains visible without a live link. Failed standalone user messages have Review message for retry; this restores their text/available attachments, resets target/template/library selections for review, and requires a further send.

## Recorded metadata

New requests record task/action, started/finished timestamps, duration, provider, requested model, reported model when supplied, explicit prompt version and SHA-256 of the actual system prompt. The fingerprint excludes user messages, retrieved excerpts and response contents. Do not treat it as a full conversation/evidence snapshot. Update the call site's prompt version when changing prompt semantics; the fingerprint also distinguishes dynamic system-prompt variants. Earlier records show Not recorded where metadata was unavailable; this is not backfilled by guessing.

Provider usage is accepted only as bounded non-negative integers. OpenAI Responses and compatible chat-completion counts retain cache/reasoning breakdowns without adding those subsets again. Claude total input includes uncached input plus cache reads/writes. Gemini input includes reported tool-use prompt tokens; output includes candidate plus thought tokens. Ollama exposes prompt/evaluation counts and optional cache counts. Streaming snapshots replace rather than accumulate cumulative counters, including split Claude usage fields. Only complete reports with both input and output enter headline token totals; partial and unreported records are counted separately. A failed application-level validation can still have reported provider usage.

Activity is a whitelisted projection of diagnostics: no prompts, live previews, output bodies, API keys or endpoint URLs are added. Successful chat content and failed standalone user messages remain in their existing conversation stores, independently of this metadata log. Exact-ID retries archive the earlier terminal attempt under a unique audit ID and link the new attempt; active duplicate IDs still conflict. Restart interrupts unfinished work without replaying it.

## Optional cost estimates

Expand Configure model rates. Enter the exact requested provider/model, a three-letter currency and input/output prices per million tokens. Model aliases use the configured requested-model rate even if the response reports a different underlying model. Rates apply to newly started requests and require a revision match when saved. Removing/editing a rate never recomputes a historical estimate.

A request with final input/output accounting and a saved rate uses (input tokens × input rate + output tokens × output rate) / 1,000,000. Flat estimates do not apply cache discounts, separate cache-write premiums, tool fees, taxes or service tiers; they are not provider invoices. A failed but fully accounted response can have an estimate. Partial counters, missing usage and missing rates remain unavailable, not free. Aggregate subtotals stay separate by currency and show estimate coverage. Codex account/subscription calls cannot be assigned token rates here and are not priced. The current Codex helper discards its stdout and returns final text only, so its token usage remains unreported.

Request/rate metadata is included in full backups/restores and Settings JSON export. Reading/filtering/exporting activity or editing rates never starts AI work or schedules retries.

## Provider references checked 30 October 2026

- [OpenAI Responses usage](https://developers.openai.com/api/reference/python/resources/responses/methods/create)
- [Claude streaming cumulative usage](https://platform.claude.com/docs/en/build-with-claude/streaming) and [cache input accounting](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#tracking-cache-performance)
- [Gemini UsageMetadata](https://ai.google.dev/api/generate-content#UsageMetadata)
- [Ollama chat statistics](https://docs.ollama.com/api/chat)
