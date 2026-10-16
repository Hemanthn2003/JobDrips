import type { Response } from "express";
import mongoose from "mongoose";
import type { AuthenticatedRequest } from "../utils/authMiddleware.js";
import Profile from "../models/Profile.js";
import Report from "../models/Report.js";
import { User } from "../models/User.js";
import {
  acceptedFriendIds,
  loadPeople,
  loadPerson,
  serializePost,
  type FriendEntry,
  type RawPost,
} from "../utils/postHelpers.js";
import {
  buildInterest,
  isEligible,
  postTerms,
  similarity,
  suggestionScore,
  type InterestSource,
} from "../utils/feedRanking.js";

// --------------------------------------------------
// GET /api/feed
//
// One timeline, newest first, made of:
//   own       - my own posts (not archived)
//   friend    - posts of my accepted friends (public + friends-only, not archived)
//   suggested - PUBLIC posts of PUBLIC accounts I'm not connected to, picked when
//               their hashtags / caption match my interests (my profile, my posts,
//               posts I liked / saved / shared). Posts that my friends liked get a
//               boost and a lower match requirement.
//
// A post is never returned twice. Archived and reported posts are never returned.
// --------------------------------------------------

const MAX_FEED_POSTS = 300;
const MAX_SUGGESTED = 25;
/** Public posts read from the database per request (scored in memory). */
const CANDIDATE_LIMIT = 300;
/** Public posts newer than this are candidates; older ones only if friends liked them. */
const RECENT_DAYS = 45;
/** How many of my past interactions are used to learn my interests. */
const INTERACTION_LIMIT = 150;

type FeedSource = "own" | "friend" | "suggested";

interface FeedProfileDocument {
  userid: string;
  username?: string;
  profileimage?: string;
  bio?: string;
  friends?: FriendEntry[];
  posts?: RawPost[];
  isPrivate?: boolean;
  experience?: Array<{ role?: string; company?: string }>;
  education?: {
    college?: Array<{ name?: string; degree?: string; field?: string }>;
  };
}

interface InteractionRow {
  authorId: string;
  caption?: string;
  hashtags?: string[];
  liked?: boolean;
  saved?: boolean;
  shared?: boolean;
}

interface CandidateRow {
  userid: string;
  username?: string;
  profileimage?: string;
  posts: RawPost & { friendLikes?: number };
}

interface CollectedPost {
  post: RawPost;
  authorId: string;
  source: FeedSource;
  reason?: "similar" | "friends_liked";
}

const postKey = (authorId: string, postId: string) => `${authorId}:${postId}`;

/** What the viewer cares about: profile text + own posts + posts they interacted with. */
const buildViewerInterest = (
  profile: FeedProfileDocument,
  interactions: InteractionRow[],
) => {
  const sources: InterestSource[] = [];

  if (profile.bio) sources.push({ caption: profile.bio, weight: 0.5 });

  for (const job of profile.experience ?? []) {
    sources.push({ caption: `${job.role ?? ""} ${job.company ?? ""}`, weight: 1.5 });
  }

  for (const college of profile.education?.college ?? []) {
    sources.push({
      caption: `${college.degree ?? ""} ${college.field ?? ""}`,
      weight: 1,
    });
  }

  for (const post of profile.posts ?? []) {
    sources.push({
      caption: post.captions?.content ?? "",
      hashtags: post.hashtags ?? [],
      weight: 1,
    });
  }

  for (const item of interactions) {
    // a share says more than a save, a save more than a like
    const weight = (item.liked ? 2 : 0) + (item.saved ? 3 : 0) + (item.shared ? 4 : 0);
    sources.push({ caption: item.caption ?? "", hashtags: item.hashtags ?? [], weight });
  }

  return buildInterest(sources);
};

/** Posts I liked / saved / shared, anywhere in the database (newest first). */
const loadMyInteractions = async (me: string): Promise<InteractionRow[]> =>
  (await Profile.aggregate([
    {
      $match: {
        posts: {
          $elemMatch: {
            $or: [{ "likes.userId": me }, { "saves.userId": me }, { "shares.fromUserId": me }],
          },
        },
      },
    },
    {
      $project: {
        userid: 1,
        posts: {
          $filter: {
            input: { $ifNull: ["$posts", []] },
            as: "p",
            cond: {
              $or: [
                { $in: [me, { $ifNull: ["$$p.likes.userId", []] }] },
                { $in: [me, { $ifNull: ["$$p.saves.userId", []] }] },
                { $in: [me, { $ifNull: ["$$p.shares.fromUserId", []] }] },
              ],
            },
          },
        },
      },
    },
    { $unwind: "$posts" },
    { $sort: { "posts.createdAt": -1 } },
    { $limit: INTERACTION_LIMIT },
    {
      $project: {
        _id: 0,
        authorId: "$userid",
        caption: "$posts.captions.content",
        hashtags: "$posts.hashtags",
        liked: { $in: [me, { $ifNull: ["$posts.likes.userId", []] }] },
        saved: { $in: [me, { $ifNull: ["$posts.saves.userId", []] }] },
        shared: { $in: [me, { $ifNull: ["$posts.shares.fromUserId", []] }] },
      },
    },
  ])) as InteractionRow[];

/**
 * Public posts of PUBLIC accounts that are not me or my friends: recent ones, plus
 * older ones my friends liked. Each post carries `friendLikes` (how many of my
 * friends liked it).
 *
 * NOTE: this scans public profiles. For a very large user base, move posts into
 * their own collection with indexes (visibility, createdAt, hashtags).
 */
const loadCandidates = async (
  me: string,
  friendIds: string[],
): Promise<CandidateRow[]> => {
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);

  return (await Profile.aggregate([
    {
      $match: {
        isPrivate: { $ne: true },
        userid: { $nin: [me, ...friendIds] },
        "posts.visibility": "public",
      },
    },
    {
      $project: {
        userid: 1,
        username: 1,
        profileimage: 1,
        posts: {
          $map: {
            input: {
              $filter: {
                input: { $ifNull: ["$posts", []] },
                as: "p",
                cond: {
                  $and: [
                    { $eq: ["$$p.visibility", "public"] },
                    { $ne: ["$$p.archived", true] },
                  ],
                },
              },
            },
            as: "p",
            in: {
              $mergeObjects: [
                "$$p",
                {
                  friendLikes: {
                    $size: {
                      $setIntersection: [
                        { $ifNull: ["$$p.likes.userId", []] },
                        friendIds,
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
    { $unwind: "$posts" },
    {
      $match: {
        $or: [{ "posts.createdAt": { $gte: since } }, { "posts.friendLikes": { $gt: 0 } }],
      },
    },
    { $sort: { "posts.createdAt": -1 } },
    { $limit: CANDIDATE_LIMIT },
  ])) as CandidateRow[];
};

export const getFeed = async (
  request: AuthenticatedRequest,
  response: Response,
) => {
  try {
    const currentUserId = String(request.userId || "");

    if (!currentUserId) {
      return response.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const currentProfile = (await Profile.findOne({ userid: currentUserId })
      .select(
        "userid username profileimage bio isPrivate friends posts experience education.college",
      )
      .lean()) as FeedProfileDocument | null;

    // The viewer is returned so the UI can show their name in the comment box.
    const viewer = await loadPerson(currentUserId, currentProfile);

    if (!currentProfile) {
      return response.json({
        success: true,
        data: { posts: [], total: 0, viewer },
      });
    }

    const friendIds = [
      ...new Set(
        acceptedFriendIds(currentProfile).filter(
          (id) => id.length > 0 && id !== currentUserId,
        ),
      ),
    ];

    // Posts this person reported are hidden from their feed.
    const reported = await Report.find({ reportedByUserId: currentUserId })
      .select("postId")
      .lean();
    const reportedIds = new Set(reported.map((item) => String(item.postId)));

    // Friends' profiles, my interactions and the public candidates load together.
    const [friendProfiles, interactions, candidates] = await Promise.all([
      friendIds.length
        ? (Profile.find({
            userid: { $in: friendIds },
            "posts.0": { $exists: true },
          }).lean() as unknown as Promise<FeedProfileDocument[]>)
        : Promise.resolve([] as FeedProfileDocument[]),
      loadMyInteractions(currentUserId),
      loadCandidates(currentUserId, friendIds),
    ]);

    // One entry per post, whichever way it was found. Earlier sources win.
    const collected = new Map<string, CollectedPost>();
    const add = (entry: CollectedPost) => {
      const key = postKey(entry.authorId, entry.post.postId);
      if (!collected.has(key)) collected.set(key, entry);
    };

    // ---- 1. my own posts (never archived) ----
    for (const post of currentProfile.posts ?? []) {
      if (post.archived) continue;
      if (reportedIds.has(String(post.postId))) continue;
      add({ post: { ...post, userid: currentUserId }, authorId: currentUserId, source: "own" });
    }

    // ---- 2. friends' posts (public + friends-only, never archived) ----
    for (const profile of friendProfiles) {
      const authorId = String(profile.userid);

      for (const post of profile.posts ?? []) {
        const visibility = post.visibility || "friends";

        if (visibility !== "public" && visibility !== "friends") continue;
        if (post.archived) continue;
        if (reportedIds.has(String(post.postId))) continue;

        add({ post: { ...post, userid: authorId }, authorId, source: "friend" });
      }
    }

    // ---- 3. suggested public posts that match my interests ----
    const interest = buildViewerInterest(currentProfile, interactions);
    const knownAuthors = new Set(interactions.map((item) => String(item.authorId)));

    const suggestedAuthors = new Map<string, { username?: string; profileimage?: string }>();

    if (interest.size > 0) {
      const scored: Array<{
        row: CandidateRow;
        score: number;
        reason: "similar" | "friends_liked";
      }> = [];

      for (const row of candidates) {
        const post = row.posts;
        const authorId = String(row.userid);

        if (reportedIds.has(String(post.postId))) continue;
        if (collected.has(postKey(authorId, post.postId))) continue;

        const friendLikes = Number(post.friendLikes ?? 0);
        const sim = similarity(
          interest,
          postTerms(post.captions?.content ?? "", post.hashtags ?? []),
        );

        if (!isEligible(sim, friendLikes)) continue;

        scored.push({
          row,
          score: suggestionScore(sim, friendLikes, knownAuthors.has(authorId)),
          reason: friendLikes > 0 ? "friends_liked" : "similar",
        });
      }

      scored.sort((a, b) => b.score - a.score);

      for (const { row, reason } of scored.slice(0, MAX_SUGGESTED)) {
        const authorId = String(row.userid);
        suggestedAuthors.set(authorId, {
          username: row.username,
          profileimage: row.profileimage,
        });
        add({
          post: { ...row.posts, userid: authorId },
          authorId,
          source: "suggested",
          reason,
        });
      }
    }

    const items = [...collected.values()];

    // ---- names, photos and commenters ----
    const authorIds = [...new Set(items.map((item) => item.authorId))];

    const users = await User.find({
      _id: { $in: authorIds.filter((id) => mongoose.isValidObjectId(id)) },
    })
      .select("_id name profilePhoto")
      .lean();

    const usersById = new Map(users.map((user) => [String(user._id), user]));

    const profilesById = new Map<
      string,
      { username?: string; profileimage?: string }
    >();
    for (const [id, info] of suggestedAuthors) profilesById.set(id, info);
    for (const profile of friendProfiles) profilesById.set(String(profile.userid), profile);
    profilesById.set(currentUserId, currentProfile);

    const people = await loadPeople(
      items.flatMap((item) =>
        (item.post.comments || []).map((comment) => comment.userId),
      ),
    );

    const feedPosts = items.map(({ post, authorId, source, reason }) => {
      const profile = profilesById.get(authorId);
      const user = usersById.get(authorId);

      return {
        ...serializePost(post, {
          viewerId: currentUserId,
          people,
          includeComments: true,
          author: {
            userid: authorId,
            username: profile?.username ?? "",
            name: user?.name || profile?.username || "",
            profileimage: profile?.profileimage || user?.profilePhoto || "",
          },
        }),
        source,
        ...(reason ? { reason } : {}),
      };
    });

    // Newest first: a post that arrived while the feed was closed lands on top.
    feedPosts.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0).getTime();
      const dateB = new Date(b.createdAt || 0).getTime();

      return dateB - dateA;
    });

    const limited = feedPosts.slice(0, MAX_FEED_POSTS);

    return response.json({
      success: true,
      data: {
        posts: limited,
        total: limited.length,
        viewer,
      },
    });
  } catch (error) {
    console.error("getFeed:", error);

    return response.status(500).json({
      success: false,
      message: "Unable to load the feed.",
    });
  }
};