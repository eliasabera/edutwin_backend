const mongoose = require("mongoose");
const { Schema } = mongoose;

const quizSchema = new Schema(
  {
    subject_id: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
    creator_type: { type: String, enum: ["AI", "TEACHER"], required: true },
    teacher_id: { type: Schema.Types.ObjectId, ref: "TeacherProfile", default: null },
    student_id: { type: Schema.Types.ObjectId, ref: "StudentProfile", default: null },
    topic: { type: String, default: null },
    title: { type: String, default: null },
    status: { type: String, enum: ["DRAFT", "PUBLISHED", "ARCHIVED"], default: "DRAFT" },
    duration_minutes: { type: Number, min: 1, default: null },
    passing_score: { type: Number, min: 0, default: null },
    total_score_possible: { type: Number, min: 0, default: 0 },
    created_at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

module.exports = mongoose.models.Quiz || mongoose.model("Quiz", quizSchema);
