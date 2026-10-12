import type { Request, Response } from "express";

import Profile from "../models/Profile.js";
import type { AuthenticatedRequest } from "../utils/authMiddleware.js";

// --------------------------------------------------
// REMOVE A FRIEND
// DELETE /api/profiles/friends/:userid
//
// Removes the friendship from BOTH people's profiles: each one's friends
// list loses the other, and any old request record between them is cleared
// so either person can send a fresh request later.
// Existing chat messages are kept.
// --------------------------------------------------

export const removeFriend = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const viewerId = String((request as AuthenticatedRequest).userId || "");

    if (!viewerId) {
      response.status(401).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Authentication required.",
      });
      return;
    }

    const targetId = String(request.params.userid || "");

    if (!targetId || targetId === viewerId) {
      response.status(400).json({
        success: false,
        message: "Choose a friend to remove.",
      });
      return;
    }

    const [mine, target] = await Promise.all([
      Profile.findOne({ userid: viewerId }).select("userid friends"),
      Profile.findOne({ userid: targetId }).select("userid friends"),
    ]);

    if (!mine || !target) {
      response.status(404).json({
        success: false,
        message: "Profile not found.",
      });
      return;
    }

    const isFriend =
      mine.friends.some(
        (friend) => friend.userid === targetId && friend.friendshipAccepted,
      ) ||
      target.friends.some(
        (friend) => friend.userid === viewerId && friend.friendshipAccepted,
      );

    if (!isFriend) {
      response.status(409).json({
        success: false,
        message: "You are not friends with this person.",
      });
      return;
    }

    await Promise.all([
      Profile.updateOne(
        { userid: viewerId },
        {
          $pull: {
            friends: { userid: targetId },
            requests: { "profile.userid": targetId },
          },
        },
      ),
      Profile.updateOne(
        { userid: targetId },
        {
          $pull: {
            friends: { userid: viewerId },
            requests: { "profile.userid": viewerId },
          },
        },
      ),
    ]);

    response.status(200).json({
      success: true,
      message: "Friend removed.",
      data: { relationship: "none" },
    });
  } catch (error) {
    console.error("Remove friend failed:", error);
    response.status(500).json({
      success: false,
      message: "Unable to remove this friend.",
    });
  }
};
