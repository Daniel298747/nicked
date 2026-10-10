import { config } from '../config.js';
import { Shop } from '../models/Shop.js';
import { AppError } from '../utils/errors.js';

let demoShopId = null;

/**
 * The demo has a single shop, created on first use. No sign-up flow:
 * every request acts as that shop.
 */
export async function getDemoShop() {
  if (demoShopId) {
    const shop = await Shop.findById(demoShopId);
    if (shop) return shop;
  }
  let shop = await Shop.findOne().sort({ createdAt: 1 });
  if (!shop) shop = await Shop.create({ name: config.demoShopName });
  demoShopId = shop.id;
  return shop;
}

export async function loadShop(req, _res, next) {
  req.shop = await getDemoShop();
  next();
}

/** Blocks paid features until Stripe has confirmed a payment. */
export function requireActive(req, _res, next) {
  if (config.devBypassPaywall || req.shop?.subscriptionStatus === 'active') return next();
  throw new AppError(
    'An active subscription is needed to analyse footage. Subscribe on the pricing page to unlock it.',
    402,
    'SUBSCRIPTION_REQUIRED',
    { subscriptionStatus: req.shop?.subscriptionStatus },
  );
}
