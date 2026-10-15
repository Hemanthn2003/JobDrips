import type { Request, Response } from "express";

import Conversation from "../models/Conversation.js";
import Notification from "../models/Notification.js";
import Profile from "../models/Profile.js";
import type { AuthenticatedRequest } from "../utils/authMiddleware.js";
import { loadPeople, type RawPost } from "../utils/postHelpers.js";
import { emitToUser } from "../utils/realtime.js";

const viewerIdOf = (request: Request): string =>
  String((request as AuthenticatedRequest).userId || "");

const sendUnauthorized = (response: Response) => {
  response
    .status(401)
    .json({ success: false, message: "Authentication required." });
};

const sendServerError = (response: Response, label: string, error: unknown) => {
  console.error(`${label} failed:`, error);
  response
    .status(500)
    .json({ success: false, message: "Something went wrong. Please try again." });
};

interface NotificationRow {
  notificationId: string;
  type: string;
  actorUserId: string;
  postId?: string | null;
  postOwnerId?: string | null;
  commentId?: string | null;
  text?: string;
  message: string;
  mentionIn?: string;
  read: boolean;
  createdAt: Date;
}

const snippet = (text: string, length: number): string =>
  text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;

/** Number of PEOPLE whose messages I have not read yet (not message count). */
const countUnseenMessagePeople = async (viewerId: string): Promise<number> => {
  const conversations = await Conversation.find({ "members.userId": viewerId }).select("members messages").lean() as any[];
  const senders = new Set<string>();
  for (const conversation of conversations) {
    const mine = (conversation.members || []).find((m: any) => String(m.userId) === viewerId);
    const clearedAt = mine?.clearedAt ? new Date(mine.clearedAt).getTime() : 0;
    for (const message of conversation.messages || []) {
      const sender = String(message.senderUserId || "");
      if (sender && sender !== viewerId && new Date(message.createdAt).getTime() > clearedAt && !(message.readBy || []).includes(viewerId)) senders.add(sender);
    }
  }
  return senders.size;
};

// --------------------------------------------------
// BADGES FOR THE BOTTOM NAVIGATION
// GET /api/notifications/summary
// --------------------------------------------------

export const getSummary = async (request: Request, response: Response) => {
  try {
    const viewerId = viewerIdOf(request);
    if (!viewerId) return sendUnauthorized(response);

    const [unreadNotifications, unseenMessagePeople] = await Promise.all([
      Notification.countDocuments({ recipientUserId: viewerId, read: false }),
      countUnseenMessagePeople(viewerId),
    ]);

    response.json({
      success: true,
      data: { unreadNotifications, unseenMessagePeople },
    });
  } catch (error) {
    sendServerError(response, "Notification summary", error);
  }
};

// --------------------------------------------------
// LIST
// GET /api/notifications
// --------------------------------------------------

export const listNotifications = async (
  request: Request,
  response: Response,
) => {
  try {
    const viewerId = viewerIdOf(request);
    if (!viewerId) return sendUnauthorized(response);

    const items = (await Notification.find({ recipientUserId: viewerId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean()) as unknown as NotificationRow[];

    const people = await loadPeople(items.map((item) => item.actorUserId));

    // Pending friend requests (so the Accept / Deny buttons only show while open).
    const mine = await Profile.findOne({ userid: viewerId })
      .select("requests")
      .lean();
    const pendingRequesters = new Set(
      ((mine?.requests ?? []) as Array<{
        profile?: { userid?: string };
        accept?: boolean;
      }>)
        .filter((item) => !item.accept)
        .map((item) => String(item.profile?.userid ?? "")),
    );

    // Small post preview (first photo + start of the caption).
    const postKeys = new Map<string, { ownerId: string; postId: string }>();
    for (const item of items) {
      if (item.postId && item.postOwnerId) {
        postKeys.set(`${item.postOwnerId}:${item.postId}`, {
          ownerId: item.postOwnerId,
          postId: item.postId,
        });
      }
    }

    const previews = new Map<
      string,
      { postId: string; ownerId: string; ownerUsername: string; imageUrl: string; caption: string }
    >();

    await Promise.all(
      [...postKeys.entries()].map(async ([key, { ownerId, postId }]) => {
        const doc = (await Profile.findOne({
          userid: ownerId,
          "posts.postId": postId,
        })
          .select({ username: 1, posts: { $elemMatch: { postId } } })
          .lean()) as unknown as {
          username?: string;
          posts?: RawPost[];
        } | null;

        const post = doc?.posts?.[0];
        if (!post) return;

        previews.set(key, {
          postId,
          ownerId,
          ownerUsername: doc?.username ?? "",
          imageUrl: Object.values(post.imageUrl ?? {}).find(Boolean) ?? "",
          caption: snippet(post.captions?.content ?? "", 60),
        });
      }),
    );

    const data = (
      items
    ).map((item) => {
      const actor = people.get(item.actorUserId);

      return {
        notificationId: item.notificationId,
        type: item.type,
        message: item.message,
        text: item.text ?? "",
        mentionIn: item.mentionIn ?? "",
        commentId: item.commentId ?? null,
        read: item.read,
        createdAt: new Date(item.createdAt).toISOString(),
        actor: {
          userid: item.actorUserId,
          username: actor?.username ?? "",
          profileimage: actor?.profileimage ?? "",
        },
        post:
          item.postId && item.postOwnerId
            ? (previews.get(`${item.postOwnerId}:${item.postId}`) ?? null)
            : null,
        requestPending:
          item.type === "friend_request"
            ? pendingRequesters.has(item.actorUserId)
            : false,
      };
    });

    response.json({ success: true, data: { notifications: data } });
  } catch (error) {
    sendServerError(response, "List notifications", error);
  }
};

// --------------------------------------------------
// OPENING THE PAGE CLEARS THE RED DOT
// POST /api/notifications/read-all
// --------------------------------------------------

export const markAllRead = async (request: Request, response: Response) => {
  try {
    const viewerId = viewerIdOf(request);
    if (!viewerId) return sendUnauthorized(response);

    const result = await Notification.updateMany(
      { recipientUserId: viewerId, read: false },
      { $set: { read: true } },
    );
    if (result.modifiedCount > 0) {
      emitToUser(viewerId, "notification:read", { userId: viewerId });
    }

    response.json({ success: true });
  } catch (error) {
    sendServerError(response, "Mark notifications read", error);
  }
};
