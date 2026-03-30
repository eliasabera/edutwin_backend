const mongoose = require("mongoose");
const { Schema } = mongoose;

const teacherProfileSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    full_name: { type: String, required: true, trim: true },
    school_id: { type: Schema.Types.ObjectId, ref: "School", default: null },
  },
  { versionKey: false }
);

module.exports = mongoose.models.TeacherProfile || mongoose.model("TeacherProfile", teacherProfileSchema);
