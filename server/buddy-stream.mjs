import {providerUsage,reportedModel} from "./ai-usage.mjs";
// Provider framing stays separate from the validated, reviewable Buddy response.
const fail = (message) => Object.assign(new Error(message), { status: 502 });
const MAX = 2 * 1024 * 1024;
function stringAt(s, start) {
  let value = "";
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i];
    if (c === '"') return { value, end: i, closed: true };
    if (c.charCodeAt(0) < 32) break;
    if (c !== "\\") {
      value += c;
      continue;
    }
    const next = s[++i];
    if (next === "u") {
      const hex = s.slice(i + 1, i + 5);
      if (!/^[a-f0-9]{4}$/i.test(hex)) break;
      value += String.fromCharCode(parseInt(hex, 16));
      i += 4;
    } else {
      const escapes = {
        '"': '"',
        "\\": "\\",
        "/": "/",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
      };
      if (!Object.hasOwn(escapes, next)) break;
      value += escapes[next];
    }
  }
  return {
    value: value.replace(/[\uD800-\uDBFF]$/, ""),
    end: s.length,
    closed: false,
  };
}
export function partialStringProperty(source, key) {
  if (!source.trimStart().startsWith("{")) return "";
  let depth = 0,
    expectingKey = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      const token = stringAt(source, i);
      if (depth === 1 && expectingKey && token.closed) {
        let pos = token.end + 1;
        while (/\s/.test(source[pos] || "x")) pos++;
        if (source[pos++] !== ":") return "";
        while (/\s/.test(source[pos] || "x")) pos++;
        if (token.value === key)
          return source[pos] === '"' ? stringAt(source, pos).value : "";
        expectingKey = false;
      }
      i = token.end;
    } else if (c === "{" || c === "[") {
      depth++;
      if (depth === 1) expectingKey = true;
    } else if (c === "}" || c === "]") depth--;
    else if (c === "," && depth === 1) expectingKey = true;
  }
  return "";
}
export function replyPreview(raw, standalone = false) {
  const reply = partialStringProperty(raw, "reply");
  return (standalone ? partialStringProperty(reply, "message") : reply).slice(
    0,
    12000,
  );
}
export function ollamaTimings(data) {
  const result = {};
  for (const [field, key] of [
    ["load_duration", "modelLoadMs"],
    ["prompt_eval_duration", "promptEvaluationMs"],
    ["eval_duration", "generationMs"],
  ])
    if (
      typeof data?.[field] === "number" &&
      Number.isFinite(data[field]) &&
      data[field] >= 0 &&
      data[field] <= 36e11
    )
      result[key] = Math.round(data[field] / 1e6);
  return result;
}
export async function readProviderStream(
  response,
  config,
  signal,
  began = performance.now(),
) {
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  const ndjson = config.provider === "ollama";
  let usageSnapshot={};
  let buffer = "",
    dataLines = [],
    output = "",
    bytes = 0,
    outputBytes = 0,
    terminal = false,
    reason = "",
    first = true,
    lastPreview = -Infinity;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const append = (text) => {
    if (typeof text !== "string" || !text) return;
    outputBytes += Buffer.byteLength(text);
    if (outputBytes > MAX) throw fail("The provider response was too large.");
    output += text;
    if (first) {
      first = false;
      config.onDiagnostics?.({
        firstResponseMs: Math.round(performance.now() - began),
      });
    }
    config.onProgress?.("receiving-response");
    if (performance.now() - lastPreview > 100) {
      config.onDelta?.(output);
      lastPreview = performance.now();
    }
  };
  const event = (raw) => {
    if (!raw || terminal) return;
    if (raw === "[DONE]") {
      if (config.provider !== "custom" || reason !== "stop")
        throw fail("The provider stream ended without a complete answer.");
      terminal = true;
      config.onDiagnostics?.({usage:{complete:true}});
      return;
    }
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw fail("The provider sent invalid streaming data.");
    }
    let usageData=config.provider==="openai"?value?.response:config.provider==="anthropic"&&value?.type==="message_start"?value.message:value;
    if(config.provider==="anthropic"&&usageData?.usage){usageSnapshot={...usageSnapshot,...usageData.usage};usageData={usage:usageSnapshot,model:usageData.model};}
    if(config.provider==="gemini"&&usageData?.usageMetadata){usageSnapshot={...usageSnapshot,...usageData.usageMetadata};usageData={usageMetadata:usageSnapshot,modelVersion:usageData.modelVersion};}
    const usage=providerUsage(config.provider,usageData);
    const model=reportedModel(config.provider,usageData);if(model)config.onDiagnostics?.({reportedModel:model});
    if(Object.keys(usage).length)config.onDiagnostics?.({usage:{...usage,complete:false}});
    if (
      !value ||
      typeof value !== "object" ||
      value.error ||
      ["error", "response.failed", "response.incomplete"].includes(value.type)
    )
      throw fail(
        "The provider could not complete the streamed answer. Try a shorter request or check the API server.",
      );
    if (config.provider === "ollama") {
      append(value.message?.content);
      if (value.done === true) {
        if (value.done_reason && value.done_reason !== "stop")
          throw fail("Ollama returned an incomplete streamed answer.");
        terminal = true;
        config.onDiagnostics?.({usage:{complete:true}});
        config.onDiagnostics?.(ollamaTimings(value));
      }
    } else if (config.provider === "openai") {
      if (value.type === "response.output_text.delta") append(value.delta);
      if (value.type === "response.completed") {
        if (value.response?.status !== "completed")
          throw fail("OpenAI returned an incomplete streamed answer.");
        terminal = true;
        config.onDiagnostics?.({usage:{complete:true}});
      }
    } else if (config.provider === "anthropic") {
      if (
        value.type === "content_block_start" &&
        value.content_block?.type === "text"
      )
        append(value.content_block.text);
      if (
        value.type === "content_block_delta" &&
        value.delta?.type === "text_delta"
      )
        append(value.delta.text);
      if (value.type === "message_delta")
        reason = value.delta?.stop_reason || reason;
      if (value.type === "message_stop") {
        if (!["end_turn", "stop_sequence"].includes(reason))
          throw fail("Claude returned an incomplete streamed answer.");
        terminal = true;
        config.onDiagnostics?.({usage:{complete:true}});
      }
    } else if (config.provider === "gemini") {
      const candidate = value.candidates?.find((c) => !c.index);
      for (const part of candidate?.content?.parts || [])
        if (!part.thought) append(part.text);
      if (candidate?.finishReason) {
        if (candidate.finishReason !== "STOP")
          throw fail("Gemini returned an incomplete streamed answer.");
        terminal = true;
        config.onDiagnostics?.({usage:{complete:true}});
      }
    } else {
      const choice = value.choices?.find((c) => !c.index);
      append(choice?.delta?.content);
      if (choice?.finish_reason) {
        reason = choice.finish_reason;
        if (reason !== "stop")
          throw fail("The custom API returned an incomplete streamed answer.");
      }
    }
  };
  const line = (value) => {
    if (value.endsWith("\r")) value = value.slice(0, -1);
    if (ndjson) {
      if (value.trim()) event(value);
      return;
    }
    if (!value) {
      if (dataLines.length) event(dataLines.join("\n"));
      dataLines = [];
    } else if (value.startsWith("data:"))
      dataLines.push(value.slice(5).replace(/^ /, ""));
  };
  try {
    while (!terminal) {
      if (signal.aborted) throw signal.reason;
      const { value, done } = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (done) {
        buffer += decoder.decode();
        if (buffer) line(buffer);
        if (dataLines.length) event(dataLines.join("\n"));
        break;
      }
      bytes += value.byteLength;
      if (bytes > 4 * MAX) throw fail("The provider response was too large.");
      buffer += decoder.decode(value, { stream: true });
      let end;
      while (!terminal && (end = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
    }
    if (!terminal)
      throw fail(
        "The provider stream was interrupted before completion. Retry explicitly; nothing was saved.",
      );
    config.onDelta?.(output);
    return output;
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
  }
}
