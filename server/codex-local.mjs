import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  rmSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { join, resolve, extname, sep, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { safeWord } from "./document-layout.mjs";
const failure = (message, status = 503) =>
  Object.assign(new Error(message), { status });
const directory = () =>
  join(process.env.BOARD_DATA_DIR || "/data", "codex-buddy");
export function codexStatus(root = directory()) {
  try {
    const s = JSON.parse(readFileSync(join(root, "status.json"), "utf8"));
    if (
      !s.ready ||
      (Date.now() / 1000 - s.time > 10 &&
        !(s.busyUntil > Date.now() / 1000 && s.busyUntil <= s.time + 901))
    )
      throw Error();
    return true;
  } catch {
    throw failure(
      "The Codex helper is unavailable. Sign in to Codex on the board host, then start/restart the board with its launcher.",
    );
  }
}
export async function runLocalCodex(
  config,
  system,
  messages,
  schema,
  root = directory(),
  kind = "inference",
) {
  if (config.signal?.aborted)
    throw failure("Career Buddy request cancelled.", 499);
  codexStatus(root);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(config.model))
    throw failure("Choose a valid Codex model ID.", 400);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const id = randomUUID(),
    request = join(root, id + ".request.json"),
    response = join(root, id + ".response.json"),
    temp = request + ".tmp",
    cancel = join(root, id + ".cancel.json"),
    progress = join(root, id + ".progress.json");
  const timeoutSeconds =
    kind === "models" ? 20 : config.requestTimeoutSeconds || 300;
  const prompt =
    "You are a text-only Career Buddy adapter. Do not use tools, inspect files, execute commands or modify anything. Return only the requested JSON.\n" +
    system +
    "\n\nConversation data:\n" +
    JSON.stringify(messages);
  if (prompt.length > 500000)
    throw failure(
      "This Codex context is too large. Select fewer sources.",
      413,
    );
  writeFileSync(
    temp,
    JSON.stringify({
      prompt,
      kind,
      schema,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      expiresAt: Date.now() / 1000 + timeoutSeconds,
    }),
    { mode: 0o600, flag: "wx" },
  );
  renameSync(temp, request);
  const stop = () => {
    writeFileSync(
      cancel,
      JSON.stringify({ expiresAt: Date.now() / 1000 + timeoutSeconds + 10 }),
      { mode: 0o600 },
    );
    rmSync(request, { force: true });
  };
  const began=Date.now();
  config.onDiagnostics?.({responseMode:"codex"});
  config.onProgress?.("queued-codex");
  let lastProgress = "";
  try {
    const deadline = Date.now() + timeoutSeconds * 1000;

    while (Date.now() < deadline) {
      if (config.signal?.aborted) {
        stop();
        config.onDiagnostics?.({cancellation:"unconfirmed"});
        // Wait briefly for our owned helper process to acknowledge termination.
        // This confirms local termination only, never remote compute/billing.
        const until=Date.now()+1500;
        while(Date.now()<until){
          try { const ack=JSON.parse(readFileSync(response,"utf8"));if(ack.errorCode==="cancelled"||typeof ack.output==="string"){config.onDiagnostics?.({cancellation:"codex-process-stopped"});break;} }catch{}
          await new Promise(r=>setTimeout(r,100));
        }
        throw failure("Career Buddy request cancelled.", 499);
      }
      try {
        const value = JSON.parse(readFileSync(progress, "utf8"));
        config.onDiagnostics?.({codexIssue:value.issue,codexEventCount:value.eventCount,codexLastEventAt:typeof value.lastEventAt==="number"?new Date(value.lastEventAt*1000).toISOString():undefined});
        if (value.stage !== lastProgress) {
          lastProgress = value.stage;
          config.onProgress?.(value.stage);
          if(value.stage==="running-codex")config.onDiagnostics?.({queueMs:Date.now()-began});
        }
      } catch {}

      let value;
      try {
        value = JSON.parse(readFileSync(response, "utf8"));
      } catch {}
      if (value) {
        if (value.error)
          throw failure(
            value.error,
            value.errorCode === "deadline"
              ? 504
              : value.errorCode === "cancelled"
                ? 499
                : 502,
          );
        if (
          typeof value.output !== "string" ||
          value.output.length > 2 * 1024 * 1024
        )
          throw failure("Codex returned an invalid response.", 502);
        if(value.timings)config.onDiagnostics?.(value.timings);
        if(value.usage && Object.keys(value.usage).length)config.onDiagnostics?.({usage:{inputTokens:value.usage.input_tokens,outputTokens:value.usage.output_tokens,cachedInputTokens:value.usage.cached_input_tokens,reasoningTokens:value.usage.reasoning_output_tokens,complete:true}});
        return value.output;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    stop();
    throw failure(
      kind === "models"
        ? "Codex model discovery timed out. Retry when the helper is idle, or enter an ID manually."
        : `Codex exceeded the ${timeoutSeconds}-second request limit. Increase the timeout in Settings, reduce context or retry.`,
      504,
    );
  } finally {
    rmSync(request, { force: true });
    rmSync(response, { force: true });
    rmSync(temp, { force: true });
    rmSync(progress, { force: true });
  }
}

export async function listLocalCodexModels(root = directory()) {
  const parsed = JSON.parse(
    await runLocalCodex({ model: "default" }, "", [], {}, root, "models"),
  );
  if (
    !Array.isArray(parsed.models) ||
    parsed.models.some(
      (m) => !m || typeof m.id !== "string" || typeof m.name !== "string",
    )
  )
    throw failure("The Codex model catalogue was invalid.", 502);
  return {
    models: parsed.models,
    suggested: "default",
    truncated: Boolean(parsed.truncated),
  };
}

export async function runCodexDocumentGeneration({
  config,
  styleDocument,
  sourceCv,
  opportunity,
  brief = "",
  instructions = "",
  root = directory(),
}) {
  if (config.signal?.aborted)
    throw failure("Document generation request cancelled.", 499);
  codexStatus(root);
  if (!config.model || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(config.model))
    throw failure("Choose a valid Codex model ID.", 400);
  if (!styleDocument || !Buffer.isBuffer(styleDocument.bytes) || !styleDocument.bytes.length)
    throw failure("Provide a valid reference document.", 400);
  if (!sourceCv || typeof sourceCv.text !== "string" || !sourceCv.text.trim())
    throw failure("Provide a valid candidate source CV.", 400);

  mkdirSync(root, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const jobDir = join(root, id + ".job");
  const inputsDir = join(jobDir, "inputs");
  const workspaceDir = join(jobDir, "workspace");
  const request = join(root, id + ".request.json");
  const response = join(root, id + ".response.json");
  const temp = request + ".tmp";
  const cancel = join(root, id + ".cancel.json");
  const progress = join(root, id + ".progress.json");

  mkdirSync(inputsDir, { recursive: true, mode: 0o700 });
  mkdirSync(workspaceDir, { recursive: true, mode: 0o700 });

  const timeoutSeconds = config.requestTimeoutSeconds || 600;

  // 1. Stage inputs
  const refExt = extname(styleDocument.name || "").toLowerCase() || (styleDocument.kind === "pdf" ? ".pdf" : ".docx");
  const refPath = join(inputsDir, "reference" + refExt);
  writeFileSync(refPath, styleDocument.bytes, { mode: 0o600 });

  if (refExt === ".docx" || refExt === ".dotx") {
    writeFileSync(join(workspaceDir, "draft.docx"), styleDocument.bytes, { mode: 0o600 });
  }

  const imagePaths = [];
  if (Array.isArray(styleDocument.pageImages)) {
    for (let i = 0; i < styleDocument.pageImages.length; i++) {
      const imgBytes = styleDocument.pageImages[i];
      if (Buffer.isBuffer(imgBytes)) {
        const imgPath = join(inputsDir, `page-${i + 1}.png`);
        writeFileSync(imgPath, imgBytes, { mode: 0o600 });
        imagePaths.push(imgPath);
      }
    }
  }

  writeFileSync(join(inputsDir, "source_cv.txt"), sourceCv.text, { mode: 0o600 });
  writeFileSync(
    join(inputsDir, "job_context.json"),
    JSON.stringify(
      {
        company: opportunity?.company || "",
        role: opportunity?.role || "",
        description: (opportunity?.description || "").slice(0, 35000),
        brief: (brief || "").slice(0, 10000),
        instructions: (instructions || "").slice(0, 10000),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  try {
    symlinkSync("../inputs", join(workspaceDir, "inputs"), "junction");
  } catch {}

  const manifestSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      outputDocx: { type: "string" },
      outputPdf: { type: ["string", "null"] },
      pageCount: { type: "integer" },
      notes: { type: ["string", "null"] },
      layoutCompromises: { type: ["string", "null"] },
    },
    required: [
      "outputDocx",
      "outputPdf",
      "pageCount",
      "notes",
      "layoutCompromises",
    ],
  };

  const prompt = [
    "You are an expert document-authoring agent. Your task is to generate a tailored CV in Word (.docx) format that preserves the visual layout, typography, section structure, and sidebar composition of the provided reference document, populated strictly with the candidate's factual career evidence.",
    "",
    "INPUT FILES (in inputs/ or ../inputs/):",
    `- reference${refExt} (style reference: "${styleDocument.name}"): The visual style reference. Inspect its tables, columns, sidebars, section placement, margins, fonts, and headings. This is ONLY a visual reference—NEVER use its names, companies, dates, or example text as candidate facts.`,
    "- source_cv.txt: The verified candidate career facts. Preserve their real identity, employment chronology, job titles, employers, dates, and qualifications. Never fabricate claims or invent employers.",
    "- job_context.json: The target role, company, job requirements, and tailoring instructions.",
    "",
    "WORK EXPERIENCE & RECENCY RULES:",
    "- In the main work experience section, include detailed roles with bulleted achievements strictly for experience from the last 10 years (from 10 years ago to the present).",
    "- For all experience older than 10 years, group them under a dedicated section titled 'Previous Experience'.",
    "- Under 'Previous Experience', list ONLY the dates, company names, and job titles (do not include extensive bullet lists). You may include a brief summary highlighting key points or achievements from those earlier roles that are directly relevant to the target job description.",
    "",
    "WORKSPACE & OUTPUT INSTRUCTIONS:",
    "- Your working directory is the workspace root.",
    "- Write your finished Word document to output.docx in the current directory.",
    refExt === ".docx" || refExt === ".dotx"
      ? "- A copy of the reference is available as draft.docx in the current directory. You may edit this Word package (e.g. using Python standard library zipfile/xml to replace text in existing paragraph and table runs) to preserve 100% of the reference's tables, columns, and styles."
      : "- Reconstruct the visual layout (including columns and sidebars) in an editable Word (.docx) document.",
    "- Ensure candidate facts from source_cv.txt are completely and accurately presented.",
    "- Return the final manifest JSON matching the output schema with outputDocx set to 'output.docx', outputPdf set to null (or 'output.pdf' if produced), pageCount set to the document page count, and notes/layoutCompromises explaining any visual choices (or null).",
  ].join("\n");

  writeFileSync(
    temp,
    JSON.stringify({
      id,
      kind: "document-generation",
      jobDir,
      images: imagePaths,
      prompt,
      schema: manifestSchema,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      expiresAt: Date.now() / 1000 + timeoutSeconds,
    }),
    { mode: 0o600, flag: "wx" },
  );
  renameSync(temp, request);

  const stop = () => {
    writeFileSync(
      cancel,
      JSON.stringify({ expiresAt: Date.now() / 1000 + timeoutSeconds + 10 }),
      { mode: 0o600 },
    );
    rmSync(request, { force: true });
  };

  const began = Date.now();
  config.onDiagnostics?.({ responseMode: "codex-document-generation" });
  config.onProgress?.("queued-codex");
  let lastProgress = "";

  try {
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      if (config.signal?.aborted) {
        stop();
        config.onDiagnostics?.({ cancellation: "unconfirmed" });
        const until = Date.now() + 1500;
        while (Date.now() < until) {
          try {
            const ack = JSON.parse(readFileSync(response, "utf8"));
            if (ack.errorCode === "cancelled" || typeof ack.output === "string") {
              config.onDiagnostics?.({ cancellation: "codex-process-stopped" });
              break;
            }
          } catch {}
          await new Promise((r) => setTimeout(r, 100));
        }
        throw failure("Document generation request cancelled.", 499);
      }

      try {
        const value = JSON.parse(readFileSync(progress, "utf8"));
        config.onDiagnostics?.({
          codexIssue: value.issue,
          codexEventCount: value.eventCount,
          codexLastEventAt: typeof value.lastEventAt === "number" ? new Date(value.lastEventAt * 1000).toISOString() : undefined,
        });
        if (value.stage !== lastProgress) {
          lastProgress = value.stage;
          config.onProgress?.(value.stage);
          if (value.stage === "running-codex") config.onDiagnostics?.({ queueMs: Date.now() - began });
        }
      } catch {}

      let value;
      try {
        value = JSON.parse(readFileSync(response, "utf8"));
      } catch {}

      if (value) {
        if (value.error) {
          throw failure(
            value.error,
            value.errorCode === "deadline" ? 504 : value.errorCode === "cancelled" ? 499 : 502,
          );
        }
        let manifest;
        try {
          manifest = JSON.parse(value.output);
        } catch {
          throw failure("Codex returned an invalid document manifest.", 502);
        }

        // Verify outputDocx path safety
        if (typeof manifest.outputDocx !== "string" || !manifest.outputDocx || manifest.outputDocx.includes("..") || isAbsolute(manifest.outputDocx)) {
          throw failure("Invalid artifact path in manifest.", 502);
        }
        let docxPath = resolve(workspaceDir, manifest.outputDocx);
        if (!docxPath.startsWith(resolve(workspaceDir) + sep) && docxPath !== resolve(workspaceDir)) {
          throw failure("Artifact path traversal is not allowed.", 502);
        }
        if (!existsSync(docxPath) && manifest.outputDocx.startsWith("workspace/")) {
          const alternate = resolve(workspaceDir, manifest.outputDocx.replace(/^workspace\//, ""));
          if (existsSync(alternate)) {
            docxPath = alternate;
          }
        } else if (!existsSync(docxPath)) {
          const subWorkspace = resolve(workspaceDir, "workspace", manifest.outputDocx);
          if (existsSync(subWorkspace)) {
            docxPath = subWorkspace;
          }
        }
        if (!existsSync(docxPath)) {
          throw failure(`Generated Word document "${manifest.outputDocx}" not found.`, 502);
        }

        let docxBytes = readFileSync(docxPath);
        const validatedZip = await safeWord(docxBytes);
        const ctFile = validatedZip.file("[Content_Types].xml");
        if (ctFile) {
          const ctXml = await ctFile.async("string");
          if (ctXml.includes("wordprocessingml.template.main+xml")) {
            validatedZip.file(
              "[Content_Types].xml",
              ctXml.replace(
                /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.template\.main\+xml/g,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
              ),
            );
            docxBytes = await validatedZip.generateAsync({ type: "nodebuffer" });
          }
        }

        let pdfBytes = null;
        if (typeof manifest.outputPdf === "string" && manifest.outputPdf && !manifest.outputPdf.includes("..") && !isAbsolute(manifest.outputPdf)) {
          const pdfPath = resolve(workspaceDir, manifest.outputPdf);
          if (pdfPath.startsWith(resolve(workspaceDir) + sep) && existsSync(pdfPath)) {
            pdfBytes = readFileSync(pdfPath);
          }
        }

        if (value.timings) config.onDiagnostics?.(value.timings);
        if (value.usage && Object.keys(value.usage).length) {
          config.onDiagnostics?.({
            usage: {
              inputTokens: value.usage.input_tokens,
              outputTokens: value.usage.output_tokens,
              cachedInputTokens: value.usage.cached_input_tokens,
              reasoningTokens: value.usage.reasoning_output_tokens,
              complete: true,
            },
          });
        }

        return {
          docx: docxBytes,
          pdf: pdfBytes,
          manifest,
          timings: value.timings,
          usage: value.usage,
        };
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    stop();
    throw failure(
      `Codex exceeded the ${timeoutSeconds}-second document generation limit.`,
      504,
    );
  } finally {
    rmSync(request, { force: true });
    rmSync(response, { force: true });
    rmSync(temp, { force: true });
    rmSync(progress, { force: true });
    rmSync(jobDir, { recursive: true, force: true });
  }
}
