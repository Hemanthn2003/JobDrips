import mongoose, { Schema } from "mongoose";

const messageSchema = new Schema(
  {
    messageId: {
      type: String,
      required: true,
      unique: true,
    },
    conversationId: {
      type: String,
      required: true,
      index: true,
    },
    senderUserId: {
      type: String,
      required: true,
      index: true,
    },
    recipientUserId: {
      type: String,
      required: true,
      index: true,
    },
    text: {
      type: String,
      default: "",
      maxlength: 5000,
    },
    // NEW: what kind of message this is (demo notifications use "mention").
    kind: {
      type: String,
      enum: ["text", "post_share", "mention"],
      default: "text",
    },
    sharedPostId: {
      type: String,
      default: null,
    },
    // NEW: owner of the shared / mentioned post (needed to open it).
    sharedPostOwnerId: {
      type: String,
      default: null,
    },
    readAt: {
      type: Date,
      default: null,
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

messageSchema.index({
  conversationId: 1,
  createdAt: 1,
});

const Message =
  (mongoose.models.Message as mongoose.Model<any>) ||
  mongoose.model("Message", messageSchema, "messages");

export default Message;
