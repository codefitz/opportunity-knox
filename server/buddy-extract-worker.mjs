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
  } else if (workerData.extension === ".pptx") {
    const { default: JSZip } = await import("jszip");
    const { load } = await import("cheerio");
    const zip = await JSZip.loadAsync(bytes);
    const slideOrder = (name) => {
      const m = name.match(/(\d+)\.xml$/);
      return m ? Number(m[1]) : 9999;
    };
    const slides = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => slideOrder(a) - slideOrder(b));
    if (!slides.length) throw Error("Missing slides");
    const readXmlParagraphs = async (entryName) => {
      const file = zip.file(entryName);
      if (!file) return [];
      if (file._data?.uncompressedSize > 20 * 1024 * 1024)
        throw Error("Too much XML");
      const xml = await file.async("string");
      if (xml.length > 20 * 1024 * 1024) throw Error("Too much XML");
      const $ = load(xml, { xmlMode: true });
      const lines = [];
      $("*")
        .filter((_, el) => el.name.split(":").at(-1) === "p")
        .each((_, para) => {
          const line = $(para)
            .find("*")
            .filter((_, el) => el.name.split(":").at(-1) === "t")
            .map((_, el) => $(el).text())
            .get()
            .join("");
          if (line.trim()) lines.push(line.trim());
        });
      return lines;
    };
    const parts = [];
    for (const slideName of slides.slice(0, 120)) {
      const num = slideOrder(slideName);
      const slideLines = await readXmlParagraphs(slideName);
      const noteLines = await readXmlParagraphs(
        `ppt/notesSlides/notesSlide${num}.xml`,
      );
      if (slideLines.length || noteLines.length) {
        const block = [`[Slide ${num}]`, ...slideLines];
        if (noteLines.length) block.push("Speaker notes:", ...noteLines);
        parts.push(block.join("\n"));
      }
    }
    if (slides.length > 120)
      warnings.push("Only the first 120 slides were extracted.");
    text = parts.join("\n\n");
    warnings.push(
      "PowerPoint text extracted from slides and speaker notes. Embedded images and charts are not read.",
    );
  } else {
    const { default: JSZip } = await import("jszip");
    const { load } = await import("cheerio");
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).filter((name) =>
      /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(
        name,
      ),
    );
    if (!names.includes("word/document.xml")) throw Error("Missing document");
    names.sort(
      (a, b) =>
        Number(b === "word/document.xml") - Number(a === "word/document.xml") ||
        a.localeCompare(b),
    );
    const parts = [];
    for (const name of names.slice(0, 25)) {
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
      "Word text extracted from paragraphs, tables, headers, footers, footnotes and comments. Images and layout are not read.",
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
      "Text could not be extracted. Try an unlocked text PDF, DOCX, PPTX, or plain-text copy. Scanned PDFs need OCR first.",
  });
}
