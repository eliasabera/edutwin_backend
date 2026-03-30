const mongoose = require("mongoose");
const { Schema } = mongoose;

const quizAttemptSchema = new Schema(
  {
    student_id: { type: Schema.Types.ObjectId, ref: "StudentProfile", required: true },
    quiz_id: { type: Schema.Types.ObjectId, ref: "Quiz", required: true },
    total_score: { type: Number, default: null },
    started_at: { type: Date, default: Date.now },
    completed_at: { type: Date, default: null },
  },
  { versionKey: false }
);

module.exports = mongoose.models.QuizAttempt || mongoose.model("QuizAttempt", quizAttemptSchema);
