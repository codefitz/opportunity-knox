/**
 * Candidate Profile Alignment Engine (Server ESM)
 */

import { buildKeywordRegex } from "./exclusions.mjs";
import {
  evaluateOpportunityFit,
  extractSkills,
  extractTermFrequencies,
  buildTfIdfVector,
  cosineSimilarity,
  COMMON_SKILLS_DICTIONARY,
} from "./ml-fit-engine.mjs";

export {
  evaluateOpportunityFit,
  extractSkills,
  extractTermFrequencies,
  buildTfIdfVector,
  cosineSimilarity,
  COMMON_SKILLS_DICTIONARY,
};

export const ALIGNMENT_TIER_LABELS = {
  strong: "Strong match",
  moderate: "Moderate match",
  reach: "Reach / Partial",
  mismatch: "Low alignment",
  unscored: "Awaiting profile data",
};

function normalizeWords(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

export function computeTitleSimilarity(role, targetTitles = []) {
  if (!role?.trim() || !targetTitles?.length) return 50;

  const roleLower = role.trim().toLowerCase();
  const roleTokens = normalizeWords(role);
  let bestScore = 0;

  for (const target of targetTitles) {
    const targetTrimmed = target.trim();
    if (!targetTrimmed) continue;
    const targetLower = targetTrimmed.toLowerCase();

    if (roleLower === targetLower) return 100;
    if (roleLower.includes(targetLower) || targetLower.includes(roleLower)) {
      bestScore = Math.max(bestScore, 90);
      continue;
    }

    const targetTokens = normalizeWords(targetTrimmed);
    if (!targetTokens.size) continue;

    let overlap = 0;
    for (const token of targetTokens) {
      if (roleTokens.has(token)) overlap++;
    }

    const similarity = (overlap / targetTokens.size) * 100;
    bestScore = Math.max(bestScore, Math.round(similarity));
  }

  return bestScore;
}

export function computeSkillsMatch(text, targetSkills = []) {
  if (!text?.trim() || !targetSkills?.length) {
    return { score: 50, matchedSkills: [] };
  }

  const matchedSkills = [];
  for (const skill of targetSkills) {
    const trimmed = skill.trim();
    if (!trimmed) continue;
    try {
      const regex = buildKeywordRegex(trimmed);
      if (regex.test(text)) {
        matchedSkills.push(trimmed);
      }
    } catch {
      if (text.toLowerCase().includes(trimmed.toLowerCase())) {
        matchedSkills.push(trimmed);
      }
    }
  }

  const validSkillsCount = targetSkills.filter((s) => s.trim().length > 0).length;
  if (!validSkillsCount) return { score: 50, matchedSkills: [] };

  const score = Math.min(100, Math.round((matchedSkills.length / validSkillsCount) * 100));
  return { score, matchedSkills };
}

export function calculateAlignment(
  opportunity,
  targetTitlesOrProfile = [],
  targetSkills = [],
  extraOptions = {},
) {
  // Support passing candidate fit profile object or discrete arguments
  const profile =
    typeof targetTitlesOrProfile === "object" && !Array.isArray(targetTitlesOrProfile)
      ? targetTitlesOrProfile
      : {
          targetTitles: Array.isArray(targetTitlesOrProfile) ? targetTitlesOrProfile : [],
          targetSkills: Array.isArray(targetSkills) ? targetSkills : [],
          ...extraOptions,
        };

  const hasTargets =
    (profile.targetTitles && profile.targetTitles.length > 0) ||
    (profile.targetSkills && profile.targetSkills.length > 0) ||
    (profile.careerTexts && profile.careerTexts.length > 0);

  if (!hasTargets) {
    return { score: 0, tier: "mismatch", matchedSkills: [], missingSkills: [] };
  }

  return evaluateOpportunityFit(opportunity, profile);
}
