# Opportunity Board

- Read `docs/PLAN.md` for product intent and `docs/ROADMAP.md` for implementation status.
- Keep routine start/stop and storage configuration behind the launcher and app. Do not require users to edit Docker configuration.
- Keep SQLite state outside cloud-synchronised document folders and outside disposable containers.
- Preserve stage visits, effective dates and their correction history, repeatable interviews, and exact submitted documents.
- Keep AI optional. Never simulate a completed AI task or fabricate career evidence.
- Do not commit personal application records, documents, credentials, runtime configuration, databases, backups, or generated exports. Use clearly fictional test data.
- Run `npm run check` for implementation changes. Test real persistence, conflict handling, path changes, and launcher behaviour where affected.
- Distinguish build/test success from Docker runtime and browser verification. Keep the roadmap honest about unfinished integrations.
