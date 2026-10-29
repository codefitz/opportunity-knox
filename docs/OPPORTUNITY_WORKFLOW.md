# Opportunity workflow

## Application route

Set **Application route** when creating an opportunity or in Overview: for example employer portal, recruiter or email. It appears in Summary and exports. Existing notes are preserved and are not automatically reinterpreted. A submitted application pack retains its separately recorded route; editing the opportunity does not rewrite that receipt.

## Your review decision

Fit assessment includes your own strengths, gaps, proceed/ignore/defer decision and reason, independently of Career Buddy’s recommendation. A decision requires a reason. Dates are recorded automatically when left blank and can be corrected; input uses the device timezone and display uses the workspace timezone. Earlier review snapshots and timeline entries are retained.

By default, Save review only records your decision. Explicitly select **Also update the workflow stage** to move Proceed to CV & cover letter, Ignore to the Ignored outcome, or Defer to Review. This uses the review effective date and preserves earlier stage visits. Reopen a closed opportunity in Overview before asking a review to move it. A later manual stage change does not rewrite the earlier review.

## Offers

Use the **Offers** tab to add initial or revised offers, including compensation/package, terms/conditions, contact, offer date, response deadline and proposed start date. Link exact versions of opportunity documents after adding them in Documents; unlinking preserves originals. Up to 30 distinct documents can be linked per offer. Removed originals remain labelled unavailable on historical/current links.

Each offer has its own pending, accepted, declined, withdrawn-by-employer or expired decision, decision date and optional reason/notes. Offer/decision dates default to the current time; explicit decisions cannot predate their offer. Edits retain previous complete snapshots, including linked IDs. Multiple offers remain separate so a revised package need not overwrite an earlier one. New-offer submission has a retry identifier to prevent duplicate saves.

Recording or accepting an offer never changes stage, closes the opportunity or increases the hired count. Record **Hired** separately through Overview when appropriate. These controls record events; they do not send an acceptance, decline, email or other external communication.

Pending offers with a response due date appear in the dashboard and to-do action queues in date order. Recording a response or a closed opportunity outcome removes that pending action. Expiry is a recorded decision, not an automatic clock-based status change.

Timeline and Summary include review/offer events and current decisions. Metadata and histories persist in SQLite, record exports and full backups; file bytes require a full backup. Existing records need no migration. Manual workflow saves require the current opportunity revision, preserve existing data and do not launch AI requests. Career Buddy’s existing context can read the saved opportunity; it does not get new review/offer mutation tools in this release.
