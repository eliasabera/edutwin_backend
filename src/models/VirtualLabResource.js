const mongoose = require("mongoose");
const { Schema } = mongoose;

const virtualLabResourceSchema = new Schema(
  {
    subject_id: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    thumbnail_url: { type: String, required: true },
    interaction_type: { type: String, enum: ["AR", "CANVAS"], required: true },
    resource_url: { type: String, required: true },
    parameters: { type: Schema.Types.Mixed, default: null },
    created_at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

module.exports =
  mongoose.models.VirtualLabResource ||
  mongoose.model("VirtualLabResource", virtualLabResourceSchema);
