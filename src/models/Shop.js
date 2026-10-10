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

    // Entitlements, re-derived from the Stripe subscription's items on every webhook
    planInterval: { type: String, enum: ['month', 'year', null], default: null },
    camerasAllowed: { type: Number, default: 0 },
    camerasAlwaysOn: { type: Number, default: 0 },
    retentionDays: { type: Number, default: 30 },
    locationsAllowed: { type: Number, default: 1 },
    graceUntil: Date, // set by invoice.payment_failed; analysis stays on until then

    isFounding: { type: Boolean, default: false }, // first 100 shops whose first invoice is paid
    firstPaidAt: Date,
    freeScanUsed: { type: Boolean, default: false },
    timezone: { type: String, default: 'Europe/Dublin' },
    marginAlert: {
      flagged: Boolean,
      aiCostEur: Number,
      subscriptionValueEur: Number,
      checkedAt: Date,
    },
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
    inGracePeriod: Boolean(this.subscriptionStatus === 'past_due' && this.graceUntil && this.graceUntil > new Date()),
    graceUntil: this.graceUntil,
    entitlements: {
      planInterval: this.planInterval,
      camerasAllowed: this.camerasAllowed,
      camerasAlwaysOn: this.camerasAlwaysOn,
      retentionDays: this.retentionDays,
      locationsAllowed: this.locationsAllowed,
    },
    isFounding: this.isFounding,
    freeScanAvailable: this.subscriptionStatus === 'inactive' && !this.freeScanUsed,
    timezone: this.timezone,
    marginAlert: this.marginAlert,
    createdAt: this.createdAt,
  };
};

export const Shop = mongoose.model('Shop', shopSchema);
