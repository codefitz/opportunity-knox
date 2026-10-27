import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  defaultBuddy,
  publicBuddy,
  updateBuddy,
  validateBaseUrl,
  providerRequest,
  providerText,
  callProvider,
  listProviderModels,
} from "../server/buddy-provider.mjs";
import {
  parseBuddyOutput,
  validateChanges,
  applyChanges,
} from "../server/career-buddy.mjs";
import {
  chunkText,
  retrieveChunks,
  extractDocument,
  wordDraft,
} from "../server/buddy-documents.mjs";
const empty = () => ({
  reply: "Ready",
  changes: [],
  draft: { kind: "none", title: "", content: "" },
  sourceIds: [],
});
const change = (patch = {}) => ({
  kind: "interview",
  title: "Second interview",
  date: "2026-10-22",
  type: "other",
  status: "completed",
  notes: "They mentioned lack of Databricks experience.",
  field: "",
  value: "",
  isFinal: false,
  ...patch,
});
const config = (provider = "openai") =>
  updateBuddy(defaultBuddy(), {
    revision: 1,
    provider,
    enabled: true,
    model: "fixture-model",
    apiKey: "private-fixture-key",
    ...(provider === "custom" ? { baseUrl: "https://api.example.com/v1" } : {}),
  });
test("provider settings validate activation, preserve blank keys, clear provider keys and enforce revisions", () => {
  assert.throws(
    () => updateBuddy(defaultBuddy(), { revision: 1, enabled: true }),
    /model/,
  );
  const initial = config();
  assert.equal(publicBuddy(initial).hasKey, true);
  assert.equal(publicBuddy(initial).apiKey, undefined);
  assert.equal(
    updateBuddy(initial, { revision: 2, apiKey: "", enabled: false }).apiKey,
    "private-fixture-key",
  );
  assert.equal(
    updateBuddy(initial, {
      revision: 2,
      provider: "ollama",
      model: "local-fixture",
    }).apiKey,
    "",
  );
  assert.throws(
    () => updateBuddy(initial, { revision: 1, enabled: false }),
    /changed/,
  );
  assert.throws(
    () => updateBuddy(initial, { revision: 2, provider: "fake" }),
    /provider/,
  );
  assert.throws(
    () => updateBuddy(initial, { revision: 2, outputMode: "unsafe" }),
    /output/,
  );
});
test("API endpoint validation allows deliberate local providers but rejects credential URLs, metadata and remote cleartext", () => {
  for (const value of [
    "http://host.docker.internal:11434",
    "http://127.0.0.1:11434",
    "http://192.168.1.3:11434",
    "http://100.100.10.20:11434",
    "http://career-server.private:11434",
    "http://example.com",
    "https://api.example.com/v1",
  ])
    assert.equal(validateBaseUrl(value), value);
  for (const value of [
    "ftp://example.com",
    "https://user:secret@example.com",
    "https://example.com?key=secret",
    "https://example.com/#x",
    "http://169.254.169.254",
    "http://metadata.google.internal",
    "http://0.0.0.0",
    "http://[::ffff:169.254.169.254]",
  ])
    assert.throws(() => validateBaseUrl(value));
});
test("private hostname settings can be saved while the network server is offline", () => {
  const saved = updateBuddy(defaultBuddy(), {
    revision: 1,
    provider: "ollama",
    model: "test-model",
    enabled: true,
    baseUrl: "http://career-server.private:11434",
  });
  assert.equal(saved.baseUrl, "http://career-server.private:11434");
  assert.equal(
    providerRequest(saved, "system", []).url,
    "http://career-server.private:11434/api/chat",
  );
});

test("the actual HTTP connection uses only validated private DNS results", async (t) => {
  const requests = [];
  const server = createServer(async (req, res) => {
    requests.push({ host: req.headers.host, path: req.url });
    for await (const _ of req) {
      /* consume body */
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ done: true, message: { content: "Ready" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const network = {
    ...config("ollama"),
    baseUrl: "http://private-ollama.test:" + port,
  };
  let lookups = 0;
  const privateDns = (host, options, cb) => {
    lookups++;
    assert.equal(host, "private-ollama.test");
    assert.equal(options.all, true);
    cb(null, [{ address: "127.0.0.1", family: 4 }]);
  };
  assert.equal(
    await callProvider(
      network,
      "system",
      [{ role: "user", content: "test" }],
      undefined,
      privateDns,
    ),
    "Ready",
  );
  assert.equal(lookups, 1);
  assert.deepEqual(requests, [
    { host: "private-ollama.test:" + port, path: "/api/chat" },
  ]);

  // Even if one answer is private, mixed DNS results must not reach the socket.
  const mixedDns = (_host, _options, cb) =>
    cb(null, [
      { address: "127.0.0.1", family: 4 },
      { address: "8.8.8.8", family: 4 },
    ]);
  await assert.rejects(
    callProvider(network, "system", [], undefined, mixedDns),
    (error) => error.status === 400 && /private network/.test(error.message),
  );
  assert.equal(requests.length, 1);
  const publicDns = (_host, _options, cb) =>
    cb(null, [{ address: "8.8.8.8", family: 4 }]);
  await assert.rejects(
    callProvider(network, "system", [], undefined, publicDns),
    (error) => error.status === 400,
  );
  const linkLocalDns = (_host, _options, cb) =>
    cb(null, [{ address: "169.254.169.254", family: 4 }]);
  await assert.rejects(
    callProvider(network, "system", [], undefined, linkLocalDns),
    (error) => error.status === 400,
  );
  assert.equal(requests.length, 1);
});

for (const provider of ["openai", "anthropic", "gemini", "ollama", "custom"]) {
  test(
    provider +
      " adapter uses its native API, header auth and JSON schema without credentials in the body",
    () => {
      const c = config(provider),
        r = providerRequest(c, "system", [
          { role: "user", content: "question" },
          { role: "assistant", content: "answer" },
        ]);
      assert.ok(!r.url.includes(c.apiKey));
      assert.ok(!JSON.stringify(r.body).includes(c.apiKey));
      assert.equal(r.body.model || c.model, "fixture-model");
      if (provider === "openai") {
        assert.match(r.url, /\/v1\/responses$/);
        assert.equal(r.body.store, false);
        assert.equal(r.body.text.format.strict, true);
      }
      if (provider === "anthropic") {
        assert.match(r.url, /\/v1\/messages$/);
        assert.equal(r.headers["x-api-key"], c.apiKey);
        assert.equal(r.body.output_config.format.type, "json_schema");
      }
      if (provider === "gemini") {
        assert.match(r.url, /fixture-model:generateContent$/);
        assert.equal(r.headers["x-goog-api-key"], c.apiKey);
        assert.equal(r.body.contents[1].role, "model");
        assert.equal(
          r.body.generationConfig.responseMimeType,
          "application/json",
        );
      }
      if (provider === "ollama") {
        assert.match(r.url, /\/api\/chat$/);
        assert.equal(r.body.stream, false);
        assert.equal(r.body.format.type, "object");
      }
      if (provider === "custom") {
        assert.match(r.url, /\/v1\/chat\/completions$/);
        assert.equal(r.body.response_format.type, "json_schema");
      }
    },
  );
}
test("compatibility output modes omit unsupported schema parameters", () => {
  for (const provider of [
    "openai",
    "anthropic",
    "gemini",
    "ollama",
    "custom",
  ]) {
    const r = providerRequest(
      { ...config(provider), outputMode: "prompt" },
      "Return JSON",
      [],
    );
    assert.ok(!JSON.stringify(r.body).includes("json_schema"));
  }
  assert.equal(
    providerRequest({ ...config("custom"), outputMode: "json" }, "JSON", [])
      .body.response_format.type,
    "json_object",
  );
});
test("provider responses extract only final text and reject truncated, blocked or refused answers", () => {
  assert.equal(
    providerText("openai", {
      status: "completed",
      output: [
        {
          content: [
            { type: "output_text", text: "Ready" },
            { type: "refusal", refusal: "no" },
          ],
        },
      ],
    }),
    "Ready",
  );
  assert.equal(
    providerText("anthropic", {
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "private" },
        { type: "text", text: "Ready" },
      ],
    }),
    "Ready",
  );
  assert.equal(
    providerText("gemini", {
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [{ thought: true, text: "hidden" }, { text: "Ready" }],
          },
        },
      ],
    }),
    "Ready",
  );
  assert.equal(
    providerText("ollama", { done: true, message: { content: "Ready" } }),
    "Ready",
  );
  for (const [p, r] of [
    ["openai", { status: "incomplete" }],
    ["anthropic", { stop_reason: "max_tokens" }],
    ["gemini", { candidates: [{ finishReason: "SAFETY" }] }],
    ["ollama", { done: false }],
    ["custom", { choices: [{ finish_reason: "length" }] }],
  ])
    assert.throws(() => providerText(p, r));
});
test("provider transport does not follow redirects and suppresses raw provider errors or secrets", async () => {
  let options;
  const text = await callProvider(
    config("custom"),
    "system",
    [],
    async (_, opts) => {
      options = opts;
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: "Ready" } }],
        }),
      );
    },
  );
  assert.equal(text, "Ready");
  assert.equal(options.redirect, "error");
  assert.ok(options.signal);
  await assert.rejects(
    callProvider(
      config(),
      "system",
      [],
      async () => new Response("private-fixture-key", { status: 401 }),
    ),
    (error) =>
      error.status === 502 && !error.message.includes("private-fixture-key"),
  );
  await assert.rejects(
    callProvider(config(), "system", [], async () => {
      throw Error("private-fixture-key");
    }),
    (error) => !error.message.includes("private-fixture-key"),
  );
});
test("structured answers filter invented source IDs and fail closed on invalid records and dates", () => {
  const output = {
    ...empty(),
    changes: [change()],
    sourceIds: ["known", "invented", "known"],
  };
  const parsed = parseBuddyOutput(JSON.stringify(output), ["known"]);
  assert.deepEqual(parsed.sourceIds, ["known"]);
  assert.throws(() => parseBuddyOutput("not json"), /structured/);
  assert.throws(
    () => validateChanges([change({ date: "2026-02-30" })]),
    /date/,
  );
  assert.throws(
    () =>
      validateChanges([
        change({ kind: "update", field: "__proto__", value: "bad" }),
      ]),
    /field/,
  );
  assert.throws(
    () => validateChanges([change({ kind: "delete" })]),
    /unsupported/,
  );
});
test("reviewed changes append dated feedback and preserve all prior history without mutating the source", () => {
  const record = {
    id: "o",
    revision: 3,
    stage: "review",
    outcome: "",
    events: [{ id: "old", stage: "review", effectiveAt: "2026-10-01" }],
    activities: [],
    currentStageEventId: "old",
  };
  const next = applyChanges(
    record,
    [change()],
    "message",
    "2026-10-22T18:00:00Z",
  );
  assert.equal(next.revision, 4);
  assert.equal(record.activities.length, 0);
  assert.deepEqual(next.events, record.events);
  assert.equal(next.activities[0].scheduledAt, "2026-10-22");
  assert.match(next.activities[0].notes, /Databricks/);
  assert.equal(next.activities[0].messageId, "message");
  assert.equal(next.stage, "review");
  const moved = applyChanges(
    record,
    [change({ kind: "update", field: "stage", value: "interviews" })],
    "message",
    "2026-10-22T18:00:00Z",
  );
  assert.equal(moved.events.length, 2);
  assert.equal(moved.stage, "interviews");
  assert.equal(moved.currentStageEventId, moved.events[1].id);
});
test("local text preparation chunks UTF-8 evidence, reports unsupported and scanned/unreadable inputs honestly", async () => {
  const source = "Architecture and Databricks governance evidence.\n".repeat(
    100,
  );
  const result = await extractDocument("evidence.txt", Buffer.from(source));
  assert.equal(result.status, "ready");
  assert.ok(result.chunks.length > 1);
  assert.match(result.chunks[0].text, /Architecture/);
  assert.equal(
    (await extractDocument("legacy.doc", Buffer.from("data"))).status,
    "unsupported",
  );
  assert.equal(
    (await extractDocument("empty.txt", Buffer.from(" "))).status,
    "unavailable",
  );
  assert.equal(
    (await extractDocument("invalid.txt", Buffer.from([255, 0]))).status,
    "unavailable",
  );
  assert.equal(
    (await extractDocument("broken.pdf", Buffer.from("not a PDF"))).status,
    "unavailable",
  );
});
test("retrieval balances selected sources and ranks relevant text within the context budget", () => {
  const documents = [
    {
      id: "a",
      name: "CV.txt",
      kind: "cv",
      chunks: chunkText(
        "General evidence.\n".repeat(150) +
          "Specialist Databricks engineering.\n".repeat(60),
      ),
    },
    {
      id: "b",
      name: "Notes.txt",
      kind: "reference",
      chunks: chunkText("Governance notes."),
    },
  ];
  const snapshot = JSON.stringify(documents),
    r = retrieveChunks(documents, "Databricks engineering", 4500);
  assert.ok(r.chunks.some((c) => c.sourceId === "b"));
  assert.ok(r.chunks.some((c) => c.text.includes("Databricks")));
  assert.ok(r.characters <= 4500);
  assert.ok(r.omittedChunks > 0);
  assert.equal(JSON.stringify(documents), snapshot);
});
test("Word drafts are editable DOCX files whose paragraphs, tables and Unicode can be read back locally", async () => {
  const bytes = await wordDraft(
    "Fictional CV",
    "# Alex Example\n\n## Experience\n- Led architecture reviews for a fictional team.\n- Worked in Montréal.",
  );
  assert.equal(bytes.subarray(0, 2).toString(), "PK");
  const result = await extractDocument("CV.docx", bytes);
  assert.equal(result.status, "ready");
  assert.match(result.text, /Alex Example/);
  assert.match(result.text, /Montréal/);
  assert.match(result.text, /architecture reviews/);
});

test("PowerPoint (.pptx) slides and speaker notes, Word footnotes/comments, HTML, RTF, and video captions (.vtt/.srt) extract locally", async () => {
  const { default: JSZip } = await import("jszip");

  // 1. PowerPoint (.pptx) with slides and speaker notes
  const pptxZip = new JSZip();
  pptxZip.file(
    "ppt/slides/slide1.xml",
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>Platform Modernization Strategy</a:t></a:r></a:p></p:sld>',
  );
  pptxZip.file(
    "ppt/notesSlides/notesSlide1.xml",
    '<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>Cut deployment lead time by 60 percent</a:t></a:r></a:p></p:notes>',
  );
  const pptxBytes = await pptxZip.generateAsync({ type: "nodebuffer" });
  const pptxRes = await extractDocument("Architecture-Deck.pptx", pptxBytes);
  assert.equal(pptxRes.status, "ready");
  assert.match(pptxRes.text, /\[Slide 1\]/);
  assert.match(pptxRes.text, /Platform Modernization Strategy/);
  assert.match(pptxRes.text, /Cut deployment lead time by 60 percent/);

  // 2. Word (.docx) with footnotes and comments
  const docxZip = new JSZip();
  docxZip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Main body text</w:t></w:r></w:p></w:body></w:document>',
  );
  docxZip.file(
    "word/footnotes.xml",
    '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Published in 2025 architecture review</w:t></w:r></w:p></w:footnotes>',
  );
  const docxBytes = await docxZip.generateAsync({ type: "nodebuffer" });
  const docxRes = await extractDocument("With-Footnotes.docx", docxBytes);
  assert.equal(docxRes.status, "ready");
  assert.match(docxRes.text, /Main body text/);
  assert.match(docxRes.text, /Published in 2025 architecture review/);

  // 3. Video captions (.vtt and .srt)
  const vtt = `WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.500\n<v Speaker>Designed the multi-region failover system.</v>\n`;
  const vttRes = await extractDocument(
    "Tech-Talk.vtt",
    Buffer.from(vtt, "utf8"),
  );
  assert.equal(vttRes.status, "ready");
  assert.match(vttRes.text, /Designed the multi-region failover system/);
  assert.doesNotMatch(vttRes.text, /00:00:01/);

  // 4. HTML and RTF
  const htmlRes = await extractDocument(
    "Portfolio.html",
    Buffer.from(
      "<html><head><script>alert(1)</script></head><body><h1>Case Study</h1><p>Scaled event pipeline.</p></body></html>",
    ),
  );
  assert.equal(htmlRes.status, "ready");
  assert.match(htmlRes.text, /Scaled event pipeline/);
  assert.doesNotMatch(htmlRes.text, /alert\(1\)/);

  const rtfRes = await extractDocument(
    "Summary.rtf",
    Buffer.from(
      "{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0\\pard Led Kubernetes migration.\\par}",
    ),
  );
  assert.equal(rtfRes.status, "ready");
  assert.match(rtfRes.text, /Led Kubernetes migration/);
});

function textPDF(text) {
  const stream =
    "BT /F1 12 Tf 50 780 Td (" + text.replace(/[()\\]/g, "\\$&") + ") Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " +
      Buffer.byteLength(stream) +
      " >>\nstream\n" +
      stream +
      "\nendstream",
  ];
  let content = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(content));
    content += index + 1 + " 0 obj\n" + object + "\nendobj\n";
  }
  const xref = Buffer.byteLength(content);
  content +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" +
    xref +
    "\n%%EOF";
  return Buffer.from(content);
}
test("real PDF text can be extracted locally without a provider or OCR", async () => {
  const result = await extractDocument(
    "Career evidence.pdf",
    textPDF("Fictional experience leading governance workshops."),
  );
  assert.equal(result.status, "ready");
  assert.match(result.text, /governance workshops/);
  assert.ok(result.chunks.length);
});

test("model discovery uses each provider's listing protocol without generation or key disclosure", async () => {
  const fixtures = {
    openai: {
      response: { data: [{ id: "chat-example" }, { id: "models/example" }] },
      suffix: "/models",
      key: "Authorization",
    },
    custom: {
      response: { data: [{ id: "chat-example" }] },
      suffix: "/models",
      key: "Authorization",
    },
    anthropic: {
      response: {
        data: [{ id: "claude-example", display_name: "Example Claude" }],
        has_more: true,
      },
      suffix: "/models?limit=1000",
      key: "x-api-key",
    },
    gemini: {
      response: {
        models: [
          {
            name: "models/gemini-example",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/embedding-example",
            supportedGenerationMethods: ["embedContent"],
          },
        ],
        nextPageToken: "next",
      },
      suffix: "/models?pageSize=1000",
      key: "x-goog-api-key",
    },
    ollama: {
      response: {
        models: [
          { name: "embedding-example:latest", details: { format: "gguf" } },
          { name: "chat-example:latest", details: { format: "gguf" } },
          { name: "image-example", details: { format: "safetensors" } },
        ],
      },
      suffix: "/api/tags",
      key: "Authorization",
    },
  };
  for (const [provider, fixture] of Object.entries(fixtures)) {
    const c = config(provider);
    const found = await listProviderModels(c, async (url, options) => {
      assert.equal(url, c.baseUrl + fixture.suffix);
      assert.equal(options.method, "GET");
      assert.equal(options.body, undefined);
      assert.equal(options.redirect, "error");
      assert.ok(options.headers[fixture.key].includes("private-fixture-key"));
      return new Response(JSON.stringify(fixture.response));
    });
    assert.ok(found.models.length > 0);
    assert.ok(!JSON.stringify(found).includes("private-fixture-key"));
    if (provider === "gemini")
      assert.deepEqual(
        found.models.map((x) => x.id),
        ["gemini-example"],
      );
    if (provider === "openai")
      assert.equal(found.models[1].id, "models/example");
    if (provider === "ollama")
      assert.equal(found.suggested, "chat-example:latest");
    if (["gemini", "anthropic"].includes(provider))
      assert.equal(found.truncated, true);
  }
});

test("model discovery keeps endpoint restrictions and reports unsupported or malformed model APIs safely", async () => {
  const c = config("custom");
  await assert.rejects(
    () =>
      listProviderModels(
        c,
        async () => new Response("private-fixture-key", { status: 404 }),
      ),
    (error) =>
      /enter a model id manually/i.test(error.message) &&
      !error.message.includes("private-fixture-key"),
  );
  await assert.rejects(
    () =>
      listProviderModels(
        c,
        async () => new Response(JSON.stringify({ unexpected: true })),
      ),
    /invalid model list/i,
  );
  await assert.rejects(
    () =>
      listProviderModels({ ...c, baseUrl: "http://8.8.8.8" }, async () => {
        throw Error("must not reach network");
      }),
    /https/i,
  );
});

test("model listing never returns a stored key echoed in an ID or label", async () => {
  const c = config("anthropic");
  const result = await listProviderModels(
    c,
    async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: "private-fixture-key" },
            { id: "safe-model", display_name: "private-fixture-key" },
          ],
        }),
      ),
  );
  assert.deepEqual(result.models, [{ id: "safe-model", name: "safe-model" }]);
});
