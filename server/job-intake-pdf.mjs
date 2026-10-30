import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
const run = promisify(execFile);
const failure = (status, message) =>
  Object.assign(new Error(message), { status });
/** Native tools run in a private preview folder; OCR never changes the input PDF. */
export async function readJobPDF(
  bytes,
  folder,
  { ocr = true, signal, onProgress = () => {}, runner = run } = {},
) {
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw failure(
      415,
      "This file is not a PDF. Use a PDF, DOCX or UTF-8 text copy.",
    );
  const pdf = join(folder, "read.pdf"),
    textFile = join(folder, "pdf-text.txt"),
    warnings = [];
  writeFileSync(pdf, bytes, { mode: 0o600 });
  const began = Date.now();
  const execute = (tool, args, timeout = 15000) =>
    runner(tool, args, {
      timeout: Math.min(timeout, Math.max(1, 90000 - (Date.now() - began))),
      maxBuffer: 1024 * 1024,
      signal,
      env: { ...process.env, OMP_THREAD_LIMIT: "1" },
    });
  try {
    onProgress("reading-pdf");
    const info = await execute("pdfinfo", [pdf]);
    const total = Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
    if (!total)
      throw failure(
        422,
        "The PDF page count could not be read. It may be locked or damaged.",
      );
    await execute("pdftotext", [
      "-f",
      "1",
      "-l",
      String(Math.min(40, total)),
      "-layout",
      "-enc",
      "UTF-8",
      pdf,
      textFile,
    ]);
    if (statSync(textFile).size > 4 * 1024 * 1024)
      throw failure(
        413,
        "The extracted PDF text is too large. Upload a shorter job description.",
      );
    const native = readFileSync(textFile, "utf8").split("\f"),
      pages = [],
      ocrPages = [];
    for (let page = 1; page <= Math.min(40, total); page++) {
      if (signal?.aborted) throw failure(499, "Job intake cancelled.");
      let text = (native[page - 1] || "").trim(),
        method = "text";
      if (text.replace(/\s/g, "").length < 40 && ocr) {
        if (page > 12) {
          warnings.push(
            "OCR is limited to the first 12 pages; later scanned pages were not read.",
          );
        } else if (Date.now() - began > 90000) {
          warnings.push(
            "The 90-second OCR preparation budget was reached. Some pages were not read.",
          );
        } else {
          onProgress("ocr");
          const prefix = join(folder, "ocr-page-" + page),
            png = prefix + ".png";
          try {
            await execute("pdftoppm", [
              "-f",
              String(page),
              "-l",
              String(page),
              "-singlefile",
              "-scale-to",
              "1800",
              "-png",
              pdf,
              prefix,
            ]);
            if (statSync(png).size > 12 * 1024 * 1024)
              throw failure(413, "A scanned PDF page is too large.");
            const result = await execute(
              "tesseract",
              [png, "stdout", "-l", "eng", "--psm", "3"],
              15000,
            );
            if (result.stdout.trim().length > text.length)
              text = result.stdout.trim();
            method = "ocr";
            ocrPages.push(page);
          } catch (e) {
            if (signal?.aborted) throw failure(499, "Job intake cancelled.");
            warnings.push(
              e.code === "ENOENT"
                ? "Local OCR is unavailable. Use the bundled Docker build or paste a text copy."
                : `Page ${page} could not be read by OCR within its limit. Check the original.`,
            );
          } finally {
            rmSync(png, { force: true });
          }
        }
      }
      if (text.length > 30000)
        warnings.push(
          `Page ${page} text was limited to 30,000 characters. The full PDF is retained.`,
        );
      pages.push({ page, text: text.slice(0, 30000), method });
    }
    if (total > 40)
      warnings.push(
        "Only the first 40 PDF pages were read. The full original PDF is retained.",
      );
    if (ocrPages.length)
      warnings.push(
        "OCR was used on scanned pages. Check names, salary figures and dates against the original; recognition can make mistakes. OCR uses the bundled English language model.",
      );
    if (pages.some((p) => !p.text.trim()))
      warnings.push(
        "Some PDF pages have no readable text. Review the original for missing information.",
      );
    return {
      pages,
      totalPages: total,
      ocrPages,
      warnings: [...new Set(warnings)],
    };
  } catch (e) {
    if (signal?.aborted) throw failure(499, "Job intake cancelled.");
    if (e.status) throw e;
    throw failure(
      e.code === "ENOENT" ? 503 : 422,
      e.code === "ENOENT"
        ? "PDF reading needs the bundled Docker build."
        : "This PDF could not be read. Use an unlocked PDF or paste its text.",
    );
  } finally {
    rmSync(pdf, { force: true });
    rmSync(textFile, { force: true });
  }
}
