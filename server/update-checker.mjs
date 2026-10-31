import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Compares two semver strings (e.g. "0.4.5" and "0.4.6").
 * Returns 1 if b > a, -1 if b < a, 0 if equal or invalid.
 */
export function isNewerVersion(current, latest) {
  if (!current || !latest) return false;
  const cleanA = String(current).replace(/^v/, "").trim();
  const cleanB = String(latest).replace(/^v/, "").trim();
  const partsA = cleanA.split(/[-+]/)[0].split(".").map(Number);
  const partsB = cleanB.split(/[-+]/)[0].split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numB > numA) return true;
    if (numB < numA) return false;
  }
  return false;
}

/**
 * Creates an UpdateChecker instance.
 */
export function createUpdateChecker(options = {}) {
  const repoDir = options.repoDir || process.cwd();
  const ttlMs = options.ttlMs ?? 60 * 60 * 1000; // 1 hour cache
  const fetcher = options.fetcher || globalThis.fetch;
  const githubRepo = options.githubRepo || "codefitz/opportunity-knox";

  let cachedStatus = null;
  let cacheExpiry = 0;

  function getCurrentVersion() {
    try {
      const pkg = JSON.parse(readFileSync(join(repoDir, "package.json"), "utf8"));
      return pkg.version || "0.0.0";
    } catch {
      return "0.0.0";
    }
  }

  async function checkGitAhead() {
    try {
      // Check if git working directory has commits upstream that can be seen locally
      const { stdout: localRev } = await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: repoDir,
        timeout: 2000,
      });
      const { stdout: remoteRev } = await execFileAsync(
        "git",
        ["rev-parse", "--verify", "origin/main"],
        {
          cwd: repoDir,
          timeout: 2000,
        },
      );
      if (localRev.trim() && remoteRev.trim() && localRev.trim() !== remoteRev.trim()) {
        const { stdout: counts } = await execFileAsync(
          "git",
          ["rev-list", "--count", "HEAD..origin/main"],
          { cwd: repoDir, timeout: 2000 },
        );
        const behind = parseInt(counts.trim(), 10);
        if (Number.isFinite(behind) && behind > 0) {
          return { behind, remoteRev: remoteRev.trim().slice(0, 7) };
        }
      }
    } catch {
      // Git not available or not cloned
    }
    return null;
  }

  async function checkGitHubRelease() {
    if (!fetcher) return null;
    try {
      const url = `https://api.github.com/repos/${githubRepo}/releases/latest`;
      const res = await fetcher(url, {
        headers: {
          "User-Agent": "OpportunityKnox-UpdateChecker",
          Accept: "application/vnd.github.v3+json",
        },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.tag_name) {
        return {
          version: data.tag_name.replace(/^v/, ""),
          releaseName: data.name || data.tag_name,
          releaseUrl: data.html_url || "",
          publishedAt: data.published_at,
        };
      }
    } catch {
      // Offline, network timeout, rate-limited, or blocked by sandbox
    }
    return null;
  }

  async function checkGitHubPackage() {
    if (!fetcher) return null;
    try {
      const url = `https://raw.githubusercontent.com/${githubRepo}/main/package.json`;
      const res = await fetcher(url, {
        headers: { "User-Agent": "OpportunityKnox-UpdateChecker" },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.version) {
        return {
          version: data.version,
          releaseUrl: `https://github.com/${githubRepo}`,
        };
      }
    } catch {
      // Offline, network timeout, rate-limited, or blocked by sandbox
    }
    return null;
  }

  async function checkGitHubCommit() {
    if (!fetcher) return null;
    try {
      const url = `https://api.github.com/repos/${githubRepo}/commits/main`;
      const res = await fetcher(url, {
        headers: {
          "User-Agent": "OpportunityKnox-UpdateChecker",
          Accept: "application/vnd.github.v3+json",
        },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.sha) {
        return {
          sha: data.sha,
          message: data.commit?.message?.split("\n")[0] || "",
          htmlUrl: data.html_url || `https://github.com/${githubRepo}/commits/main`,
        };
      }
    } catch {
      // Offline, network timeout, rate-limited, or blocked by sandbox
    }
    return null;
  }

  async function checkForUpdates(force = false) {
    const now = Date.now();
    if (!force && cachedStatus && now < cacheExpiry) {
      return cachedStatus;
    }

    const currentVersion = getCurrentVersion();
    let latestVersion = currentVersion;
    let updateAvailable = false;
    let releaseUrl = "";
    let reason = "";

    // 1. Try checking GitHub release
    const ghRelease = await checkGitHubRelease();
    if (ghRelease && isNewerVersion(currentVersion, ghRelease.version)) {
      updateAvailable = true;
      latestVersion = ghRelease.version;
      releaseUrl = ghRelease.releaseUrl;
      reason = `New version ${ghRelease.version} is available.`;
    }

    // 2. Try checking upstream raw package.json if no release tag was published
    if (!updateAvailable) {
      const ghPkg = await checkGitHubPackage();
      if (ghPkg && isNewerVersion(currentVersion, ghPkg.version)) {
        updateAvailable = true;
        latestVersion = ghPkg.version;
        releaseUrl = ghPkg.releaseUrl;
        reason = `New version ${ghPkg.version} is available on GitHub.`;
      }
    }

    // 3. Try checking git commits behind origin/main if local git exists
    if (!updateAvailable) {
      const gitStatus = await checkGitAhead();
      if (gitStatus && gitStatus.behind > 0) {
        updateAvailable = true;
        reason = `${gitStatus.behind} new update(s) available from git.`;
      }
    }

    cachedStatus = {
      updateAvailable,
      currentVersion,
      latestVersion,
      releaseUrl,
      reason,
      checkedAt: new Date(now).toISOString(),
    };
    cacheExpiry = now + ttlMs;

    return cachedStatus;
  }

  function getStatusSync() {
    return (
      cachedStatus || {
        updateAvailable: false,
        currentVersion: getCurrentVersion(),
        latestVersion: getCurrentVersion(),
        releaseUrl: "",
        reason: "",
        checkedAt: null,
      }
    );
  }

  return {
    getCurrentVersion,
    checkForUpdates,
    getStatusSync,
    _setCachedStatus: (status) => {
      cachedStatus = status;
      cacheExpiry = Date.now() + ttlMs;
    },
  };
}
