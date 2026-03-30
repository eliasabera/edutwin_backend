const mongoose = require("mongoose");
const { Schema } = mongoose;

const chatMessageSchema = new Schema(
  {
    session_id: { type: Schema.Types.ObjectId, ref: "ChatSession", required: true },
    sender: { type: String, enum: ["USER", "AI"], required: true },
    message_text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

module.exports = mongoose.models.ChatMessage || mongoose.model("ChatMessage", chatMessageSchema);
