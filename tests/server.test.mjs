import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/app.mjs";

async function fixture(t, extras = {}) {
  const root = mkdtempSync(join(tmpdir(), "board-server-"));
  const options = {
    dataDir: join(root, "state"),
    filesDir: join(root, "files"),
    setupToken: "test-setup-token",
    automationEnabled:false,
    ...extras,
  };
  let app;
  let base;
  let cookie = "";
  async function open(opts = options) {
    app = createApp(opts);
    await new Promise((done) => app.server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${app.server.address().port}`;
  }
  if (extras.beforeOpen) extras.beforeOpen(options);
  await open();
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  async function request(
    path,
    { method = "GET", body, auth = true, headers = {}, binary = false } = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(auth && cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const type = response.headers.get("content-type") || "";
    const data = binary
      ? Buffer.from(await response.arrayBuffer())
      : type.includes("application/json")
        ? await response.json()
        : await response.text();
    return { response, status: response.status, data };
  }
  async function setup() {
    const result = await request("/api/setup", {
      method: "POST",
      body: {
        password: "correct horse battery staple",
        token: "test-setup-token",
      },
    });
    assert.equal(result.status, 200);
    cookie = result.response.headers.get("set-cookie").split(";")[0];
  }
  async function login() {
    const result = await request("/api/login", {
      method: "POST",
      body: { password: "correct horse battery staple" },
    });
    assert.equal(result.status, 200);
    cookie = result.response.headers.get("set-cookie").split(";")[0];
  }
  return {
    root,
    options,
    request,
    setup,
    login,
    get app() {
      return app;
    },
    async restart(opts = options) {
      await app.close();
      cookie = "";
      await open(opts);
    },
    get base() {
      return base;
    },
  };
}
const opportunity = {
  company: "Fictional Company",
  role: "Solutions Architect",
  url: "https://example.com/job",
  deadline: "2026-12-01",
};

test("private setup, authentication, origin checks, and export exclusions", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("/api/health", { auth: false })).status, 200);
  assert.equal((await f.request("/api/board", { auth: false })).status, 401);
  const session = await f.request("/api/session");
  assert.equal(session.data.setupTokenRequired, true);
  assert.equal(
    (
      await f.request("/api/setup", {
        method: "POST",
        body: { password: "long enough password", token: "wrong" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request("/api/setup", {
        method: "POST",
        body: { password: "short", token: "test-setup-token" },
      })
    ).status,
    400,
  );
  await f.setup();
  assert.equal(
    (
      await f.request("/api/setup", {
        method: "POST",
        body: { password: "long enough password" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request("/api/opportunities", {
        method: "POST",
        body: opportunity,
        headers: { Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request("/api/login", {
        method: "POST",
        body: { password: "bad" },
        auth: false,
      })
    ).status,
    401,
  );
  const exported = await f.request("/api/export");
  assert.equal(exported.status, 200);
  assert.match(exported.data.limitations, /File bytes/);
  assert.equal(JSON.stringify(exported.data).includes("correct horse"), false);
  assert.equal(JSON.stringify(exported.data).includes("hash"), false);
  await f.request("/api/logout", { method: "POST", body: {} });
  assert.equal((await f.request("/api/board")).status, 401);
});

test("stage transitions, corrected dates, repeat visits, and stale revision survive restart", async (t) => {
  const f = await fixture(t);
  await f.setup();
  const created = await f.request("/api/opportunities", {
    method: "POST",
    body: { ...opportunity, effectiveAt: "2026-10-01T09:00:00Z" },
  });
  assert.equal(created.status, 201);
  let record = created.data;
  const id = record.id;
  assert.equal(record.events.length, 1);
  record = (
    await f.request(`/api/opportunities/${id}`, {
      method: "PATCH",
      body: {
        revision: record.revision,
        stage: "review",
        effectiveAt: "2026-10-02T12:00:00Z",
        note: "Strong match",
      },
    })
  ).data;
  assert.equal(record.events.length, 2);
  const eventId = record.events[1].id;
  const corrected = await f.request(
    `/api/opportunities/${id}/events/${eventId}`,
    {
      method: "PATCH",
      body: {
        revision: record.revision,
        effectiveAt: "2026-10-03T12:00:00Z",
        note: "Corrected review date",
      },
    },
  );
  assert.equal(corrected.status, 200);
  record = corrected.data;
  assert.equal(
    record.events[1].corrections[0].effectiveAt,
    "2026-10-02T12:00:00.000Z",
  );
  assert.equal(record.stageEnteredAt, "2026-10-03T12:00:00.000Z");
  assert.equal(
    (
      await f.request(`/api/opportunities/${id}`, {
        method: "PATCH",
        body: { revision: 1, role: "Overwritten" },
      })
    ).status,
    409,
  );
  record = (
    await f.request(`/api/opportunities/${id}`, {
      method: "PATCH",
      body: { revision: record.revision, stage: "identification" },
    })
  ).data;
  assert.equal(record.events.length, 3);
  await f.restart();
  await f.login();
  const saved = await f.request(`/api/opportunities/${id}`);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.events.length, 3);
  assert.equal(saved.data.role, opportunity.role);
  const closed = await f.request(`/api/opportunities/${id}`, {
    method: "PATCH",
    body: { revision: saved.data.revision, outcome: "ignored" },
  });
  assert.equal(closed.data.stage, "outcome");
  const reopened = await f.request(`/api/opportunities/${id}`, {
    method: "PATCH",
    body: { revision: closed.data.revision, stage: "review" },
  });
  assert.equal(reopened.data.outcome, "");
});

test("concurrent edits reject stale records and concurrent notes do not overwrite each other", async (t) => {
  const f = await fixture(t);
  await f.setup();
  const { data: record } = await f.request("/api/opportunities", {
    method: "POST",
    body: opportunity,
  });
  const edits = await Promise.all(
    ["one", "two"].map((nextAction) =>
      f.request(`/api/opportunities/${record.id}`, {
        method: "PATCH",
        body: { revision: record.revision, nextAction },
      }),
    ),
  );
  assert.deepEqual(edits.map((x) => x.status).sort(), [200, 409]);
  await Promise.all(
    ["note one", "note two"].map((note) =>
      f.request(`/api/opportunities/${record.id}/events`, {
        method: "POST",
        body: { note },
      }),
    ),
  );
  const saved = await f.request(`/api/opportunities/${record.id}`);
  assert.equal(saved.data.events.length, 3);
});

test("variable interviews, communications, rescheduling, and final-stage markers", async (t) => {
  const f = await fixture(t);
  await f.setup();
  const created = await f.request("/api/opportunities", {
    method: "POST",
    body: opportunity,
  });
  let record = created.data;
  for (const [kind, type, title] of [
    ["interview", "phone", "Recruiter screen"],
    ["interview", "video", "Technical interview"],
    ["interview", "in-person", "Final interview"],
    ["communication", "email", "Recruiter update"],
  ]) {
    const result = await f.request(
      `/api/opportunities/${record.id}/activities`,
      {
        method: "POST",
        body: {
          kind,
          type,
          title,
          scheduledAt: "2026-11-01T09:00:00Z",
          isFinal: title === "Final interview",
          notes: "Preparation notes",
        },
      },
    );
    assert.equal(result.status, 200);
    record = result.data;
  }
  assert.equal(record.activities.length, 4);
  assert.equal(record.activities[2].isFinal, true);
  const updated = await f.request(
    `/api/opportunities/${record.id}/activities/${record.activities[0].id}`,
    {
      method: "PATCH",
      body: {
        revision: record.revision,
        scheduledAt: "2026-11-02T10:00:00Z",
        status: "completed",
      },
    },
  );
  assert.equal(
    updated.data.activities[0].history[0].scheduledAt,
    "2026-11-01T09:00:00.000Z",
  );
  assert.equal(updated.data.activities[0].status, "completed");
});

test("versioned uploaded files, submitted snapshots, changed subfolders, and full backup", async (t) => {
  const f = await fixture(t);
  await f.setup();
  const { data: record } = await f.request("/api/opportunities", {
    method: "POST",
    body: opportunity,
  });
  const upload = (body) =>
    f.request("/api/documents", {
      method: "POST",
      body: {
        opportunityId: record.id,
        name: "CV.pdf",
        kind: "cv",
        contentBase64: Buffer.from("PDF version one").toString("base64"),
        ...body,
      },
    });
  const first = await upload({ status: "submitted" });
  assert.equal(first.status, 201);
  assert.equal(first.data.version, 1);
  assert.equal(
    (
      await f.request(`/api/documents/${first.data.id}`, {
        method: "PATCH",
        body: { status: "draft" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request("/api/settings", {
        method: "PATCH",
        body: {
          documentsSubdir: "new-opportunities",
          backupSubdir: "private/snapshots",
        },
      })
    ).status,
    200,
  );
  const second = await upload({
    contentBase64: Buffer.from("PDF version two").toString("base64"),
  });
  assert.equal(second.data.version, 2);
  assert.equal((await f.request(first.data.url)).data, "PDF version one");
  assert.equal((await f.request(second.data.url)).data, "PDF version two");
  const backup = await f.request("/api/backup", { method: "POST", body: {} });
  assert.equal(backup.status, 200);
  const snapshot = join(
    f.options.filesDir,
    "private",
    "snapshots",
    backup.data.name,
  );
  assert.equal(existsSync(join(snapshot, "manifest.json")), true);
  assert.equal(
    readFileSync(join(snapshot, "documents", first.data.id), "utf8"),
    "PDF version one",
  );
  const database = new DatabaseSync(join(snapshot, "board.sqlite"));
  const row = database.prepare("SELECT COUNT(*) AS total FROM documents").get();
  assert.equal(row.total, 2);
  database.close();
  assert.equal(backup.data.location, realpathSync(snapshot));
  const repeatBackup = await f.request("/api/backup", {
    method: "POST",
    body: {},
  });
  assert.equal(repeatBackup.status, 200);
  const repeatSnapshot = join(
    f.options.filesDir,
    "private",
    "snapshots",
    repeatBackup.data.name,
  );
  assert.equal(
    JSON.parse(readFileSync(join(repeatSnapshot, "manifest.json"), "utf8"))
      .documents.length,
    2,
  );
  assert.equal(readdirSync(join(repeatSnapshot, "documents")).length, 2);
  assert.equal(existsSync(join(f.options.dataDir, "backups")), false);
  await f.restart();
  await f.login();
  assert.equal((await f.request(first.data.url)).data, "PDF version one");
});

test("safe storage paths, retained document roots, pending host mount, and invalid data", async (t) => {
  const f = await fixture(t);
  await f.setup();
  for (const documentsSubdir of [
    "../escape",
    "/tmp/escape",
    "bad/../../escape",
    "bad\\escape",
  ])
    assert.equal(
      (
        await f.request("/api/settings", {
          method: "PATCH",
          body: { documentsSubdir },
        })
      ).status,
      400,
    );
  const outside = join(f.root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, join(f.options.filesDir, "escape"));
  assert.equal(
    (
      await f.request("/api/settings", {
        method: "PATCH",
        body: { documentsSubdir: "escape/subfolder" },
      })
    ).status,
    400,
  );
  assert.equal(existsSync(join(outside, "subfolder")), false);
  assert.equal(
    (
      await f.request("/api/settings", {
        method: "PATCH",
        body: { pendingHostPath: "/server/new folder" },
      })
    ).status,
    200,
  );
  assert.equal(
    JSON.parse(
      readFileSync(join(f.options.dataDir, "pending-storage.json"), "utf8"),
    ).hostPath,
    "/server/new folder",
  );
  assert.equal(
    (
      await f.request("/api/settings", {
        method: "PATCH",
        body: {
          pendingHostPath: "",
          documentsSubdir: "opportunities",
          timezone: "Europe/London",
        },
      })
    ).status,
    200,
  );
  assert.equal(
    existsSync(join(f.options.dataDir, "pending-storage.json")),
    false,
  );
  assert.equal((await f.request("/api/settings")).data.pendingHostPath, "");
  assert.equal(
    (
      await f.request("/api/settings", {
        method: "PATCH",
        body: { pendingHostPath: "/server/another folder" },
      })
    ).status,
    200,
  );
  assert.equal(
    existsSync(join(f.options.dataDir, "pending-storage.json")),
    true,
  );
  assert.equal(
    (
      await f.request("/api/settings", {
        method: "PATCH",
        body: { pendingHostPath: "" },
      })
    ).status,
    200,
  );
  assert.equal(
    existsSync(join(f.options.dataDir, "pending-storage.json")),
    false,
  );
  assert.equal(
    (
      await f.request("/api/opportunities", {
        method: "POST",
        body: { ...opportunity, url: "javascript:alert(1)" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request("/api/opportunities", {
        method: "POST",
        body: { ...opportunity, deadline: "2026-99-99" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request("/api/settings", {
        method: "PATCH",
        body: { aiEnabled: true },
      })
    ).status,
    400,
  );
  const doc = await f.request("/api/documents", {
    method: "POST",
    body: {
      name: "reference.txt",
      kind: "reference",
      contentBase64: Buffer.from("Reference").toString("base64"),
    },
  });
  const nextFiles = join(f.root, "next-files");
  await f.restart({
    ...f.options,
    filesDir: nextFiles,
    documentRoots: [f.options.filesDir, nextFiles],
  });
  await f.login();
  assert.equal((await f.request(doc.data.url)).data, "Reference");
});

test("failed backup cleans incomplete work and never publishes a finished snapshot", async (t) => {
  const f = await fixture(t);
  await f.setup();
  const doc = await f.request("/api/documents", {
    method: "POST",
    body: {
      name: "missing.txt",
      kind: "reference",
      contentBase64: Buffer.from("Will become unavailable").toString("base64"),
    },
  });
  const storedDocument = JSON.parse(
    f.app.db.prepare("SELECT data FROM documents WHERE id=?").get(doc.data.id)
      .data,
  );
  rmSync(join(storedDocument.storageRoot, storedDocument.relativePath));
  const result = await f.request("/api/backup", { method: "POST", body: {} });
  assert.equal(result.status, 409);
  assert.match(result.data.error, /Backup incomplete/);
  assert.deepEqual(readdirSync(join(f.options.filesDir, "backups")), []);
});

test("job lookup requires login and previews extracted details without creating a card", async (t) => {
  let calls = 0;
  const extracted = {
    fields: {
      company: "Fictional Research",
      role: "AI Architect",
      location: "London",
      salary: "GBP 90,000–110,000 / year",
      employmentType: "Full time",
      deadline: "2026-12-01",
      description:
        "Design reliable systems.\n\nRequirements\n- Architecture experience",
    },
    method: "structured-data",
    sourceUrl: "https://example.com/jobs/architect",
    resolvedUrl: "https://example.com/careers/architect",
    retrievedAt: "2026-10-22T12:00:00.000Z",
    warnings: [],
  };
  const f = await fixture(t, {
    jobLookup: async (url) => {
      calls++;
      assert.equal(url, extracted.sourceUrl);
      return extracted;
    },
  });
  const query = { method: "POST", body: { url: extracted.sourceUrl } };
  assert.equal((await f.request("/api/job-lookup", query)).status, 401);
  assert.equal(calls, 0);
  await f.setup();
  assert.equal(
    (await f.request("/api/job-lookup", { method: "POST", body: {} })).status,
    400,
  );
  assert.equal(
    (
      await f.request("/api/job-lookup", {
        method: "POST",
        body: { url: "file:///etc/passwd" },
      })
    ).status,
    400,
  );
  assert.equal(calls, 0);
  const result = await f.request("/api/job-lookup", query);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, extracted);
  assert.equal((await f.request("/api/board")).data.opportunities.length, 0);
  const created = await f.request("/api/opportunities", {
    method: "POST",
    body: {
      ...extracted.fields,
      url: extracted.sourceUrl,
      note: `Retrieved ${extracted.retrievedAt}`,
    },
  });
  assert.equal(created.status, 201);
  await f.restart();
  await f.login();
  const saved = (await f.request(`/api/opportunities/${created.data.id}`)).data;
  assert.equal(saved.description, extracted.fields.description);
  assert.equal(saved.location, "London");
  assert.equal(saved.deadline, "2026-12-01");
  assert.match(saved.events[0].note, /Retrieved/);
});

test("job lookup failures remain actionable and concurrent lookups are bounded", async (t) => {
  let pending = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  t.after(() => release());
  const f = await fixture(t, {
    jobLookup: async (url) => {
      if (url.endsWith("blocked"))
        throw Object.assign(
          new Error(
            "This site requires a login. Paste the job description or upload its PDF.",
          ),
          { status: 422 },
        );
      pending++;
      await gate;
      return {
        fields: { role: "Test role" },
        warnings: [],
        method: "page-content",
      };
    },
  });
  await f.setup();
  const failed = await f.request("/api/job-lookup", {
    method: "POST",
    body: { url: "https://example.com/blocked" },
  });
  assert.equal(failed.status, 422);
  assert.match(failed.data.error, /Paste the job description/);
  const requests = Array.from({ length: 4 }, () =>
    f.request("/api/job-lookup", {
      method: "POST",
      body: { url: "https://example.com/job" },
    }),
  );
  for (let i = 0; i < 100 && pending < 4; i++) await new Promise(setImmediate);
  assert.equal(pending, 4);
  const busy = await f.request("/api/job-lookup", {
    method: "POST",
    body: { url: "https://example.com/job" },
  });
  assert.equal(busy.status, 429);
  release();
  for (const response of await Promise.all(requests))
    assert.equal(response.status, 200);
});

// Fictional solid-colour 2×2 images, generated for format-validation fixtures.
const avatarFixtures = {
  png: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGOU9NZlYGBgYgADAAbiAJW0YxQdAAAAAElFTkSuQmCC",
  jpeg: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDziiiisTyz/9k=",
  webp: "UklGRjAAAABXRUJQVlA4ICQAAABwAQCdASoCAAIAAUAmJYgCdAF1AAD++AQ0Hxcv+N/q18mQ4AA=",
};

test("theme selection persists without resetting other settings or opportunity data", async (t) => {
  const f = await fixture(t);
  await f.setup();
  const created = await f.request("/api/opportunities", {
    method: "POST",
    body: opportunity,
  });
  assert.equal((await f.request("/api/settings")).data.theme, "forest");
  const changed = await f.request("/api/settings", {
    method: "PATCH",
    body: {
      theme: "cappuccino",
      timezone: "America/New_York",
      documentsSubdir: "my-applications",
    },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.theme, "cappuccino");
  const next = await f.request("/api/settings", {
    method: "PATCH",
    body: { theme: "midnight" },
  });
  assert.equal(next.data.timezone, "America/New_York");
  assert.equal(next.data.documentsSubdir, "my-applications");
  assert.equal(
    (
      await f.request("/api/settings", {
        method: "PATCH",
        body: { theme: "invented" },
      })
    ).status,
    400,
  );
  await f.restart();
  await f.login();
  const board = await f.request("/api/board");
  assert.equal(board.data.settings.theme, "midnight");
  assert.equal(board.data.opportunities[0].id, created.data.id);
  assert.equal(board.data.profile.name, "Your workspace");
  assert.deepEqual(board.data.tasks, []);
});

test("additional themes and custom colours validate, reset and persist without changing other data", async (t) => {
  const f = await fixture(t);
  await f.setup();
  const created = await f.request("/api/opportunities", {
    method: "POST",
    body: opportunity,
  });
  const defaults = (await f.request("/api/settings")).data;
  assert.equal(defaults.themeAccent, "");
  assert.equal(defaults.themeBackground, "");
  for (const theme of ["lavender", "terracotta", "graphite", "plum"]) {
    const result = await f.request("/api/settings", {
      method: "PATCH",
      body: { theme },
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.theme, theme);
  }
  const customized = await f.request("/api/settings", {
    method: "PATCH",
    body: {
      themeAccent: "#1A2B3C",
      themeBackground: "#F6F5F4",
      timezone: "Europe/Paris",
    },
  });
  assert.equal(customized.status, 200);
  assert.equal(customized.data.themeAccent, "#1a2b3c");
  assert.equal(customized.data.themeBackground, "#f6f5f4");
  const changed = await f.request("/api/settings", {
    method: "PATCH",
    body: { theme: "cappuccino", themeAccent: "#ABCDEF" },
  });
  assert.equal(changed.data.themeAccent, "#abcdef");
  assert.equal(changed.data.themeBackground, "#f6f5f4");
  assert.equal(changed.data.timezone, "Europe/Paris");
  for (const value of [
    "#fff",
    "red",
    " #abcdef",
    "#12345678",
    "#zzzzzz",
    "#123456; color:red",
    null,
    123,
    ["#123456"],
  ]) {
    for (const key of ["themeAccent", "themeBackground"]) {
      const rejected = await f.request("/api/settings", {
        method: "PATCH",
        body: { theme: "forest", [key]: value },
      });
      assert.equal(rejected.status, 400);
      assert.equal((await f.request("/api/settings")).data.theme, "cappuccino");
    }
  }
  const resetAccent = await f.request("/api/settings", {
    method: "PATCH",
    body: { themeAccent: "" },
  });
  assert.equal(resetAccent.data.themeAccent, "");
  assert.equal(resetAccent.data.themeBackground, "#f6f5f4");
  await f.restart();
  await f.login();
  const board = (await f.request("/api/board")).data;
  assert.equal(board.settings.theme, "cappuccino");
  assert.equal(board.settings.themeAccent, "");
  assert.equal(board.settings.themeBackground, "#f6f5f4");
  assert.equal(board.settings.timezone, "Europe/Paris");
  assert.equal(board.opportunities[0].id, created.data.id);
  const resetBackground = await f.request("/api/settings", {
    method: "PATCH",
    body: { themeBackground: "" },
  });
  assert.equal(resetBackground.data.themeBackground, "");
});

test("mixed contrast themes persist while preserving custom colours and existing opportunities", async (t) => {
  const f = await fixture(t);
  await f.setup();
  const created = await f.request("/api/opportunities", {
    method: "POST",
    body: opportunity,
  });
  assert.equal(created.status, 201);
  const customized = await f.request("/api/settings", {
    method: "PATCH",
    body: {
      themeAccent: "#13579b",
      themeBackground: "#e5bb77",
      timezone: "Europe/Paris",
    },
  });
  assert.equal(customized.status, 200);
  for (const theme of ["espresso-cream", "harbour", "ink-paper", "moonlight"]) {
    const changed = await f.request("/api/settings", {
      method: "PATCH",
      body: { theme },
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.data.theme, theme);
    assert.equal(changed.data.themeAccent, "#13579b");
    assert.equal(changed.data.themeBackground, "#e5bb77");
    assert.equal(changed.data.timezone, "Europe/Paris");
    await f.restart();
    await f.login();
    const board = (await f.request("/api/board")).data;
    assert.equal(board.settings.theme, theme);
    assert.equal(board.settings.themeAccent, "#13579b");
    assert.equal(board.settings.themeBackground, "#e5bb77");
    assert.equal(board.settings.timezone, "Europe/Paris");
    assert.equal(board.opportunities.length, 1);
    assert.equal(board.opportunities[0].id, created.data.id);
    assert.equal(board.opportunities[0].role, created.data.role);
  }
});

test("profile name and photo validate, preserve revision conflicts, survive restart and allow removal", async (t) => {
  const f = await fixture(t);
  await f.setup();
  assert.equal((await f.request("/api/profile", { auth: false })).status, 401);
  assert.equal(
    (await f.request("/api/profile/avatar", { auth: false })).status,
    401,
  );
  assert.equal((await f.request("/api/profile/avatar")).status, 404);
  let profile = (await f.request("/api/profile")).data;
  assert.deepEqual(profile, {
    name: "Your workspace",
    avatarUrl: "",
    revision: 1,
  });
  for (const name of ["", "   ", "n".repeat(81)])
    assert.equal(
      (
        await f.request("/api/profile", {
          method: "PATCH",
          body: { revision: profile.revision, name },
        })
      ).status,
      400,
    );
  for (const imageBase64 of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64"),
    Buffer.from("not an image").toString("base64"),
    "data:image/png;base64," + avatarFixtures.png,
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64"),
  ])
    assert.equal(
      (
        await f.request("/api/profile", {
          method: "PATCH",
          body: { revision: profile.revision, imageBase64 },
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await f.request("/api/profile", {
        method: "PATCH",
        body: {
          revision: profile.revision,
          imageBase64: Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64"),
        },
      })
    ).status,
    413,
  );
  const saved = await f.request("/api/profile", {
    method: "PATCH",
    body: {
      revision: profile.revision,
      name: " Fictional Candidate ",
      imageBase64: avatarFixtures.png,
    },
  });
  assert.equal(saved.status, 200);
  profile = saved.data;
  assert.equal(profile.name, "Fictional Candidate");
  assert.match(profile.avatarUrl, /\/api\/profile\/avatar\?v=2/);
  assert.equal(profile.imageBase64, undefined);
  assert.equal(profile.image, undefined);
  assert.equal(
    (
      await f.request("/api/profile", {
        method: "PATCH",
        body: { revision: 1, name: "Stale name" },
      })
    ).status,
    409,
  );
  const image = await f.request(profile.avatarUrl, { binary: true });
  assert.equal(image.status, 200);
  assert.equal(image.response.headers.get("content-type"), "image/png");
  assert.deepEqual(image.data, Buffer.from(avatarFixtures.png, "base64"));
  await f.restart();
  await f.login();
  assert.equal(
    (await f.request("/api/profile")).data.name,
    "Fictional Candidate",
  );
  for (const [format, contentType] of [
    ["jpeg", "image/jpeg"],
    ["webp", "image/webp"],
  ]) {
    const result = await f.request("/api/profile", {
      method: "PATCH",
      body: { revision: profile.revision, imageBase64: avatarFixtures[format] },
    });
    assert.equal(result.status, 200);
    profile = result.data;
    const content = await f.request(profile.avatarUrl, { binary: true });
    assert.equal(content.response.headers.get("content-type"), contentType);
    assert.deepEqual(
      content.data,
      Buffer.from(avatarFixtures[format], "base64"),
    );
  }
  const removed = await f.request("/api/profile", {
    method: "PATCH",
    body: { revision: profile.revision, removeAvatar: true },
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.avatarUrl, "");
  assert.equal((await f.request("/api/profile/avatar")).status, 404);
});

test("tasks are independent, validate dates and links, sort due dates and preserve completion and reopen history", async (t) => {
  const f = await fixture(t);
  await f.setup();
  assert.equal((await f.request("/api/tasks", { auth: false })).status, 401);
  for (const body of [
    { title: "" },
    { title: "x".repeat(301) },
    { title: "Bad date", dueDate: "2026-02-30" },
    { title: "Missing opportunity", opportunityId: "missing-id" },
    { title: "Wrong notes", notes: null },
  ])
    assert.equal(
      (await f.request("/api/tasks", { method: "POST", body })).status,
      400,
    );
  const create = (body) => f.request("/api/tasks", { method: "POST", body });
  const undated = await create({ title: "Independent admin task" });
  assert.equal(undated.status, 201);
  assert.equal(undated.data.opportunityId, "");
  assert.equal(undated.data.completedAt, "");
  const late = await create({
    title: "Prepare interview",
    dueDate: "2026-12-03",
  });
  const early = await create({
    title: "Check requirements",
    dueDate: "2026-11-01",
  });
  assert.deepEqual(
    (await f.request("/api/tasks")).data.tasks.map((task) => task.id),
    [early.data.id, late.data.id, undated.data.id],
  );
  const op = await f.request("/api/opportunities", {
    method: "POST",
    body: opportunity,
  });
  const linked = await f.request(`/api/tasks/${early.data.id}`, {
    method: "PATCH",
    body: {
      revision: early.data.revision,
      opportunityId: op.data.id,
      notes: "Read the JD first",
    },
  });
  assert.equal(linked.status, 200);
  const completed = await f.request(`/api/tasks/${early.data.id}`, {
    method: "PATCH",
    body: { revision: linked.data.revision, completed: true },
  });
  assert.equal(completed.data.completed, true);
  assert.ok(Number.isFinite(Date.parse(completed.data.completedAt)));
  assert.equal(
    (
      await f.request(`/api/tasks/${early.data.id}`, {
        method: "PATCH",
        body: { revision: linked.data.revision, title: "Stale overwrite" },
      })
    ).status,
    409,
  );
  const editedComplete = await f.request(`/api/tasks/${early.data.id}`, {
    method: "PATCH",
    body: {
      revision: completed.data.revision,
      title: "Completed requirements review",
    },
  });
  assert.equal(editedComplete.data.completedAt, completed.data.completedAt);
  const reopened = await f.request(`/api/tasks/${early.data.id}`, {
    method: "PATCH",
    body: { revision: editedComplete.data.revision, completed: false },
  });
  assert.equal(reopened.data.completed, false);
  assert.equal(reopened.data.completedAt, "");
  assert.equal(reopened.data.notes, "Read the JD first");
  assert.equal(
    (
      await f.request(`/api/tasks/${early.data.id}`, {
        method: "PATCH",
        body: { revision: reopened.data.revision, completed: "yes" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request(`/api/tasks/${early.data.id}`, {
        method: "PATCH",
        body: { revision: reopened.data.revision, dueDate: "yesterday" },
      })
    ).status,
    400,
  );
  const concurrency = await Promise.all(
    ["A", "B"].map((title) =>
      f.request(`/api/tasks/${late.data.id}`, {
        method: "PATCH",
        body: { revision: late.data.revision, title },
      }),
    ),
  );
  assert.deepEqual(
    concurrency.map((result) => result.status).sort(),
    [200, 409],
  );
  await f.restart();
  await f.login();
  const board = await f.request("/api/board");
  assert.equal(board.data.tasks.length, 3);
  assert.equal(
    board.data.tasks.find((task) => task.id === early.data.id).opportunityId,
    op.data.id,
  );
  assert.equal(board.data.tasks[0].dueDate, "2026-11-01");
});

test("board document counts, tasks, and private profile photo are backed up while photo bytes stay out of export", async (t) => {
  const f = await fixture(t);
  await f.setup();
  const profile = await f.request("/api/profile", {
    method: "PATCH",
    body: {
      revision: 1,
      name: "Fictional Profile",
      imageBase64: avatarFixtures.png,
    },
  });
  assert.equal(profile.status, 200);
  const task = await f.request("/api/tasks", {
    method: "POST",
    body: { title: "Prepare references", dueDate: "2026-12-01" },
  });
  const op = await f.request("/api/opportunities", {
    method: "POST",
    body: opportunity,
  });
  for (const opportunityId of ["", op.data.id])
    assert.equal(
      (
        await f.request("/api/documents", {
          method: "POST",
          body: {
            opportunityId,
            name: "fictional-reference.txt",
            kind: "reference",
            contentBase64: Buffer.from("Fictional reference").toString(
              "base64",
            ),
          },
        })
      ).status,
      201,
    );
  const board = await f.request("/api/board");
  assert.equal(board.data.documentCount, 2);
  assert.equal(board.data.referenceCount, 1);
  assert.equal(board.data.profile.name, "Fictional Profile");
  assert.equal(board.data.tasks.length, 1);
  const exported = await f.request("/api/export");
  assert.equal(exported.data.tasks[0].id, task.data.id);
  assert.equal(exported.data.profile.name, "Fictional Profile");
  assert.equal(
    JSON.stringify(exported.data).includes(avatarFixtures.png),
    false,
  );
  assert.equal(exported.data.profile.image, undefined);
  assert.match(exported.data.limitations, /profile photo bytes/);
  const backup = await f.request("/api/backup", { method: "POST", body: {} });
  assert.equal(backup.status, 200);
  const snapshot = new DatabaseSync(join(backup.data.location, "board.sqlite"));
  try {
    assert.equal(
      snapshot.prepare("SELECT COUNT(*) AS count FROM tasks").get().count,
      1,
    );
    const storedProfile = JSON.parse(
      snapshot.prepare("SELECT data FROM config WHERE key='profile'").get()
        .data,
    );
    assert.equal(storedProfile.name, "Fictional Profile");
    assert.equal(storedProfile.image.base64, avatarFixtures.png);
    assert.equal(
      snapshot.prepare("SELECT COUNT(*) AS count FROM records").get().count,
      1,
    );
    assert.equal(
      snapshot.prepare("SELECT COUNT(*) AS count FROM documents").get().count,
      2,
    );
    assert.ok(
      snapshot.prepare("SELECT data FROM config WHERE key='auth'").get(),
    );
  } finally {
    snapshot.close();
  }
});

test("opening a pre-task database adds the new table without resetting legacy records or settings", async (t) => {
  const legacy = {
    id: "legacy-opportunity",
    company: "Fictional Legacy",
    role: "Architect",
    stage: "review",
    outcome: "",
    revision: 7,
    events: [],
    activities: [],
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-02T09:00:00.000Z",
  };
  const f = await fixture(t, {
    beforeOpen(options) {
      mkdirSync(options.dataDir, { recursive: true });
      const db = new DatabaseSync(join(options.dataDir, "board.sqlite"));
      db.exec(
        "CREATE TABLE records(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE documents(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE config(key TEXT PRIMARY KEY,data TEXT NOT NULL);",
      );
      db.prepare("INSERT INTO records VALUES (?,?)").run(
        legacy.id,
        JSON.stringify(legacy),
      );
      db.prepare("INSERT INTO config VALUES (?,?)").run(
        "settings",
        JSON.stringify({
          timezone: "Europe/Paris",
          documentsSubdir: "legacy-documents",
        }),
      );
      db.close();
    },
  });
  await f.setup();
  const board = await f.request("/api/board");
  assert.equal(board.data.opportunities[0].id, legacy.id);
  assert.equal(board.data.opportunities[0].revision, 7);
  assert.equal(board.data.settings.timezone, "Europe/Paris");
  assert.equal(board.data.settings.documentsSubdir, "legacy-documents");
  assert.equal(board.data.settings.theme, "forest");
  assert.equal(board.data.settings.themeAccent, "");
  assert.equal(board.data.settings.themeBackground, "");
  assert.deepEqual(board.data.tasks, []);
  const task = await f.request("/api/tasks", {
    method: "POST",
    body: { title: "Use retained opportunity", opportunityId: legacy.id },
  });
  assert.equal(task.status, 201);
  await f.restart();
  await f.login();
  assert.equal(
    (await f.request("/api/tasks")).data.tasks[0].opportunityId,
    legacy.id,
  );
});

const buddyReply = (patch = {}) => ({
  reply: "I have proposed the interview for your review.",
  changes: [],
  draft: { kind: "none", title: "", content: "" },
  sourceIds: [],
  ...patch,
});
const buddyChange = (patch = {}) => ({
  kind: "interview",
  title: "Second interview",
  date: "2026-10-22",
  type: "other",
  status: "completed",
  notes: "Feedback: lack of Databricks experience.",
  field: "",
  value: "",
  isFinal: false,
  ...patch,
});
const buddyResponse = (output) =>
  new Response(
    JSON.stringify({
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify(output) } },
      ],
    }),
    { headers: { "Content-Type": "application/json" } },
  );
async function enableBuddy(f) {
  const current = (await f.request("/api/buddy/settings")).data;
  const result = await f.request("/api/buddy/settings", {
    method: "PATCH",
    body: {
      revision: current.revision,
      enabled: true,
      provider: "custom",
      model: "fixture-model",
      baseUrl: "https://mock-api.example/v1",
      apiKey: "private-buddy-test-key",
    },
  });
  assert.equal(result.status, 200);
  return result.data;
}
async function buddyChat(f, id, body = {}) {
  return f.request("/api/opportunities/" + id + "/buddy/chat", {
    method: "POST",
    body: {
      message:
        "Had the second interview today - they mentioned lack of Databricks experience.",
      action: "chat",
      requestId: "request-" + Math.random(),
      documentIds: [],
      includeOtherOpportunities: false,
      ...body,
    },
  });
}
test("Career Buddy settings and connection test protect secrets, revision conflicts and off mode", async (t) => {
  let calls = 0;
  const f = await fixture(t, {
    buddyFetch: async () => {
      calls++;
      return buddyResponse(buddyReply());
    },
  });
  assert.equal(
    (await f.request("/api/buddy/settings", { auth: false })).status,
    401,
  );
  await f.setup();
  const enabled = await enableBuddy(f);
  assert.equal(enabled.apiKey, undefined);
  assert.equal(enabled.hasKey, true);
  assert.equal(
    (
      await f.request("/api/buddy/settings", {
        method: "PATCH",
        body: { revision: 1, enabled: false },
      })
    ).status,
    409,
  );
  assert.equal(
    (await f.request("/api/buddy/test", { method: "POST", body: {} })).status,
    200,
  );
  assert.equal(calls, 1);
  const exported = JSON.stringify((await f.request("/api/export")).data);
  assert.ok(!exported.includes("private-buddy-test-key"));
  await f.restart();
  await f.login();
  assert.equal((await f.request("/api/buddy/settings")).data.hasKey, true);
  const op = (
    await f.request("/api/opportunities", { method: "POST", body: opportunity })
  ).data;
  assert.equal(
    (
      await f.request("/api/buddy/settings", {
        method: "PATCH",
        body: { revision: enabled.revision, enabled: false },
      })
    ).status,
    200,
  );
  assert.equal((await buddyChat(f, op.id)).status, 400);
  assert.equal(calls, 1);
});
test("opportunity chat persists reviewable proposals and applies date and feedback once without duplicate interviews", async (t) => {
  let calls = 0;
  const f = await fixture(t, {
    buddyFetch: async () => {
      calls++;
      return buddyResponse(buddyReply({ changes: [buddyChange()] }));
    },
  });
  await f.setup();
  await enableBuddy(f);
  const op = (
    await f.request("/api/opportunities", { method: "POST", body: opportunity })
  ).data;
  const response = await buddyChat(f, op.id, { requestId: "same-request" });
  assert.equal(response.status, 200);
  const assistant = response.data.messages.at(-1);
  assert.equal(assistant.changes[0].date, "2026-10-22");
  assert.equal(
    (await f.request("/api/opportunities/" + op.id)).data.activities.length,
    0,
  );
  assert.equal(
    (await buddyChat(f, op.id, { requestId: "same-request" })).data.messages
      .length,
    2,
  );
  assert.equal(calls, 1);
  const url = "/api/opportunities/" + op.id + "/buddy/apply/" + assistant.id;
  const applied = await f.request(url, {
    method: "POST",
    body: { revision: op.revision, changes: assistant.changes },
  });
  assert.equal(applied.status, 200);
  assert.equal(applied.data.opportunity.activities.length, 1);
  assert.equal(
    applied.data.opportunity.activities[0].scheduledAt,
    "2026-10-22",
  );
  assert.match(applied.data.opportunity.activities[0].notes, /Databricks/);
  const again = await f.request(url, {
    method: "POST",
    body: { revision: op.revision },
  });
  assert.equal(again.status, 200);
  assert.equal(again.data.opportunity.activities.length, 1);
  await f.restart();
  await f.login();
  const saved = (await f.request("/api/opportunities/" + op.id + "/buddy"))
    .data;
  assert.equal(saved.messages.length, 2);
  assert.ok(saved.messages[1].appliedAt);
});
test("stale or out-of-scope Career Buddy proposals cannot overwrite newer opportunity edits", async (t) => {
  const f = await fixture(t, {
    buddyFetch: async () =>
      buddyResponse(buddyReply({ changes: [buddyChange()] })),
  });
  await f.setup();
  await enableBuddy(f);
  const op = (
    await f.request("/api/opportunities", { method: "POST", body: opportunity })
  ).data;
  const reply = (await buddyChat(f, op.id)).data.messages.at(-1);
  const unrelated = (
    await f.request("/api/opportunities", {
      method: "POST",
      body: { ...opportunity, company: "Other fictional employer" },
    })
  ).data;
  assert.equal(
    (
      await f.request(
        "/api/opportunities/" + unrelated.id + "/buddy/apply/" + reply.id,
        { method: "POST", body: { revision: unrelated.revision } },
      )
    ).status,
    404,
  );
  await f.request("/api/opportunities/" + op.id, {
    method: "PATCH",
    body: { revision: op.revision, nextAction: "User update" },
  });
  const result = await f.request(
    "/api/opportunities/" + op.id + "/buddy/apply/" + reply.id,
    { method: "POST", body: { revision: op.revision + 1 } },
  );
  assert.equal(result.status, 409);
  const current = (await f.request("/api/opportunities/" + op.id)).data;
  assert.equal(current.activities.length, 0);
  assert.equal(current.nextAction, "User update");
});
test("selected career text is prepared locally, scoped to this opportunity and sent with honest source coverage", async (t) => {
  let context;
  const f = await fixture(t, {
    buddyFetch: async (_, opts) => {
      context = JSON.parse(JSON.parse(opts.body).messages.at(-1).content);
      return buddyResponse(
        buddyReply({ reply: "Relevant governance experience is supported." }),
      );
    },
  });
  await f.setup();
  await enableBuddy(f);
  const op = (
    await f.request("/api/opportunities", {
      method: "POST",
      body: { ...opportunity, description: "Governance requirements" },
    })
  ).data;
  const other = (
    await f.request("/api/opportunities", {
      method: "POST",
      body: { ...opportunity, company: "Private other application" },
    })
  ).data;
  const source = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        name: "Fictional CV.txt",
        kind: "cv",
        contentBase64: Buffer.from(
          "Candidate-authored evidence: led governance workshops.",
        ).toString("base64"),
      },
    })
  ).data;
  const unrelated = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        name: "Other private.txt",
        kind: "reference",
        opportunityId: other.id,
        contentBase64: Buffer.from(
          "Do not send this without selection.",
        ).toString("base64"),
      },
    })
  ).data;
  assert.equal(
    (await buddyChat(f, op.id, { documentIds: [unrelated.id] })).status,
    400,
  );
  const result = await buddyChat(f, op.id, {
    action: "fit",
    message: "Am I a good fit?",
    documentIds: [source.id],
  });
  assert.equal(result.status, 200);
  assert.equal(context.context.excerpts[0].sourceId, source.id);
  assert.match(context.context.excerpts[0].text, /governance/);
  assert.equal(context.context.otherOpportunities.length, 0);
  assert.ok(!JSON.stringify(context).includes("Do not send this"));
  const sources = (await f.request("/api/buddy/documents")).data.documents;
  assert.equal(
    sources.find((d) => d.id === source.id).extraction.status,
    "ready",
  );
  assert.equal(result.data.messages.at(-1).sources[0].included, true);
});
test("drafting requires actual career evidence and advice actions reject unrelated record mutations", async (t) => {
  let output = buddyReply({ changes: [buddyChange()] });
  const f = await fixture(t, { buddyFetch: async () => buddyResponse(output) });
  await f.setup();
  await enableBuddy(f);
  const op = (
    await f.request("/api/opportunities", { method: "POST", body: opportunity })
  ).data;
  assert.equal((await buddyChat(f, op.id, { action: "cv" })).status, 422);
  assert.equal((await buddyChat(f, op.id, { action: "fit" })).status, 502);
  assert.equal(
    (await f.request("/api/opportunities/" + op.id)).data.activities.length,
    0,
  );
  output = buddyReply({
    draft: {
      kind: "cv",
      title: "Unsupported draft",
      content: "Invented experience.",
    },
  });
  assert.equal((await buddyChat(f, op.id)).status, 422);
  output = buddyReply({
    changes: [
      buddyChange({
        kind: "update",
        field: "url",
        value: "file:///etc/passwd",
      }),
    ],
  });
  assert.equal((await buddyChat(f, op.id)).status, 422);
});
test("CV drafts save a new editable Word document, keep submitted originals and include chats/text/key in private backups", async (t) => {
  const f = await fixture(t, {
    buddyFetch: async () =>
      buddyResponse(
        buddyReply({
          reply: "A draft is ready. Please review it.",
          draft: {
            kind: "cv",
            title: "Fictional CV",
            content:
              "# Alex Example\n\n## Experience\n- Led governance workshops.",
          },
        }),
      ),
  });
  await f.setup();
  await enableBuddy(f);
  const op = (
    await f.request("/api/opportunities", { method: "POST", body: opportunity })
  ).data;
  const source = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        name: "Source CV.txt",
        kind: "cv",
        status: "submitted",
        contentBase64: Buffer.from(
          "Alex Example led governance workshops.",
        ).toString("base64"),
      },
    })
  ).data;
  const result = await buddyChat(f, op.id, {
    action: "cv",
    documentIds: [source.id],
  });
  assert.equal(result.status, 200);
  const reply = result.data.messages.at(-1);
  const url = "/api/opportunities/" + op.id + "/buddy/draft/" + reply.id,
    body = { title: "Fictional CV", content: reply.draft.content };
  const saved = await f.request(url, { method: "POST", body });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.opportunity.documents.length, 1);
  const word = saved.data.opportunity.documents[0];
  assert.equal(word.status, "draft");
  assert.equal(word.kind, "cv");
  assert.match(word.name, /\.docx$/);
  const bytes = await f.request(word.url, { binary: true });
  assert.equal(bytes.data.subarray(0, 2).toString(), "PK");
  assert.equal(
    (await f.request(url, { method: "POST", body })).data.opportunity.documents
      .length,
    1,
  );
  const updated = await f.request(url, {
    method: "POST",
    body: { ...body, content: body.content + "\n- Revised wording." },
  });
  assert.equal(updated.data.opportunity.documents.length, 2);
  assert.equal(updated.data.opportunity.documents.at(-1).version, 2);
  assert.equal(
    (await f.request(source.url, { binary: true })).data.toString(),
    "Alex Example led governance workshops.",
  );
  const backup = await f.request("/api/backup", { method: "POST", body: {} });
  assert.equal(backup.status, 200);
  const snapshot = new DatabaseSync(
    join(backup.data.location, "board.sqlite"),
    { readOnly: true },
  );
  try {
    assert.equal(
      snapshot.prepare("SELECT count(*) AS n FROM buddy_messages").get().n,
      2,
    );
    assert.equal(
      snapshot.prepare("SELECT count(*) AS n FROM document_text").get().n,
      1,
    );
    assert.match(
      snapshot.prepare("SELECT data FROM config WHERE key='careerBuddy'").get()
        .data,
      /private-buddy-test-key/,
    );
  } finally {
    snapshot.close();
  }
  const exported = JSON.stringify((await f.request("/api/export")).data);
  assert.ok(!exported.includes("private-buddy-test-key"));
  assert.match(exported, /A draft is ready/);
});

test("concurrent Career Buddy setting edits accept one revision and reject the stale writer", async (t) => {
  const f = await fixture(t);
  await f.setup();
  const c = (await f.request("/api/buddy/settings")).data;
  const results = await Promise.all(
    ["model-one", "model-two"].map((model) =>
      f.request("/api/buddy/settings", {
        method: "PATCH",
        body: { revision: c.revision, model },
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
});
test("a pending Career Buddy call is bounded and cannot silently apply over an intervening manual edit", async (t) => {
  let release, entered;
  const started = new Promise((resolve) => (entered = resolve)),
    gate = new Promise((resolve) => (release = resolve));
  const f = await fixture(t, {
    buddyFetch: async () => {
      entered();
      await gate;
      return buddyResponse(buddyReply({ changes: [buddyChange()] }));
    },
  });
  await f.setup();
  await enableBuddy(f);
  const op = (
    await f.request("/api/opportunities", { method: "POST", body: opportunity })
  ).data;
  const running = buddyChat(f, op.id);
  await started;
  assert.equal((await buddyChat(f, op.id)).status, 429);
  await f.request("/api/opportunities/" + op.id, {
    method: "PATCH",
    body: { revision: op.revision, nextAction: "Manual edit while thinking" },
  });
  release();
  const result = await running;
  assert.equal(result.status, 200);
  const reply = result.data.messages.at(-1);
  assert.equal(
    (
      await f.request(
        "/api/opportunities/" + op.id + "/buddy/apply/" + reply.id,
        { method: "POST", body: { revision: op.revision + 1 } },
      )
    ).status,
    409,
  );
  assert.equal(
    (await f.request("/api/opportunities/" + op.id)).data.nextAction,
    "Manual edit while thinking",
  );
});

test("concurrent saves of the same generated draft cannot create duplicate document versions", async (t) => {
  const f = await fixture(t, {
    buddyFetch: async () =>
      buddyResponse(
        buddyReply({
          draft: {
            kind: "cover",
            title: "Fictional cover",
            content:
              "# Alex Example\n\nDear Hiring Team,\nI led governance workshops.\n\nYours sincerely,\nAlex Example",
          },
        }),
      ),
  });
  await f.setup();
  await enableBuddy(f);
  const op = (
    await f.request("/api/opportunities", { method: "POST", body: opportunity })
  ).data;
  const evidence = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        name: "Career.txt",
        kind: "reference",
        contentBase64: Buffer.from(
          "Alex Example led governance workshops.",
        ).toString("base64"),
      },
    })
  ).data;
  const reply = (
    await buddyChat(f, op.id, { action: "cover", documentIds: [evidence.id] })
  ).data.messages.at(-1);
  const path = "/api/opportunities/" + op.id + "/buddy/draft/" + reply.id,
    body = { title: reply.draft.title, content: reply.draft.content };
  const responses = await Promise.all([
    f.request(path, { method: "POST", body }),
    f.request(path, { method: "POST", body }),
  ]);
  assert.ok(responses.some((result) => result.status === 200));
  assert.ok(responses.every((result) => [200, 429].includes(result.status)));
  assert.equal(
    (await f.request("/api/opportunities/" + op.id)).data.documents.length,
    1,
  );
});

test("model search and connection test use unsaved settings without running a model or persisting credentials", async (t) => {
  const calls = [];
  const f = await fixture(t, {
    buddyFetch: async (url, options) => {
      calls.push({ url, options });
      return new Response(
        JSON.stringify({
          models: [
            { name: "local-chat:latest", details: { format: "gguf" } },
            { name: "other-model:latest", details: { format: "gguf" } },
          ],
        }),
      );
    },
  });
  assert.equal(
    (
      await f.request("/api/buddy/models", {
        method: "POST",
        body: {},
        auth: false,
      })
    ).status,
    401,
  );
  await f.setup();
  const before = (await f.request("/api/buddy/settings")).data;
  const draft = {
    revision: before.revision,
    provider: "ollama",
    baseUrl: "http://career-server.private:11434",
    model: "",
    apiKey: "temporary-key",
    clearKey: false,
    outputMode: "schema",
  };
  const models = await f.request("/api/buddy/models", {
    method: "POST",
    body: draft,
  });
  assert.equal(models.status, 200);
  assert.equal(models.data.suggested, "local-chat:latest");
  assert.deepEqual(
    models.data.models.map((x) => x.id),
    ["local-chat:latest", "other-model:latest"],
  );
  const tested = await f.request("/api/buddy/test", {
    method: "POST",
    body: draft,
  });
  assert.equal(tested.status, 200);
  assert.equal(tested.data.check, "listing");
  assert.equal(tested.data.count, 2);
  assert.equal(
    (
      await f.request("/api/buddy/test", {
        method: "POST",
        body: { ...draft, model: "not-installed" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request("/api/buddy/models", {
        method: "POST",
        body: { ...draft, revision: 0 },
      })
    ).status,
    409,
  );
  assert.deepEqual((await f.request("/api/buddy/settings")).data, before);
  assert.ok(
    calls.every(
      (c) =>
        c.url.endsWith("/api/tags") &&
        c.options.method === "GET" &&
        !c.options.body,
    ),
  );
  assert.ok(!JSON.stringify(models.data).includes("temporary-key"));
});

test("temporary model searches do not forward a stored key to a different provider or server", async (t) => {
  const calls = [];
  const f = await fixture(t, {
    buddyFetch: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ models: [] }));
    },
  });
  await f.setup();
  const saved = await enableBuddy(f);
  const draft = {
    revision: saved.revision,
    provider: "ollama",
    baseUrl: "http://career-server.private:11434",
    model: "",
    apiKey: "",
    clearKey: false,
  };
  assert.equal(
    (await f.request("/api/buddy/models", { method: "POST", body: draft }))
      .status,
    200,
  );
  assert.equal(calls[0].options.headers.Authorization, undefined);
  const current = (await f.request("/api/buddy/settings")).data;
  assert.equal(current.provider, "custom");
  assert.equal(current.hasKey, true);
});

test("directory and multi-file uploads preserve relative folder labels and reject traversal or hidden segments", async (t) => {
  const f = await fixture(t);
  await f.setup();
  const uploaded = await f.request("/api/documents", {
    method: "POST",
    body: {
      name: "Obsidian Vault\\Projects/2026/Cloud Migration.md",
      kind: "reference",
      contentBase64: Buffer.from(
        "---\ntags: [kubernetes, platform]\n---\n# Cloud Migration\nDelivered 40% latency reduction. #architecture",
      ).toString("base64"),
    },
  });
  assert.equal(uploaded.status, 201);
  assert.equal(
    uploaded.data.name,
    "Obsidian Vault/Projects/2026/Cloud Migration.md",
  );
  assert.deepEqual(uploaded.data.tags, [
    "Obsidian Vault",
    "Projects",
    "2026",
    "Markdown",
    "kubernetes",
    "platform",
    "architecture",
  ]);
  const updatedTags = await f.request(`/api/documents/${uploaded.data.id}`, {
    method: "PATCH",
    body: {
      tags: ["Obsidian Vault", "Custom Tag", "#architecture"],
      revision: uploaded.data.revision,
    },
  });
  assert.equal(updatedTags.status, 200);
  assert.deepEqual(updatedTags.data.tags, [
    "Obsidian Vault",
    "Custom Tag",
    "architecture",
  ]);
  const downloaded = await f.request(uploaded.data.url);
  assert.equal(downloaded.status, 200);
  assert.match(
    downloaded.response.headers.get("content-disposition") || "",
    /filename="Cloud Migration\.md"/,
  );
  assert.match(downloaded.data, /Delivered 40% latency reduction/);
  const indexed = await f.request("/api/buddy/index", {
    method: "POST",
    body: { documentIds: [uploaded.data.id] },
  });
  assert.equal(indexed.status, 200);
  assert.equal(
    indexed.data.documents.find((d) => d.id === uploaded.data.id).extraction
      .status,
    "ready",
  );
  for (const invalidName of [
    "",
    ".",
    "..",
    "../secret.txt",
    "Vault/../secret.txt",
    ".obsidian/workspace.json",
    "Vault/.git/config",
    "Vault//empty-segment.md",
    "/absolute/path.md",
  ]) {
    const res = await f.request("/api/documents", {
      method: "POST",
      body: {
        name: invalidName,
        kind: "reference",
        contentBase64: Buffer.from("test").toString("base64"),
      },
    });
    assert.equal(res.status, 400, `Expected 400 for ${invalidName}`);
  }
});

test("board restart requires authentication, writes structured handoff, triggers onRestart, and preserves session across restart", async (t) => {
  let restartCount = 0;
  const f = await fixture(t, {
    onRestart: () => {
      restartCount++;
    },
  });
  const unauth = await f.request("/api/restart", {
    method: "POST",
    body: {},
    auth: false,
  });
  assert.equal(unauth.status, 401);
  assert.equal(restartCount, 0);

  await f.setup();
  const sessionCookie = (
    await f.request("/api/login", {
      method: "POST",
      body: { password: "correct horse battery staple" },
    })
  ).response.headers
    .get("set-cookie")
    .split(";")[0];

  await f.request("/api/settings", {
    method: "PATCH",
    body: { pendingHostPath: "/Volumes/Archive/OpportunityBoard" },
  });

  const restarted = await f.request("/api/restart", {
    method: "POST",
    body: {},
  });
  assert.equal(restarted.status, 202);
  assert.equal(restarted.data.restarting, true);
  assert.equal(
    restarted.data.pendingHostPath,
    "/Volumes/Archive/OpportunityBoard",
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(restartCount, 1);

  const pendingRestart = JSON.parse(
    readFileSync(join(f.options.dataDir, "pending-restart.json"), "utf8"),
  );
  assert.equal(
    pendingRestart.pendingHostPath,
    "/Volumes/Archive/OpportunityBoard",
  );

  // Simulate process restart and verify the browser session cookie remains authenticated
  await f.restart();
  const sessionAfterRestart = await f.request("/api/session", {
    auth: false,
    headers: { Cookie: sessionCookie },
  });
  assert.equal(sessionAfterRestart.status, 200);
  assert.equal(sessionAfterRestart.data.authenticated, true);
});

test("delete individual document and clear all library documents remove files and text cache while preserving submitted versions and opportunity files", async (t) => {
  const f = await fixture(t);
  await f.setup();

  const opp = (
    await f.request("/api/opportunities", {
      method: "POST",
      body: { company: "Fictional Corp", role: "Principal Engineer" },
    })
  ).data;

  const lib1 = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        name: "Notes/Career-Summary.md",
        kind: "reference",
        status: "draft",
        contentBase64: Buffer.from("# Summary\n10 years experience.").toString(
          "base64",
        ),
      },
    })
  ).data;
  const lib2 = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        name: "Notes/Project-Outcomes.md",
        kind: "reference",
        status: "approved",
        contentBase64: Buffer.from("# Outcomes\nShipped v2.").toString(
          "base64",
        ),
      },
    })
  ).data;
  const libSubmitted = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        name: "Submitted-Reference.txt",
        kind: "reference",
        status: "submitted",
        contentBase64: Buffer.from("Submitted reference snapshot").toString(
          "base64",
        ),
      },
    })
  ).data;
  const oppDoc = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        opportunityId: opp.id,
        name: "Tailored-CV.md",
        kind: "cv",
        status: "draft",
        contentBase64: Buffer.from("# Tailored CV").toString("base64"),
      },
    })
  ).data;

  await f.request("/api/buddy/index", {
    method: "POST",
    body: { documentIds: [lib1.id, lib2.id] },
  });

  // Delete single library document
  const delOne = await f.request(`/api/documents/${lib1.id}`, {
    method: "DELETE",
  });
  assert.equal(delOne.status, 200);
  assert.equal((await f.request(lib1.url)).status, 404);

  // Submitted document cannot be deleted individually
  const delSubmitted = await f.request(`/api/documents/${libSubmitted.id}`, {
    method: "DELETE",
  });
  assert.equal(delSubmitted.status, 409);

  // Clear all library documents removes remaining non-submitted library items, preserves submitted & opportunity docs
  const cleared = await f.request("/api/documents?scope=library", {
    method: "DELETE",
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.deletedCount, 1);
  assert.equal(cleared.data.preservedSubmittedCount, 1);

  const remaining = (await f.request("/api/documents")).data.documents;
  assert.deepEqual(
    remaining.map((d) => d.id).sort(),
    [libSubmitted.id, oppDoc.id].sort(),
  );
});

test("buddy index reset clears prepared library text and force re-prepare rebuilds chunks", async (t) => {
  const f = await fixture(t);
  await f.setup();

  const doc = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        name: "Portfolio/Architecture-Deck.md",
        kind: "reference",
        status: "approved",
        contentBase64: Buffer.from(
          "# Architecture\nLed platform reliability and zero-downtime migrations.",
        ).toString("base64"),
      },
    })
  ).data;

  // Initially pending (not prepared)
  const initialBuddyDocs = (await f.request("/api/buddy/documents")).data
    .documents;
  assert.equal(
    initialBuddyDocs.find((d) => d.id === doc.id).extraction.status,
    "pending",
  );

  // Prepare library text
  const prepared = await f.request("/api/buddy/index", {
    method: "POST",
    body: { documentIds: [doc.id] },
  });
  assert.equal(prepared.status, 200);
  assert.equal(
    prepared.data.documents.find((d) => d.id === doc.id).extraction.status,
    "ready",
  );

  // Reset prepared library text
  const reset = await f.request("/api/buddy/index", {
    method: "DELETE",
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.ok, true);
  assert.equal(reset.data.resetCount, 1);
  assert.equal(
    reset.data.documents.find((d) => d.id === doc.id).extraction.status,
    "pending",
  );

  // Re-prepare with force: true
  const reprepared = await f.request("/api/buddy/index", {
    method: "POST",
    body: { documentIds: [doc.id], force: true },
  });
  assert.equal(reprepared.status, 200);
  assert.equal(
    reprepared.data.documents.find((d) => d.id === doc.id).extraction.status,
    "ready",
  );
});

test("bulk delete by folder and by tag removes matching non-submitted documents and preserves others", async (t) => {
  const f = await fixture(t);
  await f.setup();

  const folderDoc1 = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        name: "Talks/2025/Keynote.md",
        kind: "reference",
        status: "approved",
        tags: ["speaking", "2025"],
        contentBase64: Buffer.from("# Keynote 2025").toString("base64"),
      },
    })
  ).data;
  const folderSubmitted = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        name: "Talks/2025/Submitted-Deck.md",
        kind: "reference",
        status: "submitted",
        tags: ["speaking", "2025"],
        contentBase64: Buffer.from("# Submitted Deck").toString("base64"),
      },
    })
  ).data;
  const taggedDoc = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        name: "Notes/Python-Case-Study.md",
        kind: "reference",
        status: "draft",
        tags: ["python", "case-study"],
        contentBase64: Buffer.from("# Python Case Study").toString("base64"),
      },
    })
  ).data;
  const rootDoc = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        name: "General-Bio.txt",
        kind: "reference",
        status: "draft",
        tags: ["bio"],
        contentBase64: Buffer.from("Bio summary").toString("base64"),
      },
    })
  ).data;

  // Bulk delete folder "Talks/2025" removes folderDoc1 and preserves folderSubmitted
  const delFolder = await f.request(
    `/api/documents?scope=library&folder=${encodeURIComponent("Talks/2025")}`,
    { method: "DELETE" },
  );
  assert.equal(delFolder.status, 200);
  assert.equal(delFolder.data.deletedCount, 1);
  assert.equal(delFolder.data.preservedSubmittedCount, 1);

  // Bulk delete tag "python" removes taggedDoc
  const delTag = await f.request("/api/documents?scope=library&tag=PYTHON", {
    method: "DELETE",
  });
  assert.equal(delTag.status, 200);
  assert.equal(delTag.data.deletedCount, 1);

  const remainingIds = (await f.request("/api/documents")).data.documents
    .map((d) => d.id)
    .sort();
  assert.deepEqual(remainingIds, [folderSubmitted.id, rootDoc.id].sort());

  // Bulk delete top-level (__root__) removes rootDoc
  const delRoot = await f.request(
    "/api/documents?scope=library&folder=__root__",
    { method: "DELETE" },
  );
  assert.equal(delRoot.status, 200);
  assert.equal(delRoot.status, 200);
  assert.equal(delRoot.data.deletedCount, 1);
  assert.equal(folderDoc1.name, "Talks/2025/Keynote.md");
  assert.equal(taggedDoc.name, "Notes/Python-Case-Study.md");
});

test("Obsidian integration can create a new vault, import existing sources into the vault, and connect and sync an existing vault", async (t) => {
  const f = await fixture(t);
  await f.setup();

  // Upload two library sources: one Markdown note and one HTML document
  await f.request("/api/documents", {
    method: "POST",
    body: {
      name: "Projects/Distributed-Cache.md",
      kind: "reference",
      status: "approved",
      tags: ["architecture", "redis"],
      contentBase64: Buffer.from(
        "# Distributed Cache\nReduced p99 latency by 65% across 4 regions.",
      ).toString("base64"),
    },
  });
  await f.request("/api/documents", {
    method: "POST",
    body: {
      name: "Talks/Platform-Talk.html",
      kind: "reference",
      status: "approved",
      notes: "Conference talk deck handout",
      tags: ["speaking"],
      contentBase64: Buffer.from(
        "<html><body><h1>Platform Engineering</h1><p>Self-service deployment pipelines.</p></body></html>",
      ).toString("base64"),
    },
  });

  // 1. Create a new Obsidian vault in a workspace subfolder and import existing library sources
  const created = await f.request("/api/obsidian/configure", {
    method: "POST",
    body: {
      action: "create",
      locationType: "subpath",
      subpath: "career-vault",
      vaultName: "My Career Vault",
      importExisting: true,
      importOnlyPrepared: false,
    },
  });
  assert.equal(created.status, 200);
  assert.equal(created.data.ok, true);
  assert.equal(created.data.obsidian.enabled, true);
  assert.equal(created.data.obsidian.vaultStats.exists, true);
  assert.equal(created.data.obsidian.vaultStats.hasObsidianConfig, true);
  assert.equal(created.data.importedToVault.importedNotesCount, 2);
  assert.equal(created.data.importedToVault.copiedAttachmentsCount, 1);

  const vaultDir = join(f.options.filesDir, "career-vault");
  assert.ok(existsSync(join(vaultDir, ".obsidian", "app.json")));
  assert.ok(existsSync(join(vaultDir, "00 - Opportunity Knox Hub.md")));
  const exportedMd = readFileSync(
    join(vaultDir, "Career Library", "Projects", "Distributed-Cache.md"),
    "utf8",
  );
  assert.match(exportedMd, /title: "Distributed-Cache"/);
  assert.match(exportedMd, /Reduced p99 latency by 65%/);

  const companionMd = readFileSync(
    join(vaultDir, "Career Library", "Talks", "Platform-Talk.md"),
    "utf8",
  );
  assert.match(companionMd, /!\[\[Attachments\/Talks\/Platform-Talk\.html\]\]/);
  assert.match(companionMd, /## Extracted Content/);
  assert.match(companionMd, /Self-service deployment pipelines/);

  // 2. Point to an existing external Obsidian vault on disk and sync its notes into the library
  const existingVaultPath = join(f.options.dataDir, "external-obsidian-vault");
  mkdirSync(join(existingVaultPath, ".obsidian"), { recursive: true });
  mkdirSync(join(existingVaultPath, "Wins"), { recursive: true });
  writeFileSync(
    join(existingVaultPath, "Wins", "Staff-Promotion-Case.md"),
    "---\ntags: [leadership, promotion]\n---\n# Staff Promotion\nMentored 8 engineers and led org-wide RFC process #mentoring.\n",
  );

  const connected = await f.request("/api/obsidian/configure", {
    method: "POST",
    body: {
      action: "connect",
      locationType: "hostPath",
      hostPath: existingVaultPath,
      vaultName: "External Vault",
      importExisting: false,
      syncFromVault: true,
    },
  });
  assert.equal(connected.status, 200);
  assert.equal(connected.data.obsidian.enabled, true);
  assert.equal(connected.data.syncedFromVault.importedCount, 1);
  assert.equal(connected.data.syncedFromVault.preparedCount, 1);

  const allDocs = (await f.request("/api/documents")).data.documents;
  const syncedDoc = allDocs.find(
    (d) => d.name === "Wins/Staff-Promotion-Case.md",
  );
  assert.ok(syncedDoc);
  assert.ok(syncedDoc.tags.includes("Obsidian"));
  assert.ok(syncedDoc.tags.includes("leadership"));
  assert.ok(syncedDoc.tags.includes("mentoring"));

  // Prepared text for the synced vault note is immediately ready for Career Buddy
  const buddyDocs = (await f.request("/api/buddy/documents")).data.documents;
  assert.equal(
    buddyDocs.find((d) => d.id === syncedDoc.id).extraction.status,
    "ready",
  );
});

test("library moves preserve bytes, IDs, metadata and prepared text for one or many files", async (t) => {
  const f = await fixture(t);
  await f.setup();
  const first = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        name: "Old/CV.txt",
        kind: "cv",
        contentBase64: Buffer.from("Fictional career evidence one").toString(
          "base64",
        ),
        notes: "Fictional note",
      },
    })
  ).data;
  const second = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        name: "Old/Notes.txt",
        kind: "reference",
        contentBase64: Buffer.from("Fictional career evidence two").toString(
          "base64",
        ),
      },
    })
  ).data;
  await f.request("/api/buddy/index", {
    method: "POST",
    body: { documentIds: [first.id] },
  });
  const readDb = () => {
    const db = new DatabaseSync(join(f.options.dataDir, "board.sqlite"), {
      readOnly: true,
    });
    const rows = Object.fromEntries(
      db
        .prepare("SELECT id,data FROM documents")
        .all()
        .map((r) => [r.id, JSON.parse(r.data)]),
    );
    db.close();
    return rows;
  };
  const before = readDb();
  const moved = await f.request("/api/documents/move", {
    method: "POST",
    body: {
      folder: "Projects/Current",
      documents: [first, second].map((d) => ({
        id: d.id,
        revision: d.revision,
      })),
    },
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.retainedOriginals, 0);
  const after = readDb();
  for (const doc of [first, second]) {
    assert.equal(
      after[doc.id].name,
      "Projects/Current/" + doc.name.split("/").pop(),
    );
    assert.equal(after[doc.id].revision, doc.revision + 1);
    assert.equal(after[doc.id].sha256, before[doc.id].sha256);
    assert.equal(after[doc.id].notes, before[doc.id].notes);
    assert.deepEqual(after[doc.id].tags, before[doc.id].tags);
    assert.match(
      after[doc.id].relativePath,
      /^references\/Projects\/Current\//,
    );
    assert.ok(
      !existsSync(
        join(before[doc.id].storageRoot, before[doc.id].relativePath),
      ),
    );
    assert.ok(
      existsSync(join(after[doc.id].storageRoot, after[doc.id].relativePath)),
    );
    assert.match(
      (await f.request("/api/documents/" + doc.id + "/content")).data,
      /Fictional career evidence/,
    );
  }
  const prepared = (
    await f.request("/api/buddy/documents")
  ).data.documents.find((d) => d.id === first.id);
  assert.equal(prepared.extraction.status, "ready");
  await f.restart();
  await f.login();
  assert.match(
    (await f.request("/api/documents/" + first.id + "/content")).data,
    /evidence one/,
  );
  const back = await f.request("/api/documents/move", {
    method: "POST",
    body: {
      folder: "",
      documents: [{ id: first.id, revision: after[first.id].revision }],
    },
  });
  assert.equal(back.status, 200);
  assert.equal(back.data.documents[0].name, "CV.txt");
});

test("library moves reject stale, invalid or conflicting targets without changing any source", async (t) => {
  const f = await fixture(t);
  await f.setup();
  async function upload(name, status = "draft") {
    return (
      await f.request("/api/documents", {
        method: "POST",
        body: {
          name,
          kind: "reference",
          status,
          contentBase64: Buffer.from("Fictional original " + name).toString(
            "base64",
          ),
        },
      })
    ).data;
  }
  const a = await upload("a.txt"),
    b = await upload("b.txt"),
    submitted = await upload("submitted.txt", "submitted");
  const refs = [a, b].map((d) => ({ id: d.id, revision: d.revision }));
  for (const folder of [
    "../outside",
    "/absolute",
    ".hidden",
    "A/../B",
    "A//B",
  ]) {
    const bad = await f.request("/api/documents/move", {
      method: "POST",
      body: { folder, documents: refs },
    });
    assert.equal(bad.status, 400, folder);
  }
  assert.equal(
    (
      await f.request("/api/documents/move", {
        method: "POST",
        body: { folder: "New", documents: [{ id: a.id, revision: 0 }] },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request("/api/documents/move", {
        method: "POST",
        body: {
          folder: "New",
          documents: [{ id: submitted.id, revision: submitted.revision }],
        },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request("/api/documents/move", {
        method: "POST",
        body: { folder: "New", documents: [refs[0], refs[0]] },
      })
    ).status,
    400,
  );
  const target = join(f.options.filesDir, "references", "Collision");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, b.id + ".txt"), "Existing unrelated file");
  const conflict = await f.request("/api/documents/move", {
    method: "POST",
    body: { folder: "Collision", documents: refs },
  });
  assert.equal(conflict.status, 409);
  assert.equal(
    readFileSync(join(target, b.id + ".txt"), "utf8"),
    "Existing unrelated file",
  );
  assert.equal(existsSync(join(target, a.id + ".txt")), false);
  for (const doc of [a, b])
    assert.match(
      (await f.request("/api/documents/" + doc.id + "/content")).data,
      /Fictional original/,
    );
  assert.equal(
    (await f.request("/api/documents")).data.documents.find(
      (d) => d.id === a.id,
    ).revision,
    a.revision,
  );
});

test("moving a library file from a previous storage root retains its original copy", async (t) => {
  const f = await fixture(t, {
    beforeOpen(options) {
      const old = join(options.dataDir, "..", "previous-root");
      mkdirSync(old, { recursive: true });
      options.documentRoots = [old];
    },
  });
  await f.setup();
  const doc = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        name: "Original.txt",
        kind: "reference",
        contentBase64: Buffer.from("Previous-root fictional content").toString(
          "base64",
        ),
      },
    })
  ).data;
  const db = new DatabaseSync(join(f.options.dataDir, "board.sqlite"));
  const stored = JSON.parse(
    db.prepare("SELECT data FROM documents WHERE id=?").get(doc.id).data,
  );
  const oldRoot = realpathSync(f.options.documentRoots[0]),
    oldPath = join(oldRoot, "Original.txt");
  writeFileSync(
    oldPath,
    readFileSync(join(stored.storageRoot, stored.relativePath)),
  );
  rmSync(join(stored.storageRoot, stored.relativePath));
  stored.storageRoot = oldRoot;
  stored.relativePath = "Original.txt";
  db.prepare("UPDATE documents SET data=? WHERE id=?").run(
    JSON.stringify(stored),
    doc.id,
  );
  db.close();
  const moved = await f.request("/api/documents/move", {
    method: "POST",
    body: {
      folder: "Moved",
      documents: [{ id: doc.id, revision: doc.revision }],
    },
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.equal(moved.data.retainedOriginals, 1);
  assert.equal(
    readFileSync(oldPath, "utf8"),
    "Previous-root fictional content",
  );
  assert.equal(
    (await f.request("/api/documents/" + doc.id + "/content")).data,
    "Previous-root fictional content",
  );
});

test("connecting an existing read-only vault never writes or imports files", async (t) => {
  const f = await fixture(t);
  await f.setup();
  const vault = join(f.options.dataDir, "fictional-readonly-vault");
  mkdirSync(vault);
  writeFileSync(join(vault, "example.md"), "fictional original note\n");
  const before = readdirSync(vault);
  const result = await f.request("/api/obsidian/configure", {
    method: "POST", body: { action: "connect", locationType: "hostPath", hostPath: vault,
      vaultName: "Example", readOnly: true, importExisting: true, syncFromVault: false },
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.obsidian.readOnly, true);
  assert.equal(result.data.importedToVault, undefined);
  assert.deepEqual(readdirSync(vault), before);
  const writeAttempt = await f.request("/api/obsidian/import-to-vault", {method: "POST", body: {}});
  assert.equal(writeAttempt.status, 403);
  assert.deepEqual(readdirSync(vault), before);
  assert.equal(readFileSync(join(vault, "example.md"), "utf8"), "fictional original note\n");
  assert.equal((await f.request("/api/documents")).data.documents.length, 0);
});

test("selected vault sources remain in place and refresh cached text when changed", async (t) => {
  let sent;
  const f = await fixture(t, { buddyFetch: async (_, opts) => { sent = opts.body; return buddyResponse(buddyReply()); } }); await f.setup();
  await enableBuddy(f);
  const vault = join(f.options.dataDir, "fictional-vault-sources"); mkdirSync(vault);
  writeFileSync(join(vault, "experience.md"), "Fictional original experience");
  const connect = await f.request("/api/obsidian/configure", {method:"POST", body:{ action:"connect", locationType:"hostPath", hostPath:vault, readOnly:true }});
  assert.equal(connect.status, 200);
  const listing = await f.request("/api/obsidian/sources");
  assert.equal(listing.data.sources.length, 1);
  const id = listing.data.sources[0].id;
  assert.equal((await f.request("/api/obsidian/sources", {method:"POST",body:{ids:[id]}})).status, 200);
  const created = await f.request("/api/opportunities", {method:"POST",body:opportunity});
  const buddy = await f.request(`/api/opportunities/${created.data.id}/buddy`);
  assert.ok(buddy.data.documents.some((doc) => doc.id === id));
  assert.equal((await f.request("/api/documents")).data.documents.length, 0);
  assert.deepEqual(readdirSync(vault), ["experience.md"]);
  assert.equal((await f.request("/api/buddy/index", {method:"POST",body:{documentIds:[id]}})).status, 200);
  writeFileSync(join(vault,"experience.md"), "Fictional changed experience");
  assert.equal((await f.request("/api/buddy/index", {method:"POST",body:{documentIds:[id]}})).status, 200);
  const db = new DatabaseSync(join(f.options.dataDir, "board.sqlite"), {readOnly:true});
  const row = db.prepare("SELECT data FROM document_text WHERE id=?").get(id);
  assert.match(JSON.parse(row.data).text, /changed experience/); db.close();
  const chat = await buddyChat(f, created.data.id, { documentIds: [id] });
  assert.equal(chat.status, 200);
  assert.match(sent, /Fictional changed experience/);
  await f.request("/api/obsidian/sources", {method:"POST",body:{ids:[]}});
  const verifyDb = new DatabaseSync(join(f.options.dataDir, "board.sqlite"), {readOnly:true});
  assert.equal(verifyDb.prepare("SELECT data FROM document_text WHERE id=?").get(id), undefined); verifyDb.close();
  assert.equal((await f.request(`/api/opportunities/${created.data.id}/buddy`)).data.documents.some((doc) => doc.id === id), false);
});

test("retrying an import request returns the original document without another version", async (t) => {
  const f = await fixture(t); await f.setup();
  const body = {name:"fictional.txt", kind:"reference", status:"draft", contentBase64:Buffer.from("fictional source").toString("base64"), importRequestId:"fictional-request-123456789"};
  const first = await f.request("/api/documents", {method:"POST",body});
  const retry = await f.request("/api/documents", {method:"POST",body});
  assert.equal(first.status,201); assert.equal(retry.status,200); assert.equal(first.data.id,retry.data.id);
  assert.equal((await f.request("/api/documents")).data.documents.length,1);
  const conflict = await f.request("/api/documents", {method:"POST",body:{...body,contentBase64:Buffer.from("different").toString("base64")}});
  assert.equal(conflict.status,409);
});

test("backup inspection checks real snapshot hashes without changing the board", async (t) => {
  const f = await fixture(t); await f.setup();
  const doc = await f.request("/api/documents", {method:"POST",body:{name:"fictional.txt",kind:"reference",contentBase64:Buffer.from("fictional original").toString("base64")}});
  const backup = await f.request("/api/backup", {method:"POST",body:{}});
  const before = await f.request("/api/backups"); assert.ok(before.data.backups.some((x) => x.name === backup.data.name));
  const inspect = () => f.request("/api/backups/inspect", {method:"POST",body:{name:backup.data.name}});
  const good = await inspect(); assert.equal(good.status,200); assert.equal(good.data.valid,true); assert.equal(good.data.checked,1);
  const saved = join(backup.data.location,"documents",doc.data.id); writeFileSync(saved,"fictional tampering");
  const changed = await inspect(); assert.equal(changed.data.valid,false); assert.equal(changed.data.issues.length,1);
  rmSync(saved); const missing = await inspect(); assert.equal(missing.data.valid,false);
  assert.equal((await f.request("/api/documents")).data.documents.length,1);
  const bad = await f.request("/api/backups/inspect",{method:"POST",body:{name:"../escape"}}); assert.equal(bad.status,400);
});

test("browser isolated restore requires confirmation and preserves the current board", async (t) => {
 const f = await fixture(t); await f.setup();
 const doc=await f.request('/api/documents',{method:'POST',body:{name:'fictional.txt',contentBase64:Buffer.from('fictional restore contents').toString('base64')}});
 const backup=await f.request('/api/backup',{method:'POST',body:{}});
 assert.equal((await f.request('/api/backups/restore-isolated',{method:'POST',body:{name:backup.data.name}})).status,400);
 const result=await f.request('/api/backups/restore-isolated',{method:'POST',body:{name:backup.data.name,confirm:true}});
 assert.equal(result.status,201);assert.equal(result.data.started,false);assert.equal(result.data.documentsRestored,1);
 assert.ok(result.data.destination.startsWith(join(realpathSync(f.options.dataDir),'restores')));
 assert.equal((await f.request('/api/documents')).data.documents[0].id,doc.data.id);
 assert.equal((await f.request('/api/backups/restore-isolated',{method:'POST',auth:false,body:{name:backup.data.name,confirm:true}})).status,401);
});

test('embedding settings are independent, secret-safe and persistent', async(t)=>{
 const f=await fixture(t);await f.setup();
 const chat=(await f.request('/api/buddy/settings')).data;
 const initial=(await f.request('/api/buddy/embedding-settings')).data;
 assert.equal((await f.request('/api/buddy/embedding-settings',{auth:false})).status,401);
 const body={revision:initial.revision,provider:'ollama',baseUrl:'http://localhost:11434',model:'fictional-embedding-model',apiKey:'fictional-embedding-secret'};
 const saved=await f.request('/api/buddy/embedding-settings',{method:'PATCH',body});
 assert.equal(saved.status,200);assert.equal(saved.data.hasKey,true);assert.equal(saved.data.apiKey,undefined);
 assert.deepEqual((await f.request('/api/buddy/settings')).data,chat);
 assert.equal((await f.request('/api/buddy/embedding-settings',{method:'PATCH',body})).status,409);
 assert.equal(JSON.stringify((await f.request('/api/export')).data).includes('fictional-embedding-secret'),false);
 await f.restart();await f.login();
 const restored=(await f.request('/api/buddy/embedding-settings')).data;
 assert.equal(restored.model,body.model);assert.equal(restored.hasKey,true);
 const changed=await f.request('/api/buddy/embedding-settings',{method:'PATCH',body:{revision:restored.revision,provider:'custom',baseUrl:'https://new.example/v1',model:'different',apiKey:''}});
 assert.equal(changed.status,200);assert.equal(changed.data.hasKey,false);
});

test('built-in embedding default needs no key and clears external credentials when selected',async(t)=>{
 const f=await fixture(t);await f.setup();
 const initial=(await f.request('/api/buddy/embedding-settings')).data;
 assert.equal(initial.provider,'builtin');assert.equal(initial.hasKey,false);assert.equal(initial.model,'Xenova/all-MiniLM-L6-v2');
 const ext=await f.request('/api/buddy/embedding-settings',{method:'PATCH',body:{revision:initial.revision,provider:'custom',baseUrl:'https://fictional.example/v1',model:'fixture',apiKey:'fictional-key'}});
 assert.equal(ext.status,200);
 const local=await f.request('/api/buddy/embedding-settings',{method:'PATCH',body:{revision:ext.data.revision,provider:'builtin',apiKey:'should-not-be-saved'}});
 assert.equal(local.status,200);assert.equal(local.data.hasKey,false);assert.equal(local.data.baseUrl,'');
});

test('embedding model discovery and capability tests work before and after saving, retain same-endpoint keys and never start indexing',async(t)=>{
 const calls=[];
 const f=await fixture(t,{
  embeddingFn:async texts=>texts.map(()=>[1,...Array(383).fill(0)]),
  buddyFetch:async(url,opts)=>{
   calls.push({url,method:opts.method,auth:opts.headers?.Authorization||'',body:opts.body?JSON.parse(opts.body):null});
   if(url==='http://localhost:11434/api/tags')return new Response(JSON.stringify({models:[{name:'chat-only:latest',details:{format:'gguf',family:'llama'}},{name:'fictional-embed:latest',details:{format:'gguf',family:'nomic-bert'}}]}));
   if(url==='http://localhost:11434/api/embed')return new Response(JSON.stringify({model:'fictional-embed:latest',embeddings:[[1,...Array(767).fill(0)]]}));
   if(url==='https://api.openai.com/v1/models')return new Response(JSON.stringify({data:[{id:'gpt-4o'},{id:'text-embedding-3-small'}]}));
   if(url==='https://api.openai.com/v1/embeddings')return new Response(JSON.stringify({model:'text-embedding-3-small',data:[{index:0,embedding:[1,...Array(1535).fill(0)]}]}));
   return new Response('not found',{status:404});
  }
 });await f.setup();
 assert.equal((await f.request('/api/buddy/embedding-models',{method:'POST',auth:false,body:{}})).status,401);
 assert.equal((await f.request('/api/buddy/embedding-test',{method:'POST',auth:false,body:{}})).status,401);
 const initial=(await f.request('/api/buddy/embedding-settings')).data;
 const localTest=await f.request('/api/buddy/embedding-test',{method:'POST',body:{}});
 assert.equal(localTest.status,200);assert.equal(localTest.data.dimensions,384);assert.equal(localTest.data.provider,'builtin');
 // Unsaved Ollama discovery and capability test
 const ollamaModels=await f.request('/api/buddy/embedding-models',{method:'POST',body:{revision:initial.revision,provider:'ollama',baseUrl:'http://localhost:11434'}});
 assert.equal(ollamaModels.status,200);assert.deepEqual(ollamaModels.data.models.map(m=>m.id),['fictional-embed:latest']);assert.equal(ollamaModels.data.suggested,'fictional-embed:latest');
 const ollamaTest=await f.request('/api/buddy/embedding-test',{method:'POST',body:{revision:initial.revision,provider:'ollama',baseUrl:'http://localhost:11434',model:'fictional-embed:latest'}});
 assert.equal(ollamaTest.status,200);assert.equal(ollamaTest.data.dimensions,768);assert.equal(ollamaTest.data.normalized,true);
 // Unsaved test does not mutate saved settings or start vector indexing
 assert.equal((await f.request('/api/buddy/embedding-settings')).data.provider,'builtin');
 assert.equal((await f.request('/api/buddy/vector-index')).data.job,null);
 // Save OpenAI embedding settings and verify stored key reuse vs endpoint change
 const saved=await f.request('/api/buddy/embedding-settings',{method:'PATCH',body:{revision:initial.revision,provider:'openai',baseUrl:'https://api.openai.com/v1',model:'text-embedding-3-small',apiKey:'fictional-openai-embed-key'}});
 assert.equal(saved.status,200);
 const openaiModels=await f.request('/api/buddy/embedding-models',{method:'POST',body:{revision:saved.data.revision,provider:'openai',baseUrl:'https://api.openai.com/v1',apiKey:''}});
 assert.equal(openaiModels.status,200);assert.equal(openaiModels.data.suggested,'text-embedding-3-small');
 assert.equal(calls.at(-1).auth,'Bearer fictional-openai-embed-key');
 const openaiTest=await f.request('/api/buddy/embedding-test',{method:'POST',body:{revision:saved.data.revision,provider:'openai',baseUrl:'https://api.openai.com/v1',model:'text-embedding-3-small',apiKey:''}});
 assert.equal(openaiTest.status,200);assert.equal(openaiTest.data.dimensions,1536);assert.equal(calls.at(-1).auth,'Bearer fictional-openai-embed-key');
 // Switching to custom endpoint without a new key does not send the OpenAI key
 const customTest=await f.request('/api/buddy/embedding-test',{method:'POST',body:{revision:saved.data.revision,provider:'custom',baseUrl:'https://custom.example/v1',model:'custom-embed',apiKey:''}});
 assert.equal(customTest.status,502);assert.equal(calls.at(-1).auth,'');
});

test('explicit vector indexing is authenticated, persistent and removable without changing original documents',async t=>{
 const f=await fixture(t,{embeddingFn:async texts=>texts.map(()=>[1,...Array(383).fill(0)])});await f.setup();
 const route='/api/buddy/vector-index';assert.equal((await f.request(route,{auth:false})).status,401);
 const doc=await f.request('/api/documents',{method:'POST',body:{name:'fictional-vector.txt',contentBase64:Buffer.from('Fictional achievement: delivered a fictional data project.').toString('base64')}});assert.equal(doc.status,201);
 assert.equal((await f.request(route)).data.sources[0].status,'pending');
 assert.equal((await f.request(route,{method:'POST',body:{documentIds:['missing']}})).status,400);
 assert.equal((await f.request(route,{method:'POST',body:{documentIds:[doc.data.id]}})).status,200);
 let state;for(let i=0;i<100;i++){state=(await f.request(route)).data;if(state.job.status==='completed')break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(state.job.status,'completed');assert.equal(state.sources[0].chunks,1);assert.equal(state.dimensions,384);
 await f.restart();await f.login();assert.equal((await f.request(route)).data.sources[0].status,'indexed');
 const backup=await f.request('/api/backup',{method:'POST',body:{}});assert.equal(backup.status,200);
 const snapshot=new DatabaseSync(join(backup.data.location,'board.sqlite'),{readOnly:true});assert.equal(snapshot.prepare('SELECT COUNT(*) n FROM document_vectors').get().n,1);snapshot.close();
 assert.equal((await f.request(route,{method:'DELETE'})).status,200);assert.equal((await f.request(route)).data.sources[0].chunks,0);
 assert.equal((await f.request('/api/documents/'+doc.data.id+'/content',{binary:true})).data.toString(),'Fictional achievement: delivered a fictional data project.');
});

test('Career Buddy uses hybrid excerpts only from selected sources, persists coverage and falls back on model failure',async t=>{
 let context,fail=false,selectedId,hiddenId;
 const f=await fixture(t,{
  embeddingFn:async texts=>{if(fail)throw Error('fictional unavailable model');return texts.map(text=>text.includes('leadership')||text.includes('coached')?[1,...Array(383).fill(0)]:[0,1,...Array(382).fill(0)]);},
  buddyFetch:async(_,opts)=>{context=JSON.parse(JSON.parse(opts.body).messages.at(-1).content);return buddyResponse(buddyReply({reply:'Fictional coaching evidence.',sourceIds:[selectedId,hiddenId]}));}
 });await f.setup();await enableBuddy(f);
 const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;
 async function upload(name,text){return (await f.request('/api/documents',{method:'POST',body:{name,kind:'cv',contentBase64:Buffer.from(text).toString('base64')}})).data;}
 const source=await upload('Fictional selected CV.txt','Pottery and gardening. '.repeat(2100)+'I coached colleagues and mentored engineers.');selectedId=source.id;
 const hidden=await upload('Fictional unselected confidential.txt','Unselected secret career evidence.');hiddenId=hidden.id;
 const plain=await upload('Fictional unindexed notes.txt','Fictional leadership notes.');
 await f.request('/api/buddy/vector-index',{method:'POST',body:{documentIds:[source.id,hidden.id]}});
 for(let i=0;i<200;i++){const state=(await f.request('/api/buddy/vector-index')).data;if(state.job.status==='completed')break;await new Promise(r=>setTimeout(r,5));}
 const result=await buddyChat(f,op.id,{message:'What leadership evidence can I highlight?',documentIds:[source.id,plain.id]});assert.equal(result.status,200);
 const answer=result.data.messages.at(-1);assert.equal(answer.context.retrieval.mode,'hybrid');assert.equal(answer.context.retrieval.indexedSources,1);
 assert.ok(context.context.excerpts.some(c=>c.text.includes('coached')));assert.ok(answer.sources.find(s=>s.id===source.id).excerpts.some(e=>e.matchedBy.includes('semantic')));
 assert.equal(context.context.excerpts.some(c=>c.sourceId===hidden.id),false);assert.equal(JSON.stringify(context).includes('Unselected secret'),false);assert.equal(answer.sourceIds.includes(hidden.id),false);assert.ok(answer.sourceIds.includes(source.id));
 assert.ok(answer.context.characters<=36000);
 fail=true;const fallback=await buddyChat(f,op.id,{message:'What leadership evidence can I highlight?',documentIds:[source.id]});assert.equal(fallback.status,200);assert.equal(fallback.data.messages.at(-1).context.retrieval.reason,'model-unavailable');
 await f.restart();await f.login();const saved=(await f.request('/api/opportunities/'+op.id+'/buddy')).data.messages.find(m=>m.id===answer.id);assert.equal(saved.context.retrieval.mode,'hybrid');assert.ok(saved.sources[0].excerpts.length);
});

test('criteria assessments use independent private settings, persist snapshots, reject edits and become stale',async t=>{
 let payload,output,sourceId;
 const f=await fixture(t,{buddyFetch:async(_,opts)=>{payload=JSON.parse(JSON.parse(opts.body).messages.at(-1).content);return buddyResponse(buddyReply(output));}});await f.setup();
 assert.equal((await f.request('/api/buddy/fit-criteria',{auth:false})).status,401);
 const chat=(await f.request('/api/buddy/settings')).data;
 const initial=(await f.request('/api/buddy/decision-settings')).data;
 const c=await f.request('/api/buddy/decision-settings',{method:'PATCH',body:{revision:initial.revision,enabled:true,provider:'custom',baseUrl:'https://fictional-model.example/v1',model:'fictional-decision',apiKey:'fictional-decision-private'}});assert.equal(c.status,200);assert.equal(c.data.apiKey,undefined);
 assert.deepEqual((await f.request('/api/buddy/settings')).data,chat);
 const criteria={revision:1,items:[{id:'location',description:'London based role',priority:'required'},{id:'salary',description:'GBP 80,000 base or more',priority:'preferred'}]};
 const saved=await f.request('/api/buddy/fit-criteria',{method:'PATCH',body:criteria});assert.equal(saved.status,200);
 assert.equal((await f.request('/api/buddy/fit-criteria',{method:'PATCH',body:criteria})).status,409);
 const op=(await f.request('/api/opportunities',{method:'POST',body:{...opportunity,location:'London'}})).data;
 const doc=(await f.request('/api/documents',{method:'POST',body:{name:'Fictional reference.txt',contentBase64:Buffer.from('Fictional career evidence.').toString('base64')}})).data;sourceId=doc.id;
 const route='/api/buddy/decisions/'+op.id,body={revision:op.revision,criteriaRevision:saved.data.revision,documentIds:[doc.id]};
 output={reply:JSON.stringify({recommendation:'consider',summary:'Location fits; salary unknown.',criteria:[{id:'location',status:'met',reason:'Role location is London.',sourceIds:[op.id],questions:[]},{id:'salary',status:'unknown',reason:'Salary is not listed.',sourceIds:[],questions:['What is the base salary?']}]})};
 const result=await f.request(route,{method:'POST',body});assert.equal(result.status,200);assert.equal(result.data.assessment.results.length,2);assert.equal(result.data.assessment.stale,false);assert.equal(payload.criteria[0].description,'London based role');assert.ok(payload.excerpts.some(c=>c.sourceId===sourceId));
 assert.equal((await f.request('/api/opportunities/'+op.id)).data.revision,op.revision);
 const storedSource=JSON.parse(f.app.db.prepare('SELECT data FROM documents WHERE id=?').get(doc.id).data);writeFileSync(join(storedSource.storageRoot,storedSource.relativePath),'Fictional revised evidence.');assert.equal((await f.request(route)).data.assessments[0].stale,true);
 const invalid=await f.request(route,{method:'POST',body:{...body,documentIds:['unselected']}});assert.equal(invalid.status,400);
 output={...output,changes:[buddyChange()]};assert.equal((await f.request(route,{method:'POST',body})).status,502);
 await f.request('/api/buddy/fit-criteria',{method:'PATCH',body:{...saved.data,items:[{...criteria.items[0],description:'Remote role'}]}});
 await f.restart();await f.login();const old=(await f.request(route)).data.assessments[0];assert.equal(old.stale,true);assert.equal(old.criteria.items[0].description,'London based role');
 const exported=await f.request('/api/export');assert.equal(exported.data.decisionAssessments.length,1);assert.equal(JSON.stringify(exported.data).includes('fictional-decision-private'),false);
 assert.equal((await f.request('/api/backup',{method:'POST',body:{}})).status,409);
 writeFileSync(join(storedSource.storageRoot,storedSource.relativePath),'Fictional career evidence.');
 const backup=await f.request('/api/backup',{method:'POST',body:{}});const db=new DatabaseSync(join(backup.data.location,'board.sqlite'),{readOnly:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM decision_assessments').get().n,1);db.close();
});

test('standalone Buddy coaches, builds reviewed STAR evidence, imports recruiter tasks and confirms scoped updates',async t=>{
 let output,context,system;
 const f=await fixture(t,{buddyFetch:async(_,opts)=>{const b=JSON.parse(opts.body);system=b.messages[0].content;context=JSON.parse(b.messages.at(-1).content);return buddyResponse(buddyReply(output));}});await f.setup();await enableBuddy(f);
 const route='/api/buddy/workspace';assert.equal((await f.request(route,{auth:false})).status,401);
 const envelope=(reply,changes=[])=>({reply:JSON.stringify({message:'Fictional career reply',opportunity:null,star:null,tasks:[],...reply}),changes});
 const send=(mode,extra={})=>f.request(route,{method:'POST',body:{mode,message:'Fictional career input',requestId:randomUUIDForTest(),documentIds:[],...extra}});
 function randomUUIDForTest(){return 'fictional-'+Math.random();}
 output=envelope({});assert.equal((await send('coach')).status,200);assert.match(system,/no flattery/);assert.equal(context.excerpts.length,0);
 const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;
 output=envelope({},[buddyChange()]);assert.equal((await send('coach')).status,502);assert.equal((await send('update')).status,502);
 output=envelope({star:{situation:'A fictional bug affected reports.',task:'Restore correct reports.',action:'I traced and fixed the parser.',result:'Reports matched the expected output.',cvBullet:'Fixed a reporting parser defect.',coverHighlight:'I diagnose and resolve reporting defects.'}});
 const star=await send('star');assert.equal(star.status,200);const starMessage=star.data.messages.at(-1);
 assert.equal((await f.request(route+'/'+starMessage.id+'/apply',{method:'POST',body:{confirm:false}})).status,400);
 assert.equal((await f.request(route+'/'+starMessage.id+'/apply',{method:'POST',body:{confirm:true}})).status,200);
 assert.equal((await f.request(route+'/'+starMessage.id+'/apply',{method:'POST',body:{confirm:true}})).status,200);
 assert.equal((await f.request('/api/documents')).data.documents.length,1);
 output=envelope({opportunity:{company:'Fictional recruiter employer',role:'Fictional analyst',description:'Pasted fictional recruiter notes.',location:'',salary:'',url:''},tasks:[{title:'Clarify salary',dueDate:'',notes:'Ask recruiter.'}]});
 const intake=await send('recruiter');assert.equal(intake.status,200);const proposed=intake.data.messages.at(-1);assert.equal((await f.request('/api/board')).data.opportunities.length,1);
 const created=await f.request(route+'/'+proposed.id+'/apply',{method:'POST',body:{confirm:true}});assert.equal(created.status,200);assert.equal((await f.request('/api/tasks')).data.tasks[0].opportunityId,created.data.result.opportunityId);
 output=envelope({},[buddyChange({kind:'update',field:'outcome',value:'rejected'})]);const update=await send('update',{targetId:op.id});assert.equal(update.status,200);const proposal=update.data.messages.at(-1);
 assert.equal((await f.request('/api/opportunities/'+op.id)).data.outcome,'');
 assert.equal((await f.request(route+'/'+proposal.id+'/apply',{method:'POST',body:{confirm:true}})).status,200);assert.equal((await f.request('/api/opportunities/'+op.id)).data.outcome,'rejected');
 const stale=await send('update',{targetId:op.id});const staleId=stale.data.messages.at(-1).id;
 const current=(await f.request('/api/opportunities/'+op.id)).data;await f.request('/api/opportunities/'+op.id,{method:'PATCH',body:{revision:current.revision,nextAction:'Changed manually'}});
 assert.equal((await f.request(route+'/'+staleId+'/apply',{method:'POST',body:{confirm:true}})).status,409);
 await f.restart();await f.login();assert.ok((await f.request(route)).data.messages.some(m=>m.id===starMessage.id&&m.appliedAt));assert.ok((await f.request('/api/export')).data.buddyWorkspace.length);
 const backup=await f.request('/api/backup',{method:'POST',body:{}});const db=new DatabaseSync(join(backup.data.location,'board.sqlite'),{readOnly:true});assert.ok(db.prepare('SELECT COUNT(*) n FROM standalone_messages').get().n);db.close();
});

test('automatic Buddy intent, uploaded sources, contact retention, master CV and history pagination',async t=>{
 let output,context;
 const f=await fixture(t,{buddyFetch:async(_,opts)=>{context=JSON.parse(JSON.parse(opts.body).messages.at(-1).content);return buddyResponse(buddyReply(output));}});await f.setup();await enableBuddy(f);
 const upload=await f.request('/api/buddy/attachments',{method:'POST',body:{name:'Fictional recruiter.txt',contentBase64:Buffer.from('Fictional recruiter Pat Example, pat@example.test, role Analyst at Fictional Co.').toString('base64')}});assert.equal(upload.status,200);assert.match(upload.data.preview,/Pat Example/);const id=upload.data.id;
 assert.equal((await f.request('/api/documents')).data.documents.length,0);
 const original=await f.request('/api/buddy/attachments/'+id+'/content',{binary:true});assert.match(original.data.toString(),/Pat Example/);
 const send=(requestId,message,extra={})=>f.request('/api/buddy/workspace',{method:'POST',body:{mode:'auto',requestId,message,documentIds:[],attachmentIds:[id],...extra}});
 output={reply:JSON.stringify({intent:'recruiter',message:'Review recruiter details.',opportunity:{company:'Fictional Co',role:'Analyst',contact:'Pat Example · pat@example.test',workMode:'Hybrid',jobReference:'FICTION-1',description:'Fictional intake',tags:['Data']},tasks:[],star:null})};
 const result=await send('auto-intake','Please read my recruiter note.');assert.equal(result.status,200);assert.ok(context.excerpts.some(c=>c.sourceId===id));const proposal=result.data.messages.at(-1);assert.equal(proposal.mode,'recruiter');
 const applied=await f.request('/api/buddy/workspace/'+proposal.id+'/apply',{method:'POST',body:{confirm:true}});assert.equal(applied.status,200);const op=(await f.request('/api/opportunities/'+applied.data.result.opportunityId)).data;assert.match(op.contact,/Pat Example/);assert.equal(op.workMode,'Hybrid');assert.equal(op.jobReference,'FICTION-1');assert.deepEqual(op.tags,['Data']);assert.match(op.description,/Original recruiter intake/);
 output={reply:JSON.stringify({intent:'cv',message:'Review this factual fictional draft.',opportunity:null,tasks:[],star:null}),draft:{kind:'cv',title:'Fictional Master CV',content:'# Fictional Candidate\n\nFictional reporting experience.'}};
 const cv=await send('master-cv','Make a master CV from the supplied fictional material.');assert.equal(cv.status,200);const cvId=cv.data.messages.at(-1).id;
 await Promise.all([f.request('/api/buddy/workspace/'+cvId+'/apply',{method:'POST',body:{confirm:true}}),f.request('/api/buddy/workspace/'+cvId+'/apply',{method:'POST',body:{confirm:true}})]);assert.equal((await f.request('/api/documents')).data.documents.length,1);
 const evidence=(await f.request('/api/documents',{method:'POST',body:{name:'Fictional governance.txt',kind:'reference',contentBase64:Buffer.from('Fictional evidence: led governance workshops.').toString('base64')}})).data;
 output={reply:JSON.stringify({intent:'coach',message:'Grounded fictional coaching.',opportunity:null,tasks:[],star:null})};
 const automatic=await send('automatic-evidence','What governance strengths do I have?',{useLibrary:true,attachmentIds:[],templateId:evidence.id});assert.equal(automatic.status,200);assert.ok(context.excerpts.some(c=>c.sourceId===evidence.id));assert.equal(context.templateId,evidence.id);
 output={reply:'not-json'};assert.equal((await send('failed-chat','Fictional failed message')).status,502);
 const history=await f.request('/api/buddy/workspace');assert.ok(history.data.messages.some(m=>m.role==='user'&&m.status==='failed'));assert.ok(history.data.messages.some(m=>m.mode==='cv'));assert.ok(history.data.messages.some(m=>m.mode==='recruiter'));
 const cursor=history.data.messages[2].cursor;assert.ok((await f.request('/api/buddy/workspace?before='+cursor)).data.messages.every(m=>m.cursor<cursor));
 await f.restart();await f.login();assert.ok((await f.request('/api/buddy/workspace')).data.messages.some(m=>m.status==='failed'));
 const backup=await f.request('/api/backup',{method:'POST',body:{}});const db=new DatabaseSync(join(backup.data.location,'board.sqlite'),{readOnly:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM standalone_attachment_originals').get().n,1);db.close();
 await f.request('/api/buddy/attachments/'+id,{method:'DELETE'});assert.equal((await f.request('/api/buddy/attachments/'+id+'/content')).status,404);
});

test('new opportunities get automatic tags and saved-criteria assessments without changing outcomes',async t=>{
 const f=await fixture(t,{automationEnabled:true,buddyFetch:async(_,opts)=>{
 const b=JSON.parse(opts.body),system=b.messages[0].content,context=JSON.parse(b.messages.at(-1).content);
 return buddyResponse(buddyReply({reply:JSON.stringify(system.includes('at most ten short factual')?{tags:['Engineering']}:{recommendation:'insufficient-information',summary:'Salary needs clarification.',criteria:[{id:'pay',status:'unknown',reason:'No salary supplied.',sourceIds:[],questions:['What is the base salary?']}]})}));
 }});await f.setup();await enableBuddy(f);await f.request('/api/buddy/fit-criteria',{method:'PATCH',body:{revision:1,items:[{id:'pay',description:'GBP 80,000 base minimum',priority:'required'}]}});
 const op=(await f.request('/api/opportunities',{method:'POST',body:{...opportunity,tags:['User tag']}})).data;
 let state;for(let i=0;i<100;i++){state=(await f.request('/api/buddy/automation/'+op.id)).data.automation;if(state&&state.state!=='queued'&&state.state!=='running')break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(state.tags,'completed');assert.equal(state.fit,'completed');const current=(await f.request('/api/opportunities/'+op.id)).data;assert.ok(current.tags.includes('User tag'));assert.ok(current.tags.includes('Engineering'));assert.equal(current.outcome,'');
 const review=(await f.request('/api/buddy/decisions/'+op.id)).data.assessments[0];assert.equal(review.stale,false);assert.equal(review.modelSource,'careerBuddy');assert.equal(review.results[0].status,'unknown');
});

test('saved Buddy conversations list legacy history and isolate model context and pagination',async t=>{
 let context;
 const f=await fixture(t,{buddyFetch:async(_,opts)=>{context=JSON.parse(JSON.parse(opts.body).messages.at(-1).content);return buddyResponse(buddyReply({reply:JSON.stringify({intent:'coach',message:'Fictional reply',opportunity:null,tasks:[],star:null})}));}});await f.setup();await enableBuddy(f);
 async function send(conversationId,message,requestId){return f.request('/api/buddy/workspace',{method:'POST',body:{mode:'auto',conversationId,message,requestId,documentIds:[]}});}
 await send(undefined,'Fictional older history','legacy-turn');
 await send('conversation-a','Fictional first project','same-id');
 assert.equal(context.history.length,0);
 await send('conversation-b','Fictional unrelated recruiter call','same-id');assert.equal(context.history.length,0);
 await send('conversation-a','Continue the first project','another-turn');assert.ok(context.history.some(m=>m.content==='Fictional first project'));assert.equal(JSON.stringify(context.history).includes('unrelated recruiter'),false);assert.equal(JSON.stringify(context.history).includes('older history'),false);
 const a=await f.request('/api/buddy/workspace?conversationId=conversation-a');assert.equal(a.data.messages.length,4);assert.equal(a.data.conversations.length,3);assert.ok(a.data.conversations.some(c=>c.id==='legacy'&&c.title==='Earlier chat history'));assert.ok(a.data.messages.every(m=>m.conversationId==='conversation-a'));
 const cursor=a.data.messages[2].cursor;const older=await f.request('/api/buddy/workspace?conversationId=conversation-a&before='+cursor);assert.equal(older.data.messages.length,2);
 const empty=await f.request('/api/buddy/workspace?conversationId=empty-new-chat');assert.equal(empty.data.messages.length,0);assert.equal(empty.data.conversations.length,3);
 assert.equal((await f.request('/api/buddy/workspace?conversationId=bad%2Fpath')).status,400);
 await f.restart();await f.login();assert.equal((await f.request('/api/buddy/workspace?conversationId=conversation-b')).data.messages.length,2);
});

test('Buddy request status exposes stages and cancellation aborts transport without saving proposals',async t=>{
 let entered;const started=new Promise(r=>entered=r);let aborted=false,slow=true;
 const f=await fixture(t,{buddyFetch:async(_,opts)=>{if(!slow)return buddyResponse(buddyReply({reply:JSON.stringify({intent:'coach',message:'Fictional retry reply.',opportunity:null,tasks:[],star:null})}));entered();return new Promise((resolve,reject)=>{opts.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true});});}});await f.setup();await enableBuddy(f);
 const body={mode:'auto',message:'Fictional slow request',requestId:'cancel-test',conversationId:'cancellable-chat',documentIds:[]};
 const pending=f.request('/api/buddy/workspace',{method:'POST',body});await started;
 const status=await f.request('/api/buddy/requests/cancel-test');assert.equal(status.data.request.stage,'waiting-provider');assert.equal(status.data.request.timeoutSeconds,120);assert.equal(status.data.request.provider,'custom');assert.equal(JSON.stringify(status.data).includes('private-buddy-test-key'),false);
 assert.equal((await f.request('/api/buddy/requests/cancel-test',{auth:false})).status,401);
 await f.request('/api/buddy/requests/cancel-test',{method:'POST',body:{cancel:true}});assert.equal((await pending).status,499);assert.equal(aborted,true);assert.equal((await f.request('/api/buddy/requests/cancel-test')).data.request.stage,'cancelled');
 const history=(await f.request('/api/buddy/workspace?conversationId=cancellable-chat')).data.messages;assert.equal(history.length,1);assert.equal(history[0].status,'cancelled');assert.equal((await f.request('/api/board')).data.opportunities.length,0);
 slow=false;assert.equal((await f.request('/api/buddy/workspace',{method:'POST',body})).status,200);assert.equal((await f.request('/api/buddy/requests/cancel-test')).data.request.stage,'completed');
 await f.restart();await f.login();assert.equal((await f.request('/api/buddy/requests/cancel-test')).data.request.stage,'completed');
});

test('independent directory sources browse safely, stay in place, persist and clear caches when deselected',async t=>{
 const f=await fixture(t);await f.setup();const source=join(f.root,'fictional-career-source');mkdirSync(source);mkdirSync(join(source,'projects'));writeFileSync(join(source,'projects','achievement.txt'),'Fictional achievement evidence.');writeFileSync(join(source,'.private.txt'),'Hidden fictional text.');symlinkSync(join(f.root,'state'),join(source,'outside-link'));
 const route='/api/connections/directories';assert.equal((await f.request(route,{auth:false})).status,401);
 const added=await f.request(route,{method:'POST',body:{revision:1,hostPath:source,name:'Fictional archive'}});assert.equal(added.status,200);const root=added.data.roots[0];assert.equal(root.state,'connected');
 const browse=await f.request(route+'/'+root.id+'/browse');assert.deepEqual(browse.data.entries.map(e=>e.name),['projects']);assert.equal((await f.request(route+'/'+root.id+'/browse?path=..')).status,400);
 const chosen=await f.request(route+'/'+root.id+'/selection',{method:'POST',body:{revision:added.data.revision,paths:['projects/achievement.txt']}});assert.equal(chosen.status,200);
 const vectorStatus=(await f.request('/api/buddy/vector-index')).data;const document=vectorStatus.sources.find(s=>s.name.includes('achievement.txt'));assert.ok(document);assert.equal(document.readOnly,true);
 const prepared=await f.request('/api/buddy/index',{method:'POST',body:{documentIds:[document.id]}});assert.equal(prepared.status,200);assert.match(JSON.parse(f.app.db.prepare('SELECT data FROM document_text WHERE id=?').get(document.id).data).text,/Fictional achievement/);assert.equal(readFileSync(join(source,'projects','achievement.txt'),'utf8'),'Fictional achievement evidence.');
 await f.restart();await f.login();assert.equal((await f.request(route)).data.roots[0].selectedCount,1);
 const current=(await f.request(route)).data;assert.equal((await f.request(route+'/'+root.id+'/selection',{method:'POST',body:{revision:current.revision,paths:[]}})).status,200);assert.equal(f.app.db.prepare('SELECT data FROM document_text WHERE id=?').get(document.id),undefined);
 const next=(await f.request(route)).data;assert.equal((await f.request(route+'/'+root.id,{method:'DELETE',body:{revision:next.revision}})).status,200);assert.equal(existsSync(join(source,'projects','achievement.txt')),true);
});

test('Google Docs configuration, session-bound OAuth, refresh, search and snapshot import are private and read-only',async t=>{
 const requests=[];let refreshes=0;const f=await fixture(t,{googleFetch:async(url,options)=>{requests.push({url:String(url),options});if(String(url).endsWith('/token')){const b=new URLSearchParams(options.body);if(b.get('grant_type')==='refresh_token'){refreshes++;return Response.json({access_token:'fictional-access-new',expires_in:3600});}return Response.json({access_token:'fictional-access',refresh_token:'fictional-refresh-secret',expires_in:1,scope:'https://www.googleapis.com/auth/drive.readonly'});}if(String(url).endsWith('/revoke'))return new Response('');if(String(url).includes('/export?'))return new Response(Buffer.from('fictional docx bytes'));if(String(url).includes('/files/fictionalDoc?'))return Response.json({id:'fictionalDoc',name:'Fictional master CV',mimeType:'application/vnd.google-apps.document',modifiedTime:'2026-10-28T10:00:00Z',version:'1'});return Response.json({files:[{id:'fictionalDoc',name:'Fictional master CV',modifiedTime:'2026-10-28T10:00:00Z'}]});}});await f.setup();const route='/api/connections/google';assert.equal((await f.request(route,{auth:false})).status,401);
 const c=await f.request(route,{method:'PATCH',body:{revision:1,clientId:'fictional.apps.googleusercontent.com',clientSecret:'fictional-google-client-secret',redirectUri:f.base+route+'/callback'}});assert.equal(c.status,200);assert.equal(c.data.hasSecret,true);assert.equal(c.data.clientSecret,undefined);
 const started=await f.request(route+'/start',{method:'POST',body:{}});const auth=new URL(started.data.url);assert.equal(auth.hostname,'accounts.google.com');assert.equal(auth.searchParams.get('scope'),'https://www.googleapis.com/auth/drive.readonly');assert.ok(auth.searchParams.get('code_challenge'));const state=auth.searchParams.get('state');
 assert.equal((await f.request(route+'/callback?state=wrong&code=bad',{auth:false})).status,400);
 const callback=await fetch(f.base+route+'/callback?'+new URLSearchParams({state,code:'fictional-code'}),{redirect:'manual'});assert.equal(callback.status,303);assert.equal(callback.headers.get('location').includes('fictional-code'),false);
 const other=await f.request('/api/login',{method:'POST',auth:false,body:{password:'correct horse battery staple'}});assert.equal((await f.request(route+'/finish',{method:'POST',headers:{Cookie:other.response.headers.get('set-cookie').split(';')[0]},body:{state}})).status,400);
 const finished=await f.request(route+'/finish',{method:'POST',body:{state}});assert.equal(finished.status,200);assert.equal(finished.data.connected,true);assert.equal((await f.request(route+'/finish',{method:'POST',body:{state}})).status,400);
 const search=await f.request(route+'/search',{method:'POST',body:{query:"Candidate's CV"}});assert.equal(search.status,200);assert.equal(search.data.files[0].name,'Fictional master CV');assert.equal(refreshes,1);
 const imported=await f.request(route+'/import',{method:'POST',body:{id:'fictionalDoc',kind:'cv'}});assert.equal(imported.status,200);assert.equal(imported.data.unchanged,false);assert.equal(imported.data.document.externalSource.provider,'google-docs');assert.equal(imported.data.document.name,'Fictional master CV.docx');
 const duplicate=await f.request(route+'/import',{method:'POST',body:{id:'fictionalDoc',kind:'cv'}});assert.equal(duplicate.data.unchanged,true);assert.equal((await f.request('/api/documents')).data.documents.length,1);assert.equal(requests.filter(r=>r.url.includes('/export?')).length,1);
 assert.ok(requests.filter(r=>r.url.includes('/drive/v3/')).every(r=>!r.options.method||r.options.method==='GET'));
 const exported=JSON.stringify((await f.request('/api/export')).data);assert.equal(exported.includes('fictional-google-client-secret'),false);assert.equal(exported.includes('fictional-refresh-secret'),false);
 await f.restart();await f.login();assert.equal((await f.request(route)).data.connected,true);
 assert.equal((await f.request(route+'/import',{method:'POST',body:{id:'../escape',kind:'cv'}})).status,400);
 const disconnected=await f.request(route+'/disconnect',{method:'POST',body:{}});assert.equal(disconnected.data.connected,false);assert.equal(disconnected.data.revoked,true);assert.equal((await f.request('/api/documents')).data.documents.length,1);
});

test('opportunity chat cancellation rejects late responses, persists diagnostics and allows a retry',async t=>{
 let release,started;const ready=new Promise(r=>started=r);let delayed=true;
 const f=await fixture(t,{buddyFetch:async()=>{if(delayed){started();await new Promise(r=>release=r);}return buddyResponse(buddyReply());}});await f.setup();await enableBuddy(f);
 const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;
 const base='/api/opportunities/'+op.id+'/buddy';const body={message:'Fictional advice',action:'chat',requestId:'cancel-opportunity',documentIds:[],includeOtherOpportunities:false};
 const pending=f.request(base+'/chat',{method:'POST',body});await ready;
 const before=await f.request('/api/buddy/requests/'+body.requestId);assert.equal(before.status,200);assert.equal(before.data.request.conversationId,'opportunity:'+op.id);
 assert.equal((await f.request('/api/buddy/requests/'+body.requestId,{method:'POST',body:{cancel:true}})).status,200);release();assert.equal((await pending).status,499);
 assert.equal((await f.request(base)).data.messages.length,0);assert.equal((await f.request('/api/buddy/requests/'+body.requestId)).data.request.stage,'cancelled');
 delayed=false;assert.equal((await f.request(base+'/chat',{method:'POST',body})).status,200);
 await f.restart();await f.login();assert.equal((await f.request('/api/buddy/requests/'+body.requestId)).data.request.stage,'completed');assert.equal((await f.request('/api/buddy/requests?scope='+encodeURIComponent('opportunity:'+op.id))).data.request.id,body.requestId);
});

test('manual decision cancellation prevents saving an assessment',async t=>{
 let release,started;const ready=new Promise(r=>started=r);
 const f=await fixture(t,{buddyFetch:async()=>{started();await new Promise(r=>release=r);return buddyResponse(buddyReply());}});await f.setup();
 await f.request('/api/buddy/decision-settings',{method:'PATCH',body:{revision:1,enabled:true,provider:'custom',baseUrl:'https://fictional.example/v1',model:'fictional',apiKey:'fictional-key'}});
 await f.request('/api/buddy/fit-criteria',{method:'PATCH',body:{revision:1,items:[{id:'pay',description:'Fictional salary criterion',priority:'required'}]}});
 const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;
 const base='/api/buddy/decisions/'+op.id;const pending=f.request(base,{method:'POST',body:{requestId:'cancel-decision',revision:op.revision,criteriaRevision:2,documentIds:[]}});await ready;
 await f.request('/api/buddy/requests/cancel-decision',{method:'POST',body:{cancel:true}});release();assert.equal((await pending).status,499);assert.equal((await f.request(base)).data.assessments.length,0);
});

test('automatic review cancellation stops a running provider and does not save late tags or fit',async t=>{
 let release,started;const ready=new Promise(r=>started=r);
 const f=await fixture(t,{automationEnabled:true,buddyFetch:async()=>{started();await new Promise(r=>release=r);return buddyResponse(buddyReply({reply:JSON.stringify({tags:['Late tag']})}));}});await f.setup();await enableBuddy(f);
 const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;await ready;
 const queued=(await f.request('/api/opportunities',{method:'POST',body:{...opportunity,company:'Fictional queued employer'}})).data;const queuedRoute='/api/buddy/automation/'+queued.id;await f.request(queuedRoute,{method:'POST',body:{cancel:true}});assert.equal((await f.request(queuedRoute)).data.automation.state,'cancelled');
 const route='/api/buddy/automation/'+op.id;await f.request(route,{method:'POST',body:{cancel:true}});release();let job;
 for(let i=0;i<100;i++){job=(await f.request(route)).data.automation;if(job.state==='cancelled')break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(job.state,'cancelled');assert.equal((await f.request('/api/opportunities/'+op.id)).data.tags.includes('Late tag'),false);
 assert.equal((await f.request('/api/buddy/requests/'+job.requestId)).data.request.stage,'cancelled');
});

test('automatic fit cancellation preserves completed tags but saves no late assessment',async t=>{
 let release,started,calls=0;const ready=new Promise(r=>started=r);
 const f=await fixture(t,{automationEnabled:true,buddyFetch:async()=>{calls++;if(calls===1)return buddyResponse(buddyReply({reply:JSON.stringify({tags:['Fictional completed tag']})}));started();await new Promise(r=>release=r);return buddyResponse(buddyReply());}});await f.setup();await enableBuddy(f);
 await f.request('/api/buddy/fit-criteria',{method:'PATCH',body:{revision:1,items:[{id:'pay',description:'Fictional salary criterion',priority:'required'}]}});
 const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;await ready;
 const route='/api/buddy/automation/'+op.id;await f.request(route,{method:'POST',body:{cancel:true}});release();let job;
 for(let i=0;i<100;i++){job=(await f.request(route)).data.automation;if(job.state==='cancelled')break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(job.state,'cancelled');assert.equal(job.tags,'completed');assert.equal(job.fit,'cancelled');assert.equal((await f.request('/api/opportunities/'+op.id)).data.tags.includes('Fictional completed tag'),true);assert.equal((await f.request('/api/buddy/decisions/'+op.id)).data.assessments.length,0);
});

test('document studio protects previews, records page-target warnings and saves new drafts idempotently',async t=>{
 const f=await fixture(t,{documentConvert:async(bytes,folder)=>{writeFileSync(join(folder,'page-1.png'),Buffer.from('fictional-page'));return {pages:1,pdf:Buffer.from('%PDF-fictional')};}});await f.setup();
 const {layoutDraft}=await import('../server/document-layout.mjs');const bytes=await layoutDraft('Fictional CV','# Fictional Candidate\n\n## Experience\n- Fictional verified achievement.','classic');
 const source=(await f.request('/api/documents',{method:'POST',body:{name:'Fictional CV.docx',kind:'cv',status:'submitted',contentBase64:bytes.toString('base64')}})).data;
 assert.equal((await f.request('/api/document-studio',{auth:false})).status,401);assert.ok((await f.request('/api/document-studio')).data.documents.some(d=>d.id===source.id));
 const rendered=await f.request('/api/document-studio/preview',{method:'POST',body:{documentId:source.id,revision:source.revision,layout:'compact',pageTarget:2,content:'# Fictional Candidate\n\nFictional experience.'}});assert.equal(rendered.status,200);assert.equal(rendered.data.pages,1);
 assert.equal((await f.request(rendered.data.images[0],{auth:false})).status,401);assert.equal((await f.request(rendered.data.images[0],{binary:true})).data.toString(),'fictional-page');
 const save='/api/document-studio/'+rendered.data.id+'/save';assert.equal((await f.request(save,{method:'POST',body:{format:'pdf'}})).status,400);
 const saved=await f.request(save,{method:'POST',body:{confirm:true,format:'pdf'}});assert.equal(saved.status,200);assert.equal(saved.data.document.status,'draft');assert.notEqual(saved.data.document.id,source.id);assert.equal((await f.request(save,{method:'POST',body:{confirm:true,format:'pdf'}})).data.document.id,saved.data.document.id);
 assert.deepEqual((await f.request('/api/documents/'+source.id+'/content',{binary:true})).data,bytes);
 await f.request('/api/document-studio/'+rendered.data.id,{method:'DELETE'});assert.equal((await f.request(rendered.data.pdfUrl)).status,404);
});

test('document studio detects source changes before save and reports renderer failures without creating files',async t=>{
 const {layoutDraft}=await import('../server/document-layout.mjs');const bytes=await layoutDraft('Fictional CV','Fictional text','classic');let failed=false;
 const f=await fixture(t,{documentConvert:async()=>{if(failed)throw Object.assign(new Error('Fictional rendering failure'),{status:502});return {pages:3,pdf:Buffer.from('%PDF-fictional')};}});await f.setup();
 const source=(await f.request('/api/documents',{method:'POST',body:{name:'Fictional CV.docx',kind:'cv',status:'draft',contentBase64:bytes.toString('base64')}})).data;
 const body={documentId:source.id,revision:source.revision,layout:'original',pageTarget:2};const p=(await f.request('/api/document-studio/preview',{method:'POST',body})).data;assert.equal(p.overTarget,true);
 await f.request('/api/documents/'+source.id,{method:'PATCH',body:{revision:source.revision,notes:'Fictional changed note'}});assert.equal((await f.request('/api/document-studio/'+p.id+'/save',{method:'POST',body:{confirm:true,format:'docx'}})).status,409);
 failed=true;assert.equal((await f.request('/api/document-studio/preview',{method:'POST',body:{...body,revision:source.revision+1}})).status,502);assert.equal((await f.request('/api/documents')).data.documents.length,1);
});

test('document categories persist independently of kind, file bytes and submitted status',async t=>{
 const f=await fixture(t);await f.setup();const bytes=Buffer.from('Fictional career evidence.');
 const source=(await f.request('/api/documents',{method:'POST',body:{name:'Fictional master.txt',kind:'cv',status:'submitted',category:'master-cv',contentBase64:bytes.toString('base64')}})).data;assert.equal(source.category,'master-cv');
 const updated=await f.request('/api/documents/'+source.id,{method:'PATCH',body:{revision:source.revision,category:'template'}});assert.equal(updated.status,200);assert.equal(updated.data.kind,'cv');assert.equal(updated.data.status,'submitted');assert.equal(updated.data.category,'template');
 assert.deepEqual((await f.request('/api/documents/'+source.id+'/content',{binary:true})).data,bytes);
 assert.equal((await f.request('/api/documents/'+source.id,{method:'PATCH',body:{revision:source.revision,category:'star-story'}})).status,409);
 assert.equal((await f.request('/api/documents/'+source.id,{method:'PATCH',body:{revision:updated.data.revision,category:'invented-category'}})).status,400);
 await f.restart();await f.login();assert.equal((await f.request('/api/documents')).data.documents.find(d=>d.id===source.id).category,'template');
});

test('bulk categorisation validates all revisions before updating any document',async t=>{
 const f=await fixture(t);await f.setup();const docs=[];
 for(const name of ['A','B'])docs.push((await f.request('/api/documents',{method:'POST',body:{name:'Fictional '+name+'.txt',kind:'reference',status:'draft',contentBase64:Buffer.from('Fictional story').toString('base64')}})).data);
 const route='/api/documents/categories';const entries=docs.map(d=>({id:d.id,revision:d.revision}));assert.equal((await f.request(route,{method:'POST',auth:false,body:{category:'star-story',documents:entries}})).status,401);
 assert.equal((await f.request(route,{method:'POST',body:{category:'star-story',documents:[entries[0],{...entries[1],revision:99}]}})).status,409);
 assert.ok((await f.request('/api/documents')).data.documents.every(d=>d.category==='reference'));
 const saved=await f.request(route,{method:'POST',body:{category:'star-story',documents:entries}});assert.equal(saved.status,200);assert.ok(saved.data.documents.every(d=>d.category==='star-story'));
 assert.equal((await f.request(route,{method:'POST',body:{category:'star-story',documents:[entries[0],entries[0]]}})).status,400);
});

test('legacy CV categories are derived without rewriting stored rows',async t=>{
 const f=await fixture(t);await f.setup();const docs=[];for(const kind of ['cv','reference'])docs.push((await f.request('/api/documents',{method:'POST',body:{name:'Fictional '+kind+'.txt',kind,status:'draft',contentBase64:Buffer.from('Fictional evidence').toString('base64')}})).data);
 for(const doc of docs){const raw=JSON.parse(f.app.db.prepare('SELECT data FROM documents WHERE id=?').get(doc.id).data);delete raw.category;if(raw.kind==='cv')raw.generation={master:true};f.app.db.prepare('UPDATE documents SET data=? WHERE id=?').run(JSON.stringify(raw),doc.id);}
 const before=f.app.db.prepare('SELECT data FROM documents ORDER BY id').all();const list=(await f.request('/api/documents')).data.documents;assert.equal(list.find(d=>d.kind==='cv').category,'master-cv');assert.equal(list.find(d=>d.kind==='reference').category,'reference');assert.deepEqual(f.app.db.prepare('SELECT data FROM documents ORDER BY id').all(),before);
});

test('templates stay selectable explicitly but are excluded from automatic Buddy evidence',async t=>{
 let context;const f=await fixture(t,{buddyFetch:async(_,opts)=>{context=JSON.parse(JSON.parse(opts.body).messages.at(-1).content);return buddyResponse(buddyReply({reply:JSON.stringify({intent:'coach',message:'Fictional coaching',opportunity:null,tasks:[],star:null})}));}});await f.setup();await enableBuddy(f);
 const template=(await f.request('/api/documents',{method:'POST',body:{name:'Fictional template.txt',kind:'reference',category:'template',status:'approved',contentBase64:Buffer.from('Fictional data engineering template placeholder').toString('base64')}})).data;
 const state=(await f.request('/api/buddy/workspace')).data;assert.equal(state.documents.find(d=>d.id===template.id).category,'template');
 const send=(id,extra={})=>f.request('/api/buddy/workspace',{method:'POST',body:{mode:'auto',message:'Help with data engineering skills',requestId:id,documentIds:[],useLibrary:true,...extra}});
 assert.equal((await send('template-auto')).status,200);assert.ok(!context.excerpts.some(e=>e.sourceId===template.id));
 assert.equal((await send('template-explicit',{templateId:template.id})).status,200);assert.ok(context.excerpts.some(e=>e.sourceId===template.id));
});

test('application packs pin reviewed versions, freeze submission details and export exact bytes',async t=>{
 const f=await fixture(t);await f.setup();const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;
 const bytes=Buffer.from('Fictional CV version one.');const doc=(await f.request('/api/documents',{method:'POST',body:{name:'Fictional CV.txt',kind:'cv',status:'draft',opportunityId:op.id,contentBase64:bytes.toString('base64')}})).data;
 const base='/api/opportunities/'+op.id+'/packs';assert.equal((await f.request(base,{auth:false})).status,401);
 let r=await f.request(base,{method:'POST',body:{revision:op.revision,title:'Fictional pack',documentIds:[doc.id],coverLetterNotRequired:true,supportingStatement:'Verified fictional supporting text.',answers:[{question:'Why this role?',answer:'Fictional supported answer.'}]}});assert.equal(r.status,201);const id=r.data.pack.id;
 r=await f.request(base+'/'+id+'/approve',{method:'POST',body:{revision:r.data.opportunity.revision,confirm:true}});assert.equal(r.status,200);assert.equal(r.data.pack.state,'approved');
 const revision=r.data.opportunity.revision;const submit={revision,confirm:true,submittedAt:'2026-10-29T10:00:00.000Z',applicationRoute:'Fictional portal',receipt:'FICTIONAL-123',advanceStage:true};
 r=await f.request(base+'/'+id+'/submit',{method:'POST',body:submit});assert.equal(r.status,200);assert.equal(r.data.opportunity.stage,'submitted');assert.equal(r.data.pack.submission.receipt,'FICTIONAL-123');assert.equal(r.data.opportunity.events.find(e=>e.applicationPackId===id).id,r.data.pack.submission.eventId);
 const count=r.data.opportunity.events.length;assert.equal((await f.request(base+'/'+id+'/submit',{method:'POST',body:submit})).data.opportunity.events.length,count);
 assert.equal((await f.request('/api/documents/'+doc.id,{method:'DELETE'})).status,409);assert.deepEqual((await f.request('/api/documents/'+doc.id+'/content',{binary:true})).data,bytes);
 assert.equal((await f.request(base+'/'+id,{method:'PATCH',body:{revision:r.data.opportunity.revision,title:'Overwrite'}})).status,409);
 const zipResult=await f.request(base+'/'+id+'/download',{binary:true});assert.equal(zipResult.status,200);const {default:JSZip}=await import('jszip');const zip=await JSZip.loadAsync(zipResult.data);const manifest=JSON.parse(await zip.file('manifest.json').async('string'));assert.deepEqual(await zip.file(manifest.documents[0].archivePath).async('nodebuffer'),bytes);assert.match(await zip.file('application-answers.txt').async('string'),/Fictional supported answer/);
 await f.restart();await f.login();const list=(await f.request(base)).data;assert.equal(list.packs[0].state,'submitted');assert.equal(list.packs[0].submission.applicationRoute,'Fictional portal');assert.match(JSON.stringify((await f.request('/api/export')).data),/FICTIONAL-123/);
 const copy=await f.request(base+'/'+id+'/copy',{method:'POST',body:{revision:list.opportunityRevision}});assert.equal(copy.status,201);assert.equal(copy.data.pack.state,'draft');assert.notEqual(copy.data.pack.id,id);assert.equal(copy.data.pack.submission,undefined);
});

test('pack approval rejects absent cover letters, stale documents and out-of-scope selections without partial changes',async t=>{
 const f=await fixture(t);await f.setup();const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;const other=(await f.request('/api/opportunities',{method:'POST',body:{...opportunity,company:'Other fictional employer'}})).data;
 const createDoc=async(id,name)=>(await f.request('/api/documents',{method:'POST',body:{opportunityId:id,name,kind:'cv',status:'draft',contentBase64:Buffer.from('Fictional bytes').toString('base64')}})).data;
 const doc=await createDoc(op.id,'CV.txt'),wrong=await createDoc(other.id,'Other CV.txt');const base='/api/opportunities/'+op.id+'/packs';const body={revision:op.revision,title:'Fictional pack',documentIds:[doc.id],coverLetterNotRequired:false,answers:[]};
 assert.equal((await f.request(base,{method:'POST',body:{...body,documentIds:[wrong.id]}})).status,400);
 let r=await f.request(base,{method:'POST',body});const id=r.data.pack.id;assert.equal((await f.request(base+'/'+id+'/approve',{method:'POST',body:{revision:r.data.opportunity.revision,confirm:true}})).status,400);
 r=await f.request(base+'/'+id,{method:'PATCH',body:{...body,revision:r.data.opportunity.revision,coverLetterNotRequired:true}});await f.request('/api/documents/'+doc.id,{method:'PATCH',body:{revision:doc.revision,notes:'Fictional changed review note'}});
 assert.equal((await f.request(base+'/'+id+'/approve',{method:'POST',body:{revision:r.data.opportunity.revision,confirm:true}})).status,409);assert.equal((await f.request('/api/documents')).data.documents.find(d=>d.id===doc.id).status,'draft');
 assert.equal((await f.request(base,{method:'POST',body})).status,409);
});

test('pack submission is atomic when a reviewed file becomes unavailable',async t=>{
 const f=await fixture(t);await f.setup();const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;const docs=[];
 for(const name of ['First','Second'])docs.push((await f.request('/api/documents',{method:'POST',body:{name:name+'.txt',kind:'cv',status:'draft',opportunityId:op.id,contentBase64:Buffer.from('Fictional '+name).toString('base64')}})).data);
 const base='/api/opportunities/'+op.id+'/packs';let r=await f.request(base,{method:'POST',body:{revision:op.revision,title:'Fictional pack',documentIds:docs.map(d=>d.id),coverLetterNotRequired:true}});const id=r.data.pack.id;r=await f.request(base+'/'+id+'/approve',{method:'POST',body:{revision:r.data.opportunity.revision,confirm:true}});
 const raw=JSON.parse(f.app.db.prepare('SELECT data FROM documents WHERE id=?').get(docs[1].id).data);writeFileSync(join(raw.storageRoot,raw.relativePath),'Fictional external edit');
 const result=await f.request(base+'/'+id+'/submit',{method:'POST',body:{revision:r.data.opportunity.revision,confirm:true,submittedAt:'2026-10-29T10:00:00.000Z',advanceStage:true}});assert.equal(result.status,409);assert.equal((await f.request('/api/documents')).data.documents.find(d=>d.id===docs[0].id).status,'approved');const current=(await f.request('/api/opportunities/'+op.id)).data;assert.equal(current.stage,'identification');assert.equal(current.applicationPacks[0].state,'approved');assert.equal(current.events.some(e=>e.applicationPackId===id),false);
});

test('feedback is private, idempotent, persistent and included in exports/backups',async t=>{
 const f=await fixture(t);await f.setup();const body={text:'Fictional dashboard suggestion.',page:'dashboard',requestId:'fictional-feedback'};
 assert.equal((await f.request('/api/feedback',{auth:false})).status,401);const first=await f.request('/api/feedback',{method:'POST',body});assert.equal(first.status,201);assert.equal(first.data.item.reviewStatus,'not-reviewed');assert.equal((await f.request('/api/feedback',{method:'POST',body})).data.item.id,first.data.item.id);
 assert.equal((await f.request('/api/feedback',{method:'POST',body:{...body,text:'Different fictional text'}})).status,409);assert.equal((await f.request('/api/feedback',{method:'POST',body:{...body,page:'https://private.example/?token=secret'}})).status,400);
 const url='/api/feedback/'+first.data.item.id;const updated=await f.request(url,{method:'PATCH',body:{revision:1,status:'planned'}});assert.equal(updated.status,200);assert.equal((await f.request(url,{method:'PATCH',body:{revision:1,status:'done'}})).status,409);
 assert.match(JSON.stringify((await f.request('/api/export')).data.feedback),/Fictional dashboard/);assert.match(JSON.stringify((await f.request('/api/feedback/export')).data),/Fictional dashboard/);
 const backup=await f.request('/api/backup',{method:'POST',body:{}});assert.equal(backup.status,200);const snapshot=new DatabaseSync(join(f.options.filesDir,'backups',backup.data.name,'board.sqlite'));assert.match(snapshot.prepare("SELECT data FROM config WHERE key='feedbackInbox'").get().data,/Fictional dashboard/);snapshot.close();
 const interrupted=JSON.parse(f.app.db.prepare("SELECT data FROM config WHERE key='feedbackInbox'").get().data);interrupted.items[0].reviewStatus='running';f.app.db.prepare("UPDATE config SET data=? WHERE key='feedbackInbox'").run(JSON.stringify(interrupted));
 await f.restart();await f.login();assert.equal((await f.request('/api/feedback')).data.items[0].status,'planned');assert.equal((await f.request('/api/feedback')).data.items[0].reviewStatus,'interrupted');
});

test('feedback AI review receives only submitted feedback/page and cannot apply changes',async t=>{
 let supplied;const f=await fixture(t,{buddyFetch:async(_,opts)=>{supplied=JSON.parse(JSON.parse(opts.body).messages.at(-1).content);return buddyResponse(buddyReply({reply:JSON.stringify({summary:'Fictional filter improvement',priority:'medium',improvements:['Add a visible filter.'],questions:['Which view?']})}));}});await f.setup();await enableBuddy(f);await f.request('/api/opportunities',{method:'POST',body:{...opportunity,description:'Private career text must not be sent.'}});
 const item=(await f.request('/api/feedback',{method:'POST',body:{text:'Improve dashboard filters.',page:'dashboard',requestId:'ai-feedback'}})).data.item;const route='/api/feedback/'+item.id+'/review';assert.equal((await f.request(route,{method:'POST',body:{}})).status,400);
 const review=await f.request(route,{method:'POST',body:{confirm:true}});assert.equal(review.status,200);assert.deepEqual(supplied,{page:'dashboard',feedback:'Improve dashboard filters.'});assert.equal(review.data.item.review.priority,'medium');assert.equal(review.data.item.status,'open');assert.equal(review.data.item.reviewStatus,'completed');
});

test('cancelled and malformed AI feedback reviews preserve original feedback',async t=>{
 let release,started;const ready=new Promise(r=>started=r);const f=await fixture(t,{buddyFetch:async()=>{started();await new Promise(r=>release=r);return buddyResponse(buddyReply({reply:'not valid review JSON'}));}});await f.setup();await enableBuddy(f);
 const item=(await f.request('/api/feedback',{method:'POST',body:{text:'Fictional feedback retained.',page:'settings',requestId:'cancel-feedback'}})).data.item;const route='/api/feedback/'+item.id;
 const pending=f.request(route+'/review',{method:'POST',body:{confirm:true}});await ready;await f.request(route+'/cancel',{method:'POST',body:{}});release();assert.equal((await pending).status,499);let saved=(await f.request('/api/feedback')).data.items[0];assert.equal(saved.text,item.text);assert.equal(saved.reviewStatus,'cancelled');
 const second=f.request(route+'/review',{method:'POST',body:{confirm:true}});for(let i=0;i<50;i++){if((await f.request('/api/feedback')).data.items[0].reviewStatus==='running')break;await new Promise(r=>setTimeout(r,5));}release();assert.equal((await second).status,502);saved=(await f.request('/api/feedback')).data.items[0];assert.equal(saved.reviewStatus,'failed');assert.equal(saved.text,item.text);
});

test("communications retain direction, custom channels, follow-ups and scoped document links across edits and restart", async t => {
  const f = await fixture(t); await f.setup();
  let record = (await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;
  const other = (await f.request('/api/opportunities',{method:'POST',body:{...opportunity,company:'Fictional Other'}})).data;
  async function upload(opportunityId) {return (await f.request('/api/documents',{method:'POST',body:{opportunityId,name:'fictional-notes.txt',kind:'other',contentBase64:Buffer.from('Fictional recruiter notes').toString('base64')}})).data;}
  const doc = await upload(record.id), otherDoc = await upload(other.id), library = await upload('');
  const path = `/api/opportunities/${record.id}/activities`;
  const body={kind:'communication',type:'email',title:'Recruiter follow-up',contact:'Fictional Jamie',direction:'incoming',channel:'LinkedIn',status:'completed',scheduledAt:'2026-10-29',notes:'Discussed next interview.',followUp:'Send availability',followUpDate:'2026-10-30',followUpDone:false,documentIds:[doc.id]};
  for (const documentIds of [[otherDoc.id],[library.id],['missing'],[doc.id,doc.id]]) assert.equal((await f.request(path,{method:'POST',body:{...body,documentIds}})).status,400);
  for (const invalid of [{direction:'sideways'},{followUpDate:'2026-02-30'},{followUpDone:'yes'},{followUp:'',followUpDate:'2026-10-30'},{type:'x'.repeat(101)}]) assert.equal((await f.request(path,{method:'POST',body:{...body,...invalid}})).status,400);
  assert.equal((await f.request(path,{method:'POST',auth:false,body})).status,401);
  record=(await f.request(path,{method:'POST',body})).data;
  assert.equal(record.activities.length,1);const activity=record.activities[0];
  assert.equal(activity.contact,'Fictional Jamie');assert.equal(activity.direction,'incoming');assert.equal(activity.channel,'LinkedIn');assert.equal(activity.followUpDate,'2026-10-30');assert.deepEqual(activity.documentIds,[doc.id]);
  let result=await f.request(`${path}/${activity.id}`,{method:'PATCH',body:{revision:record.revision-1,status:'rescheduled'}});assert.equal(result.status,409);
  result=await f.request(`${path}/${activity.id}`,{method:'PATCH',body:{revision:record.revision,direction:'bad'}});assert.equal(result.status,400);
  assert.equal((await f.request(`/api/opportunities/${record.id}`)).data.activities[0].history.length,0);
  record=(await f.request(`${path}/${activity.id}`,{method:'PATCH',body:{revision:record.revision,direction:'outgoing',channel:'phone',contact:'Fictional Sam',notes:'Availability sent.',followUpDone:true,documentIds:[]}})).data;
  const saved=record.activities[0], old=saved.history[0];
  for (const key of ['direction','channel','contact','notes','followUp','followUpDate','followUpDone','documentIds']) assert.deepEqual(old[key],activity[key]);
  assert.deepEqual(saved.documentIds,[]);assert.equal(saved.followUpDone,true);
  assert.equal((await f.request(`/api/documents/${doc.id}/content`,{binary:true})).data.toString(),'Fictional recruiter notes');
  await f.restart();await f.login();
  const restored=(await f.request(`/api/opportunities/${record.id}`)).data.activities[0];assert.deepEqual(restored,saved);
  const exported=(await f.request('/api/export')).data;assert.deepEqual(exported.opportunities.find(o=>o.id===record.id).activities[0],saved);
});

test("custom interviews preserve original dates and attachments in full rescheduling history", async t=>{
  const f=await fixture(t);await f.setup();
  let o=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;
  const doc=(await f.request('/api/documents',{method:'POST',body:{opportunityId:o.id,name:'fictional-panel.txt',kind:'other',contentBase64:Buffer.from('Panel brief').toString('base64')}})).data;
  const path=`/api/opportunities/${o.id}/activities`;
  o=(await f.request(path,{method:'POST',body:{title:'Architecture panel',kind:'interview',type:'Architecture whiteboard panel',scheduledAt:'2026-10-30T10:00:00Z',isFinal:true,documentIds:[doc.id]}})).data;
  const id=o.activities[0].id;
  o=(await f.request(`${path}/${id}`,{method:'PATCH',body:{revision:o.revision,status:'rescheduled',scheduledAt:'2026-11-02T11:30:00Z',notes:'Panel moved by recruiter.'}})).data;
  const a=o.activities[0];assert.equal(a.type,'Architecture whiteboard panel');assert.equal(a.status,'rescheduled');assert.equal(a.isFinal,true);assert.deepEqual(a.documentIds,[doc.id]);assert.equal(a.history[0].scheduledAt,'2026-10-30T10:00:00.000Z');assert.equal(a.history[0].status,'planned');assert.deepEqual(a.history[0].documentIds,[doc.id]);
  // Removing an original leaves an explicit unavailable link; editing the activity remains possible.
  const deleted=await f.request(`/api/documents/${doc.id}`,{method:'DELETE',body:{revision:doc.revision}});assert.equal(deleted.status,200);
  const edited=await f.request(`${path}/${id}`,{method:'PATCH',body:{revision:o.revision,documentIds:[doc.id],notes:'Original removed elsewhere.'}});assert.equal(edited.status,200);assert.deepEqual(edited.data.activities[0].documentIds,[doc.id]);
});

test('manual opportunity review preserves strengths/gaps and dated history; stage changes require an explicit choice',async t=>{
 const f=await fixture(t);await f.setup();
 let o=(await f.request('/api/opportunities',{method:'POST',body:{...opportunity,applicationRoute:'Fictional recruiter portal'}})).data;
 assert.equal(o.applicationRoute,'Fictional recruiter portal');const initial=o;
 const path=`/api/opportunities/${o.id}/review`;
 const review={strengths:'Led integration delivery.',gaps:'Databricks experience not established.',decision:'proceed',reason:'Strong relevant delivery experience.',effectiveAt:'2026-10-28',applyStage:false};
 assert.equal((await f.request(path,{method:'PATCH',auth:false,body:{revision:o.revision,...review}})).status,401);
 for(const patch of [{decision:'yes'},{reason:''},{effectiveAt:'2026-02-30'},{applyStage:'yes'},{strengths:'x'.repeat(50001)},{outcome:'hired'}])assert.equal((await f.request(path,{method:'PATCH',body:{revision:o.revision,...review,...patch}})).status,400);
 assert.equal((await f.request(`/api/opportunities/${o.id}`)).data.revision,o.revision);
 o=(await f.request(path,{method:'PATCH',body:{revision:o.revision,...review}})).data;
 assert.equal(o.stage,'identification');assert.equal(o.outcome,'');assert.equal(o.currentStageEventId,initial.currentStageEventId);assert.equal(o.stageEnteredAt,initial.stageEnteredAt);assert.equal(o.review.effectiveAt,'2026-10-28');assert.equal(o.events.at(-1).title,'Review decision');assert.equal(o.review.history.length,0);
 assert.equal((await f.request(path,{method:'PATCH',body:{revision:initial.revision,...review}})).status,409);
 o=(await f.request(path,{method:'PATCH',body:{revision:o.revision,...review,applyStage:true}})).data;
 assert.equal(o.stage,'documents');assert.equal(o.outcome,'');assert.equal(o.stageEnteredAt,'2026-10-28');assert.equal(o.events.at(-1).id,o.currentStageEventId);assert.equal(o.review.history[0].decision,'proceed');assert.equal(o.review.history[0].gaps,review.gaps);
 o=(await f.request(path,{method:'PATCH',body:{revision:o.revision,decision:'defer',reason:'Awaiting clarification.',applyStage:true,effectiveAt:'2026-10-29'}})).data;
 assert.equal(o.stage,'review');assert.equal(o.review.history.length,2);assert.equal(o.events[0].effectiveAt,initial.events[0].effectiveAt);
 o=(await f.request(path,{method:'PATCH',body:{revision:o.revision,decision:'ignore',reason:'Required working arrangement is unsuitable.',applyStage:true}})).data;
 assert.equal(o.stage,'outcome');assert.equal(o.outcome,'ignored');assert.equal(o.review.history.at(-1).decision,'defer');
 assert.equal((await f.request(path,{method:'PATCH',body:{revision:o.revision,decision:'proceed',reason:'Changed my mind.',applyStage:true}})).status,409);
 assert.deepEqual((await f.request(path)).data.review,o.review);
 await f.restart();await f.login();const restored=(await f.request(`/api/opportunities/${o.id}`)).data;assert.deepEqual(restored.review,o.review);assert.equal(restored.applicationRoute,'Fictional recruiter portal');
 const updated=(await f.request(`/api/opportunities/${o.id}`,{method:'PATCH',body:{revision:restored.revision,applicationRoute:'Fictional email application'}})).data;assert.equal(updated.applicationRoute,'Fictional email application');assert.deepEqual(updated.review,restored.review);
});

test('offers are independent of outcomes; preserve versions, dates and idempotent creation across restart and backup',async t=>{
 const f=await fixture(t);await f.setup();
 let o=(await f.request('/api/opportunities',{method:'POST',body:{...opportunity,stage:'final-interview'}})).data;const initial=o;
 const other=(await f.request('/api/opportunities',{method:'POST',body:{...opportunity,company:'Fictional Other'}})).data;
 async function upload(opportunityId){return (await f.request('/api/documents',{method:'POST',body:{opportunityId,name:'fictional-offer.txt',kind:'other',contentBase64:Buffer.from('Fictional offer letter').toString('base64')}})).data;}
 const doc=await upload(o.id),foreign=await upload(other.id),path=`/api/opportunities/${o.id}/offers`;
 const body={revision:o.revision,requestId:'fictional-offer-request-001',title:'Initial package',compensation:'Fictional GBP 100,000 per year',terms:'Subject to references.',contact:'Fictional Jamie',offeredAt:'2026-10-28',responseDueDate:'2026-11-04',startDate:'2027-01-04',decision:'pending',documentIds:[doc.id]};
 assert.equal((await f.request(path,{method:'POST',auth:false,body})).status,401);
 for(const patch of [{documentIds:[foreign.id]},{documentIds:[doc.id,doc.id]},{responseDueDate:'2026-02-30'},{offeredAt:'2026-02-30T10:00:00Z'},{decision:'hired'},{outcome:'hired'},{title:''}])assert.equal((await f.request(path,{method:'POST',body:{...body,...patch}})).status,400);
 o=(await f.request(path,{method:'POST',body})).data;assert.equal(o.offers.length,1);assert.equal(o.stage,'final-interview');assert.equal(o.outcome,'');assert.equal(o.stageEnteredAt,initial.stageEnteredAt);assert.equal(o.currentStageEventId,initial.currentStageEventId);assert.equal(o.offers[0].decision,'pending');assert.equal(o.offers[0].decidedAt,'');
 assert.equal((await f.request(path,{method:'POST',body})).data.revision,o.revision);assert.equal((await f.request(path,{method:'POST',body:{...body,title:'Changed request'}})).status,409);
 const offer=o.offers[0],edit=`${path}/${offer.id}`;
 assert.equal((await f.request(edit,{method:'PATCH',body:{revision:initial.revision,decision:'accepted'}})).status,409);
 assert.equal((await f.request(edit,{method:'PATCH',body:{revision:o.revision,decision:'accepted',decidedAt:'2026-10-27'}})).status,400);
 o=(await f.request(edit,{method:'PATCH',body:{revision:o.revision,decision:'accepted',decidedAt:'2026-10-29',decisionReason:'Package agreed.'}})).data;
 assert.equal(o.outcome,'');assert.equal(o.stage,'final-interview');assert.equal(o.offers[0].decidedAt,'2026-10-29');assert.equal(o.offers[0].history[0].decision,'pending');assert.equal(o.offers[0].history[0].compensation,body.compensation);assert.deepEqual(o.offers[0].history[0].documentIds,[doc.id]);assert.equal(o.events.at(-1).title,'Offer accepted');
 o=(await f.request(edit,{method:'PATCH',body:{revision:o.revision,decision:'declined',decidedAt:'2026-10-30',decisionReason:'Changed circumstances.',documentIds:[]}})).data;
 assert.equal(o.outcome,'');assert.equal(o.offers[0].history.at(-1).decision,'accepted');assert.deepEqual(o.offers[0].documentIds,[]);assert.equal((await f.request(`/api/documents/${doc.id}/content`,{binary:true})).data.toString(),'Fictional offer letter');
 o=(await f.request(path,{method:'POST',body:{...body,revision:o.revision,requestId:'fictional-offer-request-002',title:'Revised offer',offeredAt:'',responseDueDate:'',startDate:'',documentIds:[]}})).data;
 assert.equal(o.offers.length,2);assert.ok(Number.isFinite(Date.parse(o.offers[1].offeredAt)));assert.equal(o.offers[1].decision,'pending');
 const backup=await f.request('/api/backup',{method:'POST',body:{}});assert.equal(backup.status,200);const db=new DatabaseSync(join(backup.data.location,'board.sqlite'),{readOnly:true});assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(o.id).data).offers,o.offers);db.close();
 const exported=(await f.request('/api/export')).data;assert.deepEqual(exported.opportunities.find(v=>v.id===o.id).offers,o.offers);
 await f.restart();await f.login();assert.deepEqual((await f.request(`/api/opportunities/${o.id}`)).data.offers,o.offers);
 // Confirming Hired remains a separate explicit outcome action.
 o=(await f.request(`/api/opportunities/${o.id}`,{method:'PATCH',body:{revision:o.revision,outcome:'hired'}})).data;assert.equal(o.stage,'outcome');assert.equal(o.outcome,'hired');assert.equal(o.offers.length,2);
});

test('reliability settings are private and host changes require an available helper, a validated plan and explicit confirmation',async t=>{
 const f=await fixture(t);await f.setup();
 assert.equal((await f.request('/api/uploads/workspace',{auth:false})).status,401);const workspace=(await f.request('/api/uploads/workspace')).data;assert.equal((await f.request('/api/uploads/workspace')).data.id,workspace.id);
 assert.equal((await f.request('/api/reliability/status',{auth:false})).status,401);assert.equal((await f.request('/api/reliability/status')).data.available,false);
 assert.equal((await f.request('/api/reliability/preview',{method:'POST',body:{kind:'migrate',destination:'/tmp/example'}})).status,503);
 writeFileSync(join(f.options.dataDir,'.watcher.heartbeat'),'');
 assert.equal((await f.request('/api/reliability/preview',{method:'POST',body:{kind:'migrate',destination:'relative'}})).status,400);
 assert.equal((await f.request('/api/reliability/apply',{method:'POST',body:{planId:'fake',confirm:false}})).status,400);
 const result=await f.request('/api/reliability/preview',{method:'POST',body:{kind:'migrate',destination:'/tmp/fictional-destination'}});assert.equal(result.status,202);assert.equal(JSON.parse(readFileSync(join(f.options.dataDir,'pending-maintenance.json'),'utf8')).destination,'/tmp/fictional-destination');
 assert.equal((await f.request('/api/reliability/preview',{method:'POST',body:{kind:'migrate',destination:'/tmp/other'}})).status,409);
 assert.equal((await f.request('/api/backups/schedule',{auth:false})).status,401);const schedule=(await f.request('/api/backups/schedule')).data;assert.equal(schedule.enabled,false);assert.equal((await f.request('/api/backups/schedule',{method:'PATCH',body:{revision:schedule.revision,enabled:true,intervalHours:24}})).status,200);assert.equal((await f.request('/api/backups/schedule',{method:'PATCH',body:{revision:schedule.revision,enabled:true,intervalHours:24}})).status,409);
 await f.restart();await f.login();assert.equal((await f.request('/api/uploads/workspace')).data.id,workspace.id);assert.equal((await f.request('/api/backups/schedule')).data.enabled,true);
});

test('streamed Buddy previews are private, transient and saved only after terminal validation',async t=>{
 let providerStream,entered;let calls=0;const enc=new TextEncoder();const event=value=>enc.encode('data: '+JSON.stringify(value)+'\n\n');
 const reply=JSON.stringify(buddyReply({reply:JSON.stringify({intent:'coach',message:'Fictional live encouragement without invented achievements.',opportunity:null,tasks:[],star:null})}));
 const first=reply.slice(0,reply.indexOf('achievements')+5);
 const f=await fixture(t,{buddyFetch:async()=>{calls++;return new Response(new ReadableStream({start(c){providerStream=c;c.enqueue(event({choices:[{index:0,delta:{content:first}}]}));entered();}}),{headers:{'content-type':'text/event-stream'}});}});await f.setup();await enableBuddy(f);
 let start=new Promise(r=>entered=r);const body={mode:'auto',message:'Fictional coaching request',conversationId:'live-preview',requestId:'live-preview-1',documentIds:[]};const pending=f.request('/api/buddy/workspace',{method:'POST',body});await start;
 const live=(await f.request('/api/buddy/requests/live-preview-1')).data.request;assert.match(live.preview,/Fictional live encouragement/);assert.equal(live.stage,'receiving-response');
 assert.equal((await f.request('/api/buddy/requests/live-preview-1',{auth:false})).status,401);
 assert.match((await f.request('/api/buddy/requests?scope=live-preview')).data.request.preview,/Fictional/);
 assert.equal((await f.request('/api/buddy/workspace?conversationId=live-preview')).data.messages.filter(m=>m.role==='assistant').length,0);
 const check=new DatabaseSync(join(f.options.dataDir,'board.sqlite'));assert.equal(check.prepare("SELECT data FROM buddy_requests WHERE id='live-preview-1'").get().data.includes('Fictional live'),false);check.close();
 providerStream.enqueue(event({choices:[{index:0,delta:{content:reply.slice(first.length)}}]}));providerStream.enqueue(event({choices:[{index:0,finish_reason:'stop',delta:{}}]}));providerStream.enqueue(enc.encode('data: [DONE]\n\n'));providerStream.close();assert.equal((await pending).status,200);
 const done=(await f.request('/api/buddy/requests/live-preview-1')).data.request;assert.equal(done.stage,'completed');assert.equal(done.preview,undefined);assert.ok(done.timings.providerMs>=0);assert.ok(done.timings.firstResponseMs>=0);assert.equal((await f.request('/api/buddy/workspace',{method:'POST',body})).status,200);assert.equal(calls,1);
 start=new Promise(r=>entered=r);const cancelled=f.request('/api/buddy/workspace',{method:'POST',body:{...body,requestId:'live-preview-cancel'}});await start;await f.request('/api/buddy/requests/live-preview-cancel',{method:'POST',body:{cancel:true}});assert.equal((await cancelled).status,499);const stopped=(await f.request('/api/buddy/requests/live-preview-cancel')).data.request;assert.equal(stopped.preview,undefined);assert.equal(stopped.cancellation,'transport-stopped');
 start=new Promise(r=>entered=r);const broken=f.request('/api/buddy/workspace',{method:'POST',body:{...body,requestId:'live-preview-broken'}});await start;providerStream.close();assert.equal((await broken).status,502);assert.equal((await f.request('/api/buddy/requests/live-preview-broken')).data.request.preview,undefined);
 assert.equal((await f.request('/api/buddy/workspace?conversationId=live-preview')).data.messages.filter(m=>m.role==='assistant').length,1);
 await f.restart();await f.login();const saved=(await f.request('/api/buddy/requests/live-preview-1')).data.request;assert.equal(saved.timings.providerMs,done.timings.providerMs);assert.equal(saved.preview,undefined);
});

test('opportunity chat uses the same streamed preview and abort boundary without creating record changes',async t=>{
 let entered;const started=new Promise(r=>entered=r);const f=await fixture(t,{buddyFetch:async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:'{"reply":"Fictional opportunity advice'}}]})+'\n\n'));entered();}}),{headers:{'content-type':'text/event-stream'}})});await f.setup();await enableBuddy(f);const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;
 const pending=buddyChat(f,op.id,{requestId:'op-stream-cancel'});await started;assert.match((await f.request('/api/buddy/requests/op-stream-cancel')).data.request.preview,/Fictional opportunity/);await f.request('/api/buddy/requests/op-stream-cancel',{method:'POST',body:{cancel:true}});assert.equal((await pending).status,499);assert.equal((await f.request('/api/opportunities/'+op.id)).data.revision,op.revision);assert.equal((await f.request('/api/opportunities/'+op.id+'/buddy')).data.messages.length,0);
});

test('reviewed text intake preserves manual values, exact originals and report provenance atomically with idempotent creation',async t=>{
 const source='Fictional Atlas Ltd\nSenior Platform Architect\nSalary GBP 90,000 per year. Closing date 31 December 2026.\nContact Pat Example at pat@example.test.';
 const output={details:[{field:'company',value:'Fictional Atlas Ltd',quote:'Fictional Atlas Ltd',passageId:'p1'},{field:'role',value:'Senior Platform Architect',quote:'Senior Platform Architect',passageId:'p1'},{field:'contact',value:'Pat Example at pat@example.test',quote:'Contact Pat Example at pat@example.test.',passageId:'p1'},{field:'deadline',value:'2026-12-31',quote:'31 December 2026',passageId:'p1'},{field:'salary',value:'GBP 190,000 per year',quote:'Salary GBP 90,000 per year.',passageId:'p1'}],uncertainties:[]};let calls=0;
 const f=await fixture(t,{buddyFetch:async(_,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.messages.at(-1).content.includes('careerLibrary'),false);return buddyResponse(buddyReply({reply:JSON.stringify(output)}));}});await f.setup();await enableBuddy(f);
 assert.equal((await f.request('/api/job-intake/settings',{auth:false})).status,401);
 const result=await f.request('/api/job-intake',{method:'POST',body:{kind:'text',text:source,useAI:true,ocr:false,requestId:'intake-text-1'}});assert.equal(result.status,200);const r=result.data;assert.equal(r.fields.company,'Fictional Atlas Ltd');assert.equal(r.fields.salary,undefined);assert.ok(r.missing.includes('salary'));assert.equal(r.ai.used,true);assert.equal(calls,1);assert.equal((await f.request('/api/board')).data.opportunities.length,0);assert.equal((await f.request('/api/documents')).data.documents.length,0);
 assert.equal((await f.request('/api/job-intake/'+r.id+'/source',{binary:true})).data.toString(),source);
 const body={intakeId:r.id,company:'Manually reviewed employer',role:r.fields.role,description:r.fields.description,contact:r.fields.contact,deadline:r.fields.deadline};const saved=await f.request('/api/opportunities',{method:'POST',body});assert.equal(saved.status,201);assert.equal(saved.data.company,'Manually reviewed employer');assert.equal(saved.data.documents.length,3);assert.ok(saved.data.events.some(e=>e.note.includes('Job intake reviewed')));
 const original=saved.data.documents.find(d=>d.externalSource?.kind==='original'),report=saved.data.documents.find(d=>d.externalSource?.kind==='report');assert.equal((await f.request('/api/documents/'+original.id+'/content',{binary:true})).data.toString(),source);const reportBytes=(await f.request('/api/documents/'+report.id+'/content',{binary:true})).data;const data=JSON.parse(reportBytes);assert.equal(data.reviewedFields.company,'Manually reviewed employer');assert.equal(data.fields.company,'Fictional Atlas Ltd');assert.equal(data.ai.promptVersion,'job-intake-v1');
 const replay=await f.request('/api/opportunities',{method:'POST',body});assert.equal(replay.data.id,saved.data.id);assert.equal((await f.request('/api/board')).data.opportunities.length,1);assert.equal((await f.request('/api/opportunities',{method:'POST',body:{...body,role:'Different role'}})).status,409);
 const backup=await f.request('/api/backup',{method:'POST',body:{}});assert.equal(backup.status,200);assert.equal(JSON.parse(readFileSync(join(f.options.filesDir,'backups',backup.data.name,'manifest.json'),'utf8')).documents.length,3);
 await f.restart();await f.login();assert.equal((await f.request('/api/opportunities/'+saved.data.id)).data.jobIntake.id,r.id);
});

test('AI-disabled file/URL intake keeps full source snapshots and refuses tampered previews or unsafe PDF bytes',async t=>{
 const html='<html><main><h1>Fictional Engineer</h1><p class="company-name">Fictional Original</p><p>'+('Work with data integration and supported application systems. '.repeat(5))+'</p></main><script>window.untrusted=true</script></html>';
 const f=await fixture(t,{intakePageFetcher:async()=>({html,bytes:Buffer.from(html),url:'https://fictional.example/final',contentType:'text/html'}),intakePDF:async()=>({pages:[{page:1,text:'Fictional OCR source\nArchitecture role with sufficient extracted text for review.',method:'ocr'}],totalPages:1,ocrPages:[1],warnings:['Fictional OCR warning.']})});await f.setup();
 const url=await f.request('/api/job-intake',{method:'POST',body:{kind:'url',url:'https://fictional.example/job',useAI:false,ocr:true,requestId:'intake-url'}});assert.equal(url.status,200);assert.equal(url.data.source.resolvedUrl,'https://fictional.example/final');assert.equal((await f.request('/api/job-intake/'+url.data.id+'/source',{binary:true})).data.toString(),html);assert.equal(url.data.fields.description.includes('window.untrusted'),false);
 writeFileSync(join(f.options.dataDir,'job-intake-previews',url.data.id,'original'),'tampered');assert.equal((await f.request('/api/opportunities',{method:'POST',body:{intakeId:url.data.id,company:'Fictional',role:'Engineer'}})).status,409);assert.equal((await f.request('/api/board')).data.opportunities.length,0);
 const pdf=Buffer.from('%PDF-fictional-original-bytes');const file=await f.request('/api/job-intake',{method:'POST',body:{kind:'file',name:'fictional.pdf',contentBase64:pdf.toString('base64'),useAI:false,ocr:true,requestId:'intake-file'}});assert.equal(file.status,200);assert.deepEqual(file.data.source.ocrPages,[1]);assert.equal((await f.request('/api/job-intake/'+file.data.id+'/source',{binary:true})).data.equals(pdf),true);
 assert.equal((await f.request('/api/job-intake',{method:'POST',body:{kind:'file',name:'../escape.pdf',contentBase64:'',useAI:false,ocr:true,requestId:'bad-file'}})).status,400);assert.equal((await f.request('/api/job-intake',{method:'POST',body:{kind:'text',text:'Short',useAI:true,ocr:false,requestId:'disabled-ai'}})).status,400);
});

test('job-intake cancellation rejects late model fields without saving opportunities, sources or a review preview',async t=>{
 let entered;const started=new Promise(r=>entered=r);const f=await fixture(t,{buddyFetch:async(_,options)=>{entered();return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}});await f.setup();await enableBuddy(f);
 const pending=f.request('/api/job-intake',{method:'POST',body:{kind:'text',text:'Fictional intake source with enough career-related job information to read.',useAI:true,ocr:false,requestId:'intake-cancel'}});await started;await f.request('/api/buddy/requests/intake-cancel',{method:'POST',body:{cancel:true}});assert.equal((await pending).status,499);assert.equal((await f.request('/api/board')).data.opportunities.length,0);assert.equal((await f.request('/api/documents')).data.documents.length,0);assert.equal(readdirSync(join(f.options.dataDir,'job-intake-previews')).length,0);
});

test('failed AI review stays an explicitly labelled source-only preview without silent retries or invented fields',async t=>{
 let calls=0;const f=await fixture(t,{buddyFetch:async()=>{calls++;return new Response('private provider error',{status:503});}});await f.setup();await enableBuddy(f);const r=await f.request('/api/job-intake',{method:'POST',body:{kind:'text',text:'Fictional source description with enough information for a local read, but no stated salary.',useAI:true,ocr:false,requestId:'intake-fallback'}});assert.equal(r.status,200);assert.equal(r.data.ai.used,false);assert.equal(r.data.ai.attempted,true);assert.equal(r.data.ai.provider,'custom');assert.ok(r.data.warnings.some(v=>v.includes('could not complete')));assert.equal(r.data.fields.salary,undefined);assert.equal(calls,1);assert.equal(JSON.stringify(r.data).includes('private-buddy-test-key'),false);assert.equal((await f.request('/api/board')).data.opportunities.length,0);
});

test('a refused temporary source write does not leave intake busy or an unfinished request',async t=>{
 if(!process.getuid||process.getuid()===0){t.skip('Requires ordinary POSIX file permissions.');return;}
 const {chmodSync}=await import('node:fs');const f=await fixture(t);await f.setup();const folder=join(f.options.dataDir,'job-intake-previews');const body={kind:'text',text:'Fictional job text with enough detail to read after restoring folder permissions.',useAI:false,ocr:false,requestId:'intake-storage-retry'};
 try{chmodSync(folder,0o500);assert.equal((await f.request('/api/job-intake',{method:'POST',body})).status,500);}finally{chmodSync(folder,0o700);}
 assert.equal((await f.request('/api/buddy/requests/intake-storage-retry')).data.request.stage,'failed');assert.equal((await f.request('/api/job-intake',{method:'POST',body})).status,200);
});

test('AI workflow switches persist with conflicts and gate requested stages without disabling local source reading',async t=>{
 let calls=0;const f=await fixture(t,{buddyFetch:async()=>{calls++;return buddyResponse(buddyReply());}});await f.setup();await enableBuddy(f);
 const route='/api/ai-workflow';assert.equal((await f.request(route,{auth:false})).status,401);const initial=(await f.request(route)).data;assert.equal(initial.intake,true);assert.equal(initial.autoFit,true);
 const off={...initial,intake:false,fit:false,drafting:false,autoFit:false,autoTags:false};assert.equal((await f.request(route,{method:'PATCH',body:off})).status,200);assert.equal((await f.request(route,{method:'PATCH',body:off})).status,409);
 const current=(await f.request(route)).data;assert.equal((await f.request(route,{method:'PATCH',body:{...current,fit:'yes'}})).status,400);
 const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;
 for(const action of ['fit','salary','skills','cv','cover'])assert.equal((await buddyChat(f,op.id,{action})).status,403);
 const body={kind:'text',text:'Fictional job description with enough detail for local reading without AI.',useAI:true,ocr:false,requestId:'stage-disabled'};assert.equal((await f.request('/api/job-intake',{method:'POST',body})).status,403);assert.equal((await f.request('/api/job-intake',{method:'POST',body:{...body,useAI:false}})).status,200);assert.equal(calls,0);
 await f.restart();await f.login();assert.equal((await f.request(route)).data.drafting,false);assert.equal((await f.request('/api/opportunities/'+op.id)).data.role,op.role);
});

test('saved briefings cite sources, become stale after edits, persist/export and preserve previous output on failure',async t=>{
 let invalid=false,calls=0;const f=await fixture(t,{buddyFetch:async(_,options)=>{calls++;const sources=JSON.parse(JSON.parse(options.body).messages.at(-1).content);const value={position:[{text:'Fictional role remains active.',sourceIds:[invalid?'invented':sources[0].id]}],developments:[],strengths:[],gaps:[],questions:[],nextActions:[]};return buddyResponse(buddyReply({reply:JSON.stringify(value)}));}});await f.setup();await enableBuddy(f);const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data,route='/api/opportunities/'+op.id+'/ai-summary';
 assert.equal((await f.request(route,{auth:false})).status,401);assert.equal((await f.request(route)).data.summary,null);assert.equal(calls,0);
 const first=await f.request(route,{method:'POST',body:{revision:0,requestId:'summary-1'}});assert.equal(first.status,200);assert.equal(first.data.summary.revision,1);assert.equal(first.data.stale,false);assert.equal((await f.request('/api/opportunities/'+op.id)).data.revision,op.revision);
 assert.equal((await f.request(route,{method:'POST',body:{revision:0,requestId:'summary-conflict'}})).status,409);
 await f.request('/api/opportunities/'+op.id,{method:'PATCH',body:{revision:op.revision,nextAction:'Fictional follow-up'}});assert.equal((await f.request(route)).data.stale,true);
 invalid=true;assert.equal((await f.request(route,{method:'POST',body:{revision:1,requestId:'summary-invalid'}})).status,502);assert.equal((await f.request(route)).data.summary.revision,1);
 assert.equal((await f.request('/api/export')).data.opportunityBriefings.length,1);await f.restart();await f.login();assert.equal((await f.request(route)).data.summary.revision,1);assert.equal((await f.request(route)).data.stale,true);
});
test('cancelled briefing and opportunity changes during generation cannot publish a late summary',async t=>{
 let release,entered;let started;const f=await fixture(t,{buddyFetch:async(_,options)=>{entered();await new Promise(r=>release=r);const sources=JSON.parse(JSON.parse(options.body).messages.at(-1).content);return buddyResponse(buddyReply({reply:JSON.stringify({position:[{text:'Fictional summary',sourceIds:[sources[0].id]}],developments:[],strengths:[],gaps:[],questions:[],nextActions:[]})}));}});await f.setup();await enableBuddy(f);const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data,route='/api/opportunities/'+op.id+'/ai-summary';
 started=new Promise(r=>entered=r);let pending=f.request(route,{method:'POST',body:{revision:0,requestId:'summary-cancel'}});await started;await f.request('/api/buddy/requests/summary-cancel',{method:'POST',body:{cancel:true}});release();assert.equal((await pending).status,499);assert.equal((await f.request(route)).data.summary,null);
 started=new Promise(r=>entered=r);pending=f.request(route,{method:'POST',body:{revision:0,requestId:'summary-stale'}});await started;await f.request('/api/opportunities/'+op.id,{method:'PATCH',body:{revision:op.revision,nextAction:'Changed while generating'}});release();assert.equal((await pending).status,409);assert.equal((await f.request(route)).data.summary,null);
});
test('briefing fingerprints include linked evidence only and reject unsupported or incomplete sections',async()=>{
 const{summaryInput,validateBriefing}=await import('../server/opportunity-summary.mjs');const record={id:'one',events:[{id:'event',note:'First note'}],activities:[]},docs=[{id:'doc',opportunityId:'one',name:'CV',sha256:'first'}],tasks=[{id:'task',opportunityId:'one',title:'Follow up'}];const first=summaryInput(record,docs,tasks);assert.equal(first.hash,summaryInput(record,docs,[...tasks,{id:'other',opportunityId:'two',title:'Private unrelated task'}]).hash);assert.notEqual(first.hash,summaryInput(record,[{...docs[0],sha256:'second'}],tasks).hash);assert.notEqual(first.hash,summaryInput(record,docs,[{...tasks[0],title:'Changed task'}]).hash);assert.notEqual(first.hash,summaryInput({...record,events:[{id:'event',note:'Edited note'}]},docs,tasks).hash);assert.throws(()=>validateBriefing({},first.sources));const value={position:[],developments:[],strengths:[],gaps:[],questions:[],nextActions:[]};assert.deepEqual(validateBriefing(value,first.sources),value);assert.throws(()=>validateBriefing({...value,position:[{text:'Unsupported',sourceIds:[]}]},first.sources));
});

const historicalSource=()=>({format:'opportunity-knox-historical',version:1,opportunities:[{id:'fictional-history-one',company:'Fictional History Ltd',role:'Platform Lead',contact:'Fictional Recruiter',url:'https://example.com/jobs/101?utm_source=test',jobReference:'H-101',stage:'interviews',createdAt:'2026-08-01T12:00:00Z',stageEnteredAt:'2026-08-10T12:00:00Z',currentStageEventId:'old-event',events:[{id:'old-event',stage:'interviews',effectiveAt:'2026-08-10T12:00:00Z',recordedAt:'2026-08-11T12:00:00Z',note:'Fictional second interview',corrections:[{previous:'2026-08-09T12:00:00Z',changedAt:'2026-08-11T12:00:00Z'}]}],activities:[{id:'old-activity',kind:'interview',type:'video',title:'Fictional technical interview',status:'completed',scheduledAt:'2026-08-10T12:00:00Z',notes:'Fictional feedback',documentIds:['foreign-document'],history:[{notes:'Earlier feedback',changedAt:'2026-08-11T12:00:00Z'}]}],offers:[{id:'foreign-offer',decision:'accepted'}],applicationPacks:[{status:'submitted',documentIds:['foreign-document']}]}],documents:[{id:'foreign-document',opportunityId:'fictional-history-one',kind:'jd',name:'fictional-jd.txt',relativePath:'../../never-read'}],tasks:[{id:'foreign-task',opportunityId:'fictional-history-one',title:'Archived source task'}]});
const importChoice=(index,action,extra={})=>({index,action,targetId:'',fields:[],includeStage:false,includeHistory:false,...extra});
async function importPreview(f,source=historicalSource()){const r=await f.request('/api/record-imports/preview',{method:'POST',body:{source,label:'fictional-history.json'}});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
async function applyImport(f,p,choices,extra={}){return f.request('/api/record-imports/apply',{method:'POST',body:{id:p.id,sourceHash:p.sourceHash,choices,confirm:true,...extra}});}

test('historical preview is authenticated and imports records with archived provenance, dated history and a verified backup',async t=>{
 const f=await fixture(t);await f.setup();assert.equal((await f.request('/api/record-imports',{auth:false})).status,401);const source=historicalSource();source.opportunities[0].events[0].effectiveAt='2026-08-10';source.opportunities[0].stageEnteredAt='2026-08-10';const p=await importPreview(f,source);assert.equal((await f.request('/api/board')).data.opportunities.length,0);assert.equal((await f.request('/api/tasks')).data.tasks.length,0);assert.equal(p.rows[0].documentCount,1);
 assert.equal((await applyImport(f,p,[importChoice(0,'create')],{confirm:false})).status,400);const applied=await applyImport(f,p,[importChoice(0,'create')]);assert.equal(applied.status,200,JSON.stringify(applied.data));assert.equal(applied.data.created,1);const result=(await f.request('/api/opportunities/'+applied.data.results[0].id)).data;assert.notEqual(result.id,source.opportunities[0].id);assert.equal(result.stage,'interviews');assert.equal(result.events[0].effectiveAt,source.opportunities[0].events[0].effectiveAt);assert.deepEqual(result.events[0].corrections,source.opportunities[0].events[0].corrections);assert.equal(result.currentStageEventId,result.events[0].id);assert.deepEqual(result.activities[0].documentIds,[]);assert.equal(result.activities[0].history.length,1);assert.equal(result.offers,undefined);assert.equal(result.applicationPacks,undefined);assert.equal(result.documents.length,0);assert.equal((await f.request('/api/tasks')).data.tasks.length,0);
 const inspected=await f.request('/api/backups/inspect',{method:'POST',body:{name:applied.data.backup}});assert.equal(inspected.status,200);assert.equal(inspected.data.valid,true);const report=(await f.request('/api/record-imports/'+p.sourceHash)).data;assert.deepEqual(report.source,source);assert.equal((await f.request('/api/export')).data.recordImports.length,1);assert.equal((await applyImport(f,p,[importChoice(0,'create')])).data.replayed,true);assert.equal((await applyImport(f,p,[importChoice(0,'skip')])).status,409);assert.equal((await importPreview(f,source)).alreadyApplied,true);await f.restart();await f.login();assert.equal((await f.request('/api/record-imports')).data.imports.length,1);assert.equal((await f.request('/api/board')).data.opportunities.length,1);
});
test('historical merge changes only selected fields, preserves live history/current stage/files/packs and deduplicates source timeline',async t=>{
 const f=await fixture(t);await f.setup();const existing=(await f.request('/api/opportunities',{method:'POST',body:{...opportunity,company:'Fictional History Ltd',role:'Platform Lead',jobReference:'H-101',contact:'Existing Contact'}})).data;
 const bytes=Buffer.from('fictional submitted bytes');const doc=(await f.request('/api/documents',{method:'POST',body:{opportunityId:existing.id,name:'submitted.txt',kind:'cv',status:'submitted',contentBase64:bytes.toString('base64')}})).data;assert.ok(doc.id);
 const packRoute='/api/opportunities/'+existing.id+'/packs';let pack=await f.request(packRoute,{method:'POST',body:{revision:existing.revision,title:'Fictional retained pack',documentIds:[doc.id],coverLetterNotRequired:true}});assert.equal(pack.status,201);pack=await f.request(packRoute+'/'+pack.data.pack.id+'/approve',{method:'POST',body:{revision:pack.data.opportunity.revision,confirm:true}});assert.equal(pack.status,200);const oldPacks=(await f.request(packRoute)).data.packs;
 const source=historicalSource();const p=await importPreview(f,source);assert.ok(p.rows[0].matches[0].reasons.includes('Same employer and job reference'));const before=(await f.request('/api/opportunities/'+existing.id)).data;const applied=await applyImport(f,p,[importChoice(0,'merge',{targetId:existing.id,fields:['contact'],includeHistory:true})]);assert.equal(applied.status,200,JSON.stringify(applied.data));const merged=(await f.request('/api/opportunities/'+existing.id)).data;assert.equal(merged.contact,'Fictional Recruiter');assert.equal(merged.stage,before.stage);assert.equal(merged.stageEnteredAt,before.stageEnteredAt);assert.equal(merged.currentStageEventId,before.currentStageEventId);assert.deepEqual(merged.events[0],before.events[0]);assert.deepEqual(merged.documents,before.documents);assert.deepEqual((await f.request(packRoute)).data.packs,oldPacks);assert.equal(merged.activities.length,1);assert.deepEqual((await f.request('/api/documents/'+doc.id+'/content',{binary:true})).data,bytes);
 const again=historicalSource();again.opportunities[0].contact='Another Source Contact';const p2=await importPreview(f,again);const applied2=await applyImport(f,p2,[importChoice(0,'merge',{targetId:existing.id,fields:['contact'],includeHistory:true})]);assert.equal(applied2.status,200);const twice=(await f.request('/api/opportunities/'+existing.id)).data;assert.equal(twice.events.filter(e=>e.note==='Fictional second interview').length,1);assert.equal(twice.activities.length,1);
});
test('historical import detects URL, field hashes, JD hashes and duplicates within a file without selecting actions',async t=>{
 const f=await fixture(t);await f.setup();const existing=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;await f.request('/api/documents',{method:'POST',body:{opportunityId:existing.id,name:'jd.txt',kind:'jd',contentBase64:Buffer.from('fictional matching JD').toString('base64')}});const exported=(await f.request('/api/export')).data;assert.match(exported.documents[0].sha256,/^[a-f0-9]{64}$/);const p=await importPreview(f,exported);assert.ok(p.rows[0].matches[0].reasons.includes('Identical record fields (content hash)'));assert.ok(p.rows[0].matches[0].reasons.includes('Matching job-description hash in manifest'));assert.ok(p.rows[0].matches[0].reasons.includes('Same job URL'));
 const source=historicalSource();source.opportunities.push({...source.opportunities[0],id:'second'});const internal=await importPreview(f,source);assert.deepEqual(internal.rows[0].relatedRows,[1]);assert.deepEqual(internal.rows[1].relatedRows,[0]);assert.equal((await applyImport(f,internal,[importChoice(0,'skip'),importChoice(1,'skip')])).status,400);assert.equal((await applyImport(f,internal,[importChoice(0,'create'),importChoice(0,'skip')])).status,400);
});
test('historical import rejects stale previews, unsupported fields and unreviewed targets, and has explicit stage replacement',async t=>{
 const f=await fixture(t);await f.setup();const existing=(await f.request('/api/opportunities',{method:'POST',body:{...opportunity,company:'Fictional History Ltd',role:'Platform Lead'}})).data;let p=await importPreview(f);assert.equal((await applyImport(f,p,[importChoice(0,'merge',{targetId:existing.id,fields:['revision']})])).status,400);assert.equal((await applyImport(f,p,[importChoice(0,'merge',{targetId:'unknown',fields:['contact']})])).status,400);
 await f.request('/api/opportunities/'+existing.id,{method:'PATCH',body:{revision:existing.revision,contact:'Concurrent edit'}});assert.equal((await applyImport(f,p,[importChoice(0,'create')])).status,409);p=await importPreview(f);const r=await applyImport(f,p,[importChoice(0,'merge',{targetId:existing.id,includeStage:true})]);assert.equal(r.status,200);const merged=(await f.request('/api/opportunities/'+existing.id)).data;assert.equal(merged.stage,'interviews');assert.equal(merged.contact,'Concurrent edit');assert.equal(merged.events.find(e=>e.id===merged.currentStageEventId).effectiveAt,merged.stageEnteredAt);
});
test('historical imports roll back all records on write failure and abort if a full backup cannot be created',async t=>{
 const f=await fixture(t);await f.setup();let source=historicalSource();source.opportunities.push({...source.opportunities[0],id:'second',company:'Another Fictional Ltd'});let p=await importPreview(f,source);f.app.db.exec("CREATE TRIGGER import_failure BEFORE INSERT ON records WHEN json_extract(NEW.data,'$.company')='Another Fictional Ltd' BEGIN SELECT RAISE(FAIL,'fictional write failure'); END");const failed=await applyImport(f,p,[importChoice(0,'create'),importChoice(1,'create')]);assert.equal(failed.status,500);assert.equal((await f.request('/api/board')).data.opportunities.length,0);assert.equal((await f.request('/api/record-imports')).data.imports.length,0);f.app.db.exec('DROP TRIGGER import_failure');
 const o=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;const d=(await f.request('/api/documents',{method:'POST',body:{opportunityId:o.id,name:'unavailable.txt',kind:'jd',contentBase64:Buffer.from('fictional missing backup file').toString('base64')}})).data;const metadata=JSON.parse(f.app.db.prepare('SELECT data FROM documents WHERE id=?').get(d.id).data);rmSync(join(metadata.storageRoot,metadata.relativePath));p=await importPreview(f);const noBackup=await applyImport(f,p,[importChoice(0,'create')]);assert.equal(noBackup.status,409);assert.equal((await f.request('/api/board')).data.opportunities.length,1);assert.equal((await f.request('/api/record-imports')).data.imports.length,0);
});
test('historical imports reject invalid source history/dates/URLs, limit schema size, and never activate imported settings',async t=>{
 const f=await fixture(t);await f.setup();for(const patch of [{deadline:'2026-02-30'},{url:'file:///private/source'},{stage:'imaginary'},{events:[{stage:'review',effectiveAt:'not-a-date'}]},{activities:[{title:'No kind'}]},{stage:'submitted',events:[],stageEnteredAt:''}]){const source=historicalSource();Object.assign(source.opportunities[0],patch);assert.equal((await f.request('/api/record-imports/preview',{method:'POST',body:{source}})).status,400);}assert.equal((await f.request('/api/record-imports/preview',{method:'POST',body:{source:{opportunities:Array(1001).fill({})}}})).status,400);
 const source=historicalSource();source.settings={theme:'midnight'};source.careerBuddy={enabled:true,apiKey:'fictional-do-not-import'};const p=await importPreview(f,source);await applyImport(f,p,[importChoice(0,'create')]);const report=(await f.request('/api/record-imports/'+p.sourceHash)).data;assert.equal(report.source.settings,undefined);assert.equal(report.source.careerBuddy,undefined);assert.equal((await f.request('/api/buddy/settings')).data.enabled,false);
});
test('historical pending previews survive restart, replaced previews conflict and linked task edits require a fresh review',async t=>{
 const f=await fixture(t);await f.setup();const p=await importPreview(f);await f.restart();await f.login();assert.equal((await applyImport(f,p,[importChoice(0,'create')])).status,200);const source=historicalSource();source.opportunities[0].id='a-new-source';let old=await importPreview(f,source),current=await importPreview(f,source);assert.equal((await applyImport(f,old,[importChoice(0,'create')])).status,409);const expiry=JSON.parse(f.app.db.prepare('SELECT data FROM config WHERE key=?').get('recordImport:'+current.sourceHash).data);expiry.createdAt='2000-01-01T00:00:00Z';f.app.db.prepare('UPDATE config SET data=? WHERE key=?').run(JSON.stringify(expiry),'recordImport:'+current.sourceHash);assert.equal((await applyImport(f,current,[importChoice(0,'create')])).status,409);current=await importPreview(f,source);await f.request('/api/tasks',{method:'POST',body:{title:'Fictional concurrent task'}});assert.equal((await applyImport(f,current,[importChoice(0,'create')])).status,409);current=await importPreview(f,source);assert.equal((await applyImport(f,current,[importChoice(0,'create')])).status,200);const b=await f.request('/api/backup',{method:'POST',body:{}});assert.equal(b.status,200);const snapshot=new DatabaseSync(join(f.options.filesDir,'backups',b.data.name,'board.sqlite'));try{const saved=JSON.parse(snapshot.prepare('SELECT data FROM config WHERE key=?').get('recordImport:'+current.sourceHash).data);assert.equal(saved.receipt.created,1);assert.equal(saved.archive.opportunities[0].id,'a-new-source');assert.equal(snapshot.prepare('SELECT COUNT(*) AS n FROM records').get().n,2);}finally{snapshot.close();}
});

test('AI activity and rates are authenticated, filterable and exportable with immutable per-request estimates',async t=>{
 let calls=0;const f=await fixture(t,{buddyFetch:async()=>{calls++;return Response.json({usage:{prompt_tokens:40,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:JSON.stringify(buddyReply())}}]});}});await f.setup();await enableBuddy(f);
 assert.equal((await f.request('/api/ai-activity',{auth:false})).status,401);assert.equal((await f.request('/api/ai-activity/rates',{auth:false})).status,401);let rates=(await f.request('/api/ai-activity/rates')).data;const rule={provider:'custom',model:'fixture-model',currency:'USD',inputPerMillion:1,outputPerMillion:2};let saved=await f.request('/api/ai-activity/rates',{method:'PATCH',body:{revision:rates.revision,rates:[rule]}});assert.equal(saved.status,200);assert.equal(calls,0);assert.equal((await f.request('/api/ai-activity/rates',{method:'PATCH',body:{revision:rates.revision,rates:[rule]}})).status,409);rates=saved.data;
 for(const bad of [{...rule,provider:'codex'},{...rule,inputPerMillion:-1},{...rule,currency:'NOT A CURRENCY'}])assert.equal((await f.request('/api/ai-activity/rates',{method:'PATCH',body:{revision:rates.revision,rates:[bad]}})).status,400);
 const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;assert.equal((await buddyChat(f,op.id,{requestId:'activity-chat-1'})).status,200);let r=(await f.request('/api/ai-activity')).data;assert.equal(r.total,1);assert.equal(r.items[0].kind,'opportunity-chat');assert.equal(r.items[0].promptVersion,'opportunity-chat-2026-10-30-v1');assert.equal(r.items[0].usage.inputTokens,40);assert.equal(r.totals.completeUsageRequests,1);assert.equal(r.totals.estimatedRequests,1);assert.equal(r.items[0].cost.amount,.00006);assert.equal(JSON.stringify(r).includes('private-buddy-test-key'),false);assert.equal(JSON.stringify(r).includes('Had the second interview'),false);
 saved=await f.request('/api/ai-activity/rates',{method:'PATCH',body:{revision:rates.revision,rates:[{...rule,currency:'GBP',inputPerMillion:10,outputPerMillion:20}]}});assert.equal(saved.status,200);await buddyChat(f,op.id,{requestId:'activity-chat-2'});r=(await f.request('/api/ai-activity')).data;assert.equal(r.totals.costs.USD,.00006);assert.equal(r.totals.costs.GBP,.0006);assert.equal((await f.request('/api/ai-activity?kind=summary')).data.total,0);assert.equal((await f.request('/api/ai-activity?status=completed&provider=custom&limit=1')).data.items.length,1);assert.equal((await f.request('/api/ai-activity?offset=1&limit=1')).data.items.length,1);assert.equal((await f.request('/api/ai-activity?limit=101')).status,400);assert.equal((await f.request('/api/ai-activity?status=imaginary')).status,400);assert.equal((await f.request('/api/export')).data.aiActivity.length,2);await f.restart();await f.login();assert.equal((await f.request('/api/ai-activity')).data.total,2);assert.equal(calls,2);
});
test('activity retains failed and retried attempts without replaying prompts when listed or when rates change',async t=>{
 let calls=0,fail=true;const f=await fixture(t,{buddyFetch:async()=>{calls++;return fail?Response.json({error:{message:'PRIVATE PROVIDER BODY'}},{status:429}):buddyResponse(buddyReply());}});await f.setup();await enableBuddy(f);const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;assert.equal((await buddyChat(f,op.id,{requestId:'activity-retry'})).status,502);let r=(await f.request('/api/ai-activity?status=attention')).data;assert.equal(r.total,1);assert.equal(r.items[0].usage,null);assert.equal(r.items[0].cost,null);fail=false;assert.equal((await buddyChat(f,op.id,{requestId:'activity-retry'})).status,200);r=(await f.request('/api/ai-activity')).data;assert.equal(r.total,2);assert.equal(r.totals.attention,1);assert.equal(r.totals.completed,1);assert.equal(r.items.find(v=>v.stage==='completed').attempt,2);assert.equal(calls,2);assert.equal(JSON.stringify(r).includes('PRIVATE PROVIDER BODY'),false);
});
test('active AI activity can cancel a request without retrying or publishing late results',async t=>{
 let entered,release,calls=0;const started=new Promise(r=>entered=r);const f=await fixture(t,{buddyFetch:async()=>{calls++;entered();await new Promise(r=>release=r);return buddyResponse(buddyReply());}});await f.setup();await enableBuddy(f);const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;const pending=buddyChat(f,op.id,{requestId:'activity-cancel'});await started;const active=(await f.request('/api/ai-activity?status=active')).data;assert.equal(active.total,1);assert.equal(active.items[0].finishedAt,null);assert.equal((await f.request('/api/buddy/requests/activity-cancel',{method:'POST',body:{cancel:true}})).status,200);release();assert.equal((await pending).status,499);assert.equal((await f.request('/api/ai-activity?status=cancelled')).data.total,1);assert.equal(calls,1);assert.equal((await f.request('/api/opportunities/'+op.id+'/buddy')).data.messages.length,0);
});
test('feedback reviews and local intake join activity without leaking text; usage snapshots survive full backups',async t=>{
 const f=await fixture(t,{buddyFetch:async()=>Response.json({usage:{prompt_tokens:30,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:JSON.stringify(buddyReply({reply:JSON.stringify({summary:'Fictional suggestion',priority:'low',improvements:[],questions:[]})}))}}]})});await f.setup();await enableBuddy(f);const item=(await f.request('/api/feedback',{method:'POST',body:{text:'PRIVATE FICTIONAL FEEDBACK TEXT',page:'activity',requestId:'activity-feedback'}})).data.item;assert.equal((await f.request('/api/feedback/'+item.id+'/review',{method:'POST',body:{confirm:true}})).status,200);await f.request('/api/job-intake',{method:'POST',body:{kind:'text',text:'Fictional job opportunity with sufficient readable content for local extraction.',useAI:false,ocr:false,requestId:'activity-local'}});const report=(await f.request('/api/ai-activity')).data;assert.equal(report.items.find(r=>r.kind==='feedback').usage.inputTokens,30);assert.equal(report.items.find(r=>r.kind==='local-intake').usage,null);assert.equal(JSON.stringify(report).includes('PRIVATE FICTIONAL'),false);const b=await f.request('/api/backup',{method:'POST',body:{}});assert.equal(b.status,200);const snapshot=new DatabaseSync(join(f.options.filesDir,'backups',b.data.name,'board.sqlite'));try{const logs=snapshot.prepare('SELECT data FROM buddy_requests').all().map(r=>JSON.parse(r.data));assert.equal(logs.length,2);assert.equal(logs.find(r=>r.kind==='feedback').usage.outputTokens,10);}finally{snapshot.close();}
});
