import { readFile, rm, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { sampleFrames } from './ffmpeg.js';
import { chat, describeAiError } from './openrouter.js';
import { parseModelJson, validateVerification } from './aiJson.js';
import { findLoadedTerms } from './language.js';
import { cropFramesToPerson } from './crop.js';
import { formatTime, parseTime } from '../utils/time.js';

export const VERIFY_SYSTEM_PROMPT = `You check possible incidents flagged by an automated person tracker on CCTV from a small independent shop.

The tracker flags people who spent time at the shelves, never went to the till, and then reached the exit. Many of them simply browsed and left without buying, which is normal. Your job is to look at the frames and say whether you can actually SEE the tracked person conceal a product (put it in a pocket, a bag, or under clothing).

Answer with one verdict:
- "yes": you can see a product being concealed by the person.
- "no": you can see that they did not conceal anything (they put the item back, left empty-handed, carried items openly, or only handled their own phone, wallet, keys or bag).
- "unclear": the view is too dark, blurry, distant or blocked, several people overlap, or the action is ambiguous.

Rules:
- Prefer "unclear" over guessing. Use confidence below 0.5 when unsure.
- Describe actions only. Never describe faces, skin colour, ethnicity, age, gender or other personal traits. You may mention clothing to tell people apart.
- Never use the words theft, steal, thief, shoplifting, crime, suspect or suspicious. Use neutral wording such as "places the item in their jacket pocket".
- Only cite timestamps that appear in the frame labels you were given. Never invent timestamps.
- In "frames_referenced", cite the frames that best show what you describe (up to 4).

Reply with ONLY this JSON object and nothing else:
{"verdict":"yes"|"no"|"unclear","confidence":0.0-1.0,"reason":"one sentence describing what happens, with timestamps","frames_referenced":["mm:ss.s", "..."],"notes":"camera or visibility issues, or empty string"}`;

const VERDICT_TO_TYPE = { yes: 'possible_concealment', no: 'no_concealment_seen', unclear: 'unclear_activity', error: 'ai_check_failed' };

/** Picks a frame rate so the overview never sends more than maxFrames images. */
export function frameRateFor(durationSec, { fps = config.verify.fps, maxFrames = config.verify.maxFrames } = {}) {
  if (durationSec <= 0) return fps;
  return Math.min(fps, maxFrames / durationSec);
}

/** Whether a first-pass result is worth a close-up second look. */
export function shouldLookCloser(overview, candidate, opts = config.verify) {
  if (!opts.closeLook || overview.verdict === 'error') return false;
  if (overview.verdict === 'no' && overview.confidence >= opts.trustNoAbove) return false;
  const span = candidate.endSec - candidate.startSec;
  const alreadyDense = span <= opts.closeLookSeconds && overview.framesSent / Math.max(span, 0.1) >= opts.closeLookFps;
  return !(alreadyDense && !candidate.boxes?.length);
}

/** Where to look closer: the frames the model cited, otherwise the middle of the person's shelf visit. */
export function pickFocus(overview, candidate, padBefore = config.verify.detectorPadBefore) {
  const refs = (overview.framesReferenced || []).map(parseTime).filter(Number.isFinite).sort((a, b) => a - b);
  let focus;
  if (refs.length) focus = refs[Math.floor((refs.length - 1) / 2)];
  else if (candidate.shelfSeconds) focus = candidate.startSec + padBefore + candidate.shelfSeconds / 2;
  else focus = (candidate.startSec + candidate.endSec) / 2;
  return Math.min(Math.max(focus, candidate.startSec), candidate.endSec);
}

/** A window of `length` seconds around `focus`, kept inside the candidate. */
export function closeLookWindow(focus, candidate, length = config.verify.closeLookSeconds) {
  const span = candidate.endSec - candidate.startSec;
  const len = Math.min(length, span);
  const start = Math.min(Math.max(focus - len / 2, candidate.startSec), candidate.endSec - len);
  return { start, end: start + len };
}

export function buildVerifyMessages({ frames, candidate, layoutNotes, closeLook }) {
  const facts = [
    `Tracked person: ${candidate.trackId != null ? `track ${candidate.trackId}` : 'one person'}.`,
    `Window: ${candidate.startTime} to ${candidate.endTime}.`,
    candidate.shelfSeconds != null ? `Tracker measured about ${candidate.shelfSeconds}s in the shelf zone.` : null,
    'Tracker saw no visit to the till before the exit.',
    closeLook
      ? `This is a close-up second look: ${frames.length} frames from ${closeLook.startTime} to ${closeLook.endTime}, ${closeLook.cropped ? 'cropped around the tracked person' : 'at higher resolution'}. Look carefully at their hands, pockets, bag and clothing.`
      : null,
    layoutNotes ? `Shop layout from the owner: ${layoutNotes}` : null,
    `Valid frame labels: ${frames.map((f) => f.label).join(', ')}.`,
  ].filter(Boolean);

  return [
    { role: 'system', content: VERIFY_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: facts.join('\n') },
        ...frames.flatMap((f) => [
          { type: 'text', text: `Frame ${f.label}` },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${f.base64}` } },
        ]),
      ],
    },
  ];
}

/** One model call on a set of frames, with one corrective retry for bad JSON. API errors are thrown. */
async function runPass({ kind, frames, model, candidate, layoutNotes, usage, closeLook }) {
  for (const f of frames) f.base64 = (await readFile(f.path)).toString('base64');
  const messages = buildVerifyMessages({ frames, candidate, layoutNotes, closeLook });
  const base = {
    kind,
    frames,
    framesSent: frames.length,
    cropped: Boolean(closeLook?.cropped),
    window: { startTime: frames[0]?.label, endTime: frames.at(-1)?.label },
  };
  const started = Date.now();
  const add = (u) => {
    usage.promptTokens += u.promptTokens;
    usage.completionTokens += u.completionTokens;
    usage.cost += u.cost;
  };

  let reply = await chat({ model, messages });
  add(reply.usage);
  let result;
  try {
    result = validateVerification(parseModelJson(reply.text), frames);
  } catch (firstErr) {
    reply = await chat({
      model,
      messages: [
        ...messages,
        { role: 'assistant', content: reply.text || '(empty)' },
        { role: 'user', content: `That reply was not usable (${firstErr.message}). Reply again with ONLY the JSON object in the required format.` },
      ],
    });
    add(reply.usage);
    try {
      result = validateVerification(parseModelJson(reply.text), frames);
    } catch (secondErr) {
      return { ...base, verdict: 'error', error: `The model returned unusable JSON twice (${secondErr.message}).`, model: reply.model, latencyMs: Date.now() - started, framesReferenced: [], flags: [] };
    }
  }

  const flags = [...result.flags];
  const loaded = findLoadedTerms(`${result.reason} ${result.notes}`);
  if (loaded.length) flags.push(`AI wording used loaded terms (${loaded.join(', ')}). The report generator rewrites these neutrally.`);
  return { ...base, ...result, flags, model: reply.model, latencyMs: Date.now() - started };
}

/** Copies the frames the model cited (and a thumbnail) so the review screen can show them. */
async function saveEvidence(pass, evidenceDir) {
  if (!evidenceDir || !pass.frames?.length) return { evidence: [], thumbnail: undefined };
  await mkdir(evidenceDir, { recursive: true });
  const byLabel = new Map(pass.frames.map((f) => [f.label, f]));
  const evidence = [];
  for (const label of pass.framesReferenced.slice(0, 6)) {
    const frame = byLabel.get(label);
    if (!frame) continue;
    const file = `${pass.kind}-${label.replace(/[:.]/g, '-')}.jpg`;
    await copyFile(frame.path, path.join(evidenceDir, file));
    evidence.push({ label, file, cropped: pass.cropped });
  }
  let thumbnail = evidence[0]?.file;
  if (!thumbnail) {
    thumbnail = 'thumb.jpg';
    await copyFile(pass.frames[Math.floor(pass.frames.length / 2)].path, path.join(evidenceDir, thumbnail));
  }
  return { evidence, thumbnail };
}

/**
 * Checks one YOLO candidate in up to two passes:
 *  1. Overview: ≤16 frames across the whole window (cheap model).
 *  2. Close look: dense frames (3/s) around the moment pass 1 pointed at, at higher
 *     resolution or cropped around the tracked person (ZOOM_MODEL, can be stronger).
 * Skipped when pass 1 is a confident "no". The close look's verdict wins.
 * Bad JSON (twice) gives verdict "error"; API errors in pass 1 are thrown so the caller can stop early.
 */
export async function verifyCandidate({
  videoPath,
  candidate,
  model,
  zoomModel = config.openrouter.zoomModel,
  layoutNotes,
  workDir,
  evidenceDir,
  boxSourceWidth,
}) {
  const root = path.join(workDir || path.join(config.uploadDir, 'frames'), randomUUID());
  const usage = { promptTokens: 0, completionTokens: 0, cost: 0 };
  const span = candidate.endSec - candidate.startSec;

  try {
    const overviewFrames = await sampleFrames(videoPath, path.join(root, 'overview'), {
      fps: frameRateFor(span),
      width: config.verify.frameWidth,
      startSec: candidate.startSec,
      durationSec: span,
    });
    if (!overviewFrames.length) {
      return { ai: { verdict: 'error', error: 'No frames could be read for this time window.', model, framesSent: 0, passes: [] }, eventType: 'ai_check_failed', flags: [], usage };
    }

    const overview = await runPass({ kind: 'overview', frames: overviewFrames, model, candidate, layoutNotes, usage });
    const passes = [overview];
    const flags = [...overview.flags];
    let final = overview;

    if (shouldLookCloser(overview, candidate)) {
      const { start, end } = closeLookWindow(pickFocus(overview, candidate), candidate);
      try {
        const hasBoxes = candidate.boxes?.length > 0;
        const frames = await sampleFrames(videoPath, path.join(root, 'close'), {
          fps: config.verify.closeLookFps,
          width: hasBoxes ? null : config.verify.closeLookWidth,
          startSec: start,
          durationSec: end - start,
        });
        const cropped = hasBoxes
          ? (await cropFramesToPerson(frames, candidate.boxes, { maxWidth: config.verify.closeLookWidth, sourceWidth: boxSourceWidth })) > 0
          : false;
        if (frames.length) {
          const close = await runPass({
            kind: 'close_look',
            frames,
            model: zoomModel,
            candidate,
            layoutNotes,
            usage,
            closeLook: { startTime: formatTime(start), endTime: formatTime(end), cropped },
          });
          passes.push(close);
          flags.push(...close.flags.map((f) => `Close-up: ${f}`));
          if (close.verdict !== 'error') final = close;
          else flags.push(`Close-up check failed (${close.error}); using the first look.`);
        }
      } catch (err) {
        flags.push(`Close-up check failed (${describeAiError(err)}); using the first look.`);
      }
    }

    const { evidence, thumbnail } = await saveEvidence(final, evidenceDir).catch(() => ({ evidence: [], thumbnail: undefined }));

    return {
      ai: {
        verdict: final.verdict,
        confidence: final.confidence,
        reason: final.reason,
        framesReferenced: final.framesReferenced,
        notes: final.notes,
        error: final.error,
        model: final.model,
        latencyMs: passes.reduce((s, p) => s + (p.latencyMs || 0), 0),
        framesSent: passes.reduce((s, p) => s + p.framesSent, 0),
        closeLook: passes.length > 1,
        cropped: final.cropped,
        passes: passes.map((p) => ({
          kind: p.kind,
          verdict: p.verdict,
          confidence: p.confidence,
          reason: p.reason,
          model: p.model,
          framesSent: p.framesSent,
          window: p.window,
          cropped: p.cropped,
          error: p.error,
        })),
        evidence,
        thumbnail,
      },
      eventType: VERDICT_TO_TYPE[final.verdict],
      flags,
      usage,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
