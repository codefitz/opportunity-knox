# Feedback

The **Feedback** tab on the right edge is available throughout the app, including sign-in/loading/error screens. Sign in before submitting or reading saved entries. It opens a modal with a text box and a Saved feedback inbox.

Submitting saves the original message, recognised page, time, request ID and Open status privately in the board database. It does not send feedback externally by default. Unsent text stays in the current app session when closing/reopening the modal, along with its original page context. Browser reload does not preserve an unsent draft.

Open Saved feedback to review entries, mark them Open/Planned/Done, export JSON or request AI review. Review with Career Buddy uses the enabled provider/model in Career Buddy settings. You can also opt into review after saving. Only that entry’s feedback text and page name are provided; no career library, opportunities, screenshots, browser URLs or credentials are added to the prompt. Suggested priority, improvements and follow-up questions are advisory and never implement changes or mark feedback Done.

AI review has the existing provider response deadline and an explicit Cancel option. Interrupted reviews are retained after restart, not silently retried. Failed/invalid/cancelled reviews do not remove the original feedback. Remote providers may still process work after local cancellation. A review can be requested again explicitly.

Feedback lives in private configuration, participates in full SQLite backups/restores, and is included in record exports. Export feedback JSON is also available independently for later improvement planning. It is not committed to the repository or automatically sent to an external issue tracker. Limits are 6,000 characters per message and 500 saved entries. The inbox initially shows 20 entries, with Show more. Done entries remain part of the history and storage count.
