import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
const model = "Xenova/all-MiniLM-L6-v2",
  revision = "751bff37182d3f1213fa05d7196b954e230abad9";
const files = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "vocab.txt",
  "onnx/model_quantized.onnx",
  "README.md",
];
const root = process.argv[2] || "models";
const hashes = {};
const pinned = JSON.parse(
  await readFile(new URL("./embedding-model.json", import.meta.url), "utf8"),
);
for (const file of files) {
  const response = await fetch(
    `https://huggingface.co/${model}/resolve/${revision}/${file}`,
    { signal: AbortSignal.timeout(180000) },
  );
  if (!response.ok)
    throw Error(`Model download failed: ${file} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== pinned.hashes[file])
    throw Error("Model checksum mismatch: " + file);
  const target = join(root, model, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  hashes[file] = createHash("sha256").update(bytes).digest("hex");
}
await writeFile(
  join(root, model, "bundle.json"),
  JSON.stringify({ model, revision, license: "Apache-2.0", hashes }, null, 2),
);
console.log(JSON.stringify(hashes));

await writeFile(
  join(root, model, "LICENSE"),
  await readFile(
    new URL(
      "../node_modules/@huggingface/transformers/LICENSE",
      import.meta.url,
    ),
  ),
);
