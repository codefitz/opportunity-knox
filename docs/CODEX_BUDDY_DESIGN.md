# Proposed Codex provider for Career Buddy

Status: implemented after explicit user authorization on 28 October 2026. Fictional live checks passed through the host’s signed-in Codex CLI. No personal career documents were used for verification.

## User experience

Offer “Codex · local CLI” alongside the existing Career Buddy providers. Reuse the host CLI’s saved sign-in, without a separate API key or copying sign-in credentials into Docker. Before activation, explain that the helper runs locally but the selected messages and source excerpts are sent to OpenAI for inference and use the account’s Codex limits. The user must authorize that destination. Support the CLI’s default model, explicit model IDs and visible entries from the host CLI catalogue. Discovery is implemented and verified against the installed CLI; it does not guarantee account entitlement.

## Connection

Use a private request/response queue in the existing local application-state mount, avoiding a newly exposed network service. The host launcher starts/stops a worker with the board. Each request has a unique ID, expiry, bounded context and fixed response schema. Temporary request/response material is deleted after completion or timeout. Cold startup, missing sign-in, account limits and timeouts must have distinct user-facing errors. A five-minute bounded request deadline is used for Codex; it does not change other providers’ current two-minute timeout.

Invoke the CLI in a fresh temporary directory with ephemeral sessions, read-only permissions, no user configuration, and shell/apps/plugins/memory/web capabilities disabled where supported. Do not supply application databases or document roots to Codex, and do not allow it to apply record changes directly. Validate returned JSON through the existing Career Buddy path; application changes still require review and confirmation. Verify the installed CLI’s supported configuration and actual tool isolation before enabling it.

## Verification and remaining work

Test queue isolation, stale/expired jobs, worker lifecycle and cancellation, schema validation, sign-in errors and secret-safe exports using fictional data and a simulated CLI. Then test a single explicitly authorized fictional live request before activation. Preserve existing board data and provider choices; do not automatically select Codex or process personal documents. No live request is part of this design update.

## References

- https://learn.chatgpt.com/docs/non-interactive-mode — scripted execution, saved CLI authentication, read-only execution, ephemeral sessions and structured output.
- Installed CLI inspected: codex-cli 0.164.0; reports ChatGPT sign-in. Account availability and limits have not been tested by making a model request.
