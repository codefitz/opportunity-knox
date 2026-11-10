/**
 * Conventional Machine Learning Fit Assessment Engine (Server ESM)
 *
 * Implements deterministic, local-first ML evaluation combining:
 * 1. TF-IDF & Sublinear Cosine Similarity over Candidate Career Documents vs Job Specifications
 * 2. Technical and Domain Skill Extraction, Coverage and Gap Analysis
 * 3. Title & Seniority Rank Distance Modeling
 * 4. Constraint Evaluation (Compensation & Work Arrangement)
 *
 * Runs 100% offline on CPU in <5ms without external LLM dependencies, token costs, or rate limits.
 */

import { buildKeywordRegex } from "./exclusions.mjs";
import { classifySeniority, SENIORITY_ORDER } from "./seniority.mjs";

export const ALIGNMENT_TIER_LABELS = {
  strong: "Strong match",
  moderate: "Moderate match",
  reach: "Reach / Partial",
  mismatch: "Low alignment",
  unscored: "Awaiting profile data",
};

export const COMMON_SKILLS_DICTIONARY = [
  // Languages
  "typescript", "javascript", "python", "golang", "go", "rust", "java", "kotlin",
  "c#", "c++", "c", "ruby", "php", "swift", "scala", "sql", "html", "css", "bash", "shell",
  // Frontend
  "react", "react.js", "next.js", "vue", "vue.js", "angular", "svelte", "tailwind",
  "redux", "graphql", "webpack", "vite", "sass", "web components",
  // Backend & Architecture
  "node.js", "nodejs", "express", "fastapi", "django", "spring boot", "asp.net",
  ".net", "flask", "microservices", "distributed systems", "system design", "rest", "rest api", "grpc",
  // Cloud & Infrastructure
  "aws", "amazon web services", "gcp", "google cloud", "azure", "docker", "kubernetes", "k8s",
  "terraform", "ansible", "ci/cd", "github actions", "gitlab ci", "jenkins", "helm", "linux",
  // Databases & Storage
  "postgresql", "postgres", "mysql", "sqlite", "mongodb", "redis", "elasticsearch",
  "dynamodb", "cassandra", "prisma", "kafka", "rabbitmq", "pubsub",
  // Testing & Quality
  "jest", "vitest", "cypress", "playwright", "unit testing", "integration testing", "tdd",
  // Methodologies & Practices
  "agile", "scrum", "kanban", "code review", "mentoring", "technical leadership",
  "event-driven architecture", "serverless", "cloud native", "security", "oauth",
];

const SKILL_CANONICAL_MAP = {
  "typescript": "TypeScript",
  "javascript": "JavaScript",
  "golang": "Go",
  "go": "Go",
  "react.js": "React",
  "reactjs": "React",
  "react": "React",
  "node.js": "Node.js",
  "nodejs": "Node.js",
  "next.js": "Next.js",
  "vue.js": "Vue.js",
  "vue": "Vue.js",
  "k8s": "Kubernetes",
  "kubernetes": "Kubernetes",
  "amazon web services": "AWS",
  "aws": "AWS",
  "google cloud": "GCP",
  "google cloud platform": "GCP",
  "gcp": "GCP",
  "microsoft azure": "Azure",
  "azure": "Azure",
  "postgres": "PostgreSQL",
  "postgresql": "PostgreSQL",
  ".net": ".NET",
  "dotnet": ".NET",
  "c#": "C#",
  "c++": "C++",
  "rest api": "REST API",
  "rest": "REST API",
  "ci/cd": "CI/CD",
  "cicd": "CI/CD",
  "graphql": "GraphQL",
  "docker": "Docker",
  "python": "Python",
  "java": "Java",
  "rust": "Rust",
  "kotlin": "Kotlin",
  "swift": "Swift",
  "sql": "SQL",
  "html": "HTML",
  "css": "CSS",
  "bash": "Bash",
  "shell": "Shell",
  "tailwind": "Tailwind",
  "terraform": "Terraform",
  "redis": "Redis",
  "mongodb": "MongoDB",
  "mysql": "MySQL",
  "sqlite": "SQLite",
  "kafka": "Kafka",
  "linux": "Linux",
};

const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
  "can", "could", "did", "do", "does", "doing", "down", "during", "each", "few", "for", "from",
  "further", "had", "has", "have", "having", "he", "her", "here", "hers", "herself", "him",
  "himself", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just",
  "me", "more", "most", "my", "myself", "no", "nor", "not", "now", "of", "off", "on", "once",
  "only", "or", "other", "our", "ours", "ourselves", "out", "over", "own", "same", "she",
  "should", "so", "some", "such", "than", "that", "the", "their", "theirs", "them", "themselves",
  "then", "there", "these", "they", "this", "those", "through", "to", "too", "under", "until",
  "up", "very", "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom",
  "why", "will", "with", "would", "you", "your", "yours", "yourself", "yourselves",
  "looking", "seeking", "experience", "role", "team", "join", "work", "working", "opportunity",
]);

/**
 * Tokenize and normalize text into word frequencies, including bi-grams.
 */
export function extractTermFrequencies(text) {
  if (!text || typeof text !== "string") return new Map();

  const clean = text.toLowerCase().replace(/[\r\n\t]+/g, " ");
  // Match words preserving technical identifiers like c++, .net, c#, node.js
  const tokens = clean
    .match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]{1,}/gu) || [];

  const filtered = [];
  for (const raw of tokens) {
    const trimmed = raw.replace(/^[.-]+|[.-]+$/g, "");
    if (!trimmed || trimmed.length < 2) continue;
    if (STOPWORDS.has(trimmed)) continue;
    filtered.push(trimmed);
  }

  const freqs = new Map();
  // 1. Unigrams
  for (const token of filtered) {
    freqs.set(token, (freqs.get(token) || 0) + 1);
  }

  // 2. Bigrams for phrases (e.g. "distributed systems", "system design")
  for (let i = 0; i < filtered.length - 1; i++) {
    const bigram = `${filtered[i]} ${filtered[i + 1]}`;
    freqs.set(bigram, (freqs.get(bigram) || 0) + 1.5);
  }

  return freqs;
}

/**
 * Compute sublinear TF-IDF vector for a term frequency map.
 */
export function buildTfIdfVector(termFreqs, docFreqs = new Map(), totalDocs = 1) {
  const vector = new Map();
  let sumSq = 0;

  for (const [term, freq] of termFreqs.entries()) {
    // Sublinear TF scaling: 1 + ln(freq)
    const tf = 1 + Math.log(freq);
    const df = docFreqs.get(term) || 1;
    // Smoothed inverse document frequency
    const idf = Math.log(1 + (totalDocs + 1) / (df + 1)) + 1;
    const weight = tf * idf;
    vector.set(term, weight);
    sumSq += weight * weight;
  }

  // L2-normalize vector to unit length
  const norm = Math.sqrt(sumSq) || 1;
  for (const [term, weight] of vector.entries()) {
    vector.set(term, weight / norm);
  }

  return vector;
}

/**
 * Compute Cosine Similarity between two L2-normalized vectors (0.0 to 1.0).
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA.size || !vecB.size) return 0;

  // Iterate over smaller vector for performance
  const [smaller, larger] = vecA.size <= vecB.size ? [vecA, vecB] : [vecB, vecA];
  let dotProduct = 0;

  for (const [term, valA] of smaller.entries()) {
    const valB = larger.get(term);
    if (valB !== undefined) {
      dotProduct += valA * valB;
    }
  }

  return Math.min(1, Math.max(0, dotProduct));
}

/**
 * Canonicalize skill name to clean display label.
 */
export function canonicalSkillName(raw) {
  if (!raw || typeof raw !== "string") return "";
  const lower = raw.trim().toLowerCase();
  if (SKILL_CANONICAL_MAP[lower]) return SKILL_CANONICAL_MAP[lower];
  if (raw.trim().toLowerCase() !== raw.trim() && raw.trim().toUpperCase() !== raw.trim()) {
    return raw.trim();
  }
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Extract technical and domain skills from text using boundary matching.
 */
export function extractSkills(text, customSkills = []) {
  if (!text || typeof text !== "string") return new Set();

  const found = new Set();
  const searchCorpus = COMMON_SKILLS_DICTIONARY.concat(
    customSkills.map((s) => s.toLowerCase()),
  );

  for (const skill of searchCorpus) {
    const trimmed = skill.trim();
    if (!trimmed) continue;
    try {
      const regex = buildKeywordRegex(trimmed);
      if (regex.test(text)) {
        found.add(canonicalSkillName(trimmed));
      }
    } catch {
      if (text.toLowerCase().includes(trimmed.toLowerCase())) {
        found.add(canonicalSkillName(trimmed));
      }
    }
  }

  return found;
}

/**
 * Evaluate seniority alignment distance between role and candidate targets.
 */
export function evaluateSeniorityDistance(roleSeniority, targetSeniorities = []) {
  if (!targetSeniorities?.length) return 100; // neutral if no target specified

  const roleRank = SENIORITY_ORDER[roleSeniority] || 2;
  let minDistance = 99;

  for (const target of targetSeniorities) {
    const targetRank = SENIORITY_ORDER[target] || 2;
    const dist = Math.abs(roleRank - targetRank);
    if (dist < minDistance) minDistance = dist;
  }

  if (minDistance === 0) return 100;
  if (minDistance === 1) return 80;
  if (minDistance === 2) return 50;
  return 20;
}

/**
 * Calculate title similarity using token set overlap.
 */
export function computeTitleSimilarity(role, targetTitles = []) {
  if (!role?.trim() || !targetTitles?.length) return 60;

  const roleLower = role.trim().toLowerCase();
  const roleWords = new Set(
    roleLower.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2),
  );
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

    const targetWords = new Set(
      targetLower.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2),
    );
    if (!targetWords.size) continue;

    let overlap = 0;
    for (const w of targetWords) {
      if (roleWords.has(w)) overlap++;
    }

    const score = Math.round((overlap / targetWords.size) * 100);
    bestScore = Math.max(bestScore, score);
  }

  return bestScore;
}

/**
 * Evaluate candidate fit for an opportunity using Conventional ML.
 *
 * @param {Object} opportunity - Opportunity record
 * @param {Object} candidateProfile - Unified candidate profile (targetTitles, targetSkills, careerTexts, etc.)
 * @returns {Object} Comprehensive evaluation result with score, tier, skills, strengths, gaps
 */
export function evaluateOpportunityFit(opportunity, candidateProfile = {}) {
  const role = opportunity.role || "";
  const description = opportunity.description || "";
  const combinedJobText = [role, description, ...(opportunity.tags || [])].join("\n");

  const targetTitles = candidateProfile.targetTitles || [];
  const targetSkills = candidateProfile.targetSkills || [];
  const targetSeniorities = candidateProfile.targetSeniorities || [];
  const workModes = candidateProfile.workModes || [];
  const careerTexts = candidateProfile.careerTexts || [];

  const hasTargets =
    targetTitles.length > 0 || targetSkills.length > 0 || careerTexts.length > 0;

  // 1. Skill Extraction & Overlap
  const jobSkills = extractSkills(combinedJobText, targetSkills);
  const candidateLower = new Set();
  const canonicalLookup = new Map();

  for (const s of targetSkills) {
    const c = canonicalSkillName(s);
    candidateLower.add(c.toLowerCase());
    canonicalLookup.set(c.toLowerCase(), c);
  }
  for (const ct of careerTexts) {
    for (const s of extractSkills(ct, targetSkills)) {
      candidateLower.add(s.toLowerCase());
      canonicalLookup.set(s.toLowerCase(), s);
    }
  }

  const matchedSkills = [];
  const missingSkills = [];

  for (const skill of jobSkills) {
    const lower = skill.toLowerCase();
    const display = canonicalLookup.get(lower) || skill;
    if (candidateLower.has(lower)) {
      if (!matchedSkills.includes(display)) matchedSkills.push(display);
    } else {
      if (!missingSkills.includes(display)) missingSkills.push(display);
    }
  }

  // Also include explicit target skills found in job
  for (const targetSkill of targetSkills) {
    const canonical = canonicalSkillName(targetSkill);
    const lower = canonical.toLowerCase();
    if (
      jobSkills.has(canonical) ||
      jobSkills.has(lower) ||
      combinedJobText.toLowerCase().includes(targetSkill.trim().toLowerCase())
    ) {
      if (!matchedSkills.includes(canonical)) matchedSkills.push(canonical);
    }
  }

  let skillsScore = 50;
  if (targetSkills.length > 0 && !careerTexts.length) {
    const matchedCount = targetSkills.filter((ts) =>
      matchedSkills.some((ms) => ms.toLowerCase() === ts.trim().toLowerCase()),
    ).length;
    skillsScore = Math.min(
      100,
      Math.round((matchedCount / Math.max(1, targetSkills.length)) * 100),
    );
  } else if (jobSkills.size > 0) {
    skillsScore = Math.min(
      100,
      Math.round((matchedSkills.length / Math.max(1, jobSkills.size)) * 100),
    );
  } else if (matchedSkills.length > 0) {
    skillsScore = 80;
  }

  // 2. TF-IDF Cosine Similarity over Career Documents vs Job Spec
  let tfidfScore = 50;
  let hasDocumentEvidence = false;

  if (careerTexts.length > 0) {
    hasDocumentEvidence = true;
    const combinedCareerText = careerTexts.join("\n\n");
    const careerFreqs = extractTermFrequencies(combinedCareerText);
    const jobFreqs = extractTermFrequencies(combinedJobText);

    // Boost explicit target titles & target skills in candidate vector
    for (const t of targetTitles) {
      careerFreqs.set(t.toLowerCase(), (careerFreqs.get(t.toLowerCase()) || 0) + 10);
    }
    for (const s of targetSkills) {
      careerFreqs.set(s.toLowerCase(), (careerFreqs.get(s.toLowerCase()) || 0) + 10);
    }

    const vecCareer = buildTfIdfVector(careerFreqs);
    const vecJob = buildTfIdfVector(jobFreqs);
    const rawCosine = cosineSimilarity(vecCareer, vecJob);

    // Sublinear square-root scaling for sparse IR cosine distributions
    tfidfScore = Math.min(100, Math.round(Math.sqrt(rawCosine) * 140));
  }

  // 3. Title & Seniority Rank Compatibility
  const titleScore = computeTitleSimilarity(role, targetTitles);
  const roleSeniority = opportunity.seniority || classifySeniority(role, description);
  const seniorityScore = evaluateSeniorityDistance(roleSeniority, targetSeniorities);
  const titleSeniorityScore = Math.round(titleScore * 0.5 + seniorityScore * 0.5);

  // 4. Constraints (Work Mode & Salary)
  let constraintsScore = 100;
  if (workModes.length > 0 && opportunity.workMode) {
    const oppMode = opportunity.workMode.toLowerCase();
    const matchesMode = workModes.some((m) => oppMode.includes(m.toLowerCase()));
    constraintsScore = matchesMode ? 100 : 40;
  }

  // 5. Composite Fit Scoring Formulation
  let compositeScore = 0;
  if (!hasTargets) {
    // Fresh board without profile or targets: show neutral 50% baseline with "unscored" tier
    compositeScore = 50;
  } else if (hasDocumentEvidence) {
    // Full profile with Career Library CV documents
    let totalWeight = 0.40 + 0.35 + 0.15;
    let weightedSum = tfidfScore * 0.40 + skillsScore * 0.35 + titleScore * 0.15;
    if (targetSeniorities.length > 0) {
      weightedSum += seniorityScore * 0.05;
      totalWeight += 0.05;
    }
    if (workModes.length > 0) {
      weightedSum += constraintsScore * 0.05;
      totalWeight += 0.05;
    }
    compositeScore = Math.round(weightedSum / totalWeight);
  } else {
    // Structured preferences only (no CVs uploaded yet)
    const hasSeniorityConstraint = targetSeniorities.length > 0;
    const hasWorkModeConstraint = workModes.length > 0;

    if (!hasSeniorityConstraint && !hasWorkModeConstraint) {
      compositeScore =
        targetTitles.length && targetSkills.length
          ? Math.round(titleScore * 0.5 + skillsScore * 0.5)
          : targetTitles.length
            ? titleScore
            : skillsScore;
    } else {
      let totalWeight = 0.45 + 0.30;
      let weightedSum = skillsScore * 0.45 + titleScore * 0.30;
      if (hasSeniorityConstraint) {
        weightedSum += seniorityScore * 0.15;
        totalWeight += 0.15;
      }
      if (hasWorkModeConstraint) {
        weightedSum += constraintsScore * 0.10;
        totalWeight += 0.10;
      }
      compositeScore = Math.round(weightedSum / totalWeight);
    }
  }

  compositeScore = Math.min(100, Math.max(0, compositeScore));

  // Determine Tier
  let tier = "mismatch";
  if (!hasTargets) {
    tier = "unscored";
  } else if (compositeScore >= 70) {
    tier = "strong";
  } else if (compositeScore >= 45) {
    tier = "moderate";
  } else if (compositeScore >= 25) {
    tier = "reach";
  }

  // 6. Generate Factual Strengths & Gaps
  const strengths = [];
  const gaps = [];

  if (matchedSkills.length > 0) {
    strengths.push(
      `Matches ${matchedSkills.length} core technical competencies: ${matchedSkills.slice(0, 6).join(", ")}${matchedSkills.length > 6 ? ` (+${matchedSkills.length - 6} more)` : ""}.`,
    );
  }
  if (titleScore >= 70) {
    strengths.push(`Role title directly aligns with your target job search profile (${role}).`);
  }
  if (seniorityScore >= 80 && targetSeniorities.length > 0) {
    strengths.push(`Job seniority tier matches your desired level (${roleSeniority}).`);
  }
  if (tfidfScore >= 60 && hasDocumentEvidence) {
    strengths.push(`Strong vocabulary and background relevance found in your uploaded career documents.`);
  }

  if (missingSkills.length > 0) {
    gaps.push(
      `Job listing mentions skills not found in your profile: ${missingSkills.slice(0, 5).join(", ")}${missingSkills.length > 5 ? ` (+${missingSkills.length - 5} more)` : ""}.`,
    );
  }
  if (seniorityScore < 60 && targetSeniorities.length > 0) {
    gaps.push(
      `Seniority divergence: listing is classified as ${roleSeniority}, which differs from your target tiers (${targetSeniorities.join(", ")}).`,
    );
  }
  if (!opportunity.salary) {
    gaps.push("Compensation details are not disclosed in the listing.");
  }
  if (constraintsScore < 60) {
    gaps.push(
      `Work mode (${opportunity.workMode}) may not align with your preferred arrangements (${workModes.join(", ")}).`,
    );
  }

  if (strengths.length === 0) {
    strengths.push("Job requirements are under review against your career library.");
  }
  if (gaps.length === 0) {
    gaps.push("No material skill or constraint gaps detected.");
  }

  return {
    score: compositeScore,
    tier,
    matchedSkills,
    missingSkills: missingSkills.slice(0, 10),
    strengths,
    gaps,
    breakdown: {
      tfidf: tfidfScore,
      skills: skillsScore,
      titleSeniority: titleSeniorityScore,
      constraints: constraintsScore,
    },
  };
}

const RESPONSIBILITY_ACTION_VERBS = new Set([
  "architect", "build", "collaborate", "configure", "coordinate", "create", "define",
  "deliver", "deploy", "design", "develop", "drive", "enable", "engineer", "ensure",
  "establish", "evaluate", "execute", "expand", "facilitate", "guide", "implement",
  "improve", "integrate", "launch", "lead", "maintain", "manage", "mentor", "migrate",
  "modernize", "monitor", "operate", "optimize", "oversee", "own", "partner", "plan",
  "produce", "provide", "refine", "research", "resolve", "review", "scale", "shape",
  "spearhead", "standardize", "streamline", "support", "test", "transform", "troubleshoot",
  "write",
]);

const BOILERPLATE_PATTERNS = [
  /\bequal\s+opportunity\s+employer\b/i,
  /\bwithout\s+regard\s+to\s+race\b/i,
  /\bsexual\s+orientation\b/i,
  /\bgender\s+identity\b/i,
  /\bveteran\s+status\b/i,
  /\breasonable\s+accommodation\b/i,
  /\bprivacy\s+policy\b/i,
  /\bbackground\s+check\b/i,
  /\b401\s*\(\s*k\s*\)\b/i,
  /\bdental\s+and\s+vision\b/i,
  /\bpaid\s+time\s+off\b/i,
  /\bgenerous\s+pto\b/i,
];

function isBoilerplateLine(text) {
  return BOILERPLATE_PATTERNS.some((rx) => rx.test(text));
}

function cleanBulletOrSentence(line) {
  return line
    .replace(/^[\s•*+–—-]+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generate a structured Role Summary & Breakdown using BM25 / TF-IDF statistical extraction.
 * Produces:
 *   1. ~100-word Executive Summary paragraph
 *   2. ### Top 5 Skills (5 grounded bullets)
 *   3. ### Key Responsibilities (5 grounded bullets)
 *
 * Runs 100% locally in <5ms with zero LLM dependency.
 */
export function generateStatisticalRoleSummary(opportunity, customSkills = []) {
  const role = (opportunity.role || "Role").trim();
  const company = (opportunity.company || "the organization").trim();
  const rawDescription = (opportunity.description || "").trim();

  if (!rawDescription) {
    return "";
  }

  const normalizedText = rawDescription.replace(/\r\n?/g, "\n");
  const lines = normalizedText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Split text into candidate sentences and bullet items
  const rawSegments = [];
  let currentSection = "general";

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      /^(?:#+\s*)?(?:key\s+)?(?:responsibilities|duties|what\s+you(?:'ll|\s+will)\s+do|the\s+role|day\s+to\s+day|your\s+impact|in\s+this\s+role)\b/i.test(
        lower,
      ) &&
      line.length < 90
    ) {
      currentSection = "responsibilities";
      continue;
    }
    if (
      /^(?:#+\s*)?(?:requirements|qualifications|skills|what\s+you\s+bring|who\s+you\s+are|what\s+we(?:'re|\s+are)\s+looking\s+for|minimum\s+qualifications|preferred\s+qualifications|about\s+you)\b/i.test(
        lower,
      ) &&
      line.length < 90
    ) {
      currentSection = "requirements";
      continue;
    }
    if (
      /^(?:#+\s*)?(?:benefits|perks|what\s+we\s+offer|equal\s+opportunity|eeo|compensation)\b/i.test(
        lower,
      ) &&
      line.length < 90
    ) {
      currentSection = "benefits";
      continue;
    }

    if (isBoilerplateLine(line)) continue;

    const isBullet = /^[\s]*[•*+–—-]|\d+[.)]\s/.test(line);
    if (isBullet) {
      const cleaned = cleanBulletOrSentence(line);
      if (cleaned.length >= 15) {
        rawSegments.push({
          text: cleaned,
          isBullet: true,
          section: currentSection,
          index: rawSegments.length,
        });
      }
    } else {
      // Split prose paragraph into sentences
      const sentences = line
        .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
        .map((s) => cleanBulletOrSentence(s))
        .filter((s) => s.length >= 20 && !isBoilerplateLine(s));
      for (const sent of sentences) {
        rawSegments.push({
          text: sent,
          isBullet: false,
          section: currentSection,
          index: rawSegments.length,
        });
      }
    }
  }

  // Fallback if line/sentence splitting yielded very few segments
  if (rawSegments.length === 0) {
    rawSegments.push({
      text: cleanBulletOrSentence(rawDescription.slice(0, 600)),
      isBullet: false,
      section: "general",
      index: 0,
    });
  }

  // Build BM25 corpus statistics across segments
  const N = rawSegments.length;
  const docFreqs = new Map();
  const segmentTokenMaps = [];
  const segmentLengths = [];
  let totalLength = 0;

  for (const seg of rawSegments) {
    const freqs = extractTermFrequencies(seg.text);
    segmentTokenMaps.push(freqs);
    let len = 0;
    for (const [term, count] of freqs.entries()) {
      len += count;
      docFreqs.set(term, (docFreqs.get(term) || 0) + 1);
    }
    segmentLengths.push(len);
    totalLength += len;
  }

  const avgdl = Math.max(1, totalLength / Math.max(1, N));
  const k1 = 1.5;
  const b = 0.75;

  // Compute global query term weights from the full job description + role title
  const globalFreqs = extractTermFrequencies(`${role} ${role} ${rawDescription}`);

  function scoreBM25(segIdx) {
    const freqs = segmentTokenMaps[segIdx];
    const dl = segmentLengths[segIdx] || 1;
    let score = 0;

    for (const [term, tf] of freqs.entries()) {
      const df = docFreqs.get(term) || 1;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgdl)));
      const globalBoost = Math.min(3, 1 + Math.log(globalFreqs.get(term) || 1) * 0.4);
      score += idf * tfNorm * globalBoost;
    }

    // Normalize softly by sentence length so ultra-long sentences don't dominate
    return score / Math.pow(Math.max(8, dl), 0.35);
  }

  // 1. Build ~100-word Executive Summary
  const seniority = opportunity.seniority || classifySeniority(role, rawDescription);
  const seniorityDisplay = seniority
    ? seniority.charAt(0).toUpperCase() + seniority.slice(1)
    : "";
  const metaParts = [];
  if (opportunity.location) metaParts.push(opportunity.location);
  if (opportunity.workMode) metaParts.push(opportunity.workMode);
  if (opportunity.employmentType) metaParts.push(opportunity.employmentType);
  if (opportunity.salary) metaParts.push(opportunity.salary);

  const leadPrefix = `${role} at ${company}${seniorityDisplay ? ` (${seniorityDisplay}-level)` : ""}${metaParts.length ? ` — ${metaParts.join(" · ")}` : ""}.`;

  const scoredSummaryCandidates = rawSegments
    .map((seg, i) => {
      let s = scoreBM25(i);
      // Position bonus for opening overview sentences
      if (i === 0) s *= 1.45;
      else if (i <= 3) s *= 1.25;
      if (!seg.isBullet && seg.section === "general") s *= 1.25;
      if (seg.section === "benefits") s *= 0.3;
      return { ...seg, score: s };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selectedSummarySegments = [];
  const usedSummaryFingerprints = new Set();
  let currentWords = leadPrefix.split(/\s+/).filter(Boolean).length;

  for (const cand of scoredSummaryCandidates) {
    const words = cand.text.split(/\s+/).filter(Boolean);
    if (words.length < 5) continue;
    const fp = cand.text.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
    if (usedSummaryFingerprints.has(fp)) continue;

    if (currentWords + words.length > 125 && selectedSummarySegments.length >= 2) {
      continue;
    }
    selectedSummarySegments.push(cand);
    usedSummaryFingerprints.add(fp);
    currentWords += words.length;
    if (currentWords >= 90 || selectedSummarySegments.length >= 4) break;
  }

  // Sort selected sentences back into natural document order for readability
  selectedSummarySegments.sort((a, b) => a.index - b.index);
  const summarySentences = selectedSummarySegments.map((s) => {
    const t = s.text.trim();
    return /[.!?]$/.test(t) ? t : `${t}.`;
  });

  const executiveSummary = [leadPrefix, ...summarySentences].join(" ").trim();

  // 2. Extract Top 5 Skills grounded in the text
  const extractedSkills = [...extractSkills(`${role}\n${rawDescription}`, customSkills)];
  // Rank skills by frequency & title presence in the job description
  const lowerDesc = `${role}\n${rawDescription}`.toLowerCase();
  const rankedSkills = extractedSkills
    .map((skill) => {
      const sl = skill.toLowerCase();
      let count = 0;
      let pos = lowerDesc.indexOf(sl);
      while (pos !== -1) {
        count++;
        pos = lowerDesc.indexOf(sl, pos + sl.length);
      }
      const inTitle = role.toLowerCase().includes(sl) ? 5 : 0;
      return { skill, weight: count + inTitle };
    })
    .sort((a, b) => b.weight - a.weight || a.skill.localeCompare(b.skill))
    .map((x) => x.skill);

  const topSkillsBullets = [];
  const usedSkillItems = new Set();

  for (const sk of rankedSkills) {
    if (topSkillsBullets.length >= 5) break;
    // Find a concise requirement context or use the canonical skill with grounded context
    const matchingReq = rawSegments.find(
      (seg) =>
        (seg.section === "requirements" || seg.isBullet) &&
        seg.text.toLowerCase().includes(sk.toLowerCase()) &&
        seg.text.length <= 140,
    );
    if (matchingReq && !usedSkillItems.has(matchingReq.text.toLowerCase())) {
      usedSkillItems.add(matchingReq.text.toLowerCase());
      topSkillsBullets.push(`**${sk}** — ${matchingReq.text}`);
    } else {
      topSkillsBullets.push(sk);
    }
  }

  // If fewer than 5 dictionary skills were found, supplement with requirement segments or high-IDF bigrams/terms
  if (topSkillsBullets.length < 5) {
    const reqCandidates = rawSegments.filter(
      (seg) =>
        (seg.section === "requirements" ||
          /\b(?:experience|proficiency|knowledge|degree|background|ability|skilled|expertise|familiarity)\b/i.test(
            seg.text,
          )) &&
        !usedSkillItems.has(seg.text.toLowerCase()),
    );
    for (const req of reqCandidates) {
      if (topSkillsBullets.length >= 5) break;
      const snippet = req.text.length > 140 ? `${req.text.slice(0, 137).trim()}…` : req.text;
      usedSkillItems.add(req.text.toLowerCase());
      topSkillsBullets.push(snippet);
    }
  }

  // Final fallback using top TF-IDF domain phrases from the text
  if (topSkillsBullets.length < 5) {
    const vec = buildTfIdfVector(globalFreqs);
    const topTerms = [...vec.entries()]
      .filter(([term]) => term.includes(" ") || term.length >= 4)
      .sort((a, b) => b[1] - a[1]);
    for (const [term] of topTerms) {
      if (topSkillsBullets.length >= 5) break;
      const label = canonicalSkillName(term);
      if (
        !topSkillsBullets.some((b) => b.toLowerCase().includes(label.toLowerCase()))
      ) {
        topSkillsBullets.push(label);
      }
    }
  }

  while (topSkillsBullets.length < 5) {
    topSkillsBullets.push(`Core domain competency for ${role}`);
  }

  // 3. Extract 5 Key Responsibilities grounded in the text
  const responsibilityCandidates = rawSegments
    .map((seg, i) => {
      let score = scoreBM25(i);
      const firstWord = (seg.text.match(/^[A-Za-z]+/) || [""])[0].toLowerCase();
      if (seg.section === "responsibilities") score *= 1.8;
      if (seg.isBullet) score *= 1.35;
      if (RESPONSIBILITY_ACTION_VERBS.has(firstWord)) score *= 1.5;
      if (
        /\b(?:you\s+will|responsible\s+for|lead|design|develop|manage|build|deliver|partner|own|drive|oversee)\b/i.test(
          seg.text,
        )
      ) {
        score *= 1.3;
      }
      if (seg.section === "requirements") score *= 0.65;
      if (seg.section === "benefits") score *= 0.2;
      if (usedSkillItems.has(seg.text.toLowerCase())) score *= 0.4;
      return { ...seg, respScore: score };
    })
    .sort((a, b) => b.respScore - a.respScore || a.index - b.index);

  const responsibilityBullets = [];
  const usedRespFingerprints = new Set();

  for (const cand of responsibilityCandidates) {
    if (responsibilityBullets.length >= 5) break;
    const fp = cand.text.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
    if (usedRespFingerprints.has(fp)) continue;
    usedRespFingerprints.add(fp);
    const formatted =
      cand.text.length > 160 ? `${cand.text.slice(0, 157).trim()}…` : cand.text;
    responsibilityBullets.push(formatted);
  }

  while (responsibilityBullets.length < 5 && rawSegments.length > 0) {
    const fallback = rawSegments[responsibilityBullets.length % rawSegments.length].text;
    const formatted =
      fallback.length > 160 ? `${fallback.slice(0, 157).trim()}…` : fallback;
    if (!responsibilityBullets.includes(formatted)) {
      responsibilityBullets.push(formatted);
    } else {
      responsibilityBullets.push(`Deliver core ${role} objectives at ${company}.`);
    }
  }

  return [
    executiveSummary,
    "",
    "### Top 5 Skills",
    ...topSkillsBullets.slice(0, 5).map((item) => `- ${item}`),
    "",
    "### Key Responsibilities",
    ...responsibilityBullets.slice(0, 5).map((item) => `- ${item}`),
  ].join("\n");
}

