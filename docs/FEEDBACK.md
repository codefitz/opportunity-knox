# Feedback

The right-edge **Feedback** button is available throughout the app, including sign-in/loading/error screens. Sign in to submit feedback. The form has a text box, an optional **Also prepare a GitHub issue** checkbox, and **Submit feedback**. It does not display saved history, status controls or export controls.

Submitting always saves the original message, recognised page, time, request ID and Open status privately in the board database first. With the GitHub option unchecked, no AI or GitHub request occurs. The option resets after each successful submission. Unsent text and its original page context survive closing/reopening the modal within the current app session. Reloading does not preserve an unsent draft. Duplicate save retries use the same request ID; a failed save keeps the text.

Selecting the GitHub option authorises Career Buddy to prepare an issue using only this saved feedback and recognised page. No career evidence, other feedback, credentials, browser URLs or opportunity records are included. The enabled Career Buddy provider/model is used. The result is an editable title and Markdown body; no issue is automatically published. Missing details should be labelled rather than invented, but users must review model output.

If AI is disabled, unavailable, invalid or cancelled, the feedback stays saved and a basic issue draft is available for manual editing. **Cancel AI drafting** cancels the local request; closing the dialog also cancels outstanding drafting. Remote work may already have been processed. Issue drafting is recorded in AI Activity with prompt version `feedback-issue-v1`; the draft itself is not added to feedback history.

**Review & submit on GitHub** opens a prefilled draft in the Opportunity Knox repository. GitHub issues may be public; review and submit there. For text too long for a prefilled URL, use **Copy issue text** and paste it into the GitHub draft. The full text stays visible if clipboard access is unavailable.

Saved feedback and historical reviews remain in the backend, full SQLite backups/restores, record exports and authenticated feedback JSON export. Legacy general-purpose AI review/cancel endpoints remain retired (HTTP 410). Backend status changes remain revision-checked. Limits remain 6,000 characters per feedback message and 500 saved entries.
