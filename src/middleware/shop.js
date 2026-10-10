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
  if (!shop) shop = await Shop.create({ name: config.demoShopName, timezone: config.plan.defaultTimezone });
  demoShopId = shop.id;
  return shop;
}

export async function loadShop(req, _res, next) {
  req.shop = await getDemoShop();
  next();
}

/** Active, or inside the 3-day grace period after a failed payment. */
export function hasPaidAccess(shop, now = new Date()) {
  if (shop?.subscriptionStatus === 'active') return true;
  return shop?.subscriptionStatus === 'past_due' && Boolean(shop.graceUntil) && shop.graceUntil > now;
}

const subscriptionRequired = (shop) =>
  new AppError(
    shop?.subscriptionStatus === 'past_due'
      ? 'Your last payment failed and the grace period has ended. Update your card to keep analysing footage.'
      : 'An active subscription is needed to analyse footage. Subscribe on the pricing page to unlock it.',
    402,
    'SUBSCRIPTION_REQUIRED',
    { subscriptionStatus: shop?.subscriptionStatus, freeScanAvailable: shop?.subscriptionStatus === 'inactive' && !shop?.freeScanUsed },
  );

/** Blocks paid features until Stripe's webhooks say the shop has paid. */
export function requireActive(req, _res, next) {
  if (config.devBypassPaywall || hasPaidAccess(req.shop)) return next();
  throw subscriptionRequired(req.shop);
}

/**
 * Upload gate: paid shops, or one free first scan for shops that have never
 * subscribed. The clip length check (≤ 1 hour) happens after the upload is probed.
 */
export function requireAnalysisAccess(req, _res, next) {
  if (config.devBypassPaywall || hasPaidAccess(req.shop)) return next();
  if (req.shop?.subscriptionStatus === 'inactive' && !req.shop.freeScanUsed) {
    req.freeScan = true;
    return next();
  }
  throw subscriptionRequired(req.shop);
}
