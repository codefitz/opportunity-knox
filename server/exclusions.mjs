/**
 * Negative / Exclusion Keywords Engine (Server ESM)
 */

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildKeywordRegex(keyword) {
  const trimmed = keyword.trim();
  const escaped = escapeRegex(trimmed);
  const startBoundary = /^\w/.test(trimmed) ? "\\b" : "";
  const endBoundary = /\w$/.test(trimmed) ? "\\b" : "";
  return new RegExp(`${startBoundary}${escaped}${endBoundary}`, "i");
}

export function findExclusionMatches(text, keywords = []) {
  if (!text || !keywords?.length) return [];
  const matches = [];

  for (const raw of keywords) {
    const kw = raw.trim();
    if (!kw) continue;
    try {
      const regex = buildKeywordRegex(kw);
      if (regex.test(text)) {
        matches.push(kw);
      }
    } catch {
      if (text.toLowerCase().includes(kw.toLowerCase())) {
        matches.push(kw);
      }
    }
  }

  return [...new Set(matches)];
}

export function checkOpportunityExclusions(opportunity, keywords = []) {
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
