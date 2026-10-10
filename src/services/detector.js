import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { AppError } from '../utils/errors.js';
import { normalizeDetectorResponse, zonesSchema } from './aiJson.js';

/**
 * Gets YOLO candidates for a video: people who spent time at the shelf,
 * never visited the till, then reached the exit.
 *
 * - DETECTOR_URL set: calls the teammate's Python service (POST /detect).
 * - Otherwise: mock mode, so the MERN side works before the Python side is ready.
 */
export async function detectCandidates({ videoPath, originalName, zones, durationSec }) {
  const started = Date.now();
  const result = config.detector.url
    ? await detectViaHttp({ videoPath, zones, durationSec })
    : await detectViaMock({ originalName, durationSec });
  return { ...result, ms: Date.now() - started };
}

async function detectViaHttp({ videoPath, zones, durationSec }) {
  const url = `${config.detector.url}/detect`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_path: videoPath,
        zones,
        min_shelf_seconds: config.detector.minShelfSeconds,
      }),
      signal: AbortSignal.timeout(config.detector.timeoutMs),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new AppError('The detector took too long. Try a shorter clip.', 504, 'DETECTOR_TIMEOUT');
    }
    throw new AppError(`Can't reach the detector at ${config.detector.url}. Is the Python service running?`, 503, 'DETECTOR_DOWN');
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const why = body?.error || body?.detail || `HTTP ${res.status}`;
    throw new AppError(`The detector couldn't process this video: ${typeof why === 'string' ? why : JSON.stringify(why)}`, 502, 'DETECTOR_FAILED');
  }
  try {
    return { mode: 'http', ...normalizeDetectorResponse(body, durationSec) };
  } catch (err) {
    throw new AppError(err.message, 502, 'DETECTOR_BAD_RESPONSE');
  }
}

/**
 * Mock detector. If mock-detections/<video name>.json exists (e.g. the
 * events.json your teammate's detect.py produced for that clip), it's used.
 * Otherwise one fake candidate is made from 30% to 80% of the video.
 */
async function detectViaMock({ originalName, durationSec }) {
  const base = path.parse(originalName || '').name;
  const file = path.join(config.detector.mockDir, `${base}.json`);
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return { mode: 'mock-file', ...normalizeDetectorResponse(data, durationSec) };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw new AppError(`mock-detections/${base}.json is invalid: ${err.message}`, 500, 'MOCK_INVALID');
    }
  }
  const fake = [{
    track_id: 1,
    start_time: +(durationSec * 0.3).toFixed(2),
    end_time: +(durationSec * 0.8).toFixed(2),
    shelf_seconds: +Math.min(6, durationSec * 0.2).toFixed(1),
    visited_till: false,
    rule: 'shelf -> no till -> exit (mock)',
  }];
  return { mode: 'mock', ...normalizeDetectorResponse(fake, durationSec) };
}

/** Zones for this upload: the form field if sent, otherwise zones.json. */
export async function resolveZones(zonesField) {
  let zones = null;
  let source = null;
  if (zonesField) {
    try {
      zones = typeof zonesField === 'string' ? JSON.parse(zonesField) : zonesField;
      source = 'request';
    } catch {
      throw new AppError('The "zones" field is not valid JSON.', 400, 'BAD_ZONES');
    }
  } else {
    try {
      zones = JSON.parse(await readFile(config.zonesFile, 'utf8'));
      source = 'zones.json';
    } catch (err) {
      if (err.code !== 'ENOENT') throw new AppError(`zones.json is not valid JSON: ${err.message}`, 500, 'BAD_ZONES');
    }
  }

  if (!zones) {
    if (config.detector.url) {
      throw new AppError(
        'No zones set. Add a zones.json (shelf, till, exit polygons) or send a "zones" field with the upload.',
        400,
        'NO_ZONES',
      );
    }
    return null; // the mock detector doesn't need zones
  }

  const check = zonesSchema.safeParse(zones);
  if (!check.success) {
    throw new AppError(
      `Zones from ${source} are invalid. Each of shelf, till and exit needs at least 3 [x, y] points.`,
      400,
      'BAD_ZONES',
    );
  }
  return check.data;
}
