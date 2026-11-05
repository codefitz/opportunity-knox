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
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/app.mjs";
import { layoutDraft } from "../server/document-layout.mjs";

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
    { method = "GET", body, auth = true, headers = {}, binary = false, signal } = {},
  ) {
    const response = await fetch(base + path, {
      signal,
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
  const goneCold = await f.request(`/api/opportunities/${id}`, {
    method: "PATCH",
    body: { revision: closed.data.revision, outcome: "gone-cold" },
  });
  assert.equal(goneCold.data.stage, "outcome");
  assert.equal(goneCold.data.outcome, "gone-cold");
  const reopened = await f.request(`/api/opportunities/${id}`, {
    method: "PATCH",
    body: { revision: goneCold.data.revision, stage: "review" },
  });
  assert.equal(reopened.data.outcome, "");
});

test("opportunities allow blanks in almost every field and non-date deadlines like LNAA gracefully succeed without error", async (t) => {
  const f = await fixture(t);
  await f.setup();
  const created = await f.request("/api/opportunities", {
    method: "POST",
    body: {
      company: "LNAA",
      role: "Flight Paramedic",
      deadline: "LNAA",
      nextActionDate: "Rolling",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.company, "LNAA");
  assert.equal(created.data.role, "Flight Paramedic");
  assert.equal(created.data.deadline, "");
  assert.ok(created.data.nextActionDate);
  assert.ok(created.data.description.includes("Deadline: LNAA"));
  assert.ok(created.data.description.includes("Next action date: Rolling"));

  // Check patch with blank deadline
  const patched = await f.request(`/api/opportunities/${created.data.id}`, {
    method: "PATCH",
    body: {
      revision: created.data.revision,
      deadline: "",
    },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.deadline, "");
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
  for (const theme of [
    "espresso-cream",
    "harbour",
    "ink-paper",
    "moonlight",
    "alpine-mint",
    "sandstone-slate",
    "nordic-frost",
    "solar-dark",
    "emerald-dusk",
    "velvet-night",
    "cyber-porcelain",
    "rose-noir",
  ]) {
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
test('automatic application tailoring chooses a source CV, respects visual layout choices and saves separate drafts',async t=>{
 let sourceId, calls=0, contexts=[],selectionIds=[];
 const f=await fixture(t,{buddyFetch:async(_,opts)=>{
  calls++;const payload=JSON.parse(JSON.parse(opts.body).messages.at(-1).content);
  if(payload.candidates){selectionIds=payload.candidates.map(d=>d.id);return buddyResponse({sourceCvId:sourceId,layout:'executive',reason:'Relevant engineering CV.'});}
  contexts.push(payload.context);
  const kind=payload.request.startsWith('Write a')?'cover':'cv';
  return buddyResponse(buddyReply({reply:'Review factual accuracy.',sourceIds:[sourceId],draft:{kind,title:'Fictional tailored '+kind,content:'# Alex Example\n\n## Experience\nEngineer | Fictional Systems | 2020–2026\n- Built Python reports.'}}));
 }});await f.setup();await enableBuddy(f);
 const op=(await f.request('/api/opportunities',{method:'POST',body:{...opportunity,role:'Engineering lead'}})).data;
 const original='Alex Example\nEngineer | Fictional Systems | 2020–2026\nBuilt Python reports.';
 const source=(await f.request('/api/documents',{method:'POST',body:{name:'Fictional Engineering CV.txt',kind:'cv',contentBase64:Buffer.from(original).toString('base64')}})).data;sourceId=source.id;
 await f.request('/api/documents',{method:'POST',body:{name:'Fictional Product CV.txt',kind:'cv',contentBase64:Buffer.from('Fictional product management CV.').toString('base64')}});
 const base='/api/opportunities/'+op.id+'/buddy';
 const body={action:'cv',message:'Tailor my CV.',autoTailor:true,templateLayout:'compact',documentIds:[],includeOtherOpportunities:false,requestId:'fictional-auto-cv'};
 const result=await f.request(base+'/chat',{method:'POST',body});assert.equal(result.status,200);assert.equal(calls,2);
 const reply=result.data.messages.at(-1);assert.equal(reply.tailoring.sourceCvId,sourceId);assert.equal(reply.tailoring.layout,'compact');
 assert.equal(contexts[0].sourceCV.text,original);assert.equal(contexts[0].layout,'compact');assert.ok(selectionIds.includes(sourceId));
 const saveBody={title:reply.draft.title,content:reply.draft.content,layout:reply.tailoring.layout};
 const saved=await f.request(base+'/draft/'+reply.id,{method:'POST',body:saveBody});assert.equal(saved.status,200);
 const cv=saved.data.opportunity.documents[0];assert.equal(cv.status,'draft');assert.equal(cv.generation.sourceCvId,sourceId);
 assert.equal((await f.request(source.url,{binary:true})).data.toString(),original);
 assert.equal((await f.request(base+'/draft/'+reply.id,{method:'POST',body:saveBody})).data.opportunity.documents.length,1);
 const covering=await f.request(base+'/chat',{method:'POST',body:{...body,action:'cover',message:'Write a cover letter.',sourceCvId:sourceId,requestId:'fictional-auto-cover'}});
 assert.equal(covering.status,200);assert.equal(calls,3);assert.equal(covering.data.messages.at(-1).draft.kind,'cover');
 const coverReply=covering.data.messages.at(-1);
 const coverSaved=await f.request(base+'/draft/'+coverReply.id,{method:'POST',body:{title:coverReply.draft.title,content:coverReply.draft.content,layout:'compact'}});
 assert.equal(coverSaved.status,200);assert.equal(coverSaved.data.opportunity.documents.at(-1).generation.layout,'letter');
 const before=calls;
 assert.equal((await f.request(base+'/chat',{method:'POST',body:{...body,sourceCvId:cv.id,requestId:'fictional-bad-generated'}})).status,400);assert.equal(calls,before);
 assert.equal((await f.request(base+'/chat',{method:'POST',body:{...body,templateLayout:'unsupported',requestId:'fictional-bad-layout'}})).status,400);
 await f.restart();await f.login();
 const history=(await f.request(base)).data.messages;assert.ok(history.some(m=>m.id===reply.id&&m.tailoring.sourceCvId===sourceId));
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
  mkdirSync(join(existingVaultPath, "OppKnox Inbox", "Wins"), { recursive: true });
  writeFileSync(
    join(existingVaultPath, "OppKnox Inbox", "Wins", "Staff-Promotion-Case.md"),
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

test("document imports infer each file independently, stay unclassified when unclear and start without status", async (t) => {
  const f = await fixture(t); await f.setup();
  const contentBase64 = Buffer.from("Fictional imported document bytes").toString("base64");
  const cases = [
    ["CVs/Fictional_Master_CV.pdf", "cv", "master-cv"],
    ["CVs/Fictional-cover-letter.docx", "cover", "cover-letter"],
    ["Job descriptions/Fictional role.pdf", "jd", "job-description"],
    ["Fictional tailored resume.docx", "cv", "tailored-cv"],
    ["Fictional-CV-template.docx", "other", "template"],
    ["Fictional supporting statement.txt", "other", "supporting-statement"],
    ["Fictional STAR story.md", "other", "star-story"],
    ["Fictional reference.pdf", "reference", "reference"],
    ["Fictional scan.pdf", "other", "other"],
    ["Fictional overview.txt", "other", "other"],
  ];
  for (const [name, kind, category] of cases) {
    const body = { name, contentBase64, importRequestId: "fictional-auto-" + cases.findIndex(c => c[0] === name).toString().padStart(4, "0") };
    const first = await f.request("/api/documents", { method: "POST", body });
    assert.equal(first.status, 201);
    assert.equal(first.data.kind, kind, name); assert.equal(first.data.category, category, name);
    assert.equal(first.data.status, "");
    const retry = await f.request("/api/documents", { method: "POST", body });
    assert.equal(retry.status, 200); assert.equal(retry.data.id, first.data.id);
  }
  const manual = await f.request("/api/documents", { method: "POST", body: { name: "Fictional CV.pdf", contentBase64, kind: "reference", category: "template" } });
  assert.equal(manual.data.kind, "reference"); assert.equal(manual.data.category, "template");
  const byCategory = await f.request("/api/documents", { method: "POST", body: { name: "Fictional scan.pdf", contentBase64, category: "master-cv" } });
  assert.equal(byCategory.data.kind, "cv");
  const approved = await f.request("/api/documents/" + byCategory.data.id, { method: "PATCH", body: { status: "approved", revision: byCategory.data.revision } });
  assert.equal(approved.data.status, "approved");
  const cleared = await f.request("/api/documents/" + byCategory.data.id, { method: "PATCH", body: { status: "", revision: approved.data.revision } });
  assert.equal(cleared.status, 200); assert.equal(cleared.data.status, "");
  await f.restart(); await f.login();
  assert.equal((await f.request("/api/documents")).data.documents.find(d => d.id === byCategory.data.id).status, "");
});

test("Career Hub uploads, indexes and links Google Docs (.gdoc) shortcut files", async (t) => {
  const f = await fixture(t); await f.setup();
  const gdocContent = JSON.stringify({
    doc_id: "fictional-gdoc-123",
    url: "https://docs.google.com/document/d/fictional-gdoc-123/edit",
    email: "test@example.com",
  });
  const contentBase64 = Buffer.from(gdocContent, "utf8").toString("base64");
  const uploaded = await f.request("/api/documents", {
    method: "POST",
    body: {
      name: "Career/Fictional Master CV.gdoc",
      contentBase64,
    },
  });
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.data.kind, "cv");
  assert.equal(uploaded.data.category, "master-cv");
  assert.ok(uploaded.data.tags.includes("Google Doc"));
  assert.equal(uploaded.data.externalSource?.provider, "google-docs");
  assert.equal(uploaded.data.externalSource?.id, "fictional-gdoc-123");
  assert.equal(uploaded.data.originalUrl, "https://docs.google.com/document/d/fictional-gdoc-123/edit");

  const prepare = await f.request("/api/buddy/index", {
    method: "POST",
    body: { documentIds: [uploaded.data.id], force: true },
  });
  assert.equal(prepare.status, 200);
  const docSummary = prepare.data.documents.find((d) => d.id === uploaded.data.id);
  assert.equal(docSummary.extraction.status, "ready");
  assert.ok(docSummary.extraction.chunkCount > 0);

  const storedRow = JSON.parse(
    f.app.db.prepare("SELECT data FROM document_text WHERE id=?").get(uploaded.data.id).data,
  );
  assert.match(storedRow.text, /Google Doc: Fictional Master CV/);
  assert.match(storedRow.text, /fictional-gdoc-123/);

  // Upload and index Google Sheet (.gsheet)
  const gsheetUploaded = await f.request("/api/documents", {
    method: "POST",
    body: {
      name: "Financials/Career Budget.gsheet",
      contentBase64: Buffer.from(
        JSON.stringify({ doc_id: "sheet-abc", url: "https://docs.google.com/spreadsheets/d/sheet-abc/edit" }),
      ).toString("base64"),
    },
  });
  assert.equal(gsheetUploaded.status, 201);
  assert.ok(gsheetUploaded.data.tags.includes("Google Sheet"));
  assert.equal(gsheetUploaded.data.originalUrl, "https://docs.google.com/spreadsheets/d/sheet-abc/edit");

  // Upload and index Google Slides (.gslides)
  const gslidesUploaded = await f.request("/api/documents", {
    method: "POST",
    body: {
      name: "Presentations/Portfolio Deck.gslides",
      contentBase64: Buffer.from(
        JSON.stringify({ doc_id: "slides-xyz", url: "https://docs.google.com/presentation/d/slides-xyz/edit" }),
      ).toString("base64"),
    },
  });
  assert.equal(gslidesUploaded.status, 201);
  assert.ok(gslidesUploaded.data.tags.includes("Google Slides"));
  assert.equal(gslidesUploaded.data.originalUrl, "https://docs.google.com/presentation/d/slides-xyz/edit");

  const prepareAll = await f.request("/api/buddy/index", {
    method: "POST",
    body: { documentIds: [gsheetUploaded.data.id, gslidesUploaded.data.id], force: true },
  });
  assert.equal(prepareAll.status, 200);
  assert.equal(prepareAll.data.documents.find((d) => d.id === gsheetUploaded.data.id).extraction.status, "ready");
  assert.equal(prepareAll.data.documents.find((d) => d.id === gslidesUploaded.data.id).extraction.status, "ready");
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

test('external embedding providers and Qdrant vector backend index and retrieve selected sources without exposing vector keys or raw text',async t=>{
 let context,selectedId,hiddenId,collectionSize=null;
 const points=new Map();
 const f=await fixture(t,{
  buddyFetch:async(url,opts={})=>{
   const method=opts.method||'GET';
   if(url==='http://localhost:11434/api/embed'){
    const body=JSON.parse(opts.body);
    const inputs=Array.isArray(body.input)?body.input:[body.input];
    return new Response(JSON.stringify({model:body.model,embeddings:inputs.map(text=>text.includes('leadership')||text.includes('coached')?[3,4,...Array(14).fill(0)]:[0,1,...Array(14).fill(0)])}),{status:200,headers:{'Content-Type':'application/json'}});
   }
   if(url==='http://localhost:6333/collections'&&method==='GET'){
    assert.equal(opts.headers?.['api-key'],'fictional-qdrant-secret');
    return new Response(JSON.stringify({result:{collections:[]}}),{status:200,headers:{'Content-Type':'application/json'}});
   }
   if(url==='http://localhost:6333/collections/fictional_vectors'&&method==='GET'){
    assert.equal(opts.headers?.['api-key'],'fictional-qdrant-secret');
    if(!collectionSize)return new Response(JSON.stringify({status:{error:'Not found'}}),{status:404,headers:{'Content-Type':'application/json'}});
    return new Response(JSON.stringify({result:{config:{params:{vectors:{size:collectionSize}}}}}),{status:200,headers:{'Content-Type':'application/json'}});
   }
   if(url==='http://localhost:6333/collections/fictional_vectors'&&method==='PUT'){
    collectionSize=JSON.parse(opts.body).vectors.size;
    return new Response(JSON.stringify({result:true}),{status:200,headers:{'Content-Type':'application/json'}});
   }
   if(url==='http://localhost:6333/collections/fictional_vectors/points/delete?wait=true'&&method==='POST'){
    return new Response(JSON.stringify({result:{status:'acknowledged'}}),{status:200,headers:{'Content-Type':'application/json'}});
   }
   if(url==='http://localhost:6333/collections/fictional_vectors/points?wait=true'&&method==='PUT'){
    for(const pt of JSON.parse(opts.body).points){
     assert.equal('text' in pt.payload,false);
     points.set(pt.id,pt);
    }
    return new Response(JSON.stringify({result:{status:'completed'}}),{status:200,headers:{'Content-Type':'application/json'}});
   }
   if(url==='http://localhost:6333/collections/fictional_vectors/points/search'&&method==='POST'){
    const qVec=JSON.parse(opts.body).vector;
    const res=[...points.values()].map(pt=>({id:pt.id,score:pt.vector.reduce((s,n,i)=>s+n*qVec[i],0),payload:pt.payload}));
    return new Response(JSON.stringify({result:res}),{status:200,headers:{'Content-Type':'application/json'}});
   }
   context=JSON.parse(JSON.parse(opts.body).messages.at(-1).content);
   return buddyResponse(buddyReply({reply:'Fictional external hybrid coaching.',sourceIds:[selectedId,hiddenId]}));
  }
 });
 await f.setup();await enableBuddy(f);
 const initial=(await f.request('/api/buddy/embedding-settings')).data;
 const configured=await f.request('/api/buddy/embedding-settings',{
  method:'PATCH',
  body:{
   revision:initial.revision,
   provider:'ollama',
   baseUrl:'http://localhost:11434',
   model:'fictional-embed:latest',
   vectorBackend:'qdrant',
   vectorUrl:'http://localhost:6333',
   vectorCollection:'fictional_vectors',
   vectorApiKey:'fictional-qdrant-secret'
  }
 });
 assert.equal(configured.status,200);
 assert.equal(configured.data.vectorBackend,'qdrant');
 assert.equal(configured.data.hasVectorKey,true);
 assert.equal(configured.data.vectorApiKey,undefined);
 assert.equal(JSON.stringify(configured.data).includes('fictional-qdrant-secret'),false);

 const tested=await f.request('/api/buddy/embedding-test',{method:'POST',body:{revision:configured.data.revision,provider:'ollama',baseUrl:'http://localhost:11434',model:'fictional-embed:latest',vectorBackend:'qdrant',vectorUrl:'http://localhost:6333',vectorCollection:'fictional_vectors'}});
 assert.equal(tested.status,200);
 assert.equal(tested.data.dimensions,16);
 assert.equal(tested.data.vectorBackend,'qdrant');
 assert.equal(tested.data.vectorStoreOk,true);

 const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;
 async function upload(name,text){return (await f.request('/api/documents',{method:'POST',body:{name,kind:'cv',contentBase64:Buffer.from(text).toString('base64')}})).data;}
 const source=await upload('Fictional external CV.txt','Gardening and baking. '.repeat(2100)+'I coached colleagues and mentored engineers.');selectedId=source.id;
 const hidden=await upload('Fictional external secret.txt','Unselected external secret leadership evidence.');hiddenId=hidden.id;

 const started=await f.request('/api/buddy/vector-index',{method:'POST',body:{documentIds:[source.id,hidden.id]}});
 assert.equal(started.status,200);
 for(let i=0;i<200;i++){const state=(await f.request('/api/buddy/vector-index')).data;if(state.job.status==='completed')break;await new Promise(r=>setTimeout(r,5));}
 const idxState=(await f.request('/api/buddy/vector-index')).data;
 assert.equal(idxState.provider,'ollama');
 assert.equal(idxState.vectorBackend,'qdrant');
 assert.equal(idxState.dimensions,16);
 assert.ok(points.size>=2);

 const chat=await buddyChat(f,op.id,{message:'What leadership evidence can I highlight?',documentIds:[source.id]});
 assert.equal(chat.status,200);
 const answer=chat.data.messages.at(-1);
 assert.equal(answer.context.retrieval.mode,'hybrid');
 assert.equal(answer.context.retrieval.indexedSources,1);
 assert.ok(context.context.excerpts.some(c=>c.text.includes('coached')));
 assert.equal(context.context.excerpts.some(c=>c.sourceId===hidden.id),false);
 assert.equal(answer.sourceIds.includes(hidden.id),false);
 const exported=await f.request('/api/export');
 assert.equal(JSON.stringify(exported.data).includes('fictional-qdrant-secret'),false);
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

test('manual fit assessments fall back to the chat model with automatic fit disabled',async t=>{
 let op,model;
 const f=await fixture(t,{buddyFetch:async(_,opts)=>{
  model=JSON.parse(opts.body).model;
  return buddyResponse(buddyReply({reply:JSON.stringify({recommendation:'consider',summary:'Fictional location fits.',criteria:[{id:'location',status:'met',reason:'London role.',sourceIds:[op.id],questions:[]}]})}));
 }});await f.setup();await enableBuddy(f);
 const workflow=(await f.request('/api/ai-workflow')).data;
 await f.request('/api/ai-workflow',{method:'PATCH',body:{...workflow,autoFit:false,autoTags:false}});
 await f.request('/api/buddy/fit-criteria',{method:'PATCH',body:{revision:1,items:[{id:'location',description:'London role',priority:'preferred'}]}});
 op=(await f.request('/api/opportunities',{method:'POST',body:{...opportunity,location:'London'}})).data;
 const route='/api/buddy/decisions/'+op.id;
 assert.equal((await f.request(route)).data.settings.enabled,true);
 const result=await f.request(route,{method:'POST',body:{revision:op.revision,criteriaRevision:2,documentIds:[]}});
 assert.equal(result.status,200);assert.equal(result.data.assessment.modelSource,'careerBuddy');
 assert.equal(model,(await f.request('/api/buddy/settings')).data.model);
 await f.restart();await f.login();
 assert.equal((await f.request(route)).data.assessments[0].stale,false);
 const chat=(await f.request('/api/buddy/settings')).data;
 await f.request('/api/buddy/settings',{method:'PATCH',body:{revision:chat.revision,model:'fictional-changed-model'}});
 assert.equal((await f.request(route)).data.assessments[0].stale,true);
});

test('one-click fit review saves evidence, review and Fit review stage atomically and persists across restart',async t=>{
 let op,context,calls=0,invalid=false;
 const f=await fixture(t,{buddyFetch:async(_,opts)=>{
  context=JSON.parse(JSON.parse(opts.body).messages.at(-1).content);
  calls++;
  return buddyResponse({strengths:'Relevant fictional engineering experience.',gaps:'Leadership experience needs clarification.',sourceIds:invalid?['unavailable-source']:[context.excerpts[0].sourceId],searchQuery:calls===1?'leadership delivery':''});
 }});await f.setup();await enableBuddy(f);
 const workflow=(await f.request('/api/ai-workflow')).data;
 await f.request('/api/ai-workflow',{method:'PATCH',body:{...workflow,autoFit:false,autoTags:false}});
 const doc=(await f.request('/api/documents',{method:'POST',body:{name:'Fictional engineering CV.txt',contentBase64:Buffer.from('Fictional engineering experience and delivery.').toString('base64')}})).data;
 op=(await f.request('/api/opportunities',{method:'POST',body:{...opportunity,role:'Engineering lead'}})).data;
 const route='/api/buddy/decisions/'+op.id;
 const result=await f.request(route,{method:'POST',body:{revision:op.revision,generalFit:true,documentIds:[]}});
 assert.equal(result.status,200);assert.equal(calls,2);assert.ok(context.excerpts.some(c=>c.sourceId===doc.id));
 assert.equal(result.data.reviewDraft.strengths,'Relevant fictional engineering experience.');
 assert.equal(result.data.reviewDraft.gaps,'Leadership experience needs clarification.');
 assert.ok(Number.isFinite(Date.parse(result.data.reviewDraft.effectiveAt)));
 const initial=op;
 op=(await f.request('/api/opportunities/'+op.id)).data;
 assert.equal(op.revision,initial.revision+1);
 assert.equal(op.stage,'review');assert.equal(op.outcome,'');
 assert.equal(op.review.strengths,result.data.reviewDraft.strengths);
 assert.equal(op.currentStageEventId,op.events.at(-1).id);
 assert.equal(op.stageEnteredAt,result.data.reviewDraft.effectiveAt);
 assert.equal(op.events.at(-1).title,'Automated fit assessment');
 assert.equal(result.data.opportunity.revision,op.revision);
 assert.equal(result.data.assessment.stale,false);
 assert.equal((await f.request(route,{method:'POST',body:{revision:initial.revision,generalFit:true,documentIds:[]}})).status,409);
 invalid=true;
 assert.equal((await f.request(route,{method:'POST',body:{revision:op.revision,generalFit:true,documentIds:[]}})).status,502);
 assert.equal((await f.request(route)).data.assessments.length,1);
 assert.deepEqual((await f.request('/api/opportunities/'+op.id)).data,op);
 await f.restart();await f.login();
 assert.equal((await f.request('/api/opportunities/'+op.id)).data.review.gaps,result.data.reviewDraft.gaps);
 assert.equal((await f.request(route)).data.assessments[0].stale,false);
 assert.equal((await f.request('/api/opportunities/'+op.id)).data.stage,'review');
 invalid=false;
 const repeat=await f.request(route,{method:'POST',body:{revision:op.revision,generalFit:true,documentIds:[]}});
 assert.equal(repeat.status,200);
 assert.equal(repeat.data.opportunity.review.history.length,1);
 assert.equal(repeat.data.opportunity.review.history[0].strengths,op.review.strengths);
 assert.equal(repeat.data.opportunity.currentStageEventId,op.currentStageEventId);
 assert.equal(repeat.data.opportunity.stageEnteredAt,op.stageEnteredAt);
 const closed=await f.request('/api/opportunities/'+op.id,{method:'PATCH',body:{revision:repeat.data.opportunity.revision,stage:'outcome',outcome:'rejected'}});
 assert.equal(closed.status,200);
 const closedReview=await f.request(route,{method:'POST',body:{revision:closed.data.revision,generalFit:true,documentIds:[]}});
 assert.equal(closedReview.status,200);
 assert.equal(closedReview.data.opportunity.stage,'outcome');
 assert.equal(closedReview.data.opportunity.outcome,'rejected');
 assert.equal(closedReview.data.opportunity.currentStageEventId,closed.data.currentStageEventId);
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
 output=envelope({opportunity:{company:'Fictional recruiter employer',role:'Fictional analyst',description:'Pasted fictional recruiter notes.',location:'',salary:'',url:'',deadline:'LNAA'},tasks:[{title:'Clarify salary',dueDate:'LNAA',notes:'Ask recruiter.'}]});
 const intake=await send('recruiter');assert.equal(intake.status,200);const proposed=intake.data.messages.at(-1);assert.equal((await f.request('/api/board')).data.opportunities.length,1);
 const created=await f.request(route+'/'+proposed.id+'/apply',{method:'POST',body:{confirm:true}});assert.equal(created.status,200);assert.equal((await f.request('/api/tasks')).data.tasks[0].opportunityId,created.data.result.opportunityId);
 const createdOp=(await f.request('/api/opportunities/'+created.data.result.opportunityId)).data;
 assert.equal(createdOp.deadline,'');
 assert.ok(createdOp.description.includes('Deadline: LNAA'));
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

test('previous CV gallery thumbnails are private, cached, invalidated and reusable for new drafts',async t=>{
 const {layoutDraft}=await import('../server/document-layout.mjs');let renders=0,sourceId;
 const f=await fixture(t,{documentConvert:async(_,folder)=>{renders++;writeFileSync(join(folder,'page-1.png'),Buffer.from('fictional-png'));return {pages:1,pdf:Buffer.from('fictional-pdf')};},buddyFetch:async(_,opts)=>{
  const payload=JSON.parse(JSON.parse(opts.body).messages.at(-1).content);
  if(payload.slots)return buddyResponse({replacements:payload.slots.map((slot,i)=>({id:slot.id,text:i===0?'New Candidate':'Verified new content.'}))});
  if(payload.candidates)return buddyResponse({sourceCvId,layout:'classic',reason:'Fictional source.'});
  return buddyResponse(buddyReply({reply:'Review this draft.',sourceIds:[sourceId],draft:{kind:'cv',title:'New CV',content:'# New Candidate\n\n## Experience\nVerified new content.'}}));
 }});await f.setup();await enableBuddy(f);
 const source=(await f.request('/api/documents',{method:'POST',body:{name:'Fictional CV.txt',kind:'cv',contentBase64:Buffer.from('New Candidate. Verified new content.').toString('base64')}})).data;sourceId=source.id;
 const bytes=await layoutDraft('Previous CV','# Prior Candidate\n\nOld private content.','executive');
 const style=(await f.request('/api/documents',{method:'POST',body:{name:'Previous CV.docx',kind:'cv',contentBase64:bytes.toString('base64')}})).data;
 const tpl=(await f.request('/api/documents',{method:'POST',body:{name:'CV template.docx',kind:'cv',category:'template',contentBase64:bytes.toString('base64')}})).data;
 const gallery='/api/document-studio/cv-styles';
 assert.equal((await f.request(gallery,{auth:false})).status,401);
 const galleryRes=(await f.request(gallery)).data;
 const listing=galleryRes.documents;assert.deepEqual(listing.map(d=>d.id),[style.id]);
 assert.deepEqual(galleryRes.templates.map(d=>d.id),[tpl.id]);
 const thumb=listing[0].thumbnailUrl;
 assert.equal((await f.request(thumb,{auth:false})).status,401);
 assert.equal((await f.request(thumb,{binary:true})).data.toString(),'fictional-png');
 await f.request(thumb);assert.equal(renders,1);
 let updated=(await f.request('/api/documents/'+style.id,{method:'PATCH',body:{revision:style.revision,notes:'Changed metadata'}})).data;
 assert.equal((await f.request(thumb)).status,200);assert.equal(renders,2);
 const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;
 const base='/api/opportunities/'+op.id+'/buddy';
 const body={action:'cv',message:'Tailor CV.',autoTailor:true,templateLayout:'classic',sourceCvId:source.id,styleDocumentId:style.id,styleDocumentRevision:updated.revision,documentIds:[],includeOtherOpportunities:false,requestId:'fictional-previous-style'};
 const draft=await f.request(base+'/chat',{method:'POST',body});assert.equal(draft.status,200);
 const reply=draft.data.messages.at(-1);assert.equal(reply.tailoring.styleDocumentId,style.id);
 const save={title:reply.draft.title,content:reply.draft.content};
 const saved=await f.request(base+'/draft/'+reply.id,{method:'POST',body:save});assert.equal(saved.status,200);
 const doc=saved.data.opportunity.documents.at(-1);assert.equal(doc.generation.layout,'previous');assert.equal(doc.generation.styleDocumentId,style.id);
 const zip=await (await import('jszip')).default.loadAsync((await f.request(doc.url,{binary:true})).data);
 const xml=await zip.file('word/document.xml').async('string');assert.match(xml,/Verified new content/);assert.doesNotMatch(xml,/Prior Candidate|Old private/);
 await f.request('/api/documents/'+style.id,{method:'PATCH',body:{revision:updated.revision,notes:'Style changed again'}});
 assert.equal((await f.request(base+'/draft/'+reply.id,{method:'POST',body:save})).status,409);
 assert.equal((await f.request(base+'/chat',{method:'POST',body:{...body,requestId:'fictional-stale-style'}})).status,409);
 assert.deepEqual((await f.request(style.url,{binary:true})).data,bytes);
 const manualDraft = await f.request(base+'/chat',{method:'POST',body:{action:'cv',message:'Direct copy without AI.',autoTailor:true,passToAi:false,templateLayout:'classic',sourceCvId:source.id,documentIds:[],includeOtherOpportunities:false,requestId:'fictional-pass-no-ai'}});
 assert.equal(manualDraft.status,200);
 const manualReply = manualDraft.data.messages.at(-1);
 assert.match(manualReply.content,/Missing from Experience \(JD Gaps\)/);
 assert.equal(manualReply.draft.kind,'cv');
 const tplDraft = await f.request(base+'/chat',{method:'POST',body:{...body,styleDocumentId:tpl.id,styleDocumentRevision:tpl.revision,requestId:'fictional-template-style'}});
 assert.equal(tplDraft.status,200);
 const tplReply = tplDraft.data.messages.at(-1);
 assert.equal(tplReply.tailoring.styleDocumentId,tpl.id);
});

test('PDF and connected Google CV styles are selectable and applied to separate Word drafts',async t=>{
 const {layoutDraft}=await import('../server/document-layout.mjs');
 let googleWord=await layoutDraft('Google reference','# Reference Person\n\nPrivate old text.','executive');
 const profile={body:{font:'Liberation Serif',size:11,color:'202820'},title:{font:'Liberation Serif',size:24,color:'204080'},heading:{font:'Liberation Serif',size:14,color:'204080'},page:{width:595,height:842,top:40,bottom:36,left:48,right:48},line:14};
 let sourceId;
 const f=await fixture(t,{pdfStyle:async bytes=>{assert.match(bytes.toString(),/^%PDF-/);return profile;},googleFetch:async()=>new Response(googleWord),buddyFetch:async(_,opts)=>{const payload=JSON.parse(JSON.parse(opts.body).messages.at(-1).content);if(payload.slots)return buddyResponse({replacements:payload.slots.map((slot,i)=>({id:slot.id,text:i===0?'New Candidate':'Verified new achievement.'}))});return buddyResponse(buddyReply({reply:'Review layout.',sourceIds:[sourceId],draft:{kind:'cv',title:'New CV',content:'# New Candidate\n\n## Experience\nVerified new achievement.'}}));}});await f.setup();await enableBuddy(f);
 const source=(await f.request('/api/documents',{method:'POST',body:{name:'Source CV.txt',kind:'cv',contentBase64:Buffer.from('New Candidate. Verified new achievement.').toString('base64')}})).data;sourceId=source.id;
 const pdf=(await f.request('/api/documents',{method:'POST',body:{name:'Reference CV.pdf',kind:'cv',contentBase64:Buffer.from('%PDF-fictional-style').toString('base64')}})).data;
 const google=(await f.request('/api/documents',{method:'POST',body:{name:'Google reference CV.gdoc',kind:'cv',contentBase64:Buffer.from(JSON.stringify({doc_id:'fictionalGoogleStyle'})).toString('base64')}})).data;
 const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;
 const base='/api/opportunities/'+op.id+'/buddy';
 const body={action:'cv',message:'Tailor CV.',autoTailor:true,templateLayout:'classic',sourceCvId:source.id,documentIds:[],includeOtherOpportunities:false};
 const draft=await f.request(base+'/chat',{method:'POST',body:{...body,styleDocumentId:pdf.id,styleDocumentRevision:pdf.revision,requestId:'fictional-pdf-style'}});assert.equal(draft.status,200);
 const reply=draft.data.messages.at(-1);assert.equal(reply.tailoring.styleProfile.title.color,'204080');
 const saved=await f.request(base+'/draft/'+reply.id,{method:'POST',body:{title:'New CV',content:reply.draft.content}});assert.equal(saved.status,200);
 const doc=saved.data.opportunity.documents.at(-1);assert.equal(doc.generation.styleMatch,'recreated');assert.equal(doc.generation.styleDocumentId,pdf.id);
 const zip=await (await import('jszip')).default.loadAsync((await f.request(doc.url,{binary:true})).data);assert.match(await zip.file('word/styles.xml').async('string'),/Liberation Serif/);assert.match(await zip.file('word/styles.xml').async('string'),/204080/);
 assert.equal((await f.request(base+'/chat',{method:'POST',body:{...body,styleDocumentId:google.id,styleDocumentRevision:google.revision,requestId:'fictional-google-disconnected'}})).status,400);
 testConfig(f,'googleDocuments',{revision:1,tokens:{access_token:'fictional-access-token',expiresAt:Date.now()+3600000}});
 const g=await f.request(base+'/chat',{method:'POST',body:{...body,styleDocumentId:google.id,styleDocumentRevision:google.revision,requestId:'fictional-google-style'}});assert.equal(g.status,200);
 const gr=g.data.messages.at(-1),savePath=base+'/draft/'+gr.id;
 const gs=await f.request(savePath,{method:'POST',body:{title:'Google styled CV',content:gr.draft.content}});assert.equal(gs.status,200);
 googleWord=await layoutDraft('Changed Google reference','# Reference Person\nNew style.','compact');
 assert.equal((await f.request(savePath,{method:'POST',body:{title:'Changed wording',content:gr.draft.content}})).status,409);
 assert.equal((await f.request(pdf.url,{binary:true})).data.toString(),'%PDF-fictional-style');
});

test('existing PDF and Google shortcut files get private thumbnails and preview-only CV gallery entries',async t=>{
 let pdfRenders=0,exports=0;
 const f=await fixture(t,{documentThumbnail:async(bytes,folder)=>{pdfRenders++;assert.match(bytes.toString(),/^%PDF-/);const thumbnailPath=join(folder,'thumbnail.png');writeFileSync(thumbnailPath,'fictional-thumbnail');return {thumbnailPath};},googleFetch:async url=>{exports++;assert.match(String(url),/fictionalGoogle/);assert.match(String(url),/mimeType=application%2Fpdf/);return new Response('%PDF-fictional-google');}});await f.setup();
 const pdf=(await f.request('/api/documents',{method:'POST',body:{name:'Existing CV.pdf',kind:'cv',contentBase64:Buffer.from('%PDF-fictional-existing').toString('base64')}})).data;
 const google=(await f.request('/api/documents',{method:'POST',body:{name:'Existing CV.gdoc',kind:'cv',contentBase64:Buffer.from(JSON.stringify({doc_id:'fictionalGoogle'})).toString('base64')}})).data;
 const route='/api/document-studio/thumbnails/';
 assert.equal((await f.request(route+pdf.id,{auth:false})).status,401);
 assert.equal((await f.request(route+pdf.id,{binary:true})).data.toString(),'fictional-thumbnail');assert.equal(pdfRenders,1);
 await f.request(route+pdf.id);assert.equal(pdfRenders,1);
 assert.equal((await f.request(route+google.id)).status,400);assert.equal(exports,0);
 testConfig(f,'googleDocuments',{revision:1,tokens:{access_token:'fictional-access-token',expiresAt:Date.now()+3600000}});
 assert.equal((await f.request(route+google.id,{binary:true})).data.toString(),'fictional-thumbnail');assert.equal(exports,1);assert.equal(pdfRenders,2);
 testConfig(f,'googleDocuments',{revision:2,tokens:null});
 assert.equal((await f.request(route+google.id)).status,400);assert.equal(exports,1);
 const gallery=(await f.request('/api/document-studio/cv-styles')).data.documents;
 assert.equal(gallery.length,2);assert.ok(gallery.every(d=>d.reusable===true));assert.ok(gallery.some(d=>d.format==='pdf'));assert.ok(gallery.some(d=>d.format==='gdoc'));
 assert.equal((await f.request(pdf.url,{binary:true})).data.toString(),'%PDF-fictional-existing');
 const text=(await f.request('/api/documents',{method:'POST',body:{name:'Notes.txt',contentBase64:Buffer.from('Fictional notes.').toString('base64')}})).data;
 assert.equal((await f.request(route+text.id)).status,400);
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
 const bytes=Buffer.from('Fictional CV version one.');const doc=(await f.request('/api/documents',{method:'POST',body:{name:'Fictional CV.txt',opportunityId:op.id,contentBase64:bytes.toString('base64')}})).data;assert.equal(doc.status,'');
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
 assert.equal((await f.request('/api/feedback',{auth:false})).status,401);const first=await f.request('/api/feedback',{method:'POST',body});assert.equal(first.status,201);assert.equal(first.data.item.reviewStatus,undefined);assert.equal((await f.request('/api/feedback',{method:'POST',body})).data.item.id,first.data.item.id);
 assert.equal((await f.request('/api/feedback',{method:'POST',body:{...body,text:'Different fictional text'}})).status,409);assert.equal((await f.request('/api/feedback',{method:'POST',body:{...body,page:'https://private.example/?token=secret'}})).status,400);
 const url='/api/feedback/'+first.data.item.id;const updated=await f.request(url,{method:'PATCH',body:{revision:1,status:'planned'}});assert.equal(updated.status,200);assert.equal((await f.request(url,{method:'PATCH',body:{revision:1,status:'done'}})).status,409);
 assert.match(JSON.stringify((await f.request('/api/export')).data.feedback),/Fictional dashboard/);assert.match(JSON.stringify((await f.request('/api/feedback/export')).data),/Fictional dashboard/);
 const backup=await f.request('/api/backup',{method:'POST',body:{}});assert.equal(backup.status,200);const snapshot=new DatabaseSync(join(f.options.filesDir,'backups',backup.data.name,'board.sqlite'));assert.match(snapshot.prepare("SELECT data FROM config WHERE key='feedbackInbox'").get().data,/Fictional dashboard/);snapshot.close();
 const interrupted=JSON.parse(f.app.db.prepare("SELECT data FROM config WHERE key='feedbackInbox'").get().data);interrupted.items[0].reviewStatus='running';f.app.db.prepare("UPDATE config SET data=? WHERE key='feedbackInbox'").run(JSON.stringify(interrupted));
 await f.restart();await f.login();assert.equal((await f.request('/api/feedback')).data.items[0].status,'planned');assert.equal((await f.request('/api/feedback')).data.items[0].reviewStatus,'interrupted');
});

test('plain feedback does not use AI; legacy review endpoints stay disabled and historical reviews survive',async t=>{
 let calls=0;const f=await fixture(t,{buddyFetch:async()=>{calls++;throw Error('Must not call AI');}});
 await f.setup();await enableBuddy(f);
 const item=(await f.request('/api/feedback',{method:'POST',body:{text:'Private fictional feedback.',page:'settings',requestId:'no-ai-feedback'}})).data.item;
 assert.equal((await f.request('/api/feedback')).data.aiAvailable,undefined);
 for(const action of ['review','cancel'])assert.equal((await f.request('/api/feedback/'+item.id+'/'+action,{method:'POST',body:{confirm:true}})).status,410);
 assert.equal(calls,0);assert.equal((await f.request('/api/ai-activity')).data.items.length,0);
 const inbox=JSON.parse(f.app.db.prepare("SELECT data FROM config WHERE key='feedbackInbox'").get().data);
 inbox.items[0].reviewStatus='completed';inbox.items[0].review={summary:'Historical review retained.',priority:'low',improvements:[],questions:[]};
 f.app.db.prepare("UPDATE config SET data=? WHERE key='feedbackInbox'").run(JSON.stringify(inbox));
 await f.restart();await f.login();const saved=(await f.request('/api/feedback')).data.items[0];
 assert.equal(saved.text,item.text);assert.equal(saved.review.summary,'Historical review retained.');
 assert.match(JSON.stringify((await f.request('/api/feedback/export')).data),/Historical review retained/);
});

test('GitHub issue AI drafting is opt-in, feedback-only, validated and never changes the saved feedback',async t=>{
 let calls=0,supplied,invalid=false;
 const f=await fixture(t,{buddyFetch:async(_,opts)=>{calls++;supplied=JSON.parse(JSON.parse(opts.body).messages.at(-1).content);return buddyResponse(buddyReply({reply:invalid?'not JSON':JSON.stringify({title:'Improve settings spacing',body:'## Problem\nSettings labels need clearer spacing.\n\n## Reproduction\nNot provided.'})}));}});
 await f.setup();
 const item=(await f.request('/api/feedback',{method:'POST',body:{text:'Improve settings labels.',page:'settings',requestId:'github-opt-in'}})).data.item;
 assert.equal(calls,0);
 const path='/api/feedback/'+item.id+'/issue-draft';
 assert.equal((await f.request(path,{method:'POST',auth:false,body:{confirm:true,requestId:'no-auth'}})).status,401);
 assert.equal((await f.request(path,{method:'POST',body:{requestId:'no-confirm'}})).status,400);
 assert.equal((await f.request(path,{method:'POST',body:{confirm:true,requestId:'no-provider'}})).status,400);
 assert.equal(calls,0);await enableBuddy(f);
 await f.request('/api/opportunities',{method:'POST',body:{...opportunity,description:'Private career data must not enter the issue prompt.'}});
 const result=await f.request(path,{method:'POST',body:{confirm:true,requestId:'github-draft'}});
 assert.equal(result.status,200);assert.equal(result.data.draft.title,'Improve settings spacing');
 assert.deepEqual(supplied,{feedback:'Improve settings labels.',page:'settings'});
 assert.deepEqual((await f.request('/api/feedback')).data.items[0],item);
 invalid=true;assert.equal((await f.request(path,{method:'POST',body:{confirm:true,requestId:'bad-github-draft'}})).status,502);
 assert.deepEqual((await f.request('/api/feedback')).data.items[0],item);
 const activity=(await f.request('/api/ai-activity')).data.items;
 assert.ok(activity.some(r=>r.kind==='feedback'&&r.stage==='completed'));
 assert.ok(activity.some(r=>r.kind==='feedback'&&r.stage==='failed'));
});

test('cancelled GitHub issue drafting cannot publish a late result or remove private feedback',async t=>{
 let entered,release;const ready=new Promise(resolve=>entered=resolve);
 const f=await fixture(t,{buddyFetch:async()=>{entered();await new Promise(resolve=>release=resolve);return buddyResponse(buddyReply({reply:JSON.stringify({title:'Late draft',body:'Never publish this result.'})}));}});
 await f.setup();await enableBuddy(f);
 const item=(await f.request('/api/feedback',{method:'POST',body:{text:'Keep this private feedback.',page:'dashboard',requestId:'github-cancel-feedback'}})).data.item;
 const pending=f.request('/api/feedback/'+item.id+'/issue-draft',{method:'POST',body:{confirm:true,requestId:'cancel-github-draft'}});
 await ready;
 assert.equal((await f.request('/api/buddy/requests/cancel-github-draft',{method:'POST',body:{cancel:true}})).status,200);
 release();assert.equal((await pending).status,499);
 assert.deepEqual((await f.request('/api/feedback')).data.items[0],item);
 assert.equal((await f.request('/api/ai-activity?status=cancelled')).data.total,1);
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
 for(const patch of [{decision:'yes'},{effectiveAt:'2026-02-30'},{applyStage:'yes'},{strengths:'x'.repeat(50001)},{outcome:'hired'}])assert.equal((await f.request(path,{method:'PATCH',body:{revision:o.revision,...review,...patch}})).status,400);
 assert.equal((await f.request(`/api/opportunities/${o.id}`)).data.revision,o.revision);
 o=(await f.request(path,{method:'PATCH',body:{revision:o.revision,...review}})).data;
 assert.equal(o.stage,'identification');assert.equal(o.outcome,'');assert.equal(o.currentStageEventId,initial.currentStageEventId);assert.equal(o.stageEnteredAt,initial.stageEnteredAt);assert.equal(o.review.effectiveAt,'2026-10-28');assert.equal(o.events.at(-1).title,'Review decision');assert.equal(o.review.history.length,0);
 assert.equal((await f.request(path,{method:'PATCH',body:{revision:initial.revision,...review}})).status,409);
 o=(await f.request(path,{method:'PATCH',body:{revision:o.revision,...review,reason:'',applyStage:true}})).data;
 assert.equal(o.review.reason,'');
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
test('local intake joins activity without feedback text; snapshots survive full backups',async t=>{
 const f=await fixture(t);await f.setup();
 await f.request('/api/feedback',{method:'POST',body:{text:'PRIVATE FICTIONAL FEEDBACK TEXT',page:'activity',requestId:'activity-feedback'}});
 await f.request('/api/job-intake',{method:'POST',body:{kind:'text',text:'Fictional job opportunity with sufficient readable content for local extraction.',useAI:false,ocr:false,requestId:'activity-local'}});
 const report=(await f.request('/api/ai-activity')).data;
 assert.equal(report.items.find(r=>r.kind==='local-intake').usage,null);
 assert.equal(report.items.some(r=>r.kind==='feedback'),false);
 assert.equal(JSON.stringify(report).includes('PRIVATE FICTIONAL'),false);
 const b=await f.request('/api/backup',{method:'POST',body:{}});assert.equal(b.status,200);
 const snapshot=new DatabaseSync(join(f.options.filesDir,'backups',b.data.name,'board.sqlite'));
 try{const logs=snapshot.prepare('SELECT data FROM buddy_requests').all().map(r=>JSON.parse(r.data));assert.equal(logs.length,1);assert.equal(logs[0].kind,'local-intake');}finally{snapshot.close();}
});

test('universal AI task scheduler manages background tasks, supports cancel/retry, survives restart with interruption, and is included in backups and export',async t=>{
 const f=await fixture(t);await f.setup();
 assert.equal((await f.request('/api/ai-tasks',{auth:false})).status,401);
 assert.equal((await f.request('/api/ai-tasks/unknown',{auth:false})).status,401);

 const initialTasks=(await f.request('/api/ai-tasks')).data;
 assert.equal(initialTasks.total,0);
 assert.equal(initialTasks.totals.total,0);

 // Manually enqueue a test task via scheduler
 const task=f.app.scheduler.enqueue({
   kind:'embedding-index',
   label:'Manual test embedding batch',
   payload:{ids:['opp-1','opp-2']},
 });
 const taskId=task.id;
 assert.ok(taskId);

 let tasks=(await f.request('/api/ai-tasks')).data;
 assert.equal(tasks.total,1);
 assert.equal(tasks.items[0].id,taskId);
 assert.equal(tasks.items[0].status,'queued');
 assert.equal(tasks.items[0].subject,'Manual test embedding batch');
 assert.equal(tasks.items[0].canCancel,true);

 // Single task lookup
 const single=(await f.request('/api/ai-tasks/'+taskId)).data;
 assert.equal(single.id,taskId);
 assert.equal(single.status,'queued');

 // Cancel the task
 const cancelRes=await f.request('/api/ai-tasks/'+taskId+'/cancel',{method:'POST',body:{}});
 assert.equal(cancelRes.status,200);
 assert.equal(cancelRes.data.status,'cancelled');

 tasks=(await f.request('/api/ai-tasks?status=cancelled')).data;
 assert.equal(tasks.total,1);
 assert.equal(tasks.items[0].canRetry,true);

 // Export includes aiTasks safely
 const exp=(await f.request('/api/export')).data;
 assert.ok(Array.isArray(exp.aiTasks));
 assert.equal(exp.aiTasks.length,1);
 assert.equal(exp.aiTasks[0].id,taskId);

 // Full backup includes ai_tasks table
 const b=await f.request('/api/backup',{method:'POST',body:{}});
 assert.equal(b.status,200);
 const snapshot=new DatabaseSync(join(f.options.filesDir,'backups',b.data.name,'board.sqlite'));
 try {
   const backupRows=snapshot.prepare('SELECT id, data FROM ai_tasks').all();
   assert.equal(backupRows.length,1);
   assert.equal(backupRows[0].id,taskId);
 } finally {
   snapshot.close();
 }

 // Enqueue another task and verify restart interruption
 const runningTask=f.app.scheduler.enqueue({
   kind:'opportunity-automation',
   subject:'Test automation job',
   payload:{},
 });
 const runningTaskId=runningTask.id;
 f.app.scheduler.setRunning(runningTaskId);

 await f.restart();
 await f.login();

 const restarted=(await f.request('/api/ai-tasks/'+runningTaskId)).data;
 assert.equal(restarted.status,'interrupted');
 assert.equal(restarted.canRetry,true);
});

test('external assistant task-pack export, preview with conflict check, and apply with audit record and draft saving',async t=>{
 const f=await fixture(t);await f.setup();
 const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;

 // 1. Unauthenticated checks
 assert.equal((await f.request('/api/opportunities/'+op.id+'/assistant-pack',{auth:false})).status,401);
 assert.equal((await f.request('/api/opportunities/'+op.id+'/assistant-pack/preview',{method:'POST',auth:false,body:{}})).status,401);
 assert.equal((await f.request('/api/opportunities/'+op.id+'/assistant-pack/apply',{method:'POST',auth:false,body:{}})).status,401);

 // 2. Export task pack as JSON
 const packRes=await f.request('/api/opportunities/'+op.id+'/assistant-pack?action=cv');
 assert.equal(packRes.status,200);
 assert.equal(packRes.data.manifest.opportunityId,op.id);
 assert.equal(packRes.data.manifest.action,'cv');
 assert.ok(packRes.data.instructions);
 assert.ok(packRes.data.expectedSchema);

 // 3. Export task pack as ZIP
 const zipRes=await f.request('/api/opportunities/'+op.id+'/assistant-pack',{
   method:'POST',
   body:{action:'cover',customInstructions:'Emphasize cloud architecture.'},
 });
 assert.equal(zipRes.status,200);

 // 4. Preview result
 const resultJson=JSON.stringify({
   reply:"I tailored a cover letter draft and updated next action.",
   changes:[
     {kind:"update",field:"nextAction",value:"Review external assistant cover draft",title:"",date:"",notes:"",type:"",status:"",isFinal:false}
   ],
   draft:{
     kind:"cover",
     title:"Cover Letter - "+op.company,
     content:"# Dear Hiring Manager\\n\\nI am pleased to apply..."
   },
   sourceIds:[]
 });

 const previewRes=await f.request('/api/opportunities/'+op.id+'/assistant-pack/preview',{
   method:'POST',
   body:{baseRevision:op.revision,resultText:resultJson}
 });
 assert.equal(previewRes.status,200);
 assert.equal(previewRes.data.valid,true);
 assert.equal(previewRes.data.changes.length,1);
 assert.equal(previewRes.data.draft.kind,'cover');

 // Conflict preview check
 const staleRes=await f.request('/api/opportunities/'+op.id+'/assistant-pack/preview',{
   method:'POST',
   body:{baseRevision:op.revision+99,resultText:resultJson}
 });
 assert.equal(staleRes.status,409);

 // 5. Apply result
 const applyRes=await f.request('/api/opportunities/'+op.id+'/assistant-pack/apply',{
   method:'POST',
   body:{baseRevision:op.revision,resultText:resultJson,confirm:true}
 });
 assert.equal(applyRes.status,200);
 assert.equal(applyRes.data.success,true);
 assert.equal(applyRes.data.opportunity.nextAction,"Review external assistant cover draft");
 assert.ok(applyRes.data.savedDocument);
 assert.equal(applyRes.data.savedDocument.kind,"cover");

 // Verify task was recorded in scheduler
 const tasksRes=await f.request('/api/ai-tasks?kind=external-assistant');
 assert.equal(tasksRes.status,200);
 assert.equal(tasksRes.data.total,1);
 assert.equal(tasksRes.data.items[0].targetId,op.id);
 assert.equal(tasksRes.data.items[0].status,'completed');
});

test('calendar ICS export supports authenticated global, opportunity, and single activity downloads',async t=>{
 const f=await fixture(t);await f.setup();
 const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;

 // Add scheduled interview to opportunity
 const actRes=await f.request('/api/opportunities/'+op.id+'/activities',{
   method:'POST',
   body:{
     title:'Panel Interview',
     kind:'interview',
     type:'video',
     scheduledAt:'2026-11-20T14:00:00.000Z',
     contact:'panel@acme.com',
     notes:'Bring architecture diagram.',
   }
 });
 assert.equal(actRes.status,200);
 const act=actRes.data.activities.find(a=>a.title==='Panel Interview');
 assert.ok(act);

 // 1. Unauthenticated checks
 assert.equal((await f.request('/api/calendar/interviews.ics',{auth:false})).status,401);
 assert.equal((await f.request('/api/opportunities/'+op.id+'/calendar.ics',{auth:false})).status,401);
 assert.equal((await f.request('/api/opportunities/'+op.id+'/activities/'+act.id+'/calendar.ics',{auth:false})).status,401);

 // 2. Global interviews calendar feed
 const globalRes=await f.request('/api/calendar/interviews.ics');
 assert.equal(globalRes.status,200);
 assert.equal(globalRes.response.headers.get('content-type'),'text/calendar; charset=utf-8');
 assert.ok(globalRes.data.includes('BEGIN:VCALENDAR'));
 assert.ok(globalRes.data.includes('Panel Interview'));
 assert.ok(globalRes.data.includes('DTSTART:20261120T140000Z'));
 assert.ok(globalRes.data.includes('panel@acme.com'));

 // 3. Opportunity-scoped calendar
 const oppCalRes=await f.request('/api/opportunities/'+op.id+'/calendar.ics');
 assert.equal(oppCalRes.status,200);
 assert.equal(oppCalRes.response.headers.get('content-type'),'text/calendar; charset=utf-8');
 assert.ok(oppCalRes.data.includes('BEGIN:VCALENDAR'));
 assert.ok(oppCalRes.data.includes('Panel Interview'));

 // 4. Single activity calendar
 const actCalRes=await f.request('/api/opportunities/'+op.id+'/activities/'+act.id+'/calendar.ics');
 assert.equal(actCalRes.status,200);
 assert.equal(actCalRes.response.headers.get('content-type'),'text/calendar; charset=utf-8');
 assert.ok(actCalRes.data.includes('BEGIN:VCALENDAR'));
 assert.ok(actCalRes.data.includes('SUMMARY:[video] Panel Interview'));
 assert.ok(actCalRes.data.includes('END:VCALENDAR'));
});

test('managed folders: saves opportunity documents into 2 subdirectories Company > Role and supports organization migration', async t => {
 const f = await fixture(t);
 await f.setup();
 const op = (await f.request('/api/opportunities', {
   method: 'POST',
   body: {
     company: 'Acme Corp',
     role: 'Senior Platform Engineer',
     url: 'https://example.com/job',
     deadline: '2026-12-01',
   },
 })).data;
 assert.equal(op.company, 'Acme Corp');
 assert.equal(op.role, 'Senior Platform Engineer');
 assert.equal(op.outputFolder, 'opportunities/acme-corp/senior-platform-engineer');
 assert.ok(existsSync(join(f.options.filesDir, 'opportunities/acme-corp/senior-platform-engineer')));

 // 1. Upload JD document for this opportunity
 const jdRes = await f.request('/api/documents', {
   method: 'POST',
   body: {
     name: 'Job Spec.txt',
     kind: 'jd',
     status: 'draft',
     opportunityId: op.id,
     contentBase64: Buffer.from('Senior Platform Engineer job specification').toString('base64'),
   },
 });
 assert.equal(jdRes.status, 201);
 const jdDoc = jdRes.data;

 // 2. Upload tailored CV (draft)
 const cvRes = await f.request('/api/documents', {
   method: 'POST',
   body: {
     name: 'Platform CV.pdf',
     kind: 'cv',
     status: 'draft',
     opportunityId: op.id,
     contentBase64: Buffer.from('%PDF-1.4 fictional CV content').toString('base64'),
   },
 });
 assert.equal(cvRes.status, 201);
 const cvDoc = cvRes.data;

 // 3. Upload submitted document
 const submittedRes = await f.request('/api/documents', {
   method: 'POST',
   body: {
     name: 'Submitted Application.pdf',
     kind: 'cv',
     status: 'submitted',
     opportunityId: op.id,
     contentBase64: Buffer.from('%PDF-1.4 final submitted CV').toString('base64'),
   },
 });
 assert.equal(submittedRes.status, 201);
 const submittedDoc = submittedRes.data;

 // 4. Verify relative paths in database
 const allDocs = f.app.db.prepare('SELECT data FROM documents').all().map(r => JSON.parse(r.data));
 const storedJd = allDocs.find(d => d.id === jdDoc.id);
 const storedCv = allDocs.find(d => d.id === cvDoc.id);
 const storedSub = allDocs.find(d => d.id === submittedDoc.id);

 assert.equal(storedJd.relativePath, 'opportunities/acme-corp/senior-platform-engineer/Job Spec.txt');
 assert.equal(storedCv.relativePath, 'opportunities/acme-corp/senior-platform-engineer/Platform CV.pdf');
 assert.equal(storedSub.relativePath, 'opportunities/acme-corp/senior-platform-engineer/Submitted Application.pdf');

 // Content download works transparently
 const jdContent = await f.request('/api/documents/' + jdDoc.id + '/content', { binary: true });
 assert.equal(jdContent.data.toString(), 'Senior Platform Engineer job specification');

 // 5. Test organize-folders endpoint:
 // First, simulate a legacy document in opportunities/<id>/<doc-id>.txt
 const legacyId = 'legacy-doc-123';
 const legacyRelPath = `opportunities/${op.id}/${legacyId}.txt`;
 const legacyFullPath = join(f.options.filesDir, legacyRelPath);
 mkdirSync(dirname(legacyFullPath), { recursive: true });
 writeFileSync(legacyFullPath, 'Legacy interview notes', { mode: 0o600 });
 const legacyDoc = {
   id: legacyId,
   name: 'Interview Prep.txt',
   kind: 'interview',
   status: 'draft',
   opportunityId: op.id,
   createdAt: new Date().toISOString(),
   size: 22,
   version: 1,
   notes: '',
   category: 'star-story',
   storageRoot: f.options.filesDir,
   relativePath: legacyRelPath,
   sha256: createHash('sha256').update('Legacy interview notes').digest('hex'),
   revision: 1,
 };
 f.app.db.prepare('INSERT INTO documents(id, data) VALUES (?, ?)').run(legacyId, JSON.stringify(legacyDoc));

 // Verify legacy document resolves before organization
 const legacyPre = await f.request('/api/documents/' + legacyId + '/content', { binary: true });
 assert.equal(legacyPre.data.toString(), 'Legacy interview notes');

 // Run organize-folders
 const orgRes = await f.request('/api/opportunities/' + op.id + '/organize-folders', { method: 'POST' });
 assert.equal(orgRes.status, 200);
 assert.equal(orgRes.data.organizedCount, 1);

 // Check new location of legacy document
 const updatedLegacyRow = JSON.parse(f.app.db.prepare('SELECT data FROM documents WHERE id=?').get(legacyId).data);
 assert.equal(updatedLegacyRow.relativePath, 'opportunities/acme-corp/senior-platform-engineer/Interview Prep.txt');
 assert.ok(!existsSync(legacyFullPath), 'Old legacy file was cleaned up after move');

 // Verify content resolves from new location
 const legacyPost = await f.request('/api/documents/' + legacyId + '/content', { binary: true });
 assert.equal(legacyPost.data.toString(), 'Legacy interview notes');

 // 6. Test updating company and role moves documents and creates new Company > Role folder
 const renameRes = await f.request('/api/opportunities/' + op.id, {
   method: 'PATCH',
   body: {
     revision: op.revision,
     company: 'Beta Corp',
     role: 'Staff Platform Engineer',
   },
 });
 assert.equal(renameRes.status, 200);
 assert.equal(renameRes.data.company, 'Beta Corp');
 assert.equal(renameRes.data.role, 'Staff Platform Engineer');
 assert.equal(renameRes.data.outputFolder, 'opportunities/beta-corp/staff-platform-engineer');
 assert.ok(existsSync(join(f.options.filesDir, 'opportunities/beta-corp/staff-platform-engineer')));

 const renamedDocs = f.app.db.prepare("SELECT data FROM documents WHERE json_extract(data, '$.opportunityId') = ?").all(op.id).map(r => JSON.parse(r.data));
 for (const d of renamedDocs) {
   assert.ok(d.relativePath.startsWith('opportunities/beta-corp/staff-platform-engineer/'));
   assert.ok(existsSync(join(f.options.filesDir, d.relativePath)));
 }
});

test("update check: /api/board includes updateStatus and /api/updates/check checks status", async (t) => {
  const f = await fixture(t);
  await f.setup();

  // Test /api/board default status
  const boardRes = await f.request('/api/board');
  assert.equal(boardRes.status, 200);
  assert.ok(boardRes.data.updateStatus);
  assert.equal(typeof boardRes.data.updateStatus.updateAvailable, 'boolean');
  assert.ok(boardRes.data.updateStatus.currentVersion);

  // Test /api/updates/check endpoint
  const checkRes = await f.request('/api/updates/check');
  assert.equal(checkRes.status, 200);
  assert.equal(typeof checkRes.data.updateAvailable, 'boolean');
  assert.ok(checkRes.data.currentVersion);

  // Test with mocked newer version cached
  f.app.updateChecker._setCachedStatus({
    updateAvailable: true,
    currentVersion: "0.4.5",
    latestVersion: "0.5.0",
    releaseUrl: "https://github.com/codefitz/opportunity-knox/releases/tag/v0.5.0",
    reason: "New version 0.5.0 is available.",
    checkedAt: new Date().toISOString(),
  });

  const updatedBoardRes = await f.request('/api/board');
  assert.equal(updatedBoardRes.data.updateStatus.updateAvailable, true);
  assert.equal(updatedBoardRes.data.updateStatus.latestVersion, "0.5.0");
});

test("R12: promote chat attachment and STAR profile story to career library", async (t) => {
  let output;
  const f = await fixture(t, {
    buddyFetch: async () => buddyResponse(buddyReply(output)),
  });
  await f.setup();
  await enableBuddy(f);

  // 1. Upload a chat attachment
  const upload = await f.request("/api/buddy/attachments", {
    method: "POST",
    body: {
      name: "Quarterly Performance Notes.docx",
      contentBase64: Buffer.from("Quarterly accomplishments and metrics.").toString("base64"),
    },
  });
  assert.equal(upload.status, 200);
  const attachmentId = upload.data.id;

  // Verify attachment is NOT in documents yet (no silent indexing)
  const initialDocs = (await f.request("/api/documents")).data.documents;
  assert.equal(initialDocs.length, 0);

  // 2. Promote chat attachment to library via POST /api/buddy/attachments/:id/promote
  const promoteRes = await f.request(`/api/buddy/attachments/${attachmentId}/promote`, {
    method: "POST",
    body: {
      category: "supporting-statement",
      notes: "My performance notes for interview prep",
    },
  });
  assert.equal(promoteRes.status, 201);
  assert.equal(promoteRes.data.document.name, "Quarterly Performance Notes.docx");
  assert.equal(promoteRes.data.document.category, "supporting-statement");
  assert.equal(promoteRes.data.document.kind, "reference");

  // Verify it is now present in career library documents
  const docsAfterAttachment = (await f.request("/api/documents")).data.documents;
  assert.equal(docsAfterAttachment.length, 1);
  assert.equal(docsAfterAttachment[0].id, promoteRes.data.document.id);

  // Download content to verify bytes are intact
  const content = await f.request(`/api/documents/${promoteRes.data.document.id}/content`, { binary: true });
  assert.equal(content.data.toString(), "Quarterly accomplishments and metrics.");

  // 3. Propose and promote STAR story to library
  output = {
    reply: JSON.stringify({
      intent: "star",
      message: "Here is your STAR story highlight based on our conversation.",
      opportunity: null,
      tasks: [],
      star: {
        situation: "Legacy database migration was failing under peak load.",
        task: "Redesign the schema and failover mechanism.",
        action: "Implemented atomic transactions and zero-downtime replication.",
        result: "Reduced failover latency by 90% and zero lost writes.",
        cvBullet: "Architected zero-downtime database replication, cutting failover latency by 90%.",
        coverHighlight: "Led mission-critical database replatforming under heavy load with zero downtime.",
      },
    }),
  };

  const chatRes = await f.request("/api/buddy/workspace", {
    method: "POST",
    body: {
      mode: "auto",
      requestId: "star-story-chat",
      message: "Help me craft a STAR story about the database project.",
      documentIds: [],
      attachmentIds: [],
    },
  });
  assert.equal(chatRes.status, 200);
  const starProposal = chatRes.data.messages.at(-1);
  assert.ok(starProposal.proposal.star);

  // Apply STAR proposal with custom title
  const applyRes = await f.request(`/api/buddy/workspace/${starProposal.id}/apply`, {
    method: "POST",
    body: {
      confirm: true,
      title: "Database Replatforming STAR Story",
    },
  });
  assert.equal(applyRes.status, 200);
  assert.ok(applyRes.data.result.id);
  assert.equal(applyRes.data.result.name, "Database Replatforming STAR Story.md");
  assert.equal(applyRes.data.result.category, "star-story");
  assert.equal(applyRes.data.result.kind, "reference");

  // Verify library now contains 2 documents
  const allDocs = (await f.request("/api/documents")).data.documents;
  assert.equal(allDocs.length, 2);

  const starDoc = allDocs.find((d) => d.id === applyRes.data.result.id);
  assert.ok(starDoc);
  assert.equal(starDoc.name, "Database Replatforming STAR Story.md");

  // Verify content of STAR story markdown
  const starContent = await f.request(`/api/documents/${starDoc.id}/content`, { binary: true });
  assert.match(starContent.data.toString(), /# Database Replatforming STAR Story/);
  assert.match(starContent.data.toString(), /## Situation\nLegacy database migration/);
  assert.match(starContent.data.toString(), /## Result\nReduced failover latency by 90%/);
});

test("R13: job lookup falls back to browser rendering for JavaScript SPA listings", async (t) => {
  const spaHtml = '<!doctype html><html><head><title>Modern Careers</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
  const renderedHtml = `<!doctype html><html><head><title>Modern Careers</title></head><body>
    <main>
      <h1>Cloud Native Architect</h1>
      <span class="company-name">Fictional Cloud Systems</span>
      <span data-testid="job-location">Cambridge, UK</span>
      <article>
        <h2>About the role</h2>
        <p>Help our fictional team build reliable distributed cloud systems.</p>
        <h2>Responsibilities</h2>
        <ul><li>Design cloud platforms.</li><li>Improve system architecture.</li></ul>
        <p>Applicants should bring extensive distributed systems experience.</p>
      </article>
    </main>
  </body></html>`;

  const browserRunner = async (cmd, args) => {
    if (args[0] === "--version") {
      return { stdout: "Chromium 130.0.0.0" };
    }
    if (args.includes("--dump-dom")) {
      return { stdout: renderedHtml };
    }
    return { stdout: "" };
  };

  const f = await fixture(t, {
    intakePageFetcher: async (url) => ({
      url,
      html: spaHtml,
      bytes: Buffer.from(spaHtml),
      contentType: "text/html",
    }),
    browserRunner,
  });
  await f.setup();

  // Test /api/job-intake with SPA listing
  const intakeRes = await f.request("/api/job-intake", {
    method: "POST",
    body: {
      kind: "url",
      url: "https://jobs.example.test/spa/role",
      useAI: false,
      ocr: false,
      requestId: "test-spa-intake-1",
    },
  });
  assert.equal(intakeRes.status, 200);
  assert.equal(intakeRes.data.fields.role, "Cloud Native Architect");
  assert.equal(intakeRes.data.fields.company, "Fictional Cloud Systems");
  assert.ok(intakeRes.data.warnings.some((w) => /headless browser/i.test(w)));
});


async function actionPreview(f,action,opportunityId){return f.request('/api/workspace-actions/preview',{method:'POST',body:{action,opportunityId}});}
async function actionApply(f,preview,extra={}){return f.request('/api/workspace-actions/apply',{method:'POST',body:{planId:preview.planId,confirmation:preview.phrase,confirm:true,...extra}});}
function putTestRow(f,table,id,value){f.app.db.prepare(`INSERT INTO ${table}(id,data) VALUES (?,?)`).run(id,JSON.stringify({id,...value}));}
function testConfig(f,key,value){f.app.db.prepare('INSERT INTO config(key,data) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(key,JSON.stringify(value));}

test('individual deletion previews exact scope, requires confirmation and preserves files and full backup',async t=>{
 const f=await fixture(t);await f.setup();
 const first=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;
 const other=(await f.request('/api/opportunities',{method:'POST',body:{...opportunity,company:'Fictional Other'}})).data;
 async function upload(opportunityId,status='draft'){return(await f.request('/api/documents',{method:'POST',body:{opportunityId,name:'evidence.txt',kind:'reference',status,contentBase64:Buffer.from('Exact fictional submitted bytes').toString('base64')}})).data;}
 const doc=await upload(first.id,'submitted'),library=await upload('');
 const stored=JSON.parse(f.app.db.prepare('SELECT data FROM documents WHERE id=?').get(doc.id).data),original=join(stored.storageRoot,stored.relativePath);
 putTestRow(f,'tasks','linked',{title:'Linked task',opportunityId:first.id});putTestRow(f,'tasks','unlinked',{title:'Unlinked task',opportunityId:''});
 putTestRow(f,'buddy_messages','chat',{opportunityId:first.id});putTestRow(f,'decision_assessments','assessment',{opportunityId:first.id});
 putTestRow(f,'buddy_requests','finished',{conversationId:'opportunity:'+first.id,finishedAt:'2026-01-01'});
 putTestRow(f,'buddy_requests','standalone',{conversationId:'standalone:keep',finishedAt:'2026-01-01'});
 testConfig(f,'opportunitySummary:'+first.id,{text:'Old summary'});
 assert.equal((await f.request('/api/workspace-actions/preview',{method:'POST',auth:false,body:{action:'delete-opportunity',opportunityId:first.id}})).status,401);
 const preview=await actionPreview(f,'delete-opportunity',first.id);assert.equal(preview.status,200);assert.equal(preview.data.counts.find(v=>v.label==='Opportunities').count,1);
 assert.equal((await actionApply(f,preview.data,{confirmation:'wrong'})).status,400);
 const result=await actionApply(f,preview.data);assert.equal(result.status,200,result.data.error);
 assert.equal((await f.request('/api/opportunities/'+first.id)).status,404);assert.equal((await f.request('/api/opportunities/'+other.id)).status,200);
 assert.equal(f.app.db.prepare('SELECT id FROM tasks WHERE id=?').get('linked'),undefined);assert.ok(f.app.db.prepare('SELECT id FROM tasks WHERE id=?').get('unlinked'));
 assert.equal(f.app.db.prepare('SELECT id FROM buddy_messages WHERE id=?').get('chat'),undefined);assert.equal(f.app.db.prepare('SELECT id FROM decision_assessments').all().length,0);
 assert.equal(f.app.db.prepare('SELECT id FROM buddy_requests').all().length,1);
 assert.equal((await f.request('/api/documents')).data.documents.some(d=>d.id===library.id),true);
 assert.equal(readFileSync(original,'utf8'),'Exact fictional submitted bytes');
 const snapshot=new DatabaseSync(join(result.data.backup.location,'board.sqlite'));assert.ok(snapshot.prepare('SELECT id FROM records WHERE id=?').get(first.id));snapshot.close();
 assert.equal(readFileSync(join(result.data.backup.location,'documents',doc.id),'utf8'),'Exact fictional submitted bytes');
 assert.equal((await actionApply(f,preview.data)).status,409);
 await f.restart();await f.login();assert.equal((await f.request('/api/opportunities/'+first.id)).status,404);
});

test('clear all includes completed opportunities and preserves library, settings and unlinked tasks',async t=>{
 const f=await fixture(t);await f.setup();
 const a=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;
 const b=(await f.request('/api/opportunities',{method:'POST',body:{...opportunity,company:'Fictional Completed'}})).data;
 const raw=JSON.parse(f.app.db.prepare('SELECT data FROM records WHERE id=?').get(b.id).data);raw.stage='outcome';raw.outcome='rejected';f.app.db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(raw),b.id);
 putTestRow(f,'tasks','keep',{opportunityId:''});putTestRow(f,'tasks','remove',{opportunityId:a.id});
 const doc=(await f.request('/api/documents',{method:'POST',body:{name:'library.txt',kind:'reference',contentBase64:Buffer.from('Keep this library source').toString('base64')}})).data;
 const preview=await actionPreview(f,'clear-opportunities');assert.equal(preview.data.counts.find(c=>c.label==='Opportunities').count,2);assert.doesNotMatch(preview.data.keeps,/Other opportunities/);assert.match(preview.data.removes,/^All opportunities/);
 assert.equal((await actionApply(f,preview.data)).status,200);
 assert.equal((await f.request('/api/board')).data.opportunities.length,0);assert.ok(f.app.db.prepare('SELECT id FROM tasks WHERE id=?').get('keep'));
 assert.equal((await f.request('/api/documents')).data.documents[0].id,doc.id);
});

test('workspace reset preserves exact profile, sign-in, storage and backups while clearing app data and old clients',async t=>{
 const f=await fixture(t,{embeddingFn:async texts=>texts.map(()=>[1,...Array(383).fill(0)]),documentConvert:async()=>({pages:1,pdf:Buffer.from('%PDF-fictional')})});await f.setup();
 await f.request('/api/opportunities',{method:'POST',body:opportunity});
 const profile={name:'Fictional Profile',revision:7,image:{mime:'image/png',base64:'fictional-avatar'}};testConfig(f,'profile',profile);
 testConfig(f,'settings',{theme:'midnight',timezone:'America/New_York',documentsSubdir:'kept-applications',referenceSubdir:'kept-library',backupSubdir:'kept-backups'});
 testConfig(f,'careerBuddy',{enabled:true,apiKey:'fictional-secret'});testConfig(f,'googleDocuments',{refreshToken:'fictional-token'});testConfig(f,'feedbackInbox',{items:[{text:'Saved feedback'}]});
 const doc=(await f.request('/api/documents',{method:'POST',body:{name:'original.txt',kind:'reference',contentBase64:Buffer.from('Keep physical original').toString('base64')}})).data;
 const stored=JSON.parse(f.app.db.prepare('SELECT data FROM documents WHERE id=?').get(doc.id).data);
 await f.request('/api/buddy/vector-index',{method:'POST',body:{documentIds:[doc.id]}});
 for(let i=0;i<100;i++){if((await f.request('/api/buddy/vector-index')).data.job.status==='completed')break;await new Promise(resolve=>setTimeout(resolve,5));}
 assert.equal((await f.request('/api/buddy/vector-index')).data.job.status,'completed');
 const {layoutDraft}=await import('../server/document-layout.mjs');const word=await layoutDraft('Fictional reset CV','Fictional document source','classic');
 const studioSource=(await f.request('/api/documents',{method:'POST',body:{name:'reset-source.docx',kind:'cv',contentBase64:word.toString('base64')}})).data;
 const rendered=await f.request('/api/document-studio/preview',{method:'POST',body:{documentId:studioSource.id,revision:studioSource.revision,layout:'original',pageTarget:2}});assert.equal(rendered.status,200);
 putTestRow(f,'standalone_messages','history',{role:'user',content:'Clear chat history'});
 putTestRow(f,'tasks','task',{title:'Clear me'});
 const oldId=(await f.request('/api/uploads/workspace')).data.id;
 const intake=await f.request('/api/job-intake',{method:'POST',body:{kind:'text',text:'Fictional job listing with enough content to prepare a local source preview.',useAI:false,ocr:false,requestId:'before-reset'}});
 assert.equal(intake.status,200);
 const preview=await actionPreview(f,'reset-workspace');assert.equal(preview.status,200,preview.data.error);
 const result=await actionApply(f,preview.data);assert.equal(result.status,200,result.data.error);
 assert.notEqual(result.response.headers.get('x-board-workspace'),oldId);
 assert.equal((await f.request('/api/session')).data.authenticated,true);
 assert.deepEqual(JSON.parse(f.app.db.prepare("SELECT data FROM config WHERE key='profile'").get().data),profile);
 assert.equal((await f.request('/api/board')).data.opportunities.length,0);assert.equal((await f.request('/api/documents')).data.documents.length,0);
 for(const table of ['tasks','standalone_messages','buddy_requests','ai_tasks','document_vectors'])assert.equal(f.app.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);
 for(const key of ['careerBuddy','googleDocuments','feedbackInbox'])assert.equal(f.app.db.prepare('SELECT data FROM config WHERE key=?').get(key),undefined);
 const settings=(await f.request('/api/board')).data.settings;assert.equal(settings.theme,'forest');assert.equal(settings.timezone,'Europe/London');assert.equal(settings.backupSubdir,'kept-backups');
 assert.equal(readFileSync(join(stored.storageRoot,stored.relativePath),'utf8'),'Keep physical original');assert.ok(existsSync(join(result.data.backup.location,'board.sqlite')));
 const stale=await f.request('/api/opportunities',{method:'POST',headers:{'X-Board-Workspace':oldId},body:opportunity});assert.equal(stale.status,409);
 assert.equal((await f.request('/api/buddy/vector-index')).data.job,null);
 assert.equal((await f.request('/api/job-intake/'+intake.data.id+'/source')).status,409);
 assert.equal((await f.request(rendered.data.pdfUrl)).status,404);
 await f.restart();await f.login();assert.equal((await f.request('/api/board')).data.profile.name,profile.name);
});

test('destructive actions reject stale previews and abort unchanged if a required backup cannot verify files',async t=>{
 const f=await fixture(t);await f.setup();const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;
 const stale=await actionPreview(f,'delete-opportunity',op.id);testConfig(f,'a-new-setting',{changed:true});assert.equal((await actionApply(f,stale.data)).status,409);
 const doc=(await f.request('/api/documents',{method:'POST',body:{name:'missing.txt',kind:'reference',opportunityId:op.id,contentBase64:Buffer.from('Original bytes').toString('base64')}})).data;
 const stored=JSON.parse(f.app.db.prepare('SELECT data FROM documents WHERE id=?').get(doc.id).data);rmSync(join(stored.storageRoot,stored.relativePath));
 const preview=await actionPreview(f,'delete-opportunity',op.id);assert.equal((await actionApply(f,preview.data)).status,409);
 assert.equal((await f.request('/api/opportunities/'+op.id)).status,200);assert.equal((await f.request('/api/documents')).data.documents.length,1);
});

test('destructive actions block active work and rollback all rows on database failure',async t=>{
 const f=await fixture(t);await f.setup();const op=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;
 putTestRow(f,'buddy_requests','active',{conversationId:'opportunity:'+op.id,finishedAt:null});assert.equal((await actionPreview(f,'clear-opportunities')).status,409);
 f.app.db.prepare('DELETE FROM buddy_requests WHERE id=?').run('active');
 putTestRow(f,'ai_tasks','queued',{status:'queued'});assert.equal((await actionPreview(f,'reset-workspace')).status,409);f.app.db.prepare('DELETE FROM ai_tasks WHERE id=?').run('queued');
 putTestRow(f,'tasks','linked-rollback',{opportunityId:op.id});
 f.app.db.exec("CREATE TRIGGER fail_test_delete BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT,'fictional failure'); END");
 const preview=await actionPreview(f,'clear-opportunities');assert.equal((await actionApply(f,preview.data)).status,500);
 assert.ok(f.app.db.prepare('SELECT id FROM records WHERE id=?').get(op.id));assert.ok(f.app.db.prepare('SELECT id FROM tasks WHERE id=?').get('linked-rollback'));
});

test('destructive apply waits for another HTTP write to finish before taking its backup',async t=>{
 const f=await fixture(t);await f.setup();await f.request('/api/opportunities',{method:'POST',body:opportunity});
 const preview=await actionPreview(f,'clear-opportunities');
 const {request}=await import('node:http');
 let closed;const entered=new Promise(resolve=>f.app.server.once('request',(_req,res)=>{closed=new Promise(done=>res.once('close',done));setImmediate(resolve);}));
 const slow=request(f.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'}});slow.on('error',()=>{});slow.write('{"password":');
 await entered;
 try{assert.equal((await actionApply(f,preview.data)).status,409);}finally{slow.destroy();await closed;}
 assert.equal((await actionApply(f,preview.data)).status,200);
});

test('reset remains blocked while disconnected document processing is still running',async t=>{
 let entered,release;const ready=new Promise(resolve=>entered=resolve);
 const f=await fixture(t,{documentConvert:async()=>{entered();await new Promise(resolve=>release=resolve);return {pages:1,pdf:Buffer.from('%PDF-fictional')};}});await f.setup();
 const {layoutDraft}=await import('../server/document-layout.mjs');const bytes=await layoutDraft('Fictional cancelled rendering','Fictional source','classic');
 const doc=(await f.request('/api/documents',{method:'POST',body:{name:'cancelled.docx',kind:'cv',contentBase64:bytes.toString('base64')}})).data;
 const controller=new AbortController();
 const pending=f.request('/api/document-studio/preview',{method:'POST',signal:controller.signal,body:{documentId:doc.id,revision:doc.revision,layout:'original',pageTarget:2}});
 await ready;controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');
 try{assert.equal((await actionPreview(f,'reset-workspace')).status,409);}finally{release();}
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await actionPreview(f,'reset-workspace')).status,200);
});

test('document studio phase 1 supports typed defaults, document rename, and duplication', async t => {
  const f = await fixture(t);
  await f.setup();
  const cvBytes = Buffer.from('Fictional CV content');
  const tplBytes = Buffer.from('Fictional template content');
  const masterDoc = (await f.request('/api/documents', {
    method: 'POST',
    body: { name: 'Master_CV.docx', kind: 'cv', category: 'master-cv', contentBase64: cvBytes.toString('base64') },
  })).data;
  assert.equal(masterDoc.category, 'master-cv');

  const cvTplDoc = (await f.request('/api/documents', {
    method: 'POST',
    body: { name: 'Executive_CV_Template.docx', kind: 'cv', category: 'cv-template', contentBase64: tplBytes.toString('base64') },
  })).data;
  assert.equal(cvTplDoc.category, 'cv-template');

  const coverTplDoc = (await f.request('/api/documents', {
    method: 'POST',
    body: { name: 'Standard_Cover_Template.docx', kind: 'cover', category: 'cover-letter-template', contentBase64: tplBytes.toString('base64') },
  })).data;
  assert.equal(coverTplDoc.category, 'cover-letter-template');

  const initialDefaults = (await f.request('/api/document-studio/defaults')).data;
  assert.equal(initialDefaults.masterCvId, '');

  const setDefaults = await f.request('/api/document-studio/defaults', {
    method: 'PATCH',
    body: {
      masterCvId: masterDoc.id,
      cvTemplateId: cvTplDoc.id,
      coverLetterTemplateId: coverTplDoc.id,
    },
  });
  assert.equal(setDefaults.status, 200);
  assert.equal(setDefaults.data.masterCvId, masterDoc.id);
  assert.equal(setDefaults.data.cvTemplateId, cvTplDoc.id);
  assert.equal(setDefaults.data.coverLetterTemplateId, coverTplDoc.id);

  const getDefaults = (await f.request('/api/document-studio/defaults')).data;
  assert.equal(getDefaults.masterCvId, masterDoc.id);

  const renamed = await f.request('/api/documents/' + masterDoc.id, {
    method: 'PATCH',
    body: { revision: masterDoc.revision, name: 'Senior_Master_CV.docx' },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.name, 'Senior_Master_CV.docx');

  const invalidRename = await f.request('/api/documents/' + masterDoc.id, {
    method: 'PATCH',
    body: { revision: renamed.data.revision, name: 'Senior_Master_CV.pdf' },
  });
  assert.equal(invalidRename.status, 400);

  const duplicated = await f.request('/api/documents/' + masterDoc.id + '/duplicate', {
    method: 'POST',
  });
  assert.equal(duplicated.status, 201);
  assert.notEqual(duplicated.data.id, masterDoc.id);
  assert.equal(duplicated.data.name, 'Senior_Master_CV (copy).docx');
  assert.equal(duplicated.data.category, 'master-cv');

  const dupContent = (await f.request('/api/documents/' + duplicated.data.id + '/content', { binary: true })).data;
  assert.deepEqual(dupContent, cvBytes);

  // Markdown document preview and content handling
  const mdContent = '# Verified Fictional Candidate\n\n- Senior Developer 2021-2024\n- Tech Lead 2024-Present';
  const mdDoc = (await f.request('/api/documents', {
    method: 'POST',
    body: { name: 'Fictional_Resume.md', kind: 'cv', category: 'master-cv', contentBase64: Buffer.from(mdContent).toString('base64') },
  })).data;
  assert.equal(mdDoc.category, 'master-cv');

  const mdContentRes = await f.request('/api/documents/' + mdDoc.id + '/content');
  assert.equal(mdContentRes.status, 200);
  assert.match(mdContentRes.response.headers.get('content-type') || '', /text\/markdown/);

  const mdPreview = await f.request('/api/document-studio/preview', {
    method: 'POST',
    body: { documentId: mdDoc.id, revision: mdDoc.revision, layout: 'original' },
  });
  assert.equal(mdPreview.status, 200);
  assert.equal(mdPreview.data.format, 'markdown');
  assert.equal(mdPreview.data.content, mdContent);
});

test('document studio phase 2 generates tailored CV and cover letter, preserves template layout and attaches to opportunity', async t => {
  const f = await fixture(t, {
    documentConvert: async (bytes, folder) => {
      const { writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      writeFileSync(join(folder, 'page-1.png'), Buffer.from('fictional-page'));
      return { pages: 1, pdf: Buffer.from('%PDF-fictional') };
    },
  });
  await f.setup();

  // 1. Create candidate master CV
  const masterCVText = '# Dr. Alex Fictional\nTechnology Leader & Principal Architect\nalex@example.test | +44 7700 900000 | London, UK\n\n' +
    '## Professional Summary\nAccomplished engineering leader with 10+ years driving distributed systems and cloud platforms.\n\n' +
    '## Work Experience\n' +
    '### Principal Architect | Fictional Tech Global\n2021 – Present\n- Architected multi-region platform scaling to 10M daily events with 99.99% uptime.\n\n' +
    '## Education\n- University of London: MSc Computer Science — 2017';

  const masterDoc = (await f.request('/api/documents', {
    method: 'POST',
    body: {
      name: 'Dr_Alex_Fictional_Master_CV.docx',
      kind: 'cv',
      category: 'master-cv',
      contentBase64: Buffer.from(await layoutDraft('Dr Alex Fictional', masterCVText, 'classic')).toString('base64'),
    },
  })).data;
  assert.equal(masterDoc.category, 'master-cv');

  // 2. Create custom CV template with structured table layout
  const templateZip = await (await import('jszip')).default.loadAsync(await layoutDraft('Executive Template', '# Dummy\n\nDummy text.', 'classic'));
  let xml = await templateZip.file('word/document.xml').async('string');
  const headerXml = '<w:p><w:r><w:t xml:space="preserve">CHARLOTTE </w:t></w:r><w:r><w:t>EXECUTE</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Chief Marketing Officer</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>111 Pine St. New York, NY | (555)999-9999 | c@email.com</w:t></w:r></w:p>';
  const tableXml = '<w:tbl>' +
    '<w:tr><w:tc><w:p><w:r><w:t>Work Experience</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Sidebar</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>2014 - Present</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Old Company Inc.</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p/></w:tc><w:tc><w:p><w:r><w:t>Old Job Title</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p/></w:tc><w:tc><w:p><w:r><w:t>Old achievements.</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>EDUCATION</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>May 2010</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Old School University</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p/></w:tc><w:tc><w:p><w:r><w:t>Old Degree</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p/></w:tc><w:tc><w:p><w:r><w:t>Old Honors</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>' +
    '</w:tbl>';
  xml = xml.replace('</w:body>', headerXml + tableXml + '</w:body>');
  templateZip.file('word/document.xml', xml);
  const cvTemplateBytes = await templateZip.generateAsync({ type: 'nodebuffer' });

  const cvTemplateDoc = (await f.request('/api/documents', {
    method: 'POST',
    body: {
      name: 'Custom_Executive_Template.docx',
      kind: 'cv',
      category: 'cv-template',
      contentBase64: Buffer.from(cvTemplateBytes).toString('base64'),
    },
  })).data;
  assert.equal(cvTemplateDoc.category, 'cv-template');

  // 3. Create target opportunity
  const op = (await f.request('/api/opportunities', {
    method: 'POST',
    body: {
      company: 'Acme Cloud Solutions',
      role: 'Staff Infrastructure Architect',
      description: 'Looking for a Staff Infrastructure Architect with deep distributed systems and team leadership experience.',
    },
  })).data;

  // 4. Generate tailored CV without AI (deterministic factual generation)
  const genCVRes = await f.request('/api/document-studio/generate', {
    method: 'POST',
    body: {
      kind: 'cv',
      sourceCvId: masterDoc.id,
      templateId: cvTemplateDoc.id,
      opportunityId: op.id,
      passToAi: false,
    },
  });
  assert.equal(genCVRes.status, 201);
  const generatedCv = genCVRes.data.document;
  assert.equal(generatedCv.kind, 'cv');
  assert.equal(generatedCv.category, 'tailored-cv');
  assert.equal(generatedCv.opportunityId, op.id);
  assert.match(generatedCv.name, /Acme Cloud Solutions/);
  assert.match(generatedCv.name, /Staff Infrastructure Architect/);

  // Verify generated bytes preserved template layout and candidate facts
  const cvDocContent = (await f.request('/api/documents/' + generatedCv.id + '/content', { binary: true })).data;
  const cvDocZip = await (await import('jszip')).default.loadAsync(cvDocContent);
  const cvDocXml = await cvDocZip.file('word/document.xml').async('string');
  assert.match(cvDocXml, /<w:tbl/);
  assert.match(cvDocXml, /w:vMerge/);
  assert.match(cvDocXml, /Alex Fictional/);
  assert.match(cvDocXml, /Principal Architect/);
  assert.match(cvDocXml, /Fictional Tech Global/);
  assert.doesNotMatch(cvDocXml, /Old Company|Old Job Title|Old achievements/);

  // 5. Verify opportunity now has the generated CV attached
  const opAfter = (await f.request('/api/opportunities/' + op.id)).data;
  assert.ok(opAfter.documents.some(d => d.id === generatedCv.id));

  // 6. Generate cover letter using built-in letter layout
  const genCoverRes = await f.request('/api/document-studio/generate', {
    method: 'POST',
    body: {
      kind: 'cover',
      sourceCvId: masterDoc.id,
      opportunityId: op.id,
      layout: 'letter',
      passToAi: false,
    },
  });
  assert.equal(genCoverRes.status, 201);
  const generatedCover = genCoverRes.data.document;
  assert.equal(generatedCover.kind, 'cover');
  assert.equal(generatedCover.category, 'cover-letter');
  assert.equal(generatedCover.opportunityId, op.id);
  assert.match(generatedCover.name, /Cover letter/);

  const coverDocContent = (await f.request('/api/documents/' + generatedCover.id + '/content', { binary: true })).data;
  const coverDocZip = await (await import('jszip')).default.loadAsync(coverDocContent);
  const coverDocXml = await coverDocZip.file('word/document.xml').async('string');
  assert.match(coverDocXml, /Acme Cloud Solutions/);
  assert.match(coverDocXml, /Staff Infrastructure Architect/);

  // 7. Verify preview was generated or is previewable
  const previewRes = await f.request('/api/document-studio/preview', {
    method: 'POST',
    body: { documentId: generatedCv.id, revision: generatedCv.revision, layout: 'original' },
  });
  assert.equal(previewRes.status, 200);
  assert.ok(previewRes.data.pages >= 1);
});

test('document studio phase 3 supports template derivation, contextual chat revisions, cancellation and version restore', async t => {
  const f = await fixture(t, {
    documentConvert: async (bytes, folder) => {
      const { writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      writeFileSync(join(folder, 'page-1.png'), Buffer.from('fictional-page'));
      return { pages: 1, pdf: Buffer.from('%PDF-fictional') };
    },
  });
  await f.setup();

  const originalCvText = '# Jane Doe\nPrincipal Cloud Engineer\njane@private.test | +44 7900 111222 | London, UK\n\n' +
    '## Professional Summary\nExpert in distributed cloud architecture and systems.\n\n' +
    '## Work Experience\n' +
    '### Principal Engineer | Tech Enterprises\n2020 – Present\n- Led microservices migration serving 5M users.\n\n' +
    '## Education\n- BSc Computer Systems — University of Bristol (2016)';

  const sourceDoc = (await f.request('/api/documents', {
    method: 'POST',
    body: {
      name: 'Jane_Doe_CV.docx',
      kind: 'cv',
      category: 'master-cv',
      contentBase64: Buffer.from(await layoutDraft('Jane Doe', originalCvText, 'classic')).toString('base64'),
    },
  })).data;
  assert.equal(sourceDoc.category, 'master-cv');

  // 1. Create reusable template from uploaded CV
  const templateRes = await f.request('/api/document-studio/create-template', {
    method: 'POST',
    body: {
      sourceDocumentId: sourceDoc.id,
    },
  });
  assert.equal(templateRes.status, 201);
  const derivedTemplate = templateRes.data.document;
  assert.equal(derivedTemplate.kind, 'cv');
  assert.equal(derivedTemplate.category, 'cv-template');
  assert.match(derivedTemplate.name, /Template/);

  // Check template bytes have sanitized private claims
  const tplContent = (await f.request('/api/documents/' + derivedTemplate.id + '/content', { binary: true })).data;
  const tplZip = await (await import('jszip')).default.loadAsync(tplContent);
  const tplXml = await tplZip.file('word/document.xml').async('string');
  assert.match(tplXml, /\[Candidate Full Name\]/);
  assert.match(tplXml, /\[Job Title\] \| \[Company Name\]/);
  assert.match(tplXml, /Work Experience/);
  assert.doesNotMatch(tplXml, /Jane Doe/);
  assert.doesNotMatch(tplXml, /private\.test/);
  assert.doesNotMatch(tplXml, /Tech Enterprises/);

  // 2. Chat: layout tweak
  const chatLayoutRes = await f.request('/api/document-studio/chat', {
    method: 'POST',
    body: {
      documentId: sourceDoc.id,
      message: 'Switch to compact layout with tighter spacing',
    },
  });
  assert.equal(chatLayoutRes.status, 200);
  assert.equal(chatLayoutRes.data.action, 'revised_document');
  const revisedDoc = chatLayoutRes.data.revisedDocument;
  assert.equal(revisedDoc.generation.layout, 'compact');

  // 3. Chat: create template via chat prompt
  const chatTplRes = await f.request('/api/document-studio/chat', {
    method: 'POST',
    body: {
      documentId: sourceDoc.id,
      message: 'Turn this into a cover letter template',
    },
  });
  assert.equal(chatTplRes.status, 200);
  assert.equal(chatTplRes.data.action, 'created_template');
  const chatTpl = chatTplRes.data.createdDocument;
  assert.equal(chatTpl.category, 'cover-letter-template');

  // 4. Version history
  const historyRes = await f.request('/api/document-studio/documents/' + revisedDoc.id + '/history');
  assert.equal(historyRes.status, 200);
  assert.ok(Array.isArray(historyRes.data.history));
  assert.ok(historyRes.data.history.length >= 2);

  // 5. Version restore
  const restoreRes = await f.request('/api/document-studio/documents/' + revisedDoc.id + '/restore', {
    method: 'POST',
    body: { targetId: sourceDoc.id },
  });
  assert.equal(restoreRes.status, 201);
  const restoredDoc = restoreRes.data.document;
  assert.equal(restoredDoc.name, sourceDoc.name);
  assert.ok(restoredDoc.version >= 2);

  // 6. Chat cancel
  const cancelRes = await f.request('/api/document-studio/chat/cancel', {
    method: 'POST',
    body: { requestId: 'non-existent-request' },
  });
  assert.equal(cancelRes.status, 200);
  assert.equal(cancelRes.data.cancelled, true);
});

test('document studio phase 4 supports connected documents (Obsidian sync/export and Google Drive search/import/refresh/conflict)', async t => {
  let googleFiles = [
    {
      id: 'drive-doc-1',
      name: 'External CV.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      modifiedTime: '2026-11-03T10:00:00Z',
      version: '1',
      webViewLink: 'https://drive.google.com/file/d/drive-doc-1/view',
    },
  ];
  let externalContent = 'Initial Google Drive content';

  const f = await fixture(t, {
    googleFetch: async (url) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'mock-token', expires_in: 3600 }));
      }
      if (u.includes('files?')) {
        return new Response(JSON.stringify({ files: googleFiles }));
      }
      if (u.includes('files/drive-doc-1?fields=')) {
        return new Response(JSON.stringify(googleFiles[0]));
      }
      if (u.includes('files/drive-doc-1?alt=media')) {
        return new Response(externalContent);
      }
      return new Response('Not found', { status: 404 });
    },
  });
  await f.setup();

  // 1. Check connections endpoint
  const connRes = await f.request('/api/document-studio/connections');
  assert.equal(connRes.status, 200);
  assert.equal(connRes.data.obsidian.enabled, false);
  assert.equal(connRes.data.google.connected, false);

  // 2. Google search fails when disconnected
  assert.equal((await f.request('/api/document-studio/google/search', { method: 'POST', body: { query: 'test' } })).status, 400);

  // 3. Connect Google Drive
  testConfig(f, 'googleDocuments', {
    revision: 1,
    tokens: { access_token: 'mock-token', expiresAt: Date.now() + 3600000 },
  });

  const connRes2 = await f.request('/api/document-studio/connections');
  assert.equal(connRes2.data.google.connected, true);

  // 4. Google search succeeds
  const searchRes = await f.request('/api/document-studio/google/search', {
    method: 'POST',
    body: { query: 'External' },
  });
  assert.equal(searchRes.status, 200);
  assert.equal(searchRes.data.files.length, 1);
  assert.equal(searchRes.data.files[0].id, 'drive-doc-1');

  // 5. Google import
  const importRes = await f.request('/api/document-studio/google/import', {
    method: 'POST',
    body: { id: 'drive-doc-1', category: 'master-cv' },
  });
  assert.equal(importRes.status, 201);
  const importedDoc = importRes.data.document;
  assert.equal(importedDoc.name, 'External CV.docx');
  assert.equal(importedDoc.category, 'master-cv');
  assert.equal(importedDoc.externalSource.provider, 'google-drive');
  assert.equal(importedDoc.externalSource.id, 'drive-doc-1');
  assert.equal(importedDoc.externalSource.version, '1');

  // 6. Google refresh when up-to-date
  const refreshUpToDate = await f.request('/api/document-studio/google/refresh', {
    method: 'POST',
    body: { documentId: importedDoc.id },
  });
  assert.equal(refreshUpToDate.status, 200);
  assert.equal(refreshUpToDate.data.status, 'up-to-date');

  // 7. Automatic refresh when external changed and local is unmodified
  googleFiles[0].version = '2';
  externalContent = 'Updated Google Drive content';

  const refreshUpdated = await f.request('/api/document-studio/google/refresh', {
    method: 'POST',
    body: { documentId: importedDoc.id },
  });
  assert.equal(refreshUpdated.status, 200);
  assert.equal(refreshUpdated.data.status, 'refreshed');
  const v2Doc = refreshUpdated.data.document;
  assert.equal(v2Doc.externalSource.version, '2');

  // 8. Conflict handling when BOTH sides have changed
  // Modify local document by marking it restored or revised
  const docRow = JSON.parse(f.app.db.prepare('SELECT data FROM documents WHERE id=?').get(v2Doc.id).data);
  docRow.notes = 'Revised by Studio Assistant';
  f.app.db.prepare('UPDATE documents SET data=? WHERE id=?').run(JSON.stringify(docRow), v2Doc.id);
  googleFiles[0].version = '3';
  externalContent = 'Third revision in Google Drive';

  // Conflict detected without resolution
  const conflictCheck = await f.request('/api/document-studio/google/refresh', {
    method: 'POST',
    body: { documentId: v2Doc.id },
  });
  assert.equal(conflictCheck.status, 200);
  assert.equal(conflictCheck.data.conflict, true);
  assert.equal(conflictCheck.data.externalVersion, '3');

  // Resolution: keep-local
  const keepLocal = await f.request('/api/document-studio/google/refresh', {
    method: 'POST',
    body: { documentId: v2Doc.id, resolution: 'keep-local' },
  });
  assert.equal(keepLocal.status, 200);
  assert.equal(keepLocal.data.status, 'kept-local');

  // Resolution: separate-copy
  const separateCopy = await f.request('/api/document-studio/google/refresh', {
    method: 'POST',
    body: { documentId: v2Doc.id, resolution: 'separate-copy' },
  });
  assert.equal(separateCopy.status, 200);
  assert.equal(separateCopy.data.status, 'separate-copy');
  assert.match(separateCopy.data.document.name, /Google Drive Copy/);

  // Resolution: new-version
  const newVer = await f.request('/api/document-studio/google/refresh', {
    method: 'POST',
    body: { documentId: v2Doc.id, resolution: 'new-version' },
  });
  assert.equal(newVer.status, 200);
  assert.equal(newVer.data.status, 'new-version');
  assert.equal(newVer.data.document.externalSource.version, '3');

  // 9. Obsidian Vault integration
  const vaultPath = join(f.options.dataDir, 'test-studio-vault');
  mkdirSync(join(vaultPath, '.obsidian'), { recursive: true });

  // Configure writable vault
  const configVault = await f.request('/api/obsidian/configure', {
    method: 'POST',
    body: {
      action: 'connect',
      locationType: 'hostPath',
      hostPath: vaultPath,
      readOnly: false,
    },
  });
  assert.equal(configVault.status, 200);

  // Obsidian sync
  const obsSync = await f.request('/api/document-studio/obsidian/sync', {
    method: 'POST',
  });
  assert.equal(obsSync.status, 200);
  assert.equal(obsSync.data.ok, true);

  // Obsidian export
  const obsExport = await f.request('/api/document-studio/obsidian/export', {
    method: 'POST',
    body: { documentId: importedDoc.id, subfolder: 'Generated' },
  });
  assert.equal(obsExport.status, 200);
  assert.equal(obsExport.data.ok, true);
  assert.ok(existsSync(join(vaultPath, 'Generated', 'External CV.docx')));

  // Read-only vault rejects export
  await f.request('/api/obsidian/configure', {
    method: 'POST',
    body: {
      action: 'connect',
      locationType: 'hostPath',
      hostPath: vaultPath,
      readOnly: true,
    },
  });
  const obsReadOnlyExport = await f.request('/api/document-studio/obsidian/export', {
    method: 'POST',
    body: { documentId: importedDoc.id },
  });
  assert.equal(obsReadOnlyExport.status, 400);
  assert.match(obsReadOnlyExport.data.error, /read-only/i);
});

test('Document Studio Phase 5: Verification, persistence, safeguards, and limits', async (t) => {
  const f = await fixture(t);
  await f.setup();

  // 1. Upload sample master CV and templates
  const cvRes = await f.request('/api/documents', {
    method: 'POST',
    body: {
      name: 'Master-CV.docx',
      kind: 'cv',
      category: 'master-cv',
      contentBase64: Buffer.from('CV content').toString('base64'),
    },
  });
  assert.equal(cvRes.status, 201);
  const cvDoc = cvRes.data;

  const tplRes = await f.request('/api/documents', {
    method: 'POST',
    body: {
      name: 'Template.docx',
      kind: 'cv',
      category: 'cv-template',
      contentBase64: Buffer.from('Template content').toString('base64'),
    },
  });
  assert.equal(tplRes.status, 201);
  const tplDoc = tplRes.data;

  // 2. Set defaults
  const setDefRes = await f.request('/api/document-studio/defaults', {
    method: 'PATCH',
    body: {
      masterCvId: cvDoc.id,
      cvTemplateId: tplDoc.id,
    },
  });
  assert.equal(setDefRes.status, 200);
  assert.equal(setDefRes.data.masterCvId, cvDoc.id);
  assert.equal(setDefRes.data.cvTemplateId, tplDoc.id);

  // 3. Verify defaults persist across app restart with same dataDir
  await f.restart();
  await f.login();

  const getDefRes = await f.request('/api/document-studio/defaults');
  assert.equal(getDefRes.status, 200);
  assert.equal(getDefRes.data.masterCvId, cvDoc.id);
  assert.equal(getDefRes.data.cvTemplateId, tplDoc.id);

  // 4. Submitted Document Preservation
  const subRes = await f.request('/api/documents', {
    method: 'POST',
    body: {
      name: 'Submitted-Application.docx',
      kind: 'cv',
      status: 'submitted',
      contentBase64: Buffer.from('Submitted content').toString('base64'),
    },
  });
  assert.equal(subRes.status, 201);
  const subDoc = subRes.data;

  // Attempting to delete submitted document fails with HTTP 409
  const delRes = await f.request(`/api/documents/${subDoc.id}`, {
    method: 'DELETE',
  });
  assert.equal(delRes.status, 409);
  assert.match(delRes.data.error, /submitted/i);

  // Attempting to rename submitted document fails with HTTP 409
  const renameRes = await f.request(`/api/documents/${subDoc.id}`, {
    method: 'PATCH',
    body: { name: 'Renamed-Application.docx' },
  });
  assert.equal(renameRes.status, 409);
  assert.match(renameRes.data.error, /submitted/i);

  // Bulk delete preserves submitted documents
  const bulkDelRes = await f.request(`/api/documents?scope=library&ids=${subDoc.id}`, {
    method: 'DELETE',
  });
  assert.equal(bulkDelRes.status, 200);
  assert.equal(bulkDelRes.data.preservedSubmittedCount, 1);
  assert.equal(bulkDelRes.data.deletedCount, 0);

  // 5. File limit checks (>20MB)
  const largeBuffer = Buffer.alloc(20 * 1024 * 1024 + 1024, 0);
  const largeRes = await f.request('/api/documents', {
    method: 'POST',
    body: {
      name: 'Too-Large.docx',
      contentBase64: largeBuffer.toString('base64'),
    },
  });
  assert.equal(largeRes.status, 413);
});

test('high-fidelity AI document generation preserves two-column sidebar structure, factual candidate history, and saves exact artifact', async t => {
  const codexQueueDir = mkdtempSync(join(tmpdir(), 'knox-hifi-queue-'));
  writeFileSync(join(codexQueueDir, 'status.json'), JSON.stringify({ ready: true, time: Date.now() / 1000 }));
  t.after(() => rmSync(codexQueueDir, { recursive: true, force: true }));

  const f = await fixture(t, { codexQueueDir });
  await f.setup();

  // 1. Configure Codex provider
  const current = (await f.request('/api/buddy/settings')).data;
  await f.request('/api/buddy/settings', {
    method: 'PATCH',
    body: {
      revision: current.revision,
      enabled: true,
      provider: 'codex',
      model: 'default',
    },
  });

  // 2. Create opportunity
  const op = (await f.request('/api/opportunities', {
    method: 'POST',
    body: {
      company: 'Acme Corp',
      role: 'Principal Systems Architect',
      description: 'Looking for a distributed systems leader with strong consensus experience.',
    },
  })).data;

  // 3. Upload candidate source CV with verified facts
  const source = (await f.request('/api/documents', {
    method: 'POST',
    body: {
      name: 'Jane-Doe-CV.txt',
      kind: 'cv',
      contentBase64: Buffer.from(
        'Jane Doe\nStaff Engineer\nExperience: Fictional Corp (2020-2026). Led distributed database architecture and fault-tolerant replication.\nSkills: Distributed Systems, Rust, Go, Raft, Paxos.\nEducation: B.S. Computer Science.',
      ).toString('base64'),
    },
  })).data;

  // 4. Create fictional two-column sidebar Word reference document
  const { Document, Table, TableRow, TableCell, Paragraph, WidthType, Packer } = await import('docx');
  const refDocx = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      width: { size: 30, type: WidthType.PERCENTAGE },
                      children: [
                        new Paragraph('SIDEBAR: Skills & Contact'),
                        new Paragraph('Old Contact: prior.applicant@example.com'),
                        new Paragraph('Old Skill: Legacy Fortran'),
                      ],
                    }),
                    new TableCell({
                      width: { size: 70, type: WidthType.PERCENTAGE },
                      children: [
                        new Paragraph('MAIN: Professional Experience'),
                        new Paragraph('Old Company XYZ: Junior Developer (2010-2015)'),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        },
      ],
    }),
  );

  const style = (await f.request('/api/documents', {
    method: 'POST',
    body: {
      name: 'Sidebar-Reference.docx',
      kind: 'cv',
      category: 'template',
      contentBase64: refDocx.toString('base64'),
    },
  })).data;

  // 5. Tailor CV with high-fidelity document generation
  const base = `/api/opportunities/${op.id}/buddy`;
  const chatPromise = f.request(base + '/chat', {
    method: 'POST',
    body: {
      action: 'cv',
      message: 'Tailor a high-fidelity CV highlighting distributed systems.',
      autoTailor: true,
      templateLayout: 'classic',
      sourceCvId: source.id,
      styleDocumentId: style.id,
      styleDocumentRevision: style.revision,
      documentIds: [],
      includeOtherOpportunities: false,
      requestId: 'fictional-hifi-cv',
    },
  });

  // Mock Codex worker processes the job
  let reqFile;
  for (let i = 0; i < 50; i++) {
    reqFile = readdirSync(codexQueueDir).find((n) => n.endsWith('.request.json'));
    if (reqFile) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(reqFile, 'Request file was staged in Codex queue');
  const reqData = JSON.parse(readFileSync(join(codexQueueDir, reqFile), 'utf8'));
  assert.equal(reqData.kind, 'document-generation');
  assert.ok(reqData.jobDir);
  assert.ok(existsSync(join(reqData.jobDir, 'inputs', 'reference.docx')));
  assert.ok(existsSync(join(reqData.jobDir, 'inputs', 'source_cv.txt')));
  assert.ok(existsSync(join(reqData.jobDir, 'inputs', 'job_context.json')));
  assert.ok(existsSync(join(reqData.jobDir, 'workspace', 'draft.docx')));

  // Verify staged source CV facts
  const stagedSourceCv = readFileSync(join(reqData.jobDir, 'inputs', 'source_cv.txt'), 'utf8');
  assert.match(stagedSourceCv, /Jane Doe/);
  assert.match(stagedSourceCv, /Fictional Corp/);

  // Worker generates output Word document preserving two-column sidebar structure
  const tailoredDocx = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      width: { size: 30, type: WidthType.PERCENTAGE },
                      children: [
                        new Paragraph('SIDEBAR: Core Competencies'),
                        new Paragraph('Distributed Systems, Raft, Paxos'),
                        new Paragraph('Rust, Go'),
                      ],
                    }),
                    new TableCell({
                      width: { size: 70, type: WidthType.PERCENTAGE },
                      children: [
                        new Paragraph('Jane Doe - Principal Systems Architect'),
                        new Paragraph(
                          'Fictional Corp (2020-2026): Led distributed database architecture and fault-tolerant replication.',
                        ),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        },
      ],
    }),
  );

  writeFileSync(join(reqData.jobDir, 'workspace', 'output.docx'), tailoredDocx);
  writeFileSync(
    join(codexQueueDir, reqFile.replace('.request.json', '.response.json')),
    JSON.stringify({
      output: JSON.stringify({
        outputDocx: 'output.docx',
        pageCount: 2,
        notes: 'Preserved two-column sidebar format with verified candidate facts.',
      }),
      timings: { executionMs: 320 },
      usage: { input_tokens: 280, output_tokens: 110 },
    }),
  );

  const chatResult = await chatPromise;
  assert.equal(chatResult.status, 200);
  const reply = chatResult.data.messages.at(-1);
  assert.ok(reply.artifactBytes);
  assert.equal(reply.artifactManifest.pageCount, 2);
  assert.match(reply.content, /Sidebar-Reference\.docx/);

  // 6. Save the draft
  const saveResult = await f.request(base + '/draft/' + reply.id, {
    method: 'POST',
    body: {
      title: reply.draft.title,
      content: reply.draft.content,
    },
  });
  assert.equal(saveResult.status, 200);
  const doc = saveResult.data.opportunity.documents.at(-1);
  assert.equal(doc.generation.layout, 'artifact');
  assert.equal(doc.generation.styleMatch, 'artifact');
  assert.equal(doc.generation.artifactManifest.pageCount, 2);

  // 7. Verify exact artifact bytes and structural OpenXML XML inspection
  const jszip = (await import('jszip')).default;
  const docxData = (await f.request(doc.url, { binary: true })).data;
  assert.deepEqual(docxData, tailoredDocx);

  const zip = await jszip.loadAsync(docxData);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /<w:tbl[\s>]/);
  assert.match(xml, /<w:tc[\s>]/);
  assert.match(xml, /SIDEBAR: Core Competencies/);
  assert.match(xml, /Jane Doe - Principal Systems Architect/);
  assert.match(xml, /Fictional Corp/);
  assert.doesNotMatch(xml, /prior\.applicant@example\.com/);
  assert.doesNotMatch(xml, /Junior Developer/);
  assert.doesNotMatch(xml, /Legacy Fortran/);

  // 8. Idempotent repeated save
  const repeatSave = await f.request(base + '/draft/' + reply.id, {
    method: 'POST',
    body: {
      title: reply.draft.title,
      content: reply.draft.content,
    },
  });
  assert.equal(repeatSave.status, 200);
  assert.equal(repeatSave.data.opportunity.documents.length, 1);

  // 9. Style document change produces 409 conflict
  await f.request(`/api/documents/${style.id}`, {
    method: 'PATCH',
    body: { revision: style.revision, notes: 'Modified style metadata' },
  });
  const staleSave = await f.request(base + '/draft/' + reply.id, {
    method: 'POST',
    body: {
      title: 'New Title',
      content: reply.draft.content,
    },
  });
  assert.equal(staleSave.status, 409);
});

test("opportunity AI description summary generates ~100-word summary, checks prerequisites, and persists edits", async (t) => {
  let promptSeen = "";
  const f = await fixture(t, {
    buddyFetch: async (_, opts) => {
      promptSeen = opts.body;
      return buddyResponse(
        buddyReply({
          reply:
            "Lead systems architect responsible for end-to-end cloud infrastructure, microservices migration, and technical governance. Coordinates senior engineers and aligns delivery with business stakeholders. Requires 7+ years distributed systems, Go, Kubernetes, and AWS experience.\n\n### Top 5 Skills\n- Distributed systems architecture\n- Go and Python backend engineering\n- Kubernetes container orchestration\n- AWS cloud platforms and Terraform\n- Technical governance and architecture standards\n\n### Key Responsibilities\n- Lead cloud infrastructure modernization\n- Architect scalable microservices\n- Establish engineering standards and code quality benchmarks\n- Mentor senior engineers and conduct architecture reviews\n- Partner with business stakeholders to align delivery",
        }),
      );
    },
  });
  await f.setup();

  // Create opportunity without description
  const created = (
    await f.request("/api/opportunities", {
      method: "POST",
      body: { company: "Acme Cloud", role: "Principal Architect" },
    })
  ).data;

  // 1. Fails when description is missing
  const noDesc = await f.request(
    `/api/opportunities/${created.id}/description-summary`,
    { method: "POST" },
  );
  assert.equal(noDesc.status, 400);
  assert.match(noDesc.data.error, /Job description is empty/i);

  // Update opportunity with job description
  const updated = (
    await f.request(`/api/opportunities/${created.id}`, {
      method: "PATCH",
      body: {
        revision: created.revision,
        description:
          "Acme Cloud is hiring a Principal Architect. You will lead cloud infrastructure modernisation, microservices architecture, and technical governance across cross-functional engineering teams. Key requirements include 7+ years with distributed systems, Go, Kubernetes, and AWS.",
      },
    })
  ).data;

  // 2. Fails when Career Buddy is disabled
  const disabledBuddy = await f.request(
    `/api/opportunities/${updated.id}/description-summary`,
    { method: "POST" },
  );
  assert.equal(disabledBuddy.status, 400);
  assert.match(disabledBuddy.data.error, /Career Buddy is disabled/i);

  // Enable Career Buddy
  await enableBuddy(f);

  // 3. Successfully generates ~100-word summary
  const genRes = await f.request(
    `/api/opportunities/${updated.id}/description-summary`,
    { method: "POST" },
  );
  assert.equal(genRes.status, 200);
  assert.ok(genRes.data.aiSummary);
  assert.match(genRes.data.aiSummary, /cloud infrastructure/i);
  assert.match(genRes.data.aiSummary, /Top 5 Skills/i);
  assert.match(genRes.data.aiSummary, /Key Responsibilities/i);
  assert.ok(genRes.data.aiSummaryGeneratedAt);
  assert.ok(promptSeen.includes("Acme Cloud is hiring a Principal Architect"));
  assert.ok(promptSeen.includes("Top 5 Skills"));
  assert.ok(promptSeen.includes("Key Responsibilities"));

  // 4. Edits to aiSummary persist via PATCH /api/opportunities/:id
  const patchRes = await f.request(`/api/opportunities/${updated.id}`, {
    method: "PATCH",
    body: {
      revision: genRes.data.revision,
      aiSummary: "Refined 100-word executive summary: Lead cloud architect role at Acme Cloud.",
    },
  });
  assert.equal(patchRes.status, 200);
  assert.equal(
    patchRes.data.aiSummary,
    "Refined 100-word executive summary: Lead cloud architect role at Acme Cloud.",
  );

  // 5. State survives restart
  await f.restart();
  await f.login();
  const loaded = (await f.request(`/api/opportunities/${updated.id}`)).data;
  assert.equal(
    loaded.aiSummary,
    "Refined 100-word executive summary: Lead cloud architect role at Acme Cloud.",
  );
  assert.equal(loaded.aiSummaryGeneratedAt, genRes.data.aiSummaryGeneratedAt);
});

test("global settings for applications & exports folder migrates opportunity documents and supports alias", async (t) => {
  const f = await fixture(t);
  await f.setup();

  // Create an opportunity and add a document to it
  const op = (
    await f.request("/api/opportunities", {
      method: "POST",
      body: { company: "GlobalCorp", role: "Staff Engineer" },
    })
  ).data;

  const doc = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        opportunityId: op.id,
        name: "Tailored-CV.docx",
        kind: "cv",
        contentBase64: Buffer.from("DOCX-TEST-BYTES").toString("base64"),
      },
    })
  ).data;

  const getStoredDoc = (id) => JSON.parse(f.app.db.prepare("SELECT data FROM documents WHERE id=?").get(id).data);
  const storedBefore = getStoredDoc(doc.id);
  assert.ok(storedBefore.relativePath.startsWith("opportunities/globalcorp/staff-engineer/"));
  const initialDiskPath = (await import("node:path")).join(f.options.filesDir, storedBefore.relativePath);
  assert.equal((await import("node:fs")).existsSync(initialDiskPath), true);

  // Update exports folder via PATCH /api/settings using exportsSubdir alias
  const updated = await f.request("/api/settings", {
    method: "PATCH",
    body: { exportsSubdir: "applications-export" },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.documentsSubdir, "applications-export");

  // Document record in SQLite updated to new path
  const storedAfter = getStoredDoc(doc.id);
  assert.ok(storedAfter.relativePath.startsWith("applications-export/globalcorp/staff-engineer/"));

  // Old file moved to new location on disk
  const newDiskPath = (await import("node:path")).join(f.options.filesDir, storedAfter.relativePath);
  assert.equal((await import("node:fs")).existsSync(newDiskPath), true);
  assert.equal((await import("node:fs")).existsSync(initialDiskPath), false);
  assert.equal((await import("node:fs")).readFileSync(newDiskPath, "utf8"), "DOCX-TEST-BYTES");

  // Document download endpoint continues to serve content from new location
  const downloaded = await f.request(doc.url);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.data, "DOCX-TEST-BYTES");
});

test("full-disk application exports folder configuration, browsing, validation, and document migration", async (t) => {
  const f = await fixture(t);
  await f.setup();

  // 1. System folders browse endpoint returns current path, presets, and folders
  const folderList = await f.request("/api/system/folders");
  assert.equal(folderList.status, 200);
  assert.ok(typeof folderList.data.currentPath === "string");
  assert.ok(Array.isArray(folderList.data.presets));
  assert.ok(Array.isArray(folderList.data.volumes));
  assert.ok(folderList.data.presets.some((p) => p.label === "Home" || p.label === "Document workspace"));

  // 1b. Test browsing with a nonexistent path sets notFound: true and falls back to home
  const notFoundRes = await f.request("/api/system/folders?path=/nonexistent-test-folder-" + Date.now());
  assert.equal(notFoundRes.status, 200);
  assert.equal(notFoundRes.data.notFound, true);

  // 2. Reject relative path for exportsPath with clear error
  const rejectRel = await f.request("/api/settings", {
    method: "PATCH",
    body: { exportsPath: "relative-path/not-allowed" },
  });
  assert.equal(rejectRel.status, 400);
  assert.match(rejectRel.data.error, /absolute full-disk path/i);

  // 3. Create a unique custom full-disk export root
  const customRoot = (await import("node:path")).join(tmpdir(), "oppknox-custom-exports-" + Date.now());
  const existsSync = (await import("node:fs")).existsSync;
  const readFileSync = (await import("node:fs")).readFileSync;

  // 4. Create opportunity and document while on default workspace
  const op = (
    await f.request("/api/opportunities", {
      method: "POST",
      body: { company: "Acme Corp", role: "Principal Architect", status: "applied" },
    })
  ).data;
  const doc = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        opportunityId: op.id,
        name: "Acme-CV.docx",
        kind: "cv",
        contentBase64: Buffer.from("ACME-INITIAL-CV").toString("base64"),
      },
    })
  ).data;

  const getStoredDoc = (id) => JSON.parse(f.app.db.prepare("SELECT data FROM documents WHERE id=?").get(id).data);
  const stored1 = getStoredDoc(doc.id);
  assert.ok(stored1.relativePath.includes("acme-corp/principal-architect/"));

  // 5. Update settings to point exportsPath to full disk folder
  const patched = await f.request("/api/settings", {
    method: "PATCH",
    body: { exportsPath: customRoot },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.exportsPath, customRoot);
  assert.equal(patched.data.resolvedExportsPath, customRoot);
  assert.equal(existsSync(customRoot), true);

  // Document migrated to full disk directory
  const stored2 = getStoredDoc(doc.id);
  assert.equal(stored2.storageRoot, customRoot);
  const fileOnCustomDisk = (await import("node:path")).join(customRoot, stored2.relativePath);
  assert.equal(existsSync(fileOnCustomDisk), true);
  assert.equal(readFileSync(fileOnCustomDisk, "utf8"), "ACME-INITIAL-CV");

  // Document download endpoint continues to serve from full-disk location
  const downloaded = await f.request(doc.url);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.data, "ACME-INITIAL-CV");

  // Opportunity outputFolder displays the full disk path
  const fullOpp = (await f.request(`/api/opportunities/${op.id}`)).data;
  assert.ok(fullOpp.outputFolder.startsWith(customRoot));

  // 6. Creating a new document while full-disk is active writes directly to full-disk folder
  const doc2 = (
    await f.request("/api/documents", {
      method: "POST",
      body: {
        opportunityId: op.id,
        name: "Cover-Letter.pdf",
        kind: "cover",
        contentBase64: Buffer.from("COVER-LETTER-FULLDISK").toString("base64"),
      },
    })
  ).data;
  const storedDoc2 = getStoredDoc(doc2.id);
  assert.equal(storedDoc2.storageRoot, customRoot);
  const doc2Disk = (await import("node:path")).join(customRoot, storedDoc2.relativePath);
  assert.equal(existsSync(doc2Disk), true);
  assert.equal(readFileSync(doc2Disk, "utf8"), "COVER-LETTER-FULLDISK");

  // 7. Renaming company/role moves documents within full-disk folder
  const currentOpp = (await f.request(`/api/opportunities/${op.id}`)).data;
  const renamed = await f.request(`/api/opportunities/${op.id}`, {
    method: "PATCH",
    body: { revision: currentOpp.revision, role: "Chief Architect" },
  });
  assert.equal(renamed.status, 200);
  const storedAfterRename = getStoredDoc(doc.id);
  assert.ok(storedAfterRename.relativePath.includes("chief-architect"));
  const renamedFileDisk = (await import("node:path")).join(customRoot, storedAfterRename.relativePath);
  assert.equal(existsSync(renamedFileDisk), true);
  assert.equal(readFileSync(renamedFileDisk, "utf8"), "ACME-INITIAL-CV");

  // 8. System folders subfolder creation
  const createdSub = await f.request("/api/system/folders", {
    method: "POST",
    body: { parentPath: customRoot, name: "SubTest" },
  });
  assert.equal(createdSub.status, 200);
  assert.equal(existsSync((await import("node:path")).join(customRoot, "SubTest")), true);

  // 9. Resetting exportsPath to "" moves documents back to workspace default
  const resetSettings = await f.request("/api/settings", {
    method: "PATCH",
    body: { exportsPath: "" },
  });
  assert.equal(resetSettings.status, 200);
  assert.equal(resetSettings.data.exportsPath, "");
  const storedAfterReset = getStoredDoc(doc.id);
  const realFilesDir = (await import("node:fs")).realpathSync(f.options.filesDir);
  assert.equal(storedAfterReset.storageRoot, realFilesDir);
  const backInWorkspace = (await import("node:path")).join(realFilesDir, storedAfterReset.relativePath);
  assert.equal(existsSync(backInWorkspace), true);
  assert.equal(readFileSync(backInWorkspace, "utf8"), "ACME-INITIAL-CV");
});

test('library refresh reconciles disk changes without deleting master or submitted records and discovers only library files', async t => {
  const f = await fixture(t); await f.setup();
  const upload = async (name, category, status='') => (await f.request('/api/documents', {method:'POST', body:{name,category,status,kind:'cv',contentBase64:Buffer.from('Fictional career evidence').toString('base64')}})).data;
  const master = await upload('Master.docx','master-cv');
  const deleted = await upload('Old.docx','reference-cv');
  const changed = await upload('Updated.txt','note');
  const submitted = await upload('Submitted.txt','reference-cv','submitted');
  const stable = await upload('Stable.txt','note');
  await f.request('/api/buddy/index',{method:'POST',body:{documentIds:[stable.id]}});
  const db = new DatabaseSync(join(f.options.dataDir,'board.sqlite'));
  const stored = id => JSON.parse(db.prepare('SELECT data FROM documents WHERE id=?').get(id).data);
  const path = id => {const d=stored(id); return join(d.storageRoot,d.relativePath);};
  rmSync(path(master.id)); rmSync(path(deleted.id));
  writeFileSync(path(changed.id),'Changed fictional evidence');
  writeFileSync(path(submitted.id),'Externally modified snapshot');
  const library = dirname(path(changed.id));
  writeFileSync(join(library,'Master_cover_letter.txt'),'Fictional cover');
  writeFileSync(join(f.options.filesDir,'do-not-import.txt'),'Private outside library');
  symlinkSync(join(f.options.filesDir,'do-not-import.txt'),join(library,'skip-link.txt'));
  const refresh=await f.request('/api/documents/refresh',{method:'POST',body:{}});
  assert.equal(refresh.status,200); assert.equal(refresh.data.missing,2); assert.equal(refresh.data.changed,2); assert.equal(refresh.data.added,1);
  let docs=(await f.request('/api/documents')).data.documents;
  assert.equal(docs.find(d=>d.id===master.id).storageState,'missing');
  assert.equal(docs.find(d=>d.id===submitted.id).storageState,'changed');
  assert.equal(stored(submitted.id).sha256,createHash('sha256').update('Fictional career evidence').digest('hex'));
  assert.equal(docs.find(d=>d.name==='Master_cover_letter.txt').category,'master-cover-letter');
  assert.equal(docs.length,6);
  assert.ok(db.prepare('SELECT data FROM document_text WHERE id=?').get(stable.id), 'unchanged text stays prepared after refresh');
  assert.equal((await f.request('/api/documents/refresh',{method:'POST',body:{}})).data.added,0);
  writeFileSync(join(library,stored(master.id).relativePath.split('/').pop()),'Fictional career evidence');
  await f.request('/api/documents/refresh',{method:'POST',body:{}});
  assert.equal(stored(master.id).storageState,'available');
  db.close(); await f.restart(); await f.login();
  docs=(await f.request('/api/documents')).data.documents;
  assert.equal(docs.find(d=>d.id===deleted.id).storageState,'missing');
});

test('opportunity references are exact idempotent library copies; paste checks stale revisions', async t => {
  const f=await fixture(t); await f.setup();
  const opp=(await f.request('/api/opportunities',{method:'POST',body:opportunity})).data;
  for(const kind of ['cv','cover']) {
    const source=(await f.request('/api/documents',{method:'POST',body:{name:`Application-${kind}.txt`,kind,opportunityId:opp.id,status:'submitted',contentBase64:Buffer.from(`Exact fictional ${kind}`).toString('base64')}})).data;
    const url=`/api/documents/${source.id}/reference`;
    assert.equal((await f.request(url,{method:'POST',body:{revision:99}})).status,409);
    const saved=await f.request(url,{method:'POST',body:{revision:source.revision}});
    assert.equal(saved.status,201); assert.equal(saved.data.opportunityId,''); assert.equal(saved.data.category,kind==='cv'?'reference-cv':'reference-cover');
    assert.equal((await f.request(url,{method:'POST',body:{revision:source.revision}})).data.id,saved.data.id);
    const bytes=(await f.request(`/api/documents/${saved.data.id}/content`,{binary:true})).data;
    assert.equal(bytes.toString(),`Exact fictional ${kind}`);
    const copy=await f.request(`/api/documents/${saved.data.id}/duplicate`,{method:'POST',body:{revision:saved.data.revision,name:'Projects/Copy.txt',category:'project'}});
    assert.equal(copy.status,201); assert.equal(copy.data.name,'Projects/Copy.txt'); assert.equal(copy.data.category,'project');
    assert.equal((await f.request(`/api/documents/${saved.data.id}/duplicate`,{method:'POST',body:{revision:99}})).status,409);
    assert.equal((await f.request(`/api/documents/${source.id}`,{method:'DELETE'})).status,409);
  }
});

test('vault cleanup previews stale exports, detects edits and archives only marked orphan files',async t=>{
 const f=await fixture(t);await f.setup();
 const doc=(await f.request('/api/documents',{method:'POST',body:{name:'Fictional.pdf',kind:'cv',contentBase64:Buffer.from('Fictional bytes').toString('base64')}})).data;
 assert.equal((await f.request('/api/obsidian/configure',{method:'POST',body:{action:'create',subpath:'vault',vaultName:'Fictional Vault'}})).status,200);
 await f.request('/api/obsidian/import-to-vault',{method:'POST',body:{includeExtractedText:false}});
 const vault=join(f.options.filesDir,'vault');writeFileSync(join(vault,'Personal.md'),'Unrelated personal note');
 assert.deepEqual((await f.request('/api/obsidian/cleanup',{method:'POST',body:{}})).data.files,[]);
 await f.request(`/api/documents/${doc.id}`,{method:'DELETE'});
 const plan=(await f.request('/api/obsidian/cleanup',{method:'POST',body:{}})).data;
 assert.equal(plan.files.length,2);
 const note=plan.files.find(p=>p.endsWith('.md'));writeFileSync(join(vault,note),readFileSync(join(vault,note),'utf8')+'\nEdited in vault');
 assert.equal((await f.request('/api/obsidian/cleanup',{method:'POST',body:{token:plan.token}})).status,409);
 const fresh=(await f.request('/api/obsidian/cleanup',{method:'POST',body:{}})).data;
 const result=await f.request('/api/obsidian/cleanup',{method:'POST',body:{token:fresh.token}});
 assert.equal(result.status,200);assert.equal(result.data.removedCount,2);
 for(const path of fresh.files){assert.equal(existsSync(join(vault,path)),false);assert.equal(existsSync(join(vault,result.data.archive,path)),true);}
 assert.equal(readFileSync(join(vault,'Personal.md'),'utf8'),'Unrelated personal note');
 assert.deepEqual((await f.request('/api/obsidian/cleanup',{method:'POST',body:{}})).data.files,[]);
});

test('vault sync inventory persists actual transfers and detects separate changes and missing files', async t => {
 const f=await fixture(t);await f.setup();
 const doc=(await f.request('/api/documents',{method:'POST',body:{name:'Fictional.txt',kind:'cv',contentBase64:Buffer.from('Original fictional text').toString('base64')}})).data;
 await f.request('/api/obsidian/configure',{method:'POST',body:{action:'create',subpath:'inventory-vault',vaultName:'Inventory'}});
 assert.equal((await f.request('/api/obsidian/sync-inventory')).data.entries.length,0);
 await f.request('/api/obsidian/import-to-vault',{method:'POST',body:{includeExtractedText:false}});
 let entry=(await f.request('/api/obsidian/sync-inventory')).data.entries[0];
 assert.equal(entry.documentId,doc.id);assert.equal(entry.vaultPath,'Career Library/Fictional.md');assert.equal(entry.localChanged,false);assert.equal(entry.vaultChanged,false);assert.notEqual(entry.localHash,entry.vaultHash);
 const note=join(f.options.filesDir,'inventory-vault',entry.vaultPath);writeFileSync(note,readFileSync(note,'utf8')+'\nEdited');
 entry=(await f.request('/api/obsidian/sync-inventory')).data.entries[0];assert.equal(entry.vaultChanged,true);assert.equal(entry.localChanged,false);
 await f.restart();await f.login();entry=(await f.request('/api/obsidian/sync-inventory')).data.entries[0];assert.equal(entry.vaultChanged,true);
 rmSync(note);entry=(await f.request('/api/obsidian/sync-inventory')).data.entries[0];assert.equal(entry.vaultExists,false);assert.equal(entry.localExists,true);
});

test('vault exports use distinct stable paths for documents with the same note name',async t=>{
 const f=await fixture(t);await f.setup();
 for(const name of ['Fictional.txt','Fictional.md']) await f.request('/api/documents',{method:'POST',body:{name,contentBase64:Buffer.from('Fictional content').toString('base64')}});
 await f.request('/api/obsidian/configure',{method:'POST',body:{action:'create',subpath:'inventory-conflict'}});
 await f.request('/api/obsidian/import-to-vault',{method:'POST',body:{includeExtractedText:false}});
 const inventory=(await f.request('/api/obsidian/sync-inventory')).data;
 assert.equal(inventory.entries.length,2);assert.deepEqual(inventory.ambiguousPaths,[]);assert.equal(new Set(inventory.entries.map(e=>e.vaultPath)).size,2);
 const hub=readFileSync(join(f.options.filesDir,'inventory-conflict','00 - Opportunity Knox Hub.md'),'utf8');for(const entry of inventory.entries) assert.ok(hub.includes(entry.vaultPath.replace(/\.md$/i,'')));
});

test('vault sync review detects both-sided conflicts and rejects stale previews', async t=>{
 const f=await fixture(t);await f.setup();
 const doc=(await f.request('/api/documents',{method:'POST',body:{name:'Review.txt',kind:'cv',contentBase64:Buffer.from('Fictional original').toString('base64')}})).data;
 await f.request('/api/obsidian/configure',{method:'POST',body:{action:'create',subpath:'review-vault'}});
 let review=(await f.request('/api/obsidian/sync-preview',{method:'POST',body:{}})).data;
 assert.equal(review.changes.find(c=>c.documentId===doc.id).type,'unlinked-local');
 await f.request('/api/obsidian/import-to-vault',{method:'POST',body:{includeExtractedText:false}});
 review=(await f.request('/api/obsidian/sync-preview',{method:'POST',body:{}})).data;
 assert.equal(review.changes.find(c=>c.documentId===doc.id).type,'unchanged');
 assert.equal((await f.request('/api/obsidian/sync-preview',{method:'POST',body:{token:review.token}})).status,200);
 const db=new DatabaseSync(join(f.options.dataDir,'board.sqlite'));const d=JSON.parse(db.prepare('SELECT data FROM documents WHERE id=?').get(doc.id).data);
 writeFileSync(join(d.storageRoot,d.relativePath),'Changed locally');
 const note=join(f.options.filesDir,'review-vault','Career Library','Review.md');writeFileSync(note,readFileSync(note,'utf8')+'\nChanged in vault');
 assert.equal((await f.request('/api/obsidian/sync-preview',{method:'POST',body:{token:review.token}})).status,409);
 review=(await f.request('/api/obsidian/sync-preview',{method:'POST',body:{}})).data;
 assert.equal(review.changes.find(c=>c.documentId===doc.id).type,'conflict');
 mkdirSync(join(f.options.filesDir,'review-vault','OppKnox Inbox'),{recursive:true});writeFileSync(join(f.options.filesDir,'review-vault','OppKnox Inbox','Unlinked.md'),'Own note');
 assert.equal((await f.request('/api/obsidian/sync-preview',{method:'POST',body:{token:review.token}})).status,409);
 db.close();
});

test('wipe vault previews managed files, rejects stale plans and preserves other notes',async t=>{
 const f=await fixture(t);await f.setup();
 await f.request('/api/documents',{method:'POST',body:{name:'Fictional.pdf',kind:'cv',contentBase64:Buffer.from('Fictional PDF').toString('base64')}});
 await f.request('/api/obsidian/configure',{method:'POST',body:{action:'create',subpath:'wipe-vault'}});
 await f.request('/api/obsidian/import-to-vault',{method:'POST',body:{includeExtractedText:false}});
 const vault=join(f.options.filesDir,'wipe-vault');writeFileSync(join(vault,'Personal.md'),'Private fictional note');
 const plan=(await f.request('/api/obsidian/wipe',{method:'POST',body:{}})).data;
 assert.equal(plan.files.length,3);assert.equal(plan.files.includes('Personal.md'),false);
 const note=plan.files.find(path=>path.startsWith('Career Library/'));writeFileSync(join(vault,note),readFileSync(join(vault,note),'utf8')+'\nChange');
 assert.equal((await f.request('/api/obsidian/wipe',{method:'POST',body:{token:plan.token}})).status,409);
 const current=(await f.request('/api/obsidian/wipe',{method:'POST',body:{}})).data;
 const result=await f.request('/api/obsidian/wipe',{method:'POST',body:{token:current.token}});
 assert.equal(result.status,200);assert.equal(result.data.removedCount,3);
 for(const path of current.files){assert.equal(existsSync(join(vault,path)),false);assert.equal(existsSync(join(vault,result.data.archive,path)),true);}
 assert.equal(readFileSync(join(vault,'Personal.md'),'utf8'),'Private fictional note');
 assert.equal((await f.request('/api/obsidian/wipe',{method:'POST',body:{}})).data.files.length,0);
});

test('Obsidian Inbox reviews explicit new files once and excludes linked attachments and other vault notes',async t=>{
 const f=await fixture(t);await f.setup();
 await f.request('/api/documents',{method:'POST',body:{name:'Fictional.pdf',kind:'cv',contentBase64:Buffer.from('Fictional PDF').toString('base64')}});
 await f.request('/api/obsidian/configure',{method:'POST',body:{action:'create',subpath:'inbox-vault'}});
 await f.request('/api/obsidian/import-to-vault',{method:'POST',body:{includeExtractedText:false}});
 const vault=join(f.options.filesDir,'inbox-vault');
 const companion=join(vault,'Career Library','Fictional.md');writeFileSync(companion,readFileSync(companion,'utf8')+'\nPersonal supporting note');
 let changes=(await f.request('/api/obsidian/sync-preview',{method:'POST',body:{}})).data.changes;
 assert.ok(changes.some(c=>c.type==='companion-changed'&&c.vaultPath==='Career Library/Fictional.md'));
 writeFileSync(join(vault,'Personal.md'),'Unrelated fictional note');
 const inbox=join(vault,'OppKnox Inbox','Achievement.md');writeFileSync(inbox,'A fictional achievement');
 let review=(await f.request('/api/obsidian/inbox',{method:'POST',body:{}})).data;
 assert.deepEqual(review.files.map(f=>f.path),['OppKnox Inbox/Achievement.md']);
 writeFileSync(inbox,'An updated fictional achievement');
 assert.equal((await f.request('/api/obsidian/inbox',{method:'POST',body:{token:review.token}})).status,409);
 review=(await f.request('/api/obsidian/inbox',{method:'POST',body:{}})).data;
 const imported=await f.request('/api/obsidian/inbox',{method:'POST',body:{token:review.token}});
 assert.equal(imported.status,200);assert.equal(imported.data.importedCount,1);
 assert.equal((await f.request('/api/obsidian')).data.linkedDocuments,2);
 assert.equal((await f.request('/api/obsidian/wipe',{method:'POST',body:{}})).data.files.includes('OppKnox Inbox/Achievement.md'),false);
 assert.deepEqual((await f.request('/api/obsidian/inbox',{method:'POST',body:{}})).data.files,[]);
 await f.request('/api/obsidian/sync-from-vault',{method:'POST',body:{autoPrepare:false}});
 await f.request('/api/obsidian/import-to-vault',{method:'POST',body:{includeExtractedText:false}});
 assert.match(readFileSync(companion,'utf8'),/Personal supporting note/);
 writeFileSync(inbox,'Edited later in Obsidian');
 await f.request('/api/obsidian/sync-from-vault',{method:'POST',body:{autoPrepare:false}});
 assert.equal((await f.request('/api/documents')).data.documents.filter(d=>!d.opportunityId).length,2);
 assert.equal((await f.request('/api/obsidian/sync-inventory')).data.entries.find(e=>e.vaultPath==='OppKnox Inbox/Achievement.md').vaultChanged,true);
 assert.equal(readFileSync(join(vault,'Personal.md'),'utf8'),'Unrelated fictional note');
});

test('linked vault versions sync one-sided edits with recoverable originals and reject conflicts',async t=>{
 const f=await fixture(t);await f.setup();
 const doc=(await f.request('/api/documents',{method:'POST',body:{name:'Tracked.md',kind:'cv',contentBase64:Buffer.from('Original fictional text').toString('base64')}})).data;
 await f.request('/api/obsidian/configure',{method:'POST',body:{action:'create',subpath:'linked-vault'}});
 await f.request('/api/obsidian/import-to-vault',{method:'POST',body:{includeExtractedText:false}});
 const vault=join(f.options.filesDir,'linked-vault'),note=join(vault,'Career Library','Tracked.md');
 writeFileSync(note,readFileSync(note,'utf8')+'\nVault edit');
 let review=(await f.request('/api/obsidian/sync-preview',{method:'POST',body:{}})).data;
 assert.equal(review.changes.find(c=>c.documentId===doc.id).type,'changed-vault');
 const result=await f.request('/api/obsidian/import-linked-change',{method:'POST',body:{token:review.token,documentId:doc.id}});
 assert.equal(result.status,200);assert.ok(result.data.backup);
 assert.equal(readFileSync(join(f.options.filesDir,'backups',result.data.backup,'documents',doc.id),'utf8'),'Original fictional text');
 assert.match((await f.request(`/api/documents/${doc.id}/content`,{binary:true})).data.toString(),/Vault edit/);
 const db=new DatabaseSync(join(f.options.dataDir,'board.sqlite'));const stored=JSON.parse(db.prepare('SELECT data FROM documents WHERE id=?').get(doc.id).data);const local=join(stored.storageRoot,stored.relativePath);
 writeFileSync(local,'Local fictional edit');await f.request('/api/documents/refresh',{method:'POST',body:{}});
 review=(await f.request('/api/obsidian/sync-preview',{method:'POST',body:{}})).data;
 assert.equal(review.changes.find(c=>c.documentId===doc.id).type,'changed-local');
 const pushed=await f.request('/api/obsidian/export-linked-change',{method:'POST',body:{token:review.token,documentId:doc.id}});
 assert.equal(pushed.status,200);assert.equal(readFileSync(note,'utf8'),'Local fictional edit');assert.match(readFileSync(join(vault,pushed.data.archive),'utf8'),/Vault edit/);
 writeFileSync(note,'Vault independently edited');writeFileSync(local,'Local independently edited');
 review=(await f.request('/api/obsidian/sync-preview',{method:'POST',body:{}})).data;assert.equal(review.changes.find(c=>c.documentId===doc.id).type,'conflict');
 assert.equal((await f.request('/api/obsidian/import-linked-change',{method:'POST',body:{token:review.token,documentId:doc.id}})).status,409);
 const legacy=await f.request('/api/obsidian/import-to-vault',{method:'POST',body:{includeExtractedText:false}});
 assert.equal(legacy.data.skippedCount,1);assert.equal(readFileSync(note,'utf8'),'Vault independently edited');assert.equal(readFileSync(local,'utf8'),'Local independently edited');db.close();
});


test('Inbox flags a possible moved linked file instead of importing it twice',async t=>{
 const f=await fixture(t);await f.setup();await f.request('/api/obsidian/configure',{method:'POST',body:{action:'create',subpath:'moves-vault'}});
 const vault=join(f.options.filesDir,'moves-vault'),inbox=join(vault,'OppKnox Inbox');
 writeFileSync(join(inbox,'Original.md'),'Fictional unique text');
 let plan=(await f.request('/api/obsidian/inbox',{method:'POST',body:{}})).data;
 await f.request('/api/obsidian/inbox',{method:'POST',body:{token:plan.token}});
 writeFileSync(join(inbox,'Renamed.md'),readFileSync(join(inbox,'Original.md')));rmSync(join(inbox,'Original.md'));
 plan=(await f.request('/api/obsidian/inbox',{method:'POST',body:{}})).data;
 assert.equal(plan.files.length,0);assert.equal(plan.possibleMoves.length,1);assert.equal(plan.possibleMoves[0].path,'OppKnox Inbox/Renamed.md');
 await f.request('/api/obsidian/sync-from-vault',{method:'POST',body:{autoPrepare:false}});
 assert.equal((await f.request('/api/documents')).data.documents.length,1);
});
