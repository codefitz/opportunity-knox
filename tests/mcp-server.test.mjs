import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "knox-mcp-test-"));
  const options = {
    dataDir: join(root, "state"),
    filesDir: join(root, "files"),
    setupToken: "test-setup-token",
    automationEnabled: false,
  };
  const app = createApp(options);
  await new Promise((done) => app.server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = "";

  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  async function request(path, { method = "GET", body, headers = {}, auth = true, token } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(auth && cookie ? { Cookie: cookie } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const type = res.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await res.json() : await res.text();
    return { status: res.status, data };
  }

  async function setup() {
    const res = await request("/api/setup", {
      method: "POST",
      body: { password: "correct horse battery staple", token: "test-setup-token" },
    });
    assert.equal(res.status, 200);
    // login to set session
    const loginRes = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "correct horse battery staple" }),
    });
    cookie = loginRes.headers.get("set-cookie").split(";")[0];
  }

  return { base, request, setup };
}

test("MCP Settings API: view settings, enable, rotate key, and copyable config", async (t) => {
  const f = await fixture(t);
  await f.setup();

  // 1. Initial settings
  const init = await f.request("/api/mcp/settings");
  assert.equal(init.status, 200);
  assert.equal(init.data.enabled, false);
  assert.equal(init.data.hasKey, false);

  // 2. Enable MCP (generates key)
  const enableRes = await f.request("/api/mcp/settings", {
    method: "PATCH",
    body: { enabled: true, allowWrite: true },
  });
  assert.equal(enableRes.status, 200);
  assert.equal(enableRes.data.enabled, true);
  assert.equal(enableRes.data.hasKey, true);
  assert.ok(enableRes.data.apiKey.startsWith("opknox_mcp_"));

  const key1 = enableRes.data.apiKey;

  // 3. Rotate key
  const rotateRes = await f.request("/api/mcp/settings/rotate-key", { method: "POST" });
  assert.equal(rotateRes.status, 200);
  assert.ok(rotateRes.data.apiKey.startsWith("opknox_mcp_"));
  assert.notEqual(rotateRes.data.apiKey, key1);

  // 4. View client config
  const settingsRes = await f.request("/api/mcp/settings");
  assert.equal(settingsRes.status, 200);
  assert.ok(settingsRes.data.clientConfig.mcpServers["opportunity-knox"]);
  assert.equal(settingsRes.data.clientConfig.mcpServers["opportunity-knox"].env.OPKNOX_API_KEY, rotateRes.data.apiKey);
});

test("MCP v1 API: authorization, search, evidence retrieval, revision conflicts, and idempotent fit review", async (t) => {
  const f = await fixture(t);
  await f.setup();

  // Enable MCP
  const setupMcp = await f.request("/api/mcp/settings", {
    method: "PATCH",
    body: { enabled: true, allowWrite: true },
  });
  const apiKey = setupMcp.data.apiKey;

  // 1. Unauthenticated or disabled calls rejected
  assert.equal((await f.request("/api/mcp/v1/opportunities/search", { method: "POST", auth: false })).status, 401);
  assert.equal((await f.request("/api/mcp/v1/opportunities/search", { method: "POST", auth: false, token: "bad-token" })).status, 401);

  // 2. Create opportunity and career documents via standard API
  const op1 = (await f.request("/api/opportunities", {
    method: "POST",
    body: { company: "Acme Systems", role: "Staff Infrastructure Engineer", description: "Distributed consensus and cloud architecture." },
  })).data;

  const op2 = (await f.request("/api/opportunities", {
    method: "POST",
    body: { company: "Beta Corp", role: "Frontend Lead", description: "React and design systems." },
  })).data;

  // Upload verified evidence
  const cvDoc = (await f.request("/api/documents", {
    method: "POST",
    body: {
      name: "Master-CV.txt",
      kind: "cv",
      contentBase64: Buffer.from("Jane Doe\nStaff Engineer\nExperience: Designed Raft-based distributed storage engines at Scale Corp.").toString("base64"),
    },
  })).data;

  // Upload a template (should be excluded from evidence search)
  const templateDoc = (await f.request("/api/documents", {
    method: "POST",
    body: {
      name: "Sidebar-Template.docx",
      kind: "cv",
      category: "template",
      contentBase64: Buffer.from("Example template not candidate facts.").toString("base64"),
    },
  })).data;

  // 3. Tool: search_opportunities
  const searchRes = await f.request("/api/mcp/v1/opportunities/search", {
    method: "POST",
    auth: false,
    token: apiKey,
    body: { query: "infrastructure" },
  });
  assert.equal(searchRes.status, 200);
  assert.equal(searchRes.data.total, 1);
  assert.equal(searchRes.data.opportunities[0].id, op1.id);

  // 4. Tool: get_opportunity
  const getRes = await f.request(`/api/mcp/v1/opportunities/${op1.id}`, {
    auth: false,
    token: apiKey,
  });
  assert.equal(getRes.status, 200);
  assert.equal(getRes.data.opportunity.company, "Acme Systems");
  assert.equal(getRes.data.opportunity.revision, 1);
  assert.equal(getRes.data.opportunity.review, null);

  // 5. Tool: search_career_evidence (excludes template)
  const evSearch = await f.request("/api/mcp/v1/career-evidence/search", {
    method: "POST",
    auth: false,
    token: apiKey,
    body: { query: "distributed storage Raft", opportunityId: op1.id },
  });
  assert.equal(evSearch.status, 200);
  assert.ok(evSearch.data.excerpts.length > 0);
  assert.equal(evSearch.data.excerpts[0].documentId, cvDoc.id);
  assert.match(evSearch.data.excerpts[0].excerpt, /Raft-based distributed storage/);

  // Template should not appear in evidence search
  assert.equal(evSearch.data.excerpts.some((e) => e.documentId === templateDoc.id), false);

  // 6. Tool: read_career_evidence
  const readDoc = await f.request(`/api/mcp/v1/career-evidence/${cvDoc.id}`, {
    auth: false,
    token: apiKey,
  });
  assert.equal(readDoc.status, 200);
  assert.match(readDoc.data.document.text, /Staff Engineer/);

  // Reading a template as evidence is rejected
  const readTpl = await f.request(`/api/mcp/v1/career-evidence/${templateDoc.id}`, {
    auth: false,
    token: apiKey,
  });
  assert.equal(readTpl.status, 400);

  // 7. Tool: save_fit_review
  const reviewBody = {
    opportunityId: op1.id,
    expectedRevision: op1.revision,
    strengths: "Deep expertise in Raft consensus and distributed storage engines matching requirements.",
    gaps: "No direct mentions of Kubernetes operator development; clarify during interview.",
    requestId: "req-fictional-review-1",
  };

  const saveRes = await f.request("/api/mcp/v1/fit-review", {
    method: "POST",
    auth: false,
    token: apiKey,
    body: reviewBody,
  });
  assert.equal(saveRes.status, 200);
  assert.equal(saveRes.data.success, true);
  assert.equal(saveRes.data.revision, op1.revision + 1);

  // Verify review on opportunity
  const updatedOp = await f.request(`/api/mcp/v1/opportunities/${op1.id}`, {
    auth: false,
    token: apiKey,
  });
  assert.equal(updatedOp.data.opportunity.revision, 2);
  assert.match(updatedOp.data.opportunity.review.strengths, /Raft consensus/);
  assert.match(updatedOp.data.opportunity.review.gaps, /Kubernetes operator/);
  // Stage and outcome remain completely unchanged
  assert.equal(updatedOp.data.opportunity.stage, op1.stage);
  assert.equal(updatedOp.data.opportunity.outcome, op1.outcome || "");

  // 8. Idempotent retry with same requestId returns success without duplicate revision increment
  const retryRes = await f.request("/api/mcp/v1/fit-review", {
    method: "POST",
    auth: false,
    token: apiKey,
    body: reviewBody,
  });
  assert.equal(retryRes.status, 200);
  assert.equal(retryRes.data.idempotent, true);
  assert.equal(retryRes.data.revision, 2);

  // Reusing same requestId with conflicting content is rejected
  const conflictReqId = await f.request("/api/mcp/v1/fit-review", {
    method: "POST",
    auth: false,
    token: apiKey,
    body: { ...reviewBody, strengths: "Completely different strengths." },
  });
  assert.equal(conflictReqId.status, 409);

  // 9. Revision conflict detection: passing stale revision (1 instead of 2)
  const staleRes = await f.request("/api/mcp/v1/fit-review", {
    method: "POST",
    auth: false,
    token: apiKey,
    body: {
      opportunityId: op1.id,
      expectedRevision: 1, // Stale!
      strengths: "Fresh review",
      gaps: "None",
      requestId: "req-stale-attempt",
    },
  });
  assert.equal(staleRes.status, 409);

  // 10. Write permission enforcement
  await f.request("/api/mcp/settings", {
    method: "PATCH",
    body: { allowWrite: false },
  });
  const writeBlocked = await f.request("/api/mcp/v1/fit-review", {
    method: "POST",
    auth: false,
    token: apiKey,
    body: {
      opportunityId: op1.id,
      expectedRevision: 2,
      strengths: "Blocked review",
      gaps: "None",
    },
  });
  assert.equal(writeBlocked.status, 403);
});

test("MCP Stdio Adapter: end-to-end Claude Desktop client communication", async (t) => {
  const f = await fixture(t);
  await f.setup();

  const setupMcp = await f.request("/api/mcp/settings", {
    method: "PATCH",
    body: { enabled: true, allowWrite: true },
  });
  const apiKey = setupMcp.data.apiKey;

  const op = (await f.request("/api/opportunities", {
    method: "POST",
    body: { company: "Cloud Solutions Ltd", role: "Principal Architect", description: "Cloud native systems." },
  })).data;

  // Connect real MCP Client to server/mcp-server.mjs over Stdio transport
  const transport = new StdioClientTransport({
    command: "node",
    args: ["server/mcp-server.mjs"],
    env: {
      ...process.env,
      OPKNOX_URL: f.base,
      OPKNOX_API_KEY: apiKey,
    },
  });

  const client = new Client(
    { name: "test-claude-desktop", version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);
  t.after(async () => {
    await transport.close();
  });

  // 1. Tool discovery
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "get_opportunity",
    "read_career_evidence",
    "save_fit_review",
    "search_career_evidence",
    "search_opportunities",
  ]);

  // 2. Call search_opportunities tool
  const searchResult = await client.callTool({
    name: "search_opportunities",
    arguments: { query: "Cloud Solutions" },
  });
  assert.ok(!searchResult.isError);
  const searchJson = JSON.parse(searchResult.content[0].text);
  assert.equal(searchJson.total, 1);
  assert.equal(searchJson.opportunities[0].id, op.id);

  // 3. Call get_opportunity tool
  const getResult = await client.callTool({
    name: "get_opportunity",
    arguments: { id: op.id },
  });
  assert.ok(!getResult.isError);
  const getJson = JSON.parse(getResult.content[0].text);
  assert.equal(getJson.company, "Cloud Solutions Ltd");

  // 4. Call save_fit_review tool
  const saveResult = await client.callTool({
    name: "save_fit_review",
    arguments: {
      opportunityId: op.id,
      expectedRevision: op.revision,
      strengths: "Proven track record in cloud architecture and scalable systems.",
      gaps: "Need clarity on on-call rotation expectations.",
      requestId: "claude-desktop-test-req-1",
    },
  });
  assert.ok(!saveResult.isError);
  const saveJson = JSON.parse(saveResult.content[0].text);
  assert.equal(saveJson.success, true);
  assert.equal(saveJson.revision, op.revision + 1);

  // Verify board review was updated
  const check = await f.request(`/api/mcp/v1/opportunities/${op.id}`, {
    auth: false,
    token: apiKey,
  });
  assert.match(check.data.opportunity.review.strengths, /Proven track record in cloud architecture/);
  assert.match(check.data.opportunity.review.gaps, /clarity on on-call/);
});
