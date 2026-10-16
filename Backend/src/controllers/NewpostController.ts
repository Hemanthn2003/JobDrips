import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import cloudinary from "../config/cloudinary.js";
import Hashtag from "../models/Hashtag.js";
import Profile from "../models/Profile.js";
import { MAX_IMAGE_BYTES, MAX_IMAGES } from "../middleware/postMediaUpload.js";
import type { AuthenticatedRequest } from "../utils/authMiddleware.js";
 
/* ════════════════════════════════════════════════════════════════
   ADAPTERS — the only places that depend on your existing code.
   ════════════════════════════════════════════════════════════════ */
 
/** The logged-in user's id, as set by your auth middleware. */
const getUserId = (req: Request): string | undefined =>
  (req as AuthenticatedRequest).userId;
 
/**
 * The `hashtags` collection stores tags WITH the hash, e.g. "#softwareengineering".
 * (Your real data looks like that, so this is true.)
 */
const STORE_HASHTAG_WITH_HASH = true;
const storedTag = (tag: string) => (STORE_HASHTAG_WITH_HASH ? `#${tag}` : tag);
 
/* ════════════════════════════════════════════════════════════════ */
 
const MAX_VIDEO_SECONDS = 90;
const MIN_VIDEO_SECONDS = 1;
const MAX_CAPTION = 5000;
 
class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
 
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const round2 = (n: number) => Math.round(n * 100) / 100;
 
/**
 * Hashtags are CASE-SENSITIVE: #job, #Job and #JOB are three different tags.
 * Only exact duplicates inside the same caption are merged.
 */
const extractHashtags = (text: string): string[] => {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?<![\p{L}\p{N}_])#([\p{L}\p{N}_]{1,50})/gu)) {
    found.add(m[1]);
  }
  return [...found].slice(0, 30);
};
 
const extractMentionNames = (text: string): string[] => {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?<![\p{L}\p{N}_.])@([A-Za-z0-9_.]{1,30})/gu)) {
    const name = m[1].replace(/\.+$/, ""); // "@sam." at end of a sentence
    if (name) found.add(name);
  }
  return [...found].slice(0, 30);
};
 
const parseJson = <T>(raw: unknown, fallback: T): T => {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, "Malformed request data.");
  }
};
 
const toNumber = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
 
/** Accepted friends of a profile: [{ userid, username, friendshipAccepted }] */
const acceptedFriends = (profile: any): { userid: string; username: string }[] =>
  (profile?.friends ?? [])
    .filter((f: any) => f?.friendshipAccepted === true && f?.userid && f?.username)
    .map((f: any) => ({ userid: String(f.userid), username: String(f.username) }));
 
const displayName = (p: any): string => p?.fullName ?? p?.name ?? p?.username ?? "";
 
/* ─────────────────────────  GET /context  ───────────────────────── */
 
export const getComposerContext = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Not signed in." });
 
  const p: any = await Profile.findOne({ userid: userId })
    .select("userid username profileimage fullName name")
    .lean();
  if (!p) return res.status(404).json({ message: "Profile not found." });
 
  res.json({
    userId,
    username: p.username ?? "",
    fullName: displayName(p),
    profileImage: p.profileimage ?? "",
  });
};
 
/* ─────────────────────────  GET /hashtags?q=  ───────────────────────── */
/* Matching is case-insensitive for SUGGESTIONS only ("j" lists #job, #Job,
   #JOB, #java…). Each spelling is its own document with its own count.
   Highest usesCount first, lowest last. */
 
export const searchHashtags = async (req: Request, res: Response) => {
  const q = String(req.query.q ?? "").replace(/^#/, "").trim();
  if (!/^[\p{L}\p{N}_]{1,50}$/u.test(q)) return res.json({ hashtags: [] });
 
  const rows: any[] = await Hashtag.find({
    hashtag: { $regex: esc(q), $options: "i" },
  })
    .sort({ usesCount: -1, hashtag: 1 })
    .limit(8)
    .lean();
 
  res.json({
    hashtags: rows.map((r) => ({
      hashtagId: r.hashtagId,
      hashtag: String(r.hashtag).replace(/^#/, ""),
      usesCount: r.usesCount ?? 0,
    })),
  });
};
 
/* ─────────────────────────  GET /mentions?q=  ───────────────────────── */
/* Only ACCEPTED friends from the logged-in profile's friends[] are returned. */
 
export const searchMentions = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Not signed in." });
 
  const q = String(req.query.q ?? "").replace(/^@/, "").trim();
  if (q && !/^[A-Za-z0-9_.]{1,30}$/.test(q)) return res.json({ users: [] });
 
  const me: any = await Profile.findOne({ userid: userId }).select("friends").lean();
  const friends = acceptedFriends(me);
  if (friends.length === 0) return res.json({ users: [] });
 
  const lq = q.toLowerCase();
  const matched = friends
    .filter((f) => !lq || f.username.toLowerCase().includes(lq))
    // usernames that START with the query first, then alphabetical
    .sort((a, b) => {
      const ap = a.username.toLowerCase().startsWith(lq) ? 0 : 1;
      const bp = b.username.toLowerCase().startsWith(lq) ? 0 : 1;
      return ap - bp || a.username.localeCompare(b.username);
    })
    .slice(0, 8);
 
  if (matched.length === 0) return res.json({ users: [] });
 
  // Pull the friends' current avatar / name from their own profiles.
  const profiles: any[] = await Profile.find({ userid: { $in: matched.map((f) => f.userid) } })
    .select("userid username profileimage fullName name")
    .lean();
  const byId = new Map(profiles.map((p) => [String(p.userid), p]));
 
  res.json({
    users: matched.map((f) => {
      const p = byId.get(f.userid);
      return {
        userId: f.userid,
        username: p?.username ?? f.username,
        fullName: p && p.username ? (p.fullName ?? p.name ?? "") : "",
        profileImage: p?.profileimage ?? "",
      };
    }),
  });
};
 
/* ─────────────────────────  POST /  (create post)  ───────────────────────── */
 
export const createPost = async (req: Request, res: Response) => {
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const images = files.images ?? [];
  const video = files.video?.[0];
  const uploaded: { publicId: string; type: "image" | "video" }[] = [];
 
  try {
    const userId = getUserId(req);
    if (!userId) throw new HttpError(401, "Not signed in.");
 
    /* ---- the logged-in profile (visibility + friend list) ---- */
    const owner: any = await Profile.findOne({ userid: userId })
      .select("userid username isPrivate friends")
      .lean();
    if (!owner) throw new HttpError(404, "Profile not found.");
 
    /* ---- text fields ---- */
    const caption = String(req.body.caption ?? "").replace(/\r\n/g, "\n").trim();
    if (caption.length > MAX_CAPTION)
      throw new HttpError(400, `Caption can be at most ${MAX_CAPTION} characters.`);
 
    // Visibility follows the account type (private account → friends only).
    const visibility = owner.isPrivate === true ? "friends" : "public";
 
    const s = parseJson<Record<string, unknown>>(req.body.settings, {});
    const settings = {
      hideLikeCount: s.hideLikeCount === true,
      hideSaveCount: s.hideSaveCount === true,
      hideShareCount: s.hideShareCount === true,
      hideComments: s.hideComments === true,
    };
 
    /* ---- poll ---- */
    let poll:
      | {
          question: string;
          options: { optionId: string; text: string; votes: string[] }[];
          endsAt: Date;
        }
      | undefined;
    const rawPoll = parseJson<any>(req.body.poll, null);
    if (rawPoll) {
      const question = String(rawPoll.question ?? "").trim();
      const options = (Array.isArray(rawPoll.options) ? rawPoll.options : [])
        .map((o: unknown) => String(o ?? "").trim())
        .filter(Boolean);
      const days = Number(rawPoll.durationDays);
      if (!question || question.length > 200)
        throw new HttpError(400, "Poll question is required (max 200 characters).");
      if (options.length < 2 || options.length > 4)
        throw new HttpError(400, "A poll needs 2 to 4 options.");
      if (options.some((o: string) => o.length > 80))
        throw new HttpError(400, "Poll options can be at most 80 characters.");
      if (new Set(options.map((o: string) => o.toLowerCase())).size !== options.length)
        throw new HttpError(400, "Poll options must be different.");
      if (![1, 3, 7].includes(days))
        throw new HttpError(400, "Poll length must be 1, 3 or 7 days.");
 
      poll = {
        question,
        options: options.map((text: string) => ({
          optionId: randomUUID(),
          text,
          votes: [],
        })),
        endsAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      };
    }
 
    /* ---- media rules ---- */
    if (images.length && video)
      throw new HttpError(400, "A post can have photos or a video, not both.");
    if (images.length > MAX_IMAGES)
      throw new HttpError(400, `A post can have at most ${MAX_IMAGES} photos.`);
    if (images.some((f) => f.size > MAX_IMAGE_BYTES))
      throw new HttpError(400, "Each photo must be 20 MB or smaller.");
 
    const reqStart = toNumber(req.body.videoStart);
    const reqEnd = toNumber(req.body.videoEnd);
    if (reqStart !== undefined && reqEnd !== undefined) {
      if (reqEnd - reqStart > MAX_VIDEO_SECONDS + 0.05)
        throw new HttpError(400, `Video can be at most ${MAX_VIDEO_SECONDS} seconds.`);
    }
 
    if (!caption && images.length === 0 && !video && !poll)
      throw new HttpError(400, "Write something or add a photo, video or poll.");
 
    /* ---- upload to Cloudinary (originals, no cropping/resizing) ---- */
    const folder = `jobdrips/posts/${userId}`;
    const imageUrls: string[] = [];
    let videoUrl = "";
    let videoMeta:
      | {
          publicId: string;
          originalDuration: number;
          startTime: number;
          endTime: number;
          duration: number;
          width: number;
          height: number;
          thumbnailUrl: string;
        }
      | undefined;
 
    if (images.length) {
      const results = await Promise.all(
        images.map((f) =>
          cloudinary.uploader.upload(f.path, {
            folder,
            resource_type: "image",
            use_filename: false,
            unique_filename: true,
          })
        )
      );
      for (const r of results) {
        uploaded.push({ publicId: r.public_id, type: "image" });
        imageUrls.push(r.secure_url);
      }
    }
 
    if (video) {
      const r: any = await cloudinary.uploader.upload_large(video.path, {
        folder,
        resource_type: "video",
        chunk_size: 6_000_000,
      });
      uploaded.push({ publicId: r.public_id, type: "video" });
 
      const originalDuration = Number(r.duration);
      if (!Number.isFinite(originalDuration) || originalDuration <= 0)
        throw new HttpError(400, "Could not read the video duration.");
 
      const start = Math.max(0, reqStart ?? 0);
      const end = Math.min(originalDuration, reqEnd ?? originalDuration);
      const length = end - start;
 
      if (length > MAX_VIDEO_SECONDS + 0.05)
        throw new HttpError(
          400,
          `This video is ${Math.round(originalDuration)}s. Pick a section of ${MAX_VIDEO_SECONDS}s or less.`
        );
      if (length < MIN_VIDEO_SECONDS - 0.05)
        throw new HttpError(400, "Selected video section is too short.");
 
      const trimmed = start > 0.05 || end < originalDuration - 0.05;
 
      videoUrl = trimmed
        ? cloudinary.url(r.public_id, {
            resource_type: "video",
            secure: true,
            format: "mp4",
            transformation: [
              {
                start_offset: round2(start),
                end_offset: round2(end),
                quality: "auto",
              },
            ],
          })
        : r.secure_url;
 
      videoMeta = {
        publicId: r.public_id,
        originalDuration: round2(originalDuration),
        startTime: round2(start),
        endTime: round2(end),
        duration: round2(length),
        width: Number(r.width) || 0,
        height: Number(r.height) || 0,
        thumbnailUrl: cloudinary.url(r.public_id, {
          resource_type: "video",
          secure: true,
          format: "jpg",
          transformation: [{ start_offset: round2(start) }],
        }),
      };
    }
 
    /* ---- hashtags (case-sensitive, parsed from the caption) ---- */
    const hashtags = extractHashtags(caption);
 
    /* ---- mentions: ONLY people who are in the author's friend list ---- */
    const friendByName = new Map(
      acceptedFriends(owner).map((f) => [f.username.toLowerCase(), f] as const)
    );
    const mentionMap = new Map<string, { userId: string; username: string }>();
    for (const name of extractMentionNames(caption)) {
      const friend = friendByName.get(name.toLowerCase());
      if (friend) mentionMap.set(friend.userid, { userId: friend.userid, username: friend.username });
    }
    const mentions = [...mentionMap.values()];
 
    /* ---- build the post exactly like the posts already in profiles.posts ---- */
    const post = {
      postId: randomUUID(),
      userid: userId,
      createdAt: new Date(),
      imageUrl: {
        image1: imageUrls[0] ?? "",
        image2: imageUrls[1] ?? "",
        image3: imageUrls[2] ?? "",
        image4: imageUrls[3] ?? "",
        image5: imageUrls[4] ?? "",
      },
      captions: [{ captionId: randomUUID(), content: caption }],
      likes: [],
      comments: [],
      shares: [],
      saves: [],
      mentions: {
        mentionId: randomUUID(),
        mentions,
        notifiedUserIds: [],
      },
      hashtags,
      visibility,
      archived: false,
      settings,
      ...(videoUrl ? { videoUrl } : {}),
      ...(videoMeta ? { videoMeta } : {}),
      ...(poll ? { poll } : {}),
    };
 
    /* ---- save into the logged-in profile's `posts` array ---- */
    // Native driver on purpose: it stores the post exactly as built above
    // (same shape as your existing posts, plus video / poll fields).
    const result = await Profile.collection.updateOne(
      { userid: userId },
      { $push: { posts: post }, $set: { updatedAt: new Date() } } as any
    );
    if (result.matchedCount === 0) throw new HttpError(404, "Profile not found.");
 
    /* ---- hashtag counters: exact spelling, +1 if it exists, else create with 1 ---- */
    await Promise.all(
      hashtags.map(async (tag) => {
        try {
          await Hashtag.updateOne(
            { hashtag: storedTag(tag) },
            { $inc: { usesCount: 1 }, $setOnInsert: { hashtagId: randomUUID() } },
            { upsert: true }
          );
        } catch (err) {
          // The post is already saved — never fail the request over a counter.
          console.error(`Hashtag update failed for "${tag}":`, err);
        }
      })
    );
 
    uploaded.length = 0; // success: keep the Cloudinary assets
    res.status(201).json({ post });
  } catch (err) {
    // Roll back anything we already pushed to Cloudinary.
    await Promise.allSettled(
      uploaded.map((u) =>
        cloudinary.uploader.destroy(u.publicId, { resource_type: u.type })
      )
    );
 
    if (err instanceof HttpError) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error("Create post failed:", err);
    res.status(500).json({ message: "Could not create the post. Please try again." });
  } finally {
    // Always remove multer's temp files.
    await Promise.allSettled(
      [...images, ...(video ? [video] : [])].map((f) => fs.unlink(f.path))
    );
  }
};