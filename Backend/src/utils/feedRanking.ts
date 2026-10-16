import { normalizeText, stem } from "./searchEngine.js";

// --------------------------------------------------
// Content matching for suggested feed posts.
//
//   postTerms     - words + hashtags of a post, as weighted terms
//                   (hashtag = 2, caption word = 1)
//   buildInterest - what the viewer cares about, from their profile and from
//                   posts they wrote / liked / saved / shared
//   similarity    - 0..1, how much of a post matches the viewer's interest
// --------------------------------------------------

export type TermMap = Map<string, number>;

export interface InterestSource {
  caption: string;
  hashtags?: string[];
  weight: number;
}

const MAX_INTEREST_TERMS = 200;

/** A suggestion needs at least this content match... */
export const MIN_SIMILARITY = 0.2;
/** ...or, when friends liked it, this weaker one. */
export const MIN_SIMILARITY_FRIEND_LIKED = 0.1;

const STOP_WORDS = new Set(
  (
    "the and for with this that from your you are was were have has had but not all can will just our out " +
    "about into what when who how why get got new one more very its they them their there then than also " +
    "any some been being was does did done too now like love good great nice best today here today " +
    "post posts share shared sharing check follow hello thanks thank"
  ).split(" "),
);

const wordTerms = (text: string): string[] => {
  const out: string[] = [];

  for (const word of normalizeText(text, true).split(" ")) {
    if (word.length < 3 || STOP_WORDS.has(word) || /^\d+$/.test(word)) continue;
    out.push(stem(word));
  }

  return out;
};

export const postTerms = (caption: string, hashtags: string[] = []): TermMap => {
  const terms: TermMap = new Map();
  const put = (term: string, strength: number) => {
    if ((terms.get(term) ?? 0) < strength) terms.set(term, strength);
  };

  for (const word of wordTerms(caption)) put(word, 1);

  for (const tag of hashtags) {
    const clean = String(tag ?? "").replace(/^#/, "");
    const compact = normalizeText(clean).replace(/ /g, "");

    if (compact.length >= 2) put(`#${compact}`, 2);
    for (const word of wordTerms(clean)) put(word, 2);
  }

  return terms;
};

/** Weighted interest terms, scaled 0..1 (log-damped so one repeated word can't dominate). */
export const buildInterest = (sources: InterestSource[]): TermMap => {
  const raw = new Map<string, number>();

  for (const source of sources) {
    if (source.weight <= 0) continue;

    for (const [term, strength] of postTerms(source.caption, source.hashtags)) {
      raw.set(term, (raw.get(term) ?? 0) + source.weight * strength);
    }
  }

  const top = [...raw.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_INTEREST_TERMS);

  const first = top[0];
  if (!first) return new Map();

  const max = Math.log1p(first[1]);
  return new Map(top.map(([term, value]) => [term, Math.log1p(value) / max]));
};

/** 0..1. One matching hashtag is a strong signal, one matching caption word is a weak one. */
export const similarity = (interest: TermMap, terms: TermMap): number => {
  let matched = 0;
  let total = 0;

  for (const [term, strength] of terms) {
    total += strength;
    const weight = interest.get(term);
    if (weight) matched += weight * strength;
  }

  if (total === 0 || matched === 0) return 0;

  // Long captions don't dilute the score forever (denominator is capped).
  const coverage = matched / Math.min(total, 8);
  return Math.min(1, coverage * Math.min(1, matched / 2));
};

export const isEligible = (sim: number, friendLikes: number): boolean =>
  sim >= MIN_SIMILARITY || (friendLikes > 0 && sim >= MIN_SIMILARITY_FRIEND_LIKED);

/** Used only to pick the best suggestions. The feed itself is ordered by time. */
export const suggestionScore = (
  sim: number,
  friendLikes: number,
  knownAuthor: boolean,
): number => sim + 0.12 * Math.min(friendLikes, 5) + (knownAuthor ? 0.1 : 0);