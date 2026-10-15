import mongoose, { Schema } from "mongoose";

export const MAX_PERSONAL_MEMBERS = 2;
export const MAX_GROUP_MEMBERS = 40;

const memberSchema = new Schema({
  userId: { type: String, required: true },
  role: { type: String, enum: ["admin", "member"], default: "member" },
  clearedAt: { type: Date, default: null },
  background: { type: String, default: "" }, // "#hex" or "image:<cloudinary url>"
  muted: { type: Boolean, default: false },
}, { _id: false });

// Structured data for "X added Y", "X left", "X changed the group photo" ...
const systemTargetSchema = new Schema({
  userId: { type: String, default: "" },
  name: { type: String, default: "" },
}, { _id: false });

const systemSchema = new Schema({
  action: { type: String, enum: ["created", "added", "removed", "left", "photo", "renamed", "promoted", "demoted"], required: true },
  actorId: { type: String, default: "" },
  actorName: { type: String, default: "" },
  targets: { type: [systemTargetSchema], default: [] },
  detail: { type: String, default: "" },
}, { _id: false });

const messageSchema = new Schema({
  messageId: { type: String, required: true },
  senderUserId: { type: String, required: true },
  recipientUserId: { type: String, default: "" }, // personal chats only
  type: { type: String, enum: ["text", "image", "post", "story_reply", "mention", "system"], default: "text" },
  text: { type: String, default: "", maxlength: 5000 }, // caption / message text / neutral system text
  imageUrl: { type: String, default: "" },
  sharedPostId: { type: String, default: null },
  sharedPostOwnerId: { type: String, default: null },
  storyId: { type: String, default: null },
  storyOwnerId: { type: String, default: null },
  storyImageUrl: { type: String, default: null },
  storyOwnerName: { type: String, default: "" },
  storyOwnerAvatar: { type: String, default: "" },
  senderUsername: { type: String, default: "" },
  senderAvatar: { type: String, default: "" },
  system: { type: systemSchema, default: null },
  readAt: { type: Date, default: null },
  readBy: { type: [String], default: [] },
  notified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const conversationSchema = new Schema({
  conversationId: { type: String, required: true, unique: true },
  type: { type: String, enum: ["personal", "group"], default: "personal", index: true },
  members: { type: [memberSchema], default: [] },
  createdBy: { type: String, required: true },
  title: { type: String, default: "" },
  photoUrl: { type: String, default: "" },
  messages: { type: [messageSchema], default: [] },
  lastMessageAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true, versionKey: false, collection: "conversations" });

conversationSchema.pre("validate", function (next) {
  const self = this as any;
  const ids: string[] = (self.members || []).map((m: any) => String(m.userId));
  if (new Set(ids).size !== ids.length) return next(new Error("Duplicate members are not allowed."));
  if (self.type === "personal" && ids.length !== MAX_PERSONAL_MEMBERS) return next(new Error("A personal conversation has exactly 2 members."));
  if (self.type === "group" && (ids.length < 1 || ids.length > MAX_GROUP_MEMBERS)) return next(new Error(`A group can have up to ${MAX_GROUP_MEMBERS} members.`));
  next();
});

conversationSchema.index({ "members.userId": 1, lastMessageAt: -1 });
conversationSchema.index({ "messages.messageId": 1 }, { unique: true, sparse: true });

const Conversation = (mongoose.models.Conversation as mongoose.Model<any>) || mongoose.model("Conversation", conversationSchema, "conversations");
export default Conversation;