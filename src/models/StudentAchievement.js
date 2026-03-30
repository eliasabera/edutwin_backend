const mongoose = require("mongoose");
const { Schema } = mongoose;

const studentAchievementSchema = new Schema(
  {
    student_id: { type: Schema.Types.ObjectId, ref: "StudentProfile", required: true },
    achievement_id: { type: Schema.Types.ObjectId, ref: "Achievement", required: true },
    unlocked_at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

module.exports = mongoose.models.StudentAchievement || mongoose.model("StudentAchievement", studentAchievementSchema);
