import { Readable } from "node:stream";
import { load } from "cheerio";
import JSZip from "jszip";
import { buddyError } from "./buddy-provider.mjs";
import { importKeywordCsv, isSocTitleHeader } from "./cv-keywords.mjs";

const sources = {
  esco: "https://raw.githubusercontent.com/meaytac/cv-job-description-matcher/refs/heads/main/skills.csv",
  soc2020:
    "https://www.ons.gov.uk/file?uri=%2Fmethodology%2Fclassificationsandstandards%2Fstandardoccupationalclassificationsoc%2Fsoc2020%2Fsoc2020volume2codingrulesandconventions%2Fsoc2020volume2thecodingindexexcel20260827v3.xlsx",
};
const maxBytes = 15_000_000;

async function readBounded(stream) {
  let size = 0;
  const chunks = [];
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("The source file exceeds 15 MB.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function sheetXml(entry) {
  return load(
    (await readBounded(new Readable().wrap(entry.nodeStream()))).toString(
      "utf8",
    ),
    {
      xml: true,
    },
  );
}

export async function readSocWorkbook(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const shared = zip.file("xl/sharedStrings.xml");
  const strings = [];
  if (shared) {
    const xml = await sheetXml(shared);
    xml("si").each((_, element) => {
      strings.push(xml(element).find("t").text());
    });
  }

  for (const sheet of zip.file(/^xl\/worksheets\/sheet\d+\.xml$/)) {
    const xml = await sheetXml(sheet);
    let column;
    const labels = new Set();
    xml("row").each((_, row) => {
      xml(row)
        .children("c")
        .each((_, element) => {
          const cell = xml(element);
          const key = cell.attr("r")?.match(/^[A-Z]+/)?.[0];
          if (!key || (column && key !== column)) return;
          const raw = cell.children("v").text();
          const value = (
            cell.attr("t") === "s"
              ? strings[Number(raw)]
              : cell.attr("t") === "inlineStr"
                ? cell.find("t").text()
                : raw
          )?.trim();
          if (!column) {
            if (value && isSocTitleHeader(value)) column = key;
          } else if (value && value.length <= 160) {
            labels.add(value);
          }
        });
    });
    if (labels.size) return [...labels];
  }
  throw new Error("The workbook did not contain a recognised coding index.");
}

export async function downloadCvKeywords(source, fetcher = fetch) {
  const name = source === "esco" ? "ESCO" : "SOC 2020";
  try {
    const response = await fetcher(sources[source], {
      redirect: "error",
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok || !response.body)
      throw new Error("The publisher returned HTTP " + response.status + ".");
    const data = await readBounded(response.body);
    const labels =
      source === "esco"
        ? importKeywordCsv(source, data.toString("utf8"))
        : await readSocWorkbook(data);
    if (labels.length < 1_000)
      throw new Error("The downloaded index looks incomplete.");
    return labels;
  } catch (error) {
    throw buddyError(
      502,
      `Could not download ${name}. ${error.message} Try again or import the CSV manually.`,
    );
  }
}
