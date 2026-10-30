import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createVectorIndex } from "../server/vector-index.mjs";
const vector = () => [1, ...Array(383).fill(0)];
async function fixture(t, embed = async (texts) => texts.map(vector)) {
  const root = mkdtempSync(join(tmpdir(), "knox-vector-")),
    db = new DatabaseSync(join(root, "test.sqlite"));
  db.exec(
    "CREATE TABLE document_text(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE config(key TEXT PRIMARY KEY,data TEXT NOT NULL)",
  );
  let docs = [{ id: "fiction", name: "Fictional experience.txt" }];
  const file = join(root, "fiction.txt");
  writeFileSync(file, "Fictional project achievement.");
  const getConfig = (key) => {
    const r = db.prepare("SELECT data FROM config WHERE key=?").get(key);
    return r ? JSON.parse(r.data) : null;
  };
  const putConfig = (key, data) =>
    db
      .prepare(
        "INSERT INTO config VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
      )
      .run(key, JSON.stringify(data));
  const { readFileSync } = await import("node:fs");
  const ctx = {
    db,
    getDocuments: () => docs,
    documentPath: () => file,
    getConfig,
    putConfig,
    embed,
    indexDocuments: async (ids) =>
      ids.map((id) => {
        const bytes = readFileSync(file);
        const data = {
          id,
          status: "ready",
          fingerprint: createHash("sha256").update(bytes).digest("hex"),
          chunks: [1, 2, 3].map((index) => ({
            index,
            text: bytes.toString() + index,
          })),
        };
        db.prepare(
          "INSERT INTO document_text VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        ).run(id, JSON.stringify(data));
        return data;
      }),
  };
  let index = createVectorIndex(ctx);
  t.after(async () => {
    await index.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    db,
    file,
    index,
    ctx,
    remove: () => {
      docs = [];
    },
    reopen: async () => {
      await index.close();
      index = createVectorIndex(ctx);
      return index;
    },
  };
}
async function wait(index) {
  for (let i = 0; i < 200; i++) {
    const s = index.status();
    if (!["running", "cancelling"].includes(s.job?.status)) return s;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("Index job timed out");
}
test("vectors persist, unchanged sources reuse embeddings, changed files invalidate, text reset and deselection remove vectors", async (t) => {
  let calls = 0;
  const f = await fixture(t, async (texts) => {
    calls++;
    return texts.map(vector);
  });
  f.index.start(["fiction"]);
  let status = await wait(f.index);
  assert.equal(status.sources[0].chunks, 3);
  assert.equal(status.job.status, "completed");
  assert.equal(calls, 2);
  const reopened = await f.reopen();
  assert.equal(reopened.status().sources[0].status, "indexed");
  reopened.start(["fiction"]);
  await wait(reopened);
  assert.equal(calls, 2);
  writeFileSync(f.file, "Fictional revised achievement.");
  assert.equal(reopened.status().sources[0].status, "stale");
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM document_vectors").get().n,
    0,
  );
  reopened.start(["fiction"]);
  await wait(reopened);
  assert.equal(calls, 4);
  f.db.prepare("DELETE FROM document_text WHERE id=?").run("fiction");
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM document_vectors").get().n,
    0,
  );
  reopened.start(["fiction"]);
  await wait(reopened);
  f.remove();
  assert.equal(reopened.status().sources.length, 0);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM document_vectors").get().n,
    0,
  );
});
test("cancellation discards partial vectors, refuses concurrent work and permits explicit retry", async (t) => {
  let release;
  let entered;
  const ready = new Promise((r) => (entered = r));
  const gate = new Promise((r) => (release = r));
  let first = true;
  const f = await fixture(t, async (texts) => {
    if (first) {
      first = false;
      entered();
      await gate;
    }
    return texts.map(vector);
  });
  f.index.start(["fiction"]);
  await ready;
  assert.throws(() => f.index.start(["fiction"]), { status: 409 });
  assert.throws(() => f.index.clear(), { status: 409 });
  f.index.cancel();
  release();
  const stopped = await wait(f.index);
  assert.equal(stopped.job.status, "cancelled");
  assert.equal(stopped.sources[0].chunks, 0);
  f.index.start(["fiction"]);
  assert.equal((await wait(f.index)).job.status, "completed");
  f.index.clear();
  assert.equal(f.index.status().sources[0].chunks, 0);
});
test("rejects invalid vectors and source changes during inference; interrupted jobs never restart automatically", async (t) => {
  const f = await fixture(t, async (texts) => texts.map(() => [NaN]));
  f.index.start(["fiction"]);
  assert.equal((await wait(f.index)).job.status, "completed-with-errors");
  assert.equal(f.index.status().sources[0].chunks, 0);
  f.ctx.embed = async (texts) => {
    writeFileSync(f.file, "Fictional changed during inference");
    return texts.map(vector);
  };
  const second = await f.reopen();
  second.start(["fiction"]);
  assert.equal((await wait(second)).job.status, "completed-with-errors");
  f.ctx.putConfig("vectorIndexJob", {
    status: "running",
    items: [{ id: "fiction", status: "running", chunks: 0 }],
  });
  const third = await f.reopen();
  assert.equal(third.status().job.status, "interrupted");
  assert.equal(third.status().sources[0].chunks, 0);
  f.ctx.putConfig("embeddingSettings", { provider: "ollama" });
  assert.throws(() => third.start(["fiction"]), /bundled local/);
});

test("semantic search is selection-scoped, validates chunks and falls back without indexing automatically", async (t) => {
  let calls = 0,
    fail = false;
  const f = await fixture(t, async (texts) => {
    calls++;
    if (fail) throw Error("fictional model unavailable");
    return texts.map(vector);
  });
  let docs = await f.ctx.indexDocuments(["fiction"]);
  assert.equal(
    (await f.index.search(docs, "leadership")).reason,
    "not-indexed",
  );
  assert.equal(calls, 0);
  f.index.start(["fiction"]);
  await wait(f.index);
  const hit = await f.index.search(docs, "leadership");
  assert.equal(hit.mode, "hybrid");
  assert.equal(hit.scores.size, 3);
  assert.equal(hit.indexedSources, 1);
  assert.equal((await f.index.search([], "leadership")).scores.size, 0);
  const forged = [
    {
      ...docs[0],
      chunks: docs[0].chunks.map((c) => ({
        ...c,
        text: "Different fictional text",
      })),
    },
  ];
  assert.equal((await f.index.search(forged, "leadership")).scores.size, 0);
  fail = true;
  assert.equal(
    (await f.index.search(docs, "leadership")).reason,
    "model-unavailable",
  );
  fail = false;
  f.ctx.putConfig("embeddingSettings", { provider: "ollama" });
  assert.equal(
    (await f.index.search(docs, "leadership")).reason,
    "external-provider",
  );
  f.ctx.putConfig("embeddingSettings", { provider: "builtin" });
  const row = JSON.parse(
    f.db.prepare("SELECT data FROM document_vectors WHERE id=?").get("fiction")
      .data,
  );
  row.model = "incompatible";
  f.db
    .prepare("UPDATE document_vectors SET data=? WHERE id=?")
    .run(JSON.stringify(row), "fiction");
  assert.equal(
    (await f.index.search(docs, "leadership")).reason,
    "not-indexed",
  );
});

test("semantic search excludes sources changed, cleared or deselected while the query model is running", async (t) => {
  let operation = () => {};
  const f = await fixture(t, async (texts) => {
    operation();
    return texts.map(vector);
  });
  f.index.start(["fiction"]);
  await wait(f.index);
  const docs = await f.ctx.indexDocuments(["fiction"]);
  // Preparing unchanged fixture text performs an UPDATE; reindex after the test fixture resets its cache.
  f.index.start(["fiction"]);
  await wait(f.index);
  operation = () => f.index.clear();
  let result = await f.index.search(docs, "leadership");
  assert.equal(result.scores.size, 0);
  operation = () => {};
  f.index.start(["fiction"]);
  await wait(f.index);
  operation = () => writeFileSync(f.file, "Changed fictional evidence");
  result = await f.index.search(docs, "leadership");
  assert.equal(result.documents[0].status, "unavailable");
  assert.equal(result.documents[0].chunks.length, 0);
  assert.equal(result.scores.size, 0);
  operation = () => {};
  f.index.start(["fiction"]);
  await wait(f.index);
  const current = JSON.parse(
    f.db.prepare("SELECT data FROM document_text WHERE id=?").get("fiction")
      .data,
  );
  operation = f.remove;
  result = await f.index.search([current], "leadership");
  assert.equal(result.documents[0].chunks.length, 0);
  assert.equal(result.scores.size, 0);
});

test("external embedding providers index non-384 vectors in SQLite, normalize vectors and invalidate on model change", async (t) => {
  const f = await fixture(t);
  let embedCalls = 0;
  f.ctx.buddyFetch = async (url, init) => {
    embedCalls++;
    assert.equal(url, "http://localhost:11434/api/embed");
    const body = JSON.parse(init.body);
    assert.equal(body.model, "nomic-embed-text");
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    return new Response(
      JSON.stringify({
        model: "nomic-embed-text",
        embeddings: inputs.map((_, idx) => [
          3,
          4,
          ...Array(766).fill(idx === 0 ? 0 : 0),
        ]),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  f.ctx.putConfig("embeddingSettings", {
    provider: "ollama",
    model: "nomic-embed-text",
    baseUrl: "http://localhost:11434",
    vectorBackend: "sqlite",
  });
  const active = await f.reopen();
  assert.equal(active.status().provider, "ollama");
  assert.equal(active.status().model, "nomic-embed-text");
  assert.equal(active.status().configured, true);
  active.start(["fiction"]);
  const done = await wait(active);
  assert.equal(done.job.status, "completed");
  assert.equal(done.dimensions, 768);
  assert.equal(done.sources[0].status, "indexed");
  assert.equal(done.sources[0].chunks, 3);
  assert.equal(embedCalls, 2);

  // Verify stored vectors are normalized to unit length (3/5 = 0.6, 4/5 = 0.8)
  const stored = JSON.parse(
    f.db.prepare("SELECT data FROM document_vectors WHERE id=?").get("fiction")
      .data,
  );
  assert.equal(stored.dimensions, 768);
  assert.ok(Math.abs(stored.vectors[0].values[0] - 0.6) < 1e-6);
  assert.ok(Math.abs(stored.vectors[0].values[1] - 0.8) < 1e-6);

  // Hybrid search uses external embedding provider and matches normalized vectors
  const docs = await f.ctx.indexDocuments(["fiction"]);
  active.start(["fiction"]);
  await wait(active);
  const searchRes = await active.search(docs, "fictional leadership");
  assert.equal(searchRes.mode, "hybrid");
  assert.equal(searchRes.indexedSources, 1);
  assert.equal(searchRes.scores.size, 3);
  assert.ok(Math.abs(searchRes.scores.get("fiction:1") - 1) < 1e-5);

  const selected = await active.selectSources("fictional leadership", [
    { id: "fiction", name: "Fictional experience.txt" },
  ]);
  assert.deepEqual(selected, ["fiction"]);

  // Changing the embedding model invalidates the previous model's vectors without deleting files
  f.ctx.putConfig("embeddingSettings", {
    provider: "ollama",
    model: "mxbai-embed-large",
    baseUrl: "http://localhost:11434",
    vectorBackend: "sqlite",
  });
  assert.equal(active.status().sources[0].status, "stale");
  const afterModelChange = await active.search(docs, "fictional leadership");
  assert.equal(afterModelChange.mode, "keyword");
  assert.equal(afterModelChange.reason, "not-indexed");
});

test("external vector backends (Qdrant and custom HTTP) store and query vectors without raw text and enforce selection and hash boundaries", async (t) => {
  const f = await fixture(t);
  const qdrantPoints = new Map();
  let collectionDims = null;
  let qdrantDeleted = 0;

  f.ctx.buddyFetch = async (url, init = {}) => {
    const method = init.method || "GET";
    if (url === "http://localhost:11434/api/embed") {
      const body = JSON.parse(init.body);
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return new Response(
        JSON.stringify({
          model: body.model,
          embeddings: inputs.map(() => [0.6, 0.8, ...Array(14).fill(0)]),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (
      url === "http://localhost:6333/collections/fictional_chunks" &&
      method === "GET"
    ) {
      if (!collectionDims)
        return new Response(JSON.stringify({ status: { error: "Not found" } }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      return new Response(
        JSON.stringify({
          result: {
            config: { params: { vectors: { size: collectionDims } } },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (
      url === "http://localhost:6333/collections/fictional_chunks" &&
      method === "PUT"
    ) {
      const body = JSON.parse(init.body);
      collectionDims = body.vectors.size;
      return new Response(JSON.stringify({ result: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (
      url ===
        "http://localhost:6333/collections/fictional_chunks/points/delete?wait=true" &&
      method === "POST"
    ) {
      qdrantDeleted++;
      return new Response(JSON.stringify({ result: { status: "acknowledged" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (
      url ===
        "http://localhost:6333/collections/fictional_chunks/points?wait=true" &&
      method === "PUT"
    ) {
      const body = JSON.parse(init.body);
      for (const pt of body.points) {
        // Ensure raw document text is never sent to the external vector store
        assert.equal("text" in pt.payload, false);
        qdrantPoints.set(pt.id, pt);
      }
      return new Response(JSON.stringify({ result: { status: "completed" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (
      url ===
        "http://localhost:6333/collections/fictional_chunks/points/search" &&
      method === "POST"
    ) {
      const points = [...qdrantPoints.values()].map((pt) => ({
        id: pt.id,
        score: 0.94,
        payload: pt.payload,
      }));
      // Also inject an unselected source from the external store to verify client-side boundary filtering
      points.push({
        id: "unselected-uuid",
        score: 0.99,
        payload: {
          sourceId: "unselected-doc",
          index: 1,
          hash: "forged",
        },
      });
      return new Response(JSON.stringify({ result: points }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw Error("Unexpected URL: " + method + " " + url);
  };

  f.ctx.putConfig("embeddingSettings", {
    provider: "ollama",
    model: "nomic-embed-text",
    baseUrl: "http://localhost:11434",
    vectorBackend: "qdrant",
    vectorUrl: "http://localhost:6333",
    vectorCollection: "fictional_chunks",
  });

  const active = await f.reopen();
  assert.equal(active.status().vectorBackend, "qdrant");
  assert.equal(active.status().vectorCollection, "fictional_chunks");
  active.start(["fiction"]);
  const done = await wait(active);
  assert.equal(done.job.status, "completed");
  assert.equal(done.dimensions, 16);
  assert.equal(collectionDims, 16);
  assert.equal(qdrantPoints.size, 3);

  const metaRow = JSON.parse(
    f.db.prepare("SELECT data FROM document_vectors WHERE id=?").get("fiction")
      .data,
  );
  assert.equal(metaRow.vectorBackend, "qdrant");
  assert.equal(metaRow.vectorCollection, "fictional_chunks");
  assert.equal(metaRow.vectors.length, 3);

  const docs = await f.ctx.indexDocuments(["fiction"]);
  active.start(["fiction"]);
  await wait(active);

  const searchRes = await active.search(docs, "fictional query");
  assert.equal(searchRes.mode, "hybrid");
  assert.equal(searchRes.scores.size, 3);
  assert.equal(searchRes.scores.has("unselected-doc:1"), false);
  assert.equal(searchRes.scores.get("fiction:1"), 0.94);

  // If Qdrant returns a tampered chunk hash, it is rejected by local SQLite hash verification
  for (const pt of qdrantPoints.values()) {
    pt.payload.hash = "tampered-hash";
  }
  const tamperedRes = await active.search(docs, "fictional query");
  assert.equal(tamperedRes.scores.size, 0);
});
