import { fileURLToPath } from "node:url";
export const LOCAL_MODEL = "Xenova/all-MiniLM-L6-v2";
export const LOCAL_REVISION = "751bff37182d3f1213fa05d7196b954e230abad9";
let loading;
export async function embedLocal(texts) {
  if (
    !Array.isArray(texts) ||
    !texts.length ||
    texts.length > 32 ||
    texts.some(
      (text) => typeof text !== "string" || !text.trim() || text.length > 12000,
    )
  )
    throw Error(
      "Choose between 1 and 32 non-empty text chunks, up to 12,000 characters each.",
    );
  if (!loading)
    loading = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.localModelPath = fileURLToPath(
        new URL("../models/", import.meta.url),
      );
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.useFSCache = false;
      return pipeline("feature-extraction", LOCAL_MODEL, {
        dtype: "q8",
        device: "cpu",
        local_files_only: true,
      });
    })().catch((error) => {
      loading = null;
      throw error;
    });
  const extractor = await loading;
  const result = await extractor(texts, { pooling: "mean", normalize: true });
  return result.tolist();
}
