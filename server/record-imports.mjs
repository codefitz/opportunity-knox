import { createHash, randomUUID } from "node:crypto";
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const stages = [
  "identification",
  "review",
  "documents",
  "application-review",
  "submitted",
  "interviews",
  "final-interview",
  "outcome",
];
const outcomes = ["", "hired", "rejected", "ignored", "withdrawn", "closed"];
export const importFields = [
  "company",
  "role",
  "url",
  "jobReference",
  "applicationRoute",
  "location",
  "workMode",
  "salary",
  "employmentType",
  "contact",
  "deadline",
  "description",
  "nextAction",
  "nextActionDate",
  "priority",
  "tags",
];
const stable = (v) =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, stable(v[k])]),
        )
      : v;
const hash = (v) =>
  createHash("sha256")
    .update(JSON.stringify(stable(v)))
    .digest("hex");
const text = (v, label, max = 10000) => {
  if (typeof v !== "string" || v.length > max || v.includes("\0"))
    fail(400, label + " must be text up to " + max + " characters.");
  return v.trim();
};
const list = (v, label, max = 10000) => {
  if (!Array.isArray(v) || v.length > max)
    fail(400, label + " must be a list of up to " + max + " items.");
  return v;
};
const object = (v, label) => {
  if (!v || Array.isArray(v) || typeof v !== "object")
    fail(400, label + " must be an object.");
  return v;
};
function date(v, label, optional = true) {
  if (optional && v === "") return "";
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    fail(400, label + " must be a valid calendar date.");
  return v;
}
function instant(v, label) {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    fail(400, label + " must be a timestamp.");
  date(v.slice(0, 10), label, false);
  return v;
}
function effective(value, label) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? date(value, label, false)
    : instant(value, label);
}
function choice(v, values, label) {
  if (!values.includes(v)) fail(400, "Invalid " + label + ".");
  return v;
}
function url(v) {
  const value = text(v, "Job URL", 4000);
  if (value) {
    let u;
    try {
      u = new URL(value);
    } catch {
      fail(400, "Use a complete job URL.");
    }
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      fail(400, "Use an http or https job URL without credentials.");
  }
  return value;
}
const normalized = (v) =>
  String(v || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function comparableURL(value) {
  if (!value) return "";
  try {
    const u = new URL(value);
    u.hash = "";
    for (const key of [...u.searchParams.keys()])
      if (/^utm_/i.test(key) || ["trk", "trackingId", "refId"].includes(key))
        u.searchParams.delete(key);
    u.searchParams.sort();
    u.pathname = u.pathname.replace(/\/$/, "") || "/";
    return u.toString();
  } catch {
    return "";
  }
}
const coreHash = (r) =>
  hash(
    Object.fromEntries(
      [...importFields, "stage", "outcome"].map((k) => [
        k,
        r[k] ?? (k === "tags" ? [] : ""),
      ]),
    ),
  );
function historyJSON(v, label, max = 1500000) {
  const raw = JSON.stringify(v);
  if (raw.length > max) fail(400, label + " is too large.");
  function walk(x, depth = 0) {
    if (depth > 15) fail(400, label + " is nested too deeply.");
    if (x && typeof x === "object")
      for (const [k, v] of Object.entries(x)) {
        if (["__proto__", "constructor", "prototype"].includes(k))
          fail(400, "Unsupported history key.");
        walk(v, depth + 1);
      }
  }
  walk(v);
  return structuredClone(v);
}
export function normalizeImportRecord(source, when) {
  object(source, "Opportunity");
  const r = {};
  for (const key of importFields.filter(
    (k) => !["tags", "priority"].includes(k),
  ))
    r[key] = text(
      source[key] ?? "",
      key,
      key === "description" ? 200000 : 10000,
    );
  if (!r.company || !r.role)
    fail(400, "Every opportunity needs an employer and role.");
  r.url = url(r.url);
  date(r.deadline, "Deadline");
  date(r.nextActionDate, "Next action date");
  r.priority = choice(
    source.priority ?? "normal",
    ["low", "normal", "high"],
    "priority",
  );
  r.tags = [
    ...new Set(
      list(source.tags ?? [], "Tags", 30).map((t) => text(t, "Tag", 100)),
    ),
  ];
  r.stage = choice(source.stage ?? "identification", stages, "stage");
  r.outcome = choice(source.outcome ?? "", outcomes, "outcome");
  if (r.outcome) r.stage = "outcome";
  if (r.stage === "outcome" && !r.outcome)
    fail(400, "An outcome stage needs a recorded outcome.");
  r.createdAt = source.createdAt
    ? instant(source.createdAt, "Created date")
    : when;
  r.updatedAt = when;
  r.revision = 1;
  r.id = randomUUID();
  r.events = list(source.events ?? [], "Timeline").map((e) => {
    object(e, "Timeline event");
    return {
      id: randomUUID(),
      stage: choice(e.stage, stages, "timeline stage"),
      note: text(e.note ?? "", "Timeline note", 50000),
      title: text(e.title ?? "", "Timeline title", 500),
      effectiveAt: effective(e.effectiveAt, "Event date"),
      recordedAt: e.recordedAt ? instant(e.recordedAt, "Recorded date") : when,
      corrections: historyJSON(
        list(e.corrections ?? [], "Date corrections"),
        "Date corrections",
      ),
    };
  });
  if (
    r.stage !== "identification" &&
    !source.stageEnteredAt &&
    !r.events.some((e) => e.stage === r.stage)
  )
    fail(
      400,
      "Provide a stageEnteredAt date or a dated timeline entry for the current historical stage. The importer will not invent submission, interview or outcome dates.",
    );
  if (!r.events.length)
    r.events.push({
      id: randomUUID(),
      stage: r.stage,
      note: text(
        source.note ??
          "Historical record imported; no original timeline supplied.",
        "Import note",
        50000,
      ),
      effectiveAt: source.stageEnteredAt
        ? effective(source.stageEnteredAt, "Stage entry")
        : r.createdAt,
      recordedAt: when,
      corrections: [],
    });
  const currentIndex = source.currentStageEventId
    ? (source.events || []).findIndex(
        (e) => e.id === source.currentStageEventId,
      )
    : -1;
  const current =
    currentIndex >= 0 && r.events[currentIndex]?.stage === r.stage
      ? r.events[currentIndex]
      : [...r.events].reverse().find((e) => e.stage === r.stage);
  r.currentStageEventId = current?.id;
  r.stageEnteredAt = source.stageEnteredAt
    ? effective(source.stageEnteredAt, "Stage entry")
    : current?.effectiveAt || r.createdAt;
  r.activities = list(
    source.activities ?? [],
    "Communications and interviews",
  ).map((a) => {
    object(a, "Activity");
    const v = {
      id: randomUUID(),
      kind: choice(a.kind, ["interview", "communication"], "activity kind"),
      type: text(a.type ?? "other", "Activity type", 100),
      title: text(a.title, "Activity title", 50000),
      notes: text(a.notes ?? "", "Activity notes", 50000),
      contact: text(a.contact ?? "", "Contact", 50000),
      scheduledAt: a.scheduledAt
        ? /^\d{4}-\d{2}-\d{2}$/.test(a.scheduledAt)
          ? date(a.scheduledAt, "Scheduled date")
          : instant(a.scheduledAt, "Scheduled date")
        : "",
      status: choice(
        a.status ?? "completed",
        ["planned", "rescheduled", "completed", "cancelled"],
        "activity status",
      ),
      createdAt: a.createdAt ? instant(a.createdAt, "Activity created") : when,
      direction: choice(
        a.direction ?? "",
        ["", "incoming", "outgoing"],
        "direction",
      ),
      channel: text(a.channel ?? "", "Channel", 10000),
      followUp: text(a.followUp ?? "", "Follow-up", 50000),
      followUpDate: date(a.followUpDate ?? "", "Follow-up date"),
      followUpDone: a.followUpDone ?? false,
      isFinal: a.isFinal ?? false,
      documentIds: [],
      history: historyJSON(
        list(a.history ?? [], "Activity revisions"),
        "Activity revisions",
      ),
    };
    if (
      typeof v.followUpDone !== "boolean" ||
      typeof v.isFinal !== "boolean" ||
      !v.title ||
      (v.followUpDate && !v.followUp)
    )
      fail(400, "Invalid activity or follow-up.");
    return v;
  });
  return r;
}
function eventHash(v) {
  return hash({
    stage: v.stage,
    note: v.note || "",
    title: v.title || "",
    effectiveAt: v.effectiveAt,
    corrections: v.corrections || [],
  });
}
function activityHash(v) {
  return hash(
    Object.fromEntries(
      [
        "kind",
        "type",
        "title",
        "scheduledAt",
        "status",
        "notes",
        "contact",
        "direction",
        "channel",
        "followUp",
        "followUpDate",
        "followUpDone",
        "isFinal",
        "history",
      ].map((k) => [
        k,
        v[k] ??
          (k === "history"
            ? []
            : ["followUpDone", "isFinal"].includes(k)
              ? false
              : ""),
      ]),
    ),
  );
}
export function createRecordImports(ctx) {
  const prefix = "recordImport:";
  const plans = () =>
    ctx.db
      .prepare("SELECT data FROM config WHERE key LIKE 'recordImport:%'")
      .all()
      .map((r) => JSON.parse(r.data));
  const snapshot = () =>
    hash({
      records: ctx.listRecords().sort((a, b) => a.id.localeCompare(b.id)),
      documents: ctx.getDocuments().sort((a, b) => a.id.localeCompare(b.id)),
      tasks: ctx.listTasks().sort((a, b) => a.id.localeCompare(b.id)),
    });
  function preview(source, label) {
    object(source, "Import file");
    if (
      source.format &&
      !["opportunity-board-records", "opportunity-knox-historical"].includes(
        source.format,
      )
    )
      fail(400, "Choose a record export or historical-record JSON template.");
    if (source.version !== undefined && source.version !== 1)
      fail(400, "Unsupported record export version.");
    const originals = list(source.opportunities, "Opportunities", 1000);
    if (!originals.length) fail(400, "The file contains no opportunities.");
    const when = new Date().toISOString(),
      rows = originals.map((s, index) => {
        try {
          return {
            index,
            sourceId:
              typeof s.id === "string" ? text(s.id, "Source ID", 200) : "",
            record: normalizeImportRecord(s, when),
          };
        } catch (e) {
          fail(e.status || 400, "Record " + (index + 1) + ": " + e.message);
        }
      });
    const ids = new Set(rows.map((r) => r.sourceId).filter(Boolean));
    const documents = list(source.documents ?? [], "Document manifest").filter(
      (d) => d && ids.has(d.opportunityId),
    );
    const tasks = list(source.tasks ?? [], "Tasks").filter(
      (t) => t && ids.has(t.opportunityId),
    );
    const archive = {
      format: source.format || "opportunity-knox-historical",
      version: 1,
      opportunities: historyJSON(originals, "Original records", 8000000),
      documents: historyJSON(documents, "Document manifest", 8000000),
      tasks: historyJSON(tasks, "Source tasks", 8000000),
    };
    if (JSON.stringify(archive).length > 8000000)
      fail(
        413,
        "Import data exceeds 8 MB. Split it into smaller record files.",
      );
    const sourceHash = hash(archive),
      previous = ctx.getConfig(prefix + sourceHash);
    if (previous?.receipt)
      return {
        id: previous.id,
        sourceHash,
        label: previous.label,
        rows: [],
        warning: previous.warning,
        receipt: previous.receipt,
        alreadyApplied: true,
      };
    const features = rows.map((r) => ({
      sourceId: r.sourceId,
      core: coreHash(r.record),
      url: comparableURL(r.record.url),
      company: normalized(r.record.company),
      role: normalized(r.record.role),
      reference: normalized(r.record.jobReference),
    }));
    const existing = ctx.listRecords().map((record) => ({
        record,
        url: comparableURL(record.url),
        core: coreHash(record),
        companyKey: normalized(record.company),
        roleKey: normalized(record.role),
        reference: normalized(record.jobReference),
      })),
      docs = ctx.getDocuments();
    const hashOwners = new Map();
    for (const doc of docs)
      if (
        (doc.kind === "jd" || doc.category === "job-description") &&
        typeof doc.sha256 === "string"
      ) {
        const key = doc.sha256.toLowerCase();
        if (!hashOwners.has(key)) hashOwners.set(key, new Set());
        hashOwners.get(key).add(doc.opportunityId);
      }
    for (const row of rows) {
      const feature = features[row.index];
      const r = row.record,
        linked = documents.filter((d) => d.opportunityId === row.sourceId),
        hashes = new Set(
          linked
            .filter((d) => d.kind === "jd" || d.category === "job-description")
            .map((d) => d.sha256)
            .filter((h) => typeof h === "string" && /^[a-f0-9]{64}$/i.test(h)),
        );
      const hashMatches = new Set(
        [...hashes].flatMap((h) => [
          ...(hashOwners.get(h.toLowerCase()) || []),
        ]),
      );
      row.matches = existing.flatMap(
        ({ record: o, url: ou, core, companyKey, roleKey, reference }) => {
          const reasons = [];
          if (row.sourceId && o.id === row.sourceId)
            reasons.push("Same source record ID");
          if (
            (o.importSources || []).some(
              (s) =>
                (s.sourceHash === sourceHash && s.index === row.index) ||
                (row.sourceId && s.sourceId === row.sourceId),
            )
          )
            reasons.push("Previously imported source record");
          if (core === feature.core)
            reasons.push("Identical record fields (content hash)");
          if (ou && ou === feature.url) reasons.push("Same job URL");
          if (
            r.jobReference &&
            feature.company === companyKey &&
            feature.reference === reference
          )
            reasons.push("Same employer and job reference");
          if (feature.company === companyKey && feature.role === roleKey)
            reasons.push(
              "Same employer and role — may be a separate application",
            );
          if (hashMatches.has(o.id))
            reasons.push("Matching job-description hash in manifest");
          return reasons.length
            ? [
                {
                  id: o.id,
                  company: o.company,
                  role: o.role,
                  revision: o.revision,
                  reasons,
                  stage: o.stage,
                  outcome: o.outcome,
                },
              ]
            : [];
        },
      );
      row.totalMatches = row.matches.length;
      const score = (m) =>
        m.reasons.reduce(
          (n, r) =>
            n +
            ({
              "Same source record ID": 100,
              "Previously imported source record": 90,
              "Identical record fields (content hash)": 40,
              "Same job URL": 30,
              "Same employer and job reference": 20,
              "Matching job-description hash in manifest": 20,
            }[r] || 1),
          0,
        );
      row.matches.sort((a, b) => score(b) - score(a));
      row.matches = row.matches.slice(0, 25);
      row.relatedRows = features.flatMap((other, index) =>
        index !== row.index &&
        ((feature.sourceId && feature.sourceId === other.sourceId) ||
          other.core === feature.core ||
          (feature.url && feature.url === other.url) ||
          (feature.company === other.company && feature.role === other.role))
          ? [index]
          : [],
      );
      row.documentCount = linked.length;
      row.warnings = [
        ...(!originals[row.index].createdAt
          ? [
              "Original creation date missing; the new record uses the import timestamp.",
            ]
          : []),
        ...(!originals[row.index].events?.length
          ? [
              "No original timeline supplied; a clearly marked import entry is used.",
            ]
          : []),
      ];
    }
    const plan = {
      id: randomUUID(),
      sourceHash,
      label: text(label || "Record import", "File name", 250),
      createdAt: when,
      snapshot: snapshot(),
      archive,
      rows,
    };
    const view = {
      id: plan.id,
      sourceHash,
      label: plan.label,
      createdAt: when,
      rows,
      warning:
        "Record-only import. Document bytes, tasks, chats, offers, reviews and application packs are not activated. Original records, linked document manifests and tasks remain in the downloadable source archive. Missing attachment references are not treated as files or approvals. Existing records and documents are unchanged until confirmed.",
    };
    plan.warning = view.warning;
    const pending = plans()
      .filter((p) => !p.receipt && p.sourceHash !== sourceHash)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const stale of pending.slice(4))
      ctx.db
        .prepare("DELETE FROM config WHERE key=?")
        .run(prefix + stale.sourceHash);
    ctx.putConfig(prefix + sourceHash, plan);
    return view;
  }
  function apply(body) {
    if (body.confirm !== true)
      fail(400, "Confirm the reviewed import and automatic backup.");
    if (
      typeof body.sourceHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(body.sourceHash)
    )
      fail(400, "Choose a valid import preview.");
    const plan = ctx.getConfig(prefix + body.sourceHash);
    if (!plan || plan.id !== body.id)
      fail(409, "Import preview changed. Preview the file again.");
    const choices = list(body.choices, "Import choices", 1000);
    const choiceHash = hash(choices);
    if (plan.receipt) {
      if (plan.receipt.choiceHash !== choiceHash)
        fail(409, "This file was already imported with different choices.");
      return { ...plan.receipt, replayed: true };
    }
    if (
      Date.now() - Date.parse(plan.createdAt) > 3600000 ||
      plan.snapshot !== snapshot()
    )
      fail(
        409,
        "Workspace changed or preview expired. Preview the file again before importing.",
      );
    if (
      choices.length !== plan.rows.length ||
      new Set(choices.map((c) => c?.index)).size !== choices.length
    )
      fail(400, "Review each record exactly once.");
    const changes = new Map(),
      results = [];
    const importedAt = new Date().toISOString();
    for (const c of choices) {
      object(c, "Import choice");
      const row = plan.rows[c.index];
      if (!row || row.index !== c.index) fail(400, "Invalid import row.");
      choice(c.action, ["skip", "create", "merge"], "import action");
      if (c.action === "skip") {
        results.push({ index: c.index, action: "skip" });
        continue;
      }
      const incoming = structuredClone(row.record);
      let target;
      if (c.action === "create") {
        target = incoming;
      } else {
        if (!row.matches.some((m) => m.id === c.targetId))
          fail(400, "Choose one of the previewed duplicate candidates.");
        target =
          changes.get(c.targetId) || structuredClone(ctx.getRecord(c.targetId));
        const fields = list(
          c.fields ?? [],
          "Merge fields",
          importFields.length,
        );
        if (
          new Set(fields).size !== fields.length ||
          fields.some((f) => !importFields.includes(f))
        )
          fail(400, "Choose only supported distinct merge fields.");
        if (
          typeof c.includeHistory !== "boolean" ||
          typeof c.includeStage !== "boolean"
        )
          fail(
            400,
            "Explicitly choose whether to merge history and the current stage.",
          );
        for (const field of fields) target[field] = incoming[field];
        if (c.includeStage) {
          target.stage = incoming.stage;
          target.outcome = incoming.outcome;
          target.stageEnteredAt = incoming.stageEnteredAt;
          target.currentStageEventId = undefined;
        }
        if (c.includeHistory) {
          const events = new Set((target.events || []).map(eventHash)),
            activities = new Set((target.activities || []).map(activityHash));
          target.events ||= [];
          target.activities ||= [];
          for (const e of incoming.events)
            if (!events.has(eventHash(e))) {
              target.events.push(e);
              events.add(eventHash(e));
            }
          for (const a of incoming.activities)
            if (!activities.has(activityHash(a))) {
              target.activities.push(a);
              activities.add(activityHash(a));
            }
        }
        if (!fields.length && !c.includeHistory && !c.includeStage)
          fail(400, "Select fields or history to merge, or skip this row.");
        target.revision++;
        target.updatedAt = importedAt;
      }
      const provenance = {
        sourceHash: plan.sourceHash,
        sourceId: row.sourceId,
        index: row.index,
        importedAt,
      };
      target.importSources = [...(target.importSources || []), provenance];
      const auditId = randomUUID();
      const needsStageEvent =
        (c.action === "merge" && c.includeStage) || !target.currentStageEventId;
      if (needsStageEvent) target.currentStageEventId = auditId;
      target.events.push({
        id: auditId,
        stage: target.stage,
        title: "Historical record imported",
        note:
          "Imported from " +
          plan.label +
          ". Original source retained in Settings → Historical record imports. Document bytes and application pack approvals were not imported.",
        effectiveAt: needsStageEvent ? incoming.stageEnteredAt : importedAt,
        recordedAt: importedAt,
        corrections: [],
        sourceImport: provenance,
      });
      changes.set(target.id, target);
      results.push({ index: c.index, action: c.action, id: target.id });
    }
    if (!changes.size)
      fail(400, "Select at least one record to create or merge.");
    const backup = ctx.createBackup();
    const receipt = {
      id: plan.id,
      sourceHash: plan.sourceHash,
      label: plan.label,
      importedAt,
      choiceHash,
      backup: backup.name,
      results,
      created: results.filter((r) => r.action === "create").length,
      merged: results.filter((r) => r.action === "merge").length,
      skipped: results.filter((r) => r.action === "skip").length,
    };
    ctx.db.exec("BEGIN");
    try {
      for (const record of changes.values()) ctx.putRecord(record);
      ctx.putConfig(prefix + plan.sourceHash, { ...plan, receipt, choices });
      ctx.putConfig("recordImportIndex", [
        ...(ctx.getConfig("recordImportIndex") || []),
        receipt,
      ]);
      ctx.db.exec("COMMIT");
    } catch (e) {
      ctx.db.exec("ROLLBACK");
      throw e;
    }
    return receipt;
  }
  return {
    exportReports: () =>
      plans()
        .filter((p) => p.receipt)
        .map((p) => ({
          receipt: p.receipt,
          archive: p.archive,
          choices: p.choices,
        })),
    async handle(path, method, req, res, { json, readBody }) {
      if (path === "/api/record-imports" && method === "GET") {
        json(res, {
          imports: (ctx.getConfig("recordImportIndex") || []).sort((a, b) =>
            b.importedAt.localeCompare(a.importedAt),
          ),
        });
        return true;
      }
      if (path === "/api/record-imports/preview" && method === "POST") {
        const b = await readBody(req);
        json(res, preview(b.source, b.label));
        return true;
      }
      if (path === "/api/record-imports/apply" && method === "POST") {
        json(res, apply(await readBody(req)));
        return true;
      }
      const m = path.match(/^\/api\/record-imports\/([a-f0-9]{64})$/);
      if (m && method === "GET") {
        const p = ctx.getConfig(prefix + m[1]);
        if (!p?.receipt) fail(404, "Completed import not found.");
        json(res, {
          receipt: p.receipt,
          source: p.archive,
          choices: p.choices,
        });
        return true;
      }
      return false;
    },
  };
}
