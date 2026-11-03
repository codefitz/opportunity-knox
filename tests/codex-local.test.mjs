import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { codexStatus, runLocalCodex, runCodexDocumentGeneration } from "../server/codex-local.mjs";
import { defaultBuddy, updateBuddy } from "../server/buddy-provider.mjs";
import { Document, Paragraph, Packer } from "docx";
test("Codex provider clears API keys and fixes the internal bridge location", () => {
  const c = updateBuddy(
    { ...defaultBuddy(), apiKey: "fictional-private" },
    {
      revision: 1,
      provider: "codex",
      model: "default",
      enabled: true,
      apiKey: "not-needed",
      baseUrl: "https://other.example",
    },
  );
  assert.equal(c.apiKey, "");
  assert.equal(c.provider, "codex");
  assert.match(c.baseUrl, /codex-local/);
});
test("Codex queue validates readiness and model IDs, returns structured output, cleans private payloads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "knox-codex-test-"));
  try {
    assert.throws(() => codexStatus(dir), { status: 503 });
    writeFileSync(
      join(dir, "status.json"),
      JSON.stringify({ ready: true, time: Date.now() / 1000 }),
    );
    await assert.rejects(runLocalCodex({ model: "--bad" }, "", [], {}, dir), {
      status: 400,
    });
    const diagnostics=[];
    const pending = runLocalCodex(
      { model: "default", reasoningEffort:"low", onDiagnostics:value=>diagnostics.push(value) },
      "Fictional instruction",
      [{ role: "user", content: "Fictional career data" }],
      { type: "object" },
      dir,
    );
    const file = readdirSync(dir).find((n) => n.endsWith(".request.json"));
    const job = JSON.parse(readFileSync(join(dir, file)));
    assert.match(job.prompt, /Fictional career data/);
    assert.equal(job.reasoningEffort,"low");
    writeFileSync(join(dir,file.replace(".request.json",".progress.json")),JSON.stringify({stage:"codex-reasoning",eventCount:3,lastEventAt:Date.now()/1000,issue:"connection"}));
    assert.ok(job.expiresAt > Date.now() / 1000);
    writeFileSync(
      join(dir, file.replace(".request.json", ".response.json")),
      JSON.stringify({ output: '{"ready":true}' }),
    );
    assert.equal(await pending, '{"ready":true}');
    assert.ok(diagnostics.some(value=>value.codexEventCount===3&&value.codexIssue==="connection"));
    assert.deepEqual(readdirSync(dir), ["status.json"]);
    writeFileSync(
      join(dir, "status.json"),
      JSON.stringify({ ready: true, time: 0 }),
    );
    assert.throws(() => codexStatus(dir), { status: 503 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Codex catalogue requests use the metadata queue and expose sanitized choices", async () => {
  const { listLocalCodexModels } = await import("../server/codex-local.mjs");
  const root = mkdtempSync(join(tmpdir(), "knox-catalogue-"));
  try {
    writeFileSync(
      join(root, "status.json"),
      JSON.stringify({ ready: true, time: Date.now() / 1000 }),
    );
    const pending = listLocalCodexModels(root);
    const file = readdirSync(root).find((n) => n.endsWith(".request.json"));
    const request = JSON.parse(readFileSync(join(root, file)));
    assert.equal(request.kind, "models");
    assert.ok(request.expiresAt < Date.now() / 1000 + 22);
    writeFileSync(
      join(root, file.replace(".request.json", ".response.json")),
      JSON.stringify({
        output: JSON.stringify({
          models: [
            { id: "default", name: "Default" },
            { id: "fictional-model", name: "Fictional model" },
          ],
          truncated: false,
        }),
      }),
    );
    const result = await pending;
    assert.equal(result.models[1].id, "fictional-model");
    assert.deepEqual(readdirSync(root), ["status.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Codex cancellation signals the host worker and removes queued prompt material',async()=>{
 const root=mkdtempSync(join(tmpdir(),'knox-cancel-'));const controller=new AbortController();
 try{writeFileSync(join(root,'status.json'),JSON.stringify({ready:true,time:Date.now()/1000}));const pending=runLocalCodex({model:'default',signal:controller.signal},'Fictional test',[],{},root);controller.abort();await assert.rejects(pending,{status:499});assert.equal(readdirSync(root).some(n=>n.endsWith('.request.json')),false);assert.equal(readdirSync(root).some(n=>n.endsWith('.cancel.json')),true);}finally{rmSync(root,{recursive:true,force:true});}
});

test('Codex cancellation distinguishes a helper termination acknowledgement from a mere signal',async()=>{
 const root=mkdtempSync(join(tmpdir(),'knox-cancel-ack-')),controller=new AbortController(),stats=[];
 let timer;
 try{
  writeFileSync(join(root,'status.json'),JSON.stringify({ready:true,time:Date.now()/1000}));const pending=runLocalCodex({model:'default',signal:controller.signal,onDiagnostics:d=>stats.push(d)},'Fictional test',[],{},root);
  const request=readdirSync(root).find(n=>n.endsWith('.request.json'));
  timer=setInterval(()=>{if(readdirSync(root).some(n=>n.endsWith('.cancel.json'))){writeFileSync(join(root,request.replace('.request.json','.response.json')),JSON.stringify({error:'Codex request cancelled.',errorCode:'cancelled'}));clearInterval(timer);}},10);
  controller.abort();await assert.rejects(pending,{status:499});assert.ok(stats.some(d=>d.cancellation==='codex-process-stopped'));assert.equal(readdirSync(root).some(n=>n.endsWith('.response.json')),false);
 }finally{clearInterval(timer);rmSync(root,{recursive:true,force:true});}
});

test("Codex document-generation stages workspace, validates manifest and returns verified OpenXML artifact", async () => {
  const root = mkdtempSync(join(tmpdir(), "knox-doc-gen-"));
  const sampleDocx = await Packer.toBuffer(
    new Document({
      sections: [{ children: [new Paragraph("Fictional Style Reference")] }],
    }),
  );

  try {
    writeFileSync(
      join(root, "status.json"),
      JSON.stringify({ ready: true, time: Date.now() / 1000 }),
    );

    const diagnostics = [];
    const pending = runCodexDocumentGeneration({
      config: {
        model: "default",
        reasoningEffort: "medium",
        onDiagnostics: (d) => diagnostics.push(d),
      },
      styleDocument: {
        name: "Two-Column-Reference.docx",
        bytes: sampleDocx,
        pageImages: [Buffer.from("fake-png-data")],
      },
      sourceCv: {
        name: "Master-CV.docx",
        text: "Jane Doe\nStaff Engineer\nExperience at Fictional Corp",
      },
      opportunity: {
        company: "Acme Corp",
        role: "Principal Engineer",
        description: "Looking for systems leadership.",
      },
      brief: "Emphasize distributed systems.",
      instructions: "Keep on 2 pages.",
      root,
    });

    // 1. Verify job folder staged
    const jobDirName = readdirSync(root).find((n) => n.endsWith(".job"));
    assert.ok(jobDirName);
    const jobDir = join(root, jobDirName);
    const inputsDir = join(jobDir, "inputs");
    const workspaceDir = join(jobDir, "workspace");

    assert.ok(readdirSync(inputsDir).includes("reference.docx"));
    assert.ok(readdirSync(inputsDir).includes("page-1.png"));
    assert.ok(readdirSync(inputsDir).includes("source_cv.txt"));
    assert.ok(readdirSync(inputsDir).includes("job_context.json"));
    assert.ok(readdirSync(workspaceDir).includes("draft.docx"));

    // 2. Verify request JSON
    const reqFileName = readdirSync(root).find((n) => n.endsWith(".request.json"));
    const reqData = JSON.parse(readFileSync(join(root, reqFileName), "utf8"));
    assert.equal(reqData.kind, "document-generation");
    assert.equal(reqData.model, "default");
    assert.equal(reqData.reasoningEffort, "medium");
    assert.ok(reqData.images.length === 1);
    assert.match(reqData.prompt, /Two-Column-Reference/);

    // 3. Mock worker creates output.docx and writes response with manifest
    const outputDocx = await Packer.toBuffer(
      new Document({
        sections: [
          { children: [new Paragraph("Tailored CV for Acme Corp - Jane Doe")] },
        ],
      }),
    );
    writeFileSync(join(workspaceDir, "output.docx"), outputDocx);

    const manifest = {
      outputDocx: "output.docx",
      pageCount: 2,
      notes: "Preserved two-column sidebar format.",
    };
    writeFileSync(
      join(root, reqFileName.replace(".request.json", ".response.json")),
      JSON.stringify({
        output: JSON.stringify(manifest),
        timings: { executionMs: 1200 },
        usage: { input_tokens: 150, output_tokens: 45 },
      }),
    );

    const result = await pending;
    assert.ok(Buffer.isBuffer(result.docx));
    assert.equal(result.manifest.outputDocx, "output.docx");
    assert.equal(result.manifest.pageCount, 2);
    assert.equal(result.timings.executionMs, 1200);
    assert.equal(result.usage.input_tokens, 150);

    // 4. Verify cleanup of job folder and request/response files
    assert.deepEqual(readdirSync(root), ["status.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex document-generation rejects path traversal in manifest", async () => {
  const root = mkdtempSync(join(tmpdir(), "knox-doc-traversal-"));
  const sampleDocx = await Packer.toBuffer(
    new Document({
      sections: [{ children: [new Paragraph("Fictional Reference")] }],
    }),
  );

  try {
    writeFileSync(
      join(root, "status.json"),
      JSON.stringify({ ready: true, time: Date.now() / 1000 }),
    );

    const pending = runCodexDocumentGeneration({
      config: { model: "default" },
      styleDocument: { name: "ref.docx", bytes: sampleDocx },
      sourceCv: { name: "cv.txt", text: "Jane Doe" },
      opportunity: { company: "Acme", role: "Eng" },
      root,
    });

    const reqFileName = readdirSync(root).find((n) => n.endsWith(".request.json"));
    writeFileSync(
      join(root, reqFileName.replace(".request.json", ".response.json")),
      JSON.stringify({
        output: JSON.stringify({ outputDocx: "../outside.docx", pageCount: 1 }),
      }),
    );

    await assert.rejects(pending, { status: 502 });
    assert.deepEqual(readdirSync(root), ["status.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
