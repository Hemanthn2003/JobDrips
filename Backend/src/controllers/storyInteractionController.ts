import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import Profile from "../models/Profile.js";
import Message from "../models/Message.js";
import Notification from "../models/Notification.js";
import type { AuthenticatedRequest } from "../utils/authMiddleware.js";
import { emitToUser } from "../utils/realtime.js";
import { acceptedFriendIds } from "../utils/postHelpers.js";

const meId = (req: Request) => String((req as AuthenticatedRequest).userId || "");
const fail = (res: Response, status: number, message: string) => res.status(status).json({ success: false, message });
const activeStory = (profile: any, storyId: string) => profile?.stories?.find((story: any) => story.storyId === storyId && new Date(story.expiresAt).getTime() > Date.now());
const emitStoryChanged = (owner: any, storyId: string, action: string) => {
  const payload = { ownerUserId: String(owner.userid), storyId, action, at: new Date().toISOString() };
  emitToUser(String(owner.userid), "story:updated", payload);
  for (const friendId of acceptedFriendIds(owner as any)) emitToUser(friendId, "story:updated", payload);
};

export const getStoryInteractions = async (req: Request, res: Response): Promise<void> => {
  try {
    const viewerId = meId(req), ownerId = String(req.params.userid), storyId = String(req.params.storyId);
    if (!viewerId) { fail(res, 401, "Authentication required."); return; }
    if (viewerId !== ownerId) { fail(res, 403, "Only the story owner can see its viewer and liker lists."); return; }
    const owner = await Profile.findOne({ userid: ownerId }).select("userid stories");
    const story: any = activeStory(owner, storyId);
    if (!owner || !story) { fail(res, 404, "Story not found or expired."); return; }
    const viewerIds = [...new Set((story.viewers || []).map((v: any) => String(v.userId)))];
    const likeIds: string[] = [...new Set<string>((story.likes || []).map((id: unknown) => String(id)))];
    const [viewProfiles, likeProfiles] = await Promise.all([
      Profile.find({ userid: { $in: viewerIds } }).select("userid username profileimage").lean(),
      Profile.find({ userid: { $in: likeIds } }).select("userid username profileimage").lean(),
    ]);
    const profileMap = new Map<string, any>([...viewProfiles, ...likeProfiles].map((p: any): [string, any] => [String(p.userid), p]));
    const viewers = (story.viewers || []).map((v: any) => ({
      userId: String(v.userId), email: String(v.email || ""), viewedAt: v.viewedAt,
      username: profileMap.get(String(v.userId))?.username || "JobDrips user",
      profileimage: profileMap.get(String(v.userId))?.profileimage || "",
    }));
    const likes = likeIds.map((userId) => ({
      userId, username: profileMap.get(userId)?.username || "JobDrips user",
      profileimage: profileMap.get(userId)?.profileimage || "",
    }));
    res.json({ success: true, data: { storyId, viewers, likes, viewCount: viewers.length, likeCount: likes.length } });
  } catch (error) {
    console.error("Get story interactions failed:", error);
    fail(res, 500, "Unable to load story viewers and likes.");
  }
};

export const toggleStoryLike = async (req: Request, res: Response): Promise<void> => {
  try {
    const viewerId = meId(req), ownerId = String(req.params.userid), storyId = String(req.params.storyId);
    if (!viewerId) { fail(res, 401, "Authentication required."); return; }
    const owner = await Profile.findOne({ userid: ownerId });
    const story: any = activeStory(owner, storyId);
    if (!owner || !story) { fail(res, 404, "Story not found or expired."); return; }
    if (viewerId !== ownerId) {
      const [viewerProfile] = await Promise.all([Profile.findOne({ userid: viewerId }).select("friends")]);
      if (!viewerProfile || !acceptedFriendIds(viewerProfile as any).includes(ownerId) || !acceptedFriendIds(owner as any).includes(viewerId)) {
        fail(res, 403, "You can only like a friend's story."); return;
      }
    }
    const likes: string[] = Array.isArray(story.likes) ? story.likes.map(String) : [];
    const wasLiked = likes.includes(viewerId);
    story.likes = wasLiked ? likes.filter((id) => id !== viewerId) : [...likes, viewerId];
    owner.markModified("stories");
    await owner.save();
    if (!wasLiked && viewerId !== ownerId) {
      const actor = await Profile.findOne({ userid: viewerId }).select("username").lean() as any;
      await Notification.updateOne(
        { dedupeKey: `story-like:${storyId}:${viewerId}` },
        { $set: { notificationId: randomUUID(), dedupeKey: `story-like:${storyId}:${viewerId}`, recipientUserId: ownerId, actorUserId: viewerId, type: "message", text: `${actor?.username || "Someone"} liked your story`, message: `${actor?.username || "Someone"} liked your story`, read: false, createdAt: new Date() } },
        { upsert: true },
      );
    }
    emitStoryChanged(owner, storyId, wasLiked ? "unliked" : "liked");
    const likeIds: string[] = (story.likes || []).map(String);
    const profiles = await Profile.find({ userid: { $in: likeIds } }).select("userid username profileimage").lean();
    const byId = new Map(profiles.map((p: any) => [String(p.userid), p]));
    const likesDetailed = likeIds.map((id) => ({ userId: id, username: byId.get(id)?.username || "JobDrips user", profileimage: byId.get(id)?.profileimage || "" }));
    res.json({ success: true, data: { liked: !wasLiked, likes: likeIds, likeDetails: likesDetailed, likeCount: likeIds.length } });
  } catch (error) {
    console.error("Toggle story like failed:", error);
    fail(res, 500, "Unable to update story like.");
  }
};

export const replyToStory = async (req: Request, res: Response): Promise<void> => {
  try {
    const senderId = meId(req), ownerId = String(req.params.userid), storyId = String(req.params.storyId);
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!senderId) { fail(res, 401, "Authentication required."); return; }
    if (!text || text.length > 2000) { fail(res, 400, "Write a reply of up to 2000 characters."); return; }
    if (senderId === ownerId) { fail(res, 400, "You cannot reply to your own story."); return; }
    const [sender, owner] = await Promise.all([
      Profile.findOne({ userid: senderId }).select("friends username profileimage"),
      Profile.findOne({ userid: ownerId }).select("friends username profileimage stories"),
    ]);
    if (!sender || !owner || !acceptedFriendIds(sender as any).includes(ownerId) || !acceptedFriendIds(owner as any).includes(senderId)) {
      fail(res, 403, "You can only reply to a friend's story."); return;
    }
    const story: any = activeStory(owner, storyId);
    if (!story) { fail(res, 404, "Story not found or expired."); return; }
    const conversationId = [senderId, ownerId].sort().join(":");
    const message = await Message.create({
      messageId: randomUUID(), conversationId, senderUserId: senderId, recipientUserId: ownerId,
      text, kind: "story_reply", storyId, storyOwnerId: ownerId, storyImageUrl: story.imageUrl,
      storyOwnerName: owner.username, storyOwnerAvatar: owner.profileimage,
      senderUsername: sender.username, senderAvatar: sender.profileimage,
      readAt: null, readBy: [senderId],
    });
    await Notification.updateOne(
      { dedupeKey: `story-reply:${message.messageId}` },
      { $setOnInsert: { notificationId: randomUUID(), dedupeKey: `story-reply:${message.messageId}`, recipientUserId: ownerId, actorUserId: senderId, type: "message", text: `Replied to your story: ${text}`, message: `${sender.username} replied to your story`, read: false, createdAt: new Date() } },
      { upsert: true },
    );
    const liveMessage = {
      messageId: message.messageId, conversationId, senderUserId: senderId, recipientUserId: ownerId,
      text, kind: "story_reply", storyId, storyOwnerId: ownerId, storyImageUrl: story.imageUrl,
      storyOwnerName: owner.username, storyOwnerAvatar: owner.profileimage,
      senderUsername: sender.username, senderAvatar: sender.profileimage, readAt: null, readBy: [senderId], createdAt: message.createdAt,
    };
    emitToUser(senderId, "message:new", liveMessage);
    emitToUser(ownerId, "message:new", liveMessage);
    emitToUser(ownerId, "message:notification", { conversationId, messageId: message.messageId, senderUserId: senderId });
    emitToUser(senderId, "app:data-changed", { collection: "messages", operation: "insert", at: new Date().toISOString() });
    emitToUser(ownerId, "app:data-changed", { collection: "messages", operation: "insert", at: new Date().toISOString() });
    res.status(201).json({ success: true, data: { messageId: message.messageId, conversationId } });
  } catch (error) {
    console.error("Reply to story failed:", error);
    fail(res, 500, "Unable to send story reply.");
  }
};
