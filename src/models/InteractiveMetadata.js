const mongoose = require("mongoose");
const { Schema } = mongoose;

const interactiveMetadataSchema = new Schema(
  {
    textbook_id: { type: Schema.Types.ObjectId, ref: "Textbook", required: true },
    page_number: { type: Number, required: true },
    interaction_type: { type: String, enum: ["AR", "CANVAS"], required: true },
    resource_id: { type: String, required: true },
    parameters: { type: Schema.Types.Mixed, default: null },
  },
  { versionKey: false }
);

module.exports = mongoose.models.InteractiveMetadata || mongoose.model("InteractiveMetadata", interactiveMetadataSchema);
