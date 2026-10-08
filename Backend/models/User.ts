import mongoose, { Document, Model, Schema } from "mongoose";

export interface IUser extends Document {
  id: string;
  userid: string;
  username: string;
  email: string;
  phoneNo: string;
  passwordHash: string;
}

const userSchema = new Schema<IUser>(
  {
    id: { type: String, required: true, unique: true, trim: true },
    userid: { type: String, required: true, unique: true, trim: true, index: true },
    username: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phoneNo: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true }
  },
  { versionKey: false }
);

export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", userSchema);
