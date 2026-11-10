import type { Opportunity } from "../types.ts";

export type TitleGroupAssignment = {
  key: string;
  label: string;
  archetypeId: string | null;
  matchMethod: "keyword" | "keyword+semantic";
};

export type TitleGroupResponse = {
  groups: {
    key: string;
    label: string;
    archetypeId: string | null;
    matchMethod: "keyword" | "keyword+semantic";
    variants: string[];
    opportunityIds: string[];
    count: number;
  }[];
  assignments: Record<string, TitleGroupAssignment>;
  model: string;
  usedEmbeddings: boolean;
};

export type TitleGroupCluster = {
  key: string;
  label: string;
  archetypeId: string | null;
  matchMethod: "keyword" | "keyword+semantic";
  variants: string[];
  items: Opportunity[];
};

export const TITLE_SYNONYM_MAP: Record<string, string> = {
  swe: "software engineer",
  sde: "software engineer",
  sdet: "qa automation engineer",
  fe: "frontend",
  "front-end": "frontend",
  "front end": "frontend",
  be: "backend",
  "back-end": "backend",
  "back end": "backend",
  fs: "fullstack",
  "full-stack": "fullstack",
  "full stack": "fullstack",
  sre: "site reliability engineer",
  devops: "devops",
  devsecops: "devops security",
  mle: "machine learning engineer",
  ml: "machine learning",
  ai: "artificial intelligence",
  genai: "artificial intelligence",
  llm: "artificial intelligence",
  nlp: "machine learning",
  qa: "quality assurance",
  "ui/ux": "product design",
  "ux/ui": "product design",
  ux: "user experience design",
  ui: "user interface design",
  pm: "product manager",
  tpm: "technical program manager",
  em: "engineering manager",
  sdm: "software development manager",
  tlm: "tech lead manager",
  tam: "technical account manager",
  fde: "forward deployed engineer",
  mts: "member of technical staff",
  bi: "business intelligence",
  infosec: "information security",
  appsec: "application security",
  cybersecurity: "security",
  secops: "security operations",
  revops: "revenue operations",
  hrbp: "hr business partner",
  dba: "database administrator",
  k8s: "kubernetes",
  programmer: "developer",
};

export type RoleArchetype = {
  id: string;
  canonicalTitle: string;
  category: "executive" | "management" | "ic";
  patterns: RegExp[];
  exclude?: RegExp;
};

export const ROLE_ARCHETYPES: RoleArchetype[] = [
  {
    id: "engineering-executive",
    canonicalTitle: "Engineering Leadership (VP / Director / CTO)",
    category: "executive",
    patterns: [
      /\b(?:cto|chief\s+technology\s+officer|chief\s+architect|vp\s+(?:of\s+)?engineering|vice\s+president\s+(?:of\s+)?engineering|vp\s+(?:of\s+)?software|director\s+(?:of\s+)?engineering|engineering\s+director|head\s+of\s+engineering|head\s+of\s+technology|head\s+of\s+software)\b/i,
    ],
  },
  {
    id: "engineering-manager",
    canonicalTitle: "Engineering Manager",
    category: "management",
    patterns: [
      /\b(?:engineering\s+manager|software\s+engineering\s+manager|software\s+development\s+manager|development\s+manager|application\s+development\s+manager|platform\s+engineering\s+manager|infrastructure\s+manager|qa\s+manager|data\s+engineering\s+manager|machine\s+learning\s+manager|tech\s+lead\s+manager|engineering\s+team\s+lead|chapter\s+lead|\bem\b|\bsdm\b|\btlm\b)\b/i,
    ],
  },
  {
    id: "product-leadership",
    canonicalTitle: "Product Leadership (VP / Director / Head)",
    category: "executive",
    patterns: [
      /\b(?:cpo|chief\s+product\s+officer|vp\s+(?:of\s+)?product|vice\s+president\s+(?:of\s+)?product|director\s+(?:of\s+)?product|product\s+director|head\s+of\s+product|group\s+product\s+manager)\b/i,
    ],
  },
  {
    id: "product-manager",
    canonicalTitle: "Product Manager",
    category: "ic",
    patterns: [
      /\b(?:product\s+manager|product\s+owner|technical\s+product\s+manager|ai\s+product\s+manager|data\s+product\s+manager|platform\s+product\s+manager|growth\s+product\s+manager|digital\s+product\s+manager|\bpm\b)\b/i,
    ],
    exclude: /\b(?:project|program|programme|delivery|marketing)\b/i,
  },
  {
    id: "program-delivery-manager",
    canonicalTitle: "Program & Delivery Manager",
    category: "ic",
    patterns: [
      /\b(?:technical\s+program\s+manager|program\s+manager|programme\s+manager|project\s+manager|delivery\s+manager|delivery\s+lead|agile\s+delivery|scrum\s+master|agile\s+coach|release\s+manager|\btpm\b|pmo)\b/i,
    ],
  },
  {
    id: "solutions-architect",
    canonicalTitle: "Solutions & Systems Architect",
    category: "ic",
    patterns: [
      /\b(?:solutions?\s+architect|enterprise\s+architect|cloud\s+architect|software\s+architect|systems?\s+architect|technical\s+architect|data\s+architect|security\s+architect|platform\s+architect|infrastructure\s+architect|principal\s+architect|application\s+architect|domain\s+architect|ai\s+architect)\b/i,
    ],
  },
  {
    id: "ai-ml-engineer",
    canonicalTitle: "AI & Machine Learning Engineer",
    category: "ic",
    patterns: [
      /\b(?:machine\s+learning\s+engineer|ml\s+engineer|ai\s+engineer|artificial\s+intelligence\s+engineer|applied\s+ai|llm\s+engineer|genai\s+engineer|deep\s+learning\s+engineer|nlp\s+engineer|computer\s+vision\s+engineer|mlops\s+engineer|\bmle\b|ai\s+developer|machine\s+learning\s+developer)\b/i,
    ],
  },
  {
    id: "data-scientist",
    canonicalTitle: "Data & Applied Scientist",
    category: "ic",
    patterns: [
      /\b(?:data\s+scientist|applied\s+scientist|decision\s+scientist|research\s+scientist|quantitative\s+researcher|quant\s+researcher|machine\s+learning\s+scientist|ai\s+researcher|statistician)\b/i,
    ],
  },
  {
    id: "data-engineer",
    canonicalTitle: "Data & Analytics Engineer",
    category: "ic",
    patterns: [
      /\b(?:data\s+engineer|analytics\s+engineer|big\s+data\s+engineer|etl\s+developer|etl\s+engineer|data\s+platform\s+engineer|data\s+warehouse\s+engineer|database\s+engineer|database\s+administrator|\bdba\b)\b/i,
    ],
  },
  {
    id: "data-analyst",
    canonicalTitle: "Data & BI Analyst",
    category: "ic",
    patterns: [
      /\b(?:data\s+analyst|business\s+intelligence|bi\s+analyst|bi\s+developer|product\s+analyst|analytics\s+analyst|insights\s+analyst|reporting\s+analyst|quantitative\s+analyst|marketing\s+analyst|financial\s+analyst|operations\s+analyst|business\s+analyst)\b/i,
    ],
  },
  {
    id: "platform-devops-sre",
    canonicalTitle: "Platform, DevOps & SRE",
    category: "ic",
    patterns: [
      /\b(?:site\s+reliability\s+engineer|site\s+reliability|\bsre\b|devops\s+engineer|devops|devsecops|platform\s+engineer|cloud\s+engineer|infrastructure\s+engineer|cloud\s+infrastructure|systems\s+engineer|kubernetes\s+engineer|linux\s+engineer|network\s+engineer|build\s+engineer|release\s+engineer|systems\s+administrator|sysadmin)\b/i,
    ],
  },
  {
    id: "security-engineer",
    canonicalTitle: "Security & InfoSec Engineer",
    category: "ic",
    patterns: [
      /\b(?:security\s+engineer|cybersecurity|information\s+security|infosec|application\s+security|appsec|cloud\s+security|security\s+analyst|soc\s+analyst|penetration\s+tester|ethical\s+hacker|ciso|head\s+of\s+security|security\s+consultant|secops)\b/i,
    ],
  },
  {
    id: "frontend-engineer",
    canonicalTitle: "Frontend Engineer",
    category: "ic",
    patterns: [
      /\b(?:front[- ]?end\s+engineer|front[- ]?end\s+developer|ui\s+engineer|ui\s+developer|web\s+developer|react\s+developer|react\s+engineer|angular\s+developer|vue\s+developer|javascript\s+developer|typescript\s+front[- ]?end|front[- ]?end\s+software\s+engineer)\b/i,
    ],
  },
  {
    id: "backend-engineer",
    canonicalTitle: "Backend Engineer",
    category: "ic",
    patterns: [
      /\b(?:back[- ]?end\s+engineer|back[- ]?end\s+developer|back[- ]?end\s+software\s+engineer|api\s+engineer|server\s+engineer|distributed\s+systems\s+engineer|golang\s+engineer|go\s+engineer|java\s+engineer|java\s+developer|python\s+engineer|python\s+developer|rust\s+engineer|node\.?js\s+developer|node\.?js\s+engineer|c\+\+\s+engineer|\.net\s+developer|\.net\s+engineer|c#\s+developer|ruby\s+engineer|scala\s+engineer)\b/i,
    ],
  },
  {
    id: "fullstack-engineer",
    canonicalTitle: "Full-Stack Engineer",
    category: "ic",
    patterns: [
      /\b(?:full[- ]?stack\s+engineer|full[- ]?stack\s+developer|full[- ]?stack\s+software\s+engineer|web\s+application\s+engineer)\b/i,
    ],
  },
  {
    id: "mobile-engineer",
    canonicalTitle: "Mobile Engineer",
    category: "ic",
    patterns: [
      /\b(?:mobile\s+engineer|mobile\s+developer|ios\s+engineer|ios\s+developer|android\s+engineer|android\s+developer|react\s+native\s+developer|react\s+native\s+engineer|flutter\s+developer|flutter\s+engineer|swift\s+engineer|kotlin\s+android)\b/i,
    ],
  },
  {
    id: "qa-test-engineer",
    canonicalTitle: "QA & Test Engineer",
    category: "ic",
    patterns: [
      /\b(?:qa\s+engineer|quality\s+assurance|test\s+engineer|\bsdet\b|software\s+development\s+engineer\s+in\s+test|automation\s+test|test\s+automation|quality\s+engineer)\b/i,
    ],
  },
  {
    id: "solutions-customer-engineer",
    canonicalTitle: "Solutions & Customer Engineer",
    category: "ic",
    patterns: [
      /\b(?:solutions?\s+engineer|sales\s+engineer|pre[- ]?sales\s+engineer|forward\s+deployed\s+engineer|\bfde\b|customer\s+engineer|field\s+engineer|technical\s+account\s+manager|\btam\b|implementation\s+engineer|integration\s+engineer|partner\s+engineer|developer\s+advocate|developer\s+relations|devrel)\b/i,
    ],
  },
  {
    id: "product-ux-designer",
    canonicalTitle: "Product & UX Designer",
    category: "ic",
    patterns: [
      /\b(?:product\s+designer|ux\s+designer|ui\s+designer|ui\/ux|ux\/ui|interaction\s+designer|visual\s+designer|user\s+researcher|ux\s+researcher|design\s+lead|head\s+of\s+design|design\s+systems\s+designer)\b/i,
    ],
  },
  {
    id: "software-engineer",
    canonicalTitle: "Software Engineer",
    category: "ic",
    patterns: [
      /\b(?:software\s+engineer|software\s+developer|application\s+engineer|application\s+developer|systems\s+developer|member\s+of\s+technical\s+staff|\bmts\b|\bswe\b|\bsde\b|r&d\s+engineer|founding\s+engineer|tech\s+lead|technical\s+lead|staff\s+engineer|principal\s+engineer|lead\s+engineer|lead\s+developer|software\s+programmer)\b/i,
    ],
    exclude: /\b(?:manager|director|vp|vice\s+president|chief|cto|sales|marketing|recruiter)\b/i,
  },
  {
    id: "customer-success-sales",
    canonicalTitle: "Customer Success & Account Management",
    category: "ic",
    patterns: [
      /\b(?:customer\s+success|account\s+executive|account\s+manager|client\s+partner|client\s+relationship|sales\s+manager|sales\s+director|business\s+development|revenue\s+operations|revops|sales\s+operations|partnerships\s+manager|commercial\s+manager)\b/i,
    ],
  },
  {
    id: "operations-strategy",
    canonicalTitle: "Operations, Strategy & Consulting",
    category: "ic",
    patterns: [
      /\b(?:chief\s+operating\s+officer|\bcoo\b|head\s+of\s+operations|operations\s+manager|strategy\s+manager|chief\s+of\s+staff|management\s+consultant|strategy\s+consultant|transformation\s+lead|change\s+manager|business\s+operations|bizops)\b/i,
    ],
  },
  {
    id: "people-talent",
    canonicalTitle: "People, Talent & HR",
    category: "ic",
    patterns: [
      /\b(?:people\s+partner|people\s+operations|hr\s+business\s+partner|\bhrbp\b|talent\s+acquisition|technical\s+recruiter|recruiter|head\s+of\s+people|hr\s+manager|human\s+resources)\b/i,
    ],
  },
];

const GENERIC_HEAD_NOUNS = new Set([
  "engineer",
  "developer",
  "manager",
  "director",
  "lead",
  "leader",
  "specialist",
  "analyst",
  "consultant",
  "architect",
  "officer",
  "head",
  "vp",
  "partner",
  "coordinator",
  "associate",
  "scientist",
  "designer",
  "administrator",
  "executive",
]);

const SENIORITY_PREFIX_STOPWORDS = new Set([
  "junior",
  "jr",
  "senior",
  "sr",
  "staff",
  "principal",
  "distinguished",
  "associate",
  "mid",
  "midlevel",
  "intermediate",
  "entry",
  "graduate",
  "grad",
  "intern",
  "trainee",
  "apprentice",
  "lead",
]);

export function cleanRoleTitle(raw?: string | null): string {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.trim();

  s = s.replace(
    /\s*[\(\[][^)\]]*(?:remote|hybrid|onsite|on-site|uk|us|usa|eu|emea|apac|london|manchester|dublin|berlin|new york|contract|ftc|full[- ]?time|part[- ]?time|m\/f\/d|f\/m\/x|d\/f\/m|gn|all\s+genders|req\s*#?\d+|\d+\s*months?)[^)\]]*[\)\]]/gi,
    "",
  );
  s = s.replace(/\s*\((?:m\/f\/d|f\/m\/d|gn|all\s+genders|\d+)\)/gi, "");
  s = s.replace(
    /\s+[-–—|/]\s+(?:remote|hybrid|onsite|on-site|uk|us|usa|emea|london|contract|ftc|full[- ]?time|part[- ]?time|\d+\s*months?.*)$/i,
    "",
  );

  return s.replace(/\s+/g, " ").trim();
}

export function extractCoreRoleTitle(raw?: string | null): string {
  const cleaned = cleanRoleTitle(raw);
  if (!cleaned) return "";

  let s = cleaned;
  s = s.replace(
    /^(?:(?:junior|jr\.?|senior|sr\.?|staff|principal|distinguished|associate|mid[- ]?level|entry[- ]?level|graduate|intern|trainee)\s+)+/i,
    "",
  );
  if (
    /^lead\s+(?:.+\s+)?(?:engineer|developer|scientist|designer|architect|analyst|consultant|specialist|researcher|programmer|administrator|associate|coordinator)\b/i.test(
      s,
    )
  ) {
    s = s.replace(/^lead\s+/i, "");
  }

  s = s.replace(/\s+(?:level\s*\d+|grade\s*\d+|l[2-8]|i{1,3}|iv|v)$/i, "");

  const commaParts = s.split(/\s*[,–—|]\s*/);
  if (commaParts.length > 1 && commaParts[0].split(/\s+/).length >= 2) {
    s = commaParts[0];
  }

  return s.replace(/\s+/g, " ").trim() || cleaned;
}

export function formatCanonicalTitle(raw?: string | null): string {
  if (!raw || typeof raw !== "string" || !raw.trim()) return "Unspecified role";
  const upperAcronyms = new Set([
    "ai", "ml", "sre", "qa", "ui", "ux", "vp", "svp", "evp", "cto", "cio",
    "ciso", "cpo", "coo", "ceo", "bi", "api", "aws", "gcp", "sql", "etl",
    "llm", "nlp", "hr", "it", "r&d", "uk", "us", "eu", "emea", "sdm", "tpm",
  ]);
  const lowerConnectors = new Set(["of", "and", "in", "for", "to", "at", "on", "with"]);

  return raw
    .trim()
    .split(/\s+/)
    .map((word, idx) => {
      const lower = word.toLowerCase();
      if (lower === "ios") return "iOS";
      if (lower === "devops") return "DevOps";
      if (lower === "devsecops") return "DevSecOps";
      if (lower === "mlops") return "MLOps";
      if (lower === "infosec") return "InfoSec";
      if (lower === "appsec") return "AppSec";
      if (lower === "genai") return "GenAI";
      if (lower === "fullstack" || lower === "full-stack") return "Full-Stack";
      if (upperAcronyms.has(lower)) return lower.toUpperCase();
      if (idx > 0 && lowerConnectors.has(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

export function classifyRoleCategory(raw?: string | null): "executive" | "management" | "ic" {
  const s = (raw || "").toLowerCase();
  if (
    /\b(?:cto|cio|ciso|cpo|coo|ceo|chief|vp|vice\s+president|svp|evp|director|head\s+of)\b/.test(
      s,
    )
  ) {
    return "executive";
  }
  if (
    /\b(?:engineering\s+manager|development\s+manager|software\s+manager|team\s+lead|chapter\s+lead|people\s+manager|qa\s+manager|\bsdm\b|\btlm\b)\b/.test(
      s,
    )
  ) {
    return "management";
  }
  return "ic";
}

export function matchRoleArchetype(raw?: string | null): RoleArchetype | null {
  const cleaned = cleanRoleTitle(raw);
  const core = extractCoreRoleTitle(raw);
  if (!cleaned) return null;

  const expanded = `${cleaned} ${core}`;
  for (const archetype of ROLE_ARCHETYPES) {
    if (archetype.exclude && archetype.exclude.test(cleaned)) {
      continue;
    }
    for (const pattern of archetype.patterns) {
      if (pattern.test(cleaned) || pattern.test(core) || pattern.test(expanded)) {
        return archetype;
      }
    }
  }
  return null;
}

export function canonicalizeRoleTokens(raw?: string | null): string[] {
  const core = extractCoreRoleTitle(raw).toLowerCase();
  if (!core) return [];

  const normalized = core
    .replace(/\bfront[- ]end\b/g, "frontend")
    .replace(/\bback[- ]end\b/g, "backend")
    .replace(/\bfull[- ]stack\b/g, "fullstack")
    .replace(/\bui\/ux\b|\bux\/ui\b/g, "product design")
    .replace(/[^a-z0-9+#.\s-]/g, " ");

  const rawWords = normalized.split(/\s+/).filter(Boolean);
  const tokens: string[] = [];

  for (const w of rawWords) {
    const cleanWord = w.replace(/^[.-]+|[.-]+$/g, "");
    if (!cleanWord || cleanWord.length < 2) continue;
    if (SENIORITY_PREFIX_STOPWORDS.has(cleanWord)) continue;
    if (["and", "the", "for", "with", "of", "in", "at", "to", "or"].includes(cleanWord)) {
      continue;
    }
    const mapped = TITLE_SYNONYM_MAP[cleanWord] || cleanWord;
    for (const part of mapped.split(/\s+/)) {
      if (part && !SENIORITY_PREFIX_STOPWORDS.has(part)) {
        tokens.push(part);
      }
    }
  }

  return [...new Set(tokens)];
}

export function computeTitleKeywordSimilarity(roleA?: string | null, roleB?: string | null): number {
  const cleanA = cleanRoleTitle(roleA);
  const cleanB = cleanRoleTitle(roleB);
  if (!cleanA && !cleanB) return 1;
  if (!cleanA || !cleanB) return 0;

  if (cleanA.toLowerCase() === cleanB.toLowerCase()) return 1;

  const coreA = extractCoreRoleTitle(roleA).toLowerCase();
  const coreB = extractCoreRoleTitle(roleB).toLowerCase();
  if (coreA && coreB && coreA === coreB) return 0.96;

  const archA = matchRoleArchetype(roleA);
  const archB = matchRoleArchetype(roleB);

  if (archA && archB) {
    if (archA.id === archB.id) return 0.92;
    return 0.15;
  }

  const catA = classifyRoleCategory(roleA);
  const catB = classifyRoleCategory(roleB);
  if (catA !== catB) return 0.1;

  const tokensA = canonicalizeRoleTokens(roleA);
  const tokensB = canonicalizeRoleTokens(roleB);
  if (!tokensA.length || !tokensB.length) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let sharedSpecific = 0;
  let sharedGeneric = 0;

  for (const t of setA) {
    if (setB.has(t)) {
      if (GENERIC_HEAD_NOUNS.has(t)) sharedGeneric++;
      else sharedSpecific++;
    } else {
      for (const tb of setB) {
        if (
          t.length >= 5 &&
          tb.length >= 5 &&
          (t.startsWith(tb.slice(0, 5)) || tb.startsWith(t.slice(0, 5)))
        ) {
          if (GENERIC_HEAD_NOUNS.has(t) || GENERIC_HEAD_NOUNS.has(tb)) {
            sharedGeneric += 0.7;
          } else {
            sharedSpecific += 0.85;
          }
          break;
        }
      }
    }
  }

  if (sharedSpecific === 0) {
    return sharedGeneric > 0 ? 0.18 : 0;
  }

  const totalUniqueSpecific =
    [...new Set([...tokensA, ...tokensB])].filter((t) => !GENERIC_HEAD_NOUNS.has(t))
      .length || 1;
  const specificJaccard = sharedSpecific / totalUniqueSpecific;
  const dice = (2 * (sharedSpecific + sharedGeneric * 0.5)) / (setA.size + setB.size);

  return Math.min(0.95, Math.max(specificJaccard * 0.85, dice));
}

export function groupOpportunitiesByTitle(
  opportunities: Opportunity[],
  semanticAssignments?: Record<string, TitleGroupAssignment> | null,
  sortDirection?: "asc" | "desc" | null,
): TitleGroupCluster[] {
  const clusters: {
    key: string;
    label: string;
    archetypeId: string | null;
    category: "executive" | "management" | "ic";
    representativeRole: string;
    matchMethod: "keyword" | "keyword+semantic";
    items: Opportunity[];
    variants: Set<string>;
  }[] = [];

  for (const opp of opportunities) {
    const rawRole = (opp.role || "").trim();
    const sem = semanticAssignments?.[opp.id];

    if (sem && sem.key) {
      let existing = clusters.find((c) => c.key === sem.key);
      if (!existing) {
        existing = {
          key: sem.key,
          label: sem.label,
          archetypeId: sem.archetypeId,
          category: classifyRoleCategory(rawRole),
          representativeRole: extractCoreRoleTitle(rawRole) || rawRole,
          matchMethod: sem.matchMethod || "keyword+semantic",
          items: [],
          variants: new Set(),
        };
        clusters.push(existing);
      } else if (sem.matchMethod === "keyword+semantic") {
        existing.matchMethod = "keyword+semantic";
      }
      existing.items.push(opp);
      if (rawRole) {
        existing.variants.add(cleanRoleTitle(rawRole) || rawRole);
      }
      continue;
    }

    if (!rawRole) {
      let unspec = clusters.find((c) => c.key === "__unspecified__");
      if (!unspec) {
        unspec = {
          key: "__unspecified__",
          label: "Unspecified role",
          archetypeId: null,
          category: "ic",
          representativeRole: "",
          matchMethod: "keyword",
          items: [],
          variants: new Set(),
        };
        clusters.push(unspec);
      }
      unspec.items.push(opp);
      continue;
    }

    const arch = matchRoleArchetype(rawRole);
    const coreRole = extractCoreRoleTitle(rawRole);
    const category = arch?.category || classifyRoleCategory(rawRole);

    if (arch) {
      let existing = clusters.find((c) => c.archetypeId === arch.id);
      if (!existing) {
        existing = {
          key: `arch:${arch.id}`,
          label: arch.canonicalTitle,
          archetypeId: arch.id,
          category,
          representativeRole: coreRole || rawRole,
          matchMethod: "keyword",
          items: [],
          variants: new Set(),
        };
        clusters.push(existing);
      }
      existing.items.push(opp);
      existing.variants.add(cleanRoleTitle(rawRole) || rawRole);
      continue;
    }

    let bestCluster: (typeof clusters)[0] | null = null;
    let bestScore = 0;

    for (const cluster of clusters) {
      if (cluster.key === "__unspecified__") continue;
      if (cluster.category !== category) continue;
      const sim = computeTitleKeywordSimilarity(rawRole, cluster.representativeRole);
      if (sim >= 0.65 && sim > bestScore) {
        bestScore = sim;
        bestCluster = cluster;
      }
    }

    if (bestCluster) {
      bestCluster.items.push(opp);
      bestCluster.variants.add(cleanRoleTitle(rawRole) || rawRole);
    } else {
      const formattedCore = formatCanonicalTitle(coreRole || rawRole);
      clusters.push({
        key: `core:${formattedCore.toLowerCase()}`,
        label: formattedCore,
        archetypeId: null,
        category,
        representativeRole: coreRole || rawRole,
        matchMethod: "keyword",
        items: [opp],
        variants: new Set([cleanRoleTitle(rawRole) || rawRole]),
      });
    }
  }

  const result: TitleGroupCluster[] = clusters.map((c) => ({
    key: c.key,
    label: c.label,
    archetypeId: c.archetypeId,
    matchMethod: c.matchMethod,
    variants: [...c.variants],
    items: c.items,
  }));

  if (sortDirection === "asc" || sortDirection === "desc") {
    result.sort((a, b) =>
      sortDirection === "desc"
        ? b.label.localeCompare(a.label)
        : a.label.localeCompare(b.label),
    );
  }

  return result;
}
