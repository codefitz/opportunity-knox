/**
 * Seniority Scoring and Classification Engine (Server ESM)
 */

export const SENIORITY_LABELS = {
  entry: "Entry / Junior",
  mid: "Mid-level",
  senior: "Senior / Staff",
  lead: "Lead / Principal",
  director: "Director / Head of",
  executive: "Executive / VP",
};

export const SENIORITY_ORDER = {
  entry: 1,
  mid: 2,
  senior: 3,
  lead: 4,
  director: 5,
  executive: 6,
};

const EXECUTIVE_REGEX = /\b(vp|vice president|evp|svp|cto|cio|ciso|chief|founder|partner|c-level)\b/i;
const DIRECTOR_REGEX = /\b(director|head of|managing director)\b/i;
const LEAD_REGEX = /\b(lead|principal|architect|tech lead|team lead|chapter lead)\b/i;
const SENIOR_REGEX = /\b(senior|sr\.?|staff|distinguished|level 3|l5|l6)\b/i;
const ENTRY_REGEX = /\b(junior|jr\.?|graduate|grad|intern|trainee|apprentice|entry level|entry-level|associate)\b/i;
const MID_REGEX = /\b(mid-level|mid level|intermediate|specialist|level 2|l3|l4)\b/i;

export function classifySeniority(role, description) {
  const title = (role || "").trim();
  if (!title) return null;

  if (EXECUTIVE_REGEX.test(title)) return "executive";
  if (DIRECTOR_REGEX.test(title)) return "director";
  if (LEAD_REGEX.test(title)) return "lead";
  if (SENIOR_REGEX.test(title)) return "senior";
  if (ENTRY_REGEX.test(title)) return "entry";
  if (MID_REGEX.test(title)) return "mid";

  if (description) {
    const descSample = description.slice(0, 1500);
    if (EXECUTIVE_REGEX.test(descSample)) return "executive";
    if (DIRECTOR_REGEX.test(descSample)) return "director";
    if (LEAD_REGEX.test(descSample)) return "lead";
    if (SENIOR_REGEX.test(descSample)) return "senior";
    if (ENTRY_REGEX.test(descSample)) return "entry";
  }

  return null;
}
