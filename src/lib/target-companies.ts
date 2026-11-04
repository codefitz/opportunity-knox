export type TargetCompanyTier = "dream" | "target" | "safety";
export type TargetCompanyStatus =
  | "researching"
  | "watching"
  | "reached-out"
  | "interviewing";

export type TargetCompany = {
  id: string;
  name: string;
  targetRoles: string;
  tier: TargetCompanyTier;
  status: TargetCompanyStatus;
  careersUrl: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export const TIER_LABELS: Record<TargetCompanyTier, string> = {
  dream: "Dream",
  target: "Target",
  safety: "Safety",
};

export const STATUS_LABELS: Record<TargetCompanyStatus, string> = {
  researching: "Researching",
  watching: "Watching for openings",
  "reached-out": "Outreach initiated",
  interviewing: "Interviewing",
};
