const mongoose = require("mongoose");
const { Schema } = mongoose;

const quizAssignmentSchema = new Schema(
  {
    quiz_id: { type: Schema.Types.ObjectId, ref: "Quiz", required: true },
    class_id: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    assigned_at: { type: Date, default: Date.now },
    due_date: { type: Date, default: null },
  },
  { versionKey: false }
);

module.exports = mongoose.models.QuizAssignment || mongoose.model("QuizAssignment", quizAssignmentSchema);
