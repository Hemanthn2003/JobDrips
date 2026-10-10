
import mongoose, { Schema } from "mongoose";

const notificationSchema = new Schema(
  {
    notificationId: {
      type: String,
      required: true,
      unique: true,
    },
    dedupeKey: {
      type: String,
      required: true,
      unique: true,
    },
    recipientUserId: {
      type: String,
      required: true,
      index: true,
    },
    actorUserId: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: [
        "friend_request",
        "friend_accepted",
        "post_like",
        "comment",
        "comment_reply",
        "mention",
        "post_share",
      ],
      required: true,
    },
    postId: {
      type: String,
      default: null,
    },
    commentId: {
      type: String,
      default: null,
    },
    message: {
      type: String,
      required: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

notificationSchema.index({
  recipientUserId: 1,
  read: 1,
  createdAt: -1,
});

const Notification =
  (mongoose.models.Notification as mongoose.Model<any>) ||
  mongoose.model(
    "Notification",
    notificationSchema,
    "notifications"
  );

export default Notification;
