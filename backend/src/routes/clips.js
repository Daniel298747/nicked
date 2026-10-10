import { Router } from 'express';
import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import multer from 'multer';
import { config } from '../config.js';
import mongoose from 'mongoose';
import { loadShop, requireActive, requireAnalysisAccess } from '../middleware/shop.js';
import { Camera } from '../models/Camera.js';
import { usageToday, reserveAnalysis } from '../services/usage.js';
import { Clip } from '../models/Clip.js';
import { Event } from '../models/Event.js';
import { deleteClip } from '../jobs/retention.js';
import { probeVideo } from '../services/ffmpeg.js';
import { resolveZones } from '../services/detector.js';
import { processClip } from '../jobs/processClip.js';
import { AppError, notFound } from '../utils/errors.js';

const VIDEO_EXTS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'];
const clipsDir = path.join(config.uploadDir, 'clips');
mkdirSync(clipsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: clipsDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!VIDEO_EXTS.includes(ext)) {
      return cb(new AppError(`Upload a video file (${VIDEO_EXTS.join(', ')}). Got "${ext || 'no extension'}".`, 415, 'UNSUPPORTED_FILE'));
    }
    cb(null, true);
  },
});

const router = Router();
router.use(loadShop);

async function findClip(req) {
  const clip = await Clip.findOne({ _id: req.params.id, shop: req.shop._id });
  if (!clip) throw notFound('Clip');
  return clip;
}

function startProcessing(clipId, body = {}) {
  processClip(clipId, { model: body.model || undefined, zoomModel: body.zoomModel || undefined })
    .catch((err) => console.error('[processClip]', err));
}

/**
 * Works out which camera's daily budget a clip counts against, and how much of it can be analysed.
 * Paid shops: the chosen (or first active) camera. Free scan: no camera, one clip up to 1 hour.
 */
async function admitClip(req, durationSec) {
  const shop = req.shop;
  if (req.freeScan) {
    if (durationSec > config.plan.freeScanMaxSeconds) {
      throw new AppError(
        `The free scan covers one clip up to ${Math.round(config.plan.freeScanMaxSeconds / 60)} minutes. This one is ${Math.ceil(durationSec / 60)} minutes. Trim it or subscribe.`,
        402,
        'FREE_SCAN_TOO_LONG',
      );
    }
    shop.freeScanUsed = true; // set when the scan starts
    await shop.save();
    return { camera: null, freeScan: true };
  }

  const cameraId = req.body?.cameraId;
  let camera = null;
  if (cameraId) {
    if (!mongoose.isValidObjectId(cameraId)) throw new AppError('Invalid cameraId.', 400, 'BAD_ID');
    camera = await Camera.findOne({ _id: cameraId, shop: shop._id });
    if (!camera) throw notFound('Camera');
  } else {
    camera = await Camera.findOne({ shop: shop._id, active: true }).sort({ createdAt: 1 });
  }
  if (!camera) return { camera: null, freeScan: false }; // e.g. a plan from before cameras existed
  if (!camera.active) throw new AppError(`${camera.name} is paused. ${camera.pausedReason || ''}`.trim(), 409, 'CAMERA_PAUSED');

  const today = await usageToday(camera, shop.timezone);
  if (today.remainingSeconds <= 0) {
    throw new AppError(
      `${camera.name} has used its ${Math.round(today.capSeconds / 3600)} hours of analysis today. It resets at midnight (${shop.timezone}).`,
      429,
      'DAILY_CAP',
      { usage: today },
    );
  }
  const analysedSeconds = Math.min(durationSec, today.remainingSeconds);
  await reserveAnalysis({ shop, camera, date: today.date, seconds: analysedSeconds });
  return {
    camera,
    freeScan: false,
    usageDate: today.date,
    analysisLimitSec: analysedSeconds < durationSec ? analysedSeconds : undefined,
  };
}

// POST /api/clips  multipart: clip=<video>, cameraId?, zones=<optional JSON>, model?, zoomModel?
// → 202 { clip }. Poll GET /api/clips/:id until status is "done" or "failed".
router.post('/', requireAnalysisAccess, upload.single('clip'), async (req, res) => {
  if (!req.file) throw new AppError('No video received. Send it in a form field called "clip".', 400, 'NO_FILE');

  try {
    const zones = await resolveZones(req.body?.zones);
    const meta = await probeVideo(req.file.path);
    const admitted = await admitClip(req, meta.durationSec);
    const clip = await Clip.create({
      shop: req.shop._id,
      originalName: req.file.originalname,
      storedPath: req.file.path,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      durationSec: meta.durationSec,
      width: meta.width,
      height: meta.height,
      zones,
      camera: admitted.camera?._id,
      freeScan: admitted.freeScan,
      usageDate: admitted.usageDate,
      analysisLimitSec: admitted.analysisLimitSec,
    });
    startProcessing(clip.id, req.body);
    res.status(202).json({ clip: clip.toPublic(), freeScan: admitted.freeScan });
  } catch (err) {
    await rm(req.file.path, { force: true });
    throw err;
  }
});

// GET /api/clips → newest first
router.get('/', async (req, res) => {
  const clips = await Clip.find({ shop: req.shop._id }).sort({ createdAt: -1 }).limit(100);
  res.json({ clips: clips.map((c) => c.toPublic()) });
});

// GET /api/clips/:id → clip with progress and all its events (including ones the AI ruled out)
router.get('/:id', async (req, res) => {
  const clip = await findClip(req);
  const events = await Event.find({ clip: clip._id }).sort({ startSec: 1 });
  res.json({ clip: clip.toPublic(), events: events.map((e) => e.toPublic()) });
});

// POST /api/clips/:id/reprocess { model? } → re-run detection + AI checks (e.g. to compare models)
router.post('/:id/reprocess', requireActive, async (req, res) => {
  const clip = await findClip(req);
  if (['queued', 'processing'].includes(clip.status)) {
    throw new AppError('This clip is already being processed.', 409, 'BUSY');
  }
  clip.status = 'queued';
  clip.stage = 'queued';
  await clip.save();
  startProcessing(clip.id, req.body);
  res.status(202).json({ clip: clip.toPublic() });
});

// GET /api/clips/:id/annotated → the detector's rendered video (boxes, track IDs, zones), if it sent one
router.get('/:id/annotated', async (req, res) => {
  const clip = await findClip(req);
  const file = clip.detector?.annotatedPath;
  if (!file) throw new AppError('No annotated video for this clip.', 404, 'NOT_FOUND');
  res.sendFile(path.resolve(file), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Annotated video file is missing.', code: 'NOT_FOUND' });
  });
});

// GET /api/clips/:id/video → streams the original (supports seeking). Use as <video src>.
router.get('/:id/video', async (req, res) => {
  const clip = await findClip(req);
  res.sendFile(clip.storedPath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Video file is missing.', code: 'NOT_FOUND' });
  });
});

// DELETE /api/clips/:id → deletes the footage, evidence frames, events and reports (retention / GDPR)
router.delete('/:id', async (req, res) => {
  const clip = await findClip(req);
  if (clip.status === 'processing') throw new AppError('Wait for processing to finish before deleting.', 409, 'BUSY');
  await deleteClip(clip);
  res.json({ deleted: true });
});

export default router;
