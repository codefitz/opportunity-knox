import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  existsSync,
  readFileSync,
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
  await open();
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  async function request(
    path,
    { method = "GET", body, auth = true, headers = {} } = {},
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
    const data = type.includes("application/json")
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
