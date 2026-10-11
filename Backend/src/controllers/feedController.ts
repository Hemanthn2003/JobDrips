import type { Response } from "express";
import type { AuthenticatedRequest } from "../utils/authMiddleware.js";
import Profile from "../models/Profile.js";
import { User } from "../models/User.js";

type FeedPostDocument = {
  postId?: string;
  userid?: string;
  visibility?: "public" | "friends" | "private";
  createdAt?: Date | string;
  [key: string]: unknown;
};

type FeedFriend = {
  userid: string;
  friendshipAccepted: boolean;
};

type FeedProfileDocument = {
  userid: string;
  username?: string;
  profileimage?: string;
  friends?: FeedFriend[];
  posts?: FeedPostDocument[];
  isPrivate?: boolean;
};

type FeedAuthor = {
  userid: string;
  username?: string;
  name: string;
  profileimage: string;
};

type FeedPost = FeedPostDocument & {
  postId: string;
  userid: string;
  author: FeedAuthor;
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
    }).lean()) as FeedProfileDocument | null;

    if (!currentProfile) {
      return response.json({
        success: true,
        data: {
          posts: [],
          total: 0,
        },
      });
    }

    // Collect accepted friends only.
    const acceptedFriendIds = [
      ...new Set(
        (currentProfile.friends || [])
          .filter(
            (friend) => friend.friendshipAccepted === true
          )
          .map((friend) => String(friend.userid))
          .filter(
            (friendId) =>
              friendId.length > 0 &&
              friendId !== currentUserId
          )
      ),
    ];

    // Return an empty feed if the user has no accepted friends.
    if (acceptedFriendIds.length === 0) {
      return response.json({
        success: true,
        data: {
          posts: [],
          total: 0,
        },
      });
    }

    // Fetch profiles belonging only to accepted friends.
    const friendProfiles = (await Profile.find({
      userid: { $in: acceptedFriendIds },
      "posts.0": { $exists: true },
    }).lean()) as FeedProfileDocument[];

    const visiblePosts: FeedPost[] = [];

    for (const profile of friendProfiles) {
      const authorId = String(profile.userid);

      // Do not show posts from a private profile unless the
      // logged-in user is an accepted friend.
      // The query already limits authors to accepted friends.

      for (const post of profile.posts || []) {
        const visibility = post.visibility || "friends";

        // Friends can see public and friends-only posts.
        // Private posts are excluded from the friends' feed.
        if (
          visibility !== "public" &&
          visibility !== "friends"
        ) {
          continue;
        }

        visiblePosts.push({
          ...post,
          postId: String(post.postId || ""),
          userid: authorId,
          author: {
            userid: authorId,
            username: profile.username,
            name: "",
            profileimage: profile.profileimage || "",
          },
        });
      }
    }

    // Retrieve account names and photos for post authors.
    const authorIds = [
      ...new Set(
        visiblePosts.map((post) => post.userid)
      ),
    ];

    const users = await User.find({
      _id: { $in: authorIds },
    })
      .select("_id name profilePhoto")
      .lean();

    const usersById = new Map(
      users.map((user) => [
        String(user._id),
        user,
      ])
    );

    // Attach account names and profile photos.
    const feedPosts = visiblePosts.map((post) => {
      const user = usersById.get(post.userid);

      return {
        ...post,
        author: {
          ...post.author,
          name: user?.name || post.author.username || "",
          profileimage:
            post.author.profileimage ||
            user?.profilePhoto ||
            "",
        },
      };
    });

    // Sort posts from newest to oldest.
    feedPosts.sort((a, b) => {
      const dateA = new Date(
        a.createdAt || 0
      ).getTime();

      const dateB = new Date(
        b.createdAt || 0
      ).getTime();

      return dateB - dateA;
    });

    return response.json({
      success: true,
      data: {
        posts: feedPosts,
        total: feedPosts.length,
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