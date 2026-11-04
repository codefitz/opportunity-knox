/**
 * Candidate Profile Alignment Engine
 * Computes match percentage and alignment tiers between opportunity requirements and candidate target profile.
 */

import { buildKeywordRegex } from "./exclusions.ts";

export type AlignmentTier = "strong" | "moderate" | "reach" | "mismatch";

export const ALIGNMENT_TIER_LABELS: Record<AlignmentTier, string> = {
  strong: "Strong match",
  moderate: "Moderate match",
  reach: "Reach / Partial",
  mismatch: "Low alignment",
};

function normalizeWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

export function computeTitleSimilarity(role: string, targetTitles: string[] = []): number {
  if (!role?.trim() || !targetTitles?.length) return 50;

  const roleLower = role.trim().toLowerCase();
  const roleTokens = normalizeWords(role);
  let bestScore = 0;

  for (const target of targetTitles) {
    const targetTrimmed = target.trim();
    if (!targetTrimmed) continue;
    const targetLower = targetTrimmed.toLowerCase();

    // Exact or substring match
    if (roleLower === targetLower) return 100;
    if (roleLower.includes(targetLower) || targetLower.includes(roleLower)) {
      bestScore = Math.max(bestScore, 90);
      continue;
    }

    // Token set overlap
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

export function computeSkillsMatch(
  text: string,
  targetSkills: string[] = [],
): { score: number; matchedSkills: string[] } {
  if (!text?.trim() || !targetSkills?.length) {
    return { score: 50, matchedSkills: [] };
  }

  const matchedSkills: string[] = [];
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
  opportunity: { role?: string; description?: string; tags?: string[] },
  targetTitles: string[] = [],
  targetSkills: string[] = [],
): {
  score: number;
  tier: AlignmentTier;
  matchedSkills: string[];
} {
  const role = opportunity.role || "";
  const combinedText = [
    opportunity.role || "",
    opportunity.description || "",
    ...(opportunity.tags || []),
  ].join(" \n ");

  const hasTargets = targetTitles.length > 0 || targetSkills.length > 0;
  if (!hasTargets) {
    return { score: 0, tier: "mismatch", matchedSkills: [] };
  }

  const titleScore = targetTitles.length > 0 ? computeTitleSimilarity(role, targetTitles) : 50;
  const { score: skillsScore, matchedSkills } =
    targetSkills.length > 0 ? computeSkillsMatch(combinedText, targetSkills) : { score: 50, matchedSkills: [] };

  const finalScore =
    targetTitles.length && targetSkills.length
      ? Math.round(titleScore * 0.5 + skillsScore * 0.5)
      : targetTitles.length
        ? titleScore
        : skillsScore;

  let tier: AlignmentTier = "mismatch";
  if (finalScore >= 75) tier = "strong";
  else if (finalScore >= 45) tier = "moderate";
  else if (finalScore >= 25) tier = "reach";

  return {
    score: finalScore,
    tier,
    matchedSkills,
  };
}
