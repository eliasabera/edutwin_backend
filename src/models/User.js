const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password_hash: { type: String, required: true },
    role: { type: String, enum: ["STUDENT", "TEACHER", "ADMIN"], required: true, default: "STUDENT" },
    created_at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
