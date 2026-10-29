import JSZip from "jszip";
import { basename } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const text = (v, max, label) => {
  if (typeof v !== "string" || v.length > max || v.includes("\0"))
    fail(400, "Invalid " + label + ".");
  return v.trim();
};
export function createApplicationPacks({
  db,
  getRecord,
  putRecord,
  getDocuments,
  putDocument,
  documentPath,
  fullRecord,
  addEvent,
}) {
  const now = () => new Date().toISOString();
  function eligible(o) {
    return getDocuments().filter(
      (d) => !d.opportunityId || d.opportunityId === o.id,
    );
  }
  function pin(o, ids) {
    if (
      !Array.isArray(ids) ||
      ids.length > 30 ||
      new Set(ids).size !== ids.length
    )
      fail(400, "Choose up to 30 distinct document versions.");
    const available = eligible(o);
    return ids.map((id) => {
      const d = available.find((d) => d.id === id);
      if (!d)
        fail(400, "Choose available library or this opportunity’s documents.");
      return {
        id: d.id,
        name: d.name,
        kind: d.kind,
        category: d.category,
        version: d.version,
        revision: d.revision ?? 1,
        sha256: d.sha256,
        size: d.size,
      };
    });
  }
  function check(o, manifest, approved = false) {
    const docs = eligible(o);
    return manifest.map((p) => {
      const d = docs.find((d) => d.id === p.id);
      if (
        !d ||
        d.sha256 !== p.sha256 ||
        d.name !== p.name ||
        d.version !== p.version ||
        (d.revision ?? 1) !== p.revision
      )
        fail(
          409,
          "A pack document changed or was removed. Revise the pack and review again.",
        );
      if (approved && !["approved", "submitted"].includes(d.status))
        fail(409, "A pack document is no longer approved.");
      let bytes;
      try {
        bytes = readFileSync(documentPath(d));
      } catch {
        fail(
          409,
          "A pack file is unavailable. Restore or replace it before continuing.",
        );
      }
      if (createHash("sha256").update(bytes).digest("hex") !== p.sha256)
        fail(
          409,
          "A pack file’s bytes changed. Upload a new version and review it.",
        );
      return d;
    });
  }
  function save(o) {
    if (Buffer.byteLength(JSON.stringify(o)) > 1000000)
      fail(
        413,
        "This opportunity has too much pack content. Shorten supporting text or answers.",
      );
    o.revision++;
    o.updatedAt = now();
    putRecord(o);
  }
  function draft(o, b) {
    const statement = text(
      b.supportingStatement ?? "",
      50000,
      "supporting statement",
    );
    if (!Array.isArray(b.answers ?? []) || (b.answers ?? []).length > 20)
      fail(400, "Choose up to 20 application answers.");
    const answers = (b.answers || []).map((a) => ({
      question: text(a?.question, 1000, "question"),
      answer: text(a?.answer, 10000, "answer"),
    }));
    if (answers.some((a) => !a.question || !a.answer))
      fail(400, "Each application answer needs a question and answer.");
    if (typeof b.coverLetterNotRequired !== "boolean")
      fail(400, "Choose whether a cover letter is required.");
    const documents = pin(o, b.documentIds || []);
    return {
      title: text(b.title, 200, "pack title") || "Application pack",
      documents,
      supportingStatement: statement,
      answers,
      coverLetterNotRequired: b.coverLetterNotRequired,
    };
  }
  return {
    async handle(path, method, req, res, { json, readBody }) {
      const m = path.match(
        /^\/api\/opportunities\/([^/]+)\/packs(?:\/([^/]+)(?:\/(approve|submit|copy|download))?)?$/,
      );
      if (!m) return false;
      const o = getRecord(m[1]);
      o.applicationPacks ||= [];
      if (method === "GET" && !m[2]) {
        json(res, {
          opportunityRevision: o.revision,
          packs: o.applicationPacks,
          documents: eligible(o).map((d) => ({
            id: d.id,
            name: d.name,
            kind: d.kind,
            category: d.category,
            version: d.version,
            revision: d.revision ?? 1,
            status: d.status,
            url: "/api/documents/" + d.id + "/content",
          })),
        });
        return true;
      }
      if (method === "GET" && m[3] === "download") {
        const p = o.applicationPacks.find((p) => p.id === m[2]);
        if (!p) fail(404, "Application pack not found.");
        const zip = new JSZip(),
          manifest = [];
        let size = 0;
        for (const [i, entry] of p.documents.entries()) {
          const d = eligible(o).find((d) => d.id === entry.id);
          if (!d) fail(409, "A pack file is unavailable.");
          let bytes;
          try {
            bytes = readFileSync(documentPath(d));
          } catch {
            fail(409, "A pack file is unavailable.");
          }
          size += bytes.length;
          if (size > 80 * 1024 * 1024)
            fail(
              413,
              "Pack download exceeds 80 MB. Download documents individually.",
            );
          if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
            fail(409, "A pack file changed. Download refused.");
          const file =
            "documents/" +
            String(i + 1).padStart(2, "0") +
            "-" +
            basename(entry.name).replace(/[^a-zA-Z0-9._ -]/g, "_");
          zip.file(file, bytes);
          manifest.push({ ...entry, archivePath: file });
        }
        zip.file(
          "manifest.json",
          JSON.stringify({ ...p, documents: manifest }, null, 2),
        );
        zip.file("supporting-statement.txt", p.supportingStatement);
        zip.file(
          "application-answers.txt",
          p.answers
            .map((a) => a.question + "\n\n" + a.answer)
            .join("\n\n---\n\n"),
        );
        const bytes = await zip.generateAsync({
          type: "nodebuffer",
          compression: "DEFLATE",
        });
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Disposition":
            'attachment; filename="application-pack-' + p.id + '.zip"',
          "Cache-Control": "no-store",
        });
        res.end(bytes);
        return true;
      }
      const b = await readBody(req);
      const p = m[2] ? o.applicationPacks.find((p) => p.id === m[2]) : null;
      if (m[2] && !p) fail(404, "Application pack not found.");
      // A repeat click must return the original submission, without another event.
      if (method === "POST" && m[3] === "submit" && p?.state === "submitted") {
        if (b.confirm !== true) fail(400, "Confirm recording submission.");
        json(res, { opportunity: fullRecord(o), pack: p });
        return true;
      }
      if (b.revision !== o.revision)
        fail(409, "The opportunity changed. Reload before changing its pack.");
      if (method === "POST" && !m[2]) {
        if (o.applicationPacks.length >= 20)
          fail(400, "An opportunity supports up to 20 packs.");
        const p = {
          id: randomUUID(),
          ...draft(o, b),
          state: "draft",
          createdAt: now(),
          updatedAt: now(),
        };
        o.applicationPacks.push(p);
        save(o);
        json(res, { opportunity: fullRecord(o), pack: p }, 201);
        return true;
      }
      if (method === "POST" && m[3] === "copy") {
        if (o.applicationPacks.length >= 20)
          fail(400, "An opportunity supports up to 20 packs.");
        const copy = {
          id: randomUUID(),
          title: (p.title + " (revision)").slice(0, 200),
          documents: pin(
            o,
            p.documents.map((d) => d.id),
          ),
          supportingStatement: p.supportingStatement,
          answers: p.answers,
          coverLetterNotRequired: p.coverLetterNotRequired,
          state: "draft",
          createdAt: now(),
          updatedAt: now(),
          copiedFrom: p.id,
        };
        o.applicationPacks.push(copy);
        save(o);
        json(res, { opportunity: fullRecord(o), pack: copy }, 201);
        return true;
      }
      if (p?.state === "submitted")
        fail(
          409,
          "Submitted packs are preserved. Copy this pack to a new draft.",
        );
      if (method === "PATCH" && !m[3]) {
        if (p.state !== "draft")
          fail(409, "Approved packs cannot be edited. Copy to a new draft.");
        Object.assign(p, draft(o, b), { updatedAt: now() });
        save(o);
        json(res, { opportunity: fullRecord(o), pack: p });
        return true;
      }
      if (method === "DELETE" && !m[3]) {
        if (p.state !== "draft") fail(409, "Only draft packs can be removed.");
        o.applicationPacks = o.applicationPacks.filter((x) => x.id !== p.id);
        save(o);
        json(res, { opportunity: fullRecord(o) });
        return true;
      }
      if (method === "POST" && m[3] === "approve") {
        if (p.state !== "draft" || b.confirm !== true)
          fail(400, "Review a draft pack and confirm approval.");
        if (!p.documents.length && !p.supportingStatement && !p.answers.length)
          fail(400, "Add at least one document or application answer.");
        if (
          !p.coverLetterNotRequired &&
          !p.documents.some(
            (d) => d.kind === "cover" || d.category === "cover-letter",
          )
        )
          fail(400, "Include a cover letter or mark it not required.");
        const docs = check(o, p.documents);
        db.exec("BEGIN");
        try {
          for (const d of docs)
            if (d.status === "draft") {
              d.status = "approved";
              d.revision++;
              putDocument(d);
            }
          p.documents = pin(
            o,
            docs.map((d) => d.id),
          );
          p.state = "approved";
          p.approvedAt = now();
          p.updatedAt = now();
          save(o);
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
        json(res, { opportunity: fullRecord(o), pack: p });
        return true;
      }
      if (method === "POST" && m[3] === "submit") {
        if (p.state !== "approved" || b.confirm !== true)
          fail(
            400,
            "Approve the pack and confirm that you submitted it externally.",
          );
        if (o.outcome)
          fail(409, "Reopen this opportunity before recording a submission.");
        const submittedAt = text(b.submittedAt, 40, "submission date");
        if (
          !/^\d{4}-\d{2}-\d{2}T/.test(submittedAt) ||
          !Number.isFinite(Date.parse(submittedAt)) ||
          new Date(submittedAt.slice(0, 10) + "T00:00:00Z")
            .toISOString()
            .slice(0, 10) !== submittedAt.slice(0, 10)
        )
          fail(400, "Choose a valid submission date and time.");
        const applicationRoute = text(
            b.applicationRoute ?? "",
            1000,
            "application route",
          ),
          receipt = text(b.receipt ?? "", 2000, "receipt/reference");
        if (typeof b.advanceStage !== "boolean")
          fail(400, "Choose whether to move to Submitted.");
        const docs = check(o, p.documents, true);
        db.exec("BEGIN");
        try {
          for (const d of docs)
            if (d.status !== "submitted") {
              d.status = "submitted";
              d.revision++;
              putDocument(d);
            }
          p.documents = pin(
            o,
            docs.map((d) => d.id),
          );
          const event = addEvent(
            o,
            {
              note:
                "Application pack submitted: " +
                p.title +
                (applicationRoute ? " · " + applicationRoute : "") +
                (receipt ? " · Reference: " + receipt : ""),
              effectiveAt: new Date(submittedAt).toISOString(),
            },
            b.advanceStage ? "submitted" : o.stage,
          );
          event.type = "application-submission";
          event.applicationPackId = p.id;
          if (b.advanceStage) {
            o.stage = "submitted";
            o.stageEnteredAt = event.effectiveAt;
            o.currentStageEventId = event.id;
          }
          p.state = "submitted";
          p.submission = {
            submittedAt: new Date(submittedAt).toISOString(),
            recordedAt: now(),
            applicationRoute,
            receipt,
            eventId: event.id,
          };
          p.updatedAt = now();
          save(o);
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
        json(res, { opportunity: fullRecord(o), pack: p });
        return true;
      }
      fail(405, "Method not supported.");
    },
  };
}
