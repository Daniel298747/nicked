import sharp from 'sharp';

const thumb = (file) => sharp(file).resize(64, 36, { fit: 'fill' }).grayscale().raw().toBuffer();

/** Share of thumbnail pixels whose brightness changed by more than `pixelDelta`. */
export function changedShare(a, b, pixelDelta = 10) {
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > pixelDelta) changed++;
  return changed / a.length;
}

/**
 * Motion skipping: keeps a frame only if it changed enough since the last frame
 * kept, so still footage isn't sent to the AI. The first and last frames are
 * always kept. If fewer than `minKeep` frames survive, nothing is skipped
 * (too little to save, and the AI needs some context).
 */
export async function skipStillFrames(frames, { minChanged = 0.002, pixelDelta = 10, minKeep = 4 } = {}) {
  if (!minChanged || frames.length <= minKeep) return { kept: frames, skipped: 0 };
  const thumbs = await Promise.all(frames.map((f) => thumb(f.path)));
  const kept = [frames[0]];
  let last = thumbs[0];
  for (let i = 1; i < frames.length; i++) {
    if (changedShare(thumbs[i], last, pixelDelta) >= minChanged) {
      kept.push(frames[i]);
      last = thumbs[i];
    }
  }
  if (kept.at(-1) !== frames.at(-1)) kept.push(frames.at(-1));
  if (kept.length < minKeep) return { kept: frames, skipped: 0 };
  return { kept, skipped: frames.length - kept.length };
}
