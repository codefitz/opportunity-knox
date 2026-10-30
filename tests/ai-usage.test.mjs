import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { providerUsage, estimateCost } from "../server/ai-usage.mjs";
import { createBuddyRequests } from "../server/buddy-requests.mjs";
import { callProvider } from "../server/buddy-provider.mjs";
import { readProviderStream } from "../server/buddy-stream.mjs";
import { requestActivity } from "../server/ai-activity.mjs";
const payload = JSON.stringify({
  reply: "Fictional answer",
  changes: [],
  draft: { kind: "none", title: "", content: "" },
  sourceIds: [],
});
const event = (value) => "data: " + JSON.stringify(value) + "\n\n";
function memory() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE standalone_messages(id TEXT PRIMARY KEY,data TEXT NOT NULL)",
  );
  return db;
}
test("provider token mappings include cache/think/tool categories without counting breakdowns twice", () => {
  assert.deepEqual(
    providerUsage("openai", {
      usage: {
        input_tokens: 20,
        output_tokens: 5,
        input_tokens_details: { cached_tokens: 7 },
        output_tokens_details: { reasoning_tokens: 2 },
        total_tokens: 25,
      },
    }),
    {
      inputTokens: 20,
      outputTokens: 5,
      cachedInputTokens: 7,
      reasoningTokens: 2,
      totalTokens: 25,
    },
  );
  assert.deepEqual(
    providerUsage("anthropic", {
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 2,
        output_tokens: 3,
      },
    }),
    {
      inputTokens: 17,
      outputTokens: 3,
      cachedInputTokens: 5,
      cacheWriteInputTokens: 2,
    },
  );
  assert.deepEqual(
    providerUsage("gemini", {
      usageMetadata: {
        promptTokenCount: 10,
        toolUsePromptTokenCount: 2,
        candidatesTokenCount: 3,
        thoughtsTokenCount: 5,
        cachedContentTokenCount: 4,
        totalTokenCount: 20,
      },
    }),
    {
      inputTokens: 12,
      outputTokens: 8,
      cachedInputTokens: 4,
      reasoningTokens: 5,
      toolInputTokens: 2,
      totalTokens: 20,
    },
  );
  assert.deepEqual(
    providerUsage("ollama", {
      prompt_eval_count: 9,
      eval_count: 3,
      prompt_eval_cached_count: 4,
    }),
    { inputTokens: 9, outputTokens: 3, cachedInputTokens: 4 },
  );
  assert.deepEqual(
    providerUsage("custom", {
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
  assert.deepEqual(
    providerUsage("openai", {
      usage: {
        input_tokens: "10",
        output_tokens: -1,
        total_tokens: 1e20,
        secret: "PRIVATE",
      },
    }),
    {},
  );
  assert.equal(
    estimateCost({
      provider: "custom",
      pricing: { currency: "USD", inputPerMillion: 1, outputPerMillion: 2 },
      usage: { complete: false, inputTokens: 10, outputTokens: 5 },
    }),
    null,
  );
});
test("streamed cumulative usage replaces earlier snapshots, including custom usage-only final chunks", async () => {
  const cases = [
    [
      "anthropic",
      event({
        type: "message_start",
        message: {
          usage: {
            input_tokens: 10,
            cache_read_input_tokens: 5,
            cache_creation_input_tokens: 2,
            output_tokens: 1,
          },
        },
      }) +
        event({
          type: "content_block_delta",
          delta: { type: "text_delta", text: payload },
        }) +
        event({ type: "message_delta", usage: { output_tokens: 3 } }) +
        event({
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 10, output_tokens: 5 },
        }) +
        event({ type: "message_stop" }),
      17,
      5,
    ],
    [
      "openai",
      event({ type: "response.output_text.delta", delta: payload }) +
        event({
          type: "response.completed",
          response: {
            status: "completed",
            usage: { input_tokens: 20, output_tokens: 5 },
          },
        }),
      20,
      5,
    ],
    [
      "custom",
      event({
        choices: [
          { index: 0, delta: { content: payload }, finish_reason: "stop" },
        ],
      }) +
        event({
          choices: [],
          usage: { prompt_tokens: 20, completion_tokens: 5 },
        }) +
        "data: [DONE]\n\n",
      20,
      5,
    ],
    [
      "gemini",
      event({
        candidates: [
          { content: { parts: [{ text: payload }] }, finishReason: "STOP" },
        ],
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 3,
          thoughtsTokenCount: 2,
        },
      }),
      20,
      5,
    ],
    [
      "ollama",
      JSON.stringify({ message: { content: payload } }) +
        "\n" +
        JSON.stringify({
          done: true,
          done_reason: "stop",
          prompt_eval_count: 20,
          eval_count: 5,
        }) +
        "\n",
      20,
      5,
    ],
  ];
  for (const [provider, wire, input, output] of cases) {
    const db = memory();
    try {
      const requests = createBuddyRequests(db),
        task = requests.start("request", provider, {
          provider,
          model: "fictional",
        });
      const result = await readProviderStream(
        new Response(wire),
        { provider, onDiagnostics: task.diagnostics },
        new AbortController().signal,
      );
      assert.equal(result, payload);
      task.finish("completed");
      const u = requests.read("request").usage;
      assert.equal(u.inputTokens, input);
      assert.equal(u.outputTokens, output);
      assert.equal(u.complete, true);
    } finally {
      db.close();
    }
  }
});
test("partial failed streams retain partial counters and never invent a zero cost or persist output/prompt text", async () => {
  const db = memory();
  try {
    const controls = createBuddyRequests(db, {
      getConfig: () => ({
        revision: 2,
        rates: [
          {
            provider: "anthropic",
            model: "fictional",
            currency: "USD",
            inputPerMillion: 1,
            outputPerMillion: 2,
          },
        ],
      }),
    });
    const task = controls.start("partial", "chat", {
      provider: "anthropic",
      model: "fictional",
      apiKey: "PRIVATE API KEY",
    });
    await assert.rejects(
      readProviderStream(
        new Response(
          event({
            type: "message_start",
            message: { usage: { input_tokens: 20, output_tokens: 1 } },
          }) +
            event({
              type: "content_block_delta",
              delta: { type: "text_delta", text: "PRIVATE OUTPUT" },
            }),
        ),
        { provider: "anthropic", onDiagnostics: task.diagnostics },
        new AbortController().signal,
      ),
    );
    task.diagnostics({
      apiKey: "PRIVATE",
      usage: { secret: "PRIVATE" },
      promptHash: "not a fingerprint",
    });
    task.finish("failed", 502);
    const row = controls.read("partial");
    assert.equal(row.usage.complete, false);
    assert.equal(row.cost, null);
    assert.equal(
      db
        .prepare("SELECT data FROM buddy_requests")
        .get()
        .data.includes("PRIVATE"),
      false,
    );
  } finally {
    db.close();
  }
});
test("buffered responses record usage and a prompt fingerprint before application validation", async () => {
  const responses = {
    openai: {
      status: "completed",
      output: [
        { type: "message", content: [{ type: "output_text", text: payload }] },
      ],
      usage: { input_tokens: 20, output_tokens: 5 },
    },
    anthropic: {
      stop_reason: "end_turn",
      content: [{ type: "text", text: payload }],
      usage: { input_tokens: 20, output_tokens: 5 },
    },
    gemini: {
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: payload }] } },
      ],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5 },
    },
    ollama: {
      done: true,
      done_reason: "stop",
      message: { content: payload },
      prompt_eval_count: 20,
      eval_count: 5,
    },
    custom: {
      choices: [{ finish_reason: "stop", message: { content: payload } }],
      usage: { prompt_tokens: 20, completion_tokens: 5 },
    },
  };
  for (const [provider, response] of Object.entries(responses)) {
    const db = memory();
    try {
      const controls = createBuddyRequests(db),
        task = controls.start("buffered", "chat", {
          provider,
          model: "fictional",
        });
      assert.equal(
        await callProvider(
          {
            provider,
            model: "fictional",
            apiKey: "PRIVATE KEY",
            baseUrl: "https://fictional.example/v1",
            onDiagnostics: task.diagnostics,
          },
          "PRIVATE SYSTEM PROMPT",
          [],
          async () => Response.json(response),
        ),
        payload,
      );
      task.finish("completed");
      const row = controls.read("buffered");
      assert.equal(row.usage.complete, true);
      assert.equal(row.usage.inputTokens, 20);
      assert.match(row.promptHash, /^[a-f0-9]{64}$/);
      assert.equal(JSON.stringify(row).includes("PRIVATE"), false);
    } finally {
      db.close();
    }
  }
});
test("each retry retains its earlier attempt, saved pricing and terminal state; late callbacks cannot overwrite the retry", async () => {
  const db = memory();
  let rates = {
    revision: 2,
    rates: [
      {
        provider: "custom",
        model: "fictional",
        currency: "USD",
        inputPerMillion: 1,
        outputPerMillion: 2,
      },
    ],
  };
  try {
    const controls = createBuddyRequests(db, { getConfig: () => rates });
    const a = controls.start(
      "same",
      "opportunity:one",
      { provider: "custom", model: "fictional" },
      { kind: "draft", promptVersion: "fictional-v1" },
    );
    a.diagnostics({
      usage: { inputTokens: 10, outputTokens: 5, complete: true },
    });
    a.finish("failed", 504);
    rates = {
      revision: 3,
      rates: [
        {
          provider: "custom",
          model: "fictional",
          currency: "GBP",
          inputPerMillion: 10,
          outputPerMillion: 20,
        },
      ],
    };
    const b = controls.start("same", "opportunity:one", {
      provider: "custom",
      model: "fictional",
    });
    a.diagnostics({
      usage: { inputTokens: 999, outputTokens: 999, complete: true },
    });
    a.finish("completed");
    assert.equal(controls.read("same").stage, "preparing");
    assert.throws(() => controls.start("same", "x", {}), { status: 409 });
    b.diagnostics({
      usage: { inputTokens: 10, outputTokens: 5, complete: true },
    });
    b.finish("completed");
    const saved = db
      .prepare("SELECT data FROM buddy_requests")
      .all()
      .map((r) => JSON.parse(r.data));
    assert.equal(saved.length, 2);
    const previous = saved.find((r) => r.archived);
    assert.equal(previous.stage, "timed-out");
    assert.equal(previous.cost.currency, "USD");
    assert.equal(previous.cost.amount, 0.00002);
    assert.equal(controls.read("same").cost.currency, "GBP");
    assert.equal(controls.read("same").retryOf, previous.id);
    assert.equal(controls.read("same").attempt, 2);
    assert.equal(controls.read("same").cost.amount, 0.0002);
    let response;
    await controls.handle(
      "/api/buddy/requests",
      "GET",
      { url: "/api/buddy/requests?scope=opportunity:one" },
      null,
      { json: (_, v) => (response = v) },
    );
    assert.equal(response.request.id, "same");
  } finally {
    db.close();
  }
});
test("activity projection omits unknown stored fields and never backfills legacy usage or prompt metadata", () => {
  const row = requestActivity(
    {
      id: "old",
      conversationId: "opportunity:one",
      provider: "custom",
      model: "fictional",
      stage: "failed",
      startedAt: "2026-10-30T01:00:00Z",
      finishedAt: "2026-10-30T01:00:03Z",
      preview: "PRIVATE LIVE TEXT",
      apiKey: "PRIVATE KEY",
      body: "PRIVATE INPUT",
    },
    [{ id: "one", company: "Fictional Ltd", role: "Example" }],
  );
  assert.equal(row.durationMs, 3000);
  assert.equal(row.promptVersion, null);
  assert.equal(row.usage, null);
  assert.equal(row.cost, null);
  assert.equal(row.destination.tab, "buddy");
  assert.equal(JSON.stringify(row).includes("PRIVATE"), false);
  assert.equal(
    requestActivity({ id: "missing", conversationId: "summary:missing" })
      .destination,
    null,
  );
});
