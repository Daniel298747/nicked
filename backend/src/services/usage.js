import { config } from '../config.js';
import { Camera } from '../models/Camera.js';
import { UsageDaily } from '../models/UsageDaily.js';
import { AiCall } from '../models/AiCall.js';

/** YYYY-MM-DD in the shop's timezone, so the daily cap resets at the shop's midnight. */
export function localDate(timezone = config.plan.defaultTimezone, at = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export const capFor = (camera) => (camera?.alwaysOn ? config.plan.alwaysOnCapSeconds : config.plan.dailyCapSeconds);

const hours = (s) => {
  const h = s / 3600;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
};

/** "7.5 of 12 hours today" — for the per-camera usage bar. */
export function usageLabel(analysedSeconds, capSeconds) {
  return `${hours(analysedSeconds)} of ${hours(capSeconds)} hours today`;
}

export async function usageToday(camera, timezone) {
  const date = localDate(timezone);
  const row = await UsageDaily.findOne({ camera: camera._id, date });
  const used = row?.analysedSeconds || 0;
  const cap = capFor(camera);
  return {
    date,
    analysedSeconds: used,
    capSeconds: cap,
    remainingSeconds: Math.max(0, cap - used),
    percent: Math.min(100, Math.round((used / cap) * 100)),
    label: usageLabel(used, cap),
    framesSampled: row?.framesSampled || 0,
    framesSent: row?.framesSent || 0,
    aiCostUsd: +(row?.aiCostUsd || 0).toFixed(4),
  };
}

/** Counts analysis time against today's budget when the scan starts. */
export async function reserveAnalysis({ shop, camera, date, seconds }) {
  await UsageDaily.updateOne(
    { camera: camera._id, date },
    { $inc: { analysedSeconds: seconds }, $setOnInsert: { shop: shop._id } },
    { upsert: true },
  );
}

/** Adds frames and AI cost to a camera's day, and logs every OpenRouter call. */
export async function recordAi({ shopId, cameraId, clipId, date, calls = [], framesSampled = 0, framesSent = 0 }) {
  if (calls.length) {
    await AiCall.insertMany(
      calls.map((c) => ({
        shop: shopId,
        camera: cameraId,
        clip: clipId,
        pass: c.purpose === 'overview' ? 'vision' : 'reasoning',
        purpose: c.purpose,
        model: c.model,
        promptTokens: c.promptTokens,
        completionTokens: c.completionTokens,
        costUsd: c.cost,
        latencyMs: c.latencyMs,
      })),
    );
  }
  if (cameraId && date) {
    const cost = calls.reduce((s, c) => s + (c.cost || 0), 0);
    await UsageDaily.updateOne(
      { camera: cameraId, date },
      { $inc: { framesSampled, framesSent, aiCostUsd: cost }, $setOnInsert: { shop: shopId } },
      { upsert: true },
    );
  }
}

/**
 * Keeps the shop's cameras in line with its plan (run after every entitlement sync):
 *  - more active cameras than cameras_allowed → the most recently added are paused
 *  - fewer → paused cameras come back first (oldest first), then "Camera N" is created
 *  - same for 24/7: extras lose it (most recent first), spare 24/7 slots go to the oldest cameras
 * So "Add a camera" is one step: raise the Stripe quantity and the camera appears.
 */
export async function syncCameras(shop) {
  const cameras = await Camera.find({ shop: shop._id }).sort({ createdAt: 1 });
  const allowed = Math.max(0, shop.camerasAllowed || 0);
  const alwaysOnAllowed = Math.min(allowed, Math.max(0, shop.camerasAlwaysOn || 0));

  const active = cameras.filter((c) => c.active);
  while (active.length > allowed) {
    const cam = active.pop();
    cam.active = false;
    cam.alwaysOn = false;
    cam.pausedReason = 'Your plan covers fewer cameras. Add a camera to turn this one back on.';
  }
  for (const cam of cameras) {
    if (active.length >= allowed) break;
    if (!cam.active) {
      cam.active = true;
      cam.pausedReason = undefined;
      active.push(cam);
    }
  }
  const created = [];
  for (let n = cameras.length + 1; active.length + created.length < allowed; n++) {
    created.push(new Camera({ shop: shop._id, name: `Camera ${n}` }));
  }

  const all = [...active.sort((a, b) => a.createdAt - b.createdAt), ...created];
  const onCameras = all.filter((c) => c.alwaysOn);
  while (onCameras.length > alwaysOnAllowed) onCameras.pop().alwaysOn = false;
  for (const cam of all) {
    if (onCameras.length >= alwaysOnAllowed) break;
    if (!cam.alwaysOn) {
      cam.alwaysOn = true;
      onCameras.push(cam);
    }
  }

  await Promise.all([...cameras.filter((c) => c.isModified()), ...created].map((c) => c.save()));
  return { active: allowed, created: created.length };
}
