import { createHash, randomUUID } from "node:crypto";
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const text = (value, max, label) => {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    fail(400, `${label} must be text up to ${max} characters.`);
  return value.trim();
};
function date(value, label, optional = true) {
  if (value === "" && optional) return "";
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail(400, `${label} must be a valid date.`);
  return value;
}
function instant(value, label) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return date(value, label, false);
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    fail(400, `${label} must be a valid date or timestamp.`);
  date(value.slice(0, 10), label, false);
  return new Date(value).toISOString();
}
function keys(body, allowed) {
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    fail(400, "Unsupported workflow field.");
}
const offerText = {
  title: 200,
  compensation: 5000,
  terms: 50000,
  contact: 5000,
  decisionReason: 10000,
};
const offerKeys = [
  ...Object.keys(offerText),
  "offeredAt",
  "responseDueDate",
  "startDate",
  "decision",
  "decidedAt",
  "documentIds",
];
const decisions = ["pending", "accepted", "declined", "withdrawn", "expired"];
export function createOpportunityWorkflow({
  getRecord,
  putRecord,
  fullRecord,
  addEvent,
  getDocuments,
}) {
  const now = () => new Date().toISOString();
  const revision = (body, o) => {
    if (body.revision !== o.revision)
      fail(409, "This opportunity changed. Reload before saving the workflow.");
  };
  function save(o) {
    o.revision++;
    o.updatedAt = now();
    putRecord(o);
    return fullRecord(o);
  }
  function event(o, title, note, effectiveAt, workflowId, stage = o.stage) {
    const e = addEvent(o, { note, effectiveAt: now() }, stage);
    Object.assign(e, {
      title,
      effectiveAt,
      source: "opportunity-workflow",
      workflowId,
    });
    return e;
  }
  function attachmentIds(value, o, previous = []) {
    if (
      !Array.isArray(value) ||
      value.length > 30 ||
      value.some((id) => typeof id !== "string") ||
      new Set(value).size !== value.length
    )
      fail(400, "Choose up to 30 distinct offer documents.");
    const docs = getDocuments();
    for (const id of value) {
      const d = docs.find((d) => d.id === id);
      if (!d && previous.includes(id)) continue;
      if (!d || d.opportunityId !== o.id)
        fail(400, "Offer documents must belong to this opportunity.");
    }
    return [...value];
  }
  return {
    async handle(path, method, req, res, { json, readBody }) {
      const m = path.match(
        /^\/api\/opportunities\/([^/]+)\/(review|offers)(?:\/([^/]+))?$/,
      );
      if (!m) return false;
      const o = getRecord(m[1]);
      if (method === "GET" && !m[3]) {
        json(
          res,
          m[2] === "review"
            ? { review: o.review || null }
            : { offers: o.offers || [] },
        );
        return true;
      }
      const body = await readBody(req);
      if (m[2] === "review") {
        if (method !== "PATCH" || m[3])
          fail(405, "Use Save review to update this decision.");
        keys(body, [
          "revision",
          "strengths",
          "gaps",
          "decision",
          "reason",
          "effectiveAt",
          "applyStage",
        ]);
        revision(body, o);
        const previous = o.review,
          review = {
            strengths: "",
            gaps: "",
            decision: "",
            reason: "",
            ...(previous || {}),
          };
        for (const key of ["strengths", "gaps", "reason"])
          if (body[key] !== undefined)
            review[key] = text(body[key], 50000, key);
        if (body.decision !== undefined) {
          if (!["", "proceed", "ignore", "defer"].includes(body.decision))
            fail(400, "Choose proceed, ignore, defer or not decided.");
          review.decision = body.decision;
        }
        if (review.decision && !review.reason)
          fail(400, "Add a reason for your review decision.");
        if (
          body.applyStage !== undefined &&
          typeof body.applyStage !== "boolean"
        )
          fail(400, "Stage update must be true or false.");
        if (body.applyStage && (!review.decision || o.outcome))
          fail(
            409,
            "Choose a decision on an active opportunity before updating its stage. Reopen a closed opportunity in Overview first.",
          );
        review.effectiveAt = body.effectiveAt
          ? instant(body.effectiveAt, "Review date")
          : body.effectiveAt === undefined && previous?.effectiveAt
            ? previous.effectiveAt
            : now();
        const { history, ...snapshot } = previous || {};
        review.recordedAt = now();
        review.history = [
          ...(history || []),
          ...(previous ? [{ ...snapshot, changedAt: now() }] : []),
        ];
        o.review = review;
        const oldStage = o.stage,
          oldOutcome = o.outcome;
        if (body.applyStage) {
          o.stage = {
            proceed: "documents",
            ignore: "outcome",
            defer: "review",
          }[review.decision];
          o.outcome = review.decision === "ignore" ? "ignored" : "";
        }
        const e = event(
          o,
          "Review decision",
          [
            `Decision: ${review.decision || "Not decided"}`,
            review.reason ? `Reason: ${review.reason}` : "",
            review.strengths ? `Strengths: ${review.strengths}` : "",
            review.gaps ? `Gaps: ${review.gaps}` : "",
            body.applyStage ? "Workflow stage update requested." : "",
          ]
            .filter(Boolean)
            .join("\n"),
          review.effectiveAt,
          "review",
        );
        if (o.stage !== oldStage || o.outcome !== oldOutcome) {
          o.stageEnteredAt = e.effectiveAt;
          o.currentStageEventId = e.id;
        }
        json(res, save(o));
        return true;
      }
      if (!((method === "POST" && !m[3]) || (method === "PATCH" && m[3])))
        fail(405, "Use Add offer or Edit offer.");
      keys(body, ["revision", "requestId", ...offerKeys]);
      const previous = m[3]
        ? (o.offers || []).find((v) => v.id === m[3])
        : null;
      if (m[3] && !previous) fail(404, "Offer not found.");
      const values = {
        title: "",
        compensation: "",
        terms: "",
        contact: "",
        decisionReason: "",
        offeredAt: "",
        responseDueDate: "",
        startDate: "",
        decision: "pending",
        decidedAt: "",
        documentIds: [],
        ...(previous || {}),
      };
      for (const [key, max] of Object.entries(offerText))
        if (body[key] !== undefined) values[key] = text(body[key], max, key);
      if (!values.title) fail(400, "Give this offer a title.");
      for (const key of ["responseDueDate", "startDate"])
        if (body[key] !== undefined) values[key] = date(body[key], key);
      if (body.decision !== undefined) {
        if (!decisions.includes(body.decision))
          fail(400, "Choose a valid offer decision.");
        values.decision = body.decision;
      }
      for (const key of ["offeredAt", "decidedAt"])
        if (body[key] !== undefined)
          values[key] = body[key] === "" ? "" : instant(body[key], key);
      if (body.documentIds !== undefined)
        values.documentIds = attachmentIds(
          body.documentIds,
          o,
          previous?.documentIds,
        );
      const requestId =
        previous?.requestId || text(body.requestId ?? "", 100, "Request ID");
      if (!previous && !/^[a-zA-Z0-9-]{16,100}$/.test(requestId))
        fail(400, "Add offer requires a request identifier.");
      const requestHash = createHash("sha256")
        .update(JSON.stringify(offerKeys.map((key) => [key, values[key]])))
        .digest("hex");
      if (!previous) {
        const duplicate = (o.offers || []).find(
          (v) => v.requestId === requestId,
        );
        if (duplicate) {
          if (duplicate.requestHash !== requestHash)
            fail(
              409,
              "This request identifier already saved a different offer.",
            );
          json(res, fullRecord(o));
          return true;
        }
      }
      revision(body, o);
      values.offeredAt ||= now();
      if (values.decision === "pending") values.decidedAt = "";
      else if (!previous || values.decision !== previous.decision)
        values.decidedAt = body.decidedAt
          ? instant(body.decidedAt, "Decision date")
          : now();
      else values.decidedAt ||= now();
      if (
        values.decidedAt &&
        Date.parse(values.decidedAt) < Date.parse(values.offeredAt)
      )
        fail(400, "The offer decision date cannot be before the offer date.");
      const { history, ...snapshot } = previous || {};
      const offer = {
        ...values,
        id: previous?.id || randomUUID(),
        createdAt: previous?.createdAt || now(),
        updatedAt: now(),
        requestId,
        requestHash: previous?.requestHash || requestHash,
        history: [
          ...(history || []),
          ...(previous ? [{ ...snapshot, changedAt: now() }] : []),
        ],
      };
      o.offers ||= [];
      if (previous)
        o.offers = o.offers.map((v) => (v.id === offer.id ? offer : v));
      else o.offers.push(offer);
      const title = !previous
        ? "Offer recorded"
        : offer.decision !== previous.decision
          ? `Offer ${offer.decision}`
          : "Offer updated";
      const effectiveAt = !previous
        ? offer.offeredAt
        : offer.decision !== previous.decision
          ? offer.decidedAt || now()
          : now();
      event(
        o,
        title,
        [
          offer.title,
          `Decision: ${offer.decision}`,
          offer.compensation ? `Compensation: ${offer.compensation}` : "",
          offer.terms ? `Terms: ${offer.terms}` : "",
          offer.contact ? `Contact: ${offer.contact}` : "",
          offer.decisionReason
            ? `Decision reason: ${offer.decisionReason}`
            : "",
          offer.responseDueDate ? `Respond by: ${offer.responseDueDate}` : "",
          offer.startDate ? `Proposed start: ${offer.startDate}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        effectiveAt,
        offer.id,
      );
      json(res, save(o));
      return true;
    },
  };
}
