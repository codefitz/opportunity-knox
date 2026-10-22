import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

export const PROVIDERS = {
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
    if (!["unicast", "private", "loopback", "uniqueLocal"].includes(range))
      throw buddyError(
        400,
        "This special-purpose address cannot be used as an API server.",
      );
  }
  // Private servers are intentional for Ollama/custom. Remote cleartext servers are not.
  const local =
    hostname === "localhost" ||
    hostname === "host.docker.internal" ||
    (isIP(hostname) &&
      ["private", "loopback", "uniqueLocal"].includes(
        ipaddr.process(hostname).range(),
      ));
  if (url.protocol === "http:" && !local)
    throw buddyError(
      400,
      "Use HTTPS for a remote API, or a local/private address for Ollama.",
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
  if (next.enabled) assertConfigured(next);
  next.revision++;
  return next;
}
export function assertConfigured(config) {
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
      max_output_tokens: 8000,
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
      max_tokens: 8000,
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
        maxOutputTokens: 8000,
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
      options: { num_predict: 8000 },
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
      max_tokens: 8000,
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
export async function callProvider(config, system, messages, fetcher = fetch) {
  const request = providerRequest(config, system, messages);
  let response;
  try {
    response = await fetcher(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      redirect: "error",
      signal: AbortSignal.timeout(120000),
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
      throw buddyError(
        502,
        PROVIDERS[config.provider].name +
          " returned HTTP " +
          response.status +
          ". " +
          guidance,
      );
    }
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
    const output = providerText(config.provider, result);
    if (!output)
      throw buddyError(
        502,
        "The provider returned no usable text (it may have refused the request).",
      );
    return output;
  } catch (error) {
    if (error.status) throw error;
    if (error.name === "TimeoutError" || error.name === "AbortError")
      throw buddyError(
        504,
        "Career Buddy timed out after two minutes. Try a smaller context or a faster model.",
      );
    throw buddyError(
      502,
      "Could not reach the API server. Check the base URL and that the host can access it. For host Ollama in Docker, use host.docker.internal instead of localhost.",
    );
  }
}
