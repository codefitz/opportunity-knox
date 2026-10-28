import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const failure = (message, status = 503) =>
  Object.assign(new Error(message), { status });
const directory = () =>
  join(process.env.BOARD_DATA_DIR || "/data", "codex-buddy");
export function codexStatus(root = directory()) {
  try {
    const s = JSON.parse(readFileSync(join(root, "status.json"), "utf8"));
    if (
      !s.ready ||
      (Date.now() / 1000 - s.time > 10 &&
        !(s.busyUntil > Date.now() / 1000 && s.busyUntil <= s.time + 301))
    )
      throw Error();
    return true;
  } catch {
    throw failure(
      "The Codex helper is unavailable. Sign in to Codex on the board host, then start/restart the board with its launcher.",
    );
  }
}
export async function runLocalCodex(
  config,
  system,
  messages,
  schema,
  root = directory(),
  kind = "inference",
) {
  codexStatus(root);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(config.model))
    throw failure("Choose a valid Codex model ID.", 400);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const id = randomUUID(),
    request = join(root, id + ".request.json"),
    response = join(root, id + ".response.json"),
    temp = request + ".tmp";
  const prompt =
    "You are a text-only Career Buddy adapter. Do not use tools, inspect files, execute commands or modify anything. Return only the requested JSON.\n" +
    system +
    "\n\nConversation data:\n" +
    JSON.stringify(messages);
  if (prompt.length > 500000)
    throw failure(
      "This Codex context is too large. Select fewer sources.",
      413,
    );
  writeFileSync(
    temp,
    JSON.stringify({
      prompt,
      kind,
      schema,
      model: config.model,
      expiresAt: Date.now() / 1000 + (kind === "models" ? 20 : 300),
    }),
    { mode: 0o600, flag: "wx" },
  );
  renameSync(temp, request);
  try {
    const deadline = Date.now() + (kind === "models" ? 25000 : 305000);
    while (Date.now() < deadline) {
      let value;
      try {
        value = JSON.parse(readFileSync(response, "utf8"));
      } catch {}
      if (value) {
        if (value.error) throw failure(value.error, 502);
        if (
          typeof value.output !== "string" ||
          value.output.length > 2 * 1024 * 1024
        )
          throw failure("Codex returned an invalid response.", 502);
        return value.output;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw failure(
      kind === "models"
        ? "Codex model discovery timed out. Retry when the helper is idle, or enter an ID manually."
        : "Codex timed out after five minutes. Reduce context or try again.",
      504,
    );
  } finally {
    rmSync(request, { force: true });
    rmSync(response, { force: true });
    rmSync(temp, { force: true });
  }
}

export async function listLocalCodexModels(root = directory()) {
  const parsed = JSON.parse(
    await runLocalCodex({ model: "default" }, "", [], {}, root, "models"),
  );
  if (
    !Array.isArray(parsed.models) ||
    parsed.models.some(
      (m) => !m || typeof m.id !== "string" || typeof m.name !== "string",
    )
  )
    throw failure("The Codex model catalogue was invalid.", 502);
  return {
    models: parsed.models,
    suggested: "default",
    truncated: Boolean(parsed.truncated),
  };
}
