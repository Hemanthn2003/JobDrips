import { randomUUID } from "node:crypto";
import Notification, {
  type NotificationType,
} from "../models/Notification.js";
import { emitToUser } from "./realtime.js";

export interface NotificationInput {
  type: NotificationType;
  recipientUserId: string;
  actorUserId: string;
  /** Unique key for this event, e.g. "comment:<commentId>:<recipient>". */
  dedupeKey: string;
  message: string;
  postId?: string;
  postOwnerId?: string;
  commentId?: string;
  text?: string;
  mentionIn?: "comment" | "post";
}

/**
 * Creates one notification. Returns false when the person would notify
 * themselves or when this exact event was already notified before.
 */
export const createNotification = async (
  input: NotificationInput,
): Promise<boolean> => {
  if (!input.recipientUserId || input.recipientUserId === input.actorUserId) {
    return false;
  }

  try {
    const notification = await Notification.create({
      notificationId: randomUUID(),
      dedupeKey: input.dedupeKey,
      recipientUserId: input.recipientUserId,
      actorUserId: input.actorUserId,
      type: input.type,
      postId: input.postId ?? null,
      postOwnerId: input.postOwnerId ?? null,
      commentId: input.commentId ?? null,
      text: input.text ?? "",
      message: input.message,
      mentionIn: input.mentionIn ?? "",
      read: false,
    });
    emitToUser(input.recipientUserId, "notification:new", {
      notificationId: notification.notificationId,
      type: notification.type,
    });
    return true;
  } catch (error) {
    // 11000 = duplicate dedupeKey: the notification already exists.
    if ((error as { code?: number }).code === 11000) return false;
    throw error;
  }
};

/** Removes a notification (for example when a friend request is withdrawn). */
export const removeNotificationsByKey = async (
  dedupeKey: string,
): Promise<void> => {
  await Notification.deleteMany({ dedupeKey });
};
