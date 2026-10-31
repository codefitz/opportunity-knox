import test from "node:test";
import assert from "node:assert/strict";
import {
  isNewerVersion,
  createUpdateChecker,
} from "../server/update-checker.mjs";

test("isNewerVersion compares semver versions correctly", () => {
  assert.equal(isNewerVersion("0.4.5", "0.4.6"), true);
  assert.equal(isNewerVersion("0.4.5", "0.5.0"), true);
  assert.equal(isNewerVersion("0.4.5", "1.0.0"), true);
  assert.equal(isNewerVersion("0.4.5", "v0.4.6"), true);
  assert.equal(isNewerVersion("v0.4.5", "0.4.6"), true);

  assert.equal(isNewerVersion("0.4.6", "0.4.5"), false);
  assert.equal(isNewerVersion("0.4.5", "0.4.5"), false);
  assert.equal(isNewerVersion("0.4.5", null), false);
  assert.equal(isNewerVersion(null, "0.4.5"), false);
});

test("createUpdateChecker detects newer release via mocked fetcher", async () => {
  const mockFetcher = async () => ({
    ok: true,
    json: async () => ({
      tag_name: "v0.5.0",
      name: "Version 0.5.0",
      html_url:
        "https://github.com/codefitz/opportunity-knox/releases/tag/v0.5.0",
      published_at: "2026-10-31T12:00:00Z",
    }),
  });

  const checker = createUpdateChecker({
    fetcher: mockFetcher,
    repoDir: process.cwd(),
  });

  const status = await checker.checkForUpdates(true);
  assert.equal(status.updateAvailable, true);
  assert.equal(status.latestVersion, "0.5.0");
  assert.ok(status.currentVersion);
  assert.equal(
    status.releaseUrl,
    "https://github.com/codefitz/opportunity-knox/releases/tag/v0.5.0",
  );
});

test("createUpdateChecker handles offline / fetch failure gracefully", async () => {
  const failingFetcher = async () => {
    throw new Error("Network unreachable");
  };

  const checker = createUpdateChecker({
    fetcher: failingFetcher,
    repoDir: process.cwd(),
  });

  const status = await checker.checkForUpdates(true);
  assert.equal(status.updateAvailable, false);
  assert.ok(status.currentVersion);
});

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("local source changes bypass remote cache and clear after reverting; stale observations are ignored", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "board-update-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceStatusPath = join(root, "source-status.json");
  const baseline = "a".repeat(64);
  let requests = 0;
  const checker = createUpdateChecker({
    buildHash: baseline,
    sourceStatusPath,
    fetcher: async () => {
      requests++;
      throw new Error("offline");
    },
  });
  const save = (hash, checkedAt = Date.now() / 1000) =>
    writeFileSync(
      sourceStatusPath,
      JSON.stringify({ sourceHash: hash, checkedAt }),
    );
  save(baseline);
  assert.equal((await checker.checkForUpdates()).updateAvailable, false);
  const before = requests;
  save("b".repeat(64));
  const changed = await checker.checkForUpdates();
  assert.equal(changed.localUpdateAvailable, true);
  assert.match(changed.reason, /Local code has changed/);
  assert.match(changed.checkError, /GitHub/);
  assert.equal(requests, before);
  assert.equal(checker.getStatusSync().updateAvailable, true);
  save(baseline);
  assert.equal(checker.getStatusSync().updateAvailable, false);
  save("b".repeat(64), Date.now() / 1000 - 180);
  assert.equal(checker.getStatusSync().localCheckAvailable, false);
  assert.equal(checker.getStatusSync().updateAvailable, false);
});

test("same-version upstream commits require a fast-forward comparison against installed build", async () => {
  for (const relation of ["ahead", "behind", "diverged", "identical"]) {
    const urls = [];
    const checker = createUpdateChecker({
      buildCommit: "a".repeat(40),
      buildHash: "",
      sourceStatusPath: "/nonexistent/source-status.json",
      fetcher: async (url) => {
        urls.push(url);
        if (url.endsWith("/releases/latest")) return { ok: false, status: 404 };
        if (url.endsWith("/package.json"))
          return { ok: true, json: async () => ({ version: "0.4.6" }) };
        if (url.endsWith("/commits/main"))
          return { ok: true, json: async () => ({ sha: "b".repeat(40) }) };
        return {
          ok: true,
          json: async () => ({ status: relation, ahead_by: 2 }),
        };
      },
    });
    const status = await checker.checkForUpdates();
    assert.equal(status.updateAvailable, relation === "ahead");
    assert.ok(urls.some((url) => url.includes("/compare/" + "a".repeat(40))));
    assert.equal(status.checkError, "");
    if (relation === "ahead")
      assert.match(status.reason, /Pull the updated code/);
  }
});

test("concurrent update checks share remote work", async () => {
  let requests = 0;
  const checker = createUpdateChecker({
    buildCommit: "",
    fetcher: async () => {
      requests++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true, json: async () => ({ tag_name: "v99.0.0" }) };
    },
  });
  await Promise.all([
    checker.checkForUpdates(true),
    checker.checkForUpdates(true),
  ]);
  assert.equal(requests, 1);
});
