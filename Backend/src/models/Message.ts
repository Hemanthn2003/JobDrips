import mongoose, { Schema } from "mongoose";

const messageSchema = new Schema({
  messageId: { type: String, required: true, unique: true },
  conversationId: { type: String, required: true, index: true },
  senderUserId: { type: String, required: true, index: true },
  recipientUserId: { type: String, default: "", index: true },
  text: { type: String, default: "", maxlength: 5000 },
  kind: { type: String, enum: ["text", "post_share", "mention", "system", "story_reply"], default: "text" },
  sharedPostId: { type: String, default: null },
  sharedPostOwnerId: { type: String, default: null },
  storyId: { type: String, default: null, index: true },
  storyOwnerId: { type: String, default: null, index: true },
  storyImageUrl: { type: String, default: null },
  storyOwnerName: { type: String, default: null },
  storyOwnerAvatar: { type: String, default: null },
  senderUsername: { type: String, default: null },
  senderAvatar: { type: String, default: null },
  groupId: { type: String, default: null, index: true },
  readAt: { type: Date, default: null },
  readBy: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: true, versionKey: false, collection: "messages" });

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ conversationId: 1, text: "text" });

const Message = (mongoose.models.Message as mongoose.Model<any>) || mongoose.model("Message", messageSchema, "messages");
export default Message;
