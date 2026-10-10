import { Router } from 'express';
import { access } from 'node:fs/promises';
import { loadShop } from '../middleware/shop.js';
import { Incident } from '../models/Incident.js';
import { Event } from '../models/Event.js';
import { Clip } from '../models/Clip.js';
import { cutClip } from '../services/ffmpeg.js';
import { AppError, notFound } from '../utils/errors.js';

const router = Router();
router.use(loadShop);

async function findIncident(req) {
  const incident = await Incident.findOne({ _id: req.params.id, shop: req.shop._id });
  if (!incident) throw notFound('Incident');
  return incident;
}

// GET /api/incidents
router.get('/', async (req, res) => {
  const incidents = await Incident.find({ shop: req.shop._id }).sort({ createdAt: -1 });
  res.json({ incidents: incidents.map((i) => i.toPublic()) });
});

// GET /api/incidents/:id
router.get('/:id', async (req, res) => {
  res.json({ incident: (await findIncident(req)).toPublic() });
});

// GET /api/incidents/:id/report.md → download the report
router.get('/:id/report.md', async (req, res) => {
  const incident = await findIncident(req);
  res.attachment(`${incident.reference}.md`).type('text/markdown').send(incident.reportMarkdown);
});

// GET /api/incidents/:id/clip → download the flagged window (with 3 s either side) as MP4
router.get('/:id/clip', async (req, res) => {
  const incident = await findIncident(req);
  const exists = await access(incident.clipExportPath).then(() => true, () => false);
  if (!exists) {
    const event = await Event.findById(incident.event);
    const clip = await Clip.findById(incident.clip);
    if (!event || !clip) throw notFound('Source footage');
    try {
      await cutClip(clip.storedPath, event.startSec - 3, Math.min(clip.durationSec, event.endSec + 3), incident.clipExportPath);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('Could not export the clip. The original video may have been deleted.', 500, 'EXPORT_FAILED');
    }
  }
  res.download(incident.clipExportPath, `${incident.reference}.mp4`);
});

// PATCH /api/incidents/:id { sharedWithGardai: true }
// The app never sends anything to the Gardaí. The owner records that they did.
router.patch('/:id', async (req, res) => {
  const incident = await findIncident(req);
  if (typeof req.body?.sharedWithGardai !== 'boolean') {
    throw new AppError('Send { "sharedWithGardai": true | false }.', 400, 'VALIDATION');
  }
  incident.sharedWithGardai = req.body.sharedWithGardai;
  incident.sharedAt = req.body.sharedWithGardai ? new Date() : undefined;
  await incident.save();
  res.json({ incident: incident.toPublic() });
});

// DELETE /api/incidents/:id
router.delete('/:id', async (req, res) => {
  const incident = await findIncident(req);
  await incident.deleteOne();
  res.json({ deleted: true });
});

export default router;
