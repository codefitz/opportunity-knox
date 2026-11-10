import { createHash } from "node:crypto";
import { embedLocal, LOCAL_MODEL, LOCAL_REVISION } from "./local-embedding.mjs";
import { callEmbeddingProvider, validateBaseUrl } from "./buddy-provider.mjs";

const LOCAL_MODEL_KEY = `${LOCAL_MODEL}@${LOCAL_REVISION}:q8:mean:normalized:384`;

/**
 * Synonym & abbreviation normalization map for job titles.
 */
export const TITLE_SYNONYM_MAP = {
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

/**
 * Ordered Keyword Mapping Taxonomy (Role Archetypes).
 * More specific archetypes (e.g. Engineering Manager, Frontend/Backend/AI Engineer)
 * are evaluated before broader catch-alls (e.g. Software Engineer).
 */
export const ROLE_ARCHETYPES = [
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

/**
 * Strip parenthetical/bracketed noise and trailing location/contract metadata.
 */
export function cleanRoleTitle(raw) {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.trim();

  // Remove bracketed/parenthetical noise like (Remote), (m/f/d), (London, UK), [Contract]
  s = s.replace(
    /\s*[\(\[][^)\]]*(?:remote|hybrid|onsite|on-site|uk|us|usa|eu|emea|apac|london|manchester|dublin|berlin|new york|contract|ftc|full[- ]?time|part[- ]?time|m\/f\/d|f\/m\/x|d\/f\/m|gn|all\s+genders|req\s*#?\d+|\d+\s*months?)[^)\]]*[\)\]]/gi,
    "",
  );
  // Strip remaining empty or gender/code parentheticals
  s = s.replace(/\s*\((?:m\/f\/d|f\/m\/d|gn|all\s+genders|\d+)\)/gi, "");

  // Strip trailing dash/pipe metadata when it describes work mode, location, or contract
  s = s.replace(
    /\s+[-–—|/]\s+(?:remote|hybrid|onsite|on-site|uk|us|usa|emea|london|contract|ftc|full[- ]?time|part[- ]?time|\d+\s*months?.*)$/i,
    "",
  );

  return s.replace(/\s+/g, " ").trim();
}

/**
 * Extract the core role title by removing seniority prefixes/suffixes and level numbers.
 */
export function extractCoreRoleTitle(raw) {
  const cleaned = cleanRoleTitle(raw);
  if (!cleaned) return "";

  let s = cleaned;
  // Remove leading seniority modifiers when followed by a substantive title
  s = s.replace(
    /^(?:(?:junior|jr\.?|senior|sr\.?|staff|principal|distinguished|associate|mid[- ]?level|entry[- ]?level|graduate|intern|trainee)\s+)+/i,
    "",
  );
  // Remove leading "Lead " when modifying an IC role noun (e.g. "Lead Software Engineer" -> "Software Engineer",
  // "Lead Site Reliability Engineer" -> "Site Reliability Engineer"), while keeping "Tech Lead" or "Team Lead" intact.
  if (
    /^lead\s+(?:.+\s+)?(?:engineer|developer|scientist|designer|architect|analyst|consultant|specialist|researcher|programmer|administrator|associate|coordinator)\b/i.test(
      s,
    )
  ) {
    s = s.replace(/^lead\s+/i, "");
  }

  // Strip trailing level indicators: "II", "III", "IV", "L4", "L5", "Level 3", "Grade 7"
  s = s.replace(/\s+(?:level\s*\d+|grade\s*\d+|l[2-8]|i{1,3}|iv|v)$/i, "");

  // Clean trailing comma/dash specialization if it's just a team/location suffix after a known core role
  const commaParts = s.split(/\s*[,–—|]\s*/);
  if (commaParts.length > 1 && commaParts[0].split(/\s+/).length >= 2) {
    s = commaParts[0];
  }

  return s.replace(/\s+/g, " ").trim() || cleaned;
}

/**
 * Format a title cleanly in Title Case while preserving acronyms (AI, ML, SRE, QA, UI, UX, VP, CTO, BI, API, AWS, GCP, iOS).
 */
export function formatCanonicalTitle(raw) {
  if (!raw || typeof raw !== "string") return "Unspecified role";
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

/**
 * Determine whether a title is Executive, Management, or IC.
 */
export function classifyRoleCategory(raw) {
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

/**
 * Match a job title against the Keyword Mapping Taxonomy (`ROLE_ARCHETYPES`).
 */
export function matchRoleArchetype(raw) {
  const cleaned = cleanRoleTitle(raw);
  const core = extractCoreRoleTitle(raw);
  if (!cleaned) return null;

  // Expand standalone abbreviations before testing patterns
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

/**
 * Tokenize and canonicalize role title words using `TITLE_SYNONYM_MAP`.
 */
export function canonicalizeRoleTokens(raw) {
  const core = extractCoreRoleTitle(raw).toLowerCase();
  if (!core) return [];

  let normalized = core
    .replace(/\bfront[- ]end\b/g, "frontend")
    .replace(/\bback[- ]end\b/g, "backend")
    .replace(/\bfull[- ]stack\b/g, "fullstack")
    .replace(/\bui\/ux\b|\bux\/ui\b/g, "product design")
    .replace(/[^a-z0-9+#.\s-]/g, " ");

  const rawWords = normalized.split(/\s+/).filter(Boolean);
  const tokens = [];

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

/**
 * Compute deterministic Keyword & Taxonomy similarity between two job titles (0.0 to 1.0).
 */
export function computeTitleKeywordSimilarity(roleA, roleB) {
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
    // Different explicit archetypes should not merge by keyword alone
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
      // Check prefix/stem match for domain words (e.g. "researcher" vs "research", "clinical" vs "clinic")
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

  // If two titles only share a generic noun (e.g., "Marketing Manager" vs "Finance Manager"),
  // do NOT consider them keyword-similar!
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

/**
 * Deterministic Keyword-Mapping & Token-Similarity Grouping (runs synchronously on client & server).
 */
export function groupOpportunitiesByTitleKeyword(opportunities) {
  const clusters = [];

  for (const opp of opportunities) {
    const rawRole = (opp.role || "").trim();
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

    // Check similarity against existing clusters
    let bestCluster = null;
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
      const newCluster = {
        key: `core:${formattedCore.toLowerCase()}`,
        label: formattedCore,
        archetypeId: null,
        category,
        representativeRole: coreRole || rawRole,
        matchMethod: "keyword",
        items: [opp],
        variants: new Set([cleanRoleTitle(rawRole) || rawRole]),
      };
      clusters.push(newCluster);
    }
  }

  return clusters.map((c) => ({
    key: c.key,
    label: c.label,
    archetypeId: c.archetypeId,
    matchMethod: c.matchMethod,
    variants: [...c.variants],
    items: c.items,
  }));
}

/**
 * Compute dot-product cosine similarity between two L2-normalized embedding vectors.
 */
export function vectorCosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length || !vecA.length) {
    return 0;
  }
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return Math.max(-1, Math.min(1, dot));
}

/**
 * Hybrid Keyword Mapping + Semantic Embedding Clustering.
 * Uses initial keyword/archetype clusters and merges semantically equivalent or highly similar
 * role titles using their dense vector embeddings.
 */
export function clusterTitlesWithVectors(opportunities, vectorMap) {
  const baseClusters = groupOpportunitiesByTitleKeyword(opportunities).map((c) => ({
    ...c,
    category:
      c.key === "__unspecified__"
        ? "unspecified"
        : ROLE_ARCHETYPES.find((a) => a.id === c.archetypeId)?.category ||
          classifyRoleCategory(c.items[0]?.role || c.label),
    variantsSet: new Set(c.variants),
  }));

  if (!vectorMap || !(vectorMap instanceof Map) || vectorMap.size === 0) {
    return baseClusters.map(({ variantsSet, category, ...rest }) => rest);
  }

  // Helper to get the average normalized vector for a cluster
  function getClusterVector(cluster) {
    const vectors = [];
    const labelVec = vectorMap.get(cluster.label.toLowerCase());
    if (labelVec) vectors.push(labelVec);
    for (const item of cluster.items) {
      const core = extractCoreRoleTitle(item.role || "").toLowerCase();
      const v = vectorMap.get(core) || vectorMap.get((item.role || "").trim().toLowerCase());
      if (v) vectors.push(v);
    }
    if (!vectors.length) return null;
    const dim = vectors[0].length;
    const avg = new Array(dim).fill(0);
    for (const v of vectors) {
      for (let d = 0; d < dim; d++) avg[d] += v[d];
    }
    const norm = Math.hypot(...avg) || 1;
    return avg.map((x) => x / norm);
  }

  // First pass: Match unmapped clusters (no archetypeId) to existing archetype clusters
  // if their semantic embedding similarity + keyword compatibility is strong
  const archetypeClusters = baseClusters.filter((c) => c.archetypeId);
  const unmappedClusters = baseClusters.filter(
    (c) => !c.archetypeId && c.key !== "__unspecified__",
  );

  const mergedIndices = new Set();

  for (let i = 0; i < unmappedClusters.length; i++) {
    const uCluster = unmappedClusters[i];
    const uVec = getClusterVector(uCluster);
    if (!uVec) continue;

    let bestTarget = null;
    let bestHybrid = 0;

    // 1. Compare against existing archetype clusters in the user's opportunities
    for (const aCluster of archetypeClusters) {
      if (aCluster.category !== uCluster.category) continue;
      const aVec = getClusterVector(aCluster);
      if (!aVec) continue;

      const semSim = vectorCosineSimilarity(uVec, aVec);
      const kwSim = computeTitleKeywordSimilarity(
        uCluster.items[0]?.role || uCluster.label,
        aCluster.items[0]?.role || aCluster.label,
      );
      const hybrid = 0.4 * kwSim + 0.6 * semSim;
      if ((semSim >= 0.72 || hybrid >= 0.62) && hybrid > bestHybrid) {
        bestHybrid = hybrid;
        bestTarget = aCluster;
      }
    }

    // 2. Also check against canonical archetype anchor vectors in vectorMap
    if (!bestTarget) {
      let bestArch = null;
      let bestArchSim = 0;
      for (const arch of ROLE_ARCHETYPES) {
        if (arch.category !== uCluster.category) continue;
        if (arch.exclude && arch.exclude.test(uCluster.label)) continue;
        const archVec = vectorMap.get(arch.canonicalTitle.toLowerCase());
        if (!archVec) continue;
        const semSim = vectorCosineSimilarity(uVec, archVec);
        if (semSim >= 0.76 && semSim > bestArchSim) {
          bestArchSim = semSim;
          bestArch = arch;
        }
      }
      if (bestArch) {
        let existingArchCluster = archetypeClusters.find(
          (c) => c.archetypeId === bestArch.id,
        );
        if (existingArchCluster) {
          bestTarget = existingArchCluster;
        } else {
          uCluster.archetypeId = bestArch.id;
          uCluster.key = `arch:${bestArch.id}`;
          uCluster.label = bestArch.canonicalTitle;
          uCluster.matchMethod = "keyword+semantic";
          archetypeClusters.push(uCluster);
          continue;
        }
      }
    }

    if (bestTarget) {
      bestTarget.items.push(...uCluster.items);
      for (const v of uCluster.variantsSet) bestTarget.variantsSet.add(v);
      bestTarget.matchMethod = "keyword+semantic";
      mergedIndices.add(uCluster.key);
    }
  }

  // Second pass: Agglomerative semantic merging among remaining unmapped clusters
  const remainingUnmapped = unmappedClusters.filter((c) => !mergedIndices.has(c.key) && !c.archetypeId);
  for (let i = 0; i < remainingUnmapped.length; i++) {
    const clusterA = remainingUnmapped[i];
    if (mergedIndices.has(clusterA.key)) continue;
    const vecA = getClusterVector(clusterA);
    if (!vecA) continue;

    for (let j = i + 1; j < remainingUnmapped.length; j++) {
      const clusterB = remainingUnmapped[j];
      if (mergedIndices.has(clusterB.key)) continue;
      if (clusterA.category !== clusterB.category) continue;

      const vecB = getClusterVector(clusterB);
      if (!vecB) continue;

      const semSim = vectorCosineSimilarity(vecA, vecB);
      const kwSim = computeTitleKeywordSimilarity(clusterA.label, clusterB.label);
      const hybrid = 0.45 * kwSim + 0.55 * semSim;

      // Merge if semantic similarity is high (>= 0.74) or hybrid score is strong (>= 0.62)
      // while avoiding merging titles that only share a generic noun like "Manager" unless semantic similarity >= 0.82
      const sharesSpecificDomain = kwSim > 0.2;
      if (
        (sharesSpecificDomain && (semSim >= 0.68 || hybrid >= 0.60)) ||
        semSim >= 0.80
      ) {
        // Pick the more frequent or cleaner label
        if (clusterB.items.length > clusterA.items.length) {
          clusterA.label = clusterB.label;
        }
        clusterA.items.push(...clusterB.items);
        for (const v of clusterB.variantsSet) clusterA.variantsSet.add(v);
        clusterA.matchMethod = "keyword+semantic";
        mergedIndices.add(clusterB.key);
      }
    }
  }

  const finalClusters = baseClusters
    .filter((c) => !mergedIndices.has(c.key))
    .map((c) => ({
      key: c.key,
      label: c.label,
      archetypeId: c.archetypeId,
      matchMethod: c.matchMethod,
      variants: [...c.variantsSet],
      items: c.items,
    }));

  return finalClusters;
}

/**
 * Create the server-side Title Grouping service with SQLite vector caching.
 */
export function createTitleGrouping({
  db,
  getConfig,
  listRecords,
  embeddingFn = embedLocal,
  buddyFetch,
}) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS title_embedding_cache (
      cache_key TEXT PRIMARY KEY,
      vector TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );

  const getCachedStmt = db.prepare(
    "SELECT vector FROM title_embedding_cache WHERE cache_key = ?",
  );
  const putCachedStmt = db.prepare(
    "INSERT OR REPLACE INTO title_embedding_cache (cache_key, vector, updated_at) VALUES (?, ?, ?)",
  );

  function resolveModelState() {
    const raw = getConfig("embeddingSettings") || {
      provider: "builtin",
      model: LOCAL_MODEL,
    };
    const provider = raw.provider || "builtin";
    let validExternal = false;
    try {
      validExternal =
        ["openai", "ollama", "custom"].includes(provider) &&
        typeof raw.model === "string" &&
        Boolean(raw.model.trim()) &&
        Boolean(validateBaseUrl(raw.baseUrl)) &&
        (provider !== "openai" || Boolean(raw.apiKey));
    } catch {
      validExternal = false;
    }

    if (provider !== "builtin" && validExternal) {
      const rev = createHash("sha256")
        .update(`${provider}\0${validateBaseUrl(raw.baseUrl)}\0${raw.model.trim()}`)
        .digest("hex")
        .slice(0, 16);
      return {
        provider,
        model: raw.model.trim(),
        modelKey: `${provider}:${raw.model.trim()}@${rev}`,
        raw,
      };
    }
    return {
      provider: "builtin",
      model: LOCAL_MODEL,
      modelKey: LOCAL_MODEL_KEY,
      raw,
    };
  }

  async function embedTextsWithCache(texts) {
    const cleanTexts = [
      ...new Set(
        texts
          .map((t) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
          .filter(Boolean),
      ),
    ];
    if (!cleanTexts.length) return { vectorMap: new Map(), model: LOCAL_MODEL, usedEmbeddings: false };

    const state = resolveModelState();
    const vectorMap = new Map();
    const missing = [];

    for (const text of cleanTexts) {
      const cacheKey = `${state.modelKey}:${text}`;
      try {
        const row = getCachedStmt.get(cacheKey);
        if (row) {
          const parsed = JSON.parse(row.vector);
          if (Array.isArray(parsed) && parsed.length > 0) {
            vectorMap.set(text, parsed);
            continue;
          }
        }
      } catch {}
      missing.push(text);
    }

    if (missing.length > 0) {
      try {
        const runEmbed = embeddingFn || embedLocal;
        const nowIso = new Date().toISOString();
        // Process in batches of up to 32 (embedLocal limit)
        for (let i = 0; i < missing.length; i += 32) {
          const batch = missing.slice(i, i + 32);
          let vectors;
          if (state.provider === "builtin") {
            vectors = await runEmbed(batch);
          } else {
            const res = await callEmbeddingProvider(state.raw, batch, buddyFetch);
            vectors = res.vectors.map((v) => {
              const norm = Math.hypot(...v) || 1;
              return v.map((n) => n / norm);
            });
          }
          if (Array.isArray(vectors) && vectors.length === batch.length) {
            for (let j = 0; j < batch.length; j++) {
              const vec = vectors[j];
              if (Array.isArray(vec) && vec.length > 0) {
                vectorMap.set(batch[j], vec);
                try {
                  putCachedStmt.run(
                    `${state.modelKey}:${batch[j]}`,
                    JSON.stringify(vec),
                    nowIso,
                  );
                } catch {}
              }
            }
          }
        }
      } catch {
        // Fallback gracefully to cached vectors or keyword-only grouping if embedding model fails
      }
    }

    return {
      vectorMap,
      model: state.model,
      usedEmbeddings: vectorMap.size > 0,
    };
  }

  async function groupOpportunities(opportunities) {
    const items = Array.isArray(opportunities) ? opportunities : [];
    if (!items.length) {
      return {
        groups: [],
        assignments: {},
        model: LOCAL_MODEL,
        usedEmbeddings: false,
      };
    }

    // Collect distinct core role titles and canonical archetype titles for embedding
    const textsToEmbed = [];
    for (const opp of items) {
      const core = extractCoreRoleTitle(opp.role || "");
      if (core) textsToEmbed.push(core);
    }
    for (const arch of ROLE_ARCHETYPES) {
      textsToEmbed.push(arch.canonicalTitle);
    }

    const { vectorMap, model, usedEmbeddings } = await embedTextsWithCache(textsToEmbed);
    const groups = clusterTitlesWithVectors(items, vectorMap);

    // Build per-opportunity assignment lookup { [opportunityId]: { key, label, matchMethod, variants } }
    const assignments = {};
    for (const g of groups) {
      for (const item of g.items) {
        if (item.id) {
          assignments[item.id] = {
            key: g.key,
            label: g.label,
            archetypeId: g.archetypeId,
            matchMethod: usedEmbeddings ? "keyword+semantic" : g.matchMethod,
          };
        }
      }
    }

    return {
      groups: groups.map((g) => ({
        key: g.key,
        label: g.label,
        archetypeId: g.archetypeId,
        matchMethod: usedEmbeddings ? "keyword+semantic" : g.matchMethod,
        variants: g.variants,
        opportunityIds: g.items.map((x) => x.id).filter(Boolean),
        count: g.items.length,
      })),
      assignments,
      model,
      usedEmbeddings,
    };
  }

  return {
    groupOpportunities,
    async handle(path, method, req, res, { json, readBody }) {
      if (path !== "/api/opportunities/title-groups") return false;
      if (method === "GET") {
        const records = listRecords();
        const result = await groupOpportunities(records);
        json(res, result);
        return true;
      }
      if (method === "POST") {
        const body = await readBody(req);
        const records = Array.isArray(body?.opportunities)
          ? body.opportunities
          : listRecords();
        const result = await groupOpportunities(records);
        json(res, result);
        return true;
      }
      return false;
    },
  };
}
