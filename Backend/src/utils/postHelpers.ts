import mongoose from "mongoose";
import Profile from "../models/Profile.js";
import { User } from "../models/User.js";

// --------------------------------------------------
// Types
// --------------------------------------------------

export type Relationship =
  | "self"
  | "friends"
  | "requested"
  | "received"
  | "none";

export interface FriendEntry {
  userid: string;
  username?: string;
  friendshipAccepted: boolean;
}

export interface RequestEntry {
  profile?: { userid?: string };
  accept?: boolean;
}

export interface RelationSource {
  userid: string;
  friends?: FriendEntry[];
  requests?: RequestEntry[];
}

export interface PersonInfo {
  userid: string;
  username: string;
  name?: string;
  profileimage: string;
}

export interface MentionRef {
  userId: string;
  username: string;
}

export interface RawComment {
  commentId: string;
  userId: string;
  username?: string;
  commentText: string;
  parentCommentId?: string | null;
  mentions?: MentionRef[];
  likes?: string[];
  commentedTo?: string;
  notified?: boolean;
  visible?: boolean;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface RawPost {
  postId: string;
  userid: string;
  createdAt?: Date | string;
  imageUrl?: Record<string, string>;
  captions?: { captionId?: string; content?: string };
  likes?: Array<{ likeId?: string; userId: string }>;
  comments?: RawComment[];
  shares?: Array<{ shareId?: string; fromUserId?: string; toUserId?: string }>;
  saves?: Array<{ saveId?: string; userId: string }>;
  mentions?: {
    mentionId?: string;
    mentions?: MentionRef[];
    notifiedUserIds?: string[];
  };
  hashtags?: string[];
  visibility?: "public" | "friends" | "private";
  archived?: boolean;
  settings?: {
    hideLikeCount?: boolean;
    hideComments?: boolean;
    hideShareCount?: boolean;
    hideSaveCount?: boolean;
  };
}

// --------------------------------------------------
// Mentions
// --------------------------------------------------

/** Unique lower-case usernames written as @name inside a text. */
export const extractMentionNames = (text: string): string[] => {
  const names = new Set<string>();

  for (const match of text.matchAll(/@([a-zA-Z0-9_.]{3,30})/g)) {
    const name = (match[1] ?? "").replace(/\.+$/, "").toLowerCase();
    if (name.length >= 3) names.add(name);
  }

  return [...names];
};

// --------------------------------------------------
// Friend relationships
// --------------------------------------------------

/** Relationship between the viewer and one other person. */
export const getRelationship = (
  viewerId: string,
  viewer: RelationSource | null,
  target: RelationSource,
): Relationship => {
  if (viewerId === target.userid) return "self";

  const mine = (viewer?.friends ?? []).find(
    (friend) => friend.userid === target.userid,
  );
  const theirs = (target.friends ?? []).find(
    (friend) => friend.userid === viewerId,
  );

  if (mine?.friendshipAccepted && theirs?.friendshipAccepted) return "friends";

  const received = (viewer?.requests ?? []).some(
    (request) => request.profile?.userid === target.userid && !request.accept,
  );
  if (received) return "received";

  // A request only lives in the receiver's list until it is accepted.
  const requested = (target.requests ?? []).some(
    (request) => request.profile?.userid === viewerId && !request.accept,
  );

  return requested ? "requested" : "none";
};

/** Which of these people already have a pending request from the viewer. */
export const loadRequestedIds = async (
  viewerId: string,
  ids: string[],
): Promise<Set<string>> => {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!viewerId || unique.length === 0) return new Set();

  const docs = await Profile.find({
    userid: { $in: unique },
    requests: { $elemMatch: { "profile.userid": viewerId, accept: false } },
  })
    .select("userid")
    .lean();

  return new Set(docs.map((doc) => String(doc.userid)));
};

/** Fast lookup for many people (used for friend lists). */
export const makeRelationLookup = (
  viewerId: string,
  viewer: RelationSource | null,
  requestedIds: Set<string> = new Set(),
) => {
  const accepted = new Set<string>();
  const incoming = new Set<string>();

  for (const friend of viewer?.friends ?? []) {
    if (friend.friendshipAccepted) accepted.add(friend.userid);
  }

  for (const request of viewer?.requests ?? []) {
    if (!request.accept && request.profile?.userid) {
      incoming.add(request.profile.userid);
    }
  }

  return (userid: string): Relationship =>
    userid === viewerId
      ? "self"
      : accepted.has(userid)
        ? "friends"
        : incoming.has(userid)
          ? "received"
          : requestedIds.has(userid)
            ? "requested"
            : "none";
};

export const acceptedFriendIds = (
  profile: { friends?: FriendEntry[] } | null,
): string[] =>
  (profile?.friends ?? [])
    .filter((friend) => friend.friendshipAccepted)
    .map((friend) => String(friend.userid));

// --------------------------------------------------
// People lookups
// --------------------------------------------------

export const loadPeople = async (
  ids: string[],
): Promise<Map<string, PersonInfo>> => {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const docs = await Profile.find({ userid: { $in: unique } })
    .select("userid username profileimage")
    .lean();

  return new Map(
    docs.map((doc) => [
      doc.userid,
      {
        userid: doc.userid,
        username: doc.username,
        profileimage: doc.profileimage || "",
      },
    ]),
  );
};

/** Name + photo for a person, combining their profile and account. */
export const loadPerson = async (
  userid: string,
  profile?: { username?: string; profileimage?: string } | null,
): Promise<PersonInfo> => {
  const user = mongoose.isValidObjectId(userid)
    ? await User.findById(userid).select("name profilePhoto").lean()
    : null;

  return {
    userid,
    username: profile?.username ?? "",
    name: user?.name || profile?.username || "",
    profileimage: profile?.profileimage || user?.profilePhoto || "",
  };
};

// --------------------------------------------------
// Serialising posts
// --------------------------------------------------

interface SerializeContext {
  viewerId: string;
  author?: PersonInfo;
  people?: Map<string, PersonInfo>;
  includeComments?: boolean;
}

/**
 * The three counts are hidden unless the owner ticked "Show ... count"
 * (hide... = false). A post that has no saved value yet counts as hidden.
 * Comments are shown unless the owner turned them off.
 */
export const normalizeSettings = (settings: RawPost["settings"]) => ({
  hideLikeCount: settings?.hideLikeCount ?? true,
  hideComments: Boolean(settings?.hideComments),
  hideShareCount: settings?.hideShareCount ?? true,
  hideSaveCount: settings?.hideSaveCount ?? true,
});

export const serializeComment = (
  comment: RawComment,
  viewerId: string,
  people?: Map<string, PersonInfo>,
) => {
  const person = people?.get(comment.userId);
  const created = comment.createdAt ? new Date(comment.createdAt).getTime() : 0;
  const updated = comment.updatedAt ? new Date(comment.updatedAt).getTime() : 0;

  return {
    commentId: comment.commentId,
    userId: comment.userId,
    username: person?.username || comment.username || "",
    profileImage: person?.profileimage || "",
    commentText: comment.commentText,
    parentCommentId: comment.parentCommentId ?? null,
    mentions: comment.mentions ?? [],
    likeCount: (comment.likes ?? []).length,
    liked: (comment.likes ?? []).includes(viewerId),
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    edited: updated - created > 1000,
  };
};

export const serializePost = (post: RawPost, context: SerializeContext) => {
  const { viewerId } = context;
  const visibleComments = (post.comments ?? []).filter(
    (comment) => comment.visible !== false,
  );

  // Comments turned off: the saved comments stay in the database,
  // but they are never sent to anyone.
  const commentsOff = Boolean(post.settings?.hideComments);

  return {
    postId: post.postId,
    userid: post.userid,
    createdAt: post.createdAt,
    imageUrl: post.imageUrl ?? {},
    captions: {
      captionId: post.captions?.captionId ?? "",
      content: post.captions?.content ?? "",
    },
    hashtags: post.hashtags ?? [],
    mentions: post.mentions?.mentions ?? [],
    visibility: post.visibility ?? "friends",
    archived: Boolean(post.archived),
    settings: normalizeSettings(post.settings),
    likeCount: (post.likes ?? []).length,
    commentCount: visibleComments.length,
    saveCount: (post.saves ?? []).length,
    shareCount: (post.shares ?? []).length,
    liked: (post.likes ?? []).some((like) => like.userId === viewerId),
    saved: (post.saves ?? []).some((save) => save.userId === viewerId),
    // True when this viewer has already sent the post to friends.
    shared: (post.shares ?? []).some((share) => share.fromUserId === viewerId),
    isOwner: post.userid === viewerId,
    ...(context.author ? { author: context.author } : {}),
    ...(context.includeComments && !commentsOff
      ? {
          comments: visibleComments.map((comment) =>
            serializeComment(comment, viewerId, context.people),
          ),
        }
      : {}),
  };
};

/** Posts a viewer may list on a profile, newest first. */
export const listablePosts = (posts: RawPost[], isOwner: boolean): RawPost[] =>
  posts
    .filter(
      (post) =>
        isOwner || (!post.archived && (post.visibility ?? "friends") !== "private"),
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt ?? 0).getTime() -
        new Date(a.createdAt ?? 0).getTime(),
    );