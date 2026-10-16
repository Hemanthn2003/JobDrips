import type { Request, Response } from "express";
import mongoose from "mongoose";

import Profile from "../models/Profile.js";
import Recommendation from "../models/Recommendation.js";
import { User } from "../models/User.js";
import type { AuthenticatedRequest } from "../utils/authMiddleware.js";
import { headlineOf, type ProfileLike } from "../utils/recommendationEngine.js";
import { acceptedFriendIds, mutualFriendIds } from "../utils/recommendationGraph.js";
import {
  MIN_MATCH_PERCENT,
  canSeePost,
  escapeRegex,
  matchScore,
  parseQuery,
  postScore,
  snippetOf,
  termsPattern,
  type ParsedQuery,
} from "../utils/searchEngine.js";

// --------------------------------------------------
// Header search
//   GET /api/search?q=ar          full results
//   GET /api/search/suggest?q=ar  small list for the dropdown while typing
//
// Search scope depends on how many letters were typed:
//
//   1-2 letters  -> FRIENDS ONLY (and my own posts). Only words that START
//                   with the typed letters are matched, so "a" gives arun,
//                   anil ... and not every name that merely contains an "a".
//
//   3+ letters   -> GLOBAL. Everybody in the database, with typing-mistake
//                   matching, related words (js -> javascript), job role / bio,
//                   and private-account rules.
//
// People: username / full name (and, in global mode, weaker: job role and bio).
// Posts : caption words and hashtags.
//   Only my own posts, my friends' posts and (global mode only) PUBLIC posts
//   of PUBLIC accounts. Friends and recommended people are always listed first.
// --------------------------------------------------

/** Search starts from the very first letter. */
const MIN_QUERY_LETTERS = 1;
/** Up to this many letters = friends only. One more letter = global search. */
const LOCAL_SCOPE_MAX_LETTERS = 2;
/** Friends mode shows only (near) prefix matches: prefix scores are 80+, "contains" is max 62. */
const MIN_LOCAL_PERCENT = 75;
/** Safety cap for people with a huge friend list. */
const MAX_FRIEND_SCAN = 1000;

const FULL_LIMITS = { people: 20, posts: 20 } as const;
const SUGGEST_LIMITS = { people: 6, posts: 4 } as const;

/** Profiles read per database query. */
const PROFILE_LIMIT = 120;
const FUZZY_WHEN_FEWER_THAN = 6;
const MAX_MUTUAL_ICONS = 3;

type Relation = "friend" | "suggested" | "requested" | "none";
type SearchScope = "friends" | "global";

interface SearchLimits {
  people: number;
  posts: number;
}

interface PersonDoc extends ProfileLike {
  userid: string;
  username?: string;
  profileimage?: string;
  isPrivate?: boolean;
  friends?: Array<{ userid: string; friendshipAccepted?: boolean }>;
  requests?: Array<{ profile?: { userid?: string }; accept?: boolean }>;
}

interface PostHit {
  postId: string;
  createdAt?: Date;
  content?: string;
  hashtags?: string[];
  visibility?: string;
  archived?: boolean;
  image?: string;
  likeCount?: number;
}

interface PostOwnerDoc extends PersonDoc {
  hits?: PostHit[];
}

const PERSON_FIELDS =
  "userid username profileimage bio location isPrivate experience education.college " +
  "friends.userid friends.friendshipAccepted requests.profile.userid requests.accept";

const viewerId = (request: Request): string =>
  String((request as AuthenticatedRequest).userId || "");

const ok = (response: Response, data: unknown) => response.status(200).json({ success: true, data });
const fail = (response: Response, status: number, message: string) =>
  response.status(status).json({ success: false, message });

const loadNames = async (ids: string[]): Promise<Map<string, string>> => {
  const valid = [...new Set(ids)].filter((id) => mongoose.isValidObjectId(id));
  if (valid.length === 0) return new Map();

  const users = (await User.find({ _id: { $in: valid } })
    .select("name")
    .lean()) as unknown as Array<{ _id: unknown; name?: string }>;

  return new Map(users.map((user) => [String(user._id), user.name ?? ""]));
};

const regexOf = (source: string, anchored = false) =>
  new RegExp(anchored ? `^(?:${source})` : source, "i");

/** Regex text that only matches where a WORD starts with one of the terms. */
const wordStartPattern = (terms: string[]): string =>
  `(?:^|[^a-zA-Z0-9])(?:${terms.map((term) => escapeRegex(term)).join("|")})`;

// -------------------- database queries --------------------

/** FRIENDS MODE: the profiles of my friends (no regex needed, the list is small). */
const findFriendProfiles = async (friendIds: string[]): Promise<Map<string, PersonDoc>> => {
  const found = new Map<string, PersonDoc>();
  if (friendIds.length === 0) return found;

  const docs = (await Profile.find({ userid: { $in: friendIds.slice(0, MAX_FRIEND_SCAN) } })
    .select(PERSON_FIELDS)
    .lean()) as unknown as PersonDoc[];

  for (const doc of docs) found.set(doc.userid, doc);
  return found;
};

/**
 * GLOBAL MODE: profiles whose username / full name could match. Words that
 * START with what was typed are fetched first so common letters ("aru") never
 * push them out.
 */
const findPeopleCandidates = async (
  query: ParsedQuery,
  extraPrefix = "",
): Promise<Map<string, PersonDoc>> => {
  const source = extraPrefix ? escapeRegex(extraPrefix) : termsPattern(query.tokens);

  const [byPrefix, bySubstring, nameHits] = await Promise.all([
    Profile.find({ username: regexOf(source, true) }).select(PERSON_FIELDS).limit(PROFILE_LIMIT).lean(),
    extraPrefix
      ? Promise.resolve([])
      : Profile.find({ username: regexOf(source) }).select(PERSON_FIELDS).limit(PROFILE_LIMIT).lean(),
    User.find({ name: regexOf(source, !!extraPrefix) })
      .select("_id")
      .limit(PROFILE_LIMIT)
      .lean(),
  ]);

  const nameIds = (nameHits as unknown as Array<{ _id: unknown }>).map((user) => String(user._id));
  const byName = nameIds.length
    ? await Profile.find({ userid: { $in: nameIds } }).select(PERSON_FIELDS).lean()
    : [];

  const found = new Map<string, PersonDoc>();
  for (const doc of [...byPrefix, ...bySubstring, ...byName] as unknown as PersonDoc[]) {
    found.set(doc.userid, doc);
  }
  return found;
};

/** GLOBAL MODE: people described by their job role / bio ("developer", "nurse"). */
const findByRoleOrBio = async (query: ParsedQuery): Promise<PersonDoc[]> => {
  if (query.text.length < 3) return [];
  const rx = regexOf(termsPattern(query.searchTerms));

  return (await Profile.find({ $or: [{ "experience.role": rx }, { bio: rx }] })
    .select(PERSON_FIELDS)
    .limit(60)
    .lean()) as unknown as PersonDoc[];
};

/** MongoDB conditions that find posts of a profile whose caption or hashtag matches. */
const postMatchCondition = (source: string) => ({
  $or: [
    {
      $regexMatch: {
        input: { $ifNull: ["$$p.captions.content", ""] },
        regex: source,
        options: "i",
      },
    },
    {
      $gt: [
        {
          $size: {
            $filter: {
              input: { $ifNull: ["$$p.hashtags", []] },
              as: "h",
              cond: { $regexMatch: { input: "$$h", regex: source, options: "i" } },
            },
          },
        },
        0,
      ],
    },
  ],
});

/**
 * Profiles that have at least one post matching `source`. Only the matching
 * posts are returned (as `hits`), never the whole post list.
 *
 * NOTE: this scans profiles. For a very large user base, add a text index or
 * use Atlas Search.
 */
const findPostOwners = async (
  source: string,
  scope: Record<string, unknown>,
): Promise<PostOwnerDoc[]> => {
  const rx = regexOf(source);

  const rows = (await Profile.aggregate([
    {
      $match: {
        // `scope` has its own $or, so the two conditions are joined with $and.
        $and: [scope, { $or: [{ "posts.captions.content": rx }, { "posts.hashtags": rx }] }],
      },
    },
    { $sort: { updatedAt: -1 } },
    { $limit: PROFILE_LIMIT },
    {
      $project: {
        userid: 1,
        username: 1,
        profileimage: 1,
        isPrivate: 1,
        "friends.userid": 1,
        "friends.friendshipAccepted": 1,
        "requests.profile.userid": 1,
        "requests.accept": 1,
        hits: {
          $map: {
            input: {
              $filter: {
                input: { $ifNull: ["$posts", []] },
                as: "p",
                cond: {
                  $and: [{ $ne: ["$$p.archived", true] }, postMatchCondition(source)],
                },
              },
            },
            as: "p",
            in: {
              postId: "$$p.postId",
              createdAt: "$$p.createdAt",
              content: "$$p.captions.content",
              hashtags: "$$p.hashtags",
              visibility: "$$p.visibility",
              archived: "$$p.archived",
              image: "$$p.imageUrl.image1",
              likeCount: { $size: { $ifNull: ["$$p.likes", []] } },
            },
          },
        },
      },
    },
  ])) as unknown as PostOwnerDoc[];

  return rows;
};

// -------------------- the search itself --------------------

interface SearchPayload {
  query: string;
  scope: SearchScope;
  /** how many letters are needed before the search goes global */
  globalFromLetters: number;
  people: unknown[];
  posts: unknown[];
}

const runSearch = async (me: string, rawQuery: unknown, limits: SearchLimits): Promise<SearchPayload> => {
  const query = parseQuery(typeof rawQuery === "string" ? rawQuery : "");
  const letters = query.text.replace(/\s/g, "").length;
  const scope: SearchScope = letters <= LOCAL_SCOPE_MAX_LETTERS ? "friends" : "global";
  const globalFromLetters = LOCAL_SCOPE_MAX_LETTERS + 1;

  const empty: SearchPayload = { query: query.text, scope, globalFromLetters, people: [], posts: [] };
  if (query.tokens.length === 0 || letters < MIN_QUERY_LETTERS) return empty;

  const minPercent = scope === "friends" ? MIN_LOCAL_PERCENT : MIN_MATCH_PERCENT;

  // ---- who I am connected to ----
  const [mine, recommendationDoc] = (await Promise.all([
    Profile.findOne({ userid: me }).select("userid friends.userid friends.friendshipAccepted").lean(),
    Recommendation.findOne({ recommendationsFor: me }).select("recommendations.userid").lean(),
  ])) as unknown as [
    PersonDoc | null,
    { recommendations?: Array<{ userid: string }> } | null,
  ];

  const friendIds = acceptedFriendIds(mine);
  const friendSet = new Set(friendIds);
  const suggestedSet = new Set((recommendationDoc?.recommendations ?? []).map((entry) => entry.userid));

  const relationOf = (doc: PersonDoc): Relation => {
    if (friendSet.has(doc.userid)) return "friend";
    if ((doc.requests ?? []).some((item) => item.profile?.userid === me && !item.accept)) {
      return "requested";
    }
    if (suggestedSet.has(doc.userid)) return "suggested";
    return "none";
  };
  /** friends and my recommendations are listed before everybody else */
  const groupOf = (userid: string): number =>
    userid === me || friendSet.has(userid) || suggestedSet.has(userid) ? 0 : 1;

  // ---- people ----
  interface PersonHit { doc: PersonDoc; score: number; reason: string }
  const people = new Map<string, PersonHit>();

  const candidates =
    scope === "friends" ? await findFriendProfiles(friendIds) : await findPeopleCandidates(query);

  if (scope === "global") {
    for (const doc of await findByRoleOrBio(query)) candidates.set(doc.userid, doc);
  }

  let names = await loadNames([...candidates.keys()]);

  const scorePeople = (docs: Iterable<PersonDoc>) => {
    for (const doc of docs) {
      if (doc.userid === me) continue;

      const options: Array<[number, string]> = [
        [matchScore(query, doc.username ?? ""), "username"],
        [matchScore(query, names.get(doc.userid) ?? "") * 0.98, "name"],
      ];

      // Job role and bio are only searched globally (too noisy for 1-2 letters).
      if (scope === "global") {
        options.push(
          [
            Math.max(0, ...(doc.experience ?? []).map((job) => matchScore(query, job.role ?? ""))) * 0.55,
            "role",
          ],
          [matchScore(query, doc.bio ?? "") * 0.4, "bio"],
        );
      }

      const [score, reason] = options.reduce((best, item) => (item[0] > best[0] ? item : best));

      if (score >= minPercent) {
        people.set(doc.userid, { doc, score: Math.round(score), reason });
      }
    }
  };

  scorePeople(candidates.values());

  // Few results: also look for typing mistakes ("arjn" -> arjun). Global only.
  if (scope === "global" && people.size < FUZZY_WHEN_FEWER_THAN && letters >= 4) {
    const fuzzy = await findPeopleCandidates(query, query.tokens[0]?.slice(0, 2) ?? "");
    const fresh = [...fuzzy.values()].filter((doc) => !candidates.has(doc.userid));
    names = new Map([...names, ...(await loadNames(fresh.map((doc) => doc.userid)))]);
    scorePeople(fresh);
  }

  // ---- posts ----
  // friends mode: my posts + friends' posts, only words that start with the letters
  // global mode : my posts + friends + every non-private account
  const postSource =
    scope === "friends" ? wordStartPattern(query.searchTerms) : termsPattern(query.searchTerms);

  const postScope =
    scope === "friends"
      ? { $or: [{ userid: me }, { userid: { $in: friendIds } }] }
      : { $or: [{ userid: me }, { userid: { $in: friendIds } }, { isPrivate: { $ne: true } }] };

  const postOwners = await findPostOwners(postSource, postScope);

  interface PostResult {
    owner: PostOwnerDoc;
    hit: PostHit;
    score: number;
  }
  const posts: PostResult[] = [];

  for (const owner of postOwners) {
    for (const hit of owner.hits ?? []) {
      const allowed = canSeePost({
        viewerId: me,
        ownerId: owner.userid,
        ownerIsPrivate: owner.isPrivate === true,
        viewerIsFriend: friendSet.has(owner.userid),
        visibility: hit.visibility,
        archived: hit.archived,
      });
      if (!allowed) continue;

      const score = postScore(query, hit.content ?? "", hit.hashtags ?? []);
      if (score >= minPercent) posts.push({ owner, hit, score });
    }
  }

  // Global only: a private account that is not my friend is listed when one of
  // its posts matches. The post itself is never shown or described.
  if (scope === "global") {
    const privateOwners = await findPostOwners(postSource, {
      isPrivate: true,
      userid: { $nin: [me, ...friendIds] },
    });

    for (const owner of privateOwners) {
      if (people.has(owner.userid)) continue;

      let best = 0;
      for (const hit of owner.hits ?? []) {
        if (hit.archived || (hit.visibility ?? "friends") === "private") continue;
        best = Math.max(best, postScore(query, hit.content ?? "", hit.hashtags ?? []));
      }

      if (best >= MIN_MATCH_PERCENT) {
        people.set(owner.userid, { doc: owner, score: Math.round(best * 0.7), reason: "private-posts" });
      }
    }
  }

  // ---- order: friends / recommended first, then by match, then by mutual friends ----
  const mutualOf = (doc: PersonDoc) => mutualFriendIds(friendSet, doc, me);

  const rankedPeople = [...people.values()]
    .map((item) => ({ ...item, mutual: mutualOf(item.doc) }))
    .sort(
      (a, b) =>
        groupOf(a.doc.userid) - groupOf(b.doc.userid) ||
        b.score - a.score ||
        b.mutual.length - a.mutual.length ||
        (a.doc.username ?? "").localeCompare(b.doc.username ?? ""),
    )
    .slice(0, limits.people);

  const rankedPosts = posts
    .sort(
      (a, b) =>
        groupOf(a.owner.userid) - groupOf(b.owner.userid) ||
        b.score - a.score ||
        new Date(b.hit.createdAt ?? 0).getTime() - new Date(a.hit.createdAt ?? 0).getTime(),
    )
    .slice(0, limits.posts);

  // ---- details for the page: names, small mutual-friend icons ----
  const iconIds = [...new Set(rankedPeople.flatMap((item) => item.mutual.slice(0, MAX_MUTUAL_ICONS)))];
  const [iconRows, allNames] = await Promise.all([
    iconIds.length
      ? (Profile.find({ userid: { $in: iconIds } })
          .select("userid username profileimage")
          .lean() as unknown as Promise<PersonDoc[]>)
      : Promise.resolve([] as PersonDoc[]),
    loadNames([
      ...iconIds,
      ...rankedPeople.map((item) => item.doc.userid),
      ...rankedPosts.map((item) => item.owner.userid),
    ]),
  ]);
  const icons = new Map(iconRows.map((row) => [row.userid, row]));
  const nameOf = (id: string, username?: string) => allNames.get(id) || username || "JobDrips member";

  return {
    query: query.text,
    scope,
    globalFromLetters,
    people: rankedPeople.map(({ doc, score, reason, mutual }) => {
      const relation = relationOf(doc);
      // A private profile only shares its job title with friends.
      const showDetails = !doc.isPrivate || relation === "friend";

      return {
        userid: doc.userid,
        username: doc.username ?? "",
        name: nameOf(doc.userid, doc.username),
        profileimage: doc.profileimage ?? "",
        headline: showDetails ? headlineOf(doc) : "",
        isPrivate: doc.isPrivate === true,
        relation,
        mutualCount: mutual.length,
        mutualFriends: mutual.slice(0, MAX_MUTUAL_ICONS).map((id) => ({
          userid: id,
          name: nameOf(id, icons.get(id)?.username),
          profileimage: icons.get(id)?.profileimage ?? "",
        })),
        matchPercent: score,
        reason,
      };
    }),
    posts: rankedPosts.map(({ owner, hit, score }) => ({
      postId: hit.postId,
      ownerId: owner.userid,
      username: owner.username ?? "",
      name: nameOf(owner.userid, owner.username),
      profileimage: owner.profileimage ?? "",
      snippet: snippetOf(hit.content ?? "", query),
      image: hit.image ?? "",
      likeCount: hit.likeCount ?? 0,
      createdAt: hit.createdAt ?? null,
      relation: relationOf(owner),
      matchPercent: score,
    })),
  };
};

// -------------------- endpoints --------------------

const createHandler =
  (limits: SearchLimits) =>
  async (request: Request, response: Response): Promise<void> => {
    try {
      const me = viewerId(request);
      if (!me) {
        fail(response, 401, "Authentication required.");
        return;
      }

      ok(response, await runSearch(me, request.query.q, limits));
    } catch (error) {
      console.error("Search failed:", error);
      fail(response, 500, "Search failed. Please try again.");
    }
  };

/** GET /api/search?q=...  full results */
export const searchAll = createHandler(FULL_LIMITS);

/** GET /api/search/suggest?q=...  short list for the dropdown while typing */
export const suggestAll = createHandler(SUGGEST_LIMITS);