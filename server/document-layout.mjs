import JSZip from "jszip";
import { load } from "cheerio";
import { wordDraft } from "./buddy-documents.mjs";
const err = (s, m) => {
  throw Object.assign(new Error(m), { status: s });
};
export const layouts = [
  {
    id: "classic",
    name: "Classic",
    description: "Clear single-column CV with generous spacing.",
  },
  {
    id: "compact",
    name: "Compact",
    description: "Tighter spacing for a concise two-page CV.",
  },
  {
    id: "executive",
    name: "Executive",
    description: "Restrained Montserrat layout with compact section headings.",
  },
  {
    id: "letter",
    name: "Cover letter",
    description: "A4 letter with comfortable paragraph spacing.",
  },
];
export async function safeWord(bytes) {
  if (bytes.length > 15 * 1024 * 1024) err(413, "Word file exceeds 15 MB.");
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    err(400, "Choose a readable DOCX document.");
  }
  const entries = Object.values(zip.files);
  if (
    entries.length > 2000 ||
    entries.reduce((n, e) => n + (e._data?.uncompressedSize || 0), 0) >
      40 * 1024 * 1024
  )
    err(413, "Word package is too large to render.");
  if (!zip.file("word/document.xml")) err(400, "Choose a DOCX document.");
  for (const e of entries) {
    if (/vbaProject|embeddings\/|activeX\//i.test(e.name))
      err(
        400,
        "Remove embedded objects or macros before previewing this document.",
      );
    if (e.name.endsWith(".rels")) {
      const $ = load(await e.async("string"), { xml: true });
      if (
        $("*")
          .filter((_, e) => e.name?.split(":").at(-1) === "Relationship")
          .toArray()
          .some(
            (r) =>
              $(r).attr("TargetMode") === "External" &&
              !String($(r).attr("Type")).endsWith("/hyperlink"),
          )
      )
        err(
          400,
          "Remove externally linked media or templates before rendering.",
        );
    }
  }
  for (const e of entries.filter((e) => /^word\/.*\.xml$/.test(e.name))) {
    const $ = load(await e.async("string"), { xml: true });
    const fields =
      $("*")
        .toArray()
        .filter((n) => n.name?.split(":").at(-1) === "instrText")
        .map((n) => $(n).text())
        .join(" ") +
      $(" *")
        .toArray()
        .flatMap((n) =>
          Object.entries(n.attribs || {})
            .filter(([key]) => key.split(":").at(-1) === "instr")
            .map(([, v]) => v),
        )
        .join(" ");
    if (
      /DDE|INCLUDEPICTURE|INCLUDETEXT|DATABASE|MACROBUTTON|(?:^|\s)LINK\s/i.test(
        fields,
      )
    )
      err(400, "Remove active or externally linked fields before rendering.");
  }
  const xml = await zip.file("word/document.xml").async("string");
  if (/<w:altChunk\b/i.test(xml))
    err(400, "Embedded document imports are unsupported.");
  return zip;
}
export async function layoutDraft(
  title,
  content,
  layout = "classic",
  templateBytes,
) {
  if (!layouts.some((l) => l.id === layout) && layout !== "custom")
    err(400, "Choose a supported layout.");
  const base = await wordDraft(title, content);
  if (layout === "custom") {
    if (!templateBytes)
      err(400, "Select a Word template containing a {{content}} paragraph.");
    const template = await safeWord(templateBytes),
      generated = await JSZip.loadAsync(base);
    const xml = await template.file("word/document.xml").async("string");
    const $ = load(xml, { xml: true });
    let markers = 0;
    const escape = (v) =>
      v
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    $("w\\:p").each((_, p) => {
      if (
        $(p)
          .find("w\\:t")
          .toArray()
          .map((t) => $(t).text())
          .join("")
          .trim() === "{{content}}"
      ) {
        markers++;
        const properties = $(p).children("w\\:pPr").first();
        const pPr = properties.length ? $.xml(properties[0]) : "";
        const run = $(p).find("w\\:rPr").first();
        const rPr = run.length ? $.xml(run[0]) : "";
        const replacement = content
          .replace(/\r\n?/g, "\n")
          .split("\n")
          .map((line) => {
            const heading = /^#{1,3}\s+/.test(line);
            const text = line
              .replace(/^#{1,3}\s+/, "")
              .replace(/^[-*]\s+/, "• ")
              .replace(/\*\*([^*]+)\*\*/g, "$1");
            return (
              "<w:p>" +
              pPr +
              "<w:r>" +
              (heading ? "<w:rPr><w:b/></w:rPr>" : rPr) +
              '<w:t xml:space="preserve">' +
              escape(text) +
              "</w:t></w:r></w:p>"
            );
          })
          .join("");
        $(p).replaceWith(replacement);
      }
    });
    if (markers !== 1)
      err(
        400,
        "The template needs exactly one paragraph containing only {{content}}. Other template content stays unchanged.",
      );
    template.file("word/document.xml", $.xml());
    return template.generateAsync({ type: "nodebuffer" });
  }
  const z = await JSZip.loadAsync(base);
  let xml = await z.file("word/styles.xml").async("string");
  const compact = layout === "compact" || layout === "executive";
  xml = xml
    .replaceAll(
      "Calibri",
      layout === "executive" ? "Montserrat" : "Liberation Sans",
    )
    .replaceAll(
      'w:sz w:val="22"',
      compact ? 'w:sz w:val="21"' : 'w:sz w:val="22"',
    )
    .replaceAll('w:line="270"', compact ? 'w:line="245"' : 'w:line="280"');
  z.file("word/styles.xml", xml);
  xml = await z.file("word/document.xml").async("string");
  if (compact) xml = xml.replaceAll('w:after="90"', 'w:after="65"');
  if (layout === "letter")
    xml = xml.replaceAll('w:after="90"', 'w:after="160"');
  z.file("word/document.xml", xml);
  return z.generateAsync({ type: "nodebuffer" });
}
