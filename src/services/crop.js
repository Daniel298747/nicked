import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

/** The tracked person's box nearest in time to `seconds`, if one is within `maxGap` seconds. */
export function boxAt(boxes, seconds, maxGap = 1.0) {
  let best = null;
  let bestGap = Infinity;
  for (const b of boxes) {
    const gap = Math.abs(b.t - seconds);
    if (gap < bestGap) {
      best = b;
      bestGap = gap;
    }
  }
  return best && bestGap <= maxGap ? best.box : null;
}

/**
 * Turns a person box into a crop rectangle: padded on every side (hands and
 * bags sit at the edges of a person box), at least `minSize` px, clamped to
 * the image. Returns null if the box is outside the image.
 */
export function cropRect(box, imgW, imgH, { pad = 0.35, minSize = 224, scale = 1 } = {}) {
  const [x1, y1, x2, y2] = box.map((v) => v * scale);
  if (x2 <= 0 || y2 <= 0 || x1 >= imgW || y1 >= imgH) return null;
  const w = x2 - x1;
  const h = y2 - y1;
  const cw = Math.min(imgW, Math.max(w * (1 + 2 * pad), minSize));
  const ch = Math.min(imgH, Math.max(h * (1 + 2 * pad), minSize));
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const left = Math.round(Math.min(Math.max(cx - cw / 2, 0), imgW - cw));
  const top = Math.round(Math.min(Math.max(cy - ch / 2, 0), imgH - ch));
  return {
    left,
    top,
    width: Math.max(1, Math.min(Math.round(cw), imgW - left)),
    height: Math.max(1, Math.min(Math.round(ch), imgH - top)),
  };
}

/**
 * Crops each full-resolution frame around the tracked person (in place) and
 * caps the width. Frames without a nearby box are just resized. Returns how
 * many frames were actually cropped.
 */
export async function cropFramesToPerson(frames, boxes, { maxWidth = 960, sourceWidth } = {}) {
  let cropped = 0;
  for (const f of frames) {
    const input = await readFile(f.path);
    const img = sharp(input);
    const { width, height } = await img.metadata();
    const box = boxAt(boxes, f.seconds);
    const rect = box ? cropRect(box, width, height, { scale: sourceWidth ? width / sourceWidth : 1 }) : null;
    let pipeline = sharp(input);
    if (rect) {
      pipeline = pipeline.extract(rect);
      cropped++;
    }
    const out = await pipeline.resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    await writeFile(f.path, out);
  }
  return cropped;
}
