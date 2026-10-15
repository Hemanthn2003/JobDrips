import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import Conversation, { MAX_GROUP_MEMBERS } from "../models/Conversation.js";
import Profile from "../models/Profile.js";
import Notification from "../models/Notification.js";
import { User } from "../models/User.js";
import type { AuthenticatedRequest } from "../utils/authMiddleware.js";
import { acceptedFriendIds } from "../utils/postHelpers.js";
import { emitToUser } from "../utils/realtime.js";

const viewerId = (req: Request) => String((req as AuthenticatedRequest).userId || "");
export const conversationIdFor = (a: string, b: string) => [a, b].sort().join(":");
const fail = (res: Response, status: number, message: string) => { res.status(status).json({ success: false, message }); };
const member = (conversation: any, id: string) => conversation?.members?.find((m: any) => String(m.userId) === id);

const CLOUDINARY_IMAGE = /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//i;
// Colour or Cloudinary image only (prevents CSS injection through the background value).
const BACKGROUND = /^(#[0-9a-f]{3,8}|image:https:\/\/res\.cloudinary\.com\/[^\s"'()<>\\]+)$/i;

// "direct" is the old name for "personal"; server.ts converts it at startup.
const PERSONAL_TYPES = ["personal", "direct"];

const attachPerson = async (ids: string[]) => {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, any>();
  const profiles = await Profile.find({ userid: { $in: unique } }).select("userid username profileimage").lean() as any[];
  const users = await User.find({ _id: { $in: unique } }).select("_id name profilePhoto").lean() as any[];
  const userMap = new Map<string, any>(users.map((u: any) => [String(u._id), u]));
  return new Map<string, any>(profiles.map((p: any) => {
    const u = userMap.get(String(p.userid));
    return [String(p.userid), { userid: String(p.userid), username: p.username || u?.name || "JobDrips member", profileimage: p.profileimage || u?.profilePhoto || "", name: u?.name || p.username || "JobDrips member" }];
  }));
};

/** A personal conversation is found by its two members, whatever its id is. */
const findPersonal = (a: string, b: string) =>
  Conversation.findOne({ type: { $in: PERSONAL_TYPES }, "members.userId": { $all: [a, b] }, members: { $size: 2 } });

const ensurePersonal = async (a: string, b: string) => {
  let conversation: any = await findPersonal(a, b);
  if (conversation) return conversation;
  try {
    conversation = await Conversation.create({
      conversationId: conversationIdFor(a, b), type: "personal", createdBy: a,
      members: [{ userId: a, role: "member" }, { userId: b, role: "member" }], messages: [],
    });
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    conversation = await findPersonal(a, b);
  }
  return conversation;
};

const visibleMessages = (conversation: any, me: string) => {
  const clearedAt = member(conversation, me)?.clearedAt ? new Date(member(conversation, me).clearedAt).getTime() : 0;
  return (conversation?.messages || [])
    .map((m: any) => (m?.toObject ? m.toObject() : m)) // spreading a Mongoose subdoc loses its fields
    .filter((m: any) => new Date(m.createdAt).getTime() > clearedAt);
};

const postPreviewFor = async (messages: any[]) => {
  const pairs = [...new Map(messages.filter((m) => m.sharedPostId && m.sharedPostOwnerId).map((m) => [`${m.sharedPostOwnerId}:${m.sharedPostId}`, { ownerId: String(m.sharedPostOwnerId), postId: String(m.sharedPostId) }])).values()];
  const previews = new Map<string, any>();
  for (const pair of pairs) {
    const owner = await Profile.findOne({ userid: pair.ownerId, "posts.postId": pair.postId }).select("userid username profileimage posts").lean() as any;
    const post = owner?.posts?.find((p: any) => String(p.postId) === pair.postId);
    if (!owner || !post) continue;
    const imageUrl = post.imageUrl?.image1 || post.imageUrl?.image2 || post.imageUrl?.image3 || post.imageUrl?.image4 || post.imageUrl?.image5 || "";
    previews.set(`${pair.ownerId}:${pair.postId}`, { postId: pair.postId, ownerId: pair.ownerId, username: owner.username || "JobDrips member", profileimage: owner.profileimage || "", imageUrl, caption: post.captions?.content || "" });
  }
  return messages.map((m) => ({
    ...m,
    kind: m.type === "post" ? "post_share" : m.type,
    text: m.text ?? "",
    sharedPostPreview: m.sharedPostId && m.sharedPostOwnerId ? previews.get(`${m.sharedPostOwnerId}:${m.sharedPostId}`) || null : null,
  }));
};

/** Sends the saved message to every member's socket room (sender included). */
const emitMessage = async (conversation: any, message: any) => {
  const [payload] = await postPreviewFor([{ ...message }]);
  const full = { ...payload, conversationId: conversation.conversationId };
  for (const m of conversation.members || []) emitToUser(String(m.userId), "message:new", full);
  return full;
};

type NewMessage = {
  senderUserId: string; text?: string; imageUrl?: string;
  kind?: "text" | "post_share" | "mention" | "story_reply" | "image";
  sharedPostId?: string | null; sharedPostOwnerId?: string | null;
  storyId?: string; storyOwnerId?: string; storyImageUrl?: string; storyOwnerName?: string; storyOwnerAvatar?: string;
  senderUsername?: string; senderAvatar?: string;
};

/** Appends one message to conversation.messages with an atomic $push. */
const pushMessage = async (conversation: any, input: NewMessage) => {
  const recipients = (conversation.members || []).map((m: any) => String(m.userId)).filter((id: string) => id !== input.senderUserId);
  const createdAt = new Date();
  const type = input.kind === "post_share" || input.sharedPostId ? "post"
    : input.kind === "story_reply" ? "story_reply"
    : input.kind === "mention" ? "mention"
    : input.imageUrl ? "image" : "text";
  const message = {
    messageId: randomUUID(), senderUserId: input.senderUserId,
    recipientUserId: PERSONAL_TYPES.includes(conversation.type) ? recipients[0] || "" : "",
    type, text: (input.text || "").slice(0, 5000), imageUrl: input.imageUrl || "",
    sharedPostId: input.sharedPostId || null, sharedPostOwnerId: input.sharedPostOwnerId || null,
    storyId: input.storyId || null, storyOwnerId: input.storyOwnerId || null, storyImageUrl: input.storyImageUrl || null,
    storyOwnerName: input.storyOwnerName || "", storyOwnerAvatar: input.storyOwnerAvatar || "",
    senderUsername: input.senderUsername || "", senderAvatar: input.senderAvatar || "",
    readAt: null, readBy: [input.senderUserId], notified: false, createdAt,
  };
  await Conversation.updateOne({ conversationId: conversation.conversationId }, { $push: { messages: message }, $set: { lastMessageAt: createdAt } });
  return message;
};

// ---------------------------------------------------------------------------
// System notes inside a conversation ("X added Y", "X left", photo changes...)
// ---------------------------------------------------------------------------

type SystemAction = "created" | "added" | "removed" | "left" | "photo" | "renamed" | "promoted" | "demoted";
type SystemInput = { action: SystemAction; actorId: string; targetIds?: string[]; detail?: string };

/** Neutral wording used for the chat-list preview and notifications. The chat itself personalises it. */
const neutralText = (action: SystemAction, actor: string, targets: string[], detail: string) => {
  const list = targets.join(", ");
  switch (action) {
    case "created": return `${actor} created this group`;
    case "added": return `${actor} added ${list}`;
    case "removed": return `${actor} removed ${list}`;
    case "left": return `${actor} left`;
    case "photo": return detail === "removed" ? `${actor} removed the group photo` : `${actor} changed the group photo`;
    case "renamed": return `${actor} renamed the group to “${detail}”`;
    case "promoted": return `${actor} made ${list} an admin`;
    case "demoted": return `${actor} removed ${list} as admin`;
    default: return actor;
  }
};

const pushSystemMessage = async (conversation: any, input: SystemInput, recipientIds: string[]) => {
  const targetIds = input.targetIds || [];
  const people = await attachPerson([input.actorId, ...targetIds]);
  const nameOf = (id: string) => people.get(id)?.name || people.get(id)?.username || "Someone";
  const targets = targetIds.map((userId) => ({ userId, name: nameOf(userId) }));
  const actorName = nameOf(input.actorId);
  const detail = input.detail || "";
  const createdAt = new Date();
  const message = {
    messageId: randomUUID(), senderUserId: input.actorId, recipientUserId: "",
    type: "system", text: neutralText(input.action, actorName, targets.map((t) => t.name), detail), imageUrl: "",
    sharedPostId: null, sharedPostOwnerId: null, storyId: null, storyOwnerId: null, storyImageUrl: null,
    storyOwnerName: "", storyOwnerAvatar: "", senderUsername: actorName, senderAvatar: "",
    system: { action: input.action, actorId: input.actorId, actorName, targets, detail },
    readAt: null,
    // Already "read" by everyone, so system notes never create unread badges.
    readBy: [...new Set([...recipientIds, input.actorId])],
    notified: true, createdAt,
  };
  await Conversation.updateOne({ conversationId: conversation.conversationId }, { $push: { messages: message }, $set: { lastMessageAt: createdAt } });
  const payload = { ...message, kind: "system", sharedPostPreview: null, conversationId: conversation.conversationId };
  for (const id of recipientIds) emitToUser(id, "message:new", payload);
  return message;
};

const safeSystem = (conversation: any, input: SystemInput, recipientIds: string[]) =>
  pushSystemMessage(conversation, input, recipientIds).catch((error) => console.error("System message failed:", error));

/** Shared by post sharing and story replies. */
export const createMessage = async (input: NewMessage & { recipientUserId: string }) => {
  const conversation = await ensurePersonal(input.senderUserId, input.recipientUserId);
  if (!conversation) throw new Error("Unable to create conversation");
  const message = await pushMessage(conversation, input);
  await emitMessage(conversation, message);
  return { ...message, conversationId: conversation.conversationId };
};

const notifyRecipients = async (conversation: any, message: any, senderId: string, senderName: string) => {
  const recipients = (conversation.members || []).map((m: any) => String(m.userId)).filter((id: string) => id !== senderId);
  if (!recipients.length) return;
  const fallback = message.type === "post" ? "Shared a post with you" : message.type === "image" ? "Sent you an image" : "Sent you a message";
  await Notification.bulkWrite(recipients.map((id: string) => ({ updateOne: {
    filter: { dedupeKey: `message:${message.messageId}:${id}` },
    update: { $setOnInsert: { notificationId: randomUUID(), dedupeKey: `message:${message.messageId}:${id}`, recipientUserId: id, actorUserId: senderId, type: "message", text: message.text || fallback, message: `${senderName || "Someone"} sent you a message`, read: false, createdAt: new Date() } },
    upsert: true,
  } })));
  await Conversation.updateOne({ conversationId: conversation.conversationId, "messages.messageId": message.messageId }, { $set: { "messages.$.notified": true } });
  for (const id of recipients) emitToUser(id, "notification:new", { type: "message", conversationId: conversation.conversationId });
};

export const sendMessage = async (request: Request, response: Response): Promise<void> => {
  try {
    const senderId = viewerId(request);
    if (!senderId) return fail(response, 401, "Authentication required.");
    const body = (request.body ?? {}) as Record<string, unknown>;
    const recipientId = typeof body.recipientUserId === "string" ? body.recipientUserId : "";
    const groupId = typeof body.groupId === "string" ? body.groupId : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
    const sharedPostId = typeof body.sharedPostId === "string" ? body.sharedPostId : null;
    const sharedPostOwnerId = typeof body.sharedPostOwnerId === "string" ? body.sharedPostOwnerId : null;
    if (!text && !imageUrl && !sharedPostId) return fail(response, 400, "Write a message or attach an image or post.");
    if (text.length > 5000) return fail(response, 400, "Messages can be up to 5000 characters.");
    if (imageUrl && !CLOUDINARY_IMAGE.test(imageUrl)) return fail(response, 400, "Images must be uploaded first.");

    const senderProfile = await Profile.findOne({ userid: senderId }).select("username profileimage friends").lean() as any;
    let conversation: any;
    if (groupId) {
      conversation = await Conversation.findOne({ conversationId: groupId, type: "group", "members.userId": senderId });
      if (!conversation) return fail(response, 403, "You are not a member of this group.");
    } else {
      if (!recipientId || recipientId === senderId) return fail(response, 400, "Choose someone else to message.");
      const recipientProfile = await Profile.findOne({ userid: recipientId }).select("friends").lean();
      if (!acceptedFriendIds(senderProfile as any).includes(recipientId) || !acceptedFriendIds(recipientProfile as any).includes(senderId)) return fail(response, 403, "You can only message accepted friends.");
      conversation = await ensurePersonal(senderId, recipientId);
    }
    if (!conversation) return fail(response, 500, "Unable to open conversation.");

    const message = await pushMessage(conversation, { senderUserId: senderId, text, imageUrl, sharedPostId, sharedPostOwnerId, senderUsername: senderProfile?.username || "", senderAvatar: senderProfile?.profileimage || "" });
    await notifyRecipients(conversation, message, senderId, senderProfile?.username || "");
    const full = await emitMessage(conversation, message);
    response.status(201).json({ success: true, data: { messageId: message.messageId, conversationId: conversation.conversationId, message: full } });
  } catch (error) {
    console.error("Send message failed:", error);
    fail(response, 500, "Unable to send the message.");
  }
};

/** readAt is recorded the first time a receiver opens the conversation. */
const markConversationRead = async (conversation: any, me: string) => {
  const clearedAt = member(conversation, me)?.clearedAt ? new Date(member(conversation, me).clearedAt).getTime() : 0;
  const readIds: string[] = [];
  for (const message of conversation.messages || []) {
    if (message.type === "system") continue;
    if (new Date(message.createdAt).getTime() <= clearedAt) continue;
    if (String(message.senderUserId) === me || (message.readBy || []).includes(me)) continue;
    readIds.push(String(message.messageId));
  }
  if (!readIds.length) return;
  const now = new Date();
  await Conversation.updateOne(
    { conversationId: conversation.conversationId },
    { $set: { "messages.$[m].readAt": now }, $addToSet: { "messages.$[m].readBy": me } },
    { arrayFilters: [{ "m.messageId": { $in: readIds } }] },
  );
  for (const m of conversation.members || []) {
    if (String(m.userId) !== me) emitToUser(String(m.userId), "message:read", { conversationId: conversation.conversationId, messageIds: readIds, readBy: me, readAt: now.toISOString() });
  }
  // The reader's own unread badges (other tabs / bottom nav) refresh too.
  emitToUser(me, "conversation:updated", { conversationId: conversation.conversationId });
};

const fetchConversation = async (conversation: any, me: string) => {
  await markConversationRead(conversation, me);
  const msgs = await postPreviewFor(visibleMessages(conversation, me));
  return msgs.slice(-500);
};

export const markRead = async (request: Request, response: Response): Promise<void> => {
  try {
    const me = viewerId(request), id = String(request.params.conversationId || "");
    if (!me) return fail(response, 401, "Authentication required.");
    const conversation = await Conversation.findOne({ conversationId: id, "members.userId": me }).lean();
    if (!conversation) return fail(response, 403, "Conversation access denied.");
    await markConversationRead(conversation, me);
    response.json({ success: true });
  } catch (error) { console.error("Mark read failed:", error); fail(response, 500, "Unable to mark messages read."); }
};

export const getConversation = async (request: Request, response: Response): Promise<void> => {
  try {
    const me = viewerId(request), otherId = String(request.params.userid || "");
    if (!me) return fail(response, 401, "Authentication required.");
    if (!otherId || otherId === me) return fail(response, 400, "Invalid conversation.");
    const [mine, theirs] = await Promise.all([Profile.findOne({ userid: me }).select("friends").lean(), Profile.findOne({ userid: otherId }).select("friends").lean()]);
    if (!acceptedFriendIds(mine as any).includes(otherId) || !acceptedFriendIds(theirs as any).includes(me)) return fail(response, 403, "You can only view messages with accepted friends.");
    const conversation = await ensurePersonal(me, otherId);
    if (!conversation) return fail(response, 500, "Unable to open conversation.");
    const messages = await fetchConversation(conversation, me);
    response.json({ success: true, data: { conversationId: conversation.conversationId, type: "personal", messages, background: member(conversation, me)?.background || "" } });
  } catch (error) { console.error("Get conversation failed:", error); fail(response, 500, "Unable to load your conversation."); }
};

const lastPreview = (m: any) => !m ? "" : m.text || (m.type === "image" ? "Sent an image" : m.type === "post" ? "Shared a post" : m.type === "story_reply" ? "Replied to a story" : "");

export const listConversations = async (request: Request, response: Response): Promise<void> => {
  try {
    const me = viewerId(request);
    if (!me) return fail(response, 401, "Authentication required.");
    const q = String(request.query.q || "").trim().slice(0, 100).toLowerCase();
    const profile = await Profile.findOne({ userid: me }).select("friends stories").lean() as any;

    // Only people who accepted me back count as friends (otherwise opening the chat would be refused).
    const myFriendIds = acceptedFriendIds(profile).filter((id: string) => id !== me);
    const theirProfiles = await Profile.find({ userid: { $in: myFriendIds } }).select("userid friends").lean() as any[];
    const friendIds = myFriendIds.filter((id: string) => {
      const theirs = theirProfiles.find((p: any) => String(p.userid) === id);
      return Boolean(theirs) && acceptedFriendIds(theirs).includes(me);
    });

    const friendMap = await attachPerson(friendIds);
    const convos = await Conversation.find({ "members.userId": me }).select("conversationId type members title photoUrl lastMessageAt messages.senderUserId messages.type messages.text messages.readBy messages.createdAt").sort({ lastMessageAt: -1 }).lean() as any[];
    const rows: any[] = [];
    const seen = new Set<string>();
    for (const c of convos) {
      const mine = (c.members || []).find((m: any) => String(m.userId) === me);
      const visible = (c.messages || []).filter((m: any) => !mine?.clearedAt || new Date(m.createdAt).getTime() > new Date(mine.clearedAt).getTime());
      const last = visible[visible.length - 1];
      const unread = visible.filter((m: any) => m.type !== "system" && String(m.senderUserId) !== me && !(m.readBy || []).includes(me)).length;
      if (c.type === "group") {
        const people = await attachPerson((c.members || []).map((m: any) => String(m.userId)));
        rows.push({ conversationId: c.conversationId, type: "group", title: c.title, photoUrl: c.photoUrl, lastMessage: lastPreview(last), lastMessageAt: last?.createdAt || c.lastMessageAt, unreadCount: unread, background: mine?.background || "", members: (c.members || []).map((m: any) => ({ ...m, person: people.get(String(m.userId)) })) });
      } else {
        // "personal" (and legacy "direct") conversations
        const other = String((c.members || []).find((m: any) => String(m.userId) !== me)?.userId || "");
        if (!other || !friendIds.includes(other) || seen.has(other)) continue; // one row per person
        seen.add(other);
        const person = friendMap.get(other);
        rows.push({ conversationId: c.conversationId, type: "direct", person, title: person?.name || person?.username || "JobDrips member", lastMessage: lastPreview(last), lastMessageAt: last?.createdAt || c.lastMessageAt, unreadCount: unread, background: mine?.background || "" });
      }
    }
    for (const id of friendIds) {
      if (seen.has(id)) continue;
      const person = friendMap.get(id);
      rows.push({ conversationId: conversationIdFor(me, id), type: "direct", person, title: person?.name || person?.username || "JobDrips member", lastMessage: "", lastMessageAt: null, unreadCount: 0, background: "" });
    }
    const filtered = rows.filter((r) => !q || `${r.title} ${r.lastMessage}`.toLowerCase().includes(q));
    filtered.sort((a, b) => new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime());
    const stories = await Profile.find({ userid: { $in: [...friendIds, me] }, stories: { $elemMatch: { expiresAt: { $gt: new Date() } } } }).select("userid username profileimage stories").lean() as any[];
    const storyPeople = stories.map((p) => ({
      userid: p.userid, username: p.username, profileimage: p.profileimage || "",
      stories: (p.stories || [])
        .filter((s: any) => new Date(s.expiresAt).getTime() > Date.now())
        .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((s: any) => {
          const viewerIds = new Set<string>((s.viewers || []).map((v: any) => String(v.userId)));
          const likeIds = new Set<string>((s.likes || []).map((id: any) => String(id)));
          const isOwner = String(p.userid) === me;
          return {
            storyId: s.storyId, imageUrl: s.imageUrl, videoUrl: s.videoUrl, mediaType: s.mediaType, duration: s.duration,
            createdAt: s.createdAt, expiresAt: s.expiresAt,
            seen: viewerIds.has(me), liked: likeIds.has(me),
            viewCount: isOwner ? [...viewerIds].filter((id) => id !== me).length : undefined,
            likeCount: isOwner ? likeIds.size : undefined,
          };
        }),
    }));
    response.json({ success: true, data: { conversations: filtered, stories: storyPeople } });
  } catch (error) { console.error("List conversations failed:", error); fail(response, 500, "Unable to load messages."); }
};

export const createGroup = async (request: Request, response: Response): Promise<void> => {
  try {
    const me = viewerId(request);
    if (!me) return fail(response, 401, "Authentication required.");
    const title = String(request.body?.title || "").trim().slice(0, 80);
    const ids: string[] = [...new Set<string>((Array.isArray(request.body?.memberIds) ? request.body.memberIds : []).map((v: unknown) => String(v)).filter((id: string) => id && id !== me))];
    // creator + friends must stay within 40 members
    if (!title || ids.length < 2 || ids.length > MAX_GROUP_MEMBERS - 1) return fail(response, 400, `Enter a group name and choose 2–${MAX_GROUP_MEMBERS - 1} friends.`);
    const profile = await Profile.findOne({ userid: me }).select("friends").lean();
    const accepted = acceptedFriendIds(profile as any);
    if (ids.some((id) => !accepted.includes(id))) return fail(response, 403, "Groups can only include your accepted friends.");
    const conversation = await Conversation.create({ conversationId: randomUUID(), type: "group", title, createdBy: me, members: [{ userId: me, role: "admin" }, ...ids.map((userId) => ({ userId, role: "member" }))], messages: [] });
    for (const id of ids) emitToUser(id, "conversation:updated", { conversationId: conversation.conversationId });
    await safeSystem(conversation, { action: "created", actorId: me }, [me, ...ids]);
    response.status(201).json({ success: true, data: { conversationId: conversation.conversationId } });
  } catch (error) { console.error("Create group failed:", error); fail(response, 500, "Unable to create group."); }
};

export const getGroupConversation = async (request: Request, response: Response): Promise<void> => {
  try {
    const me = viewerId(request), id = String(request.params.conversationId || "");
    if (!me) return fail(response, 401, "Authentication required.");
    const conversation: any = await Conversation.findOne({ conversationId: id, type: "group", "members.userId": me });
    if (!conversation) return fail(response, 403, "You cannot access this group.");
    const messages = await fetchConversation(conversation, me);
    const people = await attachPerson((conversation.members || []).map((m: any) => String(m.userId)));
    response.json({ success: true, data: { conversationId: id, type: "group", title: conversation.title, photoUrl: conversation.photoUrl || "", members: (conversation.members || []).map((m: any) => ({ ...(m.toObject ? m.toObject() : m), person: people.get(String(m.userId)) })), messages, background: member(conversation, me)?.background || "" } });
  } catch (error) { console.error("Get group failed:", error); fail(response, 500, "Unable to load group messages."); }
};

export const getGroupInfo = async (request: Request, response: Response): Promise<void> => {
  try {
    const me = viewerId(request), id = String(request.params.conversationId || "");
    if (!me) return fail(response, 401, "Authentication required.");
    const c: any = await Conversation.findOne({ conversationId: id, type: "group", "members.userId": me }).select("conversationId title photoUrl createdBy members").lean();
    if (!c) return fail(response, 403, "You cannot access this group.");
    const people = await attachPerson((c.members || []).map((m: any) => String(m.userId)));
    response.json({ success: true, data: {
      conversationId: c.conversationId, title: c.title, photoUrl: c.photoUrl || "", createdBy: String(c.createdBy),
      members: (c.members || []).map((m: any) => ({ userId: String(m.userId), role: m.role, person: people.get(String(m.userId)) })),
    } });
  } catch (error) { console.error("Get group info failed:", error); fail(response, 500, "Unable to load group info."); }
};

export const searchMessages = async (request: Request, response: Response): Promise<void> => {
  try {
    const me = viewerId(request), q = String(request.query.q || "").trim().slice(0, 100);
    if (!me) return fail(response, 401, "Authentication required.");
    if (!q) { response.json({ success: true, data: { messages: [] } }); return; }
    const conversations = await Conversation.find({ "members.userId": me }).lean() as any[];
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const messages = conversations.flatMap((c) => {
      const clearedAt = member(c, me)?.clearedAt ? new Date(member(c, me).clearedAt).getTime() : 0;
      return (c.messages || []).filter((m: any) => m.type !== "system" && new Date(m.createdAt).getTime() > clearedAt && regex.test(String(m.text || ""))).map((m: any) => ({ ...m, conversationId: c.conversationId, kind: m.type === "post" ? "post_share" : m.type }));
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 50);
    response.json({ success: true, data: { messages } });
  } catch (error) { console.error("Search messages failed:", error); fail(response, 500, "Unable to search messages."); }
};

export const clearConversation = async (request: Request, response: Response): Promise<void> => {
  try {
    const me = viewerId(request), id = String(request.params.conversationId || "");
    if (!me) return fail(response, 401, "Authentication required.");
    let c: any = await Conversation.findOne({ conversationId: id, "members.userId": me });
    if (!c && id.includes(":")) { const other = id.split(":").find((x) => x !== me); if (other) c = await ensurePersonal(me, other); }
    if (!c) return fail(response, 403, "Conversation access denied.");
    await Conversation.updateOne({ conversationId: c.conversationId, "members.userId": me }, { $set: { "members.$.clearedAt": new Date() } });
    emitToUser(me, "conversation:updated", { conversationId: c.conversationId });
    response.json({ success: true, message: "Chat cleared for your account." });
  } catch (error) { console.error("Clear conversation failed:", error); fail(response, 500, "Unable to clear chat."); }
};

export const setChatBackground = async (request: Request, response: Response): Promise<void> => {
  try {
    const me = viewerId(request), id = String(request.params.conversationId || "");
    const background = String(request.body?.background || "").trim();
    if (background && !BACKGROUND.test(background)) return fail(response, 400, "Choose a colour or an uploaded image.");
    const result = await Conversation.updateOne({ conversationId: id, "members.userId": me }, { $set: { "members.$.background": background } });
    if (!result.matchedCount) return fail(response, 403, "Conversation access denied.");
    emitToUser(me, "conversation:updated", { conversationId: id });
    response.json({ success: true });
  } catch (error) { console.error("Background update failed:", error); fail(response, 500, "Unable to save chat background."); }
};

export const updateGroup = async (request: Request, response: Response): Promise<void> => {
  try {
    const me = viewerId(request), id = String(request.params.conversationId || ""), action = String(request.body?.action || "");
    if (!me) return fail(response, 401, "Authentication required.");
    const c: any = await Conversation.findOne({ conversationId: id, type: "group", "members.userId": me });
    if (!c) return fail(response, 403, "Group access denied.");

    const isAdmin = member(c, me)?.role === "admin";
    const founderId = String(c.createdBy); // the creator: always admin, can't be demoted or removed
    if (["rename", "photo", "remove", "promote", "demote"].includes(action) && !isAdmin) {
      return fail(response, 403, "Only group admins can do that.");
    }

    const targetId = typeof request.body?.userId === "string" ? request.body.userId : "";
    const ids: string[] = [...new Set<string>((Array.isArray(request.body?.memberIds) ? request.body.memberIds : targetId ? [targetId] : []).map((x: unknown) => String(x)))];
    const before: string[] = c.members.map((m: any) => String(m.userId));
    const events: SystemInput[] = [];

    if (action === "rename") {
      const title = String(request.body?.title || "").trim().slice(0, 80);
      if (title && title !== c.title) { c.title = title; events.push({ action: "renamed", actorId: me, detail: title }); }
    } else if (action === "photo") {
      const photoUrl = String(request.body?.photoUrl || "").trim();
      if (photoUrl && !CLOUDINARY_IMAGE.test(photoUrl)) return fail(response, 400, "Upload an image first.");
      c.photoUrl = photoUrl;
      events.push({ action: "photo", actorId: me, detail: photoUrl ? "changed" : "removed" });
    } else if (action === "add") {
      // Any member can add people, but only from THEIR accepted friends.
      const profile = await Profile.findOne({ userid: me }).select("friends").lean();
      const accepted = acceptedFriendIds(profile as any);
      const addIds = ids.filter((uid) => uid && !member(c, uid) && accepted.includes(uid));
      if (!addIds.length) return fail(response, 400, "Choose friends who are not in the group yet.");
      if (c.members.length + addIds.length > MAX_GROUP_MEMBERS) return fail(response, 400, `A group can have up to ${MAX_GROUP_MEMBERS} members.`);
      c.members.push(...addIds.map((userId) => ({ userId, role: "member" })));
      events.push({ action: "added", actorId: me, targetIds: addIds });
    } else if (action === "remove") {
      // Admins only. The creator and yourself (use "leave") can't be removed.
      const removeIds = ids.filter((uid) => uid !== me && uid !== founderId && member(c, uid));
      if (!removeIds.length) return fail(response, 400, "That member can't be removed.");
      c.members = c.members.filter((m: any) => !removeIds.includes(String(m.userId)));
      events.push({ action: "removed", actorId: me, targetIds: removeIds });
    } else if (action === "promote") {
      const target = member(c, targetId);
      if (!target) return fail(response, 404, "Member not found.");
      if (target.role !== "admin") { target.role = "admin"; events.push({ action: "promoted", actorId: me, targetIds: [targetId] }); }
    } else if (action === "demote") {
      const target = member(c, targetId);
      if (!target) return fail(response, 404, "Member not found.");
      if (targetId === founderId) return fail(response, 403, "The group creator always stays an admin.");
      if (c.members.filter((m: any) => m.role === "admin").length <= 1) return fail(response, 400, "A group needs at least one admin.");
      if (target.role === "admin") { target.role = "member"; events.push({ action: "demoted", actorId: me, targetIds: [targetId] }); }
    } else if (action === "leave") {
      c.members = c.members.filter((m: any) => String(m.userId) !== me);
      if (c.members.length && !c.members.some((m: any) => m.role === "admin")) c.members[0].role = "admin";
      events.push({ action: "left", actorId: me });
    } else {
      return fail(response, 400, "Unknown group action.");
    }

    c.markModified("members");
    await c.save();

    const recipients: string[] = c.members.map((m: any) => String(m.userId));
    for (const event of events) await safeSystem(c, event, recipients);

    // Everyone involved (including people just removed / who left) refreshes their list.
    const notify = new Set<string>([...before, ...recipients]);
    for (const uid of notify) emitToUser(uid, "conversation:updated", { conversationId: id });
    response.json({ success: true, data: { conversationId: id } });
  } catch (error) { console.error("Group update failed:", error); fail(response, 500, "Unable to update group."); }
};