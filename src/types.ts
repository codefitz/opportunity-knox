export type StageId =
  | "identification"
  | "review"
  | "documents"
  | "application-review"
  | "submitted"
  | "interviews"
  | "final-interview"
  | "outcome";
export type Stage = { id: StageId; label: string };
export type StageEvent = {
  id: string;
  stage: StageId;
  note: string;
  effectiveAt: string;
  recordedAt: string;
  corrections?: unknown[];
};
export type Activity = {
  id: string;
  kind: "interview" | "communication";
  type: string;
  title: string;
  scheduledAt: string;
  status: string;
  notes: string;
  contact: string;
  isFinal: boolean;
  createdAt: string;
  history?: unknown[];
};
export type BoardDocument = {
  id: string;
  name: string;
  kind: string;
  status: string;
  opportunityId: string | null;
  createdAt: string;
  size: number;
  version: number;
  revision?: number;
  notes: string;
  url: string;
};
export type Opportunity = {
  id: string;
  company: string;
  role: string;
  url: string;
  jobReference: string;
  location: string;
  workMode: string;
  salary: string;
  employmentType: string;
  contact: string;
  deadline: string;
  description: string;
  priority: "normal" | "high" | "low";
  nextAction: string;
  nextActionDate: string;
  tags: string[];
  stage: StageId;
  outcome: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  stageEnteredAt: string;
  events?: StageEvent[];
  activities?: Activity[];
  documents?: BoardDocument[];
};
export type Settings = {
  timezone: string;
  documentsSubdir: string;
  referenceSubdir: string;
  backupSubdir: string;
  hostDocumentsPath: string;
  storagePath: string;
  pendingHostPath: string;
  aiEnabled: boolean;
};
export type Session = {
  authenticated: boolean;
  setupRequired: boolean;
  setupTokenRequired: boolean;
};
export const STAGES: Stage[] = [
  { id: "identification", label: "Identification" },
  { id: "review", label: "Fit review" },
  { id: "documents", label: "CV & cover letter" },
  { id: "application-review", label: "Application review" },
  { id: "submitted", label: "Submitted" },
  { id: "interviews", label: "Interviews & comms" },
  { id: "final-interview", label: "Final interview" },
  { id: "outcome", label: "Outcome" },
];
export const OUTCOMES = [
  { id: "hired", label: "Hired" },
  { id: "rejected", label: "Rejected" },
  { id: "ignored", label: "Ignored" },
  { id: "withdrawn", label: "Withdrawn" },
  { id: "closed", label: "Role closed" },
];
export function stageLabel(id: string) {
  return STAGES.find((s) => s.id === id)?.label ?? id;
}
