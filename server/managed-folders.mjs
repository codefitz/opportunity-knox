import { extname } from "node:path";

/**
 * Sanitize an employer or role string into a filesystem-safe folder token.
 * Trims whitespace, replaces non-alphanumerics with single hyphens,
 * removes leading/trailing hyphens, and truncates to a reasonable length.
 */
export function sanitizeFolderToken(text, fallback = "unspecified", maxLength = 40) {
  if (typeof text !== "string") return fallback;
  const cleaned = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-zA-Z0-9]+/g, "-") // replace non-alphanumerics with -
    .replace(/^-+|-+$/g, "") // trim leading/trailing -
    .toLowerCase();
  const truncated = cleaned.slice(0, maxLength).replace(/-+$/, "");
  return truncated || fallback;
}

/**
 * Build the stable human-readable folder name for an opportunity:
 * `<stable-id>-<company>-<role>`
 */
export function opportunityFolderName(record) {
  if (!record || typeof record !== "object") {
    throw new Error("Opportunity record required to generate folder name.");
  }
  const id = record.id;
  if (!id) throw new Error("Opportunity record must have an id.");
  const company = sanitizeFolderToken(record.company, "company");
  const role = sanitizeFolderToken(record.role, "role");
  return `${id}-${company}-${role}`;
}

/**
 * Classify a document into one of the 6 managed stage subdirectories:
 * - `job-description`: Job descriptions (kind === 'jd' or category === 'job-description')
 * - `submitted`: Exact submitted documents (status === 'submitted')
 * - `approved`: Approved application documents / packs (status === 'approved')
 * - `drafts`: Working drafts, tailored CVs, cover letters (CV/cover drafts, supporting statements)
 * - `interviews`: Interview notes, prep packs, debriefs (kind === 'interview' or interview notes/tasks)
 * - `correspondence`: Offers, emails, recruiter messages, other communications
 */
export function opportunitySubdirectory({ kind, status, category, name } = {}) {
  // 1. Submitted documents always belong in submitted/
  if (status === "submitted") return "submitted";

  // 2. Approved documents belong in approved/
  if (status === "approved") return "approved";

  // 3. Job descriptions belong in job-description/
  if (kind === "jd" || category === "job-description") return "job-description";

  // 4. Interview-related materials belong in interviews/
  if (kind === "interview" || category === "star-story") return "interviews";

  // 5. Draft application materials (CVs, cover letters, supporting statements, templates)
  if (
    kind === "cv" ||
    kind === "cover" ||
    category === "master-cv" ||
    category === "tailored-cv" ||
    category === "cv" ||
    category === "cover-letter" ||
    category === "supporting-statement" ||
    category === "template"
  ) {
    return "drafts";
  }

  // 6. Default communications, offers, recruiter notes, reference attachments and correspondence
  return "correspondence";
}

/**
 * Build managed relative path for an opportunity document:
 * `${documentsSubdir}/${folderName}/${subfolder}/${id}${ext}`
 */
export function buildOpportunityDocumentPath({
  documentsSubdir = "opportunities",
  opportunity,
  documentId,
  name,
  kind,
  status,
  category,
}) {
  const folderName = opportunity ? opportunityFolderName(opportunity) : "unassigned";
  const subfolder = opportunitySubdirectory({ kind, status, category, name });
  const ext = (name ? extname(name) : "").replace(/[^.a-zA-Z0-9]/g, "");
  return `${documentsSubdir}/${folderName}/${subfolder}/${documentId}${ext}`;
}

/**
 * Check if a document is already in the expected managed stage subfolder and folder path.
 */
export function isOpportunityDocumentOrganized({
  documentsSubdir = "opportunities",
  opportunity,
  document,
}) {
  if (!document || !document.opportunityId) return true;
  const targetPath = buildOpportunityDocumentPath({
    documentsSubdir,
    opportunity,
    documentId: document.id,
    name: document.name,
    kind: document.kind,
    status: document.status,
    category: document.category,
  });
  return document.relativePath === targetPath;
}

