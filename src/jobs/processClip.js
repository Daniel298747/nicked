import path from 'node:path';
import { rm } from 'node:fs/promises';
import { config } from '../config.js';
import { Clip } from '../models/Clip.js';
import { Event, QUEUE_VERDICTS } from '../models/Event.js';
import { Shop } from '../models/Shop.js';
import { detectCandidates } from '../services/detector.js';
import { verifyCandidate } from '../services/verify.js';
import { measureBrightness, transcodeForWeb } from '../services/ffmpeg.js';
import { describeAiError, isFatalAiError } from '../services/openrouter.js';

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const overlaps = (a, b) => a.startSec < b.endSec && b.startSec < a.endSec;

/**
 * upload → YOLO candidates → OpenRouter check per candidate → events in Mongo.
 * Runs in the background; the frontend polls GET /api/clips/:id for progress.
 */
export async function processClip(clipId, { model = config.openrouter.detectModel, zoomModel } = {}) {
  const clip = await Clip.findById(clipId);
  if (!clip) return;
  const shop = await Shop.findById(clip.shop);
  const started = Date.now();
  const workDir = path.join(config.uploadDir, 'frames', `${clip.id}-${started}`);

  Object.assign(clip, {
    status: 'processing',
    stage: 'detecting',
    model,
    error: undefined,
    warnings: [],
    progress: { checked: 0, total: 0 },
    usage: { promptTokens: 0, completionTokens: 0, cost: 0 },
  });
  await clip.save();

  try {
    const warnings = [];

    // Cheap, local checks first
    const brightness = await measureBrightness(clip.storedPath).catch(() => null);
    if (brightness != null) {
      clip.brightness = Math.round(brightness);
      if (brightness < config.verify.darkThreshold) {
        warnings.push('This footage is very dark, so detection and AI checks will be less reliable.');
      }
    }
    if (clip.height && clip.height < 480) {
      warnings.push(`Low resolution (${clip.height}p). Small hand movements may not be visible.`);
    }

    // 1. YOLO candidates
    const detection = await detectCandidates({
      videoPath: clip.storedPath,
      originalName: clip.originalName,
      zones: clip.zones,
      durationSec: clip.durationSec,
    });
    warnings.push(...detection.warnings);
    if (detection.mode !== 'http') warnings.push('Demo mode: candidates came from the mock detector, not YOLO.');

    clip.detector = {
      mode: detection.mode,
      fps: detection.fps,
      frameWidth: detection.frameWidth,
      frameHeight: detection.frameHeight,
      ms: detection.ms,
      annotatedPath: undefined,
    };
    if (detection.annotatedVideoPath) {
      try {
        clip.detector.annotatedPath = await transcodeForWeb(
          detection.annotatedVideoPath,
          path.join(config.uploadDir, 'annotated', `${clip.id}.mp4`),
        );
      } catch {
        warnings.push("The detector's annotated video couldn't be converted for the browser, so only the original is available.");
      }
    }
    const withBoxes = detection.candidates.filter((c) => c.boxes?.length).length;
    if (detection.candidates.length && !withBoxes) {
      warnings.push('The detector sent no person boxes, so close-ups use the full frame instead of a crop around the person.');
    }

    // Reviewed events from a previous run are kept; don't recreate duplicates of them.
    const reviewed = await Event.find({ clip: clip._id, status: { $ne: 'pending' } }).select('startSec endSec');
    const candidates = detection.candidates.filter((c) => !reviewed.some((r) => overlaps(r, c)));

    clip.stage = 'verifying';
    clip.progress = { checked: 0, total: candidates.length };
    clip.counts = { candidates: detection.candidates.length, aiYes: 0, aiNo: 0, aiUnclear: 0, aiError: 0 };
    clip.warnings = warnings;
    await clip.save();

    // 2. OpenRouter check per candidate
    let fatal = null;
    const results = await mapPool(candidates, config.verify.concurrency, async (candidate) => {
      let out;
      const evidenceKey = `${clip.id}/${Math.round(candidate.startSec * 10)}-${candidate.trackId ?? 'x'}-${started}`;
      if (fatal) {
        out = { ai: { verdict: 'error', error: fatal, model }, eventType: 'ai_check_failed', flags: [] };
      } else {
        try {
          out = await verifyCandidate({
            videoPath: clip.storedPath,
            candidate,
            model,
            zoomModel: zoomModel || config.openrouter.zoomModel,
            layoutNotes: shop?.layoutNotes,
            workDir,
            evidenceDir: path.join(config.uploadDir, 'evidence', evidenceKey),
            boxSourceWidth: detection.frameWidth,
          });
          out.ai.evidenceKey = evidenceKey;
        } catch (err) {
          const message = describeAiError(err);
          if (isFatalAiError(err)) fatal = message;
          out = { ai: { verdict: 'error', error: message, model }, eventType: 'ai_check_failed', flags: [] };
        }
      }
      await Clip.updateOne({ _id: clip._id }, { $inc: { 'progress.checked': 1 } });
      return { candidate, ...out };
    });

    // 3. Save events (replacing unreviewed ones from earlier runs, and their evidence images)
    const replaced = await Event.find({ clip: clip._id, status: 'pending' }).select('ai.evidenceKey');
    await Promise.all(
      replaced
        .map((e) => e.ai?.evidenceKey)
        .filter(Boolean)
        .map((key) => rm(path.join(config.uploadDir, 'evidence', key), { recursive: true, force: true })),
    );
    await Event.deleteMany({ clip: clip._id, status: 'pending' });
    const docs = results.map(({ candidate, ai, eventType, flags }) => ({
      shop: clip.shop,
      clip: clip._id,
      startSec: candidate.startSec,
      endSec: candidate.endSec,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      candidate: {
        trackId: candidate.trackId,
        shelfSeconds: candidate.shelfSeconds,
        visitedTill: candidate.visitedTill,
        rule: candidate.rule,
        boxCount: candidate.boxes?.length || 0,
      },
      ai,
      eventType,
      inQueue: QUEUE_VERDICTS.includes(ai.verdict),
      flags,
    }));
    if (docs.length) await Event.insertMany(docs);

    const fresh = await Clip.findById(clip._id);
    for (const r of results) {
      const key = { yes: 'aiYes', no: 'aiNo', unclear: 'aiUnclear', error: 'aiError' }[r.ai.verdict];
      fresh.counts[key] += 1;
      if (r.usage) {
        fresh.usage.promptTokens += r.usage.promptTokens;
        fresh.usage.completionTokens += r.usage.completionTokens;
        fresh.usage.cost += r.usage.cost;
      }
    }
    if (fatal) fresh.warnings.push(`AI checks stopped early: ${fatal} Candidates are still in the queue for manual review.`);
    if (!detection.candidates.length) {
      fresh.warnings.push('The tracker found nobody who went from the shelf to the exit without visiting the till.');
    }
    Object.assign(fresh, {
      status: 'done',
      stage: 'finished',
      processingMs: Date.now() - started,
      processedAt: new Date(),
    });
    await fresh.save();
  } catch (err) {
    const message = err.expose ? err.message : `Processing failed: ${err.message}`;
    if (!err.expose) console.error(`[processClip ${clipId}]`, err);
    await Clip.updateOne(
      { _id: clip._id },
      { status: 'failed', stage: 'finished', error: message, processingMs: Date.now() - started },
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
