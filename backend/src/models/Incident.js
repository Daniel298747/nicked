import mongoose from 'mongoose';
import { statusBadge } from '../services/brand.js';

const incidentSchema = new mongoose.Schema(
  {
    shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, unique: true },
    clip: { type: mongoose.Schema.Types.ObjectId, ref: 'Clip', required: true },
    reference: { type: String, required: true }, // human-friendly ID, e.g. INC-20261010-4F2A
    facts: { type: mongoose.Schema.Types.Mixed, required: true }, // built in code, never by the model
    narrative: { type: String, required: true }, // written by the text model
    reportMarkdown: { type: String, required: true },
    model: String,
    languageWarnings: { type: [String], default: [] },
    clipExportPath: String,
    // The app never contacts the Gardaí. The owner marks this themselves if they choose to send it.
    sharedWithGardai: { type: Boolean, default: false },
    sharedAt: Date,
  },
  { timestamps: true },
);

incidentSchema.methods.toPublic = function toPublic() {
  const o = this.toObject({ versionKey: false });
  o.id = String(o._id);
  delete o._id;
  delete o.clipExportPath;
  for (const k of ['shop', 'event', 'clip']) o[k] = String(o[k]);
  // Only a confirmed event gets a report; it becomes "Reported to Gardaí" once the owner says they sent it.
  o.status = statusBadge(o.sharedWithGardai ? 'reported' : 'confirmed');
  return o;
};

export const Incident = mongoose.model('Incident', incidentSchema);
