import mongoose, { Schema, type Document } from "mongoose";

// -------------------- SCHOOL --------------------

const schoolSchema = new Schema(
  {
    schoolId: { type: String, required: true },
    name: { type: String, required: true },
    board: { type: String, default: "" },
    startYear: { type: Number, required: true },
    endYear: { type: Number, default: null },
  },
  { _id: false },
);

// -------------------- COLLEGE --------------------

const collegeSchema = new Schema(
  {
    collegeId: { type: String, required: true },
    name: { type: String, required: true },
    degree: { type: String, default: "" },
    field: { type: String, default: "" },
    startYear: { type: Number, required: true },
    endYear: { type: Number, default: null },
  },
  { _id: false },
);

// -------------------- EDUCATION --------------------

const educationSchema = new Schema(
  {
    school: { type: [schoolSchema], default: [] },
    college: { type: [collegeSchema], default: [] },
  },
  { _id: false },
);

// -------------------- EXPERIENCE --------------------
// CHANGED: company is optional (the addExperience controller allows it to be empty).

const experienceSchema = new Schema(
  {
    experienceId: { type: String, required: true },
    company: { type: String, default: "" },
    role: { type: String, required: true },
    employmentType: { type: String, default: "" },
    location: { type: String, default: "" },
    startDate: { type: String, required: true },
    endDate: { type: String, default: "Present" },
    description: { type: String, default: "" },
  },
  { _id: false },
);

// -------------------- POST IMAGE URLS --------------------

const postImageUrlSchema = new Schema(
  {
    image1: { type: String, default: "" },
    image2: { type: String, default: "" },
    image3: { type: String, default: "" },
    image4: { type: String, default: "" },
    image5: { type: String, default: "" },
  },
  { _id: false },
);

// -------------------- CAPTION --------------------

const captionSchema = new Schema(
  {
    captionId: { type: String, required: true },
    content: { type: String, default: "" },
  },
  { _id: false },
);

// -------------------- POST LIKES --------------------

const likeSchema = new Schema(
  {
    likeId: { type: String, required: true },
    userId: { type: String, required: true },
  },
  { _id: false },
);

// -------------------- MENTIONED USERS --------------------

const mentionedUserSchema = new Schema(
  {
    userId: { type: String, required: true },
    username: { type: String, required: true },
  },
  { _id: false },
);

// -------------------- POST COMMENTS --------------------

const commentSchema = new Schema(
  {
    commentId: { type: String, required: true },
    userId: { type: String, required: true },
    username: { type: String, default: "" },
    commentText: { type: String, required: true, maxlength: 1000 },
    parentCommentId: { type: String, default: null },
    mentions: { type: [mentionedUserSchema], default: [] },
    likes: { type: [String], default: [] },
    // Id of the person whose post this comment was written on.
    commentedTo: { type: String, default: "" },
    // false until the notifications for this comment were created.
    notified: { type: Boolean, default: false },
    visible: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

// -------------------- POST SHARES --------------------

const shareSchema = new Schema(
  {
    shareId: { type: String, required: true },
    fromUserId: { type: String, required: true },
    toUserId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

// -------------------- POST MENTIONS --------------------

const mentionsSchema = new Schema(
  {
    mentionId: { type: String, required: true },
    mentions: { type: [mentionedUserSchema], default: [] },
    // Ids of mentioned people who were already notified (never repeated).
    notifiedUserIds: { type: [String], default: [] },
  },
  { _id: false },
);

// -------------------- POST SAVES --------------------

const saveSchema = new Schema(
  {
    saveId: { type: String, default: "" },
    userId: { type: String, required: true },
  },
  { _id: false },
);

// -------------------- POST DISPLAY SETTINGS --------------------

const postSettingsSchema = new Schema(
  {
    hideLikeCount: { type: Boolean, default: false },
    hideComments: { type: Boolean, default: false },
    hideShareCount: { type: Boolean, default: false },
    hideSaveCount: { type: Boolean, default: false },
  },
  { _id: false },
);

// -------------------- EMBEDDED POSTS --------------------

const postSchema = new Schema(
  {
    postId: { type: String, required: true },
    userid: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    imageUrl: {
      type: postImageUrlSchema,
      default: () => ({}),
    },
    captions: { type: captionSchema, required: true },
    likes: { type: [likeSchema], default: [] },
    comments: { type: [commentSchema], default: [] },
    shares: { type: [shareSchema], default: [] },
    saves: { type: [saveSchema], default: [] },
    mentions: {
      type: mentionsSchema,
      default: () => ({ mentionId: "", mentions: [], notifiedUserIds: [] }),
    },
    hashtags: { type: [String], default: [] },
    visibility: {
      type: String,
      enum: ["public", "friends", "private"],
      default: "friends",
    },
    archived: { type: Boolean, default: false },
    settings: {
      type: postSettingsSchema,
      default: () => ({}),
    },
  },
  { _id: false },
);

// -------------------- FRIENDS --------------------

const friendSchema = new Schema(
  {
    userid: { type: String, required: true },
    username: { type: String, required: true },
    friendshipAccepted: {
      type: Boolean,
      default: false,
      required: true,
    },
  },
  { _id: false },
);

// -------------------- FRIEND REQUEST PROFILE SNAPSHOT --------------------

const requestProfileSchema = new Schema(
  {
    userid: { type: String, required: true },
    username: { type: String, required: true },
    bio: { type: String, default: "" },
    profileimage: { type: String, default: "" },
    education: {
      type: educationSchema,
      default: () => ({}),
    },
    experience: {
      type: [experienceSchema],
      default: [],
    },
  },
  { _id: false, strict: true },
);

// -------------------- FRIEND REQUESTS --------------------

const requestSchema = new Schema(
  {
    profile: {
      type: requestProfileSchema,
      required: true,
    },
    accept: {
      type: Boolean,
      default: false,
      required: true,
    },
    // false until the "new friend request" notification was created.
    notified: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

// -------------------- STORY VIEWERS --------------------
// NEW: one entry per person who has watched a story (user id + email).

const storyViewerSchema = new Schema(
  {
    userId: { type: String, required: true },
    email: { type: String, required: true },
    viewedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

// -------------------- STORIES --------------------

const storySchema = new Schema(
  {
    storyId: { type: String, required: true },
    imageUrl: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, required: true },
    expiresAt: { type: Date, required: true },
    viewers: { type: [storyViewerSchema], default: [] },
    likes: { type: [String], default: [] },
  },
  { _id: false },
);

// -------------------- PROFILE INTERFACE --------------------

export interface IProfile extends Document {
  userid: string;
  username: string;
  bio: string;
  location: string;
  website: string;
  profileimage: string;
  coverimage: string;
  isPrivate: boolean;

  createdAt: Date;
  updatedAt: Date;

  education: {
    school: Array<{
      schoolId: string;
      name: string;
      board: string;
      startYear: number;
      endYear: number | null;
    }>;
    college: Array<{
      collegeId: string;
      name: string;
      degree: string;
      field: string;
      startYear: number;
      endYear: number | null;
    }>;
  };

  experience: Array<{
    experienceId: string;
    company: string;
    role: string;
    employmentType: string;
    location: string;
    startDate: string;
    endDate: string;
    description: string;
  }>;

  posts: unknown[];
  mentionedPosts: unknown[];
  savedPosts: unknown[];

  friends: Array<{
    userid: string;
    username: string;
    friendshipAccepted: boolean;
  }>;

  requests: Array<{
    profile: {
      userid: string;
      username: string;
      bio: string;
      profileimage: string;
      education: {
        school: unknown[];
        college: unknown[];
      };
      experience: unknown[];
    };
    accept: boolean;
    notified?: boolean;
    createdAt: Date;
  }>;

  stories: Array<{
    storyId: string;
    imageUrl: string;
    createdAt: Date;
    expiresAt: Date;
    viewers: Array<{
      userId: string;
      email: string;
      viewedAt: Date;
    }>;
    likes?: string[];
  }>;
}

// -------------------- PROFILE SCHEMA --------------------

const profileSchema = new Schema<IProfile>(
  {
    userid: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
    },
    bio: {
      type: String,
      default: "",
      maxlength: 500,
    },
    location: {
      type: String,
      default: "",
      maxlength: 100,
    },
    website: {
      type: String,
      default: "",
      maxlength: 200,
    },
    profileimage: {
      type: String,
      default: "",
    },
    coverimage: {
      type: String,
      default: "",
    },
    isPrivate: {
      type: Boolean,
      default: false,
    },
    education: {
      type: educationSchema,
      default: () => ({}),
    },
    experience: {
      type: [experienceSchema],
      default: [],
    },
    posts: {
      type: [postSchema],
      default: [],
    },
    mentionedPosts: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    savedPosts: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    friends: {
      type: [friendSchema],
      default: [],
    },
    requests: {
      type: [requestSchema],
      default: [],
    },
    stories: {
      type: [storySchema],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Speeds up the username-availability lookups.
profileSchema.index({ username: 1 });

// Reuse the existing model and target the profiles collection.
const Profile =
  (mongoose.models.Profile as mongoose.Model<IProfile>) ||
  mongoose.model<IProfile>("Profile", profileSchema, "profiles");

export default Profile;
