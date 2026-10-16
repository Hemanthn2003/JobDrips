import type { NextFunction, Request, Response } from "express";
import Profile from "../models/Profile.js";
import type { AuthenticatedRequest } from "./authMiddleware.js";
import { acceptedFriendIds } from "./postHelpers.js";
import { emitToAllUsers, emitToUser } from "./realtime.js";

/**
 * Route middlewares that broadcast a "something changed" signal after a
 * successful request. Payloads never contain private content: clients reload
 * through their normal authenticated API calls.
 */

const actorOf = (req: Request) => String((req as AuthenticatedRequest).userId || "");

const friendsOf = async (userId: string): Promise<string[]> => {
  if (!userId) return [];
  const owner = (await Profile.findOne({ userid: userId }).select("userid friends").lean()) as any;
  return owner ? acceptedFriendIds(owner) : [];
};

const afterSuccess = (res: Response, work: () => Promise<void>) => {
  res.once("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    void work().catch((error) => console.error("Live update broadcast failed:", error));
  });
};

const emitAll = (ids: Iterable<string>, event: string, payload: unknown) => {
  for (const id of new Set(ids)) if (id) emitToUser(id, event, payload);
};

/** Story created / deleted / viewed. */
export const emitStoryChange = (req: Request, res: Response, next: NextFunction) => {
  afterSuccess(res, async () => {
    const actorId = actorOf(req);
    const ownerId = String(req.params.userid || actorId);
    if (!ownerId) return;
    const friends = await friendsOf(ownerId);
    emitAll([ownerId, actorId, ...friends], "story:updated", {
      ownerUserId: ownerId,
      actorId,
      storyId: String(req.params.storyId || ""),
      action: req.method.toLowerCase(),
      at: new Date().toISOString(),
    });
  });
  next();
};

/** Any post change: like, save, share, comment, edit, delete, archive, new post. */
export const emitPostChange = (req: Request, res: Response, next: NextFunction) => {
  afterSuccess(res, async () => {
    const actorId = actorOf(req);
    const ownerId = String(res.locals.postOwnerId || req.params.ownerId || actorId);
    if (!ownerId) return;
    const isComposerCreate =
      req.method === "POST" &&
      req.baseUrl.endsWith("/post-composer") &&
      !req.params.postId;
    const action = isComposerCreate ? "create" : req.method.toLowerCase();
    const payload = {
      ownerId,
      actorId,
      postId: String(res.locals.postId || req.params.postId || ""),
      commentId: String(req.params.commentId || ""),
      action,
      at: new Date().toISOString(),
    };
    const friends = await friendsOf(ownerId);
    emitAll([ownerId, actorId, ...friends], "post:updated", payload);
    emitToAllUsers("feed:updated", payload);
  });
  next();
};

/** Friend request sent / withdrawn / accepted / declined, friend removed. */
export const emitFriendChange = (req: Request, res: Response, next: NextFunction) => {
  afterSuccess(res, async () => {
    const actorId = actorOf(req);
    const targetId = String(req.params.userid || req.params.requesterId || "");
    if (!actorId || !targetId) return;
    const payload = { userId: actorId, otherUserId: targetId, at: new Date().toISOString() };
    emitAll([actorId, targetId], "friend:updated", payload);
    emitToUser(targetId, "notification:new", payload);
  });
  next();
};

/** Profile details changed; update the owner and friends viewing that profile. */
export const emitProfileChange = (req: Request, res: Response, next: NextFunction) => {
  afterSuccess(res, async () => {
    const userId = actorOf(req);
    if (!userId) return;
    emitAll([userId, ...(await friendsOf(userId))], "profile:updated", {
      userId,
      actorId: userId,
      at: new Date().toISOString(),
    });
  });
  next();
};