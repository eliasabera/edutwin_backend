const mongoose = require("mongoose");
const { Schema } = mongoose;

const textbookSchema = new Schema(
  {
    subject_id: { type: Schema.Types.ObjectId, ref: "Subject", required: true },
    title: { type: String, required: true, trim: true },
    pdf_url: { type: String, required: true },
  },
  { versionKey: false }
);

module.exports = mongoose.models.Textbook || mongoose.model("Textbook", textbookSchema);
