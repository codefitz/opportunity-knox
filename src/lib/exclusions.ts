/**
 * Negative / Exclusion Keywords Engine
 * Detects unwanted terms, contract types, clearance requirements, or tech stacks in job postings.
 */

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildKeywordRegex(keyword: string): RegExp {
  const trimmed = keyword.trim();
  const escaped = escapeRegex(trimmed);
  // If term starts/ends with alphanumeric characters, apply word boundary \b
  const startBoundary = /^\w/.test(trimmed) ? "\\b" : "";
  const endBoundary = /\w$/.test(trimmed) ? "\\b" : "";
  return new RegExp(`${startBoundary}${escaped}${endBoundary}`, "i");
}

/**
 * Checks a text block against a list of exclusion keywords.
 * Returns the matching keywords in original list casing.
 */
export function findExclusionMatches(
  text: string | null | undefined,
  keywords: string[] = [],
): string[] {
  if (!text || !keywords?.length) return [];
  const matches: string[] = [];

  for (const raw of keywords) {
    const kw = raw.trim();
    if (!kw) continue;
    try {
      const regex = buildKeywordRegex(kw);
      if (regex.test(text)) {
        matches.push(kw);
      }
    } catch {
      // Fallback to substring matching if regex build fails
      if (text.toLowerCase().includes(kw.toLowerCase())) {
        matches.push(kw);
      }
    }
  }

  return [...new Set(matches)];
}

/**
 * Checks an entire opportunity's fields against exclusion keywords.
 */
export function checkOpportunityExclusions(
  opportunity: {
    role?: string;
    company?: string;
    description?: string;
    tags?: string[];
    employmentType?: string;
    applicationRoute?: string;
  },
  keywords: string[] = [],
): string[] {
  if (!keywords?.length) return [];

  const combined = [
    opportunity.role || "",
    opportunity.description || "",
    opportunity.employmentType || "",
    opportunity.applicationRoute || "",
    ...(opportunity.tags || []),
  ].join(" \n ");

  return findExclusionMatches(combined, keywords);
}
