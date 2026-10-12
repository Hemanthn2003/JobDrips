const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"
).replace(/\/+$/, "");

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  profilePhoto: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface School {
  schoolId: string;
  name: string;
  board: string;
  startYear: number;
  endYear: number | null;
}

export interface College {
  collegeId: string;
  name: string;
  degree: string;
  field: string;
  startYear: number;
  endYear: number | null;
}

export interface Education {
  school: School[];
  college: College[];
}

export interface Experience {
  experienceId: string;
  company: string;
  role: string;
  employmentType: string;
  location: string;
  startDate: string;
  endDate: string;
  description: string;
}

export type Relationship =
  | "self"
  | "friends"
  | "requested"
  | "received"
  | "none";

export interface Friend {
  userid: string;
  username: string;
  friendshipAccepted: boolean;
  /** Friend's current profile photo (empty when they have none). */
  profileimage?: string;
  /** The signed-in person's relationship to this friend. */
  relationship?: Relationship;
}

export interface StoryViewer {
  userId: string;
  email: string;
  viewedAt: string;
}

export interface Story {
  storyId: string;
  imageUrl: string;
  createdAt: string;
  expiresAt: string;
  /** True once the person looking at this profile has watched the story. */
  seen: boolean;
  /** Owner only: number of other people who watched. */
  viewCount?: number;
  /** Owner only: who watched (user id + email). */
  viewers?: StoryViewer[];
}

export interface Profile {
  userid: string;
  /** Display name (only sent on other people's profiles). */
  name?: string;
  username: string;
  bio: string;
  location?: string;
  website?: string;
  profileimage: string;
  coverimage: string;
  isPrivate: boolean;
  /** The signed-in person's relationship to this profile. */
  relationship?: Relationship;
  /** Number of posts (also sent for private profiles). */
  postsCount?: number;
  education: Education;
  experience: Experience[];
  friends: Friend[];
  requests?: unknown[];
  posts?: unknown[];
  mentionedPosts?: unknown[];
  savedPosts?: unknown[];
  stories?: Story[];
  postAccessRestricted?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface OwnProfileData {
  user: UserInfo;
  profile: Profile;
}

export interface ProfileResponse {
  success: boolean;
  message?: string;
  data: OwnProfileData;
}

export interface ProfileUpdateData {
  username?: string;
  bio?: string;
  location?: string;
  website?: string;
  profileimage?: string;
  coverimage?: string;
  isPrivate?: boolean;
  education?: Education;
  experience?: Experience[];
}

export interface ImageUpdateData {
  profileimage: string;
}

export interface EducationInput {
  type: "school" | "college";
  name: string;
  startYear: number;
  endYear?: number | null;
  board?: string;
  degree?: string;
  field?: string;
}

export interface ExperienceInput {
  role: string;
  startDate: string;
  company?: string;
  employmentType?: string;
  location?: string;
  endDate?: string;
  description?: string;
}

export interface EducationResponse {
  success: boolean;
  message: string;
  data: Education;
}

export interface ExperienceResponse {
  success: boolean;
  message: string;
  data: Experience[];
}

export interface ImageUpdateResponse {
  success: boolean;
  message: string;
  data: {
    profileimage: string;
    profilePhoto: string;
  };
}

export interface PublicProfileResponse {
  success: boolean;
  message?: string;
  data: Profile;
}

export interface UploadedImage {
  secureUrl: string;
  publicId: string;
  format: string;
  bytes: number;
}

interface UploadImageResponse {
  success: boolean;
  message: string;
  data: UploadedImage;
}

interface StoryResponse {
  success: boolean;
  message: string;
  data: {
    story: Story;
  };
}

interface StoriesResponse {
  success: boolean;
  message?: string;
  data: {
    userid: string;
    username: string;
    profileimage: string;
    stories: Story[];
  };
}

interface StoryViewResponse {
  success: boolean;
  /** False when this viewer had already been recorded on the story. */
  recorded: boolean;
}

interface DeleteStoryResponse {
  success: boolean;
  message: string;
}

export interface UsernameAvailabilityResponse {
  success: boolean;
  message?: string;
  data: {
    username: string;
    available: boolean;
    valid: boolean;
    message: string;
  };
}

async function requestJson<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);

  if (
    options.body !== undefined &&
    !(options.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });

  const result: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      result &&
      typeof result === "object" &&
      "message" in result &&
      typeof result.message === "string"
        ? result.message
        : `Request failed (${response.status})`;

    throw new Error(message);
  }

  return result as T;
}

async function profileRequest<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  return requestJson<T>(`${API_BASE_URL}/api/profiles${endpoint}`, options);
}

export const profileService = {
  getMyProfile(): Promise<ProfileResponse> {
    return profileRequest<ProfileResponse>("/me");
  },

  getPublicProfile(userid: string): Promise<PublicProfileResponse> {
    return profileRequest<PublicProfileResponse>(
      `/${encodeURIComponent(userid)}`,
    );
  },

  updateMyProfile(data: ProfileUpdateData): Promise<ProfileResponse> {
    return profileRequest<ProfileResponse>("/me", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  updateProfileImage(data: ImageUpdateData): Promise<ImageUpdateResponse> {
    return profileRequest<ImageUpdateResponse>("/me/image", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  /**
   * Uploads a local image through the existing backend Cloudinary route.
   * Do not manually set Content-Type for FormData.
   */
  uploadImage(file: File): Promise<UploadImageResponse> {
    const formData = new FormData();
    formData.append("image", file);

    return requestJson<UploadImageResponse>(
      `${API_BASE_URL}/api/uploads/image`,
      {
        method: "POST",
        body: formData,
      },
    );
  },

  /** GET /api/profiles/username-availability?username=... */
  checkUsernameAvailability(
    username: string,
  ): Promise<UsernameAvailabilityResponse> {
    const query = new URLSearchParams({
      username: username.trim().toLowerCase(),
    });

    return profileRequest<UsernameAvailabilityResponse>(
      `/username-availability?${query.toString()}`,
    );
  },

  addEducation(data: EducationInput): Promise<EducationResponse> {
    return profileRequest<EducationResponse>("/me/education", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  deleteEducation(id: string): Promise<EducationResponse> {
    return profileRequest<EducationResponse>(
      `/me/education/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  },

  addExperience(data: ExperienceInput): Promise<ExperienceResponse> {
    return profileRequest<ExperienceResponse>("/me/experience", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  deleteExperience(id: string): Promise<ExperienceResponse> {
    return profileRequest<ExperienceResponse>(
      `/me/experience/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  },

  /** Persist an uploaded Cloudinary URL as a new 24-hour story. */
  createStory(imageUrl: string): Promise<StoryResponse> {
    return profileRequest<StoryResponse>("/me/stories", {
      method: "POST",
      body: JSON.stringify({ imageUrl }),
    });
  },

  /** Active stories for a profile (the profile endpoints already include them). */
  getStories(userid: string): Promise<StoriesResponse> {
    return profileRequest<StoriesResponse>(
      `/${encodeURIComponent(userid)}/stories`,
    );
  },

  /** Records the signed-in viewer's user id + email on a story. */
  viewStory(userid: string, storyId: string): Promise<StoryViewResponse> {
    return profileRequest<StoryViewResponse>(
      `/${encodeURIComponent(userid)}/stories/${encodeURIComponent(storyId)}/view`,
      { method: "POST" },
    );
  },

  /** Send a friend request to another profile. */
  sendFriendRequest(userid: string): Promise<{ success: boolean }> {
    return profileRequest<{ success: boolean }>(
      `/${encodeURIComponent(userid)}/friend-request`,
      { method: "POST" },
    );
  },

  acceptFriendRequest(requesterId: string): Promise<{ success: boolean }> {
    return profileRequest<{ success: boolean }>(
      `/requests/${encodeURIComponent(requesterId)}/accept`,
      { method: "POST" },
    );
  },

  declineFriendRequest(requesterId: string): Promise<{ success: boolean }> {
    return profileRequest<{ success: boolean }>(
      `/requests/${encodeURIComponent(requesterId)}/decline`,
      { method: "POST" },
    );
  },

  /** Delete a story belonging to the signed-in profile. */
  deleteStory(storyId: string): Promise<DeleteStoryResponse> {
    return profileRequest<DeleteStoryResponse>(
      `/me/stories/${encodeURIComponent(storyId)}`,
      { method: "DELETE" },
    );
  },
};
