import mongoose from 'mongoose';

// Every OpenRouter call, with tokens and cost, so margins use measured numbers.
const aiCallSchema = new mongoose.Schema(
  {
    shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', index: true },
    camera: { type: mongoose.Schema.Types.ObjectId, ref: 'Camera' },
    clip: { type: mongoose.Schema.Types.ObjectId, ref: 'Clip' },
    pass: { type: String, enum: ['vision', 'reasoning'], required: true }, // vision = overview, reasoning = close look or report
    purpose: String, // overview | close_look | report
    model: String,
    promptTokens: Number,
    completionTokens: Number,
    costUsd: Number,
    latencyMs: Number,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
aiCallSchema.index({ shop: 1, createdAt: -1 });

export const AiCall = mongoose.model('AiCall', aiCallSchema);
