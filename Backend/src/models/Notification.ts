import mongoose, { Schema } from "mongoose";

export const NOTIFICATION_TYPES = [
  "friend_request",
  "friend_accepted",
  "post_like",
  "comment",
  "comment_reply",
  "mention",
  "post_share",
  "message",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const notificationSchema = new Schema(
  {
    notificationId: { type: String, required: true, unique: true },
    // Makes sure the same event can never create two notifications.
    dedupeKey: { type: String, required: true, unique: true },
    recipientUserId: { type: String, required: true, index: true },
    actorUserId: { type: String, required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },

    // Post the notification is about (and the person who owns it).
    postId: { type: String, default: null },
    postOwnerId: { type: String, default: null },
    commentId: { type: String, default: null },

    // Comment text (comment / mention) or message text.
    text: { type: String, default: "" },
    // Short readable summary, kept for older clients.
    message: { type: String, required: true },

    // "mention" notifications: where the mention happened.
    mentionIn: { type: String, enum: ["comment", "post", ""], default: "" },

    // Unread until the person opens the notifications page.
    read: { type: Boolean, default: false },

    // true = the person deleted it from their list. The record stays in the
    // database (so the same event can never notify them again) but it is
    // never listed or counted.
    hidden: { type: Boolean, default: false },

    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false },
);

notificationSchema.index({ recipientUserId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ recipientUserId: 1, hidden: 1, createdAt: -1 });

const Notification =
  (mongoose.models.Notification as mongoose.Model<any>) ||
  mongoose.model("Notification", notificationSchema, "notifications");

export default Notification;