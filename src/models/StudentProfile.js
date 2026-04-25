const mongoose = require("mongoose");
const { Schema } = mongoose;

const studentProfileSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    full_name: { type: String, required: true, trim: true },
    phone_number: { type: String, default: null },
    language: { type: String, required: true, trim: true },
    grade_level: { type: Number, required: true },
    student_photo_url: { type: String, default: null },
    school_id: { type: Schema.Types.ObjectId, ref: "School", default: null },
    section: { type: String, default: null },
  },
  { versionKey: false }
);

module.exports = mongoose.models.StudentProfile || mongoose.model("StudentProfile", studentProfileSchema);
