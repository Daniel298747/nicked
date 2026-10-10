import path from 'node:path';
import { rm } from 'node:fs/promises';
import { config } from '../config.js';
import { Clip } from '../models/Clip.js';
import { Event } from '../models/Event.js';
import { Incident } from '../models/Incident.js';
import { Shop } from '../models/Shop.js';
import { runMarginCheck } from './margin.js';

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
 * Retention clean-up (nightly): footage older than the shop's retention_days
 * (30, or 90 with the add-on) is deleted. Clips that back an incident report
 * are kept, because the owner may need them as evidence; deleting the report
 * makes them eligible again. RETENTION_DAYS=0 turns the job off.
 */
export async function runRetention({ now = Date.now() } = {}) {
  if (!config.retentionDays) return { deleted: 0, keptForIncidents: 0 };
  const shops = await Shop.find().select('retentionDays');
  let deleted = 0;
  let keptForIncidents = 0;
  for (const shop of shops) {
    const days = shop.retentionDays || config.retentionDays;
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
    const old = await Clip.find({ shop: shop._id, createdAt: { $lt: cutoff }, status: { $nin: ['queued', 'processing'] } });
    for (const clip of old) {
      if (await Incident.exists({ clip: clip._id })) {
        keptForIncidents++;
        continue;
      }
      await deleteClip(clip);
      deleted++;
    }
  }
  if (deleted) console.log(`[retention] deleted ${deleted} clip(s) past their retention period`);
  return { deleted, keptForIncidents };
}

/** Runs the retention and margin jobs now, then every few hours. */
export function scheduleJobs(everyMs = 6 * 60 * 60 * 1000) {
  const tick = async () => {
    await runRetention().catch((err) => console.error('[retention]', err));
    await runMarginCheck().catch((err) => console.error('[margin]', err));
  };
  tick();
  return setInterval(tick, everyMs).unref();
}
