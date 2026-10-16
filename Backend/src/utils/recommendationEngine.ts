// --------------------------------------------------
// Profile matching used by the recommendations page.
//
// Every profile is read in TWO layers, using ALL of its content (bio, job
// roles, company, experience descriptions, college field / degree, post
// hashtags and post captions):
//
//   1. KEYWORD layer  - weighted technologies / skills / job words, with
//      related terms expanded (a MERN developer also covers mongodb, express,
//      react, nodejs ...).
//   2. MEANING layer  - every role, skill and sentence is translated into
//      career concepts (frontend, backend, fullstack, mobile, data, design,
//      marketing ...). Phrases such as "built REST APIs and microservices" are
//      understood as backend work even when the word "backend" never appears.
//      Concepts are related to each other: a fullstack developer covers
//      frontend + backend, and frontend / backend developers share the web
//      domain, so they are recommended to each other.
//
// A concept that is confirmed by several different parts of the profile (bio +
// role + hashtags ...) counts more than one mentioned in a single place.
//
// similarity = 55 % meaning layer + 45 % keyword layer
// A person is only recommended when similarity >= MIN_SIMILARITY and the two
// profiles share real evidence (a shared role, or shared skills).
// --------------------------------------------------

/** Minimum keyword similarity (0-1). 0.5 = 50 %. Lower it to 0.45 to be less strict. */
export const MIN_SIMILARITY = 0.5;

const MAX_BASE_TOKENS = 40;
const MAX_POSTS_READ = 30;

export interface ProfileLike {
  bio?: string;
  location?: string;
  experience?: Array<{
    role?: string;
    company?: string;
    description?: string;
    endDate?: string;
  }>;
  education?: {
    college?: Array<{ name?: string; degree?: string; field?: string }>;
  };
  posts?: Array<{
    captions?: { content?: string };
    hashtags?: string[];
    visibility?: string;
    archived?: boolean;
  }>;
}

export interface KeywordProfile {
  /** keyword -> weight (own keywords plus related terms). */
  weights: Map<string, number>;
  /** keywords that count as specific (not generic words such as "developer"). */
  specific: Set<string>;
  /** specific keywords that come from the person's work (bio / roles / experience). */
  work: Set<string>;
  colleges: Set<string>;
  city: string;
  total: number;
  /** career concepts (roles + domains + industries) with their strength, related concepts included. */
  concepts: Map<string, number>;
  /** concepts that come from work content (bio / roles / experience). */
  workConcepts: Set<string>;
  conceptTotal: number;
}

export interface Comparison {
  /** 0-1 */
  ratio: number;
  sharedSpecific: string[];
  sharedWork: number;
  matched: boolean;
}

// -------------------- vocabulary --------------------

const SHORT_ALLOWED = new Set([
  "ai", "ml", "ui", "ux", "qa", "hr", "pm", "bi", "vr", "ar", "js", "db",
]);

const STOPWORDS = new Set(
  (
    "a an the and or but if so of to in on at by for with from into over under about as is are was were be been being " +
    "am i me my we us our you your he she him her his its it they them their this that these those there here " +
    "who whom what when where why how which not no yes can could will would should may might must do does did done " +
    "have has had having get got make made just also very more most some any all each every many much such than then " +
    "too only own same other another new old good great best better like love loves loved enjoy enjoys passionate " +
    "driven motivated dedicated creative hardworking hard working smart enthusiastic experienced skilled talented " +
    "seeking looking currently open opportunities opportunity building build builds built learning learn learns " +
    "interested interest interests focus focused focusing help helping helps based year years month months day days " +
    "today time life world people thing things way ways one two three first last next back out off up down per via " +
    "etc eg ie amp com www http https post posts story stories happy proud excited thrilled thanks thank please " +
    "hello hey hi welcome join joined joining day week weeks really love using use used uses lot lots bit"
  ).split(/\s+/),
);

/** Job-title style words: they count a little, but never prove two people are alike. */
const GENERIC = new Set([
  "developer", "manager", "analyst", "designer", "consultant", "specialist",
  "associate", "lead", "senior", "junior", "intern", "trainee", "student",
  "executive", "officer", "head", "director", "professional", "expert",
  "enthusiast", "freelancer", "founder", "cofounder", "owner", "member",
  "team", "work", "company", "role", "job", "software", "engineer",
]);

const SYNONYMS: Record<string, string> = {
  engineer: "developer", programmer: "developer", coder: "developer", dev: "developer",
  devs: "developer", engineers: "developer", programmers: "developer",
};

const VOCABULARY = (
  // web / software
  "javascript typescript react angular vue svelte nextjs nuxt nodejs express mongodb mongoose sql mysql postgres postgresql sqlite redis graphql rest api " +
  "python django flask fastapi java spring springboot kotlin swift ios android flutter dart reactnative csharp dotnet cpp golang rust php laravel ruby rails " +
  "html css sass tailwind bootstrap aws azure gcp docker kubernetes terraform jenkins git github linux devops cicd cloud serverless microservices firebase supabase " +
  "mern mean mevn fullstack frontend backend webdev web mobile app database blockchain web3 solidity ethereum cybersecurity security pentesting networking iot embedded " +
  "firmware robotics automation selenium testing cypress jest agile scrum jira opensource software " +
  // data / ai
  "ai ml machinelearning deeplearning datascience dataanalytics analytics tensorflow pytorch nlp opencv pandas numpy tableau powerbi excel bi etl spark hadoop kafka " +
  "computervision llm genai " +
  // design / media
  "uiux ui ux figma sketch photoshop illustrator branding graphicdesign design motion animation wireframe prototyping photography videography editing film music " +
  "writing journalism blogging copywriting " +
  // business
  "marketing seo sem socialmedia digitalmarketing sales recruiter recruitment hr talent finance accounting audit investment banking fintech startup entrepreneur " +
  "strategy consulting operations logistics supplychain projectmanagement productmanagement product crm erp sap salesforce ecommerce retail hospitality " +
  // other fields
  "teaching teacher education research healthcare nursing medical pharma biotech legal law civil mechanical electrical electronics construction architecture " +
  "automotive aviation energy agriculture"
).split(/\s+/);

const KNOWN = new Set(VOCABULARY);

// Whole phrases become one keyword before the text is split into words.
const PHRASES: Array<[RegExp, string]> = [
  [/\bfull[\s-]*stack\b/g, "fullstack"],
  [/\bfront[\s-]*end\b/g, "frontend"],
  [/\bback[\s-]*end\b/g, "backend"],
  [/\bdev[\s-]*ops\b/g, "devops"],
  [/\bci\s*\/\s*cd\b/g, "cicd"],
  [/\bnode\s*\.?\s*js\b/g, "nodejs"],
  [/\breact\s*native\b/g, "reactnative"],
  [/\breact\s*\.?\s*js\b/g, "react"],
  [/\bnext\s*\.?\s*js\b/g, "nextjs"],
  [/\bvue\s*\.?\s*js\b/g, "vue"],
  [/\bexpress\s*\.?\s*js\b/g, "express"],
  [/\bangular\s*\.?\s*js\b/g, "angular"],
  [/\bmongo\s*db\b/g, "mongodb"],
  [/\bpostgre\s*sql\b/g, "postgresql"],
  [/\btype\s*script\b/g, "typescript"],
  [/\bjava\s*script\b/g, "javascript"],
  [/\bmachine\s+learning\b/g, "machinelearning"],
  [/\bdeep\s+learning\b/g, "deeplearning"],
  [/\bcomputer\s+vision\b/g, "computervision"],
  [/\bdata\s+scien(?:ce|tist|tists)\b/g, "datascience"],
  [/\bdata\s+analy(?:st|sts|tics|sis)\b/g, "dataanalytics"],
  [/\bartificial\s+intelligence\b/g, "ai"],
  [/\bui\s*\/\s*ux\b/g, "uiux"],
  [/\bux\s*\/\s*ui\b/g, "uiux"],
  [/\bui\s+ux\b/g, "uiux"],
  [/\bgraphic\s+design(?:er|ing)?\b/g, "graphicdesign"],
  [/\bweb\s+develop(?:er|ers|ment)\b/g, "webdev"],
  [/\bweb\s+design(?:er|ing)?\b/g, "webdev"],
  [/\bmern\s*stack\b/g, "mern"],
  [/\bmean\s*stack\b/g, "mean"],
  [/\bmevn\s*stack\b/g, "mevn"],
  [/\bspring\s*boot\b/g, "springboot"],
  [/\bsocial\s+media\b/g, "socialmedia"],
  [/\bdigital\s+marketing\b/g, "digitalmarketing"],
  [/\bsupply\s+chain\b/g, "supplychain"],
  [/\bproject\s+management\b/g, "projectmanagement"],
  [/\bproduct\s+management\b/g, "productmanagement"],
  [/\bsoftware\s+development\s+engineers?\b/g, " software developer "],
  [/\buser\s+interfaces?\b/g, " ui "],
  [/\buser\s+experience\b/g, " ux "],
  [/\bdata\s+engineer(?:s|ing)?\b/g, " dataengineering "],
  [/\bbusiness\s+analy(?:st|sts|sis)\b/g, " businessanalyst "],
  [/\bproduct\s+(?:manager|managers|owner|owners)\b/g, " productmanagement "],
  [/\bproject\s+(?:manager|managers)\b/g, " projectmanagement "],
  [/\bhuman\s+resources?\b/g, " hr "],
  [/\bcyber\s*security\b/g, " cybersecurity "],
  [/\binformation\s+security\b/g, " cybersecurity "],
  [/\b(?:qa|quality\s+assurance)\s+(?:engineer|engineers|tester|testers)\b/g, " qa "],
  [/\bsoftware\s+test(?:er|ers|ing)\b/g, " qa "],
  [/\bcontent\s+(?:writer|writers|writing)\b/g, " writing "],
  [/\bsql\s+server\b/g, " sql "],
  [/\bpower\s*bi\b/g, " powerbi "],
  [/\bscikit\s*learn\b/g, " sklearn "],
  [/\bc\+\+/g, "cpp"],
  [/\bc#/g, "csharp"],
  [/\.net\b/g, " dotnet "],
];

// Same thing, stronger: a MERN developer IS a full stack developer.
const ALIASES: Record<string, string[]> = {
  mern: ["fullstack"],
  mean: ["fullstack"],
  mevn: ["fullstack"],
};

// Related terms (counted at 60 % of the original keyword's weight).
const EXPANSIONS: Record<string, string[]> = {
  mern: ["mongodb", "express", "react", "nodejs", "javascript"],
  mean: ["mongodb", "express", "angular", "nodejs", "javascript"],
  mevn: ["mongodb", "express", "vue", "nodejs", "javascript"],
  fullstack: ["frontend", "backend", "webdev"],
  webdev: ["frontend", "backend", "web"],
  frontend: ["web"],
  react: ["javascript", "frontend"],
  angular: ["typescript", "javascript", "frontend"],
  vue: ["javascript", "frontend"],
  svelte: ["javascript", "frontend"],
  nextjs: ["react", "javascript", "frontend"],
  nodejs: ["javascript", "backend"],
  express: ["nodejs", "backend"],
  mongodb: ["database"],
  mongoose: ["mongodb", "database"],
  mysql: ["sql", "database"],
  postgres: ["sql", "database"],
  postgresql: ["sql", "database"],
  typescript: ["javascript"],
  html: ["frontend", "web"],
  css: ["frontend", "web"],
  tailwind: ["css", "frontend"],
  bootstrap: ["css", "frontend"],
  django: ["python", "backend"],
  flask: ["python", "backend"],
  fastapi: ["python", "backend"],
  springboot: ["java", "backend"],
  spring: ["java", "backend"],
  laravel: ["php", "backend"],
  rails: ["ruby", "backend"],
  flutter: ["dart", "mobile"],
  reactnative: ["react", "mobile", "javascript"],
  android: ["mobile"],
  ios: ["mobile"],
  kotlin: ["android", "mobile"],
  swift: ["ios", "mobile"],
  machinelearning: ["ai", "datascience"],
  deeplearning: ["machinelearning", "ai"],
  tensorflow: ["machinelearning", "ai"],
  pytorch: ["deeplearning", "machinelearning", "ai"],
  nlp: ["ai", "machinelearning"],
  llm: ["ai", "nlp"],
  genai: ["ai", "llm"],
  computervision: ["ai", "deeplearning"],
  pandas: ["python", "datascience"],
  numpy: ["python", "datascience"],
  datascience: ["python", "dataanalytics"],
  dataanalytics: ["analytics", "sql"],
  tableau: ["dataanalytics", "bi"],
  powerbi: ["dataanalytics", "bi"],
  aws: ["cloud"],
  azure: ["cloud"],
  gcp: ["cloud"],
  docker: ["devops"],
  kubernetes: ["devops", "cloud"],
  terraform: ["devops", "cloud"],
  jenkins: ["cicd", "devops"],
  cicd: ["devops"],
  cybersecurity: ["security"],
  pentesting: ["cybersecurity", "security"],
  figma: ["uiux", "design"],
  uiux: ["design"],
  graphicdesign: ["design"],
  photoshop: ["design"],
  illustrator: ["design"],
  seo: ["marketing"],
  digitalmarketing: ["marketing"],
  socialmedia: ["marketing"],
  recruiter: ["recruitment", "hr"],
  recruitment: ["hr"],
};

// -------------------- text -> keywords --------------------


const normalize = (text: string): string => {
  let t = ` ${text.toLowerCase()} `.replace(/https?:\/\/\S+/g, " ");
  for (const [pattern, replacement] of PHRASES) t = t.replace(pattern, ` ${replacement} `);
  return t.replace(/[^a-z0-9\s]/g, " ");
};

const canonical = (raw: string): string => {
  let t = raw;
  if (!t || /^\d+$/.test(t)) return "";
  if (t.length > 5 && /(er|or|ist|yst)s$/.test(t)) t = t.slice(0, -1);
  t = SYNONYMS[t] ?? t;
  if (STOPWORDS.has(t)) return "";
  if (t.length < 3 && !SHORT_ALLOWED.has(t)) return "";
  return t;
};

const tokensOf = (text: string): string[] =>
  normalize(text)
    .split(/\s+/)
    .map(canonical)
    .filter(Boolean);

// -------------------- meaning layer --------------------

type Kind = "bio" | "role" | "description" | "company" | "field" | "degree" | "hashtag" | "caption";

/** How much each part of a profile says about who the person is. */
const KIND_WEIGHT: Record<Kind, number> = {
  bio: 1, role: 1.2, description: 0.8, company: 0.4, field: 0.8, degree: 0.4, hashtag: 0.8, caption: 0.35,
};
/** A single part of the profile can never decide a concept alone (posts cannot flood it). */
const KIND_CAP: Record<Kind, number> = {
  bio: 3, role: 4, description: 3, company: 1, field: 2, degree: 1, hashtag: 3, caption: 2,
};
const WORK_KINDS = new Set<Kind>(["bio", "role", "description", "company"]);

// concept -> words that prove it ("word:0.5" = weaker proof).
const CONCEPT_TERMS: Record<string, string> = {
  frontend:
    "frontend react angular vue svelte nextjs html css sass tailwind bootstrap redux jquery webpack vite responsive ui:0.8 webdev:0.5 reactnative:0.4",
  backend:
    "backend nodejs:0.8 express mongoose django flask fastapi springboot spring laravel rails php api:0.7 rest:0.7 graphql:0.7 " +
    "microservices server:0.5 sql:0.6 mysql:0.6 postgres:0.6 postgresql:0.6 mongodb:0.6 redis:0.6 database:0.5 orm:0.6 webdev:0.5",
  fullstack: "fullstack mern mean mevn",
  web: "webdev web:0.5 website:0.6 websites:0.6",
  mobile: "mobile android ios flutter reactnative kotlin swift dart",
  devops: "devops docker kubernetes terraform jenkins cicd ansible helm",
  cloud: "cloud aws azure gcp serverless",
  datascience: "datascience pandas numpy statistics sklearn jupyter spark:0.6 hadoop:0.6 kafka:0.5 airflow:0.6 dataengineering:0.8",
  ml: "ai ml machinelearning deeplearning tensorflow pytorch nlp llm genai computervision opencv keras",
  analytics: "dataanalytics analytics tableau powerbi excel bi etl reporting businessanalyst:0.8 sql:0.4 dataengineering:0.5",
  security: "cybersecurity security pentesting infosec",
  qa: "qa testing selenium cypress jest:0.6 tester automation:0.4",
  uiux: "uiux figma sketch wireframe prototyping ux usability ui:0.4",
  graphic: "graphicdesign photoshop illustrator branding:0.7 design:0.5 poster",
  video: "videography editing film photography motion animation",
  embedded: "embedded firmware iot robotics arduino",
  blockchain: "blockchain web3 solidity ethereum",
  product: "productmanagement product:0.5 roadmap",
  projectmgmt: "projectmanagement scrum agile jira",
  marketing: "marketing seo sem socialmedia digitalmarketing copywriting:0.6 content:0.4 branding:0.4 advertising",
  writing: "writing journalism blogging copywriting",
  sales: "sales crm salesforce",
  hr: "hr recruiter recruitment talent",
  finance: "finance accounting audit investment banking fintech",
  healthcare: "healthcare nursing nurse medical pharma biotech doctor physician",
  education: "teaching teacher education tutor lecturer professor",
  legal: "legal law lawyer advocate",
  mechanical: "mechanical automotive",
  civil: "civil construction architecture",
  electrical: "electrical electronics",
  software: "software:0.6 sde",
};

const TOKEN_CONCEPTS = new Map<string, Array<[string, number]>>();
for (const [concept, list] of Object.entries(CONCEPT_TERMS)) {
  for (const entry of list.split(/\s+/)) {
    if (!entry) continue;
    const [token = "", strength] = entry.split(":");
    if (!token) continue;
    const rows = TOKEN_CONCEPTS.get(token) ?? [];
    rows.push([concept, strength ? Number(strength) : 1]);
    TOKEN_CONCEPTS.set(token, rows);
  }
}
// Everything that proves a concept is a real professional term.
for (const token of TOKEN_CONCEPTS.keys()) KNOWN.add(token);

// Sentences are understood too: "built REST APIs" means backend work even
// without the word "backend".
const CUES: Array<[RegExp, string, number]> = [
  [/\b(?:responsive|single page|web ?pages?|landing pages?|browsers?|components?)\b/g, "frontend", 0.5],
  [/\b(?:restful|rest apis?|apis?|servers?|server side|microservices?|authentication|endpoints?|database schemas?)\b/g, "backend", 0.5],
  [/\b(?:mobile apps?|android apps?|ios apps?|app store|play store)\b/g, "mobile", 0.8],
  [/\b(?:neural networks?|train(?:ed|ing)? models?|predictive models?|model training|recommendation systems?|classification)\b/g, "ml", 0.7],
  [/\b(?:dashboards?|insights|kpis?|data visuali[sz]ation|business intelligence)\b/g, "analytics", 0.5],
  [/\b(?:deployments?|containeri[sz]\w*|infrastructure|monitoring)\b/g, "devops", 0.4],
  [/\b(?:campaigns?|brand awareness|lead generation|content strategy|audience growth)\b/g, "marketing", 0.6],
  [/\b(?:quota|revenue growth|client acquisition|prospecting|closing deals?)\b/g, "sales", 0.6],
  [/\b(?:hiring|onboarding|talent acquisition|payroll)\b/g, "hr", 0.6],
  [/\b(?:financial statements?|budgeting|taxation|bookkeeping|balance sheets?)\b/g, "finance", 0.6],
  [/\b(?:patients?|clinical|hospital|diagnos\w*|surgery)\b/g, "healthcare", 0.6],
  [/\b(?:curriculum|lesson plans?|classroom|tutoring)\b/g, "education", 0.6],
  [/\b(?:user research|user flows?|wireframes?|usability)\b/g, "uiux", 0.7],
];

// Industry a person works in (company names, descriptions, bio).
const INDUSTRIES: Array<[RegExp, string]> = [
  [/\b(?:fintech|banking|payments?|insurance|lending)\b/, "ind:finance"],
  [/\b(?:e commerce|ecommerce|retail|marketplace)\b/, "ind:ecommerce"],
  [/\b(?:healthcare|health ?tech|hospital|medical|pharma|biotech)\b/, "ind:health"],
  [/\b(?:edtech|education|school|university|e learning)\b/, "ind:education"],
  [/\b(?:gaming|games?|esports)\b/, "ind:gaming"],
  [/\b(?:logistics|supplychain|shipping|warehouse)\b/, "ind:logistics"],
  [/\b(?:media|entertainment|film|music|publishing)\b/, "ind:media"],
  [/\b(?:travel|hospitality|hotel|tourism)\b/, "ind:travel"],
  [/\b(?:manufacturing|automotive|factory)\b/, "ind:manufacturing"],
];

// A concept also covers these (a fullstack developer covers frontend + backend).
const RELATED: Record<string, Array<[string, number]>> = {
  fullstack: [["frontend", 0.8], ["backend", 0.8]],
  // sibling roles: they build the same product from two sides
  frontend: [["backend", 0.15]],
  backend: [["frontend", 0.15]],
  mobile: [["frontend", 0.3]],
  ml: [["datascience", 0.5]],
  datascience: [["ml", 0.5], ["analytics", 0.4]],
  analytics: [["datascience", 0.3]],
  devops: [["cloud", 0.5]],
  cloud: [["devops", 0.5]],
};

// Bigger fields. Frontend and backend developers both belong to "web", which
// is why they can be recommended to each other.
const PARENTS: Record<string, Array<[string, number]>> = {
  frontend: [["web", 0.75]],
  backend: [["web", 0.75]],
  fullstack: [["web", 0.75]],
  web: [["software", 0.5]],
  mobile: [["software", 0.5]],
  devops: [["software", 0.5], ["infra", 0.7]],
  cloud: [["infra", 0.7]],
  embedded: [["software", 0.5]],
  qa: [["software", 0.5]],
  blockchain: [["software", 0.5]],
  datascience: [["data", 0.7]],
  ml: [["data", 0.7]],
  analytics: [["data", 0.7]],
  uiux: [["designfield", 0.6]],
  graphic: [["designfield", 0.6]],
  video: [["designfield", 0.6]],
  marketing: [["business", 0.35]],
  sales: [["business", 0.35]],
  product: [["business", 0.35]],
  projectmgmt: [["business", 0.35]],
  hr: [["business", 0.35]],
  finance: [["business", 0.35]],
};

const DOMAINS = new Set(["web", "software", "infra", "data", "designfield", "business"]);

/** Sharing only a field (web, data ...) counts less than sharing the same role. */
const DOMAIN_SHARE = 0.6;
const INDUSTRY_SHARE = 0.8;
const isRoleConcept = (concept: string) => !DOMAINS.has(concept) && !concept.startsWith("ind:");

interface Evidence {
  kind: Kind;
  map: Map<string, number>;
}

/** What one piece of text says about the person (concept -> strength). */
const evidenceOf = (text: string, kind: Kind): Evidence | null => {
  const normalized = normalize(text);
  const out = new Map<string, number>();
  const bump = (concept: string, strength: number) =>
    out.set(concept, Math.min(2, (out.get(concept) ?? 0) + strength));

  for (const raw of normalized.split(/\s+/)) {
    const token = canonical(raw);
    if (!token) continue;
    for (const [concept, strength] of TOKEN_CONCEPTS.get(token) ?? []) bump(concept, strength);
  }
  for (const [pattern, concept, strength] of CUES) {
    const hits = normalized.match(pattern)?.length ?? 0;
    if (hits) bump(concept, Math.min(hits, 3) * strength);
  }
  for (const [pattern, concept] of INDUSTRIES) if (pattern.test(normalized)) bump(concept, 1);

  return out.size ? { kind, map: out } : null;
};

/** Adds up the evidence from all parts of the profile; agreement between parts counts extra. */
const combineEvidence = (items: Evidence[], only?: Set<Kind>): Map<string, number> => {
  const perKind = new Map<Kind, Map<string, number>>();
  for (const { kind, map } of items) {
    if (only && !only.has(kind)) continue;
    const bucket = perKind.get(kind) ?? new Map<string, number>();
    perKind.set(kind, bucket);
    for (const [concept, strength] of map) {
      bucket.set(concept, (bucket.get(concept) ?? 0) + strength * KIND_WEIGHT[kind]);
    }
  }

  const total = new Map<string, number>();
  const sources = new Map<string, number>();
  for (const [kind, bucket] of perKind) {
    for (const [concept, strength] of bucket) {
      total.set(concept, (total.get(concept) ?? 0) + Math.min(KIND_CAP[kind], strength));
      sources.set(concept, (sources.get(concept) ?? 0) + 1);
    }
  }
  for (const [concept, strength] of total) {
    const agreement = Math.min(1.6, 1 + 0.2 * ((sources.get(concept) ?? 1) - 1));
    total.set(concept, Math.min(8, strength * agreement));
  }
  return total;
};

/** Related and parent concepts are added without ever lowering a stronger value. */
const expandConcepts = (base: Map<string, number>): Map<string, number> => {
  const out = new Map(base);
  const put = (concept: string, strength: number) => {
    if ((out.get(concept) ?? 0) < strength) out.set(concept, strength);
  };

  for (const [concept, strength] of base) {
    for (const [related, ratio] of RELATED[concept] ?? []) put(related, strength * ratio);
  }
  for (let pass = 0; pass < 2; pass += 1) {
    for (const [concept, strength] of [...out]) {
      for (const [parent, ratio] of PARENTS[concept] ?? []) put(parent, strength * ratio);
    }
  }
  return out;
};


const clampRelated = (weight: number) => Math.min(1.8, Math.max(0.6, weight * 0.6));

const expand = (base: Map<string, number>): Map<string, number> => {
  const out = new Map(base);
  const put = (token: string, weight: number) => {
    if ((out.get(token) ?? 0) < weight) out.set(token, weight);
  };

  for (const [token, weight] of base) {
    for (const alias of ALIASES[token] ?? []) {
      put(alias, weight);
      for (const related of EXPANSIONS[alias] ?? []) put(related, clampRelated(weight));
    }
    for (const related of EXPANSIONS[token] ?? []) put(related, clampRelated(weight));
  }

  return out;
};

const normalizeCollege = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\b(the|of|and)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");

const normalizeCity = (location: string): string =>
  (location.split(",")[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");

export const buildKeywordProfile = (
  profile: ProfileLike,
  options: { publicPostsOnly: boolean },
): KeywordProfile => {
  const base = new Map<string, number>();
  const workBase = new Map<string, number>();
  const specificBase = new Set<string>();
  const evidence: Evidence[] = [];

  // Every piece of content is also read for its meaning.
  const note = (text: string, kind: Kind) => {
    const found = evidenceOf(text, kind);
    if (found) evidence.push(found);
  };

  // `text` words only count when they are known professional terms; `role` and
  // `hashtag` words always count (a job title / a hashtag is always meaningful).
  const add = (
    text: string,
    weight: number,
    mode: "text" | "role" | "hashtag",
    isWork: boolean,
  ) => {
    for (const token of tokensOf(text)) {
      const generic = GENERIC.has(token);
      const known = KNOWN.has(token);
      if (mode === "text" && !known && !generic) continue;

      const w = generic ? Math.min(weight, 1) : weight;
      base.set(token, Math.min(6, (base.get(token) ?? 0) + w));
      if (isWork) workBase.set(token, Math.min(6, (workBase.get(token) ?? 0) + w));
      if (!generic && (known || mode !== "text")) specificBase.add(token);
    }
  };

  add(profile.bio ?? "", 3, "text", true);
  note(profile.bio ?? "", "bio");

  for (const job of profile.experience ?? []) {
    add(job.role ?? "", 3, "role", true);
    add(job.company ?? "", 1, "text", true);
    add(job.description ?? "", 2, "text", true);
    note(job.role ?? "", "role");
    note(job.company ?? "", "company");
    note(job.description ?? "", "description");
  }

  for (const college of profile.education?.college ?? []) {
    add(college.field ?? "", 2, "role", false);
    add(college.degree ?? "", 1, "text", false);
    note(college.field ?? "", "field");
    note(college.degree ?? "", "degree");
  }

  const posts = (profile.posts ?? [])
    .filter((post) => !post.archived)
    .filter((post) => !options.publicPostsOnly || post.visibility === "public")
    .slice(-MAX_POSTS_READ);

  for (const post of posts) {
    for (const tag of post.hashtags ?? []) {
      add(tag.replace(/^#/, ""), 2, "hashtag", false);
      note(tag.replace(/^#/, ""), "hashtag");
    }
    add(post.captions?.content ?? "", 1, "text", false);
    note(post.captions?.content ?? "", "caption");
  }

  // Keep the strongest keywords only.
  const top = new Map(
    [...base.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_BASE_TOKENS),
  );

  const weights = expand(top);
  const specific = new Set<string>();
  for (const token of weights.keys()) {
    if (specificBase.has(token) || (KNOWN.has(token) && !GENERIC.has(token))) specific.add(token);
  }

  const workTop = new Map([...workBase].filter(([token]) => top.has(token)));
  const work = new Set<string>();
  for (const token of expand(workTop).keys()) if (specific.has(token)) work.add(token);

  let total = 0;
  for (const weight of weights.values()) total += weight;

  const coreConcepts = combineEvidence(evidence);
  const concepts = expandConcepts(coreConcepts);
  const workConcepts = new Set<string>();
  for (const [concept, strength] of expandConcepts(combineEvidence(evidence, WORK_KINDS))) {
    if (strength >= 0.8) workConcepts.add(concept);
  }
  // The size of a profile is what the person says about themselves; the
  // related / parent concepts that are added on top do not make it "bigger".
  let conceptTotal = 0;
  for (const strength of coreConcepts.values()) conceptTotal += strength;

  const colleges = new Set<string>();
  for (const college of profile.education?.college ?? []) {
    const key = normalizeCollege(college.name ?? "");
    if (key.length >= 4) colleges.add(key);
  }

  return {
    weights,
    specific,
    work,
    colleges,
    city: normalizeCity(profile.location ?? ""),
    total,
    concepts,
    workConcepts,
    conceptTotal,
  };
};

export const compareKeywords = (
  mine: KeywordProfile,
  theirs: KeywordProfile,
): Comparison => {
  // 1. keyword layer
  let sharedKeywordWeight = 0;
  const sharedSpecific: string[] = [];

  for (const [token, weight] of mine.weights) {
    const other = theirs.weights.get(token);
    if (!other) continue;
    sharedKeywordWeight += Math.min(weight, other);
    if (mine.specific.has(token) && theirs.specific.has(token)) sharedSpecific.push(token);
  }

  const smallerKeywords = Math.min(mine.total, theirs.total);
  const keywordRatio = smallerKeywords > 0 ? Math.min(1, sharedKeywordWeight / smallerKeywords) : 0;

  // 2. meaning layer
  let sharedConceptWeight = 0;
  let sharedRoles = 0;
  let sharedDomains = 0;

  for (const [concept, weight] of mine.concepts) {
    const other = theirs.concepts.get(concept);
    if (!other) continue;
    const overlap = Math.min(weight, other);
    if (isRoleConcept(concept)) {
      sharedConceptWeight += overlap;
      if (overlap >= 0.8) sharedRoles += 1;
    } else if (DOMAINS.has(concept)) {
      sharedConceptWeight += overlap * DOMAIN_SHARE;
      if (overlap >= 0.3) sharedDomains += 1;
    } else {
      sharedConceptWeight += overlap * INDUSTRY_SHARE;
    }
  }

  const smallerConcepts = Math.min(mine.conceptTotal, theirs.conceptTotal);
  const conceptRatio = smallerConcepts > 0 ? Math.min(1, sharedConceptWeight / smallerConcepts) : 0;

  const hasKeywords = smallerKeywords > 0;
  const hasConcepts = smallerConcepts > 0;
  const ratio =
    hasKeywords && hasConcepts
      ? 0.55 * conceptRatio + 0.45 * keywordRatio
      : hasConcepts
        ? conceptRatio
        : keywordRatio;

  let sharedWork = 0;
  for (const concept of mine.workConcepts) {
    if (theirs.workConcepts.has(concept)) sharedWork += 1;
  }

  // Real evidence: the same role, or shared skills (a shared domain needs one
  // shared skill next to it). One generic word is never enough.
  const evidenceOk =
    sharedRoles >= 1 ||
    sharedSpecific.length >= 2 ||
    sharedDomains >= 2 ||
    (sharedDomains >= 1 && sharedSpecific.length >= 1);

  return {
    ratio,
    sharedSpecific,
    sharedWork,
    matched: ratio >= MIN_SIMILARITY && evidenceOk,
  };
};

export const sameCollege = (a: KeywordProfile, b: KeywordProfile): boolean =>
  [...a.colleges].some((college) => b.colleges.has(college));

export const sameCity = (a: KeywordProfile, b: KeywordProfile): boolean =>
  a.city.length >= 3 && a.city === b.city;

// -------------------- card text --------------------

/** "Software Developer": the current (or latest) role, else the start of the bio. */
export const headlineOf = (profile: ProfileLike): string => {
  const jobs = (profile.experience ?? []).filter((job) => (job.role ?? "").trim());

  const current = jobs.filter((job) => {
    const end = (job.endDate ?? "").trim().toLowerCase();
    return end === "" || end === "present";
  });

  const pick = current[current.length - 1] ?? jobs[jobs.length - 1];
  if (pick?.role) return pick.role.trim().slice(0, 60);

  const bio = (profile.bio ?? "").trim().split(/\r?\n/)[0] ?? "";
  if (bio) return bio.length > 60 ? `${bio.slice(0, 57).trimEnd()}…` : bio;

  const college = (profile.education?.college ?? []).slice(-1)[0];
  const study = [college?.degree, college?.field].filter(Boolean).join(" · ");
  return study.slice(0, 60);
};
