const mongoose = require("mongoose");
const { Schema } = mongoose;

const studentAnswerSchema = new Schema(
  {
    attempt_id: { type: Schema.Types.ObjectId, ref: "QuizAttempt", required: true },
    question_id: { type: Schema.Types.ObjectId, ref: "Question", required: true },
    provided_answer: { type: String, required: true },
    is_correct: { type: Boolean, required: true },
    ai_feedback: { type: String, default: null },
  },
  { versionKey: false }
);

module.exports = mongoose.models.StudentAnswer || mongoose.model("StudentAnswer", studentAnswerSchema);
