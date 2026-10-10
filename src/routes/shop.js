import { Router } from 'express';
import { z } from 'zod';
import { loadShop } from '../middleware/shop.js';
import { AppError } from '../utils/errors.js';

const router = Router();
router.use(loadShop);

// GET /api/shop → the demo shop, including subscription status and payments
router.get('/', (req, res) => {
  res.json({ shop: req.shop.toPublic() });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(200).optional(),
  layoutNotes: z.string().trim().max(500).optional(),
});

// PATCH /api/shop { name?, email?, layoutNotes? }
router.patch('/', async (req, res) => {
  const parsed = patchSchema.safeParse(req.body || {});
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new AppError(`Invalid ${i.path.join('.')}: ${i.message}`, 400, 'VALIDATION');
  }
  Object.assign(req.shop, parsed.data);
  await req.shop.save();
  res.json({ shop: req.shop.toPublic() });
});

export default router;
