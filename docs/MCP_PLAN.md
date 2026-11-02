# Opportunity Knox MCP integration plan

Date: 2 November 2026. Status: planned; no MCP implementation or client connection is delivered by this document.

## Intended experience

In a compatible chat client: “Find the Engineering Lead opportunity, assess my fit using my career library, and fill in strengths and gaps.” The client finds the opportunity, searches career evidence, reads relevant passages, presents its assessment and saves it when the user requests that action. OpKnox shows the saved review and its date/time. The client performs the reasoning; OpKnox supplies data, validates writes and preserves history.

No saved criteria or manual evidence selection is required. Decision reason remains optional. Writing an assessment must not change the user's decision, workflow stage or outcome. Existing in-app AI remains available independently.

## First delivery: one client, one workflow

- [ ] Choose the first chat client and verify its actual MCP transport, authentication and write-tool support. Do not assume that every desktop or hosted client can reach localhost or launch a local process.
- [ ] Connect read-only opportunity lookup and career evidence search/read.
- [ ] Add one narrow write tool for strengths, gaps and review date/time.
- [ ] Complete a real-client fit review and verify the saved result in OpKnox.

Defer arbitrary opportunity editing, stage changes, application submission, document generation, remote hosting, multi-user support and a general plugin framework. Do not build an MCP client into OpKnox: OpKnox is the MCP server/data owner in this design.

## Connection and implementation choices

Prefer a local stdio adapter for the first client if that client supports it. The client launches the adapter, which talks to the running OpKnox application through authenticated local endpoints. Keep the application as the sole owner of database writes; do not open the live database from a second independent application instance. Use an official maintained MCP SDK rather than hand-writing JSON-RPC and protocol negotiation; verify its current Node compatibility before adding it.

If the selected client requires Streamable HTTP, implement that transport instead. Keep local hosting on loopback, validate Origin where applicable, and authenticate access. A hosted client may require a reachable HTTPS endpoint and its supported authorization flow; that is a separate deployment choice, not a reason to expose the local board publicly or add a tunnel automatically. Implement one supported transport first.

Use launcher/app-managed configuration and credentials. Provide enable/disable, credential rotation/revocation and a copyable client configuration with no secrets committed to the repository. A client grant should be bound to the current workspace; reset/restore must not silently retarget existing access. Start with read access, and make review writing an explicit capability. Do not reuse a browser password or require manual Docker edits.

Protocol reference: [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports). Recheck the current SDK, specification and selected client's documentation at implementation time.

## Minimal tool contract

Proposed names; finalize against the selected SDK and client.

| Tool | Inputs | Result / boundaries |
| --- | --- | --- |
| `search_opportunities` | Query, optional stage, bounded limit/cursor | IDs, company, role, stage, updated date and revision; paginated summaries. |
| `get_opportunity` | Opportunity ID | Role description, existing review, revision and canonical identity; exclude unrelated records and credentials. |
| `search_career_evidence` | Opportunity ID, query, bounded limit/cursor | Ranked excerpts with document IDs, passage references, freshness and retrieval limitations; reusable library plus evidence linked to this opportunity. |
| `read_career_evidence` | Document ID, bounded passage/range | Prepared text and source metadata; enforce the same eligibility and workspace scope as search. Never accept arbitrary filesystem paths. |
| `save_fit_review` | Opportunity ID, expected revision, strengths, gaps, optional review timestamp, evidence references, request ID | Validated saved review and new opportunity revision; server timestamp if omitted; preserve decision/reason, stage, outcome and prior review history. |

Search results should be small and useful. Let the model request more evidence when needed rather than sending the entire career library. Reuse existing preparation caches, keyword/vector retrieval and source freshness checks. Return explicit empty/unavailable/partial results; never imply a document was read when it was not. Keep templates and generated drafts distinguishable from candidate evidence, and do not treat job requirements as proof of candidate experience.

## Implementation sequence

### 1. Reuse application operations

- [ ] Inspect `server/app.mjs`, `server/career-buddy.mjs`, `server/vector-index.mjs`, `server/decision-review.mjs` and `server/opportunity-workflow.mjs` against the current checkout.
- [ ] Reuse existing opportunity reads, prepared document text and retrieval. Extract only small shared functions where the MCP path cannot otherwise reuse application logic safely.
- [ ] Reuse the review validation/save operation so revision conflicts, dates, history and timeline events behave exactly as they do in the UI.
- [ ] Add narrowly scoped authenticated endpoints only where the adapter needs them. Avoid a second backend, generic repository layer or broad API rewrite.

### 2. Ship read access

- [ ] Implement initialization, tool discovery and the four read tools with bounded schemas/results.
- [ ] Return stable IDs and evidence references suitable for citation in chat.
- [ ] Handle board unavailable, revoked access, missing/deleted documents and stale prepared text with actionable errors.
- [ ] Connect the first client and inspect a fictional opportunity with fictional evidence before using personal records.

### 3. Save the fit review

- [ ] Implement `save_fit_review` without making an LLM call in OpKnox. The chat client supplies the completed assessment.
- [ ] Validate text lengths, timestamps, source scope and expected opportunity revision. Reject unknown fields, invalid source references and conflicting writes without partial mutation.
- [ ] Record client/source provenance and evidence references alongside normal review history using the smallest existing suitable structure. Do not invent token usage or model identity when the client does not provide trustworthy metadata.
- [ ] Make repeated identical request IDs safe to retry after a lost response; reject a reused ID with different content. Bind this to workspace and caller identity.
- [ ] Describe the write action clearly to the client. Rely on the user's explicit request and supported client confirmation controls; do not require a second bespoke approval workflow for every ordinary save. Never rely solely on a tool annotation for authorization.
- [ ] Refresh/reopen the board review and confirm strengths, gaps and timestamp are visible and editable.

### 4. Package and document

- [ ] Add launcher-managed lifecycle/configuration, a short connection guide and one example fit-review prompt.
- [ ] Document exactly which client/version was tested, access granted, data sent to that client's model provider and how to disconnect.
- [ ] Keep protocol stdout clean for stdio; use secret-safe stderr diagnostics. Do not log document contents, prompts, passwords or access tokens.
- [ ] Add the delivered scope and actual verification to the roadmap; keep unsupported clients and remote deployment explicitly pending.

## Cancellation, progress and latency

Keep MCP tools focused on short data operations. Long model reasoning belongs to the chat client, where the user can see its progress and cancel it. MCP does not inherently make inference faster or inherit this app's existing conversations, memory or connector access. Preserve bounded server-side deadlines for stuck reads/preparation and return useful errors. For HTTP, do not equate a disconnected connection with an explicit cancellation. A committed write must remain committed and discoverable after a lost response; idempotent retry recovers it.

The observed 300-second fit timeout was model/bridge waiting, with roughly 0.31 seconds of local preparation. It motivates moving orchestration to the client, but is not evidence that MCP will eliminate provider delays.

## Acceptance checks

- [ ] Tool discovery and a complete read/search/read/save sequence work in the chosen real client.
- [ ] A role with no saved criteria produces a useful assessment using automatically found evidence; missing evidence is stated as unknown.
- [ ] Saved strengths, gaps and review date/time survive app restart and remain editable; earlier review history is retained.
- [ ] Existing decision, optional reason, stage and outcome remain unchanged.
- [ ] A simultaneous board edit causes a clear revision conflict; no existing text is silently overwritten.
- [ ] Duplicate save after a lost response creates one review revision/event, not two.
- [ ] Read-only access cannot write; revoked credentials, workspace reset and cross-opportunity document access are rejected.
- [ ] Malformed/oversized input, deleted evidence, stale text and malicious instructions inside documents do not bypass validation or permissions.
- [ ] Cancellation and unavailable-board errors are visible; no completed result is fabricated.
- [ ] Fictional-data automated tests and `npm run check` pass. Record automated, Docker/runtime and real-client evidence separately.

## Resume here

Choose the first client, verify its supported connection method, then implement the read tools before review writing. Suggested next instruction: “Implement phase 1 of docs/MCP_PLAN.md for [client], using the simplest supported local connection.”
