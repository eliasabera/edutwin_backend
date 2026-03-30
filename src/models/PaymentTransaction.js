const mongoose = require("mongoose");
const { Schema } = mongoose;

const paymentTransactionSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    status: { type: String, required: true },
    provider_reference: { type: String, required: true },
    created_at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

module.exports = mongoose.models.PaymentTransaction || mongoose.model("PaymentTransaction", paymentTransactionSchema);
