import path from 'node:path';
import { rm } from 'node:fs/promises';
import { config } from '../config.js';
import { Clip } from '../models/Clip.js';
import { Event } from '../models/Event.js';
import { Incident } from '../models/Incident.js';

/** Deletes a clip's footage, evidence frames, events and reports. */
export async function deleteClip(clip) {
  const incidents = await Incident.find({ clip: clip._id });
  await Promise.all(incidents.filter((i) => i.clipExportPath).map((i) => rm(i.clipExportPath, { force: true })));
  await Incident.deleteMany({ clip: clip._id });
  await Event.deleteMany({ clip: clip._id });
  await rm(clip.storedPath, { force: true });
  await rm(path.join(config.uploadDir, 'evidence', String(clip._id)), { recursive: true, force: true });
  await rm(path.join(config.uploadDir, 'annotated', `${clip._id}.mp4`), { force: true });
  await clip.deleteOne();
}

/**
 * Retention policy: footage older than RETENTION_DAYS (default 30, in line with
 * the Data Protection Commission's CCTV guidance) is deleted automatically.
 * Clips that back an incident report are kept, because the owner may need them
 * as evidence; deleting the report makes them eligible again.
 */
export async function runRetention({ days = config.retentionDays, now = Date.now() } = {}) {
  if (!days) return { deleted: 0, keptForIncidents: 0 };
  const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
  const old = await Clip.find({ createdAt: { $lt: cutoff }, status: { $nin: ['queued', 'processing'] } });
  let deleted = 0;
  let keptForIncidents = 0;
  for (const clip of old) {
    if (await Incident.exists({ clip: clip._id })) {
      keptForIncidents++;
      continue;
    }
    await deleteClip(clip);
    deleted++;
  }
  if (deleted) console.log(`[retention] deleted ${deleted} clip(s) older than ${days} days`);
  return { deleted, keptForIncidents };
}

export function scheduleRetention(everyMs = 6 * 60 * 60 * 1000) {
  const tick = () => runRetention().catch((err) => console.error('[retention]', err));
  tick();
  return setInterval(tick, everyMs).unref();
}
