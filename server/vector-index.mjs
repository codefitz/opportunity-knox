import { readFileSync, statSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { embedLocal, LOCAL_MODEL, LOCAL_REVISION } from "./local-embedding.mjs";
import {
  callEmbeddingProvider,
  upsertExternalVectors,
  queryExternalVectors,
  deleteExternalVectors,
  EMBEDDING_PROVIDERS,
  VECTOR_BACKENDS,
  validateBaseUrl,
} from "./buddy-provider.mjs";

const LOCAL_MODEL_KEY = `${LOCAL_MODEL}@${LOCAL_REVISION}:q8:mean:normalized:384`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const signature = (file) => {
  const s = statSync(file);
  return `${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
};
const invalid = (message, status = 400) =>
  Object.assign(new Error(message), { status });

const validUrl = (value) => {
  try {
    return typeof value === "string" && Boolean(validateBaseUrl(value));
  } catch {
    return false;
  }
};

export function createVectorIndex({
  db,
  getDocuments,
  documentPath,
  indexDocuments,
  getConfig,
  putConfig,
  embed = embedLocal,
  buddyFetch,
  scheduler,
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS document_vectors (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS vectors_text_deleted AFTER DELETE ON document_text BEGIN DELETE FROM document_vectors WHERE id=OLD.id; END;
    CREATE TRIGGER IF NOT EXISTS vectors_text_updated AFTER UPDATE ON document_text BEGIN DELETE FROM document_vectors WHERE id=OLD.id; END;`);
  let job = getConfig("vectorIndexJob") || null,
    running = null,
    stopping = false,
    controller = null,
    jobActive = null;
  const save = () => putConfig("vectorIndexJob", job);
  if (job && ["running", "cancelling"].includes(job.status)) {
    job.status = "interrupted";
    job.finishedAt = new Date().toISOString();
    save();
    try {
      scheduler?.updateProgress(job.id, {
        current: job.items.filter((i) => i.status === "indexed").length,
        total: job.items.length,
        detail: `${job.items.filter((i) => i.status === "indexed").length} of ${job.items.length} sources indexed`,
        status: job.status,
      });
    } catch {}
  }
  const get = (id) => {
    const row = db
      .prepare("SELECT data FROM document_vectors WHERE id=?")
      .get(id);
    return row ? JSON.parse(row.data) : null;
  };
  const remove = (id) =>
    db.prepare("DELETE FROM document_vectors WHERE id=?").run(id);

  function activeState() {
    const raw = getConfig("embeddingSettings") || {
      provider: "builtin",
      model: LOCAL_MODEL,
      baseUrl: "",
      vectorBackend: "sqlite",
      vectorUrl: "",
      vectorCollection: "opportunity_knox_vectors",
    };
    const provider = raw.provider || "builtin";
    const vectorBackend = raw.vectorBackend || "sqlite";
    const vectorCollection =
      typeof raw.vectorCollection === "string" && raw.vectorCollection.trim()
        ? raw.vectorCollection.trim()
        : "opportunity_knox_vectors";
    const providerConfigured =
      provider === "builtin"
        ? true
        : ["openai", "ollama", "custom"].includes(provider) &&
          typeof raw.model === "string" &&
          Boolean(raw.model.trim()) &&
          validUrl(raw.baseUrl) &&
          (provider !== "openai" || Boolean(raw.apiKey));
    const vectorConfigured =
      vectorBackend === "sqlite"
        ? true
        : ["qdrant", "custom"].includes(vectorBackend) &&
          validUrl(raw.vectorUrl) &&
          /^[a-zA-Z0-9._-]{1,120}$/.test(vectorCollection);
    const revision =
      provider === "builtin"
        ? LOCAL_REVISION
        : providerConfigured
          ? createHash("sha256")
              .update(
                `${provider}\0${validateBaseUrl(raw.baseUrl)}\0${raw.model.trim()}`,
              )
              .digest("hex")
              .slice(0, 16)
          : "";
    const modelKey =
      provider === "builtin"
        ? LOCAL_MODEL_KEY
        : providerConfigured
          ? `${provider}:${raw.model.trim()}@${revision}:normalized`
          : "";
    const backendKey =
      vectorBackend === "sqlite"
        ? "sqlite"
        : vectorConfigured
          ? `${vectorBackend}:${vectorCollection}@${createHash("sha256")
              .update(validateBaseUrl(raw.vectorUrl))
              .digest("hex")
              .slice(0, 16)}`
          : "";
    return {
      raw: {
        ...raw,
        provider,
        vectorBackend,
        vectorCollection,
        ...(provider !== "builtin" && providerConfigured
          ? { baseUrl: validateBaseUrl(raw.baseUrl), model: raw.model.trim() }
          : {}),
        ...(vectorBackend !== "sqlite" && vectorConfigured
          ? { vectorUrl: validateBaseUrl(raw.vectorUrl) }
          : {}),
      },
      provider,
      model: provider === "builtin" ? LOCAL_MODEL : (raw.model || "").trim(),
      revision,
      modelKey,
      providerConfigured,
      vectorBackend,
      vectorCollection,
      backendKey,
      vectorConfigured,
    };
  }

  async function embedBatch(active, texts, signal) {
    if (active.provider === "builtin") {
      const batch = await embed(texts);
      if (
        !Array.isArray(batch) ||
        batch.length !== texts.length ||
        batch.some(
          (v) =>
            !Array.isArray(v) ||
            v.length !== 384 ||
            v.some((n) => typeof n !== "number" || !Number.isFinite(n)) ||
            Math.abs(Math.hypot(...v) - 1) > 0.01,
        )
      )
        throw invalid("The embedding model returned invalid vectors.");
      return { vectors: batch, dimensions: 384 };
    }
    const parsed = await callEmbeddingProvider(
      { ...active.raw, signal },
      texts,
      buddyFetch,
    );
    const normalized = parsed.vectors.map((v) => {
      const norm = Math.hypot(...v);
      return Math.abs(norm - 1) <= 1e-6 ? v : v.map((n) => n / norm);
    });
    return { vectors: normalized, dimensions: parsed.dimensions };
  }

  function status() {
    const active = activeState();
    const docs = getDocuments().filter((d) => !d.opportunityId);
    const available = new Set(docs.map((d) => d.id));
    for (const row of db.prepare("SELECT id FROM document_vectors").all())
      if (!available.has(row.id)) remove(row.id);
    let detectedDimensions = active.provider === "builtin" ? 384 : 0;
    const sources = docs.map((doc) => {
      let cached = get(doc.id),
        state = "pending";
      if (cached) {
        try {
          state =
            active.providerConfigured &&
            active.vectorConfigured &&
            cached.model === active.modelKey &&
            (cached.backendKey || "sqlite") === active.backendKey &&
            cached.signature === signature(documentPath(doc))
              ? "indexed"
              : "stale";
        } catch {
          state = "unavailable";
        }
        if (state !== "indexed") {
          remove(doc.id);
          cached = null;
        } else if (!detectedDimensions) {
          detectedDimensions =
            cached.dimensions || cached.vectors?.[0]?.values?.length || 0;
        }
      }
      return {
        id: doc.id,
        name: doc.name,
        readOnly: Boolean(doc.readOnlyVaultSource),
        status: state,
        chunks: cached?.vectors.length || 0,
        indexedAt: cached?.indexedAt,
      };
    });
    if (
      !detectedDimensions &&
      job?.model === active.modelKey &&
      job?.dimensions
    )
      detectedDimensions = job.dimensions;
    return {
      provider: active.provider,
      providerName:
        EMBEDDING_PROVIDERS[active.provider]?.name || active.provider,
      configured: active.providerConfigured && active.vectorConfigured,
      model: active.model || LOCAL_MODEL,
      revision: active.revision || LOCAL_REVISION,
      dimensions: detectedDimensions,
      vectorBackend: active.vectorBackend,
      vectorBackendName:
        VECTOR_BACKENDS[active.vectorBackend]?.name || active.vectorBackend,
      vectorCollection:
        active.vectorBackend === "sqlite" ? "" : active.vectorCollection,
      job,
      sources,
    };
  }

  async function search(documents, query) {
    const safeDocuments = () => {
      const available = new Map(getDocuments().map((d) => [d.id, d]));
      return documents.map((text) => {
        const doc = available.get(text.id);
        try {
          if (
            !doc ||
            statSync(documentPath(doc)).size > 20 * 1024 * 1024 ||
            hash(readFileSync(documentPath(doc))) !== text.fingerprint
          )
            throw Error("changed");
          return text;
        } catch {
          remove(text.id);
          return {
            ...text,
            status: "unavailable",
            chunks: [],
            text: "",
            warnings: [
              "This source changed or was removed during retrieval. Retry to use the latest selection.",
            ],
          };
        }
      });
    };
    const fallback = (reason) => ({
      documents: safeDocuments(),
      scores: new Map(),
      mode: "keyword",
      reason,
      indexedSources: 0,
    });
    const active = activeState();
    if (!active.providerConfigured) return fallback("external-provider");
    if (!active.vectorConfigured) return fallback("vector-store-unavailable");
    if (running) return fallback("indexing-in-progress");
    const candidates = documents
      .filter((d) => d.status === "ready")
      .flatMap((doc) => {
        const cached = get(doc.id);
        if (
          !cached ||
          cached.model !== active.modelKey ||
          (cached.backendKey || "sqlite") !== active.backendKey ||
          cached.fingerprint !== doc.fingerprint
        )
          return [];
        const chunks = new Map(doc.chunks.map((c) => [c.index, c]));
        return (Array.isArray(cached.vectors) ? cached.vectors : [])
          .filter(
            (v) =>
              chunks.has(v.index) && v.hash === hash(chunks.get(v.index).text),
          )
          .map((v) => ({ ...v, sourceId: doc.id }));
      });
    if (!candidates.length) return fallback("not-indexed");
    let vector, queryDim;
    try {
      const res = await embedBatch(active, [query.slice(0, 12000)]);
      [vector] = res.vectors;
      queryDim = res.dimensions;
    } catch {
      return fallback("model-unavailable");
    }
    const safe = safeDocuments(),
      valid = new Set(
        safe.filter((d) => d.status === "ready").map((d) => d.id),
      );
    const scores = new Map(),
      checkedSources = new Set();
    const currentBySource = new Map(
      [...new Set(candidates.map((c) => c.sourceId))].map((id) => [
        id,
        get(id),
      ]),
    );
    const fingerprints = new Map(documents.map((d) => [d.id, d.fingerprint]));
    if (active.vectorBackend !== "sqlite") {
      const verifiedChunks = new Map();
      for (const item of candidates) {
        const current = currentBySource.get(item.sourceId);
        if (
          !valid.has(item.sourceId) ||
          current?.model !== active.modelKey ||
          (current?.backendKey || "sqlite") !== active.backendKey ||
          current?.fingerprint !== fingerprints.get(item.sourceId)
        )
          continue;
        checkedSources.add(item.sourceId);
        verifiedChunks.set(`${item.sourceId}:${item.index}`, item.hash);
      }
      if (!checkedSources.size) return fallback("not-indexed");
      let hits;
      try {
        hits = await queryExternalVectors(
          active.raw,
          {
            model: active.modelKey,
            sourceIds: [...checkedSources],
            vector,
            limit: Math.min(200, verifiedChunks.size + 20),
          },
          buddyFetch,
        );
      } catch {
        return fallback("vector-store-unavailable");
      }
      for (const hit of hits) {
        if (!hit || typeof hit.sourceId !== "string") continue;
        const key = `${hit.sourceId}:${hit.index}`;
        const expectedHash = verifiedChunks.get(key);
        if (
          !expectedHash ||
          (hit.hash && hit.hash !== expectedHash) ||
          (hit.model && hit.model !== active.modelKey) ||
          (hit.fingerprint &&
            hit.fingerprint !== fingerprints.get(hit.sourceId))
        )
          continue;
        if (
          typeof hit.score === "number" &&
          Number.isFinite(hit.score) &&
          hit.score >= 0.2
        ) {
          scores.set(key, Math.min(1, hit.score));
        }
      }
      return {
        documents: safe,
        scores,
        mode: scores.size ? "hybrid" : "keyword",
        reason: scores.size ? "" : "no-semantic-matches",
        indexedSources: checkedSources.size,
      };
    }
    for (const item of candidates) {
      // Text resets, source deselection and index clearing during inference invalidate the snapshot.
      const current = currentBySource.get(item.sourceId);
      if (
        !valid.has(item.sourceId) ||
        current?.model !== active.modelKey ||
        (current?.backendKey || "sqlite") !== active.backendKey ||
        current?.fingerprint !== fingerprints.get(item.sourceId)
      )
        continue;
      if (
        !Array.isArray(item.values) ||
        item.values.length !== queryDim ||
        item.values.some((n) => typeof n !== "number" || !Number.isFinite(n)) ||
        Math.abs(Math.hypot(...item.values) - 1) > 0.01
      )
        continue;
      checkedSources.add(item.sourceId);
      const cosine = item.values.reduce((sum, n, i) => sum + n * vector[i], 0);
      if (Number.isFinite(cosine) && cosine >= 0.2)
        scores.set(`${item.sourceId}:${item.index}`, cosine);
    }
    return {
      documents: safe,
      scores,
      mode: scores.size ? "hybrid" : "keyword",
      reason: scores.size ? "" : "no-semantic-matches",
      indexedSources: checkedSources.size,
    };
  }

  async function selectSources(query, candidates, limit = 20) {
    const terms = new Set(
      query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [],
    );
    const active = activeState();
    let queryVector,
      queryDim = 0;
    const hasIndexedCandidate =
      active.providerConfigured &&
      active.vectorConfigured &&
      !running &&
      candidates.some((doc) => {
        const c = get(doc.id);
        return (
          c?.model === active.modelKey &&
          (c?.backendKey || "sqlite") === active.backendKey
        );
      });
    let externalSourceScores = null;
    if (hasIndexedCandidate) {
      try {
        const res = await embedBatch(active, [query.slice(0, 12000)]);
        [queryVector] = res.vectors;
        queryDim = res.dimensions;
        if (active.vectorBackend !== "sqlite") {
          externalSourceScores = new Map();
          const extMatches = await queryExternalVectors(
            active.raw,
            {
              model: active.modelKey,
              sourceIds: candidates.map((c) => c.id),
              vector: queryVector,
              limit: Math.min(200, Math.max(40, candidates.length * 4)),
            },
            buddyFetch,
          );
          for (const m of extMatches) {
            const prev = externalSourceScores.get(m.sourceId) || 0;
            if (m.score > prev) externalSourceScores.set(m.sourceId, m.score);
          }
        }
      } catch {}
    }
    return candidates
      .map((doc, order) => {
        const cached = get(doc.id);
        let score = 0;
        if (
          queryVector?.length === queryDim &&
          queryDim > 0 &&
          cached?.model === active.modelKey &&
          (cached?.backendKey || "sqlite") === active.backendKey
        ) {
          if (externalSourceScores?.has(doc.id)) {
            score = Math.max(score, externalSourceScores.get(doc.id));
          } else {
            for (const v of cached.vectors || []) {
              if (v.values?.length === queryDim)
                score = Math.max(
                  score,
                  v.values.reduce((sum, n, i) => sum + n * queryVector[i], 0),
                );
            }
          }
        }
        const text = db
          .prepare("SELECT data FROM document_text WHERE id=?")
          .get(doc.id);
        const sample = (
          doc.name +
          " " +
          (text ? JSON.parse(text.data).text || "" : "")
        ).toLowerCase();
        for (const term of terms) if (sample.includes(term)) score += 0.02;
        return { id: doc.id, score, order };
      })
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, limit)
      .map((d) => d.id);
  }

  async function run() {
    const active = jobActive || activeState();
    const signal = controller?.signal;
    try {
      for (const item of job.items) {
        if (job.status === "cancelling" || stopping) break;
        item.status = "running";
        save();
    try {
      scheduler?.updateProgress(job.id, {
        current: job.items.filter((i) => i.status === "indexed").length,
        total: job.items.length,
        detail: `${job.items.filter((i) => i.status === "indexed").length} of ${job.items.length} sources indexed`,
        status: job.status,
      });
    } catch {}
        try {
          const doc = getDocuments().find(
            (d) => d.id === item.id && !d.opportunityId,
          );
          if (!doc) throw invalid("Source is no longer selected or available.");
          const file = documentPath(doc);
          if (statSync(file).size > 20 * 1024 * 1024)
            throw invalid("Source exceeds the 20 MB text preparation limit.");
          const before = hash(readFileSync(file));
          const existing = get(doc.id);
          if (
            existing?.fingerprint === before &&
            existing.model === active.modelKey &&
            (existing.backendKey || "sqlite") === active.backendKey
          ) {
            existing.signature = signature(file);
            db.prepare("UPDATE document_vectors SET data=? WHERE id=?").run(
              JSON.stringify(existing),
              doc.id,
            );
            item.status = "indexed";
            item.chunks = existing.vectors.length;
            if (existing.dimensions) job.dimensions = existing.dimensions;
            save();
    try {
      scheduler?.updateProgress(job.id, {
        current: job.items.filter((i) => i.status === "indexed").length,
        total: job.items.length,
        detail: `${job.items.filter((i) => i.status === "indexed").length} of ${job.items.length} sources indexed`,
        status: job.status,
      });
    } catch {}
            continue;
          }
          remove(doc.id);
          const [text] = await indexDocuments([doc.id]);
          if (text.status !== "ready" || !text.chunks.length)
            throw invalid(
              "No readable text. Prepare text or OCR this source first.",
            );
          const vectors = [];
          let docDimensions = job.dimensions || 0;
          item.totalChunks = text.chunks.length;
          item.chunks = 0;
          save();
    try {
      scheduler?.updateProgress(job.id, {
        current: job.items.filter((i) => i.status === "indexed").length,
        total: job.items.length,
        detail: `${job.items.filter((i) => i.status === "indexed").length} of ${job.items.length} sources indexed`,
        status: job.status,
      });
    } catch {}
          for (let offset = 0; offset < text.chunks.length; offset += 2) {
            if (job.status === "cancelling" || stopping) break;
            const chunks = text.chunks.slice(offset, offset + 2);
            const res = await embedBatch(
              active,
              chunks.map((c) => c.text),
              signal,
            );
            if (docDimensions && res.dimensions !== docDimensions)
              throw invalid(
                "The embedding model returned inconsistent vector dimensions.",
              );
            docDimensions = res.dimensions;
            vectors.push(
              ...chunks.map((c, i) => ({
                index: c.index,
                hash: hash(c.text),
                values: res.vectors[i],
              })),
            );
            item.chunks = vectors.length;
            save();
    try {
      scheduler?.updateProgress(job.id, {
        current: job.items.filter((i) => i.status === "indexed").length,
        total: job.items.length,
        detail: `${job.items.filter((i) => i.status === "indexed").length} of ${job.items.length} sources indexed`,
        status: job.status,
      });
    } catch {}
            await new Promise((resolve) => setImmediate(resolve));
          }
          if (job.status === "cancelling" || stopping) {
            item.status = "cancelled";
            save();
    try {
      scheduler?.updateProgress(job.id, {
        current: job.items.filter((i) => i.status === "indexed").length,
        total: job.items.length,
        detail: `${job.items.filter((i) => i.status === "indexed").length} of ${job.items.length} sources indexed`,
        status: job.status,
      });
    } catch {}
            break;
          }
          const latest = activeState();
          if (
            latest.modelKey !== active.modelKey ||
            latest.backendKey !== active.backendKey
          )
            throw invalid(
              "Embedding or vector store settings changed while indexing. Retry with the current settings.",
            );
          // Re-read the source after inference: never publish vectors for changed or deselected evidence.
          if (
            !getDocuments().some((d) => d.id === doc.id) ||
            hash(readFileSync(file)) !== before ||
            text.fingerprint !== before
          )
            throw invalid(
              "Source changed while indexing. Retry to use the latest file.",
            );
          const cachedText = db
            .prepare("SELECT data FROM document_text WHERE id=?")
            .get(doc.id);
          if (!cachedText || JSON.parse(cachedText.data).fingerprint !== before)
            throw invalid(
              "Prepared text was reset during indexing. Retry this source.",
            );
          if (active.vectorBackend !== "sqlite") {
            await upsertExternalVectors(
              { ...active.raw, signal },
              {
                sourceId: doc.id,
                model: active.modelKey,
                fingerprint: before,
                dimensions: docDimensions,
                vectors,
              },
              buddyFetch,
            );
          }
          const value = {
            id: doc.id,
            model: active.modelKey,
            ...(active.vectorBackend !== "sqlite"
              ? {
                  backendKey: active.backendKey,
                  vectorBackend: active.vectorBackend,
                  vectorCollection: active.vectorCollection,
                }
              : {}),
            dimensions: docDimensions,
            fingerprint: before,
            signature: signature(file),
            indexedAt: new Date().toISOString(),
            vectors,
          };
          db.prepare(
            "INSERT INTO document_vectors(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
          ).run(doc.id, JSON.stringify(value));
          job.dimensions = docDimensions;
          item.status = "indexed";
        } catch (error) {
          if (job.status === "cancelling" || stopping || signal?.aborted) {
            item.status = "cancelled";
            save();
    try {
      scheduler?.updateProgress(job.id, {
        current: job.items.filter((i) => i.status === "indexed").length,
        total: job.items.length,
        detail: `${job.items.filter((i) => i.status === "indexed").length} of ${job.items.length} sources indexed`,
        status: job.status,
      });
    } catch {}
            break;
          }
          item.status = "failed";
          item.error =
            error.status === 400 || error.status === 502 || error.status === 504
              ? error.message
              : "Could not create vectors. Check the embedding and vector store test in Settings and source availability, then retry.";
        }
        save();
    try {
      scheduler?.updateProgress(job.id, {
        current: job.items.filter((i) => i.status === "indexed").length,
        total: job.items.length,
        detail: `${job.items.filter((i) => i.status === "indexed").length} of ${job.items.length} sources indexed`,
        status: job.status,
      });
    } catch {}
      }
      const cancelled = job.status === "cancelling" || stopping;
      for (const item of job.items)
        if (["queued", "running"].includes(item.status))
          item.status = "cancelled";
      job.status = cancelled
        ? "cancelled"
        : job.items.some((i) => i.status === "failed")
          ? "completed-with-errors"
          : "completed";
      job.finishedAt = new Date().toISOString();
      save();
    try {
      scheduler?.updateProgress(job.id, {
        current: job.items.filter((i) => i.status === "indexed").length,
        total: job.items.length,
        detail: `${job.items.filter((i) => i.status === "indexed").length} of ${job.items.length} sources indexed`,
        status: job.status,
      });
    } catch {}
    } finally {
      running = null;
      controller = null;
      jobActive = null;
    }
  }

  function start(ids) {
    if (running) throw invalid("An indexing job is already running.", 409);
    const active = activeState();
    if (!active.providerConfigured)
      throw invalid(
        "Complete the external embedding model and base URL in Settings, or select the bundled local model first.",
      );
    if (!active.vectorConfigured)
      throw invalid(
        "Complete the external vector store URL and collection in Settings, or select Built-in local SQLite first.",
      );
    const allowed = new Set(
      getDocuments()
        .filter((d) => !d.opportunityId)
        .map((d) => d.id),
    );
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 10000 ||
      ids.some((id) => typeof id !== "string" || !allowed.has(id))
    )
      throw invalid(
        "Select between 1 and 10,000 available library or read-only sources.",
      );
    jobActive = active;
    controller = new AbortController();
    job = {
      id: randomUUID(),
      provider: active.provider,
      model: active.modelKey,
      vectorBackend: active.vectorBackend,
      dimensions: active.provider === "builtin" ? 384 : 0,
      status: "running",
      startedAt: new Date().toISOString(),
      items: [...new Set(ids)].map((id) => ({
        id,
        status: "queued",
        chunks: 0,
      })),
    };
    try {
      scheduler?.enqueue({
        id: job.id,
        kind: "embedding-index",
        priority: "normal",
        payload: { documentIds: [...new Set(ids)], model: active.modelKey },
      });
      scheduler?.setRunning(job.id, controller);
    } catch {}
    save();
    try {
      scheduler?.updateProgress(job.id, {
        current: job.items.filter((i) => i.status === "indexed").length,
        total: job.items.length,
        detail: `${job.items.filter((i) => i.status === "indexed").length} of ${job.items.length} sources indexed`,
        status: job.status,
      });
    } catch {}
    running = new Promise((resolve) => setImmediate(resolve)).then(run); // return before inference starts
    return status();
    scheduler?.registerRunner("embedding-index", (task) => {
      if (task.payload?.documentIds?.length) {
        start(task.payload.documentIds);
      }
    });
  }
  return {
    status,
    search,
    selectSources,
    start,
    cancel() {
      if (running) {
        job.status = "cancelling";
        controller?.abort();
        save();
    try {
      scheduler?.updateProgress(job.id, {
        current: job.items.filter((i) => i.status === "indexed").length,
        total: job.items.length,
        detail: `${job.items.filter((i) => i.status === "indexed").length} of ${job.items.length} sources indexed`,
        status: job.status,
      });
    } catch {}
      }
      return status();
    },
    clear() {
      if (running)
        throw invalid(
          "Cancel and wait for indexing to stop before clearing vectors.",
          409,
        );
      const active = activeState();
      db.exec("DELETE FROM document_vectors");
      job = null;
      putConfig("vectorIndexJob", null);
      if (active.vectorBackend !== "sqlite" && active.vectorConfigured) {
        void deleteExternalVectors(
          active.raw,
          { clear: true },
          buddyFetch,
        ).catch(() => {});
      }
      return status();
    },
    async close() {
      stopping = true;
      controller?.abort();
      if (running) await running;
    },
  };
}
