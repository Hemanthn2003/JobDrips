import mongoose, { Document, Model, Schema } from "mongoose";

const schoolSchema = new Schema(
  {
    schoolId: { type: String, required: true },
    name: { type: String, required: true },
    board: { type: String, default: "" },
    startYear: { type: Number },
    endYear: { type: Number }
  },
  { _id: false }
);

const collegeSchema = new Schema(
  {
    collegeId: { type: String, required: true },
    name: { type: String, required: true },
    degree: { type: String, default: "" },
    field: { type: String, default: "" },
    startYear: { type: Number },
    endYear: { type: Number }
  },
  { _id: false }
);

const experienceSchema = new Schema(
  {
    experienceId: { type: String, required: true },
    company: { type: String, required: true },
    role: { type: String, required: true },
    employmentType: { type: String, default: "" },
    location: { type: String, default: "" },
    startDate: { type: String, default: "" },
    endDate: { type: String, default: "" },
    description: { type: String, default: "" }
  },
  { _id: false }
);

const imageUrlSchema = new Schema(
  {
    image1: { type: String, default: "" },
    image2: { type: String, default: "" },
    image3: { type: String, default: "" },
    image4: { type: String, default: "" },
    image5: { type: String, default: "" }
  },
  { _id: false }
);

const captionSchema = new Schema(
  {
    captionId: { type: String, required: true },
    content: { type: String, required: true }
  },
  { _id: false }
);

const likeSchema = new Schema(
  {
    userId: { type: String, required: true }
  },
  { _id: false }
);

const commentSchema = new Schema(
  {
    commentId: { type: String, required: true },
    userId: { type: String, required: true },
    commentText: { type: String, required: true }
  },
  { _id: false }
);

const shareSchema = new Schema(
  {
    shareId: { type: String, required: true },
    fromUserId: { type: String, required: true },
    toUserId: { type: String, required: true }
  },
  { _id: false }
);

const saveSchema = new Schema(
  {
    saveId: { type: String, required: true },
    userId: { type: String, required: true }
  },
  { _id: false }
);

const mentionListSchema = new Schema(
  {
    userId: { type: String, required: true },
    username: { type: String, required: true }
  },
  { _id: false }
);

const mentionSchema = new Schema(
  {
    mentionId: { type: String, required: true },
    mentions: {
      type: [mentionListSchema],
      default: []
    }
  },
  { _id: false }
);

const postSchema = new Schema(
  {
    postId: {
      type: String,
      required: true
    },

    userid: {
      type: String,
      required: true,
      index: true
    },

    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true
    },

    imageUrl: {
      type: imageUrlSchema,
      required: true
    },

    captions: {
      type: captionSchema,
      required: true
    },

    likes: {
      type: [likeSchema],
      default: []
    },

    comments: {
      type: [commentSchema],
      default: []
    },

    shares: {
      type: [shareSchema],
      default: []
    },

    saves: {
      type: [saveSchema],
      default: []
    },

    mentions: {
      type: mentionSchema,
      required: true
    },

    hashtags: {
      type: [String],
      default: []
    }
  },
  { _id: false }
);

export interface IProfile extends Document {
  userid: string;
  username: string;
  bio: string;

  education: {
    school: mongoose.InferSchemaType<typeof schoolSchema>[];
    college: mongoose.InferSchemaType<typeof collegeSchema>[];
  };

  experience: mongoose.InferSchemaType<typeof experienceSchema>[];

  posts: mongoose.InferSchemaType<typeof postSchema>[];

  mentionedPosts: mongoose.InferSchemaType<typeof postSchema>[];

  savedPosts: mongoose.InferSchemaType<typeof postSchema>[];
}

const profileSchema = new Schema<IProfile>(
  {
    userid: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    username: {
      type: String,
      required: true
    },

    bio: {
      type: String,
      default: ""
    },

    education: {
      school: {
        type: [schoolSchema],
        default: []
      },

      college: {
        type: [collegeSchema],
        default: []
      }
    },

    experience: {
      type: [experienceSchema],
      default: []
    },

    posts: {
      type: [postSchema],
      default: []
    },

    mentionedPosts: {
      type: [postSchema],
      default: []
    },

    savedPosts: {
      type: [postSchema],
      default: []
    }
  },
  {
    versionKey: false
  }
);

export const Profile: Model<IProfile> =
  mongoose.models.Profile ||
  mongoose.model<IProfile>("Profile", profileSchema);