import assert from "node:assert/strict";
import test from "node:test";
import {
  cvKeywordReferences,
  importKeywordCsv,
} from "../server/cv-keywords.mjs";

test("imports CSV keyword sources and returns only role-relevant references", () => {
  const esco = importKeywordCsv(
    "esco",
    '\uFEFFpreferredLabel,description\r\n"cloud architecture","supports ""public""\ncloud"\r\nJava,language\r\nC++,language',
  );
  const soc = importKeywordCsv(
    "soc2020",
    'SOC 2020 Coding Index\nIndex Entry,SOC 2020\n"Architect, cloud",2133\n"Engineer, civil",2121',
  );
  const sources = {
    "cvKeywords:esco": { labels: esco },
    "cvKeywords:soc2020": { labels: soc },
  };
  assert.deepEqual(
    cvKeywordReferences(
      (name) => sources[name],
      "Cloud Architect",
      "Cloud architecture, JavaScript and C++.",
    ),
    {
      escoSkills: ["cloud architecture", "C++"],
      soc2020Titles: ["Architect, cloud"],
    },
  );
  assert.deepEqual(
    cvKeywordReferences(() => null, "Cloud Architect", ""),
    {
      escoSkills: [],
      soc2020Titles: [],
    },
  );
  assert.throws(
    () => importKeywordCsv("esco", 'preferredLabel\n"unterminated'),
    /malformed CSV/,
  );
});

test("downloads and reads the ONS workbook without a manual CSV export", async () => {
  const { default: JSZip } = await import("jszip");
  const { downloadCvKeywords } =
    await import("../server/cv-keyword-download.mjs");
  const zip = new JSZip();
  zip.file("xl/sharedStrings.xml", "<sst><si><t>Index Entry</t></si></sst>");
  const rows = Array.from(
    { length: 1000 },
    (_, i) =>
      `<row><c r="B${i + 2}" t="inlineStr"><is><t>Fictional role ${i}</t></is></c></row>`,
  ).join("");
  zip.file(
    "xl/worksheets/sheet2.xml",
    `<worksheet><sheetData><row><c r="B1" t="s"><v>0</v></c></row>${rows}</sheetData></worksheet>`,
  );
  const workbook = await zip.generateAsync({ type: "nodebuffer" });
  const labels = await downloadCvKeywords("soc2020", async (url) => {
    assert.equal(new URL(url).hostname, "www.ons.gov.uk");
    return new Response(workbook);
  });
  assert.equal(labels.length, 1000);
  assert.equal(labels[0], "Fictional role 0");
  await assert.rejects(
    downloadCvKeywords(
      "esco",
      async () => new Response("preferredLabel\nIncomplete"),
    ),
    /incomplete/,
  );
});

test("suggests only terms present in the advert without a CV", async () => {
  const { suggestAdvertKeywords } = await import("../server/cv-keywords.mjs");
  const config = (key) =>
    key === "cvKeywords:esco"
      ? { labels: ["cloud architecture", "unrelated skill"] }
      : null;
  assert.deepEqual(
    suggestAdvertKeywords(
      config,
      "Work on cloud architecture with AWS, C++ and JavaScript in the UK.",
    ),
    ["cloud architecture", "JavaScript", "C++", "AWS"],
  );
  assert.deepEqual(
    suggestAdvertKeywords(
      () => null,
      "Experience with technical leadership and Spring Boot.",
    ),
    ["Spring Boot", "technical leadership"],
  );
  assert.deepEqual(suggestAdvertKeywords(config, ""), []);
});
