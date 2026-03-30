const mongoose = require("mongoose");

const schoolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
  },
  { versionKey: false }
);

module.exports = mongoose.models.School || mongoose.model("School", schoolSchema);
