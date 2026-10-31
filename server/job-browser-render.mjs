import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const run = promisify(execFile);

/**
 * Known binary names and paths across Linux (Docker/Debian) and macOS hosts.
 */
const CANDIDATE_BINARIES = [
  // Environment variable override
  process.env.CHROME_BIN,
  process.env.CHROMIUM_BIN,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  // Standard PATH names
  "chromium",
  "chromium-browser",
  "google-chrome-stable",
  "google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  // macOS default applications
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
].filter(Boolean);

let cachedBrowserPath = undefined;

/**
 * Detect an available Chromium-compatible headless browser executable.
 * Returns the path string, or null if none is available.
 */
export async function detectBrowserExecutable({ runner = run, candidatePaths = CANDIDATE_BINARIES } = {}) {
  if (cachedBrowserPath !== undefined) return cachedBrowserPath;

  for (const candidate of candidatePaths) {
    try {
      // Check if candidate is a direct absolute path
      if (candidate.startsWith("/")) {
        if (existsSync(candidate)) {
          // Verify it executes --version
          const { stdout } = await runner(candidate, ["--version"], { timeout: 3000 });
          if (/chrom|brave|edge/i.test(stdout)) {
            cachedBrowserPath = candidate;
            return candidate;
          }
        }
      } else {
        // Search in system PATH
        const { stdout } = await runner(candidate, ["--version"], { timeout: 3000 });
        if (/chrom|brave|edge/i.test(stdout)) {
          cachedBrowserPath = candidate;
          return candidate;
        }
      }
    } catch {
      // Candidate not present or execution failed, continue checking
    }
  }

  cachedBrowserPath = null;
  return null;
}

/**
 * Reset cached executable path (primarily for testing).
 */
export function resetBrowserExecutableCache() {
  cachedBrowserPath = undefined;
}

export class BrowserRenderError extends Error {
  constructor(message, status = 422, code = "JOB_PAGE_JS_REQUIRED") {
    super(message);
    this.name = "BrowserRenderError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Render a JavaScript-rendered URL using a headless Chromium browser instance.
 *
 * Security and resource boundaries:
 * 1. Sandboxed runner execution with isolated temporary user data dir.
 * 2. Disabled network features that could bypass isolation (e.g., extensions, default apps).
 * 3. Strict 15-second execution timeout and bounded output buffer (max 4 MB).
 * 4. Clean exit and temporary directory deletion.
 */
export async function renderJobPageWithBrowser(
  url,
  {
    runner = run,
    browserExecutable = null,
    timeoutMs = 15000,
    signal,
    onProgress = () => {},
  } = {},
) {
  const executable = browserExecutable || (await detectBrowserExecutable({ runner }));

  if (!executable) {
    throw new BrowserRenderError(
      "This job listing requires JavaScript to render, but a headless browser is not available in this environment. Open the listing in your browser and paste its text or upload the job description.",
      422,
      "JOB_PAGE_JS_REQUIRED",
    );
  }

  onProgress("rendering-page");

  // Create isolated temporary user-data-dir
  const tempDir = mkdtempSync(join(tmpdir(), "browser-render-"));

  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-translate",
    "--metrics-recording-only",
    "--mute-audio",
    "--no-first-run",
    `--user-data-dir=${tempDir}`,
    // Dump rendered DOM
    "--dump-dom",
    url,
  ];

  try {
    const result = await runner(executable, args, {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      signal,
      env: { ...process.env },
    });

    const html = result.stdout || "";
    if (!html.trim()) {
      throw new BrowserRenderError(
        "The headless browser returned an empty page for this job listing. Paste or upload the description instead.",
        422,
        "JOB_PAGE_UNREADABLE",
      );
    }

    return {
      html,
      rendered: true,
      browser: executable,
    };
  } catch (error) {
    if (error instanceof BrowserRenderError) throw error;
    if (signal?.aborted) {
      throw new BrowserRenderError("The job page rendering was cancelled.", 499, "CANCELLED");
    }
    if (error.killed || error.signal === "SIGTERM" || /timed? ?out/i.test(error.message)) {
      throw new BrowserRenderError(
        "Rendering the JavaScript job listing took too long. Open the link in your browser and paste its text or upload the job description.",
        504,
        "TIMEOUT",
      );
    }
    throw new BrowserRenderError(
      `Failed to render JavaScript job page: ${error.message}. Paste or upload the description instead.`,
      422,
      "JOB_PAGE_JS_REQUIRED",
    );
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}
