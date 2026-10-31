import test from "node:test";
import assert from "node:assert/strict";
import { isNewerVersion, createUpdateChecker } from "../server/update-checker.mjs";

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
      html_url: "https://github.com/codefitz/opportunity-knox/releases/tag/v0.5.0",
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
  assert.equal(status.releaseUrl, "https://github.com/codefitz/opportunity-knox/releases/tag/v0.5.0");
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
