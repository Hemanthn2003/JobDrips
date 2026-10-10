
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
    sharedPostId: {
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
