import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { collectFileList, collectDroppedFiles } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

test("folder picker preserves more than 500 files and skips hidden paths", () => {
  const files = Array.from({ length: 1007 }, (_, i) => ({ name: `file-${i}.txt`, webkitRelativePath: `career/file-${i}.txt` }));
  files.push({ name: "secret.txt", webkitRelativePath: "career/.hidden/secret.txt" });
  const result = collectFileList(files);
  assert.equal(result.length, 1007);
  assert.equal(result[1006].path, "career/file-1006.txt");
});

test("dropped folders traverse multiple browser entry batches without truncation", async () => {
  const files = Array.from({ length: 1007 }, (_, i) => ({ isFile: true, name: `file-${i}.txt`, file: (resolve) => resolve({ name: `file-${i}.txt` }) }));
  let offset = 0;
  const dir = { name: "career", isDirectory: true, createReader: () => ({ readEntries: (resolve) => { const batch = files.slice(offset, offset + 100); offset += batch.length; resolve(batch); } }) };
  const result = await collectDroppedFiles({ items: [{ webkitGetAsEntry: () => dir }], files: [] });
  assert.equal(result.length, 1007);
  assert.equal(result[1006].path, "career/file-1006.txt");
});
