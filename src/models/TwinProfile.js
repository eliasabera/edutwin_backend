const mongoose = require("mongoose");
const { Schema } = mongoose;

const twinProfileSchema = new Schema(
  {
    student_id: { type: Schema.Types.ObjectId, ref: "StudentProfile", required: true, unique: true },
    performance_band: { type: String, required: true },
    mastery_percentage: { type: Number, required: true },
    strong_subjects: { type: Schema.Types.Mixed, required: true, default: [] },
    support_subjects: { type: Schema.Types.Mixed, required: true, default: [] },
    subject_scores: { type: Schema.Types.Mixed, required: true, default: {} },
    xp: { type: Number, required: true, default: 0 },
    streak: { type: Number, required: true, default: 0 },
    last_active: { type: Date, required: true, default: Date.now },
  },
  { versionKey: false }
);

module.exports = mongoose.models.TwinProfile || mongoose.model("TwinProfile", twinProfileSchema);
