import mongoose from 'mongoose';

const clipSchema = new mongoose.Schema(
  {
    shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    originalName: { type: String, required: true },
    storedPath: { type: String, required: true },
    mimeType: String,
    sizeBytes: Number,
    durationSec: Number,
    width: Number,
    height: Number,
    zones: mongoose.Schema.Types.Mixed, // the shelf/till/exit polygons used for this run
    camera: { type: mongoose.Schema.Types.ObjectId, ref: 'Camera', index: true },
    freeScan: { type: Boolean, default: false },
    usageDate: String, // shop-local date the analysis was counted against
    analysisLimitSec: Number, // set when the camera's daily cap only covers part of the clip
    framesSampled: { type: Number, default: 0 },
    framesSent: { type: Number, default: 0 },

    status: { type: String, enum: ['queued', 'processing', 'done', 'failed'], default: 'queued' },
    stage: { type: String, enum: ['queued', 'detecting', 'verifying', 'finished'], default: 'queued' },
    progress: {
      checked: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    detector: {
      mode: String, // "http" or "mock"
      fps: Number,
      frameWidth: Number,
      frameHeight: Number,
      ms: Number,
      annotatedPath: String, // video with boxes, track IDs and zones drawn on (from the YOLO side)
    },
    model: String, // OpenRouter model used for the checks
    brightness: Number, // average luma 0–255
    error: String,
    warnings: { type: [String], default: [] },
    counts: {
      candidates: { type: Number, default: 0 },
      aiYes: { type: Number, default: 0 },
      aiNo: { type: Number, default: 0 },
      aiUnclear: { type: Number, default: 0 },
      aiError: { type: Number, default: 0 },
    },
    usage: {
      promptTokens: { type: Number, default: 0 },
      completionTokens: { type: Number, default: 0 },
      cost: { type: Number, default: 0 }, // USD, as reported by OpenRouter
    },
    processingMs: Number,
    processedAt: Date,
  },
  { timestamps: true },
);

clipSchema.methods.toPublic = function toPublic() {
  const o = this.toObject({ versionKey: false });
  o.id = String(o._id);
  delete o._id;
  delete o.storedPath;
  o.shop = String(o.shop);
  if (o.camera) o.camera = String(o.camera);
  o.videoUrl = `/api/clips/${o.id}/video`;
  o.annotatedVideoUrl = o.detector?.annotatedPath ? `/api/clips/${o.id}/annotated` : null;
  if (o.detector) delete o.detector.annotatedPath;
  return o;
};

export const Clip = mongoose.model('Clip', clipSchema);
