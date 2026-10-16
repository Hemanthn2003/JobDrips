// --------------------------------------------------
// Search ranking used by the header search bar.
//
// Pure functions (no database), so they can be tested on their own.
//
//   parseQuery        - cleans what the user typed, splits it into words and adds
//                       related words ("js" -> "javascript", "mern" -> "full stack")
//   matchScore        - how well a text (username, name, caption ...) matches the
//                       query, 0-100:
//                         whole word > same word form (developers / developer)
//                         > word starts with > word contains > typing mistake
//                       Shorter words rank higher ("ar" -> arun before arjunkumar).
//                       Usernames are read as words: ArunKumar_99 = arun kumar 99.
//   fuzzyTermsPattern - database pattern that also finds typing mistakes
//   searchDirectory   - scores a whole list of usernames / names (no limit)
//   canSeePost        - which posts the viewer is allowed to see
// --------------------------------------------------

export const MAX_QUERY_LENGTH = 60;
const MAX_TOKENS = 5;
const MAX_TOKEN_LENGTH = 30;

/** Below this percentage a result is not shown. */
export const MIN_MATCH_PERCENT = 35;

export interface ParsedQuery {
  /** cleaned text, e.g. "arun kumar" */
  text: string;
  tokens: string[];
  /** related words for a token (never shown as the typed word itself) */
  related: Map<string, string[]>;
  /** every word that should highlight / be searched in the database */
  searchTerms: string[];
}

/** A text that was cleaned once, so it can be scored many times quickly. */
export interface PreparedText {
  normalized: string;
  words: string[];
  /** all words joined: "arun kumar" -> "arunkumar" */
  compact: string;
}

// Words that mean (nearly) the same thing when somebody searches for them.
const SYNONYM_GROUPS: string[][] = [
  ["js", "javascript"],
  ["ts", "typescript"],
  ["reactjs", "react"],
  ["nodejs", "node"],
  ["fullstack", "mern", "mean", "mevn"],
  ["frontend", "front end", "ui"],
  ["backend", "back end", "server"],
  ["ml", "machinelearning", "machine learning"],
  ["ai", "artificial intelligence"],
  ["dev", "developer", "engineer", "programmer", "coder"],
  ["devops", "dev ops"],
  ["ux", "uiux", "design"],
  ["hr", "recruiter", "recruitment"],
  ["seo", "marketing"],
  ["db", "database"],
  ["app", "application"],
  ["pic", "photo", "picture"],
];

const SYNONYM_INDEX = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  for (const word of group) {
    SYNONYM_INDEX.set(
      word,
      group.filter((other) => other !== word),
    );
  }
}

/**
 * lower case, no accents, no symbols, single spaces.
 * `splitIdentifiers` also reads "ArunKumar99" as "arun kumar 99" (for usernames,
 * hashtags and captions; never used on what the user typed).
 */
export const normalizeText = (value: string, splitIdentifiers = false): string => {
  let text = String(value ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "");

  if (splitIdentifiers) {
    text = text
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/([A-Za-z])(\d)/g, "$1 $2")
      .replace(/(\d)([A-Za-z])/g, "$1 $2");
  }

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export const prepareNormalized = (normalized: string): PreparedText => {
  const words = normalized ? normalized.split(" ") : [];
  return { normalized, words, compact: words.join("") };
};

export const prepareText = (text: string): PreparedText =>
  prepareNormalized(normalizeText(text, true));

export const parseQuery = (raw: string): ParsedQuery => {
  const text = normalizeText(String(raw ?? "").slice(0, MAX_QUERY_LENGTH));
  const tokens = [...new Set(text.split(" ").filter(Boolean))]
    .map((token) => token.slice(0, MAX_TOKEN_LENGTH))
    .slice(0, MAX_TOKENS);

  const related = new Map<string, string[]>();
  const searchTerms = new Set<string>(tokens);

  for (const token of tokens) {
    // Only complete words are expanded ("js" yes, "j" no).
    const alternatives = (SYNONYM_INDEX.get(token) ?? [])
      .flatMap((word) => word.split(" "))
      .filter((word) => word.length >= 2 && word !== token);

    if (alternatives.length > 0) {
      related.set(token, alternatives);
      for (const word of alternatives) searchTerms.add(word);
    }
  }

  return { text: tokens.join(" "), tokens, related, searchTerms: [...searchTerms] };
};

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One regular expression text that matches any of the words (for MongoDB). */
export const termsPattern = (terms: string[]): string =>
  terms.map((term) => escapeRegex(term)).join("|");

/**
 * Like termsPattern, but every word of 4+ letters also matches with ONE typing
 * mistake: a wrong, missing, extra or swapped letter ("arduno" finds arduino).
 * The exact scoring afterwards decides how good the match really is.
 */
export const fuzzyTermsPattern = (terms: string[]): string => {
  const parts = new Set<string>();

  for (const term of terms) {
    parts.add(escapeRegex(term));
    if (term.length < 4) continue;

    for (let i = 0; i < term.length; i += 1) {
      const before = escapeRegex(term.slice(0, i));
      const after = escapeRegex(term.slice(i + 1));
      parts.add(`${before}.${after}`); // wrong letter
      parts.add(`${before}${after}`); // missing letter
      parts.add(`${before}.${escapeRegex(term.slice(i))}`); // extra letter
      if (i < term.length - 1) {
        parts.add(
          `${escapeRegex(term.slice(0, i))}${escapeRegex(term[i + 1] ?? "")}${escapeRegex(term[i] ?? "")}${escapeRegex(term.slice(i + 2))}`,
        ); // swapped letters
      }
    }
    parts.add(`${escapeRegex(term)}.`); // extra letter at the end
  }

  return [...parts].join("|");
};

// -------------------- scoring --------------------

const editDistance = (a: string, b: string, limit: number): number => {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let beforePrevious: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = [i];
    let rowBest = i;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      // two letters swapped ("arujn" -> "arjun") count as ONE mistake
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (beforePrevious[j - 2] ?? 0) + 1);
      }
      current[j] = value;
      rowBest = Math.min(rowBest, value);
    }

    if (rowBest > limit + 1) return limit + 1;
    beforePrevious = previous;
    previous = current;
  }

  return previous[b.length] ?? limit + 1;
};

const typoAllowance = (length: number): number => (length >= 7 ? 2 : length >= 4 ? 1 : 0);

/** developers / developer, designing / design: the same word in another form. */
export const stem = (word: string): string => {
  if (word.length <= 4) return word;
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
};

/** 0-1: how well ONE typed word matches a word of the text. */
const wordScore = (token: string, word: string): number => {
  if (word === token) return 1;

  // the shorter the word, the closer it is to what was typed
  const coverage = Math.min(1, token.length / word.length);

  if (word.startsWith(token)) return 0.8 + 0.18 * coverage; // 0.8 - 0.98
  if (token.length >= 4 && stem(token) === stem(word)) return 0.92;
  if (word.includes(token)) return 0.5 + 0.12 * coverage; // 0.5 - 0.62

  const allowed = typoAllowance(token.length);
  if (allowed > 0) {
    const whole = editDistance(token, word, allowed);
    const start = editDistance(token, word.slice(0, token.length), allowed);
    const best = Math.min(whole, start);
    if (best <= allowed) return 0.45 - 0.1 * (best - 1);
  }

  return 0;
};

const bestWordScore = (token: string, prepared: PreparedText): number => {
  let best = 0;
  for (const word of prepared.words) {
    const score = wordScore(token, word);
    if (score > best) best = score;
    if (best === 1) return 1;
  }

  // "arunkumar" typed as one word against "Arun Kumar"
  if (prepared.words.length > 1 && best < 0.97) {
    best = Math.max(best, wordScore(token, prepared.compact) * 0.97);
  }
  return best;
};

/**
 * 0-100. How well the prepared text matches the parsed query.
 * Every typed word needs a match (at least half of them for long queries).
 */
export const matchPrepared = (query: ParsedQuery, prepared: PreparedText): number => {
  if (query.tokens.length === 0 || prepared.words.length === 0) return 0;

  let total = 0;
  let matched = 0;

  for (const token of query.tokens) {
    let best = bestWordScore(token, prepared);

    // related words count a bit less than the word that was typed
    for (const alternative of query.related.get(token) ?? []) {
      best = Math.max(best, bestWordScore(alternative, prepared) * 0.75);
    }

    if (best > 0) matched += 1;
    total += best;
  }

  const needed = query.tokens.length === 1 ? 1 : Math.ceil(query.tokens.length / 2);
  if (matched < needed) return 0;

  let percent = (total / query.tokens.length) * 100;

  // the whole phrase appears in the text: "arduino uno" in "my arduino uno kit"
  if (query.tokens.length > 1 && prepared.normalized.includes(query.text)) percent += 8;

  return Math.max(0, Math.min(100, Math.round(percent)));
};

export const matchScore = (query: ParsedQuery, text: string): number =>
  matchPrepared(query, prepareText(text));

/** Hashtags are an even stronger sign than words inside the caption. */
export const hashtagScore = (query: ParsedQuery, hashtags: string[]): number => {
  let best = 0;
  for (const tag of hashtags) best = Math.max(best, matchScore(query, tag.replace(/^#/, "")));
  return best;
};

/** Match percentage of a post (caption words + hashtags). */
export const postScore = (
  query: ParsedQuery,
  caption: string,
  hashtags: string[] = [],
): number => {
  const fromCaption = matchScore(query, caption);
  const fromTags = hashtagScore(query, hashtags);
  const best = Math.max(fromCaption, fromTags);
  if (best === 0) return 0;
  // caption and hashtags agreeing is more convincing than one of them
  return Math.min(100, best + (fromCaption > 0 && fromTags > 0 ? 6 : 0));
};

/**
 * Small extra for liked and recent posts. It only orders results that match
 * about equally well (at most +3.6 points), the match percentage stays in front.
 */
export const rankBoost = (
  likeCount = 0,
  createdAt?: Date | string | null,
  now = Date.now(),
): number => {
  const likes = Math.min(5, Math.log2(1 + Math.max(0, likeCount)));
  const created = createdAt ? new Date(createdAt).getTime() : Number.NaN;
  const ageDays = Number.isFinite(created) ? Math.max(0, (now - created) / 86_400_000) : 365;
  const recent = ageDays < 1 ? 4 : ageDays < 7 ? 3 : ageDays < 30 ? 1.5 : ageDays < 180 ? 0.5 : 0;
  return (likes + recent) * 0.4;
};

/** A short piece of the caption around the first matching word. */
export const snippetOf = (caption: string, query: ParsedQuery, length = 140): string => {
  const flat = caption.replace(/\s+/g, " ").trim();
  if (flat.length <= length) return flat;

  const lower = flat.toLowerCase();
  let at = -1;
  for (const term of query.searchTerms) {
    const index = lower.indexOf(term);
    if (index !== -1 && (at === -1 || index < at)) at = index;
  }

  if (at <= 30) return `${flat.slice(0, length).trimEnd()}…`;

  const start = Math.max(0, at - 30);
  return `…${flat.slice(start, start + length).trim()}${start + length < flat.length ? "…" : ""}`;
};

// -------------------- the people directory (no limit) --------------------

export interface DirectoryRow {
  userid: string;
  username: string;
  name: string;
  /** normalizeText(username, true) and normalizeText(name, true), kept for speed */
  un: string;
  nn: string;
}

export const toDirectoryRow = (userid: string, username: string, name: string): DirectoryRow => ({
  userid,
  username,
  name,
  un: normalizeText(username, true),
  nn: normalizeText(name, true),
});

/** Cheap test that throws out most rows before the exact scoring. */
const couldMatch = (query: ParsedQuery, prepared: PreparedText): boolean => {
  let hits = 0;

  for (const token of query.tokens) {
    const terms = [token, ...(query.related.get(token) ?? [])];
    const found = terms.some((term) => {
      if (prepared.compact.includes(term)) return true;
      if (term.length < 4) return false;
      // a typing mistake keeps one of the first letters (or swaps them)
      return prepared.words.some(
        (word) =>
          Math.abs(word.length - term.length) <= 2 &&
          (word[0] === term[0] || word[1] === term[1] || word[0] === term[1]),
      );
    });
    if (found) hits += 1;
  }

  return hits >= (query.tokens.length === 1 ? 1 : Math.ceil(query.tokens.length / 2));
};

/** Scores EVERY row (username first, then full name). Nothing is cut off. */
export const searchDirectory = (
  rows: Iterable<DirectoryRow>,
  query: ParsedQuery,
): Array<{ userid: string; score: number; reason: "username" | "name" }> => {
  const found: Array<{ userid: string; score: number; reason: "username" | "name" }> = [];

  for (const row of rows) {
    let score = 0;
    let reason: "username" | "name" = "username";

    if (row.un) {
      const prepared = prepareNormalized(row.un);
      if (couldMatch(query, prepared)) score = matchPrepared(query, prepared);
    }

    if (row.nn) {
      const prepared = prepareNormalized(row.nn);
      if (couldMatch(query, prepared)) {
        const nameScore = matchPrepared(query, prepared) * 0.98;
        if (nameScore > score) {
          score = nameScore;
          reason = "name";
        }
      }
    }

    if (score >= MIN_MATCH_PERCENT) found.push({ userid: row.userid, score: Math.round(score), reason });
  }

  return found;
};

// -------------------- who may see a post --------------------

export interface PostAccess {
  viewerId: string;
  ownerId: string;
  ownerIsPrivate: boolean;
  viewerIsFriend: boolean;
  visibility?: string;
  archived?: boolean;
}

/**
 *  - your own posts: always (unless archived)
 *  - a friend's posts: public or friends-only posts
 *  - everybody else: only PUBLIC posts of PUBLIC accounts
 *  - "private" posts and archived posts are never found
 */
export const canSeePost = (access: PostAccess): boolean => {
  if (access.archived) return false;

  const visibility = access.visibility ?? "friends";
  if (access.viewerId === access.ownerId) return true;
  if (visibility === "private") return false;
  if (access.viewerIsFriend) return visibility === "public" || visibility === "friends";

  return !access.ownerIsPrivate && visibility === "public";
};
