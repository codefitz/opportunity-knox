import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Compares two semver strings (e.g. "0.4.5" and "0.4.6").
 * A stable release supersedes a prerelease with the same numeric version.
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
  return (
    cleanA.split("+")[0].includes("-") && !cleanB.split("+")[0].includes("-")
  );
}

/**
 * Creates an UpdateChecker instance.
 */
export function createUpdateChecker(options = {}) {
  const repoDir = options.repoDir || process.cwd();
  const ttlMs = options.ttlMs ?? 5 * 60 * 1000; // Cache remote checks; local changes are checked every request.
  const fetcher = options.fetcher || globalThis.fetch;
  const githubRepo = options.githubRepo || "codefitz/opportunity-knox";

  // Direct Node development runs have Git; Docker uses immutable launcher metadata.
  let localCommit = "",
    localDirty = false;
  if (
    options.buildCommit === undefined &&
    !process.env.BOARD_BUILD_COMMIT &&
    existsSync(join(repoDir, ".git"))
  ) {
    try {
      const git = (args) =>
        execFileSync("git", args, {
          cwd: repoDir,
          encoding: "utf8",
          timeout: 2000,
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
      localCommit = git(["rev-parse", "HEAD"]);
      localDirty = Boolean(
        git(["status", "--porcelain", "--untracked-files=normal"]),
      );
    } catch {}
  }
  const buildHash =
    options.buildHash ?? process.env.BOARD_BUILD_SOURCE_HASH ?? "";
  const buildCommit =
    options.buildCommit ?? process.env.BOARD_BUILD_COMMIT ?? localCommit;
  const buildDirty =
    options.buildDirty ??
    (process.env.BOARD_BUILD_DIRTY
      ? process.env.BOARD_BUILD_DIRTY === "1"
      : localDirty);
  const sourceStatusPath =
    options.sourceStatusPath ||
    join(process.env.BOARD_DATA_DIR || ".local/state", "source-status.json");
  let remoteError = "";
  let inFlight = null;
  let cachedStatus = null;
  let cacheExpiry = 0;

  function getCurrentVersion() {
    try {
      const pkg = JSON.parse(
        readFileSync(join(repoDir, "package.json"), "utf8"),
      );
      return pkg.version || "0.0.0";
    } catch {
      return "0.0.0";
    }
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
      if (!res.ok) {
        if (res.status !== 404)
          remoteError = `Update server returned HTTP ${res.status}.`;
        return null;
      }
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
      remoteError = "Could not check GitHub for updates.";
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
      if (!res.ok) {
        remoteError = `Update server returned HTTP ${res.status}.`;
        return null;
      }
      const data = await res.json();
      if (data && data.version) {
        return {
          version: data.version,
          releaseUrl: `https://github.com/${githubRepo}`,
        };
      }
    } catch {
      remoteError = "Could not check GitHub for updates.";
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
      if (!res.ok) {
        remoteError = `Update server returned HTTP ${res.status}.`;
        return null;
      }
      const data = await res.json();
      if (data && data.sha) {
        return {
          sha: data.sha,
          message: data.commit?.message?.split("\n")[0] || "",
          htmlUrl:
            data.html_url || `https://github.com/${githubRepo}/commits/main`,
        };
      }
    } catch {
      remoteError = "Could not check GitHub for updates.";
    }
    return null;
  }

  function withLocalStatus(status) {
    let local = null;
    try {
      local = JSON.parse(readFileSync(sourceStatusPath, "utf8"));
    } catch {}
    const fresh =
      local &&
      Number.isFinite(local.checkedAt) &&
      Date.now() - local.checkedAt * 1000 < 120_000;
    const localUpdateAvailable = Boolean(
      buildHash &&
      fresh &&
      /^[a-f0-9]{64}$/.test(local.sourceHash) &&
      local.sourceHash !== buildHash,
    );
    return {
      ...status,
      updateAvailable: localUpdateAvailable || status.updateAvailable,
      localUpdateAvailable,
      currentCommit: buildCommit,
      buildDirty,
      localCheckAvailable: Boolean(buildHash && fresh),
      reason: localUpdateAvailable
        ? "Local code has changed. Update & restart to rebuild this board."
        : status.reason,
    };
  }

  async function checkRemoteUpdates() {
    const now = Date.now();
    const currentVersion = getCurrentVersion();
    let status = {
      updateAvailable: false,
      currentVersion,
      latestVersion: currentVersion,
      releaseUrl: "",
      reason: "",
    };
    remoteError = "";
    const release = await checkGitHubRelease();
    const pkg =
      release && isNewerVersion(currentVersion, release.version)
        ? null
        : await checkGitHubPackage();
    const latest =
      release && isNewerVersion(currentVersion, release.version)
        ? release
        : pkg;
    if (latest && isNewerVersion(currentVersion, latest.version)) {
      status = {
        ...status,
        updateAvailable: true,
        latestVersion: latest.version,
        releaseUrl: latest.releaseUrl,
        reason: `Version ${latest.version} is available on GitHub. Pull the updated code on the host before rebuilding.`,
      };
    }
    if (!status.updateAvailable && buildCommit) {
      const latestCommit = await checkGitHubCommit();
      if (latestCommit && latestCommit.sha !== buildCommit) {
        try {
          const res = await fetcher(
            `https://api.github.com/repos/${githubRepo}/compare/${encodeURIComponent(buildCommit)}...${encodeURIComponent(latestCommit.sha)}`,
            {
              headers: {
                "User-Agent": "OpportunityKnox-UpdateChecker",
                Accept: "application/vnd.github.v3+json",
              },
              signal: AbortSignal.timeout(3000),
            },
          );
          if (!res.ok)
            remoteError = `Could not compare installed and upstream commits (HTTP ${res.status}).`;
          else {
            const comparison = await res.json();
            // Only fast-forward updates: a different/older branch is not an installable update.
            if (comparison.status === "ahead" && comparison.ahead_by > 0) {
              status = {
                ...status,
                updateAvailable: true,
                latestCommit: latestCommit.sha,
                releaseUrl: latestCommit.htmlUrl,
                reason: `${comparison.ahead_by} newer commit(s) on GitHub. Pull the updated code on the host before rebuilding.`,
              };
            }
          }
        } catch {
          remoteError = "Could not compare installed and upstream commits.";
        }
      }
    }
    cachedStatus = {
      ...status,
      checkError: remoteError,
      checkedAt: new Date(now).toISOString(),
    };
    cacheExpiry = now + ttlMs;
    return cachedStatus;
  }

  async function checkForUpdates(force = false) {
    if (force || !cachedStatus || Date.now() >= cacheExpiry) {
      if (!inFlight)
        inFlight = checkRemoteUpdates().finally(() => {
          inFlight = null;
        });
      await inFlight;
    }
    return withLocalStatus(cachedStatus);
  }

  function getStatusSync() {
    return withLocalStatus(
      cachedStatus || {
        updateAvailable: false,
        currentVersion: getCurrentVersion(),
        latestVersion: getCurrentVersion(),
        releaseUrl: "",
        reason: "",
        checkedAt: null,
      },
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
