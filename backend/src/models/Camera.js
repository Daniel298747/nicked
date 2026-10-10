import mongoose from 'mongoose';

const cameraSchema = new mongoose.Schema(
  {
    shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    locationName: { type: String, trim: true, maxlength: 80, default: 'Main shop' },
    alwaysOn: { type: Boolean, default: false }, // 24/7 add-on: 24 h daily budget instead of 12 h
    active: { type: Boolean, default: true }, // paused when the plan drops below this camera
    pausedReason: String,
  },
  { timestamps: true },
);

cameraSchema.methods.toPublic = function toPublic() {
  return {
    id: this.id,
    name: this.name,
    locationName: this.locationName,
    alwaysOn: this.alwaysOn,
    active: this.active,
    pausedReason: this.pausedReason,
    createdAt: this.createdAt,
  };
};

export const Camera = mongoose.model('Camera', cameraSchema);
