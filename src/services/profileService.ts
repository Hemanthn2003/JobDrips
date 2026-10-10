
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

export interface Friend {
  userid: string;
  username: string;
  friendshipAccepted: boolean;
}

export interface Profile {
  userid: string;
  username: string;
  bio: string;
  profileimage: string;
  coverimage: string;
  isPrivate: boolean;
  education: Education;
  experience: Experience[];
  friends: Friend[];
  requests?: unknown[];
  posts?: unknown[];
  mentionedPosts?: unknown[];
  savedPosts?: unknown[];
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
  return requestJson<T>(
    `${API_BASE_URL}/api/profiles${endpoint}`,
    options,
  );
}

export const profileService = {
  getMyProfile(): Promise<ProfileResponse> {
    return profileRequest("/me");
  },

  getPublicProfile(
    userid: string,
  ): Promise<PublicProfileResponse> {
    return profileRequest(`/${encodeURIComponent(userid)}`);
  },

  updateMyProfile(
    data: ProfileUpdateData,
  ): Promise<ProfileResponse> {
    return profileRequest("/me", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  updateProfileImage(
    data: ImageUpdateData,
  ): Promise<ImageUpdateResponse> {
    return profileRequest("/me/image", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  /**
   * Uploads a local file to Cloudinary through the backend.
   * Do not manually set Content-Type: the browser supplies
   * the multipart boundary.
   */
  uploadImage(file: File): Promise<UploadImageResponse> {
    const formData = new FormData();
    formData.append("image", file);

    return requestJson(
      `${API_BASE_URL}/api/uploads/image`,
      {
        method: "POST",
        body: formData,
      },
    );
  },

  addEducation(
    data: EducationInput,
  ): Promise<EducationResponse> {
    return profileRequest("/me/education", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  deleteEducation(id: string): Promise<EducationResponse> {
    return profileRequest(
      `/me/education/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  },

  addExperience(
    data: ExperienceInput,
  ): Promise<ExperienceResponse> {
    return profileRequest("/me/experience", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  deleteExperience(id: string): Promise<ExperienceResponse> {
    return profileRequest(
      `/me/experience/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  },
};
