const mongoose = require("mongoose");
const { Schema } = mongoose;

const questionSchema = new Schema(
  {
    quiz_id: { type: Schema.Types.ObjectId, ref: "Quiz", required: true },
    question_type: { type: String, enum: ["MCQ", "TRUE_FALSE", "SHORT_ANSWER"], required: true },
    question_text: { type: String, required: true },
    options: {
      type: [String],
      default: undefined,
      validate: {
        validator: function (value) {
          if (this.question_type === "MCQ") {
            return Array.isArray(value) && value.length >= 2;
          }
          if (this.question_type === "TRUE_FALSE") {
            return !value || (Array.isArray(value) && value.length >= 2);
          }
          return !value || value.length === 0;
        },
        message: "Invalid options for question_type",
      },
    },
    correct_answer: { type: String, required: true },
    points: { type: Number, min: 0, default: 1 },
    order_index: { type: Number, min: 1, default: 1 },
    hint: { type: String, default: null },
    explanation: { type: String, required: true },
  },
  { versionKey: false }
);

module.exports = mongoose.models.Question || mongoose.model("Question", questionSchema);
