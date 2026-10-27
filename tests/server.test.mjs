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
