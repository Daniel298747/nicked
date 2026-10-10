import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema(
  {
    invoiceId: { type: String, required: true },
    amount: Number, // minor units, e.g. 2900 = €29.00
    currency: String,
    paidAt: Date,
    hostedInvoiceUrl: String,
  },
  { _id: false },
);

const shopSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, trim: true, lowercase: true, maxlength: 200 },
    // Free-text hints from the owner, passed to the vision model (e.g. "Till is bottom-right, door is top-left").
    layoutNotes: { type: String, trim: true, maxlength: 500, default: '' },

    subscriptionStatus: {
      type: String,
      enum: ['inactive', 'active', 'past_due', 'canceled'],
      default: 'inactive',
    },
    stripeCustomerId: { type: String, index: true },
    stripeSubscriptionId: { type: String, index: true },
    currentPeriodEnd: Date,
    activatedAt: Date,
    payments: { type: [paymentSchema], default: [] },
  },
  { timestamps: true },
);

shopSchema.methods.toPublic = function toPublic() {
  return {
    id: this.id,
    name: this.name,
    email: this.email,
    layoutNotes: this.layoutNotes,
    subscriptionStatus: this.subscriptionStatus,
    subscriptionActive: this.subscriptionStatus === 'active',
    currentPeriodEnd: this.currentPeriodEnd,
    activatedAt: this.activatedAt,
    payments: this.payments,
    createdAt: this.createdAt,
  };
};

export const Shop = mongoose.model('Shop', shopSchema);
