// Only numeric provider accounting is retained; never response bodies or prompts.
export const tokenKeys = [
  "inputTokens",
  "outputTokens",
  "cachedInputTokens",
  "cacheWriteInputTokens",
  "reasoningTokens",
  "toolInputTokens",
  "totalTokens",
];
export const tokenCount = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 1e9;
export function cleanUsage(value) {
  const result = {};
  for (const key of tokenKeys)
    if (tokenCount(value?.[key])) result[key] = value[key];
  if (typeof value?.complete === "boolean") result.complete = value.complete;
  return result;
}
export function providerUsage(provider, data) {
  let value = {};
  if (provider === "openai") {
    const u = data?.usage || {};
    value = {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cachedInputTokens: u.input_tokens_details?.cached_tokens,
      cacheWriteInputTokens: u.input_tokens_details?.cache_write_tokens,
      reasoningTokens: u.output_tokens_details?.reasoning_tokens,
      totalTokens: u.total_tokens,
    };
  } else if (provider === "custom") {
    const u = data?.usage || {};
    value = {
      inputTokens: u.prompt_tokens,
      outputTokens: u.completion_tokens,
      cachedInputTokens: u.prompt_tokens_details?.cached_tokens,
      reasoningTokens: u.completion_tokens_details?.reasoning_tokens,
      totalTokens: u.total_tokens,
    };
  } else if (provider === "anthropic") {
    const u = data?.usage || {};
    value = {
      inputTokens: tokenCount(u.input_tokens)
        ? u.input_tokens +
          (tokenCount(u.cache_read_input_tokens)
            ? u.cache_read_input_tokens
            : 0) +
          (tokenCount(u.cache_creation_input_tokens)
            ? u.cache_creation_input_tokens
            : 0)
        : undefined,
      outputTokens: u.output_tokens,
      cachedInputTokens: u.cache_read_input_tokens,
      cacheWriteInputTokens: u.cache_creation_input_tokens,
    };
  } else if (provider === "gemini") {
    const u = data?.usageMetadata || {};
    value = {
      inputTokens: tokenCount(u.promptTokenCount)
        ? u.promptTokenCount +
          (tokenCount(u.toolUsePromptTokenCount)
            ? u.toolUsePromptTokenCount
            : 0)
        : undefined,
      outputTokens: tokenCount(u.candidatesTokenCount)
        ? u.candidatesTokenCount +
          (tokenCount(u.thoughtsTokenCount) ? u.thoughtsTokenCount : 0)
        : undefined,
      cachedInputTokens: u.cachedContentTokenCount,
      reasoningTokens: u.thoughtsTokenCount,
      toolInputTokens: u.toolUsePromptTokenCount,
      totalTokens: u.totalTokenCount,
    };
  } else if (provider === "ollama")
    value = {
      inputTokens: data?.prompt_eval_count,
      outputTokens: data?.eval_count,
      cachedInputTokens: data?.prompt_eval_cached_count,
    };
  return cleanUsage(value);
}
export function estimateCost(record) {
  const { usage: u, pricing: p } = record;
  if (
    !p ||
    !u?.complete ||
    !tokenCount(u.inputTokens) ||
    !tokenCount(u.outputTokens) ||
    ["codex", "local"].includes(record.provider)
  )
    return null;
  return {
    amount:
      (u.inputTokens * p.inputPerMillion +
        u.outputTokens * p.outputPerMillion) /
      1e6,
    currency: p.currency,
    estimated: true,
    ratesRevision: p.revision,
  };
}
export function reportedModel(provider, data) {
  const value = provider === "gemini" ? data?.modelVersion : data?.model;
  return typeof value === "string" && /^[a-zA-Z0-9._:/@+-]{1,200}$/.test(value)
    ? value
    : undefined;
}
