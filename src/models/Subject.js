const mongoose = require("mongoose");

const subjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    grade_level: { type: Number, required: true },
    cover_image_url: { type: String, default: null },
  },
  { versionKey: false }
);

module.exports = mongoose.models.Subject || mongoose.model("Subject", subjectSchema);
