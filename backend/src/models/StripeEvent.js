import mongoose from 'mongoose';

// Stripe can deliver the same webhook more than once. Storing each event ID
// makes the handler idempotent.
const stripeEventSchema = new mongoose.Schema(
  {
    _id: { type: String }, // Stripe event ID, e.g. evt_123
    type: String,
  },
  { timestamps: true },
);

export const StripeEvent = mongoose.model('StripeEvent', stripeEventSchema);
