import mongoose from 'mongoose';

// One row per camera per shop-local day. analysedSeconds is checked against the daily cap.
const usageDailySchema = new mongoose.Schema(
  {
    shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    camera: { type: mongoose.Schema.Types.ObjectId, ref: 'Camera', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD in the shop's timezone
    analysedSeconds: { type: Number, default: 0 },
    framesSampled: { type: Number, default: 0 },
    framesSent: { type: Number, default: 0 },
    aiCostUsd: { type: Number, default: 0 },
  },
  { timestamps: true },
);
usageDailySchema.index({ camera: 1, date: 1 }, { unique: true });

export const UsageDaily = mongoose.model('UsageDaily', usageDailySchema);
