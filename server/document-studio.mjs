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
const run = promisify(execFile),
  fail = (s, m) => {
    throw Object.assign(new Error(m), { status: s });
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
export function createDocumentStudio({
  getDocuments,
  documentPath,
  saveDocument,
  convert = convertWord,
  pdfThumbnail = renderPDFThumbnail,
  googleDocuments,
}) {
  const previews = new Map(), thumbnails=new Map(), pendingThumbnails=new Map();
  let thumbnailQueue=Promise.resolve();
  const cleanDocName = name => (String(name || "").split(/[/\\]/).pop() || name);
  const isCV=d=>/\.(docx|pdf|gdoc)$/i.test(d.name)&&d.category!=="template"&&(d.kind==="cv"||["master-cv","tailored-cv","cv"].includes(d.category)||/\b(cv|resume|résumé)\b/i.test(d.name));
  const isTemplate=d=>/\.(docx|pdf|gdoc)$/i.test(d.name)&&(d.category==="template"||/\btemplate\b/i.test(d.name));
  let busy = false;
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
      for (const p of previews.values())
        rmSync(p.folder, { recursive: true, force: true });
      previews.clear();
    },
    async handle(path, method, req, res, { json, readBody }) {
      clean();
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
          !Number.isInteger(b.pageTarget) ||
          b.pageTarget < 1 ||
          b.pageTarget > 10
        )
          fail(400, "Choose a page target from 1 to 10.");
        const doc = find(b.documentId);
        if (doc.revision !== b.revision)
          fail(409, "Source document changed. Reload before rendering.");
        let folder;
        busy = true;
        try {
          const source = readFileSync(documentPath(doc));
          await safeWord(source);
          let bytes = source;
          if (b.layout !== "original") {
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
          folder = mkdtempSync(join(tmpdir(), "knox-document-"));
          const result = await convert(bytes, folder);
          const id = randomUUID();
          previews.set(id, {
            folder,
            bytes,
            pdf: result.pdf,
            pages: result.pages,
            pageTarget: b.pageTarget,
            sourceId: doc.id,
            sourceRevision: doc.revision,
            kind: doc.kind,
            name: doc.name,
            opportunityId: doc.opportunityId,
            layout: b.layout,
            expiresAt: Date.now() + 30 * 60000,
          });
          json(res, {
            id,
            sourceName: doc.name,
            pages: result.pages,
            pageTarget: b.pageTarget,
            overTarget: result.pages > b.pageTarget,
            pdfUrl: "/api/document-studio/" + id + "/pdf",
            wordUrl: "/api/document-studio/" + id + "/word",
            images: Array.from(
              { length: result.pages },
              (_, i) => "/api/document-studio/" + id + "/page/" + (i + 1),
            ),
            warnings: [
              ...(result.pages > b.pageTarget
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
