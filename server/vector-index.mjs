import { readFileSync, statSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { embedLocal, LOCAL_MODEL, LOCAL_REVISION } from "./local-embedding.mjs";

const model = `${LOCAL_MODEL}@${LOCAL_REVISION}:q8:mean:normalized:384`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const signature = (file) => {
  const s = statSync(file);
  return `${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
};
const invalid = (message, status = 400) =>
  Object.assign(new Error(message), { status });

export function createVectorIndex({
  db,
  getDocuments,
  documentPath,
  indexDocuments,
  getConfig,
  putConfig,
  embed = embedLocal,
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS document_vectors (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS vectors_text_deleted AFTER DELETE ON document_text BEGIN DELETE FROM document_vectors WHERE id=OLD.id; END;
    CREATE TRIGGER IF NOT EXISTS vectors_text_updated AFTER UPDATE ON document_text BEGIN DELETE FROM document_vectors WHERE id=OLD.id; END;`);
  let job = getConfig("vectorIndexJob") || null,
    running = null,
    stopping = false;
  const save = () => putConfig("vectorIndexJob", job);
  if (job && ["running", "cancelling"].includes(job.status)) {
    job.status = "interrupted";
    job.finishedAt = new Date().toISOString();
    save();
  }
  const get = (id) => {
    const row = db
      .prepare("SELECT data FROM document_vectors WHERE id=?")
      .get(id);
    return row ? JSON.parse(row.data) : null;
  };
  const remove = (id) =>
    db.prepare("DELETE FROM document_vectors WHERE id=?").run(id);
  function status() {
    const docs = getDocuments().filter((d) => !d.opportunityId);
    const available = new Set(docs.map((d) => d.id));
    for (const row of db.prepare("SELECT id FROM document_vectors").all())
      if (!available.has(row.id)) remove(row.id);
    return {
      model: LOCAL_MODEL,
      revision: LOCAL_REVISION,
      dimensions: 384,
      job,
      sources: docs.map((doc) => {
        let cached = get(doc.id),
          state = "pending";
        if (cached) {
          try {
            state =
              cached.model === model &&
              cached.signature === signature(documentPath(doc))
                ? "indexed"
                : "stale";
          } catch {
            state = "unavailable";
          }
          if (state !== "indexed") {
            remove(doc.id);
            cached = null;
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
      }),
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
    if ((getConfig("embeddingSettings")?.provider || "builtin") !== "builtin")
      return fallback("external-provider");
    if (running) return fallback("indexing-in-progress");
    const candidates = documents
      .filter((d) => d.status === "ready")
      .flatMap((doc) => {
        const cached = get(doc.id);
        if (
          !cached ||
          cached.model !== model ||
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
    let vector;
    try {
      [vector] = await embed([query.slice(0, 12000)]);
      if (
        !Array.isArray(vector) ||
        vector.length !== 384 ||
        vector.some((n) => typeof n !== "number" || !Number.isFinite(n)) ||
        Math.abs(Math.hypot(...vector) - 1) > 0.01
      )
        throw Error("invalid");
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
    for (const item of candidates) {
      // Text resets, source deselection and index clearing during inference invalidate the snapshot.
      const current = currentBySource.get(item.sourceId);
      if (
        !valid.has(item.sourceId) ||
        current?.model !== model ||
        current?.fingerprint !== fingerprints.get(item.sourceId)
      )
        continue;
      if (
        !Array.isArray(item.values) ||
        item.values.length !== 384 ||
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
    let queryVector;
    if ((getConfig("embeddingSettings")?.provider || "builtin") === "builtin")
      try {
        [queryVector] = await embed([query.slice(0, 12000)]);
      } catch {}
    return candidates
      .map((doc, order) => {
        const cached = get(doc.id);
        let score = 0;
        if (queryVector?.length === 384 && cached?.model === model)
          for (const v of cached.vectors || []) {
            if (v.values?.length === 384)
              score = Math.max(
                score,
                v.values.reduce((sum, n, i) => sum + n * queryVector[i], 0),
              );
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
    try {
      for (const item of job.items) {
        if (job.status === "cancelling" || stopping) break;
        item.status = "running";
        save();
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
          if (existing?.fingerprint === before && existing.model === model) {
            existing.signature = signature(file);
            db.prepare("UPDATE document_vectors SET data=? WHERE id=?").run(
              JSON.stringify(existing),
              doc.id,
            );
            item.status = "indexed";
            item.chunks = existing.vectors.length;
            save();
            continue;
          }
          remove(doc.id);
          const [text] = await indexDocuments([doc.id]);
          if (text.status !== "ready" || !text.chunks.length)
            throw invalid(
              "No readable text. Prepare text or OCR this source first.",
            );
          const vectors = [];
          item.totalChunks = text.chunks.length;
          item.chunks = 0;
          save();
          for (let offset = 0; offset < text.chunks.length; offset += 2) {
            if (job.status === "cancelling" || stopping) break;
            const chunks = text.chunks.slice(offset, offset + 2);
            const batch = await embed(chunks.map((c) => c.text));
            if (
              !Array.isArray(batch) ||
              batch.length !== chunks.length ||
              batch.some(
                (v) =>
                  !Array.isArray(v) ||
                  v.length !== 384 ||
                  v.some((n) => typeof n !== "number" || !Number.isFinite(n)) ||
                  Math.abs(Math.hypot(...v) - 1) > 0.01,
              )
            )
              throw invalid("The embedding model returned invalid vectors.");
            vectors.push(
              ...chunks.map((c, i) => ({
                index: c.index,
                hash: hash(c.text),
                values: batch[i],
              })),
            );
            item.chunks = vectors.length;
            save();
            await new Promise((resolve) => setImmediate(resolve));
          }
          if (job.status === "cancelling" || stopping) {
            item.status = "cancelled";
            save();
            break;
          }
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
          const value = {
            id: doc.id,
            model,
            fingerprint: before,
            signature: signature(file),
            indexedAt: new Date().toISOString(),
            vectors,
          };
          db.prepare(
            "INSERT INTO document_vectors(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
          ).run(doc.id, JSON.stringify(value));
          item.status = "indexed";
        } catch (error) {
          item.status = "failed";
          item.error =
            error.status === 400
              ? error.message
              : "Could not create vectors. Check the built-in model test in Settings and source availability, then retry.";
        }
        save();
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
    } finally {
      running = null;
    }
  }
  function start(ids) {
    if (running) throw invalid("An indexing job is already running.", 409);
    if ((getConfig("embeddingSettings")?.provider || "builtin") !== "builtin")
      throw invalid(
        "This indexing release uses the bundled local model. Select Built-in local in Settings first.",
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
    job = {
      id: randomUUID(),
      model,
      status: "running",
      startedAt: new Date().toISOString(),
      items: [...new Set(ids)].map((id) => ({
        id,
        status: "queued",
        chunks: 0,
      })),
    };
    save();
    running = new Promise((resolve) => setImmediate(resolve)).then(run); // return before inference starts
    return status();
  }
  return {
    status,
    search,
    selectSources,
    start,
    cancel() {
      if (running) {
        job.status = "cancelling";
        save();
      }
      return status();
    },
    clear() {
      if (running)
        throw invalid(
          "Cancel and wait for indexing to stop before clearing vectors.",
          409,
        );
      db.exec("DELETE FROM document_vectors");
      job = null;
      putConfig("vectorIndexJob", null);
      return status();
    },
    async close() {
      stopping = true;
      if (running) await running;
    },
  };
}
