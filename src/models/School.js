const mongoose = require("mongoose");

const schoolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, default: null, trim: true, lowercase: true },
    phone: { type: String, default: null, trim: true },
    address: { type: String, default: null, trim: true },
    description: { type: String, default: null, trim: true },
    is_active: { type: Boolean, default: true },
  },
  {
    versionKey: false,
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
);

module.exports =
  mongoose.models.School || mongoose.model("School", schoolSchema);
