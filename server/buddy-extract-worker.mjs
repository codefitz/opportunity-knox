import { parentPort, workerData } from "node:worker_threads";
try {
  const bytes = Buffer.from(workerData.bytes);
  let text = "",
    warnings = [];
  if (workerData.extension === ".pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes, isEvalSupported: false });
    try {
      const result = await parser.getText({ first: 80 });
      text = result.text;
      if (result.total > 80)
        warnings.push("Only the first 80 PDF pages were extracted.");
    } finally {
      await parser.destroy();
    }
  } else {
    const { default: JSZip } = await import("jszip");
    const { load } = await import("cheerio");
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).filter((name) =>
      /^word\/(document|header\d*|footer\d*)\.xml$/.test(name),
    );
    if (!names.includes("word/document.xml")) throw Error("Missing document");
    names.sort(
      (a, b) =>
        Number(b === "word/document.xml") - Number(a === "word/document.xml"),
    );
    const parts = [];
    for (const name of names.slice(0, 20)) {
      const file = zip.file(name);
      if (file._data?.uncompressedSize > 20 * 1024 * 1024)
        throw Error("Too much XML");
      const xml = await file.async("string");
      if (xml.length > 20 * 1024 * 1024) throw Error("Too much XML");
      const $ = load(xml, { xmlMode: true });
      $("*")
        .filter((_, el) => el.name.split(":").at(-1) === "del")
        .remove();
      const paragraphs = $("*").filter(
        (_, el) => el.name.split(":").at(-1) === "p",
      );
      paragraphs.each((_, para) => {
        const line = $(para)
          .find("*")
          .filter((_, el) => el.name.split(":").at(-1) === "t")
          .map((_, el) => $(el).text())
          .get()
          .join("");
        if (line.trim()) parts.push(line);
      });
    }
    text = parts.join("\n\n");
    warnings.push(
      "Word text extracted from paragraphs, tables, headers and footers. Images and layout are not read.",
    );
  }
  parentPort.postMessage({
    text: text.slice(0, 300000),
    warnings: [
      ...warnings,
      ...(text.length > 300000
        ? ["Text was limited to 300,000 characters."]
        : []),
    ],
  });
} catch {
  parentPort.postMessage({
    error:
      "Text could not be extracted. Try an unlocked text PDF, DOCX, or plain-text copy. Scanned PDFs need OCR first.",
  });
}
