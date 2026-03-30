const mongoose = require("mongoose");
const { Schema } = mongoose;

const ingestionJobSchema = new Schema(
  {
    textbook_id: { type: Schema.Types.ObjectId, ref: "Textbook", required: true },
    admin_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"], required: true },
    error_message: { type: String, default: null },
    created_at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

module.exports = mongoose.models.IngestionJob || mongoose.model("IngestionJob", ingestionJobSchema);
