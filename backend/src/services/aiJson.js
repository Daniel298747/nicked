import { z } from 'zod';
import { parseTime, formatTime } from '../utils/time.js';

/** Pulls the JSON object out of a model reply, tolerating ```json fences and stray prose. */
export function parseModelJson(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Empty reply from the model.');
  let s = text.trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) s = fenced[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last <= first) throw new Error('Reply contained no JSON object.');
  try {
    return JSON.parse(s.slice(first, last + 1));
  } catch (err) {
    throw new Error(`Reply was not valid JSON (${err.message}).`);
  }
}

const verificationSchema = z.object({
  verdict: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['yes', 'no', 'unclear'])),
  confidence: z.coerce.number().min(0).max(1),
  reason: z.string().trim().min(1).max(600),
  frames_referenced: z.array(z.union([z.string(), z.number()])).default([]),
  notes: z.string().max(600).optional().default(''),
});

/**
 * Validates the vision model's verdict against the frames we actually sent.
 * Throws if the shape is wrong (the caller retries once). Fixes small issues
 * and records them as flags rather than throwing.
 */
export function validateVerification(raw, frames) {
  const parsed = verificationSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`JSON did not match the schema: ${issue.path.join('.') || 'root'} ${issue.message}`);
  }
  const v = parsed.data;
  const flags = [];

  // Map each referenced timestamp to a frame we really sent. Models sometimes invent timestamps.
  const byTenths = new Map(frames.map((f) => [Math.round(f.seconds * 10), f.label]));
  const valid = [];
  let invented = 0;
  for (const ref of v.frames_referenced) {
    const label = byTenths.get(Math.round(parseTime(ref) * 10));
    if (label) valid.push(label);
    else invented++;
  }
  if (invented) flags.push(`Ignored ${invented} timestamp(s) the model referenced that were not in the frames sent.`);

  let verdict = v.verdict;
  let confidence = v.confidence;
  // A "yes" has to point at evidence. Without any real frame, downgrade it.
  if (verdict === 'yes' && valid.length === 0) {
    verdict = 'unclear';
    confidence = Math.min(confidence, 0.4);
    flags.push('Model said "yes" without citing any frame it was sent, so this was downgraded to "unclear".');
  }

  return {
    verdict,
    confidence,
    reason: v.reason,
    framesReferenced: [...new Set(valid)].sort((a, b) => parseTime(a) - parseTime(b)),
    notes: v.notes || '',
    flags,
  };
}

const candidateSchema = z.object({
  track_id: z.coerce.number().int().optional(),
  start_time: z.coerce.number(),
  end_time: z.coerce.number(),
  shelf_seconds: z.coerce.number().optional(),
  visited_till: z.boolean().optional(),
  rule: z.string().optional(),
  boxes: z.array(z.unknown()).optional(),
  // Pose model only: a wrist stayed level with a hip after the shelf visit (a hint, not proof)
  hand_to_waist: z.boolean().optional(),
  hand_to_waist_at: z.coerce.number().optional(),
});

// One bounding box of the tracked person: seconds into the video + [x1, y1, x2, y2] in original pixels.
// Accepts { t, box } or { t, xyxy }.
const boxSchema = z
  .object({
    t: z.coerce.number().min(0),
    box: z.array(z.coerce.number()).length(4).optional(),
    xyxy: z.array(z.coerce.number()).length(4).optional(),
  })
  .transform((b) => ({ t: b.t, box: b.box || b.xyxy }))
  .refine((b) => b.box && b.box[2] > b.box[0] && b.box[3] > b.box[1]);

const detectorSchema = z.object({
  fps: z.coerce.number().optional(),
  duration: z.coerce.number().optional(),
  frame_width: z.coerce.number().optional(),
  frame_height: z.coerce.number().optional(),
  annotated_video_path: z.string().optional(),
  events: z.array(z.unknown()).default([]),
});

function normalizeBoxes(raw = []) {
  const boxes = [];
  for (const b of raw.slice(0, 5000)) {
    const parsed = boxSchema.safeParse(b);
    if (parsed.success) boxes.push(parsed.data);
  }
  return boxes.sort((a, b) => a.t - b.t);
}

/**
 * Accepts the detector's response (or the bare events.json array from detect.py),
 * drops malformed candidates and clamps times to the video, since padding can
 * push end_time past the end.
 */
export function normalizeDetectorResponse(data, durationSec) {
  const wrapped = Array.isArray(data) ? { events: data } : data;
  const top = detectorSchema.safeParse(wrapped);
  if (!top.success) throw new Error('Detector response is not in the agreed format ({ events: [...] }).');

  const warnings = [];
  const candidates = [];
  top.data.events.forEach((e, i) => {
    const c = candidateSchema.safeParse(e);
    if (!c.success) {
      warnings.push(`Detector event #${i + 1} was malformed and skipped.`);
      return;
    }
    const start = Math.max(0, c.data.start_time);
    const end = durationSec ? Math.min(durationSec, c.data.end_time) : c.data.end_time;
    if (!(end > start)) {
      warnings.push(`Detector event #${i + 1} had an empty time range and was skipped.`);
      return;
    }
    candidates.push({
      trackId: c.data.track_id,
      startSec: start,
      endSec: end,
      startTime: formatTime(start),
      endTime: formatTime(end),
      shelfSeconds: c.data.shelf_seconds,
      visitedTill: c.data.visited_till ?? false,
      rule: c.data.rule || 'shelf -> no till -> exit',
      boxes: normalizeBoxes(c.data.boxes),
      handToWaist: c.data.hand_to_waist,
      handToWaistSec: c.data.hand_to_waist_at,
    });
  });

  return {
    fps: top.data.fps,
    frameWidth: top.data.frame_width,
    frameHeight: top.data.frame_height,
    annotatedVideoPath: top.data.annotated_video_path,
    candidates,
    warnings,
  };
}

/** Zones must be { shelf, till, exit }, each a polygon of at least 3 [x, y] points. */
const point = z.tuple([z.number(), z.number()]);
const polygon = z.array(point).min(3);
export const zonesSchema = z.object({ shelf: polygon, till: polygon, exit: polygon });
