import { Router } from 'express';
import { loadShop } from '../middleware/shop.js';
import { Event } from '../models/Event.js';
import { Clip } from '../models/Clip.js';
import { AiCall } from '../models/AiCall.js';

const router = Router();
router.use(loadShop);

/**
 * GET /api/stats → the numbers for the "Stay curious" slide:
 * how many tracker candidates the AI removed, and how often the owner agreed with the AI.
 */
router.get('/', async (req, res) => {
  const events = await Event.find({ shop: req.shop._id }).select('ai.verdict ai.model ai.passes ai.cropped status').lean();
  const clips = await Clip.find({ shop: req.shop._id, status: 'done' }).select('processingMs usage detector.ms framesSampled framesSent').lean();

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

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const callRows = await AiCall.aggregate([
    { $match: { shop: req.shop._id, createdAt: { $gte: monthStart } } },
    { $group: { _id: '$purpose', calls: { $sum: 1 }, usd: { $sum: '$costUsd' }, promptTokens: { $sum: '$promptTokens' } } },
  ]);
  const frameTotals = clips.reduce(
    (acc, c) => ({ sampled: acc.sampled + (c.framesSampled || 0), sent: acc.sent + (c.framesSent || 0) }),
    { sampled: 0, sent: 0 },
  );

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
      closeLook: {
        runs: count((e) => e.ai?.passes?.length > 1),
        croppedToPerson: count((e) => e.ai?.passes?.length > 1 && e.ai?.cropped),
        // How often the close-up changed the first look's answer, e.g. "unclear" → "yes"
        changedVerdict: count((e) => e.ai?.passes?.length > 1 && e.ai.passes[0].verdict !== e.ai.verdict),
        changes: events
          .filter((e) => e.ai?.passes?.length > 1 && e.ai.passes[0].verdict !== e.ai.verdict)
          .reduce((acc, e) => {
            const k = `${e.ai.passes[0].verdict} → ${e.ai.verdict}`;
            acc[k] = (acc[k] || 0) + 1;
            return acc;
          }, {}),
      },
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
      framesSampled: frameTotals.sampled,
      framesSent: frameTotals.sent,
    },
    // Measured from every OpenRouter call (ai_calls): use these numbers on the margins slide.
    aiCostThisMonth: {
      byPurpose: Object.fromEntries(callRows.map((r) => [r._id, { calls: r.calls, usd: +r.usd.toFixed(5), promptTokens: r.promptTokens }])),
      totalUsd: +callRows.reduce((s, r) => s + r.usd, 0).toFixed(5),
    },
    marginAlert: req.shop.marginAlert || null,
  });
});

export default router;
