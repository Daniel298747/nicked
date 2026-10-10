import mongoose from 'mongoose';

export const AI_VERDICTS = ['yes', 'no', 'unclear', 'error'];
export const EVENT_TYPES = ['possible_concealment', 'no_concealment_seen', 'unclear_activity', 'ai_check_failed'];
export const CHECKLIST_KEYS = ['pickedUpItem', 'concealedItem', 'avoidedTill', 'leftShop'];

// Verdicts that put a candidate in the owner's review queue. "no" is kept in
// the database (it's the "false alarms removed by AI" number) but hidden by default.
export const QUEUE_VERDICTS = ['yes', 'unclear', 'error'];

const checklistSchema = new mongoose.Schema(
  Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, { type: Boolean, default: null }])),
  { _id: false },
);

const eventSchema = new mongoose.Schema(
  {
    shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    clip: { type: mongoose.Schema.Types.ObjectId, ref: 'Clip', required: true, index: true },

    // 1. What the YOLO tracker flagged (rule-based, no AI)
    startSec: { type: Number, required: true },
    endSec: { type: Number, required: true },
    startTime: String,
    endTime: String,
    candidate: {
      trackId: Number,
      shelfSeconds: Number,
      visitedTill: Boolean,
      rule: String,
      boxCount: Number, // person boxes the detector sent (used for close-up crops)
    },

    // 2. What the OpenRouter vision check said
    ai: {
      verdict: { type: String, enum: AI_VERDICTS },
      confidence: { type: Number, min: 0, max: 1 },
      reason: String,
      framesReferenced: { type: [String], default: [] },
      notes: String,
      model: String,
      latencyMs: Number,
      framesSent: Number,
      error: String,
      closeLook: Boolean, // a close-up second pass ran
      cropped: Boolean, // the deciding frames were cropped around the tracked person
      passes: [
        {
          _id: false,
          kind: { type: String, enum: ['overview', 'close_look'] },
          verdict: String,
          confidence: Number,
          reason: String,
          model: String,
          framesSent: Number,
          window: { startTime: String, endTime: String },
          cropped: Boolean,
          error: String,
        },
      ],
      // Frames the model cited, saved under uploads/evidence/<evidenceKey>/
      evidenceKey: String,
      evidence: [{ _id: false, label: String, file: String, cropped: Boolean }],
      thumbnail: String,
    },
    eventType: { type: String, enum: EVENT_TYPES },
    inQueue: { type: Boolean, default: true, index: true },
    flags: { type: [String], default: [] }, // validation notes shown in the UI

    // 3. What the owner decided
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'dismissed', 'unsure'],
      default: 'pending',
      index: true,
    },
    checklist: { type: checklistSchema, default: () => ({}) },
    reviewNote: { type: String, maxlength: 1000, default: '' },
    reviewedAt: Date,
  },
  { timestamps: true },
);

eventSchema.methods.toPublic = function toPublic() {
  const o = this.toObject({ versionKey: false });
  o.id = String(o._id);
  delete o._id;
  o.shop = String(o.shop);
  if (o.clip && typeof o.clip === 'object' && o.clip._id) {
    o.clip = { id: String(o.clip._id), originalName: o.clip.originalName, durationSec: o.clip.durationSec };
  } else {
    o.clip = String(o.clip);
  }
  // Ready-to-use image URLs for the review screen
  if (o.ai) {
    o.ai.thumbnailUrl = o.ai.thumbnail ? `/api/events/${o.id}/thumbnail` : null;
    o.ai.evidence = (o.ai.evidence || []).map((e, i) => ({ label: e.label, cropped: e.cropped, url: `/api/events/${o.id}/evidence/${i}` }));
    o.ai.verdictChangedByCloseLook = Boolean(o.ai.passes?.length > 1 && o.ai.passes[0].verdict !== o.ai.verdict);
    delete o.ai.evidenceKey;
    delete o.ai.thumbnail;
  }
  return o;
};

export const Event = mongoose.model('Event', eventSchema);
