const mongoose = require("mongoose");
const { Schema } = mongoose;

const subscriptionSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    stripe_customer_id: { type: String, required: true },
    plan_type: { type: String, required: true },
    status: { type: String, required: true },
    current_period_end: { type: Date, required: true },
  },
  { versionKey: false }
);

module.exports = mongoose.models.Subscription || mongoose.model("Subscription", subscriptionSchema);
