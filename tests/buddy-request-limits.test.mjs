import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultBuddy,
  updateBuddy,
  providerRequest,
} from "../server/buddy-provider.mjs";
test("request limits validate bounds, persist independently and constrain HTTP output", () => {
  const c = updateBuddy(defaultBuddy(), {
    revision: 1,
    provider: "ollama",
    model: "fictional",
    requestTimeoutSeconds: 450,
    maxOutputTokens: 1024,
    contextCharacters: 8000,
  });
  assert.equal(c.requestTimeoutSeconds, 450);
  assert.equal(
    providerRequest(c, "Fictional", []).body.options.num_predict,
    1024,
  );
  for (const value of [0, 29, 901, 1.5])
    assert.throws(
      () =>
        updateBuddy(defaultBuddy(), {
          revision: 1,
          requestTimeoutSeconds: value,
        }),
      { status: 400 },
    );
});

test("HTTP transport deadlines are identified as board timeouts, not user cancellation", async () => {
  const { callProvider } = await import("../server/buddy-provider.mjs");
  const config = updateBuddy(defaultBuddy(), {
    revision: 1,
    provider: "custom",
    baseUrl: "https://fictional.example/v1",
    model: "fictional",
  });
  // Shorten only the unit-test transport deadline; saved settings still enforce 30–900 seconds.
  config.requestTimeoutSeconds = 0.02;
  const alive = setInterval(() => {}, 100);
  try {
    await assert.rejects(
      callProvider(
        config,
        "Fictional",
        [],
        async (_, opts) =>
          new Promise((resolve, reject) =>
            opts.signal.addEventListener(
              "abort",
              () => reject(opts.signal.reason),
              { once: true },
            ),
          ),
      ),
      (e) => e.status === 504 && e.message.includes("board stopped waiting"),
    );
  } finally {
    clearInterval(alive);
  }
});
