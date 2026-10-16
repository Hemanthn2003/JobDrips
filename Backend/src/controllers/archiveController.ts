import type { Request, Response } from "express";

import Profile from "../models/Profile.js";
import type { AuthenticatedRequest } from "../utils/authMiddleware.js";

const IMAGE_KEYS = ["image1", "image2", "image3", "image4", "image5"] as const;

const userIdOf = (request: Request): string =>
  String((request as AuthenticatedRequest).userId || "");

// --------------------------------------------------
// GET MY ARCHIVED POSTS
// GET /api/profiles/me/archived-posts
// Only the signed-in person's own posts with archived === true.
// --------------------------------------------------

export const getArchivedPosts = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const me = userIdOf(request);

    if (!me) {
      response
        .status(401)
        .json({ success: false, message: "Authentication required." });
      return;
    }

    const profile = (await Profile.findOne({ userid: me })
      .select("userid posts")
      .lean()) as unknown as { posts?: any[] } | null;

    const posts = (profile?.posts ?? [])
      .filter((post) => post && post.archived === true)
      .sort(
        (a, b) =>
          new Date(b.createdAt ?? 0).getTime() -
          new Date(a.createdAt ?? 0).getTime(),
      )
      .map((post) => {
        const imageMap = (post.imageUrl ?? {}) as Record<string, unknown>;
        const imageUrls = IMAGE_KEYS.map((key) => imageMap[key]).filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        );

        return {
          postId: String(post.postId),
          userid: String(post.userid || me),
          createdAt: post.createdAt ?? null,
          archived: true,
          visibility: post.visibility ?? "friends",
          caption: post.captions?.content ?? "",
          imageUrls,
          likeCount: Array.isArray(post.likes) ? post.likes.length : 0,
        };
      });

    response.status(200).json({ success: true, data: { posts } });
  } catch (error) {
    console.error("Get archived posts failed:", error);
    response
      .status(500)
      .json({ success: false, message: "Unable to load archived posts." });
  }
};

// --------------------------------------------------
// ARCHIVE / UNARCHIVE ONE OF MY POSTS
// PATCH /api/profiles/me/posts/:postId/archive
// Body: { archived: boolean }
// --------------------------------------------------

export const setPostArchived = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const me = userIdOf(request);
    const postId = String(request.params.postId || "");
    const archived = (request.body as { archived?: unknown } | undefined)
      ?.archived;

    if (!me) {
      response
        .status(401)
        .json({ success: false, message: "Authentication required." });
      return;
    }

    if (!postId || typeof archived !== "boolean") {
      response.status(400).json({
        success: false,
        message: "A post ID and an archived true/false value are required.",
      });
      return;
    }

    const result = await Profile.updateOne(
      { userid: me, "posts.postId": postId },
      { $set: { "posts.$.archived": archived } },
    );

    if (result.matchedCount === 0) {
      response
        .status(404)
        .json({ success: false, message: "Post not found." });
      return;
    }

    response.status(200).json({
      success: true,
      message: archived ? "Post archived." : "Post is back on your profile.",
      data: { postId, archived },
    });
  } catch (error) {
    console.error("Set post archived failed:", error);
    response
      .status(500)
      .json({ success: false, message: "Unable to update this post." });
  }
};