import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const phrases = {
  "delete-opportunity": "DELETE OPPORTUNITY",
  "clear-opportunities": "CLEAR ALL OPPORTUNITIES",
  "reset-workspace": "RESET WORKSPACE",
};
const labels = {
  records: "Opportunities",
  documents: "Document links",
  tasks: "Tasks",
  buddy_messages: "Opportunity chat messages",
  decision_assessments: "Fit assessments",
  opportunity_automation: "Opportunity automation history",
  buddy_requests: "AI request history",
  ai_tasks: "AI task history",
  document_text: "Prepared document texts",
  document_vectors: "Search index entries",
  standalone_messages: "Career Buddy messages",
  standalone_attachments: "Chat attachments",
  standalone_attachment_originals: "Stored chat attachment originals",
};
export function createWorkspaceActions({
  db,
  getConfig,
  putConfig,
  settings,
  dataDir,
  createBackup,
  otherWrites,
  invalidate,
}) {
  const plans = new Map();
  const tables = Object.keys(labels);
  const rows = (table) =>
    db
      .prepare(`SELECT id,data FROM ${table} ORDER BY id`)
      .all()
      .map((row) => ({ ...row, value: JSON.parse(row.data) }));
  const fingerprint = () => {
    const hash = createHash("sha256");
    for (const table of [...tables, "config"])
      hash.update(
        JSON.stringify([
          table,
          db
            .prepare(
              `SELECT * FROM ${table} ORDER BY ${table === "config" ? "key" : "id"}`,
            )
            .all(),
        ]),
      );
    return hash.digest("hex");
  };
  function idle() {
    if (otherWrites())
      fail(
        409,
        "Another change is still saving. Wait for it to finish, then review again.",
      );
    if (
      [
        "pending-restart.json",
        "pending-maintenance.json",
        "pending-storage.json",
        "pending-vault.json",
        "pending-sources.json",
      ].some((name) => existsSync(join(dataDir, name)))
    )
      fail(
        409,
        "Finish pending restart, storage or connection changes before continuing.",
      );
    if (
      rows("buddy_requests").some((r) => !r.value.finishedAt) ||
      rows("ai_tasks").some((r) =>
        ["queued", "running", "cancelling"].includes(r.value.status),
      ) ||
      rows("opportunity_automation").some((r) =>
        ["queued", "running", "cancelling"].includes(r.value.state),
      ) ||
      ["running", "cancelling"].includes(getConfig("vectorIndexJob")?.status)
    )
      fail(
        409,
        "Finish or cancel AI requests, queued tasks and indexing before continuing.",
      );
  }
  function selection(action, opportunityId) {
    const reset = action === "reset-workspace",
      records = rows("records");
    if (
      action === "delete-opportunity" &&
      !records.some((r) => r.id === opportunityId)
    )
      fail(404, "Opportunity not found.");
    const ids = new Set(
      records
        .filter(
          (r) => action !== "delete-opportunity" || r.id === opportunityId,
        )
        .map((r) => r.id),
    );
    if (!reset && !ids.size) fail(400, "There are no opportunities to clear.");
    const documents = rows("documents").filter(
        (r) => reset || ids.has(r.value.opportunityId),
      ),
      docIds = new Set(documents.map((r) => r.id));
    const chosen = {};
    for (const table of tables) {
      chosen[table] = rows(table).filter((row) => {
        if (reset) return true;
        if (["records", "opportunity_automation"].includes(table))
          return ids.has(row.id);
        if (["documents", "document_text", "document_vectors"].includes(table))
          return docIds.has(row.id);
        if (table === "buddy_requests") {
          const [scope, id] = String(row.value.conversationId || "").split(":");
          return (
            ["opportunity", "automation", "decision", "summary"].includes(
              scope,
            ) && ids.has(id)
          );
        }
        if (table === "ai_tasks")
          return (
            ids.has(row.value.targetId) ||
            ids.has(row.value.payload?.opportunityId)
          );
        return (
          ["tasks", "buddy_messages", "decision_assessments"].includes(table) &&
          ids.has(row.value.opportunityId)
        );
      });
    }
    const configs = db
      .prepare("SELECT key FROM config ORDER BY key")
      .all()
      .map((r) => r.key)
      .filter((key) =>
        reset
          ? ![
              "profile",
              "auth",
              "sessions",
              "settings",
              "uploadWorkspaceId",
            ].includes(key)
          : [...ids].some((id) => key === "opportunitySummary:" + id),
      );
    return {
      chosen,
      configs,
      documentIds: [...docIds],
      subject:
        action === "delete-opportunity"
          ? `${records.find((r) => r.id === opportunityId).value.company} — ${records.find((r) => r.id === opportunityId).value.role}`
          : reset
            ? "Entire workspace"
            : "All opportunities, including completed and filtered-out records",
    };
  }
  return {
    async handle(path, method, req, res, { json, readBody }) {
      if (!path.startsWith("/api/workspace-actions/")) return false;
      if (
        method !== "POST" ||
        ![
          "/api/workspace-actions/preview",
          "/api/workspace-actions/apply",
        ].includes(path)
      )
        fail(405, "Use Preview or Confirm.");
      const body = await readBody(req);
      idle();
      for (const [id, plan] of plans)
        if (plan.expiresAt < Date.now()) plans.delete(id);
      if (path.endsWith("/preview")) {
        if (!Object.hasOwn(phrases, body.action))
          fail(400, "Choose a supported workspace action.");
        const picked = selection(body.action, body.opportunityId);
        const plan = {
          action: body.action,
          opportunityId: body.opportunityId,
          fingerprint: fingerprint(),
          expiresAt: Date.now() + 10 * 60 * 1000,
        };
        const planId = randomUUID();
        if (plans.size >= 20) plans.delete(plans.keys().next().value);
        plans.set(planId, plan);
        const counts = Object.entries(picked.chosen)
          .map(([table, items]) => ({
            label: labels[table],
            count: items.length,
          }))
          .filter((item) => item.count);
        if (body.action === "reset-workspace")
          counts.push({
            label:
              "Saved configuration groups (including credentials, connections and feedback)",
            count: picked.configs.length,
          });
        json(res, {
          planId,
          action: body.action,
          subject: picked.subject,
          phrase: phrases[body.action],
          counts,
          removes:
            body.action === "reset-workspace"
              ? "Opportunities, their history, all tasks, Career Hub links and indexes, conversations, feedback, AI credentials, local connection settings, criteria and preferences. Unsaved forms and old upload queues will no longer be active."
              : (body.action === "clear-opportunities"
                  ? "All opportunities"
                  : "This opportunity") +
                ", including timeline, interviews, offers, application packs, linked tasks, document links, fit assessments and associated AI history.",
          keeps:
            body.action === "reset-workspace"
              ? "Profile name and photo, sign-in, storage folder locations and mounts, existing files and backups. Google/Obsidian originals and remote vector stores are not changed; this clears their local settings only."
              : (body.action === "delete-opportunity"
                  ? "Other opportunities, "
                  : "") +
                "Career Hub, standalone Career Buddy conversations, unlinked tasks, profile and settings. Existing document files and backups stay on disk.",
          backup:
            "A verified private full backup is required and will be created automatically before any records change. It includes credentials and submitted document bytes.",
        });
        return true;
      }
      const plan = plans.get(body.planId);
      if (!plan)
        fail(
          409,
          "The preview expired or was already used. Review the action again.",
        );
      if (body.confirm !== true || body.confirmation !== phrases[plan.action])
        fail(400, "Type the exact confirmation phrase before continuing.");
      if (plan.fingerprint !== fingerprint())
        fail(
          409,
          "The workspace changed after preview. Review the updated action again.",
        );
      const reset = plan.action === "reset-workspace";
      let picked, backup;
      db.exec("BEGIN IMMEDIATE");
      try {
        if (plan.fingerprint !== fingerprint())
          fail(409, "The workspace changed after preview. Review again.");
        picked = selection(plan.action, plan.opportunityId);
        backup = createBackup();
        for (const [table, items] of Object.entries(picked.chosen)) {
          const remove = db.prepare(`DELETE FROM ${table} WHERE id=?`);
          for (const item of items) remove.run(item.id);
        }
        const removeConfig = db.prepare("DELETE FROM config WHERE key=?");
        for (const key of picked.configs) removeConfig.run(key);
        if (reset) {
          const current = settings();
          putConfig(
            "settings",
            Object.fromEntries(
              ["documentsSubdir", "referenceSubdir", "backupSubdir"].map(
                (key) => [key, current[key]],
              ),
            ),
          );
          putConfig("uploadWorkspaceId", randomUUID());
        }
        invalidate({ reset, documentIds: picked.documentIds });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      plans.delete(body.planId);
      res.setHeader("X-Board-Workspace", getConfig("uploadWorkspaceId"));
      json(res, {
        ok: true,
        action: plan.action,
        removedOpportunities: picked.chosen.records.length,
        backup,
      });
      return true;
    },
  };
}
