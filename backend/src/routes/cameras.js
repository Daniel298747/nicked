import { Router } from 'express';
import { z } from 'zod';
import { loadShop } from '../middleware/shop.js';
import { Camera } from '../models/Camera.js';
import { usageToday } from '../services/usage.js';
import { AppError, notFound } from '../utils/errors.js';

const router = Router();
router.use(loadShop);

const limits = (shop) => ({
  camerasAllowed: shop.camerasAllowed,
  camerasAlwaysOn: shop.camerasAlwaysOn,
  locationsAllowed: shop.locationsAllowed,
});

// GET /api/cameras → cameras with today's usage bar ("7.5 of 12 hours today")
router.get('/', async (req, res) => {
  const cameras = await Camera.find({ shop: req.shop._id }).sort({ createdAt: 1 });
  const rows = await Promise.all(
    cameras.map(async (c) => ({ ...c.toPublic(), usage: await usageToday(c, req.shop.timezone) })),
  );
  const active = rows.filter((c) => c.active).length;
  res.json({
    cameras: rows,
    activeCameras: active,
    summary: `${active} camera${active === 1 ? '' : 's'} active`,
    limits: limits(req.shop),
  });
});

async function checkLocations(shop, locationName, excludeId) {
  const others = await Camera.find({ shop: shop._id, active: true, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).select('locationName');
  const locations = new Set(others.map((c) => c.locationName || 'Main shop'));
  locations.add(locationName || 'Main shop');
  if (locations.size > shop.locationsAllowed) {
    throw new AppError(
      `Your plan covers ${shop.locationsAllowed} location${shop.locationsAllowed === 1 ? '' : 's'}. Add the multi-location add-on to use another.`,
      402,
      'LOCATION_LIMIT',
    );
  }
}

// POST /api/cameras { name, locationName?, alwaysOn? } → only within cameras_allowed.
// At the limit, the frontend's "Add a camera" calls POST /api/billing/cameras instead.
router.post('/', async (req, res) => {
  const parsed = z
    .object({ name: z.string().trim().min(1).max(80), locationName: z.string().trim().max(80).optional(), alwaysOn: z.boolean().optional() })
    .safeParse(req.body || {});
  if (!parsed.success) throw new AppError('Send { "name": "...", "locationName"?: "...", "alwaysOn"?: true }.', 400, 'VALIDATION');
  const active = await Camera.countDocuments({ shop: req.shop._id, active: true });
  if (active >= req.shop.camerasAllowed) {
    throw new AppError(
      `Your plan covers ${req.shop.camerasAllowed} camera${req.shop.camerasAllowed === 1 ? '' : 's'}. Use "Add a camera" to add one to your subscription.`,
      402,
      'CAMERA_LIMIT',
      { next: 'POST /api/billing/cameras', cameras: req.shop.camerasAllowed + 1 },
    );
  }
  await checkLocations(req.shop, parsed.data.locationName);
  if (parsed.data.alwaysOn) {
    const on = await Camera.countDocuments({ shop: req.shop._id, active: true, alwaysOn: true });
    if (on >= req.shop.camerasAlwaysOn) throw new AppError('No 24/7 slots left. Add 24/7 monitoring for another camera.', 402, 'ALWAYS_ON_LIMIT');
  }
  const camera = await Camera.create({ shop: req.shop._id, ...parsed.data });
  res.status(201).json({ camera: camera.toPublic() });
});

// PATCH /api/cameras/:id { name?, locationName?, alwaysOn? }
router.patch('/:id', async (req, res) => {
  const parsed = z
    .object({ name: z.string().trim().min(1).max(80).optional(), locationName: z.string().trim().max(80).optional(), alwaysOn: z.boolean().optional() })
    .safeParse(req.body || {});
  if (!parsed.success) throw new AppError('Send any of { name, locationName, alwaysOn }.', 400, 'VALIDATION');
  const camera = await Camera.findOne({ _id: req.params.id, shop: req.shop._id });
  if (!camera) throw notFound('Camera');
  if (parsed.data.locationName !== undefined) await checkLocations(req.shop, parsed.data.locationName, camera._id);
  if (parsed.data.alwaysOn && !camera.alwaysOn) {
    if (!camera.active) throw new AppError('This camera is paused.', 409, 'CAMERA_PAUSED');
    const on = await Camera.countDocuments({ shop: req.shop._id, active: true, alwaysOn: true });
    if (on >= req.shop.camerasAlwaysOn) throw new AppError('No 24/7 slots left. Add 24/7 monitoring for another camera.', 402, 'ALWAYS_ON_LIMIT');
  }
  Object.assign(camera, parsed.data);
  await camera.save();
  res.json({ camera: camera.toPublic(), usage: await usageToday(camera, req.shop.timezone) });
});

export default router;
