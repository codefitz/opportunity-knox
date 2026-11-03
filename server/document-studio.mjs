import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extractDocument } from "./buddy-documents.mjs";
import { layouts, layoutDraft, safeWord } from "./document-layout.mjs";
import { readCVTemplate, populateCVTemplate, deriveTemplate } from "./cv-template.mjs";
import { callProvider } from "./buddy-provider.mjs";

const run = promisify(execFile),
  fail = (s, m) => {
    throw Object.assign(new Error(m), { status: s });
  };

const cleanText = (value, name, max = 10000) => {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    fail(400, `${name} must be text up to ${max} characters.`);
  return value.trim();
};
export async function convertWord(bytes, folder, { thumbnail = false } = {}) {
  await safeWord(bytes);
  writeFileSync(join(folder, "document.docx"), bytes, { mode: 0o600 });
  const profile = join(folder, "profile");
  mkdirSync(join(profile, "user"), { recursive: true });
  writeFileSync(
    join(profile, "user/registrymodifications.xcu"),
    '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Common/Load"><prop oor:name="UpdateDocMode" oor:op="fuse"><value>0</value></prop></item></oor:items>',
  );
  try {
    await run(
      process.env.BOARD_SOFFICE || "soffice",
      [
        "-env:UserInstallation=" + pathToFileURL(profile).href,
        "--headless",
        "--nologo",
        "--nodefault",
        "--norestore",
        "--convert-to",
        "pdf:writer_pdf_Export",
        "--outdir",
        folder,
        join(folder, "document.docx"),
      ],
      {
        timeout: 60000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          HOME: folder,
          TMPDIR: folder,
          SAL_USE_VCLPLUGIN: "svp",
        },
      },
    );
  } catch (e) {
    fail(
      e.code === "ENOENT" ? 503 : 502,
      e.code === "ENOENT"
        ? "PDF rendering requires the bundled Docker build."
        : "PDF conversion failed or exceeded 60 seconds. Original documents are unchanged.",
    );
  }
  const pdf = join(folder, "document.pdf");
  if (!existsSync(pdf)) fail(502, "PDF renderer produced no file.");
  if (statSync(pdf).size > 20 * 1024 * 1024)
    fail(413, "Rendered PDF exceeds the 20 MB preview limit.");
  const info = await run("pdfinfo", [pdf], {
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  const pages = Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
  if (!pages || pages > 30)
    fail(413, "Preview supports up to 30 pages. Shorten the draft first.");
  await run(
    "pdftoppm",
    thumbnail ? ["-f","1","-l","1","-singlefile","-scale-to","400","-png",pdf,join(folder,"thumbnail")] : ["-scale-to", "1100", "-png", pdf, join(folder, "page")],
    { timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  return { pages, pdf: readFileSync(pdf), ...(thumbnail?{thumbnailPath:join(folder,"thumbnail.png")}:{}) };
}
export async function renderPDFThumbnail(bytes,folder){
  if(bytes.length>20*1024*1024)fail(413,"PDF preview exceeds 20 MB.");
  if(!bytes.subarray(0,1024).includes(Buffer.from("%PDF-")))fail(400,"Choose a readable PDF.");
  const pdf=join(folder,"document.pdf"),thumbnailPath=join(folder,"thumbnail.png");
  writeFileSync(pdf,bytes,{mode:0o600});
  try{await run("pdftoppm",["-f","1","-l","1","-singlefile","-scale-to","400","-png",pdf,join(folder,"thumbnail")],{timeout:30000,maxBuffer:1024*1024});}
  catch{fail(502,"Could not render this PDF preview. The file is unchanged.");}
  return {thumbnailPath};
}
export async function renderPDFPages(bytes, folder) {
  if (bytes.length > 20 * 1024 * 1024) fail(413, "PDF preview exceeds 20 MB.");
  if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) fail(400, "Choose a readable PDF.");
  const pdf = join(folder, "document.pdf");
  writeFileSync(pdf, bytes, { mode: 0o600 });
  const info = await run("pdfinfo", [pdf], {
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  const pages = Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
  if (!pages || pages > 30)
    fail(413, "Preview supports up to 30 pages. Shorten the draft first.");
  await run("pdftoppm", ["-scale-to", "1100", "-png", pdf, join(folder, "page")], {
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  return { pages, pdf: bytes };
}
export function createDocumentStudio({
  getDocuments,
  documentPath,
  saveDocument,
  convert = convertWord,
  pdfThumbnail = renderPDFThumbnail,
  pdfPages = renderPDFPages,
  googleDocuments,
  obsidian,
  getConfig,
  putConfig,
  getRecord,
  listRecords,
  buddyFetch,
}) {
  const previews = new Map(), thumbnails=new Map(), pendingThumbnails=new Map();
  let thumbnailQueue=Promise.resolve();
  const cleanDocName = name => (String(name || "").split(/[/\\]/).pop() || name);
  const getObsidian = () => (typeof obsidian === "function" ? obsidian() : obsidian);
  const isCV=d=>/\.(docx|pdf|gdoc)$/i.test(d.name)&&!["template","cv-template","cover-letter-template"].includes(d.category)&&(d.kind==="cv"||["master-cv","tailored-cv","cv"].includes(d.category)||/\b(cv|resume|résumé)\b/i.test(d.name));
  const isTemplate=d=>/\.(docx|pdf|gdoc)$/i.test(d.name)&&(["template","cv-template","cover-letter-template"].includes(d.category)||/\btemplate\b/i.test(d.name));
  let busy = false;
  const activeChatRequests = new Map();
  function clean() {
    for (const [id, p] of previews)
      if (p.expiresAt < Date.now()) {
        rmSync(p.folder, { recursive: true, force: true });
        previews.delete(id);
      }
  }
  function find(id) {
    const d = getDocuments().find((d) => d.id === id);
    if (!d) fail(404, "Document is no longer available.");
    return d;
  }
  const timer = setInterval(clean, 60000);
  timer.unref();
  function invalidate(documentIds = null) {
    for(const id of thumbnails.keys())if(!documentIds||documentIds.includes(id))thumbnails.delete(id);
    for (const [id,preview] of previews) if (!documentIds || documentIds.includes(preview.sourceId)) {
      rmSync(preview.folder,{recursive:true,force:true});previews.delete(id);
    }
  }
  return {
    invalidate,
    close() {
      clearInterval(timer);thumbnails.clear();
      for (const c of activeChatRequests.values()) {
        try { c.abort(); } catch {}
      }
      activeChatRequests.clear();
      for (const p of previews.values())
        rmSync(p.folder, { recursive: true, force: true });
      previews.clear();
    },
    async handle(path, method, req, res, { json, readBody }) {
      clean();
      if (path === "/api/document-studio/defaults" && method === "GET") {
        const stored = getConfig ? (getConfig("documentStudioDefaults") || {}) : {};
        const docs = getDocuments();
        json(res, {
          masterCvId: docs.some(d => d.id === stored.masterCvId) ? stored.masterCvId : "",
          cvTemplateId: docs.some(d => d.id === stored.cvTemplateId) ? stored.cvTemplateId : "",
          coverLetterTemplateId: docs.some(d => d.id === stored.coverLetterTemplateId) ? stored.coverLetterTemplateId : "",
        });
        return true;
      }
      if (path === "/api/document-studio/defaults" && (method === "PATCH" || method === "POST")) {
        const b = await readBody(req);
        const docs = getDocuments();
        const current = getConfig ? { ...(getConfig("documentStudioDefaults") || {}) } : {};
        if (b.masterCvId !== undefined) {
          if (b.masterCvId && !docs.some(d => d.id === b.masterCvId)) fail(404, "Master CV not found.");
          current.masterCvId = b.masterCvId || "";
        }
        if (b.cvTemplateId !== undefined) {
          if (b.cvTemplateId && !docs.some(d => d.id === b.cvTemplateId)) fail(404, "CV template not found.");
          current.cvTemplateId = b.cvTemplateId || "";
        }
        if (b.coverLetterTemplateId !== undefined) {
          if (b.coverLetterTemplateId && !docs.some(d => d.id === b.coverLetterTemplateId)) fail(404, "Cover letter template not found.");
          current.coverLetterTemplateId = b.coverLetterTemplateId || "";
        }
        if (putConfig) putConfig("documentStudioDefaults", current);
        json(res, current);
        return true;
      }
      if (path === "/api/document-studio/generate" && method === "POST") {
        const b = await readBody(req);
        const kind = b.kind === "cover" ? "cover" : "cv";
        const docs = getDocuments();
        const studioDefaults = getConfig ? (getConfig("documentStudioDefaults") || {}) : {};

        // 1. Resolve source CV
        let sourceDoc = null;
        if (b.sourceCvId) {
          sourceDoc = find(b.sourceCvId);
        } else if (studioDefaults.masterCvId) {
          sourceDoc = docs.find((d) => d.id === studioDefaults.masterCvId) || null;
        }
        if (!sourceDoc && kind === "cv") {
          sourceDoc =
            docs.find((d) => d.category === "master-cv") ||
            docs.find((d) => d.kind === "cv") ||
            null;
        }

        // 2. Extract source text
        let sourceText = "";
        if (sourceDoc) {
          const rawSource = readFileSync(documentPath(sourceDoc));
          sourceText =
            sourceDoc.generation?.content ||
            (await extractDocument(sourceDoc.name, rawSource)).text ||
            "";
        }
        if (!sourceText.trim() && kind === "cv") {
          fail(400, "Select a readable source CV or career evidence first.");
        }

        // 3. Resolve target opportunity or brief
        let opportunity = null;
        let targetRole = b.role ? cleanText(b.role, "Role", 200) : "";
        let targetCompany = b.company ? cleanText(b.company, "Company", 200) : "";
        let targetBrief = b.brief ? cleanText(b.brief, "Brief", 50000) : "";

        if (b.opportunityId) {
          if (!getRecord) fail(500, "Opportunity lookup not available.");
          opportunity = getRecord(b.opportunityId);
          if (!opportunity) fail(404, "Opportunity not found.");
          targetRole = opportunity.role || targetRole;
          targetCompany = opportunity.company || targetCompany;
          targetBrief = opportunity.description || targetBrief;
        }

        // 4. Resolve template / layout
        let templateDoc = null;
        let templateBytes = null;
        if (b.templateId) {
          templateDoc = find(b.templateId);
        } else if (kind === "cv" && studioDefaults.cvTemplateId) {
          templateDoc = docs.find((d) => d.id === studioDefaults.cvTemplateId) || null;
        } else if (kind === "cover" && studioDefaults.coverLetterTemplateId) {
          templateDoc = docs.find((d) => d.id === studioDefaults.coverLetterTemplateId) || null;
        }

        if (templateDoc) {
          templateBytes = readFileSync(documentPath(templateDoc));
          await safeWord(templateBytes);
        }

        const requestedLayout = b.layout || (kind === "cover" ? "letter" : "classic");
        const layout = layouts.some((l) => l.id === requestedLayout)
          ? requestedLayout
          : (kind === "cover" ? "letter" : "classic");

        // 5. Title & Filename
        let title = b.title ? cleanText(b.title, "Title", 200) : "";
        if (!title) {
          if (kind === "cv") {
            title = targetCompany && targetRole
              ? `CV - ${targetCompany} - ${targetRole}`
              : (targetRole ? `CV - ${targetRole}` : (targetCompany ? `CV - ${targetCompany}` : "Tailored CV"));
          } else {
            title = targetCompany && targetRole
              ? `Cover letter - ${targetCompany} - ${targetRole}`
              : (targetRole ? `Cover letter - ${targetRole}` : (targetCompany ? `Cover letter - ${targetCompany}` : "Cover letter"));
          }
        }

        let filename = b.name ? cleanText(b.name, "Filename", 250) : "";
        if (!filename) {
          filename =
            (title.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 200) || (kind === "cv" ? "Tailored CV" : "Cover Letter")) +
            ".docx";
        }
        if (!filename.toLowerCase().endsWith(".docx")) filename += ".docx";

        // 6. Content generation
        const buddyConfig = getConfig ? (getConfig("buddy") || {}) : {};
        const hasAi = Boolean(
          buddyConfig.enabled &&
          buddyConfig.model &&
          (buddyConfig.provider === "codex" || buddyConfig.baseUrl)
        );
        const useAi = (b.passToAi !== false) && hasAi;

        let draftContent = "";
        let aiNotes = "";

        if (useAi) {
          const draftSchema = {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              content: { type: "string" },
              notes: { type: "string" },
            },
            required: ["title", "content"],
          };
          const system = kind === "cv"
            ? "You are an expert career advisor and document author. Tailor a complete, factual, professional CV for the target role using the candidate's verified source CV. Preserve complete factual identity, employers, chronology, dates and qualifications. Never invent factual claims or employers. Do not silently truncate employment history. Highlight relevant achievements matching the target role. Format output as clear Markdown with headers (## Summary, ## Skills, ## Experience, ## Education). In ## Experience, format each job with job title, company and dates, followed by bulleted achievements."
            : `You are an expert career advisor and document author. Draft a concise, compelling cover letter for the target role and employer using verified evidence from the candidate source CV. Never invent factual claims or qualifications. Format in clean Markdown paragraphs suitable for a professional letter.`;

          const promptPayload = {
            kind,
            targetRole,
            targetCompany,
            brief: targetBrief || undefined,
            instructions: b.instructions ? cleanText(b.instructions, "Instructions", 5000) : undefined,
            sourceCVText: sourceText.slice(0, 60000),
          };

          try {
            const raw = await callProvider(
              { ...buddyConfig, outputSchema: draftSchema },
              system,
              [{ role: "user", content: JSON.stringify(promptPayload) }],
              buddyFetch
            );
            let parsed = null;
            try { parsed = JSON.parse(raw); } catch {}
            draftContent = parsed?.content || raw;
            aiNotes = parsed?.notes || `Generated tailored draft with ${buddyConfig.providerName || buddyConfig.provider} (${buddyConfig.model}).`;
          } catch (e) {
            draftContent = sourceText;
            aiNotes = `AI tailoring unavailable (${e instanceof Error ? e.message : "provider error"}); generated using verified source CV.`;
          }
        } else {
          if (kind === "cv") {
            draftContent = sourceText;
            aiNotes = "Direct document generation without AI tailoring. Factual career history preserved in full.";
          } else {
            draftContent = `# Candidate\n\nDear Hiring Team${targetCompany ? " at " + targetCompany : ""},\n\nI am writing to express my enthusiastic interest in the ${targetRole || "position"}${targetCompany ? " at " + targetCompany : ""}. With my background and proven achievements, I am confident in my ability to deliver substantial value to your team.\n\nThank you for your consideration. I look forward to discussing how my experience aligns with your goals.\n\nSincerely,\nCandidate`;
            aiNotes = "Standard cover letter generated directly without AI.";
          }
        }

        // 7. Produce Word package (.docx)
        let docxBuffer;
        if (templateDoc && templateBytes) {
          let hasSlots = false;
          try {
            const { slots } = await readCVTemplate(templateBytes);
            hasSlots = slots.length > 0;
          } catch {}

          if (hasSlots && useAi) {
            docxBuffer = await populateCVTemplate(templateBytes, draftContent, (outputSchema, systemPrompt, payload) => {
              return callProvider(
                { ...buddyConfig, outputSchema },
                systemPrompt,
                [{ role: "user", content: JSON.stringify(payload) }],
                buddyFetch
              );
            });
          } else {
            docxBuffer = await layoutDraft(title, draftContent, "previous", templateBytes);
          }
        } else {
          docxBuffer = await layoutDraft(title, draftContent, kind === "cover" ? "letter" : layout);
        }

        await safeWord(docxBuffer);

        // 8. Save document
        const savedDoc = saveDocument({
          name: filename,
          kind: kind === "cv" ? "cv" : "cover",
          category: kind === "cv" ? "tailored-cv" : "cover-letter",
          status: "draft",
          opportunityId: opportunity ? opportunity.id : "",
          content: docxBuffer,
          notes: useAi
            ? `Generated in Document Studio with ${buddyConfig.providerName || buddyConfig.provider || "AI"}. Review factual accuracy and layout before approval.`
            : "Generated in Document Studio from template without AI. Review before approval.",
          generation: {
            title,
            content: draftContent,
            layout: templateDoc ? "custom" : layout,
            sourceCvId: sourceDoc?.id || "",
            sourceCvName: sourceDoc?.name || "",
            ...(templateDoc
              ? {
                  styleDocumentId: templateDoc.id,
                  styleDocumentRevision: templateDoc.revision,
                  styleDocumentName: templateDoc.name,
                }
              : {}),
            provider: useAi ? (buddyConfig.provider || "") : "",
            model: useAi ? (buddyConfig.model || "") : "",
            aiNotes,
          },
        });

        // 9. Prepare preview for immediate inspection
        let previewResult = null;
        let previewFolder = null;
        try {
          previewFolder = mkdtempSync(join(tmpdir(), "knox-document-"));
          const rendered = await convert(docxBuffer, previewFolder);
          const previewId = randomUUID();
          previews.set(previewId, {
            folder: previewFolder,
            bytes: docxBuffer,
            pdf: rendered.pdf,
            pages: rendered.pages,
            pageTarget: rendered.pages,
            sourceId: savedDoc.id,
            sourceRevision: savedDoc.revision,
            kind: savedDoc.kind,
            name: savedDoc.name,
            opportunityId: savedDoc.opportunityId,
            layout: templateDoc ? "custom" : layout,
            expiresAt: Date.now() + 30 * 60000,
          });
          previewResult = {
            id: previewId,
            pages: rendered.pages,
            pageTarget: rendered.pages,
            overTarget: false,
            pdfUrl: "/api/document-studio/" + previewId + "/pdf",
            wordUrl: "/api/document-studio/" + previewId + "/word",
            images: Array.from(
              { length: rendered.pages },
              (_, i) => "/api/document-studio/" + previewId + "/page/" + (i + 1)
            ),
          };
        } catch {
          if (previewFolder) rmSync(previewFolder, { recursive: true, force: true });
        }

        json(res, {
          document: savedDoc,
          preview: previewResult,
          aiNotes,
        }, 201);
        return true;
      }
      if (path === "/api/document-studio/create-template" && method === "POST") {
        const b = await readBody(req);
        if (!b.sourceDocumentId) fail(400, "sourceDocumentId is required.");
        const sourceDoc = find(b.sourceDocumentId);
        const sourceBytes = readFileSync(documentPath(sourceDoc));
        const isCover = b.kind === "cover" || sourceDoc.kind === "cover" || /cover/i.test(sourceDoc.category || "") || /cover/i.test(sourceDoc.name);
        const targetKind = isCover ? "cover" : "cv";
        const targetCategory = b.category || (isCover ? "cover-letter-template" : "cv-template");

        let templateBytes;
        const isDocx = /\.docx$/i.test(sourceDoc.name);
        if (isDocx) {
          templateBytes = await deriveTemplate(sourceBytes, { isCoverLetter: isCover });
        } else {
          const sanitizedMarkdown = isCover
            ? "# [Candidate Full Name]\n[Email Address] | [Phone Number] | [City, Country]\n\nDear Hiring Team,\n\n[Detailed letter paragraph outlining your interest, key relevant qualifications, and specific value for the target role.]\n\n[Supporting paragraph detailing a standout project or quantifiable career achievement.]\n\nYours sincerely,\n[Candidate Full Name]"
            : "# [Candidate Full Name]\n[Professional Title / Target Role]\n[Email Address] | [+44 7000 000000] | [City, Country] | [LinkedIn]\n\n## Professional Summary\n[Professional summary highlighting your core expertise, career achievements, and value proposition.]\n\n## Core Skills\n- [Skill 1, Skill 2, Skill 3, Skill 4, Skill 5]\n\n## Work Experience\n### [Job Title] | [Company Name]\n[Month Year – Present]\n- [Key accomplishment or responsibility delivering measurable business outcome.]\n\n## Education\n- [Degree Title] — [Institution / University Name] ([Year])";
          templateBytes = await layoutDraft(sourceDoc.name.replace(/\.[^.]+$/, "") + " Template", sanitizedMarkdown, isCover ? "letter" : "classic");
        }

        await safeWord(templateBytes);

        let templateName = b.name ? cleanText(b.name, "Template name", 250) : "";
        if (!templateName) {
          templateName = sourceDoc.name.replace(/\.[^.]+$/, "") + " (Template).docx";
        }
        if (!templateName.toLowerCase().endsWith(".docx")) templateName += ".docx";

        const savedDoc = saveDocument({
          name: templateName,
          kind: targetKind,
          category: targetCategory,
          status: "draft",
          content: templateBytes,
          notes: `Reusable template derived from ${sourceDoc.name}. Private evidence replaced with neutral placeholders.`,
          generation: {
            source: "document-studio-template-creator",
            sourceDocumentId: sourceDoc.id,
            sourceDocumentName: sourceDoc.name,
            kind: targetKind,
            category: targetCategory,
          },
        });

        let previewResult = null;
        let previewFolder;
        try {
          previewFolder = mkdtempSync(join(tmpdir(), "knox-template-prev-"));
          const rendered = await convert(templateBytes, previewFolder);
          const previewId = randomUUID();
          previews.set(previewId, {
            folder: previewFolder,
            bytes: templateBytes,
            pdf: rendered.pdf,
            pages: rendered.pages,
            pageTarget: rendered.pages,
            sourceId: savedDoc.id,
            sourceRevision: savedDoc.revision,
            kind: savedDoc.kind,
            name: savedDoc.name,
            expiresAt: Date.now() + 30 * 60000,
          });
          previewResult = {
            id: previewId,
            pages: rendered.pages,
            pageTarget: rendered.pages,
            pdfUrl: "/api/document-studio/" + previewId + "/pdf",
            wordUrl: "/api/document-studio/" + previewId + "/word",
            images: Array.from({ length: rendered.pages }, (_, i) => "/api/document-studio/" + previewId + "/page/" + (i + 1)),
          };
        } catch {
          if (previewFolder) rmSync(previewFolder, { recursive: true, force: true });
        }

        json(res, {
          document: savedDoc,
          preview: previewResult,
        }, 201);
        return true;
      }
      if (path === "/api/document-studio/chat" && method === "POST") {
        const b = await readBody(req);
        if (!b.message || typeof b.message !== "string") fail(400, "message is required.");
        const prompt = cleanText(b.message, "Message", 5000);
        const doc = b.documentId ? find(b.documentId) : null;

        const requestId = b.requestId || randomUUID();
        const controller = new AbortController();
        activeChatRequests.set(requestId, controller);

        const buddyConfig = getConfig ? (getConfig("buddy") || {}) : {};
        const hasAi = Boolean(
          buddyConfig.enabled &&
          buddyConfig.model &&
          (buddyConfig.provider === "codex" || buddyConfig.baseUrl)
        );

        try {
          // Check for template creation intent
          if (doc && /(?:create|turn|make|derive|convert|save).*?\btemplate\b/i.test(prompt)) {
            const isCover = doc.kind === "cover" || /cover/i.test(doc.category || "") || /cover/i.test(prompt);
            const targetKind = isCover ? "cover" : "cv";
            const targetCategory = isCover ? "cover-letter-template" : "cv-template";
            const sourceBytes = readFileSync(documentPath(doc));
            const templateBytes = /\.docx$/i.test(doc.name)
              ? await deriveTemplate(sourceBytes, { isCoverLetter: isCover })
              : await layoutDraft(doc.name + " Template", "# [Candidate Full Name]\n\n## Summary\n[Summary placeholder]", isCover ? "letter" : "classic");

            const templateName = doc.name.replace(/\.[^.]+$/, "") + " (Template).docx";
            const savedTemplate = saveDocument({
              name: templateName,
              kind: targetKind,
              category: targetCategory,
              status: "draft",
              content: templateBytes,
              notes: `Template created from ${doc.name} via Studio Assistant.`,
              generation: {
                source: "document-studio-chat",
                sourceDocumentId: doc.id,
                action: "create-template",
              },
            });

            json(res, {
              reply: `I have derived a reusable ${isCover ? "cover letter" : "CV"} template from "${doc.name}" with neutral placeholders and saved it as "${savedTemplate.name}".`,
              createdDocument: savedTemplate,
              action: "created_template",
              requestId,
            });
            return true;
          }

          // Check for layout / design tweak intent
          if (doc && !/\btemplate\b/i.test(prompt) && (/\b(?:compact|executive|tighter|looser)\b|\b(?:switch\s+to|change\s+to|use\s+layout|make\s+it)\s+(?:classic|letter)\b/i.test(prompt))) {
            const currentSource = readFileSync(documentPath(doc));
            const extracted = doc.generation?.content || (await extractDocument(doc.name, currentSource)).text || "";
            let chosenLayout = "classic";
            if (/compact|tighter/i.test(prompt)) chosenLayout = "compact";
            else if (/executive/i.test(prompt)) chosenLayout = "executive";
            else if (/letter/i.test(prompt)) chosenLayout = "letter";

            const revisedBytes = await layoutDraft(doc.name.replace(/\.[^.]+$/, ""), extracted, chosenLayout);
            const revisedName = doc.name.replace(/\.[^.]+$/, "") + ` (${chosenLayout}).docx`;
            const revisedDoc = saveDocument({
              name: revisedName,
              kind: doc.kind,
              category: doc.category,
              status: "draft",
              opportunityId: doc.opportunityId,
              content: revisedBytes,
              notes: `Layout adjusted to ${chosenLayout} via Studio Assistant.`,
              generation: {
                source: "document-studio-chat",
                parentDocumentId: doc.id,
                layout: chosenLayout,
                instructions: prompt,
              },
            });

            json(res, {
              reply: `I have updated the document formatting to the "${chosenLayout}" layout with adjusted spacing and saved it as "${revisedDoc.name}".`,
              revisedDocument: revisedDoc,
              action: "revised_document",
              requestId,
            });
            return true;
          }

          // Check for content revision intent
          if (doc && hasAi && /(?:shorten|tighten|summarize|highlight|rephrase|rewrite|polish|expand|tailor)/i.test(prompt)) {
            const currentSource = readFileSync(documentPath(doc));
            const currentText = doc.generation?.content || (await extractDocument(doc.name, currentSource)).text || "";

            const reviseSchema = {
              type: "object",
              additionalProperties: false,
              properties: {
                revisedMarkdown: { type: "string" },
                explanation: { type: "string" },
              },
              required: ["revisedMarkdown", "explanation"],
            };

            const systemPrompt = "You are an expert career advisor and document author. Revise the supplied document text according to the user's specific instruction. Preserve complete verified identity, employers, chronology, dates and qualifications. Never invent factual claims or employers. Keep the output formatted in clean professional Markdown.";

            const raw = await callProvider(
              { ...buddyConfig, outputSchema: reviseSchema, signal: controller.signal },
              systemPrompt,
              [{ role: "user", content: JSON.stringify({ instruction: prompt, documentText: currentText.slice(0, 50000) }) }],
              buddyFetch
            );

            let parsed = null;
            try { parsed = JSON.parse(raw); } catch {}
            const revisedMarkdown = parsed?.revisedMarkdown || currentText;
            const explanation = parsed?.explanation || "Document revised according to your request.";

            const revisedBytes = await layoutDraft(doc.name.replace(/\.[^.]+$/, ""), revisedMarkdown, doc.generation?.layout || "classic");
            const revisedName = doc.name.replace(/\.[^.]+$/, "") + " (Revised).docx";
            const revisedDoc = saveDocument({
              name: revisedName,
              kind: doc.kind,
              category: doc.category,
              status: "draft",
              opportunityId: doc.opportunityId,
              content: revisedBytes,
              notes: `Content revised via Studio Assistant: ${prompt}`,
              generation: {
                source: "document-studio-chat",
                parentDocumentId: doc.id,
                instructions: prompt,
                content: revisedMarkdown,
                aiNotes: explanation,
              },
            });

            json(res, {
              reply: explanation,
              revisedDocument: revisedDoc,
              action: "revised_document",
              requestId,
            });
            return true;
          }

          // General Q&A / assistance
          if (hasAi) {
            const docContext = doc
              ? `Current document: "${doc.name}" (${doc.kind}, category: ${doc.category || "unassigned"}).\nContent excerpt:\n${(doc.generation?.content || (await extractDocument(doc.name, readFileSync(documentPath(doc)))).text || "").slice(0, 15000)}`
              : "No document currently selected.";

            const system = "You are the Opportunity Knox Document Studio Assistant. You help users organize master CVs, derive reusable templates, refine content, and tailor application documents. Always provide factual, concise, and helpful advice. Never invent career evidence.";

            const rawReply = await callProvider(
              { ...buddyConfig, signal: controller.signal },
              system,
              [
                { role: "system", content: docContext },
                ...(b.history || []),
                { role: "user", content: prompt }
              ],
              buddyFetch
            );

            json(res, {
              reply: rawReply,
              action: "chat_reply",
              requestId,
            });
            return true;
          }

          // AI offline fallback
          json(res, {
            reply: doc
              ? `I am ready to help with "${doc.name}". Career Buddy AI is currently offline or unconfigured. You can configure an AI provider in Settings → Career Buddy for full content rewriting, or ask me to "turn this into a template" or "switch to compact layout" to adjust formatting directly.`
              : "Career Buddy AI is currently offline or unconfigured. You can configure an AI provider in Settings → Career Buddy, or use Document Studio's built-in generation and template features.",
            action: "info",
            canRetry: false,
            requestId,
          });
          return true;
        } catch (err) {
          if (controller.signal.aborted) {
            json(res, {
              reply: "Request was cancelled.",
              cancelled: true,
              canRetry: true,
              requestId,
            });
            return true;
          }
          throw err;
        } finally {
          activeChatRequests.delete(requestId);
        }
      }
      if (path === "/api/document-studio/chat/cancel" && method === "POST") {
        const b = await readBody(req);
        if (b.requestId && activeChatRequests.has(b.requestId)) {
          const controller = activeChatRequests.get(b.requestId);
          controller.abort();
          activeChatRequests.delete(b.requestId);
        }
        json(res, { cancelled: true });
        return true;
      }
      const historyMatch = path.match(/^\/api\/document-studio\/documents\/([^/]+)\/history$/);
      if (historyMatch && method === "GET") {
        const docId = historyMatch[1];
        const doc = find(docId);
        const docs = getDocuments();

        const baseName = doc.name.replace(/\s*\((?:Revised|Template|compact|executive|classic|reviewed)\)/gi, "").replace(/\.[^.]+$/, "");
        const related = docs.filter((d) => {
          if (d.id === doc.id) return true;
          if (d.generation?.parentDocumentId === doc.id || doc.generation?.parentDocumentId === d.id) return true;
          if (doc.generation?.parentDocumentId && d.generation?.parentDocumentId === doc.generation.parentDocumentId) return true;
          if (doc.opportunityId && d.opportunityId === doc.opportunityId && d.kind === doc.kind) {
            const dBase = d.name.replace(/\s*\((?:Revised|Template|compact|executive|classic|reviewed)\)/gi, "").replace(/\.[^.]+$/, "");
            if (dBase.toLowerCase() === baseName.toLowerCase()) return true;
          }
          return false;
        });

        related.sort((a, b) => (b.version || 1) - (a.version || 1) || (b.createdAt || "").localeCompare(a.createdAt || ""));

        json(res, {
          documentId: doc.id,
          history: related.map((d) => ({
            id: d.id,
            name: d.name,
            version: d.version || 1,
            category: d.category,
            kind: d.kind,
            createdAt: d.createdAt,
            notes: d.notes,
            aiNotes: d.generation?.aiNotes,
            isCurrent: d.id === doc.id,
          })),
        });
        return true;
      }
      const restoreMatch = path.match(/^\/api\/document-studio\/documents\/([^/]+)\/restore$/);
      if (restoreMatch && method === "POST") {
        const b = await readBody(req);
        const targetId = b.targetId || restoreMatch[1];
        const historicalDoc = find(targetId);
        const targetBytes = readFileSync(documentPath(historicalDoc));

        const restoredDoc = saveDocument({
          name: historicalDoc.name,
          kind: historicalDoc.kind,
          category: historicalDoc.category,
          status: "draft",
          opportunityId: historicalDoc.opportunityId,
          content: targetBytes,
          notes: `Restored from version ${historicalDoc.version || 1} (${historicalDoc.id})`,
          generation: {
            source: "document-studio-restore",
            restoredFromId: historicalDoc.id,
            restoredFromVersion: historicalDoc.version || 1,
            originalNotes: historicalDoc.notes,
          },
        });

        json(res, {
          document: restoredDoc,
          restoredFrom: historicalDoc,
        }, 201);
        return true;
      }

      if (path === "/api/document-studio/connections" && method === "GET") {
        const obs = getObsidian()?.status?.() || null;
        const g = googleDocuments?.status?.() || null;
        json(res, {
          obsidian: obs
            ? {
                enabled: Boolean(obs.enabled),
                readOnly: Boolean(obs.readOnly),
                vaultName: obs.vaultName || "Opportunity Knox Vault",
                lastSyncedAt: obs.lastSyncedAt || "",
                lastImportedToVaultAt: obs.lastImportedToVaultAt || "",
                mountPending: Boolean(obs.mountPending),
                configured: Boolean(obs.enabled && !obs.mountPending),
              }
            : { enabled: false, readOnly: false, configured: false },
          google: g
            ? {
                configured: Boolean(g.configured),
                connected: Boolean(g.connected),
                clientId: g.clientId || "",
              }
            : { configured: false, connected: false },
        });
        return true;
      }

      if (path === "/api/document-studio/obsidian/sync" && method === "POST") {
        const obs = getObsidian();
        if (!obs) fail(503, "Obsidian integration is unavailable.");
        const obsStatus = obs.status();
        if (!obsStatus.enabled) fail(400, "Obsidian vault is not enabled. Configure Obsidian in Settings.");
        const result = await obs.syncFromVault({ autoPrepare: true });
        json(res, {
          ok: true,
          synced: result,
          obsidian: obs.status(),
        });
        return true;
      }

      if (path === "/api/document-studio/obsidian/export" && method === "POST") {
        const body = await readBody(req);
        if (!body.documentId || typeof body.documentId !== "string") {
          fail(400, "documentId is required.");
        }
        const doc = find(body.documentId);
        const obs = getObsidian();
        if (!obs) fail(503, "Obsidian integration is unavailable.");
        const obsStatus = obs.status();
        if (!obsStatus.enabled) fail(400, "Obsidian vault is not enabled.");
        if (obsStatus.readOnly) fail(400, "Obsidian vault is configured as read-only. Export is disabled.");
        const subfolder = typeof body.subfolder === "string" ? body.subfolder.trim() : "Generated";
        const exportResult = await obs.exportDocumentToVault(doc, { subfolder });
        json(res, {
          ok: true,
          ...exportResult,
        });
        return true;
      }

      if (path === "/api/document-studio/google/search" && method === "POST") {
        const body = await readBody(req);
        if (!googleDocuments?.isConnected?.()) {
          fail(400, "Google Drive is not connected. Connect Google in Settings.");
        }
        const query = typeof body.query === "string" ? body.query.trim() : "";
        const pageToken = typeof body.pageToken === "string" ? body.pageToken : null;
        const results = await googleDocuments.searchDrive(query, pageToken, true);
        json(res, results);
        return true;
      }

      if (path === "/api/document-studio/google/import" && method === "POST") {
        const body = await readBody(req);
        if (!body.id || typeof body.id !== "string") {
          fail(400, "id is required.");
        }
        if (!googleDocuments?.isConnected?.()) {
          fail(400, "Google Drive is not connected.");
        }
        const file = await googleDocuments.getFile(body.id);
        const DOC = "application/vnd.google-apps.document";
        const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        const PDF = "application/pdf";
        if (file.mimeType !== DOC && file.mimeType !== DOCX && file.mimeType !== PDF) {
          fail(400, "Only Google Docs, Word (.docx), and PDF files can be imported.");
        }
        const bytes = await googleDocuments.downloadFileContent(file.id, file.mimeType);
        let ext = ".docx";
        if (file.mimeType === PDF) ext = ".pdf";
        let baseName = (file.name || "Google document").replace(/[\0\r\n]/g, " ").slice(0, 200);
        if (!baseName.toLowerCase().endsWith(ext)) baseName += ext;
        const category = body.category || "reference";
        const kind = body.kind || (["master-cv", "cv-template", "tailored-cv"].includes(category) ? "cv" : "reference");
        const doc = saveDocument({
          name: baseName,
          kind,
          category,
          status: "draft",
          content: bytes,
          notes: "Imported from Google Drive. External original is unchanged.",
          externalSource: {
            provider: "google-drive",
            id: file.id,
            version: String(file.version || file.modifiedTime || ""),
            modifiedTime: file.modifiedTime || "",
            name: file.name,
            mimeType: file.mimeType,
            url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
            importedAt: new Date().toISOString(),
            lastSyncedRevision: 1,
          },
        });
        json(res, { ok: true, document: doc }, 201);
        return true;
      }

      if (path === "/api/document-studio/google/refresh" && method === "POST") {
        const body = await readBody(req);
        if (!body.documentId || typeof body.documentId !== "string") {
          fail(400, "documentId is required.");
        }
        const doc = find(body.documentId);
        if (!doc.externalSource?.id || !["google-drive", "google-docs"].includes(doc.externalSource?.provider)) {
          fail(400, "This document was not imported from Google Drive.");
        }
        if (!googleDocuments?.isConnected?.()) {
          fail(400, "Google Drive is disconnected. Reconnect in Settings to refresh.");
        }
        const file = await googleDocuments.getFile(doc.externalSource.id);
        const extVer = String(file.version || file.modifiedTime || "");
        const localExtVer = String(doc.externalSource.version || "");
        const localVer = Number(doc.version || 1);
        const localModified = localVer > (doc.externalSource.lastSyncedRevision || 1) || Boolean(doc.notes?.includes("restored") || doc.notes?.includes("Revised"));

        if (extVer === localExtVer && !body.resolution) {
          json(res, {
            ok: true,
            status: "up-to-date",
            message: "Document is up to date with Google Drive.",
            document: doc,
          });
          return true;
        }

        // External has changed! Check if local also changed -> CONFLICT!
        if (localModified && extVer !== localExtVer) {
          if (!body.resolution) {
            json(res, {
              conflict: true,
              localVersion: localVer,
              externalVersion: extVer,
              modifiedTime: file.modifiedTime || "",
              externalName: file.name || doc.name,
              message: "Document has been modified locally and a newer version exists in Google Drive.",
            });
            return true;
          }

          if (body.resolution === "keep-local") {
            doc.externalSource.version = extVer;
            doc.externalSource.acknowledgedConflictAt = new Date().toISOString();
            json(res, {
              ok: true,
              status: "kept-local",
              message: "Kept local version. External update was acknowledged.",
              document: doc,
            });
            return true;
          }

          if (body.resolution === "new-version") {
            const bytes = await googleDocuments.downloadFileContent(file.id, file.mimeType);
            const newDoc = saveDocument({
              name: doc.name,
              kind: doc.kind,
              category: doc.category,
              status: doc.status || "draft",
              content: bytes,
              parentDocumentId: doc.id,
              notes: `Refreshed from Google Drive as version ${localVer + 1} (conflict resolved).`,
              externalSource: {
                ...doc.externalSource,
                version: extVer,
                modifiedTime: file.modifiedTime || "",
                importedAt: new Date().toISOString(),
                lastSyncedRevision: localVer + 1,
              },
            });
            json(res, {
              ok: true,
              status: "new-version",
              document: newDoc,
            });
            return true;
          }

          if (body.resolution === "separate-copy") {
            const bytes = await googleDocuments.downloadFileContent(file.id, file.mimeType);
            const ext = doc.name.match(/\.[a-zA-Z0-9]+$/)?.[0] || ".docx";
            const copyName = `${cleanDocName(doc.name).replace(/\.[a-zA-Z0-9]+$/, "")} (Google Drive Copy)${ext}`;
            const copyDoc = saveDocument({
              name: copyName,
              kind: doc.kind,
              category: doc.category,
              status: "draft",
              content: bytes,
              notes: "Separate copy saved from Google Drive external update.",
              externalSource: {
                provider: "google-drive",
                id: file.id,
                version: extVer,
                modifiedTime: file.modifiedTime || "",
                name: file.name,
                url: file.webViewLink || "",
                importedAt: new Date().toISOString(),
                lastSyncedRevision: 1,
              },
            });
            json(res, {
              ok: true,
              status: "separate-copy",
              document: copyDoc,
            });
            return true;
          }
          fail(400, "Invalid conflict resolution. Choose keep-local, new-version, or separate-copy.");
        }

        // Local was NOT modified: safe automatic refresh!
        const bytes = await googleDocuments.downloadFileContent(file.id, file.mimeType);
        const newDoc = saveDocument({
          name: doc.name,
          kind: doc.kind,
          category: doc.category,
          status: doc.status || "draft",
          content: bytes,
          parentDocumentId: doc.id,
          notes: `Refreshed from Google Drive (v${localVer + 1}).`,
          externalSource: {
            ...doc.externalSource,
            version: extVer,
            modifiedTime: file.modifiedTime || "",
            importedAt: new Date().toISOString(),
            lastSyncedRevision: localVer + 1,
          },
        });
        json(res, {
          ok: true,
          status: "refreshed",
          document: newDoc,
        });
        return true;
      }
      if(path==="/api/document-studio/cv-styles"&&method==="GET"){
        json(res,{
          googleConnected: !!googleDocuments?.isConnected?.(),
          documents:getDocuments().filter(isCV).sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||"")).map(d=>({id:d.id,name:cleanDocName(d.name),fullName:d.name,revision:d.revision,version:d.version,reusable:true,format:d.name.split(".").at(-1).toLowerCase(),thumbnailUrl:"/api/document-studio/thumbnails/"+d.id})),
          templates:getDocuments().filter(isTemplate).sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||"")).map(d=>({id:d.id,name:cleanDocName(d.name),fullName:d.name,revision:d.revision,version:d.version,reusable:true,format:d.name.split(".").at(-1).toLowerCase(),thumbnailUrl:"/api/document-studio/thumbnails/"+d.id}))
        });return true;
      }
      const thumbnailMatch=path.match(/^\/api\/document-studio\/cv-styles\/([^/]+)\/thumbnail$/)||path.match(/^\/api\/document-studio\/thumbnails\/([^/]+)$/);
      if(thumbnailMatch&&method==="GET"){
        const doc=find(thumbnailMatch[1]);if(!/\.(docx|pdf|gdoc|gsheet|gslides)$/i.test(doc.name))fail(400,"Preview supports PDF, Word and connected Google Workspace files.");
        if(/\.(gdoc|gsheet|gslides)$/i.test(doc.name)&&!googleDocuments?.isConnected())fail(400,"Connect Google Docs in Career Hub to preview this shortcut.");
        const st=statSync(documentPath(doc)),signature=`${doc.revision}:${doc.sha256}:${st.size}:${st.mtimeMs}`;
        let cached=thumbnails.get(doc.id);
        if(cached?.signature!==signature||cached.expiresAt<Date.now()){
          if(!pendingThumbnails.has(doc.id)){
            if(pendingThumbnails.size>=24)fail(429,"Style previews are busy. Try again shortly.");
            const render=thumbnailQueue.then(async()=>{
              const current=find(doc.id);if(current.revision!==doc.revision)fail(409,"CV changed. Refresh its style preview.");
              const folder=mkdtempSync(join(tmpdir(),"knox-cv-thumbnail-"));
              try{
                let bytes=readFileSync(documentPath(current)),rendered;
                if(/\.(gdoc|gsheet|gslides)$/i.test(current.name)){
                  let id=current.externalSource?.id;
                  if(!id){
                    const raw=bytes.toString("utf8");
                    try{const pointer=JSON.parse(raw);id=pointer.doc_id||pointer.id||pointer.resource_id?.replace(/^(document|spreadsheet|presentation):/,"");}catch{}
                    id ||= raw.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];
                  }
                  if(!id)fail(400,"Google shortcut does not contain a readable document ID.");
                  bytes=await googleDocuments.exportDocument(id,"application/pdf");
                  rendered=await pdfThumbnail(bytes,folder);
                }else if(/\.pdf$/i.test(current.name))rendered=await pdfThumbnail(bytes,folder);
                else{await safeWord(bytes);rendered=await convert(bytes,folder,{thumbnail:true});}
                const png=readFileSync(rendered.thumbnailPath||join(folder,"page-"+String(1).padStart(String(rendered.pages).length,"0")+".png"));
                if(png.length>4*1024*1024)fail(413,"CV thumbnail is too large.");
                if(thumbnails.size>=24)thumbnails.delete(thumbnails.keys().next().value);
                const result={signature,bytes:png,expiresAt:Date.now()+5*60000};thumbnails.set(doc.id,result);return result;
              }finally{rmSync(folder,{recursive:true,force:true});}
            });
            thumbnailQueue=render.catch(()=>{});pendingThumbnails.set(doc.id,render);
          }
          try{cached=await pendingThumbnails.get(doc.id);}finally{pendingThumbnails.delete(doc.id);}
        }
        res.writeHead(200,{"Content-Type":"image/png","Cache-Control":"no-store"});res.end(cached.bytes);return true;
      }
      if (path === "/api/document-studio" && method === "GET") {
        json(res, {
          layouts,
          documents: getDocuments()
            .filter((d) => /\.docx$/i.test(d.name))
            .map((d) => ({
              id: d.id,
              name: d.name,
              kind: d.kind,
              category:d.category,
              status: d.status,
              revision: d.revision,
              opportunityId: d.opportunityId,
              originalUrl:
                d.externalSource?.url ||
                (d.notes || "").match(
                  /https:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[A-Za-z0-9_-]+(?:\/edit)?/,
                )?.[0] ||
                "",
            })),
        });
        return true;
      }
      const templateMatch = path.match(
        /^\/api\/document-studio\/templates\/([a-z-]+)$/,
      );
      if (templateMatch && method === "GET") {
        const layout = layouts.find((l) => l.id === templateMatch[1]);
        if (!layout) fail(404, "Template not found.");
        const text =
          layout.id === "letter"
            ? "# Your name\nYour contact details\n\nDear hiring team\n\n[State the role and your evidence-based reason for applying.]\n\n[Describe one relevant achievement using verified facts.]\n\n[Close with the next step.]\n\nYours sincerely\nYour name"
            : "# Your name\nYour contact details\n\n## Profile\n[Summarise your relevant experience using verified facts.]\n\n## Key skills\n- [Relevant skill supported by your experience]\n\n## Experience\n### Role | Employer | Dates\n- [Action and verified result]\n\n## Education\n[Qualification | Institution | Dates]";
        const bytes = await layoutDraft("Career template", text, layout.id);
        res.writeHead(200, {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition":
            'attachment; filename="' + layout.id + '-template.docx"',
          "Cache-Control": "no-store",
        });
        res.end(bytes);
        return true;
      }
      const sourceMatch = path.match(
        /^\/api\/document-studio\/source\/([^/]+)$/,
      );
      if (sourceMatch && method === "GET") {
        const d = find(sourceMatch[1]);
        const text =
          d.generation?.content ||
          (await extractDocument(d.name, readFileSync(documentPath(d)))).text;
        if (!text) fail(400, "No readable draft text found.");
        json(res, {
          content: text.slice(0, 60000),
          warning: d.generation?.content
            ? ""
            : "Extracted Word text may lose heading/bullet structure. Review it before applying a new layout.",
        });
        return true;
      }
      if (path === "/api/document-studio/preview" && method === "POST") {
        if (busy)
          fail(429, "Another document is rendering. Try again shortly.");
        if (previews.size >= 10)
          fail(429, "Close a previous preview before creating another.");
        const b = await readBody(req);
        if (
          b.pageTarget !== undefined &&
          (!Number.isInteger(b.pageTarget) ||
          b.pageTarget < 1 ||
          b.pageTarget > 10)
        )
          fail(400, "Choose a page target from 1 to 10.");
        const doc = find(b.documentId);
        if (doc.revision !== b.revision)
          fail(409, "Source document changed. Reload before rendering.");
        let folder;
        busy = true;
        try {
          const isMarkdown = /\.(md|markdown|txt)$/i.test(doc.name);
          if (isMarkdown) {
            const raw = readFileSync(documentPath(doc), "utf8");
            json(res, {
              id: doc.id,
              sourceName: doc.name,
              format: "markdown",
              content: raw,
              pages: 1,
              pageTarget: 1,
              overTarget: false,
              pdfUrl: null,
              wordUrl: null,
              images: [],
              warnings: [],
            });
            return true;
          }
          folder = mkdtempSync(join(tmpdir(), "knox-document-"));
          let result;
          const isPdf = /\.pdf$/i.test(doc.name);
          const isGoogle = /\.(gdoc|gsheet|gslides)$/i.test(doc.name);
          if (isPdf) {
            const bytes = readFileSync(documentPath(doc));
            result = await pdfPages(bytes, folder);
            result.bytes = bytes;
          } else if (isGoogle) {
            if (!googleDocuments?.isConnected()) fail(400, "Connect Google Docs in Career Hub to preview this shortcut.");
            let id = doc.externalSource?.id;
            if (!id) {
              const raw = readFileSync(documentPath(doc), "utf8");
              try { const pointer = JSON.parse(raw); id = pointer.doc_id || pointer.id || pointer.resource_id?.replace(/^(document|spreadsheet|presentation):/, ""); } catch {}
              id ||= raw.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];
            }
            if (!id) fail(400, "Google shortcut does not contain a readable document ID.");
            const pdfBytes = await googleDocuments.exportDocument(id, "application/pdf");
            result = await pdfPages(pdfBytes, folder);
            result.bytes = pdfBytes;
          } else {
            const source = readFileSync(documentPath(doc));
            await safeWord(source);
            let bytes = source;
            if (b.layout && b.layout !== "original") {
              const extracted = doc.generation?.content
                ? { text: doc.generation.content }
                : await extractDocument(doc.name, source);
              const content =
                typeof b.content === "string" ? b.content : extracted.text;
              if (!content || content.length > 60000)
                fail(400, "Choose a readable draft up to 60,000 characters.");
              let template;
              if (b.layout === "custom") {
                const td = find(b.templateId);
                if (td.id === doc.id)
                  fail(400, "Choose a separate marked Word template.");
                template = readFileSync(documentPath(td));
              }
              bytes = await layoutDraft(
                doc.generation?.title || doc.name.replace(/\.docx$/i, ""),
                content,
                b.layout,
                template,
              );
            }
            result = await convert(bytes, folder);
            result.bytes = bytes;
          }
          const id = randomUUID();
          const target = b.pageTarget || result.pages;
          previews.set(id, {
            folder,
            bytes: result.bytes,
            pdf: result.pdf,
            pages: result.pages,
            pageTarget: target,
            sourceId: doc.id,
            sourceRevision: doc.revision,
            kind: doc.kind,
            name: doc.name,
            opportunityId: doc.opportunityId,
            layout: b.layout || "original",
            expiresAt: Date.now() + 30 * 60000,
          });
          json(res, {
            id,
            sourceName: doc.name,
            pages: result.pages,
            pageTarget: target,
            overTarget: result.pages > target,
            pdfUrl: "/api/document-studio/" + id + "/pdf",
            wordUrl: /\.docx$/i.test(doc.name) ? "/api/document-studio/" + id + "/word" : null,
            images: Array.from(
              { length: result.pages },
              (_, i) => "/api/document-studio/" + id + "/page/" + (i + 1),
            ),
            warnings: [
              ...(b.pageTarget && result.pages > target
                ? [
                    "This draft exceeds the page target. Edit the draft or choose a more compact layout; content has not been cut.",
                  ]
                : []),
              "Check every page. Fonts unavailable in Docker may be substituted. Preview expires after 30 minutes.",
            ],
          });
          return true;
        } catch (e) {
          if (folder) rmSync(folder, { recursive: true, force: true });
          throw e;
        } finally {
          busy = false;
        }
      }
      const m = path.match(
        /^\/api\/document-studio\/([^/]+)(?:\/(pdf|word|page|save)(?:\/(\d+))?)?$/,
      );
      if (!m) return false;
      const p = previews.get(m[1]);
      if (!p) fail(404, "Preview expired. Generate it again.");
      if (method === "DELETE" && !m[2]) {
        rmSync(p.folder, { recursive: true, force: true });
        previews.delete(m[1]);
        json(res, { removed: true });
        return true;
      }
      if (method === "POST" && m[2] === "save") {
        const b = await readBody(req);
        if (b.confirm !== true) fail(400, "Review the preview before saving.");
        if (!["pdf", "docx"].includes(b.format))
          fail(400, "Choose PDF or Word.");
        const source = find(p.sourceId);
        if (source.revision !== p.sourceRevision)
          fail(409, "Source changed. Generate a fresh preview.");
        p.saved ||= {};
        if (!p.saved[b.format])
          p.saved[b.format] = saveDocument({
            name: p.name.replace(/\.docx$/i, "") + " - reviewed." + b.format,
            kind: p.kind,
            category:source.category,
            status: "draft",
            opportunityId: p.opportunityId,
            content: b.format === "pdf" ? p.pdf : p.bytes,
            notes:
              "Document Studio draft. Page count " +
              p.pages +
              "; target " +
              p.pageTarget +
              ". Requires factual and layout review.",
            generation: {
              source: "document-studio",
              sourceId: p.sourceId,
              sourceRevision: p.sourceRevision,
              layout: p.layout,
              pages: p.pages,
              pageTarget: p.pageTarget,
            },
          });
        json(res, { document: p.saved[b.format] });
        return true;
      }
      if (method !== "GET") fail(405, "Method not supported.");
      let bytes, type;
      if (m[2] === "pdf") {
        bytes = p.pdf;
        type = "application/pdf";
      } else if (m[2] === "word") {
        bytes = p.bytes;
        type =
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      } else if (
        m[2] === "page" &&
        Number(m[3]) >= 1 &&
        Number(m[3]) <= p.pages
      ) {
        const num = String(Number(m[3])).padStart(String(p.pages).length, "0");
        bytes = readFileSync(join(p.folder, "page-" + num + ".png"));
        type = "image/png";
      } else fail(404, "Preview file not found.");
      res.writeHead(200, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(m[2] === "word"
          ? {
              "Content-Disposition":
                'attachment; filename="reviewed-draft.docx"',
            }
          : {}),
      });
      res.end(bytes);
      return true;
    },
  };
}
