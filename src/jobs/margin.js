import { config } from '../config.js';
import { Shop } from '../models/Shop.js';
import { AiCall } from '../models/AiCall.js';

/**
 * Margin alert: flags any shop whose AI cost this month is above one third of
 * its monthly subscription value. Subscription value comes from what Stripe
 * actually charged (last payment; yearly plans divided by 12).
 */
export async function runMarginCheck({ now = new Date() } = {}) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const shops = await Shop.find({ subscriptionStatus: { $in: ['active', 'past_due'] } });
  const flagged = [];
  for (const shop of shops) {
    const last = shop.payments.at(-1);
    if (!last?.amount) continue;
    const monthlyEur = (shop.planInterval === 'year' ? last.amount / 12 : last.amount) / 100;
    const [row] = await AiCall.aggregate([
      { $match: { shop: shop._id, createdAt: { $gte: monthStart } } },
      { $group: { _id: null, usd: { $sum: '$costUsd' } } },
    ]);
    const aiCostEur = (row?.usd || 0) * config.plan.usdToEur;
    const isFlagged = aiCostEur > monthlyEur * config.plan.marginAlertShare;
    shop.marginAlert = {
      flagged: isFlagged,
      aiCostEur: +aiCostEur.toFixed(4),
      subscriptionValueEur: +monthlyEur.toFixed(2),
      checkedAt: now,
    };
    await shop.save();
    if (isFlagged) {
      flagged.push(shop.id);
      console.warn(`[margin] shop ${shop.id}: AI cost €${aiCostEur.toFixed(2)} this month is above a third of €${monthlyEur.toFixed(2)}`);
    }
  }
  return { checked: shops.length, flagged };
}
