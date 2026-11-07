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
    err(400, "Choose a readable DOCX or DOTX document.");
  }
  const entries = Object.values(zip.files);
  if (
    entries.length > 2000 ||
    entries.reduce((n, e) => n + (e._data?.uncompressedSize || 0), 0) >
      40 * 1024 * 1024
  )
    err(413, "Word package is too large to render.");
  if (!zip.file("word/document.xml")) err(400, "Choose a DOCX or DOTX document.");
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
  if (!layouts.some((l) => l.id === layout) && !["custom","previous"].includes(layout))
    err(400, "Choose a supported layout.");
  const base = await wordDraft(title, content);
  if (layout === "previous") {
    if(!templateBytes)err(400,"Choose a previous Word CV style.");
    const previous=await safeWord(templateBytes);
    const docXml = await previous.file("word/document.xml").async("string");
    if (docXml.includes("{{content}}")) {
      return layoutDraft(title, content, "custom", templateBytes);
    }
    if (docXml.includes("<w:tbl")) {
      const $ = load(docXml, { xml: true });
      const escape = (v) =>
        String(v || "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;");

      const getVisibleText = (el) =>
        $(el)
          .find("w\\:t")
          .map((_, t) => $(t).text())
          .get()
          .join("")
          .trim();

      const setParagraphText = (pEl, text) => {
        const p = $(pEl);
        const tEls = p.find("w\\:t");
        if (tEls.length === 0) {
          p.append(`<w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r>`);
        } else {
          $(tEls[0]).text(text);
          tEls.slice(1).remove();
        }
      };

      // Robust Markdown Parser for Candidate Evidence
      function parseCandidateCv(docTitle, markdown) {
        const lines = (markdown || "").replace(/\r\n?/g, "\n").split("\n");
        const res = {
          name: "",
          role: "",
          contact: "",
          summary: "",
          accomplishments: [],
          skills: [],
          experience: [],
          previousExperience: [],
          education: [],
        };

        let currentSection = { heading: "", kind: "header", lines: [] };
        const sections = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const hMatch = line.match(/^(#{1,2})\s+(.+)/);
          const plainHeadingMatch = !hMatch && line.match(/^(\*{2})?([A-Za-z\s&/]{3,40})(\*{2})?:?\s*$/);
          let heading = "";
          let isHeading = false;
          let lower = "";

          if (hMatch) {
            heading = hMatch[2].trim();
            lower = heading.toLowerCase();
            isHeading = true;
          } else if (plainHeadingMatch) {
            const candidateTitle = plainHeadingMatch[2].trim();
            const candLower = candidateTitle.toLowerCase();
            if (/^(?:(?:work|professional|previous|earlier|career|employment)\s+experience|experience|employment(?:\s+history)?|career(?:\s+history)?|education(?:\s+and\s+qualifications?)?|qualifications|skills?(?:\s+&\s+competencies)?|key\s+skills|technical\s+skills|competencies|professional\s+summary|summary|profile|about(?:\s+me)?|accomplishments|achievements|strengths)$/i.test(candLower)) {
              heading = candidateTitle;
              lower = candLower;
              isHeading = true;
            }
          }

          if (isHeading) {
            if (currentSection.lines.length || currentSection.heading) {
              sections.push(currentSection);
            }
            let kind = "general";
            if (/skill|competenc|technolog|proficienc|tool/i.test(lower)) kind = "skills";
            else if (/accomplish|highlight|achievement|strength/i.test(lower)) kind = "accomplishments";
            else if (/previous\s+(?:work\s+|professional\s+)?experience|earlier\s+experience/i.test(lower)) kind = "previousExperience";
            else if (/experienc|employ|work|career|histor/i.test(lower)) kind = "experience";
            else if (/educat|academ|degre|qualificat/i.test(lower)) kind = "education";
            else if (/summar|profile|about|overview|objective/i.test(lower)) kind = "summary";
            else if (/contact|address/i.test(lower)) kind = "contact";
            else if (sections.length === 0 && !res.name) kind = "name";

            currentSection = { heading, kind, lines: [] };
          } else {
            currentSection.lines.push(line);
          }
        }
        if (currentSection.lines.length || currentSection.heading) {
          sections.push(currentSection);
        }

        const firstSec = sections[0];
        if (firstSec && (firstSec.kind === "name" || firstSec.kind === "header")) {
          if (firstSec.kind === "name") {
            res.name = firstSec.heading;
          }
          const nonBlank = firstSec.lines.filter((l) => l.trim());
          if (!res.name && nonBlank.length > 0) {
            res.name = nonBlank[0].replace(/^#+\s*/, "").trim();
            nonBlank.shift();
          }
          for (const l of nonBlank) {
            const clean = l.trim();
            if (/@|[|]|\b\d{3}[- ]?\d{3}\b/i.test(clean)) {
              res.contact = clean;
            } else if (!res.role && clean.length < 80) {
              res.role = clean;
            }
          }
        }

        if (!res.name) {
          const titleMatch = (docTitle || "").match(/^(?:CV\s*-\s*)?([^-]+)/i);
          res.name = titleMatch ? titleMatch[1].trim() : "Candidate";
        }

        for (const sec of sections) {
          const textLines = sec.lines.filter((l) => l.trim());
          if (sec.kind === "summary") {
            res.summary = textLines.join(" ");
          } else if (sec.kind === "accomplishments") {
            res.accomplishments = textLines.map((l) =>
              l.replace(/^[-*•]\s*/, "").trim(),
            );
          } else if (sec.kind === "skills") {
            const allSkills = [];
            for (const l of textLines) {
              const clean = l.replace(/^[-*•]\s*/, "").trim();
              if (clean.includes(",")) {
                clean
                  .split(",")
                  .forEach((s) => s.trim() && allSkills.push(s.trim()));
              } else if (clean) {
                allSkills.push(clean);
              }
            }
            res.skills = allSkills;
          } else if (sec.kind === "experience") {
            let currentJob = null;
            for (const l of sec.lines) {
              const h3Match = l.match(/^#{3,4}\s+(.+)/);
              const boldMatch = l.match(/^\*\*([^*]+)\*\*(.*)/);
              const pipeMatch = !l.trim().startsWith("-") && l.includes("|") && !/@|[|].*@/.test(l);
              if (h3Match || (boldMatch && !l.trim().startsWith("-")) || pipeMatch) {
                if (currentJob) res.experience.push(currentJob);
                const rawTitle = h3Match
                  ? h3Match[1]
                  : (boldMatch ? boldMatch[1] + (boldMatch[2] || "") : l.trim());
                let jobTitle = rawTitle;
                let jobCompany = "";
                let jobDates = "";
                if (rawTitle.includes("|")) {
                  const parts = rawTitle.split("|").map((p) => p.trim());
                  jobTitle = parts[0];
                  jobCompany = parts[1] || "";
                  jobDates = parts[2] || "";
                } else if (rawTitle.includes("—") || rawTitle.includes(" - ")) {
                  const parts = rawTitle.split(/[—–-]/).map((p) => p.trim());
                  jobTitle = parts[0];
                  jobCompany = parts[1] || "";
                }
                currentJob = {
                  title: jobTitle,
                  company: jobCompany,
                  dates: jobDates,
                  bullets: [],
                };
              } else {
                const trimmed = l.trim();
                if (trimmed) {
                  if (!currentJob) {
                    currentJob = { title: "", company: "", dates: "", bullets: [] };
                  }
                  if (/^[-*•]\s*/.test(trimmed)) {
                    currentJob.bullets.push(trimmed.replace(/^[-*•]\s*/, ""));
                  } else if (
                    !currentJob.dates &&
                    /\b(19\d\d|20\d\d|present|current)\b/i.test(trimmed)
                  ) {
                    currentJob.dates = trimmed;
                  } else if (!currentJob.company && trimmed.length < 50 && !currentJob.bullets.length) {
                    currentJob.company = trimmed;
                  } else {
                    currentJob.bullets.push(trimmed);
                  }
                }
              }
            }
            if (currentJob) res.experience.push(currentJob);
          } else if (sec.kind === "previousExperience") {
            let currentJob = null;
            for (const l of sec.lines) {
              const h3Match = l.match(/^#{3,4}\s+(.+)/);
              const boldMatch = l.match(/^\*\*([^*]+)\*\*(.*)/);
              const pipeMatch = !l.trim().startsWith("-") && l.includes("|") && !/@|[|].*@/.test(l);
              if (h3Match || (boldMatch && !l.trim().startsWith("-")) || pipeMatch) {
                if (currentJob) res.previousExperience.push(currentJob);
                const rawTitle = h3Match
                  ? h3Match[1]
                  : (boldMatch ? boldMatch[1] + (boldMatch[2] || "") : l.trim());
                let jobTitle = rawTitle;
                let jobCompany = "";
                let jobDates = "";
                if (rawTitle.includes("|")) {
                  const parts = rawTitle.split("|").map((p) => p.trim());
                  jobTitle = parts[0];
                  jobCompany = parts[1] || "";
                  jobDates = parts[2] || "";
                } else if (rawTitle.includes("—") || rawTitle.includes(" - ")) {
                  const parts = rawTitle.split(/[—–-]/).map((p) => p.trim());
                  jobTitle = parts[0];
                  jobCompany = parts[1] || "";
                }
                currentJob = {
                  title: jobTitle,
                  company: jobCompany,
                  dates: jobDates,
                  bullets: [],
                };
              } else {
                const trimmed = l.trim();
                if (trimmed) {
                  if (!currentJob) {
                    currentJob = { title: "", company: "", dates: "", bullets: [] };
                  }
                  if (/^[-*•]\s*/.test(trimmed)) {
                    currentJob.bullets.push(trimmed.replace(/^[-*•]\s*/, ""));
                  } else if (
                    !currentJob.dates &&
                    /\b(19\d\d|20\d\d|present|current)\b/i.test(trimmed)
                  ) {
                    currentJob.dates = trimmed;
                  } else if (!currentJob.company && trimmed.length < 50 && !currentJob.bullets.length) {
                    currentJob.company = trimmed;
                  } else {
                    currentJob.bullets.push(trimmed);
                  }
                }
              }
            }
            if (currentJob) res.previousExperience.push(currentJob);
          } else if (sec.kind === "education") {
            for (const l of textLines) {
              const clean = l.replace(/^[-*•]\s*/, "").trim();
              let inst = clean;
              let deg = "";
              let dates = "";
              if (clean.includes(":")) {
                const parts = clean.split(":").map((p) => p.trim());
                inst = parts[0];
                deg = parts[1] || "";
              } else if (clean.includes("—") || clean.includes(" - ")) {
                const parts = clean.split(/[—–-]/).map((p) => p.trim());
                deg = parts[0];
                inst = parts[1] || "";
                dates = parts[2] || "";
              }
              res.education.push({
                institution: inst,
                degree: deg,
                dates,
                details: [],
              });
            }
          }
        }

        if (res.accomplishments.length === 0 && res.experience.length > 0) {
          res.experience.slice(0, 3).forEach((j) => {
            if (j.bullets[0]) res.accomplishments.push(j.bullets[0]);
          });
        }

        return res;
      }

      const candidate = parseCandidateCv(title, content);

      // 1. Detect candidate name paragraph (first prominent non-empty paragraph or placeholder)
      const allParagraphs = $("w\\:p").toArray();
      let nameP = null;
      for (const p of allParagraphs) {
        const txt = getVisibleText(p);
        if (
          /^(charlotte\s+execute|forename\s+surname|first\s+last|your\s+name|name\s+here)/i.test(
            txt,
          )
        ) {
          nameP = p;
          break;
        }
      }
      if (!nameP) {
        for (const p of allParagraphs) {
          const txt = getVisibleText(p);
          if (
            txt &&
            txt.length < 50 &&
            !/summary|experience|education|skills|profile|career|sidebar/i.test(
              txt,
            ) &&
            !/@|[|]|\b\d{3}[- ]?\d{3}\b/.test(txt)
          ) {
            nameP = p;
            break;
          }
        }
      }
      if (nameP && candidate.name) {
        const p = $(nameP);
        const nameParts = candidate.name.split(" ");
        const runs = p
          .find("w\\:r")
          .filter((_, r) => $(r).find("w\\:t").length > 0);
        if (runs.length >= 2 && nameParts.length >= 2) {
          $(runs[0]).find("w\\:t").first().text(nameParts[0] + " ");
          $(runs[0]).find("w\\:t").slice(1).remove();
          $(runs[1])
            .find("w\\:t")
            .first()
            .text(nameParts.slice(1).join(" "));
          $(runs[1]).find("w\\:t").slice(1).remove();
          runs.slice(2).find("w\\:t").remove();
        } else {
          setParagraphText(p, candidate.name);
        }
      }

      // 2. Scan and replace Role, Contact, and narrative Summary in header area
      for (const p of allParagraphs) {
        if (p === nameP) continue;
        const txt = getVisibleText(p);
        if (!txt) continue;
        if (/^(charlotte\s+execute|forename\s+surname)/i.test(txt)) {
          setParagraphText(p, candidate.name);
        } else if (/@|[|]|\b\d{3}[- ]?\d{3}\b/i.test(txt) && candidate.contact) {
          setParagraphText(p, candidate.contact);
        } else if (
          /^(forename surname\s*[|]|chief\s+|director\s+|manager\s+|engineer\s+|consultant\s+|specialist\s+|architect\s+|analyst\s+)/i.test(
            txt,
          ) &&
          txt.length < 60 &&
          candidate.role
        ) {
          setParagraphText(p, candidate.role);
        } else if (
          txt.length > 80 &&
          /seeks a position|experience across|proven track record|professional with/i.test(
            txt,
          ) &&
          candidate.summary
        ) {
          setParagraphText(p, candidate.summary);
        }
      }

      // 3. Handle Nested / Sidebar Tables (Accomplishments & Competencies)
      $("w\\:tbl").each((_, tbl) => {
        const rows = $(tbl).children("w\\:tr");
        if (rows.length <= 10) {
          rows.each((rIdx, tr) => {
            const rowTxt = getVisibleText(tr).trim().toLowerCase();
            if (/^(key\s+|notable\s+|selected\s+|core\s+)?(accomplishments?|highlights?|achievements?|strengths?):?\s*$/i.test(rowTxt)) {
              const nextRow = rows.eq(rIdx + 1);
              if (nextRow.length) {
                const tc = nextRow.find("w\\:tc").first();
                const sampleP = tc.find("w\\:p").first().clone();
                sampleP.find("w\\:t").first().text("");
                sampleP.find("w\\:t").slice(1).remove();
                tc.empty();
                const items = candidate.accomplishments.length
                  ? candidate.accomplishments
                  : [candidate.summary];
                items.forEach((item) => {
                  const p = sampleP.clone();
                  p.find("w\\:t").first().text(item);
                  tc.append(p);
                });
              }
            } else if (/^(key\s+|core\s+|technical\s+)?(competenc(ies|y)|skills?(\s+highlights?)?):?\s*$/i.test(rowTxt)) {
              const nextRow = rows.eq(rIdx + 1);
              if (nextRow.length) {
                const tc = nextRow.find("w\\:tc").first();
                const sampleP = tc.find("w\\:p").first().clone();
                sampleP.find("w\\:t").first().text("");
                sampleP.find("w\\:t").slice(1).remove();
                tc.empty();
                candidate.skills.forEach((skill) => {
                  const p = sampleP.clone();
                  p.find("w\\:t").first().text(skill);
                  tc.append(p);
                });
              }
            }
          });
        }
      });

      // 4. Handle Multi-Row Table Experience & Education Sections
      let handledMultiRowTable = false;
      $("w\\:tbl").each((_, tbl) => {
        const rows = $(tbl).children("w\\:tr");
        let workRowIdx = -1;
        let eduRowIdx = -1;
        rows.each((idx, tr) => {
          const cells = $(tr).children("w\\:tc").toArray();
          const cellTexts = cells.map((tc) => getVisibleText(tc).toLowerCase());
          if (
            cellTexts.some((txt) =>
              /^(work\s+experience|professional\s+experience|experience|career\s+summary)$/i.test(
                txt,
              ),
            )
          ) {
            workRowIdx = idx;
          } else if (
            cellTexts.some((txt) =>
              /^(education(\s+and\s+qualifications?)?|education)$/i.test(txt),
            )
          ) {
            eduRowIdx = idx;
          }
        });

        if (
          workRowIdx !== -1 &&
          eduRowIdx !== -1 &&
          eduRowIdx > workRowIdx + 1 &&
          candidate.experience.length
        ) {
          handledMultiRowTable = true;
          const expRow0Tpl = rows.eq(workRowIdx + 1).clone();
          const expRow1Tpl = rows.eq(workRowIdx + 2).clone();
          const expRow2Tpl = rows.eq(workRowIdx + 3).clone();

          for (let r = eduRowIdx - 1; r > workRowIdx; r--) {
            rows.eq(r).remove();
          }

          let insertAfterEl = $(tbl).children("w\\:tr").eq(workRowIdx);
          candidate.experience.forEach((exp) => {
            const r0 = expRow0Tpl.clone();
            r0.children("w\\:tc").eq(0).find("w\\:t").first().text(exp.dates);
            r0.children("w\\:tc").eq(0).find("w\\:t").slice(1).remove();
            r0.children("w\\:tc").eq(1).find("w\\:t").first().text(exp.company);
            r0.children("w\\:tc").eq(1).find("w\\:t").slice(1).remove();

            const r1 = expRow1Tpl.clone();
            r1.children("w\\:tc").eq(1).find("w\\:t").first().text(exp.title);
            r1.children("w\\:tc").eq(1).find("w\\:t").slice(1).remove();

            const r2 = expRow2Tpl.clone();
            const cell1 = r2.children("w\\:tc").eq(1);
            const sampleDutyP = cell1.find("w\\:p").first().clone();
            sampleDutyP.find("w\\:t").first().text("");
            sampleDutyP.find("w\\:t").slice(1).remove();
            cell1.empty();
            exp.bullets.forEach((b) => {
              const p = sampleDutyP.clone();
              p.find("w\\:t").first().text(b);
              cell1.append(p);
            });

            insertAfterEl.after(r2);
            insertAfterEl.after(r1);
            insertAfterEl.after(r0);
            insertAfterEl = r2;
          });

          // Re-find updated Education row
          $(tbl)
            .children("w\\:tr")
            .each((idx, tr) => {
              const cells = $(tr).children("w\\:tc").toArray();
              const cellTexts = cells.map((tc) => getVisibleText(tc).toLowerCase());
              if (
                cellTexts.some((txt) =>
                  /^(education(\s+and\s+qualifications?)?|education)$/i.test(txt),
                )
              ) {
                eduRowIdx = idx;
              }
            });

          if (eduRowIdx !== -1 && candidate.education.length) {
            const updatedRows = $(tbl).children("w\\:tr");
            const eduRow0Tpl = updatedRows.eq(eduRowIdx + 1).clone();
            const eduRow1Tpl = updatedRows.eq(eduRowIdx + 2).clone();
            const eduRow2Tpl = updatedRows.eq(eduRowIdx + 3).clone();

            const totalRows = updatedRows.length;
            for (let r = totalRows - 1; r > eduRowIdx; r--) {
              updatedRows.eq(r).remove();
            }

            insertAfterEl = $(tbl).children("w\\:tr").eq(eduRowIdx);
            candidate.education.forEach((ed) => {
              const r0 = eduRow0Tpl.clone();
              r0.children("w\\:tc").eq(0).find("w\\:t").first().text(ed.dates);
              r0.children("w\\:tc").eq(0).find("w\\:t").slice(1).remove();
              r0.children("w\\:tc").eq(1).find("w\\:t").first().text(ed.institution);
              r0.children("w\\:tc").eq(1).find("w\\:t").slice(1).remove();

              const r1 = eduRow1Tpl.clone();
              r1.children("w\\:tc").eq(1).find("w\\:t").first().text(ed.degree);
              r1.children("w\\:tc").eq(1).find("w\\:t").slice(1).remove();

              const r2 = eduRow2Tpl.clone();
              const cell1 = r2.children("w\\:tc").eq(1);
              const sampleP = cell1.find("w\\:p").first().clone();
              sampleP.find("w\\:t").first().text("");
              sampleP.find("w\\:t").slice(1).remove();
              cell1.empty();
              (ed.details || []).forEach((d) => {
                const p = sampleP.clone();
                p.find("w\\:t").first().text(d);
                cell1.append(p);
              });

              insertAfterEl.after(r2);
              insertAfterEl.after(r1);
              insertAfterEl.after(r0);
              insertAfterEl = r2;
            });
          }
        }
      });

      // 5. If not handled by multi-row table, handle In-Cell / Body Paragraph Sections
      if (!handledMultiRowTable) {
        const sectionsList = [];
        if (candidate.summary) sectionsList.push({ kind: "summary", lines: [candidate.summary] });
        if (candidate.skills.length) sectionsList.push({ kind: "skills", lines: candidate.skills.map(s => "• " + s) });
        if (candidate.experience.length) {
          const expLines = [];
          candidate.experience.forEach((j) => {
            if (j.title || j.company) {
              expLines.push(
                `**${j.title || j.company}**${
                  j.company && j.title ? ` | ${j.company}` : ""
                }${j.dates ? ` (${j.dates})` : ""}`,
              );
            }
            j.bullets.forEach((b) => expLines.push(`• ${b}`));
          });
          sectionsList.push({ kind: "experience", lines: expLines });
        }
        if (candidate.previousExperience && candidate.previousExperience.length) {
          const prevLines = [];
          candidate.previousExperience.forEach((j) => {
            if (j.title || j.company) {
              prevLines.push(
                `**${j.title || j.company}**${
                  j.company && j.title ? ` | ${j.company}` : ""
                }${j.dates ? ` (${j.dates})` : ""}`,
              );
            }
            j.bullets.forEach((b) => prevLines.push(b.startsWith("•") || b.startsWith("-") ? b : `• ${b}`));
          });
          sectionsList.push({ kind: "previousExperience", lines: prevLines });
        }
        if (candidate.education.length) {
          const eduLines = [];
          candidate.education.forEach((ed) => {
            eduLines.push(
              `• ${ed.degree} — ${ed.institution}${
                ed.dates ? ` (${ed.dates})` : ""
              }`,
            );
          });
          sectionsList.push({ kind: "education", lines: eduLines });
        }

        const headingEntries = [];
        $("w\\:p").each((idx, p) => {
          const text = getVisibleText(p);
          if (!text || text.length > 50) return;
          const lower = text.toLowerCase();
          let kind = null;
          if (
            /^(core\s+|technical\s+|it\/technical\s+|key\s+|professional\s+)?(skills?(\s+highlights?)?|competenc(ies|y)|proficienc(ies|y)|tools?)$/i.test(
              lower,
            )
          )
            kind = "skills";
          else if (
            /^(previous\s+|earlier\s+)(experienc(e|es)|histor(y|ies)|roles?)$/i.test(
              lower,
            )
          )
            kind = "previousExperience";
          else if (
            /^(work\s+|professional\s+|career\s+|employment\s+)?(experienc(e|es)|histor(y|ies)|career\s+summary|roles?)$/i.test(
              lower,
            )
          )
            kind = "experience";
          else if (
            /^(education(\s+and\s+qualifications?)?|qualifications?|academics?|degrees?)$/i.test(
              lower,
            )
          )
            kind = "education";
          else if (
            /^(professional\s+)?(summary|profile|about(\s+me)?|overview|objective)$/i.test(
              lower,
            )
          )
            kind = "summary";

          if (kind) {
            const inTbl = $(p).parents("w\\:tbl").length > 0;
            headingEntries.push({ p, kind, text, inTbl });
          }
        });

        const samplePPr = $(allParagraphs[0]).children("w\\:pPr").clone();
        samplePPr.find("w\\:sectPr,w\\:numPr").remove();
        const samplePPrXml = samplePPr.length ? $.xml(samplePPr[0]) : "";
        const sampleRPr = $(allParagraphs[0]).find("w\\:rPr").first();
        const sampleRPrXml = sampleRPr.length ? $.xml(sampleRPr[0]) : "";

        const matchedKinds = new Set();
        const preferredHeadings = [...headingEntries].sort(
          (a, b) => (b.inTbl ? 1 : 0) - (a.inTbl ? 1 : 0),
        );

        for (const hEntry of preferredHeadings) {
          const matching = sectionsList.find((s) => s.kind === hEntry.kind);

          const toRemove = [];
          let cur = $(hEntry.p).next();
          while (
            cur.length &&
            cur[0].name === "w:p" &&
            !headingEntries.some((he) => he.p === cur[0])
          ) {
            toRemove.push(cur);
            cur = cur.next();
          }

          if (matching && !matchedKinds.has(hEntry.kind)) {
            matchedKinds.add(hEntry.kind);
            const containerPPr = toRemove[0]?.children("w\\:pPr")?.first();
            const pPrXml = containerPPr?.length
              ? $.xml(containerPPr[0])
              : samplePPrXml;
            const containerRPr = toRemove[0]?.find("w\\:rPr")?.first();
            const rPrXml = containerRPr?.length
              ? $.xml(containerRPr[0])
              : sampleRPrXml;

            const replacementXml = matching.lines
              .map((line) => {
                const isHeading = /^#{1,3}\s+/.test(line);
                const isBullet = /^[-*•]\s+/.test(line);
                const clean = line
                  .replace(/^#{1,3}\s+/, "")
                  .replace(/^[-*•]\s+/, isBullet ? "• " : "")
                  .replace(/\*\*([^*]+)\*\*/g, "$1");
                const bold = isHeading ? "<w:b/>" : "";
                return (
                  "<w:p>" +
                  pPrXml +
                  "<w:r>" +
                  (bold
                    ? rPrXml
                      ? rPrXml.replace(/<w:b\/>/g, "") + bold
                      : "<w:rPr><w:b/></w:rPr>"
                    : rPrXml) +
                  '<w:t xml:space="preserve">' +
                  escape(clean) +
                  "</w:t></w:r></w:p>"
                );
              })
              .join("");

            toRemove.forEach((el) => el.remove());
            if (replacementXml) {
              $(hEntry.p).after(replacementXml);
            }
          } else {
            toRemove.forEach((el) => el.remove());
          }
        }
      }

      previous.file("word/document.xml", $.xml());
      return previous.generateAsync({ type: "nodebuffer" });
    }

    const generated=await JSZip.loadAsync(base);
    const original=load(docXml,{xml:true});
    const output=load(await generated.file("word/document.xml").async("string"),{xml:true});
    const styles=previous.file("word/styles.xml");
    if(styles)generated.file("word/styles.xml",await styles.async("string"));
    const theme=previous.file("word/theme/theme1.xml");
    if(theme)generated.file("word/theme/theme1.xml",await theme.async("string"));
    const paragraphs=original("w\\:p").toArray().filter(p=>original(p).find("w\\:t").text().trim());
    const role=(p,$)=>{
      const style=$(p).children("w\\:pPr").find("w\\:pStyle").attr("w:val")||"";
      return /title/i.test(style)?"title":/heading|section/i.test(style)?"heading":$(p).find("w\\:numPr").length?"bullet":"body";
    };
    const samples={title:paragraphs[0],heading:paragraphs.find(p=>role(p,original)==="heading"),bullet:paragraphs.find(p=>role(p,original)==="bullet"),body:paragraphs.find(p=>role(p,original)==="body"&&original(p).find("w\\:t").text().length>30)};
    output("w\\:body > w\\:p").each((_,p)=>{
      const kind=role(p,output), sample=samples[kind]||samples.body;
      if(!sample)return;
      const pPr=original(sample).children("w\\:pPr").clone();
      pPr.find("w\\:sectPr,w\\:numPr").remove();
      const number=output(p).children("w\\:pPr").find("w\\:numPr").toArray().map(n=>output.xml(n)).join("");
      if(pPr.length){output(p).children("w\\:pPr").remove();output(p).prepend(original.xml(pPr[0]));if(number)output(p).children("w\\:pPr").append(number);}
      const rPr=original(sample).find("w\\:rPr").first();
      if(rPr.length)output(p).find("w\\:r").each((_,r)=>{output(r).children("w\\:rPr").remove();output(r).prepend(original.xml(rPr[0]));});
    });
    for(const tag of ["pgSz","pgMar","cols"]){
      const settings=original("w\\:sectPr").last().children("w\\:"+tag).first();
      if(settings.length){output("w\\:sectPr").last().children("w\\:"+tag).remove();output("w\\:sectPr").last().append(original.xml(settings[0]));}
    }
    generated.file("word/document.xml",output.xml());
    return generated.generateAsync({type:"nodebuffer"});
  }
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
  const compact =
    layout === "compact" ||
    layout === "executive" ||
    layout === "it-technical" ||
    layout === "combination";
  xml = xml
    .replaceAll(
      "Calibri",
      layout === "executive"
        ? "Montserrat"
        : layout === "career-change"
        ? "Liberation Serif"
        : "Liberation Sans",
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
