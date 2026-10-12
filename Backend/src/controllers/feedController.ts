import type { Response } from "express";
import type { AuthenticatedRequest } from "../utils/authMiddleware.js";
import Profile from "../models/Profile.js";
import Report from "../models/Report.js";
import { User } from "../models/User.js";
import {
  acceptedFriendIds,
  loadPeople,
  loadPerson,
  serializePost,
  type FriendEntry,
  type RawPost,
} from "../utils/postHelpers.js";

type FeedProfileDocument = {
  userid: string;
  username?: string;
  profileimage?: string;
  friends?: FriendEntry[];
  posts?: RawPost[];
  isPrivate?: boolean;
};

export const getFeed = async (
  request: AuthenticatedRequest,
  response: Response
) => {
  try {
    const currentUserId = String(request.userId || "");

    if (!currentUserId) {
      return response.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    // Find the logged-in user's profile.
    const currentProfile = (await Profile.findOne({
      userid: currentUserId,
    })
      .select("userid username profileimage friends")
      .lean()) as FeedProfileDocument | null;

    // The viewer is returned so the UI can show their name in the comment box.
    const viewer = await loadPerson(currentUserId, currentProfile);

    if (!currentProfile) {
      return response.json({
        success: true,
        data: { posts: [], total: 0, viewer },
      });
    }

    // Collect accepted friends only.
    const friendIds = acceptedFriendIds(currentProfile).filter(
      (friendId) => friendId.length > 0 && friendId !== currentUserId
    );
    const acceptedFriendIdList = [...new Set(friendIds)];

    // Return an empty feed if the user has no accepted friends.
    if (acceptedFriendIdList.length === 0) {
      return response.json({
        success: true,
        data: { posts: [], total: 0, viewer },
      });
    }

    // Fetch profiles belonging only to accepted friends.
    const friendProfiles = (await Profile.find({
      userid: { $in: acceptedFriendIdList },
      "posts.0": { $exists: true },
    }).lean()) as unknown as FeedProfileDocument[];

    // Posts this person reported are hidden from their feed.
    const reported = await Report.find({ reportedByUserId: currentUserId })
      .select("postId")
      .lean();
    const reportedIds = new Set(reported.map((item) => String(item.postId)));

    const collected: Array<{ post: RawPost; authorId: string }> = [];

    for (const profile of friendProfiles) {
      const authorId = String(profile.userid);

      for (const post of profile.posts || []) {
        const visibility = post.visibility || "friends";

        // Friends can see public and friends-only posts.
        // Private and archived posts are excluded from the friends' feed.
        if (visibility !== "public" && visibility !== "friends") continue;
        if (post.archived) continue;
        if (reportedIds.has(String(post.postId))) continue;

        collected.push({
          post: { ...post, userid: authorId },
          authorId,
        });
      }
    }

    // Account names and photos for post authors.
    const authorIds = [...new Set(collected.map((item) => item.authorId))];

    const users = await User.find({ _id: { $in: authorIds } })
      .select("_id name profilePhoto")
      .lean();

    const usersById = new Map(users.map((user) => [String(user._id), user]));
    const profilesById = new Map(
      friendProfiles.map((profile) => [String(profile.userid), profile])
    );

    // People who commented (name + photo shown beside each comment).
    const people = await loadPeople(
      collected.flatMap((item) =>
        (item.post.comments || []).map((comment) => comment.userId)
      )
    );

    const feedPosts = collected.map(({ post, authorId }) => {
      const profile = profilesById.get(authorId);
      const user = usersById.get(authorId);

      return serializePost(post, {
        viewerId: currentUserId,
        people,
        includeComments: true,
        author: {
          userid: authorId,
          username: profile?.username ?? "",
          name: user?.name || profile?.username || "",
          profileimage: profile?.profileimage || user?.profilePhoto || "",
        },
      });
    });

    // Sort posts from newest to oldest.
    feedPosts.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0).getTime();
      const dateB = new Date(b.createdAt || 0).getTime();

      return dateB - dateA;
    });

    return response.json({
      success: true,
      data: {
        posts: feedPosts,
        total: feedPosts.length,
        viewer,
      },
    });
  } catch (error) {
    console.error("getFeed:", error);

    return response.status(500).json({
      success: false,
      message: "Unable to load the feed.",
    });
  }
};
