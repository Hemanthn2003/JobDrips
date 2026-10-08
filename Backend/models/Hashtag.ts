import mongoose, { Document, Model, Schema } from "mongoose";

export interface IHashtag extends Document {
  hashtagId: string;
  hashtag: string;
  usesCount: number;
}

const hashtagSchema = new Schema<IHashtag>(
  {
    hashtagId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },

    hashtag: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },

    usesCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0
    }
  },
  {
    versionKey: false,
    collection: "hashtags"
  }
);

export const Hashtag: Model<IHashtag> =
  mongoose.models.Hashtag ||
  mongoose.model<IHashtag>("Hashtag", hashtagSchema);