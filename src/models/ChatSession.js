const mongoose = require("mongoose");
const { Schema } = mongoose;

const chatSessionSchema = new Schema(
  {
    student_id: { type: Schema.Types.ObjectId, ref: "StudentProfile", required: true },
    subject_id: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
    started_at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

module.exports = mongoose.models.ChatSession || mongoose.model("ChatSession", chatSessionSchema);
