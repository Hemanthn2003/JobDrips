
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

import Profile from "../models/Profile.js";
import { User } from "../models/User.js";
import type { AuthenticatedRequest } from "../utils/authMiddleware.js";

type UnknownRecord = Record<string, unknown>;

type AuthenticatedUser = NonNullable<
  Awaited<ReturnType<typeof getAuthenticatedUser>>
>;

type ProfileDocument = InstanceType<typeof Profile>;

// --------------------------------------------------
// AUTHENTICATED USER
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
    "_id email name profilePhoto createdAt updatedAt"
  );
};

// --------------------------------------------------
// COMMON HELPERS
// --------------------------------------------------

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

/**
 * Finds the current user's profile.
 *
 * Existing profiles may use application-level userid values.
 * This function retains the existing username/userid lookup behavior.
 * Verify your database's ID mapping before relying on it for permissions.
 */
const getOrCreateProfile = async (
  user: AuthenticatedUser
): Promise<ProfileDocument> => {
  const emailUsername = normalizeUsername(user.email.split("@")[0] || "");
  const nameUsername = normalizeUsername(user.name || "");

  const candidates: Array<Record<string, string>> = [
    ...(emailUsername ? [{ username: emailUsername }] : []),
    ...(nameUsername ? [{ username: nameUsername }] : []),
    { userid: user._id.toString() },
  ];

  const existingProfile = await Profile.findOne({
    $or: candidates,
  });

  if (existingProfile) {
    return existingProfile;
  }

  let username =
    emailUsername ||
    nameUsername ||
    `user${user._id.toString().slice(-8)}`;

  // Ensure the initial username does not conflict with another profile.
  if (await Profile.exists({ username })) {
    username = `user${user._id.toString().slice(-8)}`;
  }

  // Do not silently create a duplicate profile for the same userid.
  const existingById = await Profile.findOne({
    userid: user._id.toString(),
  });

  if (existingById) {
    return existingById;
  }

  return Profile.create({
    userid: user._id.toString(),
    username,
    bio: "",
    profileimage: user.profilePhoto || "",
    coverimage: "",
    isPrivate: false,
    education: {
      school: [],
      college: [],
    },
    experience: [],
    posts: [],
    mentionedPosts: [],
    savedPosts: [],
    friends: [],
    requests: [],
  });
};

const serializeOwnProfile = (
  user: AuthenticatedUser,
  profile: ProfileDocument
) => ({
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
    profileimage: profile.profileimage || user.profilePhoto || "",
    coverimage: profile.coverimage || "",
    isPrivate: profile.isPrivate,
    education: profile.education,
    experience: profile.experience,
    friends: profile.friends,
    requests: profile.requests,
    posts: profile.posts,
    mentionedPosts: profile.mentionedPosts,
    savedPosts: profile.savedPosts,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  },
});

const sendServerError = (
  response: Response,
  message: string
): void => {
  response.status(500).json({
    success: false,
    message,
  });
};

// --------------------------------------------------
// GET MY PROFILE
// GET /api/profiles/me
// --------------------------------------------------

export const getMyProfile = async (
  request: Request,
  response: Response
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
      data: serializeOwnProfile(user, profile),
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
  response: Response
): Promise<void> => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const profile = await getOrCreateProfile(user);
    const body = request.body as UnknownRecord;

    // Update only explicitly supported string fields.
    const allowedTextFields = [
      "bio",
      "profileimage",
      "coverimage",
    ] as const;

    for (const field of allowedTextFields) {
      const value = body[field];

      if (value === undefined) {
        continue;
      }

      if (typeof value !== "string") {
        response.status(400).json({
          success: false,
          message: `${field} must be a string.`,
        });
        return;
      }

      if (field === "bio" && value.length > 500) {
        response.status(400).json({
          success: false,
          message: "Bio must be 500 characters or fewer.",
        });
        return;
      }

      profile.set(field, value.trim());
    }

    // Username validation and uniqueness check.
    if (body.username !== undefined) {
      if (
        typeof body.username !== "string" ||
        !/^[a-zA-Z0-9_.]{3,30}$/.test(body.username)
      ) {
        response.status(400).json({
          success: false,
          message:
            "Username must be 3–30 characters and contain only letters, numbers, dots, or underscores.",
        });
        return;
      }

      const username = body.username.toLowerCase();

      const existing = await Profile.findOne({
        username,
        userid: { $ne: profile.userid },
      });

      if (existing) {
        response.status(409).json({
          success: false,
          message: "That username is already taken.",
        });
        return;
      }

      profile.username = username;
    }

    // Profile privacy.
    if (body.isPrivate !== undefined) {
      if (typeof body.isPrivate !== "boolean") {
        response.status(400).json({
          success: false,
          message: "isPrivate must be a boolean.",
        });
        return;
      }

      profile.isPrivate = body.isPrivate;
    }

    // Education arrays.
    if (body.education !== undefined) {
      if (
        !body.education ||
        typeof body.education !== "object" ||
        Array.isArray(body.education)
      ) {
        response.status(400).json({
          success: false,
          message: "education must be an object.",
        });
        return;
      }

      const education = body.education as UnknownRecord;

      for (const key of ["school", "college"]) {
        if (
          education[key] !== undefined &&
          !Array.isArray(education[key])
        ) {
          response.status(400).json({
            success: false,
            message: `education.${key} must be an array.`,
          });
          return;
        }
      }

      profile.education = {
        school: (
          education.school ??
          profile.education?.school ??
          []
        ) as never,

        college: (
          education.college ??
          profile.education?.college ??
          []
        ) as never,
      };
    }

    // Experience array.
    if (body.experience !== undefined) {
      if (!Array.isArray(body.experience)) {
        response.status(400).json({
          success: false,
          message: "experience must be an array.",
        });
        return;
      }

      profile.experience = body.experience as never;
    }

    await profile.save();

    // Keep the User account photo synchronized.
    if (typeof body.profileimage === "string") {
      user.profilePhoto = body.profileimage.trim();
      await user.save();
    }

    response.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      data: serializeOwnProfile(user, profile),
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
  response: Response
): Promise<void> => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const { profileimage } = request.body as {
      profileimage?: unknown;
    };

    if (
      typeof profileimage !== "string" ||
      !/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(
        profileimage
      )
    ) {
      response.status(400).json({
        success: false,
        message: "Provide a valid Cloudinary secure image URL.",
      });
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

    sendServerError(
      response,
      "Unable to update your profile image."
    );
  }
};

// --------------------------------------------------
// ADD EDUCATION
// POST /api/profiles/me/education
// --------------------------------------------------

export const addEducation = async (
  request: Request,
  response: Response
): Promise<void> => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const body = request.body as UnknownRecord;
    const type = body.type;

    if (type !== "school" && type !== "college") {
      response.status(400).json({
        success: false,
        message: "type must be school or college.",
      });
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
        (!Number.isInteger(endYear) ||
          endYear < startYear ||
          endYear > 2200))
    ) {
      response.status(400).json({
        success: false,
        message: "Provide a name and valid start/end years.",
      });
      return;
    }

    const profile = await getOrCreateProfile(user);
    const id = randomUUID();

    if (type === "school") {
      profile.education.school.push({
        schoolId: id,
        name: body.name.trim(),
        board:
          typeof body.board === "string"
            ? body.board.trim()
            : "",
        startYear,
        endYear,
      } as never);
    } else {
      profile.education.college.push({
        collegeId: id,
        name: body.name.trim(),
        degree:
          typeof body.degree === "string"
            ? body.degree.trim()
            : "",
        field:
          typeof body.field === "string"
            ? body.field.trim()
            : "",
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
  response: Response
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
      profile.education.school.length +
      profile.education.college.length;

    profile.education.school =
      profile.education.school.filter(
        (item) => item.schoolId !== id
      ) as never;

    profile.education.college =
      profile.education.college.filter(
        (item) => item.collegeId !== id
      ) as never;

    const newCount =
      profile.education.school.length +
      profile.education.college.length;

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
  response: Response
): Promise<void> => {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      sendUnauthorized(response);
      return;
    }

    const body = request.body as UnknownRecord;

    if (
      typeof body.role !== "string" ||
      !body.role.trim() ||
      typeof body.startDate !== "string" ||
      !body.startDate.trim()
    ) {
      response.status(400).json({
        success: false,
        message: "role and startDate are required.",
      });
      return;
    }

    const profile = await getOrCreateProfile(user);

    profile.experience.push({
      experienceId: randomUUID(),
      company:
        typeof body.company === "string"
          ? body.company.trim()
          : "",
      role: body.role.trim(),
      employmentType:
        typeof body.employmentType === "string"
          ? body.employmentType.trim()
          : "",
      location:
        typeof body.location === "string"
          ? body.location.trim()
          : "",
      startDate: body.startDate.trim(),
      endDate:
        typeof body.endDate === "string" &&
        body.endDate.trim()
          ? body.endDate.trim()
          : "Present",
      description:
        typeof body.description === "string"
          ? body.description.trim()
          : "",
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
  response: Response
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
      (item) => item.experienceId !== id
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
// GET ANOTHER USER'S PROFILE
// GET /api/profiles/:userid
// --------------------------------------------------

export const getPublicProfile = async (
  request: Request,
  response: Response
): Promise<void> => {
  try {
    const user = await getAuthenticatedUser(request);
    const userid = request.params.userid;

    if (!userid) {
      response.status(400).json({
        success: false,
        message: "A user ID is required.",
      });
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

    const isOwner = Boolean(
      user && target.userid === user._id.toString()
    );

    let viewerProfile: ProfileDocument | null = null;

    if (user) {
      const emailUsername = normalizeUsername(
        user.email.split("@")[0] || ""
      );

      const nameUsername = normalizeUsername(user.name || "");

      const candidates: Array<Record<string, string>> = [
        ...(emailUsername
          ? [{ username: emailUsername }]
          : []),
        ...(nameUsername
          ? [{ username: nameUsername }]
          : []),
        { userid: user._id.toString() },
      ];

      viewerProfile = await Profile.findOne({
        $or: candidates,
      });
    }

    // Require the friendship to be accepted on both profiles.
    const isFriend = Boolean(
      viewerProfile &&
        viewerProfile.friends.some(
          (friend) =>
            friend.userid === target.userid &&
            friend.friendshipAccepted
        ) &&
        target.friends.some(
          (friend) =>
            friend.userid === viewerProfile?.userid &&
            friend.friendshipAccepted
        )
    );

    const canSeePosts =
      isOwner || !target.isPrivate || isFriend;

    response.status(200).json({
      success: true,
      data: {
        userid: target.userid,
        username: target.username,
        bio: target.bio,
        profileimage: target.profileimage,
        coverimage: target.coverimage,
        isPrivate: target.isPrivate,

        education: canSeePosts
          ? target.education
          : undefined,

        experience: canSeePosts
          ? target.experience
          : undefined,

        friends: target.friends.filter(
          (friend) => friend.friendshipAccepted
        ),

        posts: canSeePosts ? target.posts : [],
        postAccessRestricted: !canSeePosts,
        createdAt: target.createdAt,
        updatedAt: target.updatedAt,
      },
    });
  } catch (error) {
    console.error("Get public profile failed:", error);

    sendServerError(
      response,
      "Unable to load this profile."
    );
  }
};
