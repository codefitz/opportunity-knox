import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createApp } from "../server/app.mjs";
const root = mkdtempSync("/tmp/knox-offline-vector-");
const options = {
  dataDir: join(root, "state"),
  filesDir: join(root, "files"),
  setupToken: "fictional-test-token",
};
let app,
  base,
  cookie = "";
async function open() {
  app = createApp(options);
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${app.server.address().port}`;
}
async function request(path, body, method = body ? "POST" : "GET") {
  const res = await fetch(base + "/api" + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  assert.ok(res.ok, JSON.stringify(data));
  if (res.headers.get("set-cookie"))
    cookie = res.headers.get("set-cookie").split(";")[0];
  return data;
}
try {
  await open();
  await request("/setup", {
    password: "fictional-test-password-long",
    token: "fictional-test-token",
  });
  const text =
    "Fictional candidate delivered a data platform and improved fictional reports. ".repeat(
      45,
    );
  const doc = await request("/documents", {
    name: "fictional-offline.txt",
    contentBase64: Buffer.from(text).toString("base64"),
  });
  await request("/buddy/vector-index", { documentIds: [doc.id] });
  let status;
  for (let i = 0; i < 240; i++) {
    status = await request("/buddy/vector-index");
    if (!["running", "cancelling"].includes(status.job.status)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(status.job.status, "completed");
  assert.equal(status.sources[0].status, "indexed");
  const saved = JSON.parse(
    app.db.prepare("SELECT data FROM document_vectors WHERE id=?").get(doc.id)
      .data,
  );
  assert.ok(saved.vectors.length > 1);
  for (const v of saved.vectors) {
    assert.equal(v.values.length, 384);
    assert.ok(v.values.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...v.values) - 1) < 0.001);
  }
  const original = JSON.parse(
    app.db.prepare("SELECT data FROM documents WHERE id=?").get(doc.id).data,
  );
  assert.equal(
    createHash("sha256")
      .update(readFileSync(join(original.storageRoot, original.relativePath)))
      .digest("hex"),
    createHash("sha256").update(text).digest("hex"),
  );
  await app.close();
  await open();
  await request("/login", { password: "fictional-test-password-long" });
  status = await request("/buddy/vector-index");
  assert.equal(status.sources[0].status, "indexed");
  console.log(
    `OFFLINE INDEX PASS: ${saved.vectors.length} persisted chunks, 384 normalized dimensions, unchanged original, restart verified.`,
  );
} finally {
  if (app) await app.close();
}
