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
