import {createHash} from "node:crypto";
import {providerUsage,reportedModel} from "./ai-usage.mjs";
import {readProviderStream,ollamaTimings} from "./buddy-stream.mjs";
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
export const EMBEDDING_PROVIDERS = {
  builtin: { name: "Built-in local · MiniLM", baseUrl: "" },
  openai: PROVIDERS.openai,
  ollama: PROVIDERS.ollama,
  custom: PROVIDERS.custom,
};
export const VECTOR_BACKENDS = {
  sqlite: { name: "Built-in local SQLite (default)", baseUrl: "" },
  qdrant: {
    name: "Qdrant vector database",
    baseUrl: "http://host.docker.internal:6333",
  },
  custom: { name: "Custom HTTP vector store", baseUrl: "" },
};
export function defaultEmbedding(localModel = "Xenova/all-MiniLM-L6-v2") {
  return {
    revision: 1,
    provider: "builtin",
    model: localModel,
    baseUrl: "",
    apiKey: "",
    vectorBackend: "sqlite",
    vectorUrl: "",
    vectorCollection: "opportunity_knox_vectors",
    vectorApiKey: "",
  };
}
export function publicEmbedding(config, localModel = "Xenova/all-MiniLM-L6-v2") {
  const { apiKey, vectorApiKey, ...safe } = {
    ...defaultEmbedding(localModel),
    ...config,
  };
  return {
    ...safe,
    hasKey: Boolean(apiKey),
    hasVectorKey: Boolean(vectorApiKey),
    providers: EMBEDDING_PROVIDERS,
    vectorBackends: VECTOR_BACKENDS,
  };
}
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
          "streamResponses",
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
  if(body.streamResponses!==undefined){
    if(typeof body.streamResponses!=="boolean")throw buddyError(400,"Live response previews must be on or off.");
    next.streamResponses=body.streamResponses;
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
  const streaming=typeof config.onDelta==="function"&&config.streamResponses!==false;
  if(streaming){
    if(config.provider==="gemini")url=url.replace(":generateContent",":streamGenerateContent?alt=sse");
    else body.stream=true;
  }
  return { url, headers, body, streaming };
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
const streamedText=Symbol("streamedText");
async function providerJSON(
  config,
  request,
  fetcher = fetch,
  resolve = systemLookup,
  timeout = 120000,
) {
  const began=performance.now();
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
              ? "Check the model ID and output mode in settings."+(request.streaming?" If this API rejects streaming, turn off live answer previews in Settings.":"")
              : "Try again later or check the API server.";
      await response.body?.cancel();
      const error = buddyError(
        502,
        (PROVIDERS[config.provider]?.name ||
          EMBEDDING_PROVIDERS[config.provider]?.name ||
          VECTOR_BACKENDS[config.vectorBackend]?.name ||
          "The API server") +
          " returned HTTP " +
          response.status +
          ". " +
          guidance,
      );
      error.providerStatus = response.status;
      throw error;
    }
    config.onProgress?.("reading-response");
    const contentType=response.headers?.get("content-type")||"";
    if(request.streaming&&(/text\/event-stream/i.test(contentType)||config.provider==="ollama"&&/ndjson/i.test(contentType))){
      config.onDiagnostics?.({responseMode:"streamed"});
      return {[streamedText]:await readProviderStream(response,config,signal,began)};
    }
    if(request.streaming)config.onDiagnostics?.({responseMode:"buffered"});
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
  const began=performance.now();
  config.onDiagnostics?.({promptHash:createHash("sha256").update(system).digest("hex")});
  try {
    if(config.provider==="codex")return await runLocalCodex(config,system,messages,BUDDY_SCHEMA);
    const result=await providerJSON(config,providerRequest(config,system,messages),fetcher,resolve,(config.requestTimeoutSeconds||120)*1000);
    if(!result[streamedText]){const model=reportedModel(config.provider,result);if(model)config.onDiagnostics?.({reportedModel:model});const usage=providerUsage(config.provider,result);if(Object.keys(usage).length)config.onDiagnostics?.({usage:{...usage,complete:true}});}
    if(config.provider==="ollama")config.onDiagnostics?.(ollamaTimings(result));
    const output=result[streamedText]??providerText(config.provider,result);
    if(!output)throw buddyError(502,"The provider returned no usable text (it may have refused the request).");
    return output;
  } finally {
    config.onDiagnostics?.({providerMs:Math.round(performance.now()-began),...(config.signal?.aborted&&config.provider!=="codex"?{cancellation:"transport-stopped"}:{})});
  }
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

export function assertEmbeddingConfigured(config) {
  if (config.provider === "builtin") return;
  if (!["openai", "ollama", "custom"].includes(config.provider))
    throw buddyError(400, "Choose a supported embedding provider.");
  if (!config.model || !config.baseUrl)
    throw buddyError(
      400,
      "Set an embedding model ID and API base URL in Semantic search settings.",
    );
  if (config.provider === "openai" && !config.apiKey)
    throw buddyError(400, "Add an API key for OpenAI embeddings.");
  validateBaseUrl(config.baseUrl);
}

export function assertVectorBackendConfigured(config) {
  const backend = config.vectorBackend || "sqlite";
  if (backend === "sqlite") return;
  if (!["qdrant", "custom"].includes(backend))
    throw buddyError(400, "Choose a supported vector store backend.");
  if (!config.vectorUrl)
    throw buddyError(
      400,
      "Enter a vector store URL in Semantic search settings.",
    );
  validateBaseUrl(config.vectorUrl);
  const col = config.vectorCollection || "opportunity_knox_vectors";
  if (typeof col !== "string" || !/^[a-zA-Z0-9._-]{1,120}$/.test(col))
    throw buddyError(
      400,
      "Use letters, numbers, dots, underscores or hyphens for the vector collection name.",
    );
}

export function updateEmbeddingSettings(
  previous,
  body,
  { requireRevision = true, localModel = "Xenova/all-MiniLM-L6-v2" } = {},
) {
  const current = { ...defaultEmbedding(localModel), ...previous };
  if (!body || typeof body !== "object" || !Object.keys(body).length) {
    if (requireRevision)
      throw buddyError(
        409,
        "Embedding settings changed. Reload before saving.",
      );
    return current;
  }
  if (
    (requireRevision || body.revision !== undefined) &&
    body.revision !== current.revision
  )
    throw buddyError(
      409,
      "Embedding settings changed. Reload before saving.",
    );
  if (
    Object.keys(body).some(
      (key) =>
        ![
          "revision",
          "provider",
          "model",
          "baseUrl",
          "apiKey",
          "clearKey",
          "vectorBackend",
          "vectorUrl",
          "vectorCollection",
          "vectorApiKey",
          "clearVectorKey",
        ].includes(key),
    )
  )
    throw buddyError(400, "Unsupported embedding setting.");
  const next = { ...current };
  const targetProvider = body.provider ?? current.provider ?? "builtin";
  if (!Object.hasOwn(EMBEDDING_PROVIDERS, targetProvider))
    throw buddyError(400, "Choose a supported embedding provider.");
  if (targetProvider === "builtin") {
    next.provider = "builtin";
    next.model = localModel;
    next.baseUrl = "";
    next.apiKey = "";
  } else {
    if (targetProvider !== current.provider) {
      next.apiKey = "";
      next.model = "";
      next.baseUrl = EMBEDDING_PROVIDERS[targetProvider].baseUrl;
    }
    next.provider = targetProvider;
    if (body.model !== undefined)
      next.model = text(body.model, 200, "embedding model ID");
    if (body.baseUrl !== undefined)
      next.baseUrl = text(body.baseUrl, 2000, "embedding API base URL");
    if (next.provider === "openai")
      next.baseUrl = EMBEDDING_PROVIDERS.openai.baseUrl;
    else if (next.baseUrl) next.baseUrl = validateBaseUrl(next.baseUrl);
    if (body.clearKey !== undefined && typeof body.clearKey !== "boolean")
      throw buddyError(400, "Clear key must be true or false.");
    if (
      ["custom", "ollama"].includes(next.provider) &&
      next.baseUrl !== current.baseUrl
    )
      next.apiKey = "";
    if (body.clearKey) next.apiKey = "";
    if (body.apiKey !== undefined && body.apiKey !== "")
      next.apiKey = text(body.apiKey, 4000, "embedding API key");
  }
  const prevBackend = current.vectorBackend || "sqlite";
  const targetBackend = body.vectorBackend ?? prevBackend;
  if (!Object.hasOwn(VECTOR_BACKENDS, targetBackend))
    throw buddyError(400, "Choose a supported vector store backend.");
  if (targetBackend === "sqlite") {
    next.vectorBackend = "sqlite";
    next.vectorUrl = "";
    next.vectorCollection =
      current.vectorCollection || "opportunity_knox_vectors";
    next.vectorApiKey = "";
  } else {
    if (targetBackend !== prevBackend) {
      next.vectorApiKey = "";
      next.vectorUrl = VECTOR_BACKENDS[targetBackend].baseUrl;
    }
    next.vectorBackend = targetBackend;
    if (body.vectorUrl !== undefined)
      next.vectorUrl = text(body.vectorUrl, 2000, "vector store URL");
    if (next.vectorUrl) next.vectorUrl = validateBaseUrl(next.vectorUrl);
    else if (requireRevision)
      throw buddyError(
        400,
        "Enter a vector store URL in Semantic search settings.",
      );
    if (body.vectorCollection !== undefined) {
      const col = text(body.vectorCollection, 120, "vector collection name");
      if (!col || !/^[a-zA-Z0-9._-]+$/.test(col))
        throw buddyError(
          400,
          "Use letters, numbers, dots, underscores or hyphens for the vector collection name.",
        );
      next.vectorCollection = col;
    } else if (!next.vectorCollection) {
      next.vectorCollection = "opportunity_knox_vectors";
    }
    if (
      body.clearVectorKey !== undefined &&
      typeof body.clearVectorKey !== "boolean"
    )
      throw buddyError(400, "Clear vector key must be true or false.");
    if (next.vectorUrl !== (current.vectorUrl || "")) next.vectorApiKey = "";
    if (body.clearVectorKey) next.vectorApiKey = "";
    if (body.vectorApiKey !== undefined && body.vectorApiKey !== "")
      next.vectorApiKey = text(
        body.vectorApiKey,
        4000,
        "vector store API key",
      );
  }
  next.revision = (current.revision || 1) + 1;
  return next;
}

function vectorHeaders(config, hasBody = false) {
  const headers = {};
  if (hasBody) headers["Content-Type"] = "application/json";
  if (config.vectorApiKey) {
    headers.Authorization = "Bearer " + config.vectorApiKey;
    if (config.vectorBackend === "qdrant")
      headers["api-key"] = config.vectorApiKey;
  }
  return headers;
}

function qdrantPointId(sourceId, index) {
  const hex = createHash("sha256")
    .update(`${sourceId}:${index}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function testVectorBackend(
  config,
  fetcher = fetch,
  resolve = systemLookup,
) {
  assertVectorBackendConfigured(config);
  const backend = config.vectorBackend || "sqlite";
  if (backend === "sqlite") return { ok: true, vectorBackend: "sqlite" };
  const url =
    backend === "qdrant"
      ? config.vectorUrl + "/collections"
      : config.vectorUrl + "/health";
  const data = await providerJSON(
    { ...config, provider: "custom" },
    { method: "GET", url, headers: vectorHeaders(config) },
    fetcher,
    resolve,
    15000,
  );
  if (
    !data ||
    typeof data !== "object" ||
    data.ok === false ||
    data.status === "error" ||
    (backend === "qdrant" &&
      !Array.isArray(data.result?.collections) &&
      data.status !== "ok")
  )
    throw buddyError(
      502,
      "The vector store did not return a valid status response.",
    );
  return {
    ok: true,
    vectorBackend: backend,
    vectorCollection: config.vectorCollection || "opportunity_knox_vectors",
  };
}

export async function upsertExternalVectors(
  config,
  payload,
  fetcher = fetch,
  resolve = systemLookup,
) {
  assertVectorBackendConfigured(config);
  const backend = config.vectorBackend || "sqlite";
  if (backend === "sqlite") return;
  const col = config.vectorCollection || "opportunity_knox_vectors";
  const ctx = { ...config, provider: "custom" };
  if (backend === "qdrant") {
    const colUrl =
      config.vectorUrl + "/collections/" + encodeURIComponent(col);
    let needCreate = false;
    try {
      const info = await providerJSON(
        ctx,
        { method: "GET", url: colUrl, headers: vectorHeaders(config) },
        fetcher,
        resolve,
        15000,
      );
      const existingSize = info?.result?.config?.params?.vectors?.size;
      if (
        Number.isInteger(existingSize) &&
        existingSize !== payload.dimensions
      ) {
        await providerJSON(
          ctx,
          { method: "DELETE", url: colUrl, headers: vectorHeaders(config) },
          fetcher,
          resolve,
          15000,
        );
        needCreate = true;
      }
    } catch (error) {
      if (error.providerStatus === 404) needCreate = true;
      else throw error;
    }
    if (needCreate) {
      await providerJSON(
        ctx,
        {
          method: "PUT",
          url: colUrl,
          headers: vectorHeaders(config, true),
          body: {
            vectors: { size: payload.dimensions, distance: "Cosine" },
          },
        },
        fetcher,
        resolve,
        15000,
      );
    }
    await providerJSON(
      ctx,
      {
        method: "POST",
        url: colUrl + "/points/delete?wait=true",
        headers: vectorHeaders(config, true),
        body: {
          filter: {
            must: [{ key: "sourceId", match: { value: payload.sourceId } }],
          },
        },
      },
      fetcher,
      resolve,
      15000,
    );
    await providerJSON(
      ctx,
      {
        method: "PUT",
        url: colUrl + "/points?wait=true",
        headers: vectorHeaders(config, true),
        body: {
          points: payload.vectors.map((v) => ({
            id: qdrantPointId(payload.sourceId, v.index),
            vector: v.values,
            payload: {
              sourceId: payload.sourceId,
              index: v.index,
              hash: v.hash,
              fingerprint: payload.fingerprint,
              model: payload.model,
            },
          })),
        },
      },
      fetcher,
      resolve,
      30000,
    );
    return;
  }
  await providerJSON(
    ctx,
    {
      method: "POST",
      url: config.vectorUrl + "/upsert",
      headers: vectorHeaders(config, true),
      body: {
        collection: col,
        sourceId: payload.sourceId,
        model: payload.model,
        fingerprint: payload.fingerprint,
        dimensions: payload.dimensions,
        vectors: payload.vectors,
      },
    },
    fetcher,
    resolve,
    30000,
  );
}

export async function queryExternalVectors(
  config,
  { model, sourceIds, vector, limit = 200 },
  fetcher = fetch,
  resolve = systemLookup,
) {
  assertVectorBackendConfigured(config);
  const backend = config.vectorBackend || "sqlite";
  if (backend === "sqlite") return [];
  const col = config.vectorCollection || "opportunity_knox_vectors";
  const ctx = { ...config, provider: "custom" };
  if (backend === "qdrant") {
    const colUrl =
      config.vectorUrl + "/collections/" + encodeURIComponent(col);
    const data = await providerJSON(
      ctx,
      {
        method: "POST",
        url: colUrl + "/points/search",
        headers: vectorHeaders(config, true),
        body: {
          vector,
          limit,
          with_payload: true,
          filter: {
            must: [
              { key: "model", match: { value: model } },
              { key: "sourceId", match: { any: sourceIds } },
            ],
          },
        },
      },
      fetcher,
      resolve,
      15000,
    );
    const rows = Array.isArray(data?.result) ? data.result : [];
    return rows.map((item) => ({
      sourceId: item?.payload?.sourceId,
      index: item?.payload?.index,
      hash: item?.payload?.hash,
      fingerprint: item?.payload?.fingerprint,
      model: item?.payload?.model,
      score: item?.score,
    }));
  }
  const data = await providerJSON(
    ctx,
    {
      method: "POST",
      url: config.vectorUrl + "/query",
      headers: vectorHeaders(config, true),
      body: { collection: col, model, sourceIds, vector, limit },
    },
    fetcher,
    resolve,
    15000,
  );
  const rows = Array.isArray(data?.matches)
    ? data.matches
    : Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data?.data)
        ? data.data
        : [];
  return rows.map((item) => ({
    sourceId: item?.sourceId,
    index: item?.index,
    hash: item?.hash,
    fingerprint: item?.fingerprint,
    model: item?.model,
    score: item?.score,
  }));
}

export async function deleteExternalVectors(
  config,
  { sourceIds = [], clear = false },
  fetcher = fetch,
  resolve = systemLookup,
) {
  assertVectorBackendConfigured(config);
  const backend = config.vectorBackend || "sqlite";
  if (backend === "sqlite") return;
  const col = config.vectorCollection || "opportunity_knox_vectors";
  const ctx = { ...config, provider: "custom" };
  if (backend === "qdrant") {
    const colUrl =
      config.vectorUrl + "/collections/" + encodeURIComponent(col);
    try {
      if (clear) {
        await providerJSON(
          ctx,
          { method: "DELETE", url: colUrl, headers: vectorHeaders(config) },
          fetcher,
          resolve,
          15000,
        );
      } else if (sourceIds.length) {
        await providerJSON(
          ctx,
          {
            method: "POST",
            url: colUrl + "/points/delete?wait=true",
            headers: vectorHeaders(config, true),
            body: {
              filter: {
                must: [{ key: "sourceId", match: { any: sourceIds } }],
              },
            },
          },
          fetcher,
          resolve,
          15000,
        );
      }
    } catch (error) {
      if (error.providerStatus !== 404) throw error;
    }
    return;
  }
  await providerJSON(
    ctx,
    {
      method: "POST",
      url: config.vectorUrl + "/delete",
      headers: vectorHeaders(config, true),
      body: {
        collection: col,
        ...(clear ? { clear: true } : { sourceIds }),
      },
    },
    fetcher,
    resolve,
    15000,
  );
}

export function embeddingRequest(config, texts) {
  assertEmbeddingConfigured(config);
  if (
    !Array.isArray(texts) ||
    !texts.length ||
    texts.length > 32 ||
    texts.some(
      (item) => typeof item !== "string" || !item.trim() || item.length > 12000,
    )
  )
    throw buddyError(
      400,
      "Choose between 1 and 32 non-empty text chunks, up to 12,000 characters each.",
    );
  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = "Bearer " + config.apiKey;
  if (config.provider === "ollama") {
    return {
      url: config.baseUrl + "/api/embed",
      headers,
      body: { model: config.model, input: texts },
    };
  }
  return {
    url: config.baseUrl + "/embeddings",
    headers,
    body: {
      model: config.model,
      input: texts,
      encoding_format: "float",
    },
  };
}

export function embeddingVectors(provider, response, expectedCount = 1) {
  let raw = null;
  if (provider === "ollama") {
    if (Array.isArray(response?.embeddings)) raw = response.embeddings;
    else if (expectedCount === 1 && Array.isArray(response?.embedding))
      raw = [response.embedding];
  } else if (Array.isArray(response?.data)) {
    const items = response.data;
    if (
      items.length === expectedCount &&
      items.every(
        (item) =>
          item && typeof item === "object" && Array.isArray(item.embedding),
      )
    ) {
      if (items.every((item) => Number.isInteger(item.index))) {
        const sorted = [...items].sort((a, b) => a.index - b.index);
        if (sorted.every((item, idx) => item.index === idx))
          raw = sorted.map((item) => item.embedding);
      } else {
        raw = items.map((item) => item.embedding);
      }
    }
  } else if (Array.isArray(response?.embeddings)) {
    raw = response.embeddings;
  }
  if (!Array.isArray(raw) || raw.length !== expectedCount)
    throw buddyError(
      502,
      "The endpoint did not return the expected embedding vectors. Check that the base URL and model support embeddings.",
    );
  const dimensions = Array.isArray(raw[0]) ? raw[0].length : 0;
  if (dimensions < 8 || dimensions > 16384)
    throw buddyError(
      502,
      "The endpoint returned an invalid embedding vector dimension.",
    );
  let normalized = true;
  for (const vec of raw) {
    if (
      !Array.isArray(vec) ||
      vec.length !== dimensions ||
      vec.some((n) => typeof n !== "number" || !Number.isFinite(n))
    )
      throw buddyError(
        502,
        "The endpoint returned non-numeric or inconsistent embedding vectors.",
      );
    const norm = Math.hypot(...vec);
    if (!Number.isFinite(norm) || norm <= 0)
      throw buddyError(
        502,
        "The endpoint returned a zero-magnitude embedding vector.",
      );
    if (Math.abs(norm - 1) > 0.01) normalized = false;
  }
  const model =
    typeof response?.model === "string" &&
    response.model.trim() &&
    response.model.length <= 200 &&
    !/[\x00-\x1f\x7f]/.test(response.model)
      ? response.model.trim()
      : "";
  return { vectors: raw, dimensions, normalized, reportedModel: model };
}

export async function callEmbeddingProvider(
  config,
  texts,
  fetcher = fetch,
  resolve = systemLookup,
) {
  const request = embeddingRequest(config, texts);
  let data;
  try {
    data = await providerJSON(
      config,
      request,
      fetcher,
      resolve,
      (config.requestTimeoutSeconds || 30) * 1000,
    );
  } catch (error) {
    if (
      error.providerStatus === 400 ||
      error.providerStatus === 404 ||
      error.providerStatus === 422
    ) {
      const next = buddyError(
        502,
        (EMBEDDING_PROVIDERS[config.provider]?.name || "The provider") +
          " returned HTTP " +
          error.providerStatus +
          ". Check that the base URL supports embeddings and that the selected model is an embedding model.",
      );
      next.providerStatus = error.providerStatus;
      throw next;
    }
    throw error;
  }
  const parsed = embeddingVectors(config.provider, data, texts.length);
  if (config.apiKey && parsed.reportedModel.includes(config.apiKey))
    parsed.reportedModel = "";
  return parsed;
}

export async function testEmbeddingProvider(
  config,
  fetcher = fetch,
  resolve = systemLookup,
) {
  const parsed = await callEmbeddingProvider(
    config,
    ["Fictional embedding capability test."],
    fetcher,
    resolve,
  );
  return {
    ok: true,
    provider: config.provider,
    model: config.model,
    ...(parsed.reportedModel ? { reportedModel: parsed.reportedModel } : {}),
    check: "embedding",
    dimensions: parsed.dimensions,
    normalized: parsed.normalized,
  };
}

/** List available embedding models without saving settings or starting a model. */
export async function listEmbeddingModels(
  config,
  fetcher = fetch,
  resolve = systemLookup,
) {
  if (config.provider === "builtin") {
    const id = config.model || "Xenova/all-MiniLM-L6-v2";
    return { models: [{ id, name: id }], suggested: id, truncated: false };
  }
  if (!["openai", "ollama", "custom"].includes(config.provider))
    throw buddyError(400, "Choose a supported embedding provider.");
  if (!config.baseUrl)
    throw buddyError(400, "Enter the embedding API base URL first.");
  validateBaseUrl(config.baseUrl);
  if (config.provider === "openai" && !config.apiKey)
    throw buddyError(
      400,
      "Add an API key to find embedding models for this provider.",
    );
  const headers = {};
  const path = config.provider === "ollama" ? "/api/tags" : "/models";
  if (config.apiKey) headers.Authorization = "Bearer " + config.apiKey;
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
        "This API does not provide a model list. Enter an embedding model ID manually.",
      );
    if (error.status === 504)
      throw buddyError(
        504,
        "Finding embedding models timed out. Check the server or enter a model ID manually.",
      );
    throw error;
  }
  const rows =
    config.provider === "ollama"
      ? data.models
      : Array.isArray(data.data)
        ? data.data
        : data.models;
  if (!Array.isArray(rows))
    throw buddyError(
      502,
      "The API returned an invalid model list. Enter an embedding model ID manually.",
    );
  const embeddingModels = [],
    fallbackModels = [],
    seen = new Set();
  for (const item of rows.slice(0, 1000)) {
    if (!item || typeof item !== "object") continue;
    const raw =
      config.provider === "ollama"
        ? item.name || item.model
        : item.id || item.name;
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (
      !id ||
      id.length > 200 ||
      /[\x00-\x1f\x7f]/.test(id) ||
      seen.has(id) ||
      (config.apiKey && id.includes(config.apiKey))
    )
      continue;
    seen.add(id);
    if (
      /rerank|whisper|\btts\b|dall-e|flux|diffusion|moderation|realtime|transcribe|canary/i.test(
        id,
      ) ||
      (config.provider === "ollama" &&
        item.details?.format &&
        item.details.format !== "gguf")
    )
      continue;
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
    const families = [
      item.details?.family,
      ...(Array.isArray(item.details?.families) ? item.details.families : []),
      ...(Array.isArray(item.capabilities) ? item.capabilities : []),
      item.task,
      item.type,
      item.object,
    ].filter((v) => typeof v === "string");
    const isEmbedding =
      /embed|minilm|\bbge(?:[-_:/]|$)|\be5(?:[-_:/]|$)|mpnet|paraphrase-|gte-|jina-embeddings|voyage-/i.test(
        id + " " + name,
      ) ||
      families.some((f) =>
        /\b(?:embed|embedding|embeddings|bert|nomic-bert|roberta|xlm-roberta|mpnet)\b/i.test(
          f,
        ),
      );
    const isChat =
      /^(?:gpt-|o[134]-|chatgpt-|claude-|gemini-|davinci|babbage)|\b(?:chat|instruct)\b/i.test(
        id,
      );
    if (isEmbedding) embeddingModels.push({ id, name });
    else if (!isChat) fallbackModels.push({ id, name });
  }
  const models =
    config.provider === "custom" && !embeddingModels.length
      ? fallbackModels
      : embeddingModels;
  const preferred =
    config.provider === "openai"
      ? models.find((m) => m.id === "text-embedding-3-small") ||
        models.find((m) => m.id === "text-embedding-3-large") ||
        models[0]
      : embeddingModels[0] || models[0];
  return {
    models,
    suggested: preferred?.id || "",
    truncated:
      rows.length > 1000 || Boolean(data.has_more || data.nextPageToken),
  };
}
