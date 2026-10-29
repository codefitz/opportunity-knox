import { runLocalCodex, listLocalCodexModels } from "./codex-local.mjs";
import { isIP } from "node:net";
import { lookup as systemLookup } from "node:dns";
import { Agent } from "undici";
import ipaddr from "ipaddr.js";

export const PROVIDERS = {
  codex: {
    name: "Codex · local CLI",
    baseUrl: "http://host.docker.internal/codex-local",
  },
  openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  anthropic: { name: "Claude", baseUrl: "https://api.anthropic.com/v1" },
  gemini: {
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  ollama: { name: "Ollama", baseUrl: "http://host.docker.internal:11434" },
  custom: { name: "Custom (OpenAI compatible)", baseUrl: "" },
};
export function buddyError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
const text = (value, max, label) => {
  if (typeof value !== "string" || value.length > max || /[\0\r\n]/.test(value))
    throw buddyError(400, "Invalid " + label + ".");
  return value.trim();
};
export function defaultBuddy() {
  return {
    revision: 1,
    enabled: false,
    provider: "openai",
    model: "",
    baseUrl: PROVIDERS.openai.baseUrl,
    apiKey: "",
    outputMode: "schema",
  };
}
export function publicBuddy(config) {
  const { apiKey, ...safe } = config;
  return { ...safe, hasKey: Boolean(apiKey), providers: PROVIDERS };
}
const PRIVATE_RANGES = [
  "private",
  "loopback",
  "uniqueLocal",
  "carrierGradeNat",
];
const isPrivateAddress = (address) =>
  Boolean(isIP(address)) &&
  PRIVATE_RANGES.includes(ipaddr.process(address).range());

// Resolve at connection time and pass the validated results straight to the socket.
// A configured name must not resolve to a mixture of private and public addresses.
export function privateNetworkLookup(resolve = systemLookup) {
  return (hostname, options, callback) => {
    resolve(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) return callback(error);
      if (
        !Array.isArray(addresses) ||
        !addresses.length ||
        addresses.some(({ address }) => !isPrivateAddress(address))
      ) {
        const blocked = new Error(
          "HTTP hostnames must resolve only to private network addresses.",
        );
        blocked.code = "ERR_BUDDY_NONPRIVATE_DNS";
        return callback(blocked);
      }
      if (options?.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

export function validateBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw buddyError(400, "Enter a complete API base URL.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw buddyError(
      400,
      "Use an HTTP(S) API base URL without credentials, query strings or fragments.",
    );
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    hostname === "metadata.google.internal" ||
    hostname.endsWith(".metadata.google.internal")
  )
    throw buddyError(400, "Metadata endpoints are not API servers.");
  if (isIP(hostname)) {
    const range = ipaddr.process(hostname).range();
    if (!["unicast", ...PRIVATE_RANGES].includes(range))
      throw buddyError(
        400,
        "This special-purpose address cannot be used as an API server.",
      );
  }
  // Hostnames can be saved while offline; their DNS addresses are checked when connecting.
  if (url.protocol === "http:" && isIP(hostname) && !isPrivateAddress(hostname))
    throw buddyError(
      400,
      "Use HTTPS for a public API, or a private network address for Ollama.",
    );
  return url.href.replace(/\/+$/, "");
}
export function updateBuddy(previous, body) {
  if (body.revision !== previous.revision)
    throw buddyError(
      409,
      "Career Buddy settings changed. Reload settings before saving.",
    );
  if (
    Object.keys(body).some(
      (key) =>
        ![
          "revision",
          "enabled",
          "provider",
          "model",
          "baseUrl",
          "apiKey",
          "clearKey",
          "outputMode",
          "requestTimeoutSeconds",
          "maxOutputTokens",
          "contextCharacters",
        ].includes(key),
    )
  )
    throw buddyError(400, "Unsupported Career Buddy setting.");
  const next = { ...previous };
  if (body.provider !== undefined) {
    if (!Object.hasOwn(PROVIDERS, body.provider))
      throw buddyError(400, "Choose a supported provider.");
    if (body.provider !== previous.provider) {
      next.apiKey = "";
      next.model = "";
      next.baseUrl = PROVIDERS[body.provider].baseUrl;
    }
    next.provider = body.provider;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean")
      throw buddyError(400, "Enabled must be true or false.");
    next.enabled = body.enabled;
  }
  if (body.model !== undefined) next.model = text(body.model, 200, "model ID");
  if (body.baseUrl !== undefined)
    next.baseUrl = text(body.baseUrl, 2000, "API base URL");
  if (["openai", "anthropic", "gemini"].includes(next.provider))
    next.baseUrl = PROVIDERS[next.provider].baseUrl;
  else if (next.baseUrl) next.baseUrl = validateBaseUrl(next.baseUrl);
  if (body.clearKey !== undefined && typeof body.clearKey !== "boolean")
    throw buddyError(400, "Clear key must be true or false.");
  if (
    ["custom", "ollama"].includes(next.provider) &&
    next.baseUrl !== previous.baseUrl
  )
    next.apiKey = "";
  if (body.clearKey) next.apiKey = "";
  if (body.apiKey !== undefined && body.apiKey !== "")
    next.apiKey = text(body.apiKey, 4000, "API key");
  if (body.outputMode !== undefined) {
    if (!["schema", "json", "prompt"].includes(body.outputMode))
      throw buddyError(400, "Choose a supported output mode.");
    next.outputMode = body.outputMode;
  }
  if (next.provider === "codex") {
    next.apiKey = "";
    next.baseUrl = PROVIDERS.codex.baseUrl;
  }
  for (const [key, min, max] of [
    ["requestTimeoutSeconds", 30, 900],
    ["maxOutputTokens", 512, 8000],
    ["contextCharacters", 4000, 36000],
  ])
    if (body[key] !== undefined) {
      if (!Number.isInteger(body[key]) || body[key] < min || body[key] > max)
        throw buddyError(400, `Invalid ${key}: choose ${min}–${max}.`);
      next[key] = body[key];
    }
  if (next.enabled) assertConfigured(next);
  next.revision++;
  return next;
}
export function assertConfigured(config) {
  if (config.provider === "codex") {
    if (!config.model) throw buddyError(400, "Choose a Codex model.");
    return;
  }
  if (!config.model || !config.baseUrl)
    throw buddyError(
      400,
      "Set a model ID and API base URL in Career Buddy settings.",
    );
  if (
    ["openai", "anthropic", "gemini"].includes(config.provider) &&
    !config.apiKey
  )
    throw buddyError(400, "Add an API key for this provider.");
  validateBaseUrl(config.baseUrl);
}
const string = { type: "string" };
export const BUDDY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: string,
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            enum: ["note", "interview", "communication", "update"],
          },
          title: string,
          date: string,
          type: string,
          status: string,
          notes: string,
          field: string,
          value: string,
          isFinal: { type: "boolean" },
        },
        required: [
          "kind",
          "title",
          "date",
          "type",
          "status",
          "notes",
          "field",
          "value",
          "isFinal",
        ],
      },
    },
    draft: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["none", "cv", "cover"] },
        title: string,
        content: string,
      },
      required: ["kind", "title", "content"],
    },
    sourceIds: { type: "array", items: string },
  },
  required: ["reply", "changes", "draft", "sourceIds"],
};
export function providerRequest(config, system, messages) {
  assertConfigured(config);
  const headers = { "Content-Type": "application/json" };
  const all = [{ role: "system", content: system }, ...messages];
  const mode = config.outputMode || "schema";
  let url, body;
  if (config.provider === "openai") {
    url = config.baseUrl + "/responses";
    headers.Authorization = "Bearer " + config.apiKey;
    body = {
      model: config.model,
      store: false,
      max_output_tokens: config.maxOutputTokens || 8000,
      input: all,
      ...(mode !== "prompt"
        ? {
            text: {
              format:
                mode === "schema"
                  ? {
                      type: "json_schema",
                      name: "career_buddy",
                      strict: true,
                      schema: BUDDY_SCHEMA,
                    }
                  : { type: "json_object" },
            },
          }
        : {}),
    };
  } else if (config.provider === "anthropic") {
    url = config.baseUrl + "/messages";
    headers["x-api-key"] = config.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: config.model,
      max_tokens: config.maxOutputTokens || 8000,
      system,
      messages,
      ...(mode === "schema"
        ? {
            output_config: {
              format: { type: "json_schema", schema: BUDDY_SCHEMA },
            },
          }
        : {}),
    };
  } else if (config.provider === "gemini") {
    url =
      config.baseUrl +
      "/models/" +
      encodeURIComponent(config.model.replace(/^models\//, "")) +
      ":generateContent";
    headers["x-goog-api-key"] = config.apiKey;
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        maxOutputTokens: config.maxOutputTokens || 8000,
        ...(mode !== "prompt"
          ? {
              responseMimeType: "application/json",
              ...(mode === "schema"
                ? { responseJsonSchema: BUDDY_SCHEMA }
                : {}),
            }
          : {}),
      },
    };
  } else if (config.provider === "ollama") {
    url = config.baseUrl + "/api/chat";
    if (config.apiKey) headers.Authorization = "Bearer " + config.apiKey;
    body = {
      model: config.model,
      stream: false,
      messages: all,
      options: { num_predict: config.maxOutputTokens || 8000 },
      ...(mode !== "prompt"
        ? { format: mode === "schema" ? BUDDY_SCHEMA : "json" }
        : {}),
    };
  } else {
    url = config.baseUrl + "/chat/completions";
    if (config.apiKey) headers.Authorization = "Bearer " + config.apiKey;
    body = {
      model: config.model,
      stream: false,
      max_tokens: config.maxOutputTokens || 8000,
      messages: all,
      ...(mode !== "prompt"
        ? {
            response_format:
              mode === "schema"
                ? {
                    type: "json_schema",
                    json_schema: {
                      name: "career_buddy",
                      strict: true,
                      schema: BUDDY_SCHEMA,
                    },
                  }
                : { type: "json_object" },
          }
        : {}),
    };
  }
  return { url, headers, body };
}
export function providerText(provider, response) {
  if (provider === "openai") {
    if (response.status && response.status !== "completed")
      throw buddyError(
        502,
        "The provider returned an incomplete response. Try a shorter request.",
      );
    return (response.output || [])
      .flatMap((item) => item.content || [])
      .filter((item) => item.type === "output_text")
      .map((item) => item.text)
      .join("\n");
  }
  if (provider === "anthropic") {
    if (
      response.stop_reason === "max_tokens" ||
      response.stop_reason === "refusal"
    )
      throw buddyError(
        502,
        "Claude could not complete this response. Try a shorter request.",
      );
    return (response.content || [])
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
  }
  if (provider === "gemini") {
    const candidate = response.candidates?.[0];
    if (
      !candidate ||
      (candidate.finishReason && candidate.finishReason !== "STOP")
    )
      throw buddyError(
        502,
        "Gemini did not return a complete response. Check the model and request.",
      );
    return (candidate.content?.parts || [])
      .filter((item) => !item.thought)
      .map((item) => item.text || "")
      .join("\n");
  }
  if (provider === "ollama") {
    if (!response.done || response.done_reason === "length")
      throw buddyError(
        502,
        "Ollama returned an incomplete response. Try a shorter request or another model.",
      );
    return response.message?.content || "";
  }
  const choice = response.choices?.[0];
  if (choice?.finish_reason && choice.finish_reason !== "stop")
    throw buddyError(502, "The custom API returned an incomplete response.");
  return choice?.message?.content || "";
}
async function providerJSON(
  config,
  request,
  fetcher = fetch,
  resolve = systemLookup,
  timeout = 120000,
) {
  const timeoutSignal = AbortSignal.timeout(timeout);
  const signal = config.signal
    ? AbortSignal.any([config.signal, timeoutSignal])
    : timeoutSignal;
  const url = new URL(request.url);
  const dispatcher =
    url.protocol === "http:" && !isIP(url.hostname.replace(/^\[|\]$/g, ""))
      ? new Agent({ connect: { lookup: privateNetworkLookup(resolve) } })
      : null;
  let response;
  try {
    config.onProgress?.("waiting-provider");
    response = await fetcher(request.url, {
      method: request.method || "POST",
      headers: request.headers,
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body) }),
      redirect: "error",
      signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
    if (!response.ok) {
      const guidance =
        response.status === 401 || response.status === 403
          ? "Check the API key and model access."
          : response.status === 429
            ? "The provider is rate limited or out of credits. Try later."
            : response.status === 400 || response.status === 404
              ? "Check the model ID and output mode in settings."
              : "Try again later or check the API server.";
      await response.body?.cancel();
      const error = buddyError(
        502,
        PROVIDERS[config.provider].name +
          " returned HTTP " +
          response.status +
          ". " +
          guidance,
      );
      error.providerStatus = response.status;
      throw error;
    }
    config.onProgress?.("reading-response");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        throw buddyError(502, "The provider response was too large.");
      }
      chunks.push(value);
    }
    let result;
    try {
      result = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      throw buddyError(
        502,
        "The API server did not return JSON. Check its base URL.",
      );
    }
    return result;
  } catch (error) {
    if (config.signal?.aborted)
      throw buddyError(499, "Career Buddy request cancelled.");
    if (error.status) throw error;
    if (error.cause?.code === "ERR_BUDDY_NONPRIVATE_DNS")
      throw buddyError(
        400,
        "This HTTP hostname does not resolve exclusively to private network addresses. Use HTTPS for a public API.",
      );
    if (error.cause?.code === "ENOTFOUND")
      throw buddyError(
        502,
        "The API hostname could not be resolved from the app host. Check the name and network connection.",
      );
    if (error.name === "TimeoutError" || error.name === "AbortError")
      throw buddyError(
        504,
        `The board stopped waiting after ${Math.round(timeout / 1000)} seconds. Try a smaller context, a faster model or increase the request timeout in Settings.`,
      );
    throw buddyError(
      502,
      "Could not reach the API server. Check the base URL and that the host can access it. For host Ollama in Docker, use host.docker.internal instead of localhost.",
    );
  } finally {
    if (dispatcher) await dispatcher.destroy();
  }
}

export async function callProvider(
  config,
  system,
  messages,
  fetcher = fetch,
  resolve = systemLookup,
) {
  if (config.provider === "codex")
    return runLocalCodex(config, system, messages, BUDDY_SCHEMA);
  const result = await providerJSON(
    config,
    providerRequest(config, system, messages),
    fetcher,
    resolve,
    (config.requestTimeoutSeconds || 120) * 1000,
  );
  const output = providerText(config.provider, result);
  if (!output)
    throw buddyError(
      502,
      "The provider returned no usable text (it may have refused the request).",
    );
  return output;
}

/** List available models without saving settings or starting a model. */
export async function listProviderModels(
  config,
  fetcher = fetch,
  resolve = systemLookup,
) {
  if (config.provider === "codex") return listLocalCodexModels();
  if (!config.baseUrl) throw buddyError(400, "Enter the API base URL first.");
  validateBaseUrl(config.baseUrl);
  if (
    ["openai", "anthropic", "gemini"].includes(config.provider) &&
    !config.apiKey
  )
    throw buddyError(400, "Add an API key to find models for this provider.");
  const headers = {};
  let path = "/models";
  if (config.provider === "ollama") path = "/api/tags";
  if (config.provider === "anthropic") {
    headers["x-api-key"] = config.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    path += "?limit=1000";
  } else if (config.provider === "gemini") {
    headers["x-goog-api-key"] = config.apiKey;
    path += "?pageSize=1000";
  } else if (config.apiKey) headers.Authorization = "Bearer " + config.apiKey;
  let data;
  try {
    data = await providerJSON(
      config,
      { method: "GET", url: config.baseUrl + path, headers },
      fetcher,
      resolve,
      15000,
    );
  } catch (error) {
    if (error.providerStatus === 404)
      throw buddyError(
        502,
        "This API does not provide a model list. Enter a model ID manually.",
      );
    if (error.status === 504)
      throw buddyError(
        504,
        "Finding models timed out. Check the server or enter a model ID manually.",
      );
    throw error;
  }
  const rows =
    config.provider === "ollama" || config.provider === "gemini"
      ? data.models
      : data.data;
  if (!Array.isArray(rows))
    throw buddyError(
      502,
      "The API returned an invalid model list. Enter a model ID manually.",
    );
  const models = [],
    seen = new Set();
  let suggested = "";
  for (const item of rows.slice(0, 1000)) {
    if (!item || typeof item !== "object") continue;
    if (
      config.provider === "gemini" &&
      Array.isArray(item.supportedGenerationMethods) &&
      !item.supportedGenerationMethods.includes("generateContent")
    )
      continue;
    const raw =
      config.provider === "ollama"
        ? item.name || item.model
        : config.provider === "gemini"
          ? item.name
          : item.id;
    if (typeof raw !== "string") continue;
    const id = (
      config.provider === "gemini" ? raw.replace(/^models\//, "") : raw
    ).trim();
    if (
      !id ||
      id.length > 200 ||
      /[\x00-\x1f\x7f]/.test(id) ||
      seen.has(id) ||
      (config.apiKey && id.includes(config.apiKey))
    )
      continue;
    seen.add(id);
    const display =
      typeof item.display_name === "string"
        ? item.display_name
        : typeof item.displayName === "string"
          ? item.displayName
          : "";
    const name =
      display &&
      display !== id &&
      display.length <= 200 &&
      !(config.apiKey && display.includes(config.apiKey)) &&
      !/[\x00-\x1f\x7f]/.test(display)
        ? display + " (" + id + ")"
        : id;
    models.push({ id, name });
    if (
      !suggested &&
      config.provider === "ollama" &&
      item.details?.format === "gguf" &&
      !/embed|rerank|flux|diffusion|whisper|\btts\b/i.test(id)
    )
      suggested = id;
  }
  return {
    models,
    suggested,
    truncated:
      rows.length > 1000 || Boolean(data.has_more || data.nextPageToken),
  };
}
