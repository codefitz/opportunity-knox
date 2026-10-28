import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { codexStatus, runLocalCodex } from "../server/codex-local.mjs";
import { defaultBuddy, updateBuddy } from "../server/buddy-provider.mjs";
test("Codex provider clears API keys and fixes the internal bridge location", () => {
  const c = updateBuddy(
    { ...defaultBuddy(), apiKey: "fictional-private" },
    {
      revision: 1,
      provider: "codex",
      model: "default",
      enabled: true,
      apiKey: "not-needed",
      baseUrl: "https://other.example",
    },
  );
  assert.equal(c.apiKey, "");
  assert.equal(c.provider, "codex");
  assert.match(c.baseUrl, /codex-local/);
});
test("Codex queue validates readiness and model IDs, returns structured output, cleans private payloads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "knox-codex-test-"));
  try {
    assert.throws(() => codexStatus(dir), { status: 503 });
    writeFileSync(
      join(dir, "status.json"),
      JSON.stringify({ ready: true, time: Date.now() / 1000 }),
    );
    await assert.rejects(runLocalCodex({ model: "--bad" }, "", [], {}, dir), {
      status: 400,
    });
    const pending = runLocalCodex(
      { model: "default" },
      "Fictional instruction",
      [{ role: "user", content: "Fictional career data" }],
      { type: "object" },
      dir,
    );
    const file = readdirSync(dir).find((n) => n.endsWith(".request.json"));
    const job = JSON.parse(readFileSync(join(dir, file)));
    assert.match(job.prompt, /Fictional career data/);
    assert.ok(job.expiresAt > Date.now() / 1000);
    writeFileSync(
      join(dir, file.replace(".request.json", ".response.json")),
      JSON.stringify({ output: '{"ready":true}' }),
    );
    assert.equal(await pending, '{"ready":true}');
    assert.deepEqual(readdirSync(dir), ["status.json"]);
    writeFileSync(
      join(dir, "status.json"),
      JSON.stringify({ ready: true, time: 0 }),
    );
    assert.throws(() => codexStatus(dir), { status: 503 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Codex catalogue requests use the metadata queue and expose sanitized choices", async () => {
  const { listLocalCodexModels } = await import("../server/codex-local.mjs");
  const root = mkdtempSync(join(tmpdir(), "knox-catalogue-"));
  try {
    writeFileSync(
      join(root, "status.json"),
      JSON.stringify({ ready: true, time: Date.now() / 1000 }),
    );
    const pending = listLocalCodexModels(root);
    const file = readdirSync(root).find((n) => n.endsWith(".request.json"));
    const request = JSON.parse(readFileSync(join(root, file)));
    assert.equal(request.kind, "models");
    assert.ok(request.expiresAt < Date.now() / 1000 + 22);
    writeFileSync(
      join(root, file.replace(".request.json", ".response.json")),
      JSON.stringify({
        output: JSON.stringify({
          models: [
            { id: "default", name: "Default" },
            { id: "fictional-model", name: "Fictional model" },
          ],
          truncated: false,
        }),
      }),
    );
    const result = await pending;
    assert.equal(result.models[1].id, "fictional-model");
    assert.deepEqual(readdirSync(root), ["status.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
