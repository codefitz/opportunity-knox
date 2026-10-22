import { Worker } from "node:worker_threads";
import { extname } from "node:path";
import { createHash } from "node:crypto";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { buddyError } from "./buddy-provider.mjs";

export function chunkText(text, size = 1500) {
  const clean = text.replace(/\0/g, "").replace(/\r\n?/g, "\n").trim();
  const chunks = [];
  for (let start = 0; start < clean.length;) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const boundary = clean.lastIndexOf("\n", end);
      if (boundary > start + size / 2) end = boundary;
    }
    const value = clean.slice(start, end).trim();
    if (value) chunks.push({ index: chunks.length + 1, text: value });
    if (end === clean.length) break;
    start = Math.max(start + 1, end - 150);
  }
  return chunks;
}
export async function extractDocument(name, bytes) {
  const extension = extname(name).toLowerCase();
  if (bytes.length > 20 * 1024 * 1024)
    return {
      status: "unavailable",
      text: "",
      chunks: [],
      warnings: ["This file exceeds the 20 MB extraction limit."],
    };
  if ([".txt", ".md", ".csv", ".json"].includes(extension)) {
    const text = bytes
      .toString("utf8")
      .replace(/^\uFEFF/, "")
      .slice(0, 300000);
    if (text.includes("\uFFFD") || text.includes("\0"))
      return {
        status: "unavailable",
        text: "",
        chunks: [],
        warnings: ["Use a UTF-8 text copy of this file."],
      };
    const chunks = chunkText(text);
    return {
      status: chunks.length ? "ready" : "unavailable",
      text,
      chunks,
      warnings:
        bytes.length > 300000
          ? ["Text was limited to 300,000 characters."]
          : [],
    };
  }
  if (![".pdf", ".docx"].includes(extension))
    return {
      status: "unsupported",
      text: "",
      chunks: [],
      warnings: [
        "Use PDF, DOCX, TXT or Markdown for Career Buddy. The original is still stored.",
      ],
    };
  const result = await new Promise((resolve) => {
    const worker = new Worker(
      new URL("./buddy-extract-worker.mjs", import.meta.url),
      {
        workerData: { bytes, extension },
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve({
        error: "Extraction timed out. Try a smaller file or a text copy.",
      });
    }, 25000);
    const finish = (value) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(value);
    };
    worker.once("message", finish);
    worker.once("error", () =>
      finish({
        error:
          "The document could not be read within the extraction memory limit. Try a smaller text copy.",
      }),
    );
    worker.once("exit", (code) => {
      if (code)
        finish({
          error: "Document extraction stopped. Try a smaller text copy.",
        });
    });
  });
  const chunks = chunkText(result.text || "");
  return {
    status: chunks.length ? "ready" : "unavailable",
    text: result.text || "",
    chunks,
    warnings: result.error
      ? [result.error]
      : [
          ...result.warnings,
          ...(!chunks.length
            ? ["No readable text found. Scanned PDFs need OCR first."]
            : []),
        ],
  };
}
const words = (value) =>
  (
    value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]{2,}/gu) || []
  ).filter(
    (word) =>
      ![
        "the",
        "and",
        "for",
        "with",
        "that",
        "this",
        "from",
        "have",
        "your",
        "you",
        "are",
        "will",
        "our",
        "can",
        "has",
        "was",
      ].includes(word),
  );
export function retrieveChunks(documents, query, limit = 36000) {
  const terms = new Set(words(query));
  const selected = [],
    candidates = [];
  let used = 0;
  for (const doc of documents) {
    for (const chunk of doc.chunks || []) {
      const tokens = new Set(words(chunk.text));
      const score = [...terms].reduce(
        (sum, term) => sum + Number(tokens.has(term)),
        0,
      );
      candidates.push({
        sourceId: doc.id,
        name: doc.name,
        kind: doc.kind,
        index: chunk.index,
        text: chunk.text,
        score,
      });
    }
  }
  // Give every selected readable document a first excerpt before ranking the rest.
  const first = candidates.filter((chunk) => chunk.index === 1);
  const remaining = candidates
    .filter((chunk) => chunk.index !== 1)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  for (const chunk of [...first, ...remaining]) {
    if (used + chunk.text.length > limit) continue;
    selected.push(chunk);
    used += chunk.text.length;
  }
  return {
    chunks: selected,
    characters: used,
    omittedChunks: candidates.length - selected.length,
  };
}
export async function wordDraft(title, content) {
  if (typeof content !== "string" || !content.trim() || content.length > 60000)
    throw buddyError(
      400,
      "Draft content must be between 1 and 60,000 characters.",
    );
  const paragraphs = content
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const heading = line.match(/^(#{1,3})\s+(.+)/);
      const bullet = line.match(/^[-*•]\s+(.+)/);
      const value = (heading?.[2] || bullet?.[1] || line).replace(
        /\*\*([^*]+)\*\*/g,
        "$1",
      );
      return new Paragraph({
        ...(heading
          ? {
              heading:
                heading[1].length === 1
                  ? HeadingLevel.TITLE
                  : HeadingLevel.HEADING_1,
            }
          : {}),
        ...(bullet ? { bullet: { level: 0 } } : {}),
        spacing: { after: line ? 90 : 45 },
        keepNext: Boolean(heading),
        children: [new TextRun({ text: value })],
      });
    });
  return Packer.toBuffer(
    new Document({
      title,
      creator: "Opportunity Knox",
      styles: {
        default: {
          document: {
            run: { font: "Calibri", size: 22, color: "202820" },
            paragraph: { spacing: { line: 270 } },
          },
          title: {
            run: { font: "Calibri", size: 36, bold: true, color: "202820" },
          },
          heading1: {
            run: { font: "Calibri", size: 25, bold: true, color: "202820" },
            paragraph: { spacing: { before: 180, after: 100 } },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size: { width: 11906, height: 16838 },
              margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 },
            },
          },
          children: paragraphs,
        },
      ],
    }),
  );
}
export const fingerprint = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
