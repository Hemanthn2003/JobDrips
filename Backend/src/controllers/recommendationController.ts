import type { Request, Response } from "express";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

import Profile from "../models/Profile.js";
import Recommendation from "../models/Recommendation.js";
import { User } from "../models/User.js";
import type { AuthenticatedRequest } from "../utils/authMiddleware.js";
import {
  buildKeywordProfile,
  compareKeywords,
  headlineOf,
  sameCity,
  sameCollege,
  type ProfileLike,
} from "../utils/recommendationEngine.js";
import {
  acceptedFriendIds,
  collectEngagement,
  mutualFriendIds,
} from "../utils/recommendationGraph.js";

// --------------------------------------------------
// Settings
// --------------------------------------------------

/** A person who was never opened is marked "unseen" after this many days. */
const UNSEEN_AFTER_DAYS = 7;
/** Most people shown on the page at once. */
const MAX_VISIBLE = 50;
/** Most new people added by one refresh. */
const MAX_NEW_PER_RUN = 20;
/** New people are looked for at most this often (unless the list is nearly empty). */
const REGENERATE_EVERY_MS = 10 * 60 * 1000;
const REGENERATE_WHEN_LOW_MS = 2 * 60 * 1000;
const LOW_LIST_SIZE = 8;
/** Profiles scanned for keyword matches in one refresh. */
const CANDIDATE_SCAN_LIMIT = 600;
/** Friends whose posts / stories are checked for likes and comments. */
const MAX_FRIENDS_SCANNED = 150;
/** Mutual friends sent to the page per person (the count is always exact). */
const MAX_MUTUAL_LISTED = 60;
/** Own profile needs at least this many specific keywords to be matched. */
const MIN_OWN_KEYWORDS = 2;

// --------------------------------------------------
// Types and helpers
// --------------------------------------------------

interface LeanProfile extends ProfileLike {
  userid: string;
  username?: string;
  profileimage?: string;
  friends?: Array<{ userid: string; friendshipAccepted?: boolean }>;
  requests?: Array<{ profile?: { userid?: string }; accept?: boolean }>;
  posts?: Array<{
    captions?: { content?: string };
    hashtags?: string[];
    visibility?: string;
    archived?: boolean;
    likes?: Array<{ userId?: string }>;
    comments?: Array<{ userId?: string; likes?: string[]; visible?: boolean }>;
    shares?: Array<{ fromUserId?: string }>;
    saves?: Array<{ userId?: string }>;
  }>;
  stories?: Array<{ likes?: string[]; viewers?: Array<{ userId?: string }> }>;
}

interface EntryRow {
  userid: string;
  action: string;
  recommendedOn: Date;
  seenAt?: Date | null;
  score?: number;
  tags?: string[];
}

const PROFILE_FIELDS =
  "userid username profileimage bio location experience education.college friends " +
  "requests.profile.userid requests.accept " +
  "posts.captions.content posts.hashtags posts.visibility posts.archived";

const viewerId = (request: Request): string =>
  String((request as AuthenticatedRequest).userId || "");

const ok = (response: Response, data: unknown, status = 200) =>
  response.status(status).json({ success: true, data });

const fail = (response: Response, status: number, message: string) =>
  response.status(status).json({ success: false, message });

const acceptedIds = (profile?: LeanProfile | null): string[] => acceptedFriendIds(profile);

const loadNames = async (ids: string[]): Promise<Map<string, string>> => {
  const valid = [...new Set(ids)].filter((id) => mongoose.isValidObjectId(id));
  if (valid.length === 0) return new Map();

  const users = (await User.find({ _id: { $in: valid } })
    .select("name")
    .lean()) as unknown as Array<{ _id: unknown; name?: string }>;

  return new Map(users.map((user) => [String(user._id), user.name ?? ""]));
};

/** One document per user; created the first time the page is opened. */
const ensureDoc = async (me: string) => {
  try {
    return await Recommendation.findOneAndUpdate(
      { recommendationsFor: me },
      { $setOnInsert: { recommendationId: randomUUID() } },
      { upsert: true, new: true },
    );
  } catch (error) {
    // Two requests created it at the same moment: the other one won.
    if ((error as { code?: number }).code === 11000) {
      return Recommendation.findOne({ recommendationsFor: me });
    }
    throw error;
  }
};

/** pending + never opened for 7 days  ->  "unseen" */
const expireUnseen = async (me: string): Promise<void> => {
  const cutoff = new Date(Date.now() - UNSEEN_AFTER_DAYS * 24 * 60 * 60 * 1000);

  await Recommendation.updateOne(
    { recommendationsFor: me },
    { $set: { "recommendations.$[r].action": "unseen" } },
    {
      arrayFilters: [
        { "r.action": "pending", "r.seenAt": null, "r.recommendedOn": { $lt: cutoff } },
      ],
    },
  );
};

// --------------------------------------------------
// Finding new people
//
// Priority:
//   1. people (friends or strangers) who liked / commented on / shared / saved my
//      friends' posts, or liked / viewed my friends' stories
//   2. people with the most mutual friends
//   3. the highest keyword similarity
// Everybody must reach the keyword similarity limit (see MIN_SIMILARITY).
// --------------------------------------------------

const generateFor = async (me: string): Promise<void> => {
  const mineDoc = (await Profile.findOne({ userid: me })
    .select(PROFILE_FIELDS)
    .lean()) as unknown as LeanProfile | null;

  if (!mineDoc) return;

  const mine = buildKeywordProfile(mineDoc, { publicPostsOnly: false });
  const keywordCount = mine.specific.size;
  const now = new Date();

  const existing = (await Recommendation.findOne({ recommendationsFor: me })
    .select("recommendations.userid recommendations.action")
    .lean()) as { recommendations?: Array<{ userid: string; action: string }> } | null;

  const entries = existing?.recommendations ?? [];
  const pendingCount = entries.filter((entry) => entry.action === "pending").length;
  const room = MAX_VISIBLE - pendingCount;

  if (keywordCount < MIN_OWN_KEYWORDS || room <= 0) {
    await Recommendation.updateOne(
      { recommendationsFor: me },
      { $set: { lastGeneratedAt: now, lastKeywordCount: keywordCount } },
    );
    return;
  }

  const friendIds = acceptedIds(mineDoc);
  const friendSet = new Set(friendIds);
  const incoming = (mineDoc.requests ?? [])
    .map((request) => request.profile?.userid ?? "")
    .filter(Boolean);

  // Never suggest: me, my friends, people who asked me, or anybody who is
  // already somewhere in my recommendations list (pending / added / skipped / unseen).
  const blocked = new Set<string>([
    me,
    ...friendIds,
    ...incoming,
    ...entries.map((entry) => entry.userid),
  ]);

  // ---- who engaged with my friends' content, and friends of friends ----
  const friendDocs = friendIds.length
    ? ((await Profile.find({ userid: { $in: friendIds.slice(0, MAX_FRIENDS_SCANNED) } })
        .select(
          "userid friends posts.archived posts.likes.userId " +
            "posts.comments.userId posts.comments.likes posts.comments.visible " +
            "posts.shares.fromUserId posts.saves.userId " +
            "stories.likes stories.viewers.userId",
        )
        .lean()) as unknown as LeanProfile[])
    : [];

  // Anybody (friend or NOT) who liked, commented on, shared or saved my friends'
  // posts, or reacted to their stories, plus the friends of my friends.
  const { engagement, friendsOfFriends } = collectEngagement(friendDocs, blocked);

  // ---- candidate pool ----
  // NOTE: for a very large user base, replace this scan with a keyword index.
  const extraIds = [...new Set([...engagement.keys(), ...friendsOfFriends])].slice(0, 400);

  const [extra, scanned] = (await Promise.all([
    extraIds.length
      ? Profile.find({ userid: { $in: extraIds } }).select(PROFILE_FIELDS).lean()
      : Promise.resolve([]),
    Profile.find({
      userid: { $nin: [...blocked] },
      $or: [
        { bio: { $ne: "" } },
        { "experience.0": { $exists: true } },
        { "posts.0": { $exists: true } },
      ],
    })
      .sort({ updatedAt: -1 })
      .limit(CANDIDATE_SCAN_LIMIT)
      .select(PROFILE_FIELDS)
      .lean(),
  ])) as unknown as [LeanProfile[], LeanProfile[]];

  const pool = new Map<string, LeanProfile>();
  for (const candidate of [...extra, ...scanned]) pool.set(candidate.userid, candidate);

  // ---- keyword similarity ----
  const scored: Array<{
    userid: string;
    ratio: number;
    engaged: number;
    mutual: number;
    tags: string[];
  }> = [];

  for (const candidate of pool.values()) {
    if (blocked.has(candidate.userid)) continue;
    // I already sent this person a friend request.
    if ((candidate.requests ?? []).some((request) => request.profile?.userid === me)) continue;

    // Only public posts of people I am not friends with are read.
    const theirs = buildKeywordProfile(candidate, { publicPostsOnly: true });
    const result = compareKeywords(mine, theirs);
    if (!result.matched) continue;

    const tags: string[] = [];
    if (sameCollege(mine, theirs)) tags.push("college");
    if (result.sharedWork >= 2) tags.push("industry");
    if (sameCity(mine, theirs)) tags.push("nearby");

    scored.push({
      userid: candidate.userid,
      ratio: result.ratio,
      engaged: engagement.get(candidate.userid) ?? 0,
      mutual: mutualFriendIds(friendSet, candidate, me).length,
      tags,
    });
  }

  scored.sort(
    (a, b) =>
      Number(b.engaged > 0) - Number(a.engaged > 0) ||
      b.mutual - a.mutual ||
      b.ratio - a.ratio ||
      b.engaged - a.engaged,
  );

  const fresh = scored.slice(0, Math.min(MAX_NEW_PER_RUN, room)).map((item) => ({
    userid: item.userid,
    action: "pending",
    recommendedOn: now,
    seenAt: null,
    actedAt: null,
    score: Math.round(item.ratio * 100),
    tags: item.tags,
  }));

  await Recommendation.updateOne(
    { recommendationsFor: me },
    {
      $set: { lastGeneratedAt: now, lastKeywordCount: keywordCount },
      // Newest people go to the top; older ones are pushed down.
      ...(fresh.length ? { $push: { recommendations: { $each: fresh, $position: 0 } } } : {}),
    },
  );
};

// One refresh per user at a time (two open tabs must not add the same people twice).
const running = new Map<string, Promise<void>>();

const generateOnce = (me: string): Promise<void> => {
  const current = running.get(me);
  if (current) return current;

  const job = generateFor(me)
    .catch((error) => console.error("Generate recommendations failed:", error))
    .finally(() => running.delete(me));

  running.set(me, job);
  return job;
};

// --------------------------------------------------
// LIST
// GET /api/recommendations
// --------------------------------------------------

export const listRecommendations = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const me = viewerId(request);
    if (!me) { fail(response, 401, "Authentication required."); return; }

    await ensureDoc(me);
    await expireUnseen(me);

    const meta = (await Recommendation.findOne({ recommendationsFor: me })
      .select("lastGeneratedAt recommendations.action")
      .lean()) as {
      lastGeneratedAt?: Date | null;
      recommendations?: Array<{ action: string }>;
    } | null;

    const pendingCount = (meta?.recommendations ?? []).filter(
      (entry) => entry.action === "pending",
    ).length;
    const age = meta?.lastGeneratedAt
      ? Date.now() - new Date(meta.lastGeneratedAt).getTime()
      : Infinity;

    if (age > REGENERATE_EVERY_MS || (pendingCount < LOW_LIST_SIZE && age > REGENERATE_WHEN_LOW_MS)) {
      await generateOnce(me);
    }

    const doc = (await Recommendation.findOne({ recommendationsFor: me }).lean()) as {
      recommendations?: EntryRow[];
      lastKeywordCount?: number | null;
    } | null;

    const pending = (doc?.recommendations ?? [])
      .filter((entry) => entry.action === "pending")
      .slice(0, MAX_VISIBLE * 2);

    const ids = pending.map((entry) => entry.userid);

    const [mineDoc, peopleRows] = (await Promise.all([
      Profile.findOne({ userid: me }).select("userid friends requests.profile.userid").lean(),
      ids.length
        ? Profile.find({ userid: { $in: ids } })
            .select(
              "userid username profileimage bio location experience education.college " +
                "friends requests.profile.userid requests.accept",
            )
            .lean()
        : Promise.resolve([]),
    ])) as unknown as [LeanProfile | null, LeanProfile[]];

    const friendSet = new Set(acceptedIds(mineDoc));
    const incoming = new Set(
      (mineDoc?.requests ?? []).map((item) => item.profile?.userid ?? "").filter(Boolean),
    );
    const people = new Map(peopleRows.map((person) => [person.userid, person]));

    const addedIds: string[] = [];
    const visible: Array<{ entry: EntryRow; person: LeanProfile; mutualIds: string[] }> = [];

    for (const entry of pending) {
      const person = people.get(entry.userid);
      if (!person) continue; // account no longer exists
      if (incoming.has(entry.userid)) continue; // they asked me: it is in my notifications

      // Became a friend / I sent a request (maybe from their profile page): status "added".
      const requestedByMe = (person.requests ?? []).some(
        (item) => item.profile?.userid === me && !item.accept,
      );
      if (friendSet.has(entry.userid) || requestedByMe) {
        addedIds.push(entry.userid);
        continue;
      }

      visible.push({
        entry,
        person,
        mutualIds: mutualFriendIds(friendSet, person, me),
      });
    }

    if (addedIds.length > 0) {
      await Recommendation.updateOne(
        { recommendationsFor: me },
        {
          $set: {
            "recommendations.$[r].action": "added",
            "recommendations.$[r].actedAt": new Date(),
          },
        },
        { arrayFilters: [{ "r.userid": { $in: addedIds }, "r.action": "pending" }] },
      );
    }

    const shown = visible.slice(0, MAX_VISIBLE);
    const mutualIds = [...new Set(shown.flatMap((item) => item.mutualIds))];

    const [mutualRows, names] = await Promise.all([
      mutualIds.length
        ? (Profile.find({ userid: { $in: mutualIds } })
            .select("userid username profileimage")
            .lean() as unknown as Promise<LeanProfile[]>)
        : Promise.resolve([] as LeanProfile[]),
      loadNames([...shown.map((item) => item.person.userid), ...mutualIds]),
    ]);

    const mutualInfo = new Map(mutualRows.map((row) => [row.userid, row]));

    const items = shown.map(({ entry, person, mutualIds: mutual }) => ({
      userid: person.userid,
      name: names.get(person.userid) || person.username || "JobDrips member",
      username: person.username ?? "",
      profileimage: person.profileimage ?? "",
      headline: headlineOf(person),
      location: (person.location ?? "").trim(),
      mutualCount: mutual.length,
      mutualFriends: mutual.slice(0, MAX_MUTUAL_LISTED).map((id) => ({
        userid: id,
        username: mutualInfo.get(id)?.username ?? "",
        name: names.get(id) || mutualInfo.get(id)?.username || "JobDrips member",
        profileimage: mutualInfo.get(id)?.profileimage ?? "",
      })),
      tags: entry.tags ?? [],
      matchPercent: entry.score ?? 0,
      recommendedOn: entry.recommendedOn,
    }));

    ok(response, {
      items,
      // true when the user's own profile has too few keywords to match anybody
      needsProfile:
        doc?.lastKeywordCount !== null &&
        doc?.lastKeywordCount !== undefined &&
        doc.lastKeywordCount < MIN_OWN_KEYWORDS,
    });
  } catch (error) {
    console.error("List recommendations failed:", error);
    fail(response, 500, "Unable to load your recommendations.");
  }
};

// --------------------------------------------------
// STATUS CHANGES
// --------------------------------------------------

/** Updates one person in my list. Returns false when nothing matched. */
const updateEntry = async (
  me: string,
  userid: string,
  set: Record<string, unknown>,
  match: Record<string, unknown> = {},
): Promise<boolean> => {
  const prefixed = Object.fromEntries(
    Object.entries(set).map(([key, value]) => [`recommendations.$.${key}`, value]),
  );

  const result = await Recommendation.updateOne(
    { recommendationsFor: me, recommendations: { $elemMatch: { userid, ...match } } },
    { $set: prefixed },
  );

  return result.matchedCount > 0;
};

const targetOf = (request: Request): string => String(request.params.userid || "").trim();

// POST /api/recommendations/:userid/skip   (the X button)
export const skipRecommendation = async (request: Request, response: Response): Promise<void> => {
  try {
    const me = viewerId(request);
    if (!me) { fail(response, 401, "Authentication required."); return; }

    const userid = targetOf(request);
    if (!userid) { fail(response, 400, "A user ID is required."); return; }

    // A person who was already added stays "added".
    const changed = await updateEntry(
      me,
      userid,
      { action: "skipped", actedAt: new Date() },
      { action: { $in: ["pending", "unseen"] } },
    );

    ok(response, { changed });
  } catch (error) {
    console.error("Skip recommendation failed:", error);
    fail(response, 500, "Unable to skip this person.");
  }
};

// POST /api/recommendations/:userid/added   (after a friend request was sent)
export const markAdded = async (request: Request, response: Response): Promise<void> => {
  try {
    const me = viewerId(request);
    if (!me) { fail(response, 401, "Authentication required."); return; }

    const userid = targetOf(request);
    if (!userid) { fail(response, 400, "A user ID is required."); return; }

    const changed = await updateEntry(
      me,
      userid,
      { action: "added", actedAt: new Date() },
      { action: { $in: ["pending", "unseen", "skipped"] } },
    );

    ok(response, { changed });
  } catch (error) {
    console.error("Mark recommendation added failed:", error);
    fail(response, 500, "Unable to update this recommendation.");
  }
};

// POST /api/recommendations/:userid/seen   (the profile was opened from the list)
export const markSeen = async (request: Request, response: Response): Promise<void> => {
  try {
    const me = viewerId(request);
    if (!me) { fail(response, 401, "Authentication required."); return; }

    const userid = targetOf(request);
    if (!userid) { fail(response, 400, "A user ID is required."); return; }

    const changed = await updateEntry(me, userid, { seenAt: new Date() }, { seenAt: null });

    ok(response, { changed });
  } catch (error) {
    console.error("Mark recommendation seen failed:", error);
    fail(response, 500, "Unable to update this recommendation.");
  }
};
