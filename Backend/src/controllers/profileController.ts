import type { Request, Response } from "express";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

import Profile, { type IProfile } from "../models/Profile.js";
import { User } from "../models/User.js";
import type { AuthenticatedRequest } from "../utils/authMiddleware.js";
import Notification from "../models/Notification.js";
import { createMessage } from "./messageController.js";
import { emitToUser } from "../utils/realtime.js";
import {
  createNotification,
} from "../utils/notificationService.js";
import {
  acceptedFriendIds,
  getRelationship,
  listablePosts,
  loadRequestedIds,
  makeRelationLookup,
  serializePost,
  type RawPost,
  type Relationship,
} from "../utils/postHelpers.js";

type UnknownRecord = Record<string, unknown>;
type ProfileDocument = InstanceType<typeof Profile>;
type FriendshipSource = Pick<IProfile, "userid" | "friends">;

type AuthenticatedUser = NonNullable<
  Awaited<ReturnType<typeof getAuthenticatedUser>>
>;

const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;
const USERNAME_PATTERN = /^[a-zA-Z0-9_.]{3,30}$/;
const USERNAME_RULE =
  "Username must be 3–30 characters and contain only letters, numbers, dots, or underscores.";

// --------------------------------------------------
// Helpers
// --------------------------------------------------

const getAuthenticatedUser = async (request: Request) => {
  const authenticatedRequest = request as AuthenticatedRequest;

  if (
    !authenticatedRequest.userId ||
    !mongoose.isValidObjectId(authenticatedRequest.userId)
  ) {
    return null;
  }

  return User.findById(authenticatedRequest.userId).select(
    "_id email name profilePhoto createdAt updatedAt",
  );
};

const normalizeUsername = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_.]/g, "")
    .slice(0, 30);

const sendUnauthorized = (response: Response): void => {
  response.status(401).json({
    success: false,
    code: "UNAUTHORIZED",
    message: "Authentication required.",
  });
};

const sendBadRequest = (response: Response, message: string): void => {
  response.status(400).json({ success: false, message });
};

const sendServerError = (response: Response, message: string): void => {
  response.status(500).json({ success: false, message });
};

const isCloudinaryImageUrl = (value: string): boolean =>
  /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//i.test(value);

// ---------------- Story editor helpers (caption, video, stickers, text) ----------------

const MAX_STORY_SECONDS = 60;
const MAX_STORY_CAPTION = 2200;
const MAX_STORY_OVERLAYS = 30;
const STORY_FONT_IDS = [
  "sans",
  "serif",
  "mono",
  "script",
  "display",
  "marker",
  "condensed",
  "elegant",
];

const isCloudinaryVideoUrl = (value: string): boolean =>
  /^https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\//i.test(value);

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

/** Validates the stickers / text the story editor sends. Anything odd is dropped. */
const sanitizeStoryOverlays = (value: unknown) => {
  if (!Array.isArray(value)) return [];

  return value.slice(0, MAX_STORY_OVERLAYS).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const kind = raw.kind === "sticker" || raw.kind === "text" ? raw.kind : null;
    const content = typeof raw.content === "string" ? raw.content.slice(0, kind === "sticker" ? 32 : 300) : "";
    if (!kind || !content.trim()) return [];

    return [
      {
        id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 64) : randomUUID(),
        kind,
        content,
        // x: fraction of the screen width; y: 0.5 = vertical centre, one unit = screen width
        x: clampNumber(raw.x, -0.5, 1.5, 0.5),
        y: clampNumber(raw.y, -3, 4, 0.5),
        scale: clampNumber(raw.scale, 0.3, 6, 1),
        rotation: clampNumber(raw.rotation, -360, 360, 0),
        color: typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : "#ffffff",
        font: typeof raw.font === "string" && STORY_FONT_IDS.includes(raw.font) ? raw.font : "sans",
        background: raw.background === true,
      },
    ];
  });
};

/** Plain overlay objects for the API (works for documents and lean results). */
const serializeStoryOverlays = (overlays: unknown) =>
  Array.isArray(overlays)
    ? overlays.map((o: any) => ({
        id: o.id,
        kind: o.kind,
        content: o.content,
        x: o.x,
        y: o.y,
        scale: o.scale,
        rotation: o.rotation,
        color: o.color,
        font: o.font,
        background: Boolean(o.background),
      }))
    : [];

/** First frame of an uploaded Cloudinary video, used as the story poster / reply thumbnail. */
const videoPosterUrl = (videoUrl: string): string =>
  videoUrl
    // drop an existing trim segment (e.g. so_5,eo_65/) so the poster is a single transformation
    .replace(/\/video\/upload\/(?:[a-z]{1,3}_[^/]*\/)*/i, "/video/upload/so_0,w_720,c_limit/")
    .replace(/\.[a-z0-9]+(?:\?.*)?$/i, ".jpg");

const isActive = (story: { expiresAt: Date | string }): boolean =>
  new Date(story.expiresAt).getTime() > Date.now();

const activeStories = (profile: Pick<IProfile, "stories">) =>
  (profile.stories || []).filter(isActive);

/** Both people must have accepted each other. */
const areFriends = (a: FriendshipSource, b: FriendshipSource): boolean =>
  a.friends.some(
    (friend) => friend.userid === b.userid && friend.friendshipAccepted,
  ) &&
  b.friends.some(
    (friend) => friend.userid === a.userid && friend.friendshipAccepted,
  );

/** Latest profile photos for a set of people, keyed by user id. */
const getProfileImages = async (
  userids: string[],
): Promise<Map<string, string>> => {
  const unique = [...new Set(userids.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const found = await Profile.find({ userid: { $in: unique } }).select(
    "userid profileimage",
  );

  return new Map(found.map((item) => [item.userid, item.profileimage || ""]));
};

/** Friends and requests, each with the person's current profile photo. */
const attachPhotos = async (
  profile: Pick<IProfile, "friends" | "requests">,
  relationFor?: (userid: string) => Relationship,
) => {
  const friends = profile.friends || [];
  const requests = profile.requests || [];

  const images = await getProfileImages([
    ...friends.map((friend) => friend.userid),
    ...requests.map((request) => request.profile.userid),
  ]);

  return {
    friends: friends.map((friend) => ({
      userid: friend.userid,
      username: friend.username,
      friendshipAccepted: friend.friendshipAccepted,
      profileimage: images.get(friend.userid) ?? "",
      relationship: relationFor ? relationFor(friend.userid) : "friends",
    })),
    requests: requests.map((request) => ({
      profile: {
        userid: request.profile.userid,
        username: request.profile.username,
        bio: request.profile.bio,
        profileimage:
          images.get(request.profile.userid) ||
          request.profile.profileimage ||
          "",
        education: request.profile.education,
        experience: request.profile.experience,
      },
      accept: request.accept,
      createdAt: request.createdAt,
    })),
  };
};

/** Owner, public profile, or accepted friend. */
const canViewerAccess = async (
  viewerId: string,
  target: Pick<IProfile, "userid" | "isPrivate" | "friends">,
): Promise<boolean> => {
  if (viewerId === target.userid || !target.isPrivate) return true;

  const viewerProfile = await Profile.findOne({ userid: viewerId }).select(
    "userid friends",
  );

  return Boolean(viewerProfile && areFriends(viewerProfile, target));
};

/**
 * Stories as the given viewer should see them.
 *  - seen:      has THIS viewer already watched the story?
 *  - viewCount / viewers: only returned to the owner, and never include the
 *    owner's own views.
 */
const serializeStories = (
  profile: Pick<IProfile, "userid" | "stories">,
  viewerId: string,
) => {
  const isOwner = viewerId === profile.userid;

  return activeStories(profile)
    .slice()
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    .map((story) => {
      // One entry per person, never the owner's own views.
      const seenIds = new Set<string>();
      const uniqueViewers = (story.viewers || []).filter((viewer) => {
        if (seenIds.has(viewer.userId)) return false;
        seenIds.add(viewer.userId);
        return true;
      });
      const likeIds = new Set<string>((story.likes || []).map(String));

      const base = {
        storyId: story.storyId,
        imageUrl: story.imageUrl,
        mediaType: story.mediaType === "video" ? "video" : "image",
        videoUrl: story.videoUrl || "",
        duration: story.duration || 0,
        aspect: story.aspect || 0,
        caption: story.caption || "",
        overlays: serializeStoryOverlays(story.overlays),
        createdAt: story.createdAt,
        expiresAt: story.expiresAt,
        seen: seenIds.has(viewerId),
        liked: likeIds.has(viewerId),
      };

      if (!isOwner) return base;

      const others = uniqueViewers.filter(
        (viewer) => viewer.userId !== profile.userid,
      );

      return {
        ...base,
        viewCount: others.length,
        likeCount: likeIds.size,
        viewers: others.map((viewer) => ({
          userId: viewer.userId,
          email: viewer.email,
          viewedAt: viewer.viewedAt,
        })),
      };
    });
};
/** Posts for a profile grid (light version: no comment bodies). */
const serializeProfilePosts = (
  posts: unknown[],
  viewerId: string,
  isOwner: boolean,
) =>
  listablePosts((posts ?? []) as RawPost[], isOwner).map((post) =>
    serializePost(post, { viewerId }),
  );

const hydrateSavedVideoPosts = async (savedPosts: unknown[]) => {
  const records = savedPosts.map((saved) =>
    saved && typeof saved === "object" && !Array.isArray(saved)
      ? (saved as UnknownRecord)
      : null,
  );
  const missingMedia = records.flatMap((saved) => {
    if (
      !saved ||
      (typeof saved.videoUrl === "string" && saved.videoUrl.length > 0) ||
      typeof saved.userid !== "string" ||
      typeof saved.postId !== "string"
    ) {
      return [];
    }
    return [{ userid: saved.userid, postId: saved.postId }];
  });

  if (missingMedia.length === 0) return savedPosts;

  const ownerProfiles = await Profile.find({
    userid: { $in: [...new Set(missingMedia.map((item) => item.userid))] },
    "posts.postId": { $in: [...new Set(missingMedia.map((item) => item.postId))] },
  })
    .select("userid posts.postId posts.videoUrl posts.videoMeta")
    .lean();

  const videoByPost = new Map<string, { videoUrl?: string; videoMeta?: unknown }>();
  for (const owner of ownerProfiles) {
    for (const post of owner.posts ?? []) {
      if (!post || typeof post !== "object") continue;
      const record = post as UnknownRecord;
      if (typeof record.postId !== "string" || typeof record.videoUrl !== "string") continue;
      videoByPost.set(`${owner.userid}:${record.postId}`, {
        videoUrl: record.videoUrl,
        videoMeta: record.videoMeta,
      });
    }
  }

  return records.map((saved) => {
    if (!saved || typeof saved.userid !== "string" || typeof saved.postId !== "string") {
      return saved;
    }
    const video = videoByPost.get(`${saved.userid}:${saved.postId}`);
    return video ? { ...saved, ...video } : saved;
  });
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const profileMentionedPosts = async (
  username: string,
  friendIds: string[],
  storedPosts: unknown[],
) => {
  if (!username || friendIds.length === 0) return storedPosts;

  const friends = (await Profile.find({ userid: { $in: friendIds } })
    .select("userid posts")
    .lean()) as Array<{
      userid: string;
      username?: string;
      profileimage?: string;
      posts?: unknown[];
    }>;
  const mentionPattern = new RegExp(
    `(^|[^A-Za-z0-9_.])@${escapeRegex(username)}(?![A-Za-z0-9_.])`,
    "i",
  );
  const mentionedPosts = new Map<string, unknown>();

  for (const item of storedPosts) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as UnknownRecord).postId === "string"
    ) {
      mentionedPosts.set(
        `${String((item as UnknownRecord).userid || "")}:${String((item as UnknownRecord).postId)}`,
        item,
      );
    }
  }

  for (const friend of friends) {
    for (const post of friend.posts ?? []) {
      if (!post || typeof post !== "object") continue;
      const record = post as UnknownRecord;
      const captions = record.captions;
      const caption = Array.isArray(captions)
        ? captions.map((item) => (item && typeof item === "object" ? String((item as UnknownRecord).content || "") : "")).join(" ")
        : captions && typeof captions === "object"
          ? String((captions as UnknownRecord).content || "")
          : "";
      if (!mentionPattern.test(caption)) continue;

      const postId = typeof record.postId === "string" ? record.postId : "";
      if (!postId) continue;

      mentionedPosts.set(`${friend.userid}:${postId}`, {
        ...record,
        userid: friend.userid,
        caption,
        ownerUsername: friend.username,
        ownerProfileImage: friend.profileimage || "",
      });
    }
  }

  return [...mentionedPosts.values()];
};

const getOrCreateProfile = async (
  user: AuthenticatedUser,
): Promise<ProfileDocument> => {
  const userid = user._id.toString();

  // CHANGED: look up by userid only. The old $or on username could return a
  // different person's profile when their username matched this user's email.
  const existing = await Profile.findOne({ userid });
  if (existing) return existing;

  const fallback = `user${userid.slice(-8)}`;
  let username =
    normalizeUsername(user.email.split("@")[0] || "") ||
    normalizeUsername(user.name || "");

  if (username.length < 3) username = fallback;

  if (await Profile.exists({ username })) {
    username = `${username.slice(0, 20)}_${userid.slice(-8)}`;
  }

  return Profile.create({
    userid,
    username,
    bio: "",
    location: "",
    website: "",
    profileimage: user.profilePhoto || "",
    coverimage: "",
    isPrivate: false,
    education: { school: [], college: [] },
    experience: [],
    posts: [],
    mentionedPosts: [],
    savedPosts: [],
    friends: [],
    requests: [],
    stories: [],
  });
};

const serializeOwnProfile = async (
  user: AuthenticatedUser,
  profile: ProfileDocument,
) => {
  const { friends: allFriends, requests } = await attachPhotos(profile);
  // Only accepted friends are ever shown (pending requests live in `requests`).
  const friends = allFriends.filter((friend) => friend.friendshipAccepted);
  const posts = serializeProfilePosts(
    profile.posts,
    user._id.toString(),
    true,
  );
  const savedPosts = await hydrateSavedVideoPosts(profile.savedPosts);
  const friendIds = friends.map((friend) => friend.userid);
  const mentionedPosts = await profileMentionedPosts(
    profile.username,
    friendIds,
    profile.mentionedPosts,
  );

  return {
    user: {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      profilePhoto: user.profilePhoto,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    profile: {
      userid: profile.userid,
      username: profile.username,
      bio: profile.bio,
      location: profile.location || "",
      website: profile.website || "",
      profileimage: profile.profileimage || user.profilePhoto || "",
      coverimage: profile.coverimage || "",
      isPrivate: profile.isPrivate,
      education: profile.education,
      experience: profile.experience,
      friends,
      requests,
      posts,
      postsCount: posts.length,
      mentionedPosts,
      savedPosts,
      stories: serializeStories(profile, user._id.toString()),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    },
  };
};

// --------------------------------------------------
// GET MY PROFILE
// GET /api/profiles/me
// --------------------------------------------------

export const getMyProfile = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const profile = await getOrCreateProfile(user);

    response.status(200).json({
      success: true,
      data: await serializeOwnProfile(user, profile),
    });
  } catch (error) {
    console.error("Get my profile failed:", error);
    sendServerError(response, "Unable to load your profile.");
  }
};

// --------------------------------------------------
// UPDATE MY PROFILE
// PATCH /api/profiles/me
// --------------------------------------------------

export const updateMyProfile = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const profile = await getOrCreateProfile(user);
    const body = (request.body ?? {}) as UnknownRecord;

    // Plain text fields with a maximum length.
    const textLimits = { bio: 500, location: 100, website: 200 } as const;

    for (const [field, max] of Object.entries(textLimits)) {
      const value = body[field];
      if (value === undefined) continue;

      if (typeof value !== "string") {
        sendBadRequest(response, `${field} must be a string.`);
        return;
      }

      if (value.length > max) {
        sendBadRequest(
          response,
          `${field} must be ${max} characters or fewer.`,
        );
        return;
      }

      profile.set(field, value.trim());
    }

    // Image URLs (profile photo and cover photo) must come from Cloudinary.
    for (const field of ["profileimage", "coverimage"] as const) {
      const value = body[field];
      if (value === undefined) continue;

      if (
        typeof value !== "string" ||
        (value !== "" && !isCloudinaryImageUrl(value))
      ) {
        sendBadRequest(response, `${field} must be a valid Cloudinary image URL.`);
        return;
      }

      profile.set(field, value.trim());
    }

    if (body.username !== undefined) {
      if (
        typeof body.username !== "string" ||
        !USERNAME_PATTERN.test(body.username)
      ) {
        sendBadRequest(response, USERNAME_RULE);
        return;
      }

      const username = body.username.toLowerCase();

      const existing = await Profile.findOne({
        username,
        userid: { $ne: profile.userid },
      }).select("_id");

      if (existing) {
        response.status(409).json({
          success: false,
          message: "That username is already taken.",
        });
        return;
      }

      profile.username = username;
    }

    if (body.isPrivate !== undefined) {
      if (typeof body.isPrivate !== "boolean") {
        sendBadRequest(response, "isPrivate must be a boolean.");
        return;
      }

      profile.isPrivate = body.isPrivate;
    }

    if (body.education !== undefined) {
      if (
        !body.education ||
        typeof body.education !== "object" ||
        Array.isArray(body.education)
      ) {
        sendBadRequest(response, "education must be an object.");
        return;
      }

      const education = body.education as UnknownRecord;

      for (const key of ["school", "college"]) {
        if (education[key] !== undefined && !Array.isArray(education[key])) {
          sendBadRequest(response, `education.${key} must be an array.`);
          return;
        }
      }

      profile.education = {
        school: (education.school ?? profile.education?.school ?? []) as never,
        college: (education.college ?? profile.education?.college ?? []) as never,
      };
    }

    if (body.experience !== undefined) {
      if (!Array.isArray(body.experience)) {
        sendBadRequest(response, "experience must be an array.");
        return;
      }

      profile.experience = body.experience as never;
    }

    await profile.save();

    if (typeof body.profileimage === "string") {
      user.profilePhoto = profile.profileimage;
      await user.save();
    }

    response.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      data: await serializeOwnProfile(user, profile),
    });
  } catch (error) {
    console.error("Update profile failed:", error);

    if (error instanceof mongoose.Error.ValidationError) {
      response.status(400).json({
        success: false,
        message: "Profile data is invalid.",
        details: error.message,
      });
      return;
    }

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: number }).code === 11000
    ) {
      response.status(409).json({
        success: false,
        message: "That username or profile ID is already in use.",
      });
      return;
    }

    sendServerError(response, "Unable to update your profile.");
  }
};

// --------------------------------------------------
// UPDATE PROFILE IMAGE
// PATCH /api/profiles/me/image
// --------------------------------------------------

export const updateProfileImage = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const { profileimage } = (request.body ?? {}) as {
      profileimage?: unknown;
    };

    if (
      typeof profileimage !== "string" ||
      !isCloudinaryImageUrl(profileimage)
    ) {
      sendBadRequest(response, "Provide a valid Cloudinary secure image URL.");
      return;
    }

    const profile = await getOrCreateProfile(user);

    profile.profileimage = profileimage;
    await profile.save();

    user.profilePhoto = profileimage;
    await user.save();

    response.status(200).json({
      success: true,
      message: "Profile image updated successfully.",
      data: {
        profileimage,
        profilePhoto: profileimage,
      },
    });
  } catch (error) {
    console.error("Update profile image failed:", error);
    sendServerError(response, "Unable to update your profile image.");
  }
};

// --------------------------------------------------
// ADD EDUCATION
// POST /api/profiles/me/education
// --------------------------------------------------

export const addEducation = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const body = (request.body ?? {}) as UnknownRecord;
    const type = body.type;

    if (type !== "school" && type !== "college") {
      sendBadRequest(response, "type must be school or college.");
      return;
    }

    const startYear = Number(body.startYear);
    const endYear =
      body.endYear === "" ||
      body.endYear === null ||
      body.endYear === undefined
        ? null
        : Number(body.endYear);

    if (
      typeof body.name !== "string" ||
      !body.name.trim() ||
      !Number.isInteger(startYear) ||
      startYear < 1900 ||
      startYear > 2200 ||
      (endYear !== null &&
        (!Number.isInteger(endYear) || endYear < startYear || endYear > 2200))
    ) {
      sendBadRequest(response, "Provide a name and valid start/end years.");
      return;
    }

    const profile = await getOrCreateProfile(user);
    const id = randomUUID();

    if (type === "school") {
      profile.education.school.push({
        schoolId: id,
        name: body.name.trim(),
        board: typeof body.board === "string" ? body.board.trim() : "",
        startYear,
        endYear,
      } as never);
    } else {
      profile.education.college.push({
        collegeId: id,
        name: body.name.trim(),
        degree: typeof body.degree === "string" ? body.degree.trim() : "",
        field: typeof body.field === "string" ? body.field.trim() : "",
        startYear,
        endYear,
      } as never);
    }

    await profile.save();

    response.status(201).json({
      success: true,
      message: "Education added successfully.",
      data: profile.education,
    });
  } catch (error) {
    console.error("Add education failed:", error);

    if (error instanceof mongoose.Error.ValidationError) {
      response.status(400).json({
        success: false,
        message: "Education data is invalid.",
        details: error.message,
      });
      return;
    }

    sendServerError(response, "Unable to add education.");
  }
};

// --------------------------------------------------
// DELETE EDUCATION
// DELETE /api/profiles/me/education/:id
// --------------------------------------------------

export const deleteEducation = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const profile = await getOrCreateProfile(user);
    const id = request.params.id;

    const originalCount =
      profile.education.school.length + profile.education.college.length;

    profile.education.school = profile.education.school.filter(
      (item) => item.schoolId !== id,
    ) as never;

    profile.education.college = profile.education.college.filter(
      (item) => item.collegeId !== id,
    ) as never;

    const newCount =
      profile.education.school.length + profile.education.college.length;

    if (newCount === originalCount) {
      response.status(404).json({
        success: false,
        message: "Education entry not found.",
      });
      return;
    }

    await profile.save();

    response.status(200).json({
      success: true,
      message: "Education deleted successfully.",
      data: profile.education,
    });
  } catch (error) {
    console.error("Delete education failed:", error);
    sendServerError(response, "Unable to delete education.");
  }
};

// --------------------------------------------------
// ADD EXPERIENCE
// POST /api/profiles/me/experience
// --------------------------------------------------

export const addExperience = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const body = (request.body ?? {}) as UnknownRecord;

    if (
      typeof body.role !== "string" ||
      !body.role.trim() ||
      typeof body.startDate !== "string" ||
      !body.startDate.trim()
    ) {
      sendBadRequest(response, "role and startDate are required.");
      return;
    }

    const profile = await getOrCreateProfile(user);

    profile.experience.push({
      experienceId: randomUUID(),
      company: typeof body.company === "string" ? body.company.trim() : "",
      role: body.role.trim(),
      employmentType:
        typeof body.employmentType === "string"
          ? body.employmentType.trim()
          : "",
      location: typeof body.location === "string" ? body.location.trim() : "",
      startDate: body.startDate.trim(),
      endDate:
        typeof body.endDate === "string" && body.endDate.trim()
          ? body.endDate.trim()
          : "Present",
      description:
        typeof body.description === "string" ? body.description.trim() : "",
    } as never);

    await profile.save();

    response.status(201).json({
      success: true,
      message: "Experience added successfully.",
      data: profile.experience,
    });
  } catch (error) {
    console.error("Add experience failed:", error);

    if (error instanceof mongoose.Error.ValidationError) {
      response.status(400).json({
        success: false,
        message: "Experience data is invalid.",
        details: error.message,
      });
      return;
    }

    sendServerError(response, "Unable to add experience.");
  }
};

// --------------------------------------------------
// DELETE EXPERIENCE
// DELETE /api/profiles/me/experience/:id
// --------------------------------------------------

export const deleteExperience = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const profile = await getOrCreateProfile(user);
    const id = request.params.id;
    const originalCount = profile.experience.length;

    profile.experience = profile.experience.filter(
      (item) => item.experienceId !== id,
    ) as never;

    if (profile.experience.length === originalCount) {
      response.status(404).json({
        success: false,
        message: "Experience entry not found.",
      });
      return;
    }

    await profile.save();

    response.status(200).json({
      success: true,
      message: "Experience deleted successfully.",
      data: profile.experience,
    });
  } catch (error) {
    console.error("Delete experience failed:", error);
    sendServerError(response, "Unable to delete experience.");
  }
};

// --------------------------------------------------
// CREATE STORY
// POST /api/profiles/me/stories
// Body (image story): { imageUrl, caption?, aspect?, overlays? }
// Body (video story): { mediaType: "video", videoUrl, imageUrl?, duration?, caption?, aspect?, overlays? }
// The URLs are Cloudinary secure URLs returned by /api/uploads/image|video.
// Each story expires 24 hours after its own upload time.
// --------------------------------------------------

export const createStory = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const isVideo = body.mediaType === "video";

    let imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : "";
    let videoUrl = "";
    let duration = 0;

    if (isVideo) {
      videoUrl = typeof body.videoUrl === "string" ? body.videoUrl : "";

      if (!isCloudinaryVideoUrl(videoUrl)) {
        sendBadRequest(response, "A valid Cloudinary video URL is required.");
        return;
      }

      duration = clampNumber(body.duration, 0, MAX_STORY_SECONDS, 0);
      // The poster frame is always derived from the (already validated) video URL.
      imageUrl = videoPosterUrl(videoUrl);
    } else if (!isCloudinaryImageUrl(imageUrl)) {
      sendBadRequest(response, "A valid Cloudinary image URL is required.");
      return;
    }

    const caption =
      typeof body.caption === "string"
        ? body.caption.replace(/\r\n/g, "\n").trim().slice(0, MAX_STORY_CAPTION)
        : "";

    const profile = await getOrCreateProfile(user);
    const now = new Date();

    // Remove expired stories without validating unrelated legacy profile fields.
    await Profile.updateOne(
      { _id: profile._id },
      { $pull: { stories: { expiresAt: { $lte: now } } } },
    );

    const story = {
      storyId: randomUUID(),
      imageUrl,
      mediaType: isVideo ? "video" : "image",
      videoUrl,
      duration,
      aspect: clampNumber(body.aspect, 0, 10, 0),
      caption,
      overlays: sanitizeStoryOverlays(body.overlays),
      createdAt: now,
      expiresAt: new Date(now.getTime() + STORY_LIFETIME_MS),
      viewers: [],
    };

    // A document save validates every embedded post too; a malformed legacy post
    // must not prevent a valid story from being persisted.
    const persisted = await Profile.updateOne(
      { _id: profile._id },
      { $push: { stories: story as never } },
      { runValidators: true },
    );
    if (persisted.matchedCount === 0) {
      throw new Error("The profile no longer exists; the story was not saved.");
    }

    response.status(201).json({
      success: true,
      message: "Story published successfully.",
      data: {
        story: {
          storyId: story.storyId,
          imageUrl: story.imageUrl,
          mediaType: story.mediaType,
          videoUrl: story.videoUrl,
          duration: story.duration,
          aspect: story.aspect,
          caption: story.caption,
          overlays: story.overlays,
          createdAt: story.createdAt,
          expiresAt: story.expiresAt,
          seen: false,
          viewCount: 0,
          likeCount: 0,
          viewers: [],
        },
      },
    });
  } catch (error) {
    console.error("Create story failed:", error);
    sendServerError(
      response,
      process.env.NODE_ENV === "production"
        ? "Unable to publish your story."
        : `Unable to publish your story. (${error instanceof Error ? error.message : String(error)})`,
    );
  }
};

// --------------------------------------------------
// GET STORIES
// GET /api/profiles/:userid/stories
// --------------------------------------------------

export const getStories = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const viewer = await getAuthenticatedUser(request);

    if (!viewer) {
      sendUnauthorized(response);
      return;
    }

    const userid = request.params.userid;

    if (!userid) {
      sendBadRequest(response, "A user ID is required.");
      return;
    }

    const target = await Profile.findOne({ userid }).select(
      "userid username profileimage isPrivate friends stories",
    );

    if (!target) {
      response.status(404).json({
        success: false,
        message: "Profile not found.",
      });
      return;
    }

    const viewerId = viewer._id.toString();

    if (!(await canViewerAccess(viewerId, target))) {
      response.status(403).json({
        success: false,
        message:
          "Stories on this private profile are only available to accepted friends.",
      });
      return;
    }

    response.status(200).json({
      success: true,
      data: {
        userid: target.userid,
        username: target.username,
        profileimage: target.profileimage,
        stories: serializeStories(target, viewerId),
      },
    });
  } catch (error) {
    console.error("Get stories failed:", error);
    sendServerError(response, "Unable to load stories.");
  }
};

// --------------------------------------------------
// RECORD A STORY VIEW
// POST /api/profiles/:userid/stories/:storyId/view
// Saves the viewer's user id + email on the story. Safe to call more than
// once: a person is only recorded once per story.
// --------------------------------------------------

export const viewStory = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const viewer = await getAuthenticatedUser(request);

    if (!viewer) {
      sendUnauthorized(response);
      return;
    }

    const { userid, storyId } = request.params;

    if (!userid || !storyId) {
      sendBadRequest(response, "A user ID and story ID are required.");
      return;
    }

    const target = await Profile.findOne({ userid }).select(
      "userid isPrivate friends",
    );

    if (!target) {
      response.status(404).json({
        success: false,
        message: "Profile not found.",
      });
      return;
    }

    const viewerId = viewer._id.toString();

    if (!(await canViewerAccess(viewerId, target))) {
      response.status(403).json({
        success: false,
        message: "You can't view stories on this private profile.",
      });
      return;
    }

    const now = new Date();

    // Only matches an active story this viewer has not been recorded on yet.
    const result = await Profile.updateOne(
      {
        userid,
        stories: {
          $elemMatch: {
            storyId,
            expiresAt: { $gt: now },
            "viewers.userId": { $ne: viewerId },
          },
        },
      },
      {
        $push: {
          "stories.$.viewers": {
            userId: viewerId,
            email: viewer.email,
            viewedAt: now,
          },
        },
      },
    );

    response.status(200).json({
      success: true,
      recorded: result.modifiedCount > 0,
    });
  } catch (error) {
    console.error("Record story view failed:", error);
    sendServerError(response, "Unable to record the story view.");
  }
};

// --------------------------------------------------
// DELETE STORY
// DELETE /api/profiles/me/stories/:storyId
// --------------------------------------------------

export const deleteStory = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const profile = await getOrCreateProfile(user);
    const storyId = request.params.storyId;
    const result = await Profile.updateOne(
      { _id: profile._id, "stories.storyId": storyId },
      { $pull: { stories: { storyId } } },
    );

    if (result.modifiedCount === 0) {
      response.status(404).json({
        success: false,
        message: "Story not found.",
      });
      return;
    }

    response.status(200).json({
      success: true,
      message: "Story deleted successfully.",
    });
  } catch (error) {
    console.error("Delete story failed:", error);
    sendServerError(response, "Unable to delete story.");
  }
};

// --------------------------------------------------
// GET ANOTHER USER'S PROFILE
// GET /api/profiles/:userid
// --------------------------------------------------

export const getPublicProfile = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const viewer = await getAuthenticatedUser(request);
    const userid = request.params.userid;

    if (!userid) {
      sendBadRequest(response, "A user ID is required.");
      return;
    }

    const target = await Profile.findOne({ userid });

    if (!target) {
      response.status(404).json({
        success: false,
        message: "Profile not found.",
      });
      return;
    }

    const viewerId = viewer ? viewer._id.toString() : "";
    const isOwner = viewerId !== "" && viewerId === target.userid;

    const viewerProfile =
      viewer && !isOwner
        ? await Profile.findOne({ userid: viewerId }).select(
            "userid friends requests",
          )
        : null;

    const relationship = getRelationship(viewerId, viewerProfile, target);
    const canSeePosts =
      isOwner || !target.isPrivate || relationship === "friends";

    // The profile document only stores the username; the display name lives on the user.
    const owner = mongoose.isValidObjectId(target.userid)
      ? await User.findById(target.userid).select("name")
      : null;

    // Each friend carries the viewer's relationship to them, so the list can
    // show "Message" for friends and "Add friend" for everyone else.
    const acceptedFriends = target.friends.filter(
      (friend) => friend.friendshipAccepted,
    );
    const requestedIds = await loadRequestedIds(
      viewerId,
      acceptedFriends.map((friend) => friend.userid),
    );

    const { friends: friendsWithPhotos } = await attachPhotos(
      { friends: acceptedFriends, requests: [] },
      makeRelationLookup(viewerId, viewerProfile, requestedIds),
    );

    const allPosts = (target.posts ?? []) as RawPost[];
    const postsCount = listablePosts(allPosts, isOwner).length;
    const posts = canSeePosts
      ? serializeProfilePosts(allPosts, viewerId, isOwner)
      : [];
    const savedPosts = isOwner
      ? await hydrateSavedVideoPosts(target.savedPosts)
      : [];
    const mentionedPosts = isOwner && canSeePosts
      ? await profileMentionedPosts(
          target.username,
          acceptedFriends.map((friend) => friend.userid),
          target.mentionedPosts,
        )
      : canSeePosts
        ? target.mentionedPosts
        : [];

    response.status(200).json({
      success: true,
      data: {
        userid: target.userid,
        name: owner?.name || "",
        username: target.username,
        bio: target.bio,
        location: target.location || "",
        website: target.website || "",
        profileimage: target.profileimage,
        coverimage: target.coverimage,
        isPrivate: target.isPrivate,
        relationship,
        education: canSeePosts ? target.education : undefined,
        experience: canSeePosts ? target.experience : undefined,
        // Locked profiles only expose the counts, never the lists.
        friends: canSeePosts ? friendsWithPhotos : [],
        friendsCount: acceptedFriends.length,
        posts,
        postsCount,
        mentionedPosts,
        savedPosts,
        stories: canSeePosts ? serializeStories(target, viewerId) : [],
        postAccessRestricted: !canSeePosts,
        createdAt: target.createdAt,
        updatedAt: target.updatedAt,
      },
    });
  } catch (error) {
    console.error("Get public profile failed:", error);
    sendServerError(response, "Unable to load this profile.");
  }
};

// --------------------------------------------------
// CHECK USERNAME AVAILABILITY
// GET /api/profiles/username-availability?username=...
// --------------------------------------------------

export const checkUsernameAvailability = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const rawUsername = request.query.username;

    if (typeof rawUsername !== "string") {
      sendBadRequest(response, "A username is required.");
      return;
    }

    const username = rawUsername.trim().toLowerCase();

    if (!USERNAME_PATTERN.test(username)) {
      response.status(200).json({
        success: true,
        data: {
          username,
          available: false,
          valid: false,
          message: "Use 3–30 letters, numbers, dots, or underscores.",
        },
      });
      return;
    }

    const existing = await Profile.findOne({
      username,
      userid: { $ne: user._id.toString() },
    }).select("_id");

    response.status(200).json({
      success: true,
      data: {
        username,
        available: !existing,
        valid: true,
        message: existing
          ? "This username is already taken."
          : "This username is available.",
      },
    });
  } catch (error) {
    console.error("Check username failed:", error);
    sendServerError(response, "Unable to check username.");
  }
};

// --------------------------------------------------
// SEND A FRIEND REQUEST
// POST /api/profiles/:userid/friend-request
//
// The request is stored ONLY in the receiver's `requests` list. Nobody is
// added to anybody's friends list until the receiver accepts.
// --------------------------------------------------

export const sendFriendRequest = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const viewerId = user._id.toString();
    const targetId = String(request.params.userid || "");

    if (!targetId || targetId === viewerId) {
      sendBadRequest(response, "You can't send a request to yourself.");
      return;
    }

    const [mine, target] = await Promise.all([
      getOrCreateProfile(user),
      Profile.findOne({ userid: targetId }),
    ]);

    if (!target) {
      response.status(404).json({
        success: false,
        message: "Profile not found.",
      });
      return;
    }

    const relation = getRelationship(viewerId, mine, target);

    if (relation !== "none") {
      const messages: Record<string, string> = {
        friends: "You are already friends.",
        requested: "Friend request already sent.",
        received:
          "This person already sent you a request. Accept it from your requests.",
      };

      response.status(409).json({
        success: false,
        message: messages[relation] ?? "Request not possible.",
      });
      return;
    }

    await Profile.updateOne(
      { userid: targetId, "requests.profile.userid": { $ne: viewerId } },
      {
        $push: {
          requests: {
            profile: {
              userid: viewerId,
              username: mine.username,
              bio: mine.bio || "",
              profileimage: mine.profileimage || user.profilePhoto || "",
              education: { school: [], college: [] },
              experience: [],
            },
            accept: false,
            notified: false,
            createdAt: new Date(),
          },
        },
      },
    );

    // Notify once, then remember that it was done.
    const created = await createNotification({
      type: "friend_request",
      recipientUserId: targetId,
      actorUserId: viewerId,
      dedupeKey: `friend_request:${viewerId}:${targetId}:${Date.now()}`,
      message: `${mine.username} sent you a friend request.`,
    });

    if (created) {
      await Profile.updateOne(
        { userid: targetId },
        { $set: { "requests.$[r].notified": true } },
        { arrayFilters: [{ "r.profile.userid": viewerId }] },
      );
    }

    response.status(201).json({
      success: true,
      message: "Friend request sent.",
      data: { relationship: "requested" },
    });
  } catch (error) {
    console.error("Send friend request failed:", error);
    sendServerError(response, "Unable to send the friend request.");
  }
};

// --------------------------------------------------
// WITHDRAW A FRIEND REQUEST I SENT
// DELETE /api/profiles/:userid/friend-request
// --------------------------------------------------

export const withdrawFriendRequest = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const viewerId = String((request as AuthenticatedRequest).userId || "");
    const targetId = String(request.params.userid || "");

    if (!viewerId) {
      sendUnauthorized(response);
      return;
    }

    if (!targetId || targetId === viewerId) {
      sendBadRequest(response, "Choose a request to withdraw.");
      return;
    }

    // Removes it from the receiver's list...
    await Profile.updateOne(
      { userid: targetId },
      {
        $pull: {
          requests: { "profile.userid": viewerId, accept: false },
        },
      },
    );

    // ...clears any old pending entry from the earlier design...
    await Profile.updateOne(
      { userid: viewerId },
      { $pull: { friends: { userid: targetId, friendshipAccepted: false } } },
    );

    // ...and removes the notification they were shown.
    await Notification.deleteMany({
      type: "friend_request",
      actorUserId: viewerId,
      recipientUserId: targetId,
    });

    response.status(200).json({
      success: true,
      message: "Friend request withdrawn.",
      data: { relationship: "none" },
    });
  } catch (error) {
    console.error("Withdraw friend request failed:", error);
    sendServerError(response, "Unable to withdraw the friend request.");
  }
};

// --------------------------------------------------
// ACCEPT A FRIEND REQUEST
// POST /api/profiles/requests/:requesterId/accept
// --------------------------------------------------

export const acceptFriendRequest = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const viewerId = user._id.toString();
    const requesterId = String(request.params.requesterId || "");
    const mine = await getOrCreateProfile(user);

    const pending = mine.requests.find(
      (item) => item.profile.userid === requesterId && !item.accept,
    );

    const requester = requesterId
      ? await Profile.findOne({ userid: requesterId }).select("userid username")
      : null;

    if (!pending || !requester) {
      response.status(404).json({
        success: false,
        message: "Friend request not found.",
      });
      return;
    }

    // The request is finished: remove it from my list.
    await Profile.updateOne(
      { userid: viewerId },
      { $pull: { requests: { "profile.userid": requesterId } } },
    );

    // Only now do both people become friends of each other.
    await Profile.updateOne(
      { userid: viewerId, "friends.userid": { $ne: requesterId } },
      {
        $push: {
          friends: {
            userid: requesterId,
            username: requester.username,
            friendshipAccepted: true,
          },
        },
      },
    );

    await Profile.updateOne(
      { userid: requesterId, "friends.userid": { $ne: viewerId } },
      {
        $push: {
          friends: {
            userid: viewerId,
            username: mine.username,
            friendshipAccepted: true,
          },
        },
      },
    );

    // Safety net for entries that were saved as pending by the old design.
    await Profile.updateOne(
      { userid: requesterId },
      { $set: { "friends.$[f].friendshipAccepted": true } },
      { arrayFilters: [{ "f.userid": viewerId }] },
    );

    await Notification.deleteMany({
      type: "friend_request",
      actorUserId: requesterId,
      recipientUserId: viewerId,
    });

    await createNotification({
      type: "friend_accepted",
      recipientUserId: requesterId,
      actorUserId: viewerId,
      dedupeKey: `friend_accepted:${viewerId}:${requesterId}:${Date.now()}`,
      message: `${mine.username} accepted your friend request.`,
    });

    response.status(200).json({
      success: true,
      message: "Friend request accepted.",
    });
  } catch (error) {
    console.error("Accept friend request failed:", error);
    sendServerError(response, "Unable to accept the friend request.");
  }
};

// --------------------------------------------------
// DECLINE A FRIEND REQUEST
// POST /api/profiles/requests/:requesterId/decline
// --------------------------------------------------

export const declineFriendRequest = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const viewerId = user._id.toString();
    const requesterId = String(request.params.requesterId || "");

    if (!requesterId) {
      sendBadRequest(response, "A user ID is required.");
      return;
    }

    await Profile.updateOne(
      { userid: viewerId },
      { $pull: { requests: { "profile.userid": requesterId } } },
    );

    await Profile.updateOne(
      { userid: requesterId },
      { $pull: { friends: { userid: viewerId, friendshipAccepted: false } } },
    );

    await Notification.deleteMany({
      type: "friend_request",
      actorUserId: requesterId,
      recipientUserId: viewerId,
    });

    response.status(200).json({
      success: true,
      message: "Friend request declined.",
    });
  } catch (error) {
    console.error("Decline friend request failed:", error);
    sendServerError(response, "Unable to decline the friend request.");
  }
};

// --------------------------------------------------
// Story interactions used by the Messages story viewer.
// Kept in this existing controller so profileRoutes does not depend on an
// additional controller file that may be missing from a user's checkout.
// --------------------------------------------------
const storyInteractionUserId = (req: Request) =>
  String((req as AuthenticatedRequest).userId || "");

const storyInteractionFail = (res: Response, status: number, message: string) =>
  res.status(status).json({ success: false, message });

const getActiveStoryForInteraction = (profile: any, storyId: string) =>
  profile?.stories?.find(
    (story: any) =>
      story.storyId === storyId &&
      new Date(story.expiresAt).getTime() > Date.now(),
  );

const emitStoryInteractionChanged = (owner: any, storyId: string, action: string) => {
  const payload = {
    ownerUserId: String(owner.userid),
    storyId,
    action,
    at: new Date().toISOString(),
  };
  emitToUser(String(owner.userid), "story:updated", payload);
  for (const friendId of acceptedFriendIds(owner as any)) {
    emitToUser(friendId, "story:updated", payload);
  }
};

export const getStoryInteractions = async (req: Request, res: Response): Promise<void> => {
  try {
    const viewerId = storyInteractionUserId(req);
    const ownerId = String(req.params.userid || "");
    const storyId = String(req.params.storyId || "");
    if (!viewerId) {
      storyInteractionFail(res, 401, "Authentication required.");
      return;
    }
    if (viewerId !== ownerId) {
      storyInteractionFail(res, 403, "Only the story owner can see its viewer and liker lists.");
      return;
    }
    const owner = await Profile.findOne({ userid: ownerId }).select("userid stories").lean() as any;
    const story: any = getActiveStoryForInteraction(owner, storyId);
    if (!owner || !story) {
      storyInteractionFail(res, 404, "Story not found or expired.");
      return;
    }

    // First view per person only, and never the owner's own view.
    const firstViews = new Map<string, any>();
    for (const v of story.viewers || []) {
      const id = String(v.userId);
      if (id !== ownerId && !firstViews.has(id)) firstViews.set(id, v);
    }
    const likeIds: string[] = [...new Set<string>((story.likes || []).map((id: unknown) => String(id)))];

    const profiles = await Profile.find({ userid: { $in: [...firstViews.keys(), ...likeIds] } })
      .select("userid username profileimage").lean() as any[];
    const byId = new Map<string, any>(profiles.map((p: any): [string, any] => [String(p.userid), p]));

    const viewers = [...firstViews.values()]
      .sort((a, b) => new Date(b.viewedAt).getTime() - new Date(a.viewedAt).getTime())
      .map((v: any) => ({
        userId: String(v.userId),
        email: String(v.email || ""),
        viewedAt: v.viewedAt,
        username: byId.get(String(v.userId))?.username || "JobDrips user",
        profileimage: byId.get(String(v.userId))?.profileimage || "",
      }));
    const likes = likeIds.map((userId) => ({
      userId,
      username: byId.get(userId)?.username || "JobDrips user",
      profileimage: byId.get(userId)?.profileimage || "",
    }));

    res.json({ success: true, data: { storyId, viewers, likes, viewCount: viewers.length, likeCount: likes.length } });
  } catch (error) {
    console.error("Get story interactions failed:", error);
    storyInteractionFail(res, 500, "Unable to load story viewers and likes.");
  }
};

export const toggleStoryLike = async (req: Request, res: Response): Promise<void> => {
  try {
    const viewerId = storyInteractionUserId(req);
    const ownerId = String(req.params.userid || "");
    const storyId = String(req.params.storyId || "");
    if (!viewerId) {
      storyInteractionFail(res, 401, "Authentication required.");
      return;
    }
    const owner = await Profile.findOne({ userid: ownerId }).select("userid friends stories");
    const story: any = getActiveStoryForInteraction(owner, storyId);
    if (!owner || !story) {
      storyInteractionFail(res, 404, "Story not found or expired.");
      return;
    }
    if (viewerId !== ownerId) {
      const viewerProfile = await Profile.findOne({ userid: viewerId }).select("friends");
      if (
        !viewerProfile ||
        !acceptedFriendIds(viewerProfile as any).includes(ownerId) ||
        !acceptedFriendIds(owner as any).includes(viewerId)
      ) {
        storyInteractionFail(res, 403, "You can only like a friend's story.");
        return;
      }
    }

    const wasLiked = (story.likes || []).map(String).includes(viewerId);

    // Atomic: a person can only ever be in the likes list once.
    await Profile.updateOne(
      { userid: ownerId, "stories.storyId": storyId },
      wasLiked
        ? { $pull: { "stories.$.likes": viewerId } }
        : { $addToSet: { "stories.$.likes": viewerId } },
    );

    if (!wasLiked && viewerId !== ownerId) {
      const actor = await Profile.findOne({ userid: viewerId }).select("username").lean() as any;
      const text = `${actor?.username || "Someone"} liked your story`;
      await Notification.updateOne(
        { dedupeKey: `story-like:${storyId}:${viewerId}` },
        { $set: { notificationId: randomUUID(), dedupeKey: `story-like:${storyId}:${viewerId}`, recipientUserId: ownerId, actorUserId: viewerId, type: "message", text, message: text, read: false, createdAt: new Date() } },
        { upsert: true },
      );
             emitToUser(ownerId, "notification:new", { type: "story-like" });
    }

    const fresh = await Profile.findOne({ userid: ownerId }).select("userid stories").lean() as any;
    const freshStory = fresh?.stories?.find((s: any) => s.storyId === storyId);
    const likeIds: string[] = [...new Set<string>((freshStory?.likes || []).map(String))];

    emitStoryInteractionChanged(owner, storyId, wasLiked ? "unliked" : "liked");

    const profiles = await Profile.find({ userid: { $in: likeIds } }).select("userid username profileimage").lean() as any[];
    const byId = new Map<string, any>(profiles.map((p: any): [string, any] => [String(p.userid), p]));
    const likeDetails = likeIds.map((id) => ({
      userId: id,
      username: byId.get(id)?.username || "JobDrips user",
      profileimage: byId.get(id)?.profileimage || "",
    }));

    res.json({ success: true, data: { liked: !wasLiked, likes: likeIds, likeDetails, likeCount: likeIds.length } });
  } catch (error) {
    console.error("Toggle story like failed:", error);
    storyInteractionFail(res, 500, "Unable to update story like.");
  }
};

export const replyToStory = async (req: Request, res: Response): Promise<void> => {
  try {
    const senderId = storyInteractionUserId(req);
    const ownerId = String(req.params.userid || "");
    const storyId = String(req.params.storyId || "");
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!senderId) {
      storyInteractionFail(res, 401, "Authentication required.");
      return;
    }
    if (!text || text.length > 2000) {
      storyInteractionFail(res, 400, "Write a reply of up to 2000 characters.");
      return;
    }
    if (senderId === ownerId) {
      storyInteractionFail(res, 400, "You cannot reply to your own story.");
      return;
    }
    const [sender, owner] = await Promise.all([
      Profile.findOne({ userid: senderId }).select("friends username profileimage"),
      Profile.findOne({ userid: ownerId }).select("friends username profileimage stories"),
    ]);
    if (
      !sender || !owner ||
      !acceptedFriendIds(sender as any).includes(ownerId) ||
      !acceptedFriendIds(owner as any).includes(senderId)
    ) {
      storyInteractionFail(res, 403, "You can only reply to a friend's story.");
      return;
    }
    const story: any = getActiveStoryForInteraction(owner, storyId);
    if (!story) {
      storyInteractionFail(res, 404, "Story not found or expired.");
      return;
    }

    // createMessage finds (or creates) the personal conversation for these two
    // people, saves the message in conversation.messages and emits "message:new"
    // to both users, so no extra socket emits are needed here.
    const message = await createMessage({
      senderUserId: senderId, recipientUserId: ownerId, text, kind: "story_reply",
      storyId, storyOwnerId: ownerId, storyImageUrl: story.imageUrl,
      storyOwnerName: owner.username, storyOwnerAvatar: owner.profileimage,
      senderUsername: sender.username, senderAvatar: sender.profileimage,
    });
    const conversationId = message.conversationId;

    await Notification.updateOne(
      { dedupeKey: `story-reply:${message.messageId}` },
      { $setOnInsert: { notificationId: randomUUID(), dedupeKey: `story-reply:${message.messageId}`, recipientUserId: ownerId, actorUserId: senderId, type: "message", text: `Replied to your story: ${text}`, message: `${sender.username} replied to your story`, read: false, createdAt: new Date() } },
      { upsert: true },
    );
        emitToUser(ownerId, "notification:new", { type: "story-reply" });

    res.status(201).json({ success: true, data: { messageId: message.messageId, conversationId } });
  } catch (error) {
    console.error("Reply to story failed:", error);
    storyInteractionFail(res, 500, "Unable to send story reply.");
  }
}; 
