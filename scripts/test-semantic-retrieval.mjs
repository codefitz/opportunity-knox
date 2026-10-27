// Run with bundled model files available. Uses fictional evidence only.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createVectorIndex } from "../server/vector-index.mjs";
import { retrieveHybridChunks } from "../server/buddy-documents.mjs";
const root = mkdtempSync(join(tmpdir(), "knox-semantic-quality-"));
const db = new DatabaseSync(join(root, "quality.sqlite"));
db.exec(
  "CREATE TABLE document_text(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE config(key TEXT PRIMARY KEY,data TEXT NOT NULL)",
);
const texts = [
  "Fictional career summary.",
  "I baked sourdough bread and cultivated roses in a community garden.",
  "I mentored junior engineers, coached colleagues and led a cross-functional team.",
  "I led a cloud migration, moving on-premise workloads into Azure and reducing hosting expenditure.",
  "I defined data ownership, quality checks and policies for handling sensitive records.",
];
const file = join(root, "fictional.txt"),
  bytes = Buffer.from(texts.join("\n"));
writeFileSync(file, bytes);
const doc = {
  id: "fictional",
  name: "Fictional career notes.txt",
  kind: "cv",
  status: "ready",
  fingerprint: createHash("sha256").update(bytes).digest("hex"),
  chunks: texts.map((text, i) => ({ index: i + 1, text })),
};
const config = new Map();
const index = createVectorIndex({
  db,
  getDocuments: () => [doc],
  documentPath: () => file,
  getConfig: (key) => config.get(key),
  putConfig: (key, value) => config.set(key, value),
  indexDocuments: async () => {
    db.prepare(
      "INSERT INTO document_text VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
    ).run(doc.id, JSON.stringify(doc));
    return [doc];
  },
});
try {
  index.start([doc.id]);
  for (let i = 0; i < 240; i++) {
    if (index.status().job.status === "completed") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(index.status().job.status, "completed");
  for (const [query, expected] of [
    ["What experience demonstrates people management?", 3],
    ["Have I delivered infrastructure modernisation?", 4],
    ["Can I show information stewardship?", 5],
  ]) {
    const semantic = await index.search([doc], query);
    assert.equal(semantic.mode, "hybrid");
    const top = [...semantic.scores].sort((a, b) => b[1] - a[1])[0];
    assert.equal(top[0], `fictional:${expected}`, query);
    const retrieval = retrieveHybridChunks(
      semantic.documents,
      query,
      semantic.scores,
      140,
    );
    assert.ok(
      retrieval.chunks.some((c) => c.index === expected),
      query,
    );
    assert.ok(retrieval.characters <= 140);
    console.log(`PASS: ${query} → passage ${expected} (within 140 characters)`);
  }
  index.clear();
  const fallback = await index.search([doc], "people management");
  assert.equal(fallback.reason, "not-indexed");
  console.log(
    "OFFLINE HYBRID PASS: 3/3 fictional synonym queries, source references, bounded context and no-index fallback.",
  );
} finally {
  await index.close();
  db.close();
  rmSync(root, { recursive: true, force: true });
}
