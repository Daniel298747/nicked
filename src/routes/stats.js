import { Router } from 'express';
import { loadShop } from '../middleware/shop.js';
import { Event } from '../models/Event.js';
import { Clip } from '../models/Clip.js';

const router = Router();
router.use(loadShop);

/**
 * GET /api/stats → the numbers for the "Stay curious" slide:
 * how many tracker candidates the AI removed, and how often the owner agreed with the AI.
 */
router.get('/', async (req, res) => {
  const events = await Event.find({ shop: req.shop._id }).select('ai.verdict ai.model status').lean();
  const clips = await Clip.find({ shop: req.shop._id, status: 'done' }).select('processingMs usage detector.ms').lean();

  const count = (fn) => events.filter(fn).length;
  const candidates = events.length;
  const aiNo = count((e) => e.ai?.verdict === 'no');

  const byModel = {};
  for (const e of events) {
    const m = e.ai?.model || 'unknown';
    byModel[m] ??= { candidates: 0, yes: 0, no: 0, unclear: 0, error: 0 };
    byModel[m].candidates += 1;
    if (e.ai?.verdict) byModel[m][e.ai.verdict] += 1;
  }

  // Agreement on reviewed events: AI "yes" vs owner "confirmed"
  const reviewed = events.filter((e) => ['confirmed', 'dismissed'].includes(e.status) && ['yes', 'no', 'unclear'].includes(e.ai?.verdict));
  const agreement = {
    reviewed: reviewed.length,
    aiYesOwnerConfirmed: reviewed.filter((e) => e.ai.verdict === 'yes' && e.status === 'confirmed').length,
    aiYesOwnerDismissed: reviewed.filter((e) => e.ai.verdict === 'yes' && e.status === 'dismissed').length,
    aiUnclearOwnerConfirmed: reviewed.filter((e) => e.ai.verdict === 'unclear' && e.status === 'confirmed').length,
    aiUnclearOwnerDismissed: reviewed.filter((e) => e.ai.verdict === 'unclear' && e.status === 'dismissed').length,
    aiNoOwnerConfirmed: reviewed.filter((e) => e.ai.verdict === 'no' && e.status === 'confirmed').length,
  };

  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  res.json({
    tracker: { candidates },
    ai: {
      yes: count((e) => e.ai?.verdict === 'yes'),
      no: aiNo,
      unclear: count((e) => e.ai?.verdict === 'unclear'),
      error: count((e) => e.ai?.verdict === 'error'),
      falseAlarmsRemoved: aiNo,
      shareRemoved: candidates ? +(aiNo / candidates).toFixed(2) : null,
      byModel,
    },
    owner: {
      pending: count((e) => e.status === 'pending'),
      confirmed: count((e) => e.status === 'confirmed'),
      dismissed: count((e) => e.status === 'dismissed'),
      unsure: count((e) => e.status === 'unsure'),
    },
    agreement,
    processing: {
      clips: clips.length,
      avgProcessingMs: avg(clips.map((c) => c.processingMs).filter(Boolean)),
      avgDetectorMs: avg(clips.map((c) => c.detector?.ms).filter(Boolean)),
      totalAiCostUsd: +clips.reduce((s, c) => s + (c.usage?.cost || 0), 0).toFixed(4),
    },
  });
});

export default router;
