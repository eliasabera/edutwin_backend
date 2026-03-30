const mongoose = require("mongoose");

const achievementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    xp_reward: { type: Number, required: true },
    icon_url: { type: String, required: true },
    unlock_type: { type: String, enum: ["BADGE", "THEME", "AI_PERSONA", "AR_MODEL"], required: true },
    unlock_value: { type: String, required: true },
  },
  { versionKey: false }
);

module.exports = mongoose.models.Achievement || mongoose.model("Achievement", achievementSchema);
