import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "../config/db.js";
import Conversation from "../models/Conversation.js";

/**
 * One-time migration from the former `messages` collection into each
 * conversation document. It is deliberately opt-in for deleting the old
 * collection; set DROP_LEGACY_MESSAGES_AFTER_MIGRATION=true only after backup.
 */
const run = async () => {
  await connectDatabase();
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB is not connected.");
  const names = await db.listCollections({ name: "messages" }).toArray();
  if (!names.length) { console.log("No legacy messages collection found."); await mongoose.disconnect(); return; }
  const legacy = await db.collection("messages").find({}).sort({ createdAt: 1 }).toArray();
  let migrated = 0;
  let skipped = 0;
  for (const old of legacy) {
    const id = String(old.conversationId || "");
    if (!id || !old.messageId || !old.senderUserId) { skipped++; continue; }
    let conversation: any = await Conversation.findOne({ conversationId: id });
    if (!conversation) {
      const ids = id.split(":");
      if (ids.length !== 2 || !ids.every(Boolean)) { skipped++; continue; }
      try {
        conversation = await Conversation.create({ conversationId: id, type: "personal", createdBy: String(old.senderUserId), members: ids.map((userId) => ({ userId, role: "member" })), messages: [] });
      } catch (error: any) {
        if (error?.code !== 11000) throw error;
        conversation = await Conversation.findOne({ conversationId: id });
      }
    }
    if (!conversation) { skipped++; continue; }
    const existing = (conversation.messages || []).some((m: any) => String(m.messageId) === String(old.messageId));
    if (existing) continue;
    const type = old.kind === "post_share" ? "post" : old.kind === "story_reply" ? "story_reply" : old.kind === "image" ? "image" : old.kind === "mention" ? "mention" : "text";
    conversation.messages.push({
      messageId: String(old.messageId), senderUserId: String(old.senderUserId),
      recipientUserId: String(old.recipientUserId || ""), recipientUserIds: old.recipientUserId ? [String(old.recipientUserId)] : [],
      type, content: String(old.text || old.content || ""), text: String(old.text || old.content || ""),
      imageUrl: String(old.imageUrl || ""), sharedPostId: old.sharedPostId || null, sharedPostOwnerId: old.sharedPostOwnerId || null,
      storyId: old.storyId || null, storyOwnerId: old.storyOwnerId || null, storyImageUrl: old.storyImageUrl || null,
      storyOwnerName: old.storyOwnerName || "", storyOwnerAvatar: old.storyOwnerAvatar || "", senderUsername: old.senderUsername || "", senderAvatar: old.senderAvatar || "",
      readAt: old.readAt || null, readBy: Array.isArray(old.readBy) ? old.readBy.map(String) : (old.readAt ? [String(old.recipientUserId || "")] : [String(old.senderUserId)]),
      notified: Boolean(old.notified), createdAt: old.createdAt || new Date(),
    } as any);
    const createdAt = new Date(old.createdAt || Date.now());
    if (!conversation.lastMessageAt || createdAt > new Date(conversation.lastMessageAt)) conversation.lastMessageAt = createdAt;
    await conversation.save();
    migrated++;
  }
  console.log(`Legacy migration complete. Migrated: ${migrated}; skipped: ${skipped}; source records: ${legacy.length}.`);
  if (process.env.DROP_LEGACY_MESSAGES_AFTER_MIGRATION === "true" && skipped === 0) {
    await db.collection("messages").drop();
    console.log("Dropped legacy messages collection as explicitly requested.");
  } else if (skipped > 0) {
    console.warn("Legacy collection was kept because some records were skipped. Review the skipped records before deleting anything.");
  } else {
    console.log("Legacy collection was retained. Back up and verify migrated chats before setting DROP_LEGACY_MESSAGES_AFTER_MIGRATION=true for a separate run.");
  }
  await mongoose.disconnect();
};
run().catch(async (error) => { console.error("Legacy message migration failed:", error); await mongoose.disconnect(); process.exitCode = 1; });
