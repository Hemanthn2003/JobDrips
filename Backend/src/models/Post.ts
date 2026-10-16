import mongoose, { Schema } from "mongoose";

const mentionedUserSchema = new Schema(
  {
    userId: { type: String, required: true },
    username: { type: String, required: true },
  },
  { _id: false }
);

const commentSchema = new Schema(
  {
    commentId: { type: String, required: true },
    userId: { type: String, required: true },
    username: { type: String, default: "" },
    profileImage: { type: String, default: "" },
    commentText: {
      type: String,
      required: true,
      maxlength: 5000,
    },
    parentCommentId: { type: String, default: null },
    mentions: {
      type: [mentionedUserSchema],
      default: [],
    },
    likes: {
      type: [String],
      default: [],
    },
    visible: {
      type: Boolean,
      default: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const shareSchema = new Schema(
  {
    shareId: { type: String, required: true },
    fromUserId: { type: String, required: true },
    toUserId: { type: String, required: true },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

/* ───────────── NEW: video details ───────────── */
const videoMetaSchema = new Schema(
  {
    publicId: { type: String, default: "" }, // Cloudinary id of the original upload
    originalDuration: { type: Number, default: 0 }, // seconds
    startTime: { type: Number, default: 0 }, // trim start (seconds)
    endTime: { type: Number, default: 0 }, // trim end (seconds)
    duration: { type: Number, default: 0 }, // endTime - startTime (max 90)
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    thumbnailUrl: { type: String, default: "" },
  },
  { _id: false }
);

/* ───────────── NEW: poll ───────────── */
const pollOptionSchema = new Schema(
  {
    optionId: { type: String, required: true },
    text: { type: String, required: true, trim: true, maxlength: 80 },
    votes: { type: [String], default: [] }, // userIds who voted
  },
  { _id: false }
);

const pollSchema = new Schema(
  {
    question: { type: String, required: true, trim: true, maxlength: 200 },
    options: {
      type: [pollOptionSchema],
      validate: {
        validator: (o: unknown[]) => o.length >= 2 && o.length <= 4,
        message: "A poll needs between two and four options.",
      },
    },
    endsAt: { type: Date, required: true },
  },
  { _id: false }
);

const postSchema = new Schema(
  {
    postId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    caption: {
      type: String,
      default: "",
      maxlength: 5000,
    },
    imageUrls: {
      type: [String],
      default: [],
      validate: {
        validator: (urls: string[]) => urls.length <= 5,
        message: "A post can contain at most five images.",
      },
    },
    /* NEW: one video per post (trimmed URL, playable directly) */
    videoUrl: {
      type: String,
      default: "",
    },
    /* NEW */
    videoMeta: {
      type: videoMetaSchema,
      default: undefined,
    },
    /* NEW: optional poll */
    poll: {
      type: pollSchema,
      default: undefined,
    },
    hashtags: {
      type: [String],
      default: [],
    },
    mentions: {
      type: [mentionedUserSchema],
      default: [],
    },
    likes: {
      type: [String],
      default: [],
    },
    saves: {
      type: [String],
      default: [],
    },
    shares: {
      type: [shareSchema],
      default: [],
    },
    comments: {
      type: [commentSchema],
      default: [],
    },
    visibility: {
      type: String,
      enum: ["public", "friends", "private"],
      default: "friends",
    },
    settings: {
      hideLikeCount: {
        type: Boolean,
        default: false,
      },
      hideComments: {
        type: Boolean,
        default: false,
      },
      hideShareCount: {
        type: Boolean,
        default: false,
      },
      /* NEW: for the "Show save count" checkbox */
      hideSaveCount: {
        type: Boolean,
        default: false,
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

postSchema.index({ userId: 1, createdAt: -1 });

const Post =
  (mongoose.models.Post as mongoose.Model<any>) ||
  mongoose.model("Post", postSchema, "posts");

export default Post;