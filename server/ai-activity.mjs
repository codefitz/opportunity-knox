import { cleanUsage } from "./ai-usage.mjs";
export const activityKinds = {
  "opportunity-chat": "Opportunity chat",
  "buddy-chat": "Career Buddy chat",
  draft: "Document drafting",
  fit: "Fit assessment",
  tags: "Automatic tags",
  summary: "Opportunity briefing",
  intake: "AI job intake",
  "local-intake": "Local job reading",
  feedback: "Feedback review",
  "connection-test": "Connection test",
  "external-assistant": "External assistant task",
};
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
export const publicRates = (getConfig) =>
  getConfig("aiUsageRates") || { revision: 1, rates: [] };
export function requestActivity(record, opportunities = []) {
  const scope = String(record.conversationId || ""),
    parts = scope.split(":"),
    prefix = parts[0];
  const inferred =
    {
      opportunity: "opportunity-chat",
      automation: "tags",
      decision: "fit",
      summary: "summary",
      intake: record.provider === "local" ? "local-intake" : "intake",
      feedback: "feedback",
      connection: "connection-test",
    }[prefix] || "buddy-chat";
  const kind = activityKinds[record.kind] ? record.kind : inferred;
  const opportunityId = [
    "opportunity",
    "automation",
    "decision",
    "summary",
  ].includes(prefix)
    ? parts.slice(1).join(":")
    : null;
  const opportunity = opportunities.find((o) => o.id === opportunityId);
  const destination = opportunityId
    ? opportunity
      ? {
          type: "opportunity",
          id: opportunityId,
          tab:
            kind === "fit"
              ? "decision"
              : kind === "summary"
                ? "summary"
                : "buddy",
        }
      : null
    : kind === "intake" || kind === "local-intake"
      ? { type: "intake" }
      : kind === "feedback"
        ? { type: "feedback" }
        : kind === "connection-test"
          ? { type: "settings" }
          : { type: "buddy", id: scope };
  const usage = record.usage ? cleanUsage(record.usage) : null;
  const knownDuration =
    Number.isFinite(record.durationMs) && record.durationMs >= 0
      ? record.durationMs
      : record.finishedAt &&
          Number.isFinite(Date.parse(record.startedAt)) &&
          Number.isFinite(Date.parse(record.finishedAt))
        ? Math.max(
            0,
            Date.parse(record.finishedAt) - Date.parse(record.startedAt),
          )
        : null;
  // Deliberately do not spread stored records: previews, bodies and future fields stay private.
  return {
    id: record.id,
    originalRequestId: record.originalRequestId || null,
    attempt: record.attempt || null,
    retryOf: record.retryOf || null,
    kind,
    label: activityKinds[kind],
    action: record.action || null,
    subject: opportunity
      ? opportunity.role + " — " + opportunity.company
      : opportunityId
        ? "Opportunity unavailable"
        : kind === "buddy-chat" || kind === "draft"
          ? "Career Buddy"
          : activityKinds[kind],
    provider: record.provider || "unknown",
    model: record.model || "Not recorded",
    reportedModel: record.reportedModel || null,
    stage: record.stage,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt || null,
    durationMs: knownDuration,
    promptVersion: record.promptVersion || null,
    promptHash: record.promptHash || null,
    errorCode: /^\d{3}$/.test(record.errorCode || "") ? record.errorCode : null,
    usage,
    cost:
      record.cost &&
      record.cost.estimated === true &&
      Number.isFinite(record.cost.amount) &&
      record.cost.amount >= 0
        ? {
            amount: record.cost.amount,
            currency: record.cost.currency,
            estimated: true,
            ratesRevision: record.cost.ratesRevision,
          }
        : null,
    pricing: record.pricing
      ? {
          currency: record.pricing.currency,
          inputPerMillion: record.pricing.inputPerMillion,
          outputPerMillion: record.pricing.outputPerMillion,
          revision: record.pricing.revision,
        }
      : null,
    destination,
  };
}
export function createAIActivity({ db, getConfig, putConfig, listRecords }) {
  const rows = () =>
    db
      .prepare("SELECT data FROM buddy_requests ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(r.data));
  const exported = () => {
    const opportunities = listRecords();
    return rows().map((r) => requestActivity(r, opportunities));
  };
  return {
    exportRequests: exported,
    async handle(path, method, req, res, { json, readBody }) {
      if (path === "/api/ai-activity/rates") {
        const current = publicRates(getConfig);
        if (method === "GET") {
          json(res, current);
          return true;
        }
        if (method !== "PATCH") fail(405, "Use Save rates.");
        const body = await readBody(req);
        if (body.revision !== current.revision)
          fail(409, "Cost rates changed. Reload before saving.");
        if (!Array.isArray(body.rates) || body.rates.length > 100)
          fail(400, "Choose up to 100 model rate entries.");
        const seen = new Set();
        const rates = body.rates.map((r) => {
          if (
            !r ||
            !["openai", "anthropic", "gemini", "ollama", "custom"].includes(
              r.provider,
            ) ||
            typeof r.model !== "string" ||
            !r.model.trim() ||
            r.model.length > 200 ||
            /[\x00-\x1f]/.test(r.model) ||
            typeof r.currency !== "string" ||
            !/^[A-Z]{3}$/.test(r.currency)
          )
            fail(
              400,
              "Choose a provider, model and three-letter currency. Codex account usage has no per-request price here.",
            );
          for (const key of ["inputPerMillion", "outputPerMillion"])
            if (
              typeof r[key] !== "number" ||
              !Number.isFinite(r[key]) ||
              r[key] < 0 ||
              r[key] > 1e6
            )
              fail(
                400,
                "Rates must be numbers from 0 to 1,000,000 per million tokens.",
              );
          const id = JSON.stringify([r.provider, r.model.trim()]);
          if (seen.has(id))
            fail(400, "Use one rate entry per provider and model.");
          seen.add(id);
          return {
            provider: r.provider,
            model: r.model.trim(),
            currency: r.currency,
            inputPerMillion: r.inputPerMillion,
            outputPerMillion: r.outputPerMillion,
          };
        });
        const next = {
          revision: current.revision + 1,
          updatedAt: new Date().toISOString(),
          rates,
        };
        putConfig("aiUsageRates", next);
        json(res, next);
        return true;
      }
      if (path !== "/api/ai-activity" || method !== "GET") return false;
      const params = new URL(req.url, "http://board").searchParams;
      const number = (key, fallback, max) => {
        const v = params.get(key);
        if (v === null) return fallback;
        if (!/^\d+$/.test(v) || Number(v) > max)
          fail(400, "Choose valid activity pagination.");
        return Number(v);
      };
      const limit = number("limit", 25, 100),
        offset = number("offset", 0, 1e7);
      if (!limit) fail(400, "Choose at least one activity row.");
      const status = params.get("status") || "all",
        kind = params.get("kind") || "all",
        provider = params.get("provider") || "all",
        days = number("days", 0, 3650);
      if (
        !["all", "active", "completed", "attention", "cancelled"].includes(
          status,
        )
      )
        fail(400, "Invalid activity status.");
      if (kind !== "all" && !activityKinds[kind])
        fail(400, "Invalid task type.");
      if (
        ![
          "all",
          "openai",
          "anthropic",
          "gemini",
          "ollama",
          "custom",
          "codex",
          "local",
          "unknown",
        ].includes(provider)
      )
        fail(400, "Invalid provider.");
      const all = exported(),
        cutoff = days ? Date.now() - days * 86400000 : 0;
      const filtered = all
        .filter(
          (r) =>
            (kind === "all" || r.kind === kind) &&
            (provider === "all" || r.provider === provider) &&
            (!cutoff || Date.parse(r.startedAt) >= cutoff) &&
            (status === "all" ||
              (status === "active" && !r.finishedAt) ||
              (status === "completed" && r.stage === "completed") ||
              (status === "attention" &&
                ["failed", "interrupted", "timed-out", "stale"].includes(
                  r.stage,
                )) ||
              (status === "cancelled" && r.stage === "cancelled")),
        )
        .sort(
          (a, b) =>
            b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id),
        );
      const totals = {
        requests: filtered.length,
        active: 0,
        completed: 0,
        attention: 0,
        cancelled: 0,
        inputTokens: 0,
        outputTokens: 0,
        completeUsageRequests: 0,
        partialUsageRequests: 0,
        unreportedUsageRequests: 0,
        estimatedRequests: 0,
        costs: {},
      };
      for (const r of filtered) {
        if (!r.finishedAt) totals.active++;
        if (r.stage === "completed") totals.completed++;
        if (["failed", "interrupted", "timed-out", "stale"].includes(r.stage))
          totals.attention++;
        if (r.stage === "cancelled") totals.cancelled++;
        if (
          r.usage?.complete &&
          r.usage.inputTokens !== undefined &&
          r.usage.outputTokens !== undefined
        ) {
          totals.completeUsageRequests++;
          totals.inputTokens += r.usage.inputTokens;
          totals.outputTokens += r.usage.outputTokens;
        } else if (r.usage) totals.partialUsageRequests++;
        else totals.unreportedUsageRequests++;
        if (r.cost) {
          totals.estimatedRequests++;
          totals.costs[r.cost.currency] =
            (totals.costs[r.cost.currency] || 0) + r.cost.amount;
        }
      }
      json(res, {
        items: filtered.slice(offset, offset + limit),
        total: filtered.length,
        offset,
        limit,
        totals,
        allCount: all.length,
      });
      return true;
    },
  };
}
