/**
 * Seniority Scoring and Classification Engine
 */

export type SeniorityLevel =
  | "entry"
  | "mid"
  | "senior"
  | "lead"
  | "director"
  | "executive";

export const SENIORITY_LABELS: Record<SeniorityLevel, string> = {
  entry: "Entry / Junior",
  mid: "Mid-level",
  senior: "Senior / Staff",
  lead: "Lead / Principal",
  director: "Director / Head of",
  executive: "Executive / VP",
};

export const SENIORITY_ORDER: Record<SeniorityLevel, number> = {
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

/**
 * Classifies the seniority level of an opportunity based on its role title and description.
 */
export function classifySeniority(
  role: string | null | undefined,
  description?: string | null,
): SeniorityLevel | null {
  const title = (role || "").trim();
  if (!title) return null;

  // Title matching takes primary precedence
  if (EXECUTIVE_REGEX.test(title)) return "executive";
  if (DIRECTOR_REGEX.test(title)) return "director";
  if (LEAD_REGEX.test(title)) return "lead";
  if (SENIOR_REGEX.test(title)) return "senior";
  if (ENTRY_REGEX.test(title)) return "entry";
  if (MID_REGEX.test(title)) return "mid";

  // Fallback to description analysis if title is ambiguous (e.g. "Software Engineer")
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
