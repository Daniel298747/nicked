import { Router } from 'express';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { loadShop, requireActive } from '../middleware/shop.js';
import { Event, CHECKLIST_KEYS, QUEUE_VERDICTS } from '../models/Event.js';
import { Clip } from '../models/Clip.js';
import { Incident } from '../models/Incident.js';
import { buildFacts, newReference, writeNarrative, assembleMarkdown } from '../services/report.js';
import { describeAiError } from '../services/openrouter.js';
import { recordAi, localDate } from '../services/usage.js';
import { AppError, notFound } from '../utils/errors.js';
import { emptyQueueMessage } from '../services/brand.js';

const router = Router();
router.use(loadShop);

// The clip plus its camera's name, for "Possible concealment, aisle 3".
const WITH_CLIP = { path: 'clip', select: 'originalName durationSec camera', populate: { path: 'camera', select: 'name' } };

/** Event ids whose incident report the owner marked as shared with the Gardaí. */
async function reportedIds(events) {
  const confirmed = events.filter((e) => e.status === 'confirmed').map((e) => e._id);
  if (!confirmed.length) return new Set();
  const shared = await Incident.find({ event: { $in: confirmed }, sharedWithGardai: true }).select('event');
  return new Set(shared.map((i) => String(i.event)));
}

async function findEvent(req) {
  const event = await Event.findOne({ _id: req.params.id, shop: req.shop._id });
  if (!event) throw notFound('Event');
  return event;
}

// GET /api/events?view=queue|ai_ruled_out|reviewed|all&clip=<id>
//  queue (default): pending events the AI said yes/unclear (or couldn't check), highest confidence first
//  ai_ruled_out:    candidates the AI said "no" to (the false alarms it removed)
//  reviewed:        confirmed / dismissed / unsure
router.get('/', async (req, res) => {
  const view = req.query.view || 'queue';
  const filter = { shop: req.shop._id };
  if (req.query.clip) filter.clip = req.query.clip;

  if (view === 'queue') Object.assign(filter, { status: 'pending', 'ai.verdict': { $in: QUEUE_VERDICTS } });
  else if (view === 'ai_ruled_out') Object.assign(filter, { 'ai.verdict': 'no' });
  else if (view === 'reviewed') Object.assign(filter, { status: { $ne: 'pending' } });
  else if (view !== 'all') throw new AppError('view must be queue, ai_ruled_out, reviewed or all.', 400, 'BAD_VIEW');

  const events = await Event.find(filter)
    .populate(WITH_CLIP)
    .sort(view === 'queue' ? { 'ai.confidence': -1, createdAt: -1 } : { createdAt: -1 })
    .limit(200);
  const reported = await reportedIds(events);
  const body = { events: events.map((e) => e.toPublic({ reported: reported.has(String(e._id)) })) };
  if (view === 'queue' && !events.length) {
    const last = await Event.findOne({ shop: req.shop._id, inQueue: true }).sort({ createdAt: -1 }).select('createdAt');
    body.empty = emptyQueueMessage(last?.createdAt, req.shop.timezone);
  }
  res.json(body);
});

function sendEvidence(res, event, file) {
  if (!event.ai?.evidenceKey || !file) throw new AppError('No image for this event.', 404, 'NOT_FOUND');
  const full = path.join(config.uploadDir, 'evidence', event.ai.evidenceKey, path.basename(file));
  res.type('jpeg').sendFile(full, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Image file is missing.', code: 'NOT_FOUND' });
  });
}

// GET /api/events/:id/thumbnail → the key frame for the queue card (use as <img src>)
router.get('/:id/thumbnail', async (req, res) => {
  const event = await findEvent(req);
  sendEvidence(res, event, event.ai?.thumbnail);
});

// GET /api/events/:id/evidence/:index → a frame the AI cited (see event.ai.evidence[i].label for its time)
router.get('/:id/evidence/:index', async (req, res) => {
  const event = await findEvent(req);
  const item = event.ai?.evidence?.[Number(req.params.index)];
  sendEvidence(res, event, item?.file);
});

// GET /api/events/:id
router.get('/:id', async (req, res) => {
  const event = await findEvent(req);
  await event.populate(WITH_CLIP);
  const incident = await Incident.findOne({ event: event._id }).select('_id reference sharedWithGardai');
  res.json({
    event: event.toPublic({ reported: Boolean(incident?.sharedWithGardai) }),
    incident: incident ? { id: incident.id, reference: incident.reference, sharedWithGardai: incident.sharedWithGardai } : null,
  });
});

const reviewSchema = z.object({
  decision: z.enum(['confirmed', 'dismissed', 'unsure']),
  checklist: z.object(Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, z.boolean().nullable().optional()]))).optional(),
  note: z.string().max(1000).optional(),
});

// POST /api/events/:id/review { decision, checklist?, note? }
// "confirmed" needs all four checklist answers. Dismissals are kept: they are our false-positive data.
router.post('/:id/review', async (req, res) => {
  const parsed = reviewSchema.safeParse(req.body || {});
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new AppError(`Invalid ${i.path.join('.') || 'body'}: ${i.message}`, 400, 'VALIDATION');
  }
  const { decision, checklist = {}, note } = parsed.data;
  const event = await findEvent(req);

  if (decision === 'confirmed') {
    const missing = CHECKLIST_KEYS.filter((k) => typeof checklist[k] !== 'boolean');
    if (missing.length) {
      throw new AppError('Answer every checklist question before confirming.', 400, 'CHECKLIST_INCOMPLETE', { missing });
    }
  }
  if (event.status === 'confirmed' && decision !== 'confirmed') {
    const incident = await Incident.exists({ event: event._id });
    if (incident) throw new AppError('This event already has an incident report. Delete the report first.', 409, 'HAS_INCIDENT');
  }

  for (const k of CHECKLIST_KEYS) if (k in checklist) event.checklist[k] = checklist[k];
  event.status = decision;
  if (note !== undefined) event.reviewNote = note;
  event.reviewedAt = new Date();
  await event.save();

  const warnings = [];
  if (decision === 'confirmed' && !event.checklist.concealedItem && !event.checklist.leftShop) {
    warnings.push('You confirmed this, but answered "No" to both concealing and leaving with an item. Double-check before generating a report.');
  }
  res.json({ event: event.toPublic(), warnings });
});

// POST /api/events/:id/incident → generate (or return the existing) incident report for a confirmed event.
// ?regenerate=true rewrites it.
router.post('/:id/incident', requireActive, async (req, res) => {
  const event = await findEvent(req);
  if (event.status !== 'confirmed') {
    throw new AppError('Only events the owner has confirmed can become incident reports.', 409, 'NOT_CONFIRMED');
  }

  const existing = await Incident.findOne({ event: event._id });
  if (existing && req.query.regenerate !== 'true') return res.json({ incident: existing.toPublic(), created: false });

  const clip = await Clip.findById(event.clip);
  if (!clip) throw notFound('Clip');

  const reference = existing?.reference || newReference();
  const facts = buildFacts({ shop: req.shop, clip, event, reference });
  let written;
  try {
    written = await writeNarrative(facts);
  } catch (err) {
    throw new AppError(`Couldn't write the report: ${describeAiError(err)} Try again.`, 502, 'REPORT_FAILED');
  }

  await recordAi({
    shopId: req.shop._id,
    cameraId: clip.camera,
    clipId: clip._id,
    date: clip.camera ? localDate(req.shop.timezone) : undefined,
    calls: written.call ? [written.call] : [],
  }).catch((err) => console.error('[recordAi]', err.message));

  const data = {
    shop: req.shop._id,
    event: event._id,
    clip: clip._id,
    reference,
    facts,
    narrative: written.narrative,
    reportMarkdown: assembleMarkdown(facts, written.narrative),
    model: written.model,
    languageWarnings: written.languageWarnings,
    clipExportPath: path.join(config.uploadDir, 'exports', `${reference}.mp4`),
  };
  const incident = existing ? Object.assign(existing, data) : new Incident(data);
  await incident.save();
  res.status(existing ? 200 : 201).json({ incident: incident.toPublic(), created: !existing });
});

export default router;
