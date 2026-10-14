import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";

import Profile from "../models/Profile.js";
import Report from "../models/Report.js";
import type { AuthenticatedRequest } from "../utils/authMiddleware.js";
import {
  acceptedFriendIds,
  extractMentionNames,
  getRelationship,
  loadPeople,
  loadPerson,
  normalizeSettings,
  serializeComment,
  serializePost,
  type MentionRef,
  type PersonInfo,
  type RawComment,
  type RawPost,
  type RelationSource,
} from "../utils/postHelpers.js";
import { createMessage } from "./messageController.js";
import { createNotification } from "../utils/notificationService.js";

// --------------------------------------------------
// Shared helpers
// --------------------------------------------------

type Body = Record<string, unknown>;

interface OwnerDoc extends RelationSource {
  username: string;
  profileimage?: string;
  isPrivate?: boolean;
  posts?: RawPost[];
}

interface ViewerDoc extends RelationSource {
  username: string;
  profileimage?: string;
}

interface PostContext {
  viewerId: string;
  viewer: ViewerDoc | null;
  owner: OwnerDoc;
  post: RawPost;
  isOwner: boolean;
}

const MAX_COMMENT_LENGTH = 1000;
const MAX_CAPTION_LENGTH = 5000;

const bodyOf = (request: Request): Body => (request.body ?? {}) as Body;

const sendError = (response: Response, status: number, message: string) => {
  response.status(status).json({ success: false, message });
};

const serverError = (response: Response, label: string, error: unknown) => {
  console.error(`${label} failed:`, error);
  sendError(response, 500, "Something went wrong. Please try again.");
};

const viewerIdOf = (request: Request): string =>
  String((request as AuthenticatedRequest).userId || "");

const param = (request: Request, key: string): string => {
  const value = request.params[key];
  return typeof value === "string" ? value : "";
};

const loadRawPost = async (
  ownerId: string,
  postId: string,
): Promise<RawPost | null> => {
  const doc = (await Profile.findOne({
    userid: ownerId,
    "posts.postId": postId,
  })
    .select({ posts: { $elemMatch: { postId } } })
    .lean()) as unknown as { posts?: RawPost[] } | null;

  return doc?.posts?.[0] ?? null;
};

/**
 * Loads the post named in the URL and checks that the viewer may see it.
 * Sends the error response itself and returns null when access is refused.
 */
const loadPostContext = async (
  request: Request,
  response: Response,
): Promise<PostContext | null> => {
  const viewerId = viewerIdOf(request);

  if (!viewerId) {
    sendError(response, 401, "Authentication required.");
    return null;
  }

  const ownerId = param(request, "ownerId");
  const postId = param(request, "postId");

  const owner = (await Profile.findOne({
    userid: ownerId,
    "posts.postId": postId,
  })
    .select({
      userid: 1,
      username: 1,
      profileimage: 1,
      isPrivate: 1,
      friends: 1,
      requests: 1,
      posts: { $elemMatch: { postId } },
    })
    .lean()) as unknown as OwnerDoc | null;

  const post = owner?.posts?.[0];

  if (!owner || !post) {
    sendError(response, 404, "Post not found.");
    return null;
  }

  const viewer = (await Profile.findOne({ userid: viewerId })
    .select("userid username profileimage friends requests")
    .lean()) as unknown as ViewerDoc | null;

  const isOwner = viewerId === owner.userid;

  if (!isOwner) {
    if (post.archived || (post.visibility ?? "friends") === "private") {
      sendError(response, 404, "Post not found.");
      return null;
    }

    const isFriend = getRelationship(viewerId, viewer, owner) === "friends";

    if (owner.isPrivate && !isFriend) {
      sendError(response, 403, "This account is private.");
      return null;
    }
  }

  return { viewerId, viewer, owner, post, isOwner };
};

/** People the viewer may @mention: their friends plus the post owner. */
const allowedMentionIds = (context: PostContext): Set<string> =>
  new Set([...acceptedFriendIds(context.viewer), context.owner.userid]);

const resolveMentions = async (
  text: string,
  allowed: Set<string>,
): Promise<MentionRef[]> => {
  const names = extractMentionNames(text);
  if (names.length === 0) return [];

  const found = await Profile.find({ username: { $in: names } })
    .select("userid username")
    .lean();

  return found
    .filter((person) => allowed.has(person.userid))
    .map((person) => ({ userId: person.userid, username: person.username }));
};

interface MentionNotice {
  senderId: string;
  senderUsername: string;
  text: string;
  postId: string;
  ownerId: string;
  commentId?: string;
  where: "comment" | "post";
}

/** One "mention" notification per mentioned person (never repeated). */
const notifyMentions = async (
  mentions: MentionRef[],
  info: MentionNotice,
): Promise<string[]> => {
  const done: string[] = [];

  await Promise.all(
    mentions
      .filter((mention) => mention.userId !== info.senderId)
      .map(async (mention) => {
        const key =
          info.where === "comment"
            ? `mention:comment:${info.commentId ?? info.postId}:${mention.userId}`
            : `mention:post:${info.postId}:${mention.userId}`;

        const created = await createNotification({
          type: "mention",
          recipientUserId: mention.userId,
          actorUserId: info.senderId,
          dedupeKey: key,
          message: `${info.senderUsername} mentioned you in a ${info.where}.`,
          postId: info.postId,
          postOwnerId: info.ownerId,
          commentId: info.commentId,
          text: info.text,
          mentionIn: info.where,
        });

        if (created) done.push(mention.userId);
      }),
  );

  return done;
};

/**
 * Notifications for a brand new comment: the post owner, the person being
 * replied to, and everyone mentioned. Nobody receives two for the same comment.
 */
const notifyNewComment = async (info: {
  commenterId: string;
  commenterName: string;
  ownerId: string;
  postId: string;
  commentId: string;
  text: string;
  parentAuthorId: string | null;
  mentions: MentionRef[];
}): Promise<void> => {
  const mentionedIds = new Set(info.mentions.map((item) => item.userId));

  await notifyMentions(info.mentions, {
    senderId: info.commenterId,
    senderUsername: info.commenterName,
    text: info.text,
    postId: info.postId,
    ownerId: info.ownerId,
    commentId: info.commentId,
    where: "comment",
  });

  if (!mentionedIds.has(info.ownerId)) {
    await createNotification({
      type: "comment",
      recipientUserId: info.ownerId,
      actorUserId: info.commenterId,
      dedupeKey: `comment:${info.commentId}:${info.ownerId}`,
      message: `${info.commenterName} commented on your post.`,
      postId: info.postId,
      postOwnerId: info.ownerId,
      commentId: info.commentId,
      text: info.text,
    });
  }

  if (
    info.parentAuthorId &&
    info.parentAuthorId !== info.ownerId &&
    !mentionedIds.has(info.parentAuthorId)
  ) {
    await createNotification({
      type: "comment_reply",
      recipientUserId: info.parentAuthorId,
      actorUserId: info.commenterId,
      dedupeKey: `comment_reply:${info.commentId}:${info.parentAuthorId}`,
      message: `${info.commenterName} replied to your comment.`,
      postId: info.postId,
      postOwnerId: info.ownerId,
      commentId: info.commentId,
      text: info.text,
    });
  }
};

const normalizeHashtags = (value: unknown): string[] | null => {
  const source =
    typeof value === "string"
      ? value.split(/[\s,]+/)
      : Array.isArray(value)
        ? value
        : null;

  if (!source) return null;

  const tags = new Set<string>();

  for (const item of source) {
    if (typeof item !== "string") return null;
    const tag = item.replace(/^#+/, "").trim();
    if (!tag) continue;
    if (!/^[A-Za-z0-9_]{1,50}$/.test(tag)) return null;
    tags.add(tag);
  }

  return tags.size <= 30 ? [...tags] : null;
};

// --------------------------------------------------
// GET ONE POST
// GET /api/posts/:ownerId/:postId
// --------------------------------------------------

export const getPost = async (request: Request, response: Response) => {
  try {
    const context = await loadPostContext(request, response);
    if (!context) return;

    const { viewerId, owner, post, viewer } = context;

    const [author, viewerPerson, people] = await Promise.all([
      loadPerson(owner.userid, owner),
      loadPerson(viewerId, viewer),
      loadPeople((post.comments ?? []).map((comment) => comment.userId)),
    ]);

    response.json({
      success: true,
      data: {
        post: serializePost(post, {
          viewerId,
          author,
          people,
          includeComments: true,
        }),
        viewer: viewerPerson,
      },
    });
  } catch (error) {
    serverError(response, "Get post", error);
  }
};

// --------------------------------------------------
// LIKE / UNLIKE
// POST /api/posts/:ownerId/:postId/like   Body: { liked: boolean }
// --------------------------------------------------

export const setPostLike = async (request: Request, response: Response) => {
  try {
    const context = await loadPostContext(request, response);
    if (!context) return;

    const liked = bodyOf(request).liked;

    if (typeof liked !== "boolean") {
      sendError(response, 400, "liked must be true or false.");
      return;
    }

    const { viewerId, owner, post } = context;

    if (liked) {
      // Only adds the like when this person is not already in the list.
      await Profile.updateOne(
        {
          userid: owner.userid,
          posts: {
            $elemMatch: { postId: post.postId, "likes.userId": { $ne: viewerId } },
          },
        },
        {
          $push: {
            "posts.$.likes": { likeId: randomUUID(), userId: viewerId },
          },
        },
      );
    } else {
      await Profile.updateOne(
        { userid: owner.userid, "posts.postId": post.postId },
        { $pull: { "posts.$.likes": { userId: viewerId } } },
      );
    }

    const fresh = await loadRawPost(owner.userid, post.postId);

    response.json({
      success: true,
      data: { liked, likeCount: (fresh?.likes ?? []).length },
    });
  } catch (error) {
    serverError(response, "Like post", error);
  }
};

// --------------------------------------------------
// SAVE / UNSAVE
// POST /api/posts/:ownerId/:postId/save   Body: { saved: boolean }
// Saved posts are copied into the viewer's profile (savedPosts).
// --------------------------------------------------

export const setPostSave = async (request: Request, response: Response) => {
  try {
    const context = await loadPostContext(request, response);
    if (!context) return;

    const saved = bodyOf(request).saved;

    if (typeof saved !== "boolean") {
      sendError(response, 400, "saved must be true or false.");
      return;
    }

    const { viewerId, owner, post, viewer } = context;

    if (!viewer) {
      sendError(response, 400, "Your profile was not found.");
      return;
    }

    if (saved) {
      await Profile.updateOne(
        {
          userid: owner.userid,
          posts: {
            $elemMatch: { postId: post.postId, "saves.userId": { $ne: viewerId } },
          },
        },
        {
          $push: {
            "posts.$.saves": { saveId: randomUUID(), userId: viewerId },
          },
        },
      );

      await Profile.updateOne(
        { userid: viewerId, "savedPosts.postId": { $ne: post.postId } },
        {
          $push: {
            savedPosts: {
              postId: post.postId,
              userid: owner.userid,
              ownerUsername: owner.username,
              ownerProfileImage: owner.profileimage || "",
              caption: post.captions?.content ?? "",
              imageUrl: post.imageUrl ?? {},
              hashtags: post.hashtags ?? [],
              createdAt: post.createdAt,
              savedAt: new Date(),
            },
          },
        },
      );
    } else {
      await Profile.updateOne(
        { userid: owner.userid, "posts.postId": post.postId },
        { $pull: { "posts.$.saves": { userId: viewerId } } },
      );

      await Profile.updateOne(
        { userid: viewerId },
        { $pull: { savedPosts: { postId: post.postId } } },
      );
    }

    const fresh = await loadRawPost(owner.userid, post.postId);

    response.json({
      success: true,
      data: { saved, saveCount: (fresh?.saves ?? []).length },
    });
  } catch (error) {
    serverError(response, "Save post", error);
  }
};

// --------------------------------------------------
// SHARE WITH FRIENDS
// POST /api/posts/:ownerId/:postId/share   Body: { toUserIds: string[], text? }
// Sends the post to each friend as a (demo) message.
// --------------------------------------------------

export const sharePost = async (request: Request, response: Response) => {
  try {
    const context = await loadPostContext(request, response);
    if (!context) return;

    const body = bodyOf(request);
    const { viewerId, viewer, owner, post } = context;

    if (
      !Array.isArray(body.toUserIds) ||
      body.toUserIds.some((id) => typeof id !== "string")
    ) {
      sendError(response, 400, "Choose at least one friend.");
      return;
    }

    const friends = new Set(acceptedFriendIds(viewer));
    const targets = [...new Set(body.toUserIds as string[])]
      .filter((id) => id !== viewerId && friends.has(id))
      .slice(0, 20);

    if (targets.length === 0) {
      sendError(response, 400, "Choose at least one friend.");
      return;
    }

    const text =
      typeof body.text === "string" ? body.text.trim().slice(0, 500) : "";

    await Promise.all(
      targets.map((recipientId) =>
        createMessage({
          senderUserId: viewerId,
          recipientUserId: recipientId,
          kind: "post_share",
          text: text || "Shared a post with you",
          sharedPostId: post.postId,
          sharedPostOwnerId: owner.userid,
        }),
      ),
    );

    await Profile.updateOne(
      { userid: owner.userid, "posts.postId": post.postId },
      {
        $push: {
          "posts.$.shares": {
            $each: targets.map((recipientId) => ({
              shareId: randomUUID(),
              fromUserId: viewerId,
              toUserId: recipientId,
            })),
          },
        },
      },
    );

    const fresh = await loadRawPost(owner.userid, post.postId);

    response.status(201).json({
      success: true,
      data: { sent: targets.length, shareCount: (fresh?.shares ?? []).length },
    });
  } catch (error) {
    serverError(response, "Share post", error);
  }
};

// --------------------------------------------------
// ADD A COMMENT OR REPLY
// POST /api/posts/:ownerId/:postId/comments
// Body: { commentText, parentCommentId? }
// --------------------------------------------------

export const addComment = async (request: Request, response: Response) => {
  try {
    const context = await loadPostContext(request, response);
    if (!context) return;

    const { viewerId, viewer, owner, post } = context;

    if (post.settings?.hideComments) {
      sendError(response, 403, "Comments are turned off for this post.");
      return;
    }

    const body = bodyOf(request);
    const text = typeof body.commentText === "string" ? body.commentText.trim() : "";

    if (!text || text.length > MAX_COMMENT_LENGTH) {
      sendError(
        response,
        400,
        `Write a comment of up to ${MAX_COMMENT_LENGTH} characters.`,
      );
      return;
    }

    // Replies are always attached to the top-level comment.
    let parentCommentId: string | null = null;

    if (typeof body.parentCommentId === "string" && body.parentCommentId) {
      const parent = (post.comments ?? []).find(
        (comment) =>
          comment.commentId === body.parentCommentId && comment.visible !== false,
      );

      if (!parent) {
        sendError(response, 404, "The comment you are replying to was not found.");
        return;
      }

      parentCommentId = parent.parentCommentId || parent.commentId;
    }

    const mentions = await resolveMentions(text, allowedMentionIds(context));
    const now = new Date();

    const comment: RawComment = {
      commentId: randomUUID(),
      userId: viewerId,
      username: viewer?.username ?? "",
      commentText: text,
      parentCommentId,
      mentions,
      likes: [],
      commentedTo: owner.userid,
      notified: false,
      visible: true,
      createdAt: now,
      updatedAt: now,
    };

    await Profile.updateOne(
      { userid: owner.userid, "posts.postId": post.postId },
      { $push: { "posts.$.comments": comment } },
    );

    // Notify once, then mark the comment as notified so it can never repeat.
    const parentAuthorId = parentCommentId
      ? ((post.comments ?? []).find(
          (item) => item.commentId === body.parentCommentId,
        )?.userId ?? null)
      : null;

    await notifyNewComment({
      commenterId: viewerId,
      commenterName: viewer?.username ?? "Someone",
      ownerId: owner.userid,
      postId: post.postId,
      commentId: comment.commentId,
      text,
      parentAuthorId,
      mentions,
    });

    await Profile.updateOne(
      { userid: owner.userid },
      { $set: { "posts.$[p].comments.$[c].notified": true } },
      {
        arrayFilters: [
          { "p.postId": post.postId },
          { "c.commentId": comment.commentId },
        ],
      },
    );

    const people = new Map<string, PersonInfo>([
      [
        viewerId,
        {
          userid: viewerId,
          username: viewer?.username ?? "",
          profileimage: viewer?.profileimage ?? "",
        },
      ],
    ]);

    const visibleCount =
      (post.comments ?? []).filter((item) => item.visible !== false).length + 1;

    response.status(201).json({
      success: true,
      data: {
        comment: serializeComment(comment, viewerId, people),
        commentCount: visibleCount,
      },
    });
  } catch (error) {
    serverError(response, "Add comment", error);
  }
};

// --------------------------------------------------
// EDIT A COMMENT (only its author)
// PATCH /api/posts/:ownerId/:postId/comments/:commentId   Body: { commentText }
// --------------------------------------------------

export const editComment = async (request: Request, response: Response) => {
  try {
    const context = await loadPostContext(request, response);
    if (!context) return;

    const { viewerId, viewer, owner, post } = context;
    const commentId = param(request, "commentId");

    const existing = (post.comments ?? []).find(
      (comment) => comment.commentId === commentId && comment.visible !== false,
    );

    if (!existing) {
      sendError(response, 404, "Comment not found.");
      return;
    }

    if (existing.userId !== viewerId) {
      sendError(response, 403, "You can only edit your own comments.");
      return;
    }

    const raw = bodyOf(request).commentText;
    const text = typeof raw === "string" ? raw.trim() : "";

    if (!text || text.length > MAX_COMMENT_LENGTH) {
      sendError(
        response,
        400,
        `Write a comment of up to ${MAX_COMMENT_LENGTH} characters.`,
      );
      return;
    }

    const mentions = await resolveMentions(text, allowedMentionIds(context));
    const now = new Date();

    await Profile.updateOne(
      { userid: owner.userid },
      {
        $set: {
          "posts.$[p].comments.$[c].commentText": text,
          "posts.$[p].comments.$[c].mentions": mentions,
          "posts.$[p].comments.$[c].updatedAt": now,
        },
      },
      {
        arrayFilters: [
          { "p.postId": post.postId },
          { "c.commentId": commentId, "c.userId": viewerId },
        ],
      },
    );

    const before = new Set((existing.mentions ?? []).map((item) => item.userId));
    await notifyMentions(
      mentions.filter((mention) => !before.has(mention.userId)),
      {
        senderId: viewerId,
        senderUsername: viewer?.username ?? "someone",
        text,
        postId: post.postId,
        ownerId: owner.userid,
        commentId,
        where: "comment",
      },
    );

    response.json({
      success: true,
      data: { commentText: text, mentions, updatedAt: now },
    });
  } catch (error) {
    serverError(response, "Edit comment", error);
  }
};

// --------------------------------------------------
// DELETE A COMMENT (the post owner, or the comment's author)
// DELETE /api/posts/:ownerId/:postId/comments/:commentId
// Replies to the comment are removed with it.
// --------------------------------------------------

export const deleteComment = async (request: Request, response: Response) => {
  try {
    const context = await loadPostContext(request, response);
    if (!context) return;

    const { viewerId, isOwner, owner, post } = context;
    const commentId = param(request, "commentId");

    const existing = (post.comments ?? []).find(
      (comment) => comment.commentId === commentId,
    );

    if (!existing) {
      sendError(response, 404, "Comment not found.");
      return;
    }

    if (!isOwner && existing.userId !== viewerId) {
      sendError(response, 403, "You can't delete this comment.");
      return;
    }

    await Profile.updateOne(
      { userid: owner.userid },
      {
        $pull: {
          "posts.$[p].comments": {
            $or: [{ commentId }, { parentCommentId: commentId }],
          },
        },
      },
      { arrayFilters: [{ "p.postId": post.postId }] },
    );

    const fresh = await loadRawPost(owner.userid, post.postId);
    const commentCount = (fresh?.comments ?? []).filter(
      (comment) => comment.visible !== false,
    ).length;

    response.json({ success: true, data: { commentCount } });
  } catch (error) {
    serverError(response, "Delete comment", error);
  }
};

// --------------------------------------------------
// LIKE A COMMENT
// POST /api/posts/:ownerId/:postId/comments/:commentId/like   Body: { liked }
// --------------------------------------------------

export const setCommentLike = async (request: Request, response: Response) => {
  try {
    const context = await loadPostContext(request, response);
    if (!context) return;

    const liked = bodyOf(request).liked;

    if (typeof liked !== "boolean") {
      sendError(response, 400, "liked must be true or false.");
      return;
    }

    const { viewerId, owner, post } = context;
    const commentId = param(request, "commentId");

    if (!(post.comments ?? []).some((comment) => comment.commentId === commentId)) {
      sendError(response, 404, "Comment not found.");
      return;
    }

    await Profile.updateOne(
      { userid: owner.userid },
      liked
        ? { $addToSet: { "posts.$[p].comments.$[c].likes": viewerId } }
        : { $pull: { "posts.$[p].comments.$[c].likes": viewerId } },
      {
        arrayFilters: [{ "p.postId": post.postId }, { "c.commentId": commentId }],
      },
    );

    const fresh = await loadRawPost(owner.userid, post.postId);
    const comment = (fresh?.comments ?? []).find(
      (item) => item.commentId === commentId,
    );

    response.json({
      success: true,
      data: { liked, likeCount: (comment?.likes ?? []).length },
    });
  } catch (error) {
    serverError(response, "Like comment", error);
  }
};

// --------------------------------------------------
// EDIT A POST (owner only)
// PATCH /api/posts/:ownerId/:postId
// Body: { caption?, hashtags?, settings? }
// --------------------------------------------------

export const updatePost = async (request: Request, response: Response) => {
  try {
    const context = await loadPostContext(request, response);
    if (!context) return;

    if (!context.isOwner) {
      sendError(response, 403, "Only the owner can edit this post.");
      return;
    }

    const { viewerId, viewer, owner, post } = context;
    const body = bodyOf(request);
    const changes: Record<string, unknown> = {};
    let newMentions: MentionRef[] = [];
    let captionText = "";

    if (body.caption !== undefined) {
      if (
        typeof body.caption !== "string" ||
        body.caption.length > MAX_CAPTION_LENGTH
      ) {
        sendError(response, 400, "The caption is too long.");
        return;
      }

      captionText = body.caption.trim();
      const mentions = await resolveMentions(captionText, allowedMentionIds(context));
      // People already mentioned or already notified are never notified again.
      const before = new Set([
        ...(post.mentions?.mentions ?? []).map((item) => item.userId),
        ...(post.mentions?.notifiedUserIds ?? []),
      ]);

      newMentions = mentions.filter((mention) => !before.has(mention.userId));

      changes["posts.$[p].captions"] = {
        captionId: post.captions?.captionId || randomUUID(),
        content: captionText,
      };
      // Set the fields one by one so `notifiedUserIds` is never reset.
      changes["posts.$[p].mentions.mentionId"] =
        post.mentions?.mentionId || randomUUID();
      changes["posts.$[p].mentions.mentions"] = mentions;
    }

    if (body.hashtags !== undefined) {
      const hashtags = normalizeHashtags(body.hashtags);

      if (!hashtags) {
        sendError(
          response,
          400,
          "Hashtags may use letters, numbers and underscores (up to 30).",
        );
        return;
      }

      changes["posts.$[p].hashtags"] = hashtags;
    }

    if (body.settings !== undefined) {
      if (!body.settings || typeof body.settings !== "object") {
        sendError(response, 400, "settings must be an object.");
        return;
      }

      const settings = body.settings as Body;

      for (const key of [
        "hideLikeCount",
        "hideComments",
        "hideShareCount",
        "hideSaveCount",
      ]) {
        const value = settings[key];
        if (value === undefined) continue;

        if (typeof value !== "boolean") {
          sendError(response, 400, `${key} must be true or false.`);
          return;
        }

        changes[`posts.$[p].settings.${key}`] = value;
      }
    }

    if (Object.keys(changes).length === 0) {
      sendError(response, 400, "Nothing to update.");
      return;
    }

    await Profile.updateOne(
      { userid: owner.userid },
      { $set: changes },
      { arrayFilters: [{ "p.postId": post.postId }] },
    );

    if (newMentions.length > 0) {
      const notifiedIds = await notifyMentions(newMentions, {
        senderId: viewerId,
        senderUsername: viewer?.username ?? owner.username,
        text: captionText,
        postId: post.postId,
        ownerId: owner.userid,
        where: "post",
      });

      if (notifiedIds.length > 0) {
        await Profile.updateOne(
          { userid: owner.userid },
          {
            $addToSet: {
              "posts.$[p].mentions.notifiedUserIds": { $each: notifiedIds },
            },
          },
          { arrayFilters: [{ "p.postId": post.postId }] },
        );
      }
    }

    const fresh = await loadRawPost(owner.userid, post.postId);

    response.json({
      success: true,
      data: {
        captions: {
          captionId: fresh?.captions?.captionId ?? "",
          content: fresh?.captions?.content ?? "",
        },
        hashtags: fresh?.hashtags ?? [],
        mentions: fresh?.mentions?.mentions ?? [],
        settings: normalizeSettings(fresh?.settings),
      },
    });
  } catch (error) {
    serverError(response, "Update post", error);
  }
};

// --------------------------------------------------
// ARCHIVE / UNARCHIVE (owner only)
// POST /api/posts/:ownerId/:postId/archive   Body: { archived: boolean }
// --------------------------------------------------

export const archivePost = async (request: Request, response: Response) => {
  try {
    const context = await loadPostContext(request, response);
    if (!context) return;

    if (!context.isOwner) {
      sendError(response, 403, "Only the owner can archive this post.");
      return;
    }

    const archived = bodyOf(request).archived;

    if (typeof archived !== "boolean") {
      sendError(response, 400, "archived must be true or false.");
      return;
    }

    await Profile.updateOne(
      { userid: context.owner.userid },
      { $set: { "posts.$[p].archived": archived } },
      { arrayFilters: [{ "p.postId": context.post.postId }] },
    );

    response.json({ success: true, data: { archived } });
  } catch (error) {
    serverError(response, "Archive post", error);
  }
};

// --------------------------------------------------
// DELETE A POST (owner only)
// DELETE /api/posts/:ownerId/:postId
// --------------------------------------------------

export const deletePost = async (request: Request, response: Response) => {
  try {
    const context = await loadPostContext(request, response);
    if (!context) return;

    if (!context.isOwner) {
      sendError(response, 403, "Only the owner can delete this post.");
      return;
    }

    await Profile.updateOne(
      { userid: context.owner.userid },
      { $pull: { posts: { postId: context.post.postId } } },
    );

    response.json({ success: true, message: "Post deleted." });
  } catch (error) {
    serverError(response, "Delete post", error);
  }
};

// --------------------------------------------------
// REPORT A POST
// POST /api/posts/:ownerId/:postId/report   Body: { reason }
// Stored in the "reports" collection.
// --------------------------------------------------

export const reportPost = async (request: Request, response: Response) => {
  try {
    const context = await loadPostContext(request, response);
    if (!context) return;

    if (context.isOwner) {
      sendError(response, 400, "You can't report your own post.");
      return;
    }

    const raw = bodyOf(request).reason;
    const reason = typeof raw === "string" ? raw.trim() : "";

    if (reason.length < 3 || reason.length > 2000) {
      sendError(response, 400, "Tell us what is wrong (3–2000 characters).");
      return;
    }

    const { viewerId, owner, post } = context;

    const postSnapshot = {
      postId: post.postId,
      ownerUsername: owner.username,
      caption: post.captions?.content ?? "",
      imageUrl: post.imageUrl ?? {},
      hashtags: post.hashtags ?? [],
      visibility: post.visibility ?? "friends",
      createdAt: post.createdAt,
    };

    // One report per person per post; reporting again updates the reason.
    const existing = await Report.findOne({
      postId: post.postId,
      reportedByUserId: viewerId,
    });

    if (existing) {
      existing.reason = reason;
      existing.postSnapshot = postSnapshot;
      await existing.save();
    } else {
      await Report.create({
        reportId: randomUUID(),
        postId: post.postId,
        postOwnerId: owner.userid,
        reportedByUserId: viewerId,
        reason,
        postSnapshot,
      });
    }

    response.status(201).json({ success: true, message: "Report submitted." });
  } catch (error) {
    serverError(response, "Report post", error);
  }
};

// --------------------------------------------------
// FRIENDS FOR PICKERS (share sheet and @mention suggestions)
// GET /api/posts/friends?q=
// --------------------------------------------------

export const listFriendsForPicker = async (
  request: Request,
  response: Response,
) => {
  try {
    const viewerId = viewerIdOf(request);

    if (!viewerId) {
      sendError(response, 401, "Authentication required.");
      return;
    }

    const viewer = await Profile.findOne({ userid: viewerId })
      .select("friends")
      .lean();

    const ids = acceptedFriendIds(viewer);
    const people = await loadPeople(ids);
    const query =
      typeof request.query.q === "string" ? request.query.q.trim().toLowerCase() : "";

    const friends = ids
      .map((id) => people.get(id))
      .filter((person): person is PersonInfo => Boolean(person))
      .filter((person) => !query || person.username.toLowerCase().includes(query))
      .sort((a, b) => a.username.localeCompare(b.username))
      .slice(0, 200);

    response.json({ success: true, data: { friends } });
  } catch (error) {
    serverError(response, "List friends", error);
  }
};
