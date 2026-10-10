// Puts the demo shop back to "never subscribed" so you can rehearse the pricing → pay → unlock demo.
// Cancels its Stripe SANDBOX subscription, resets entitlements and the free scan, removes cameras and usage.
// Clips, events and reports are kept. Usage: npm run shop:reset
import mongoose from 'mongoose';
import { connectDb } from '../src/db.js';
import { config } from '../src/config.js';
import { Shop } from '../src/models/Shop.js';
import { Camera } from '../src/models/Camera.js';
import { UsageDaily } from '../src/models/UsageDaily.js';
import { getStripe } from '../src/services/stripe.js';

await connectDb();
const shop = await Shop.findOne().sort({ createdAt: 1 });
if (!shop) {
  console.log('No shop yet. Start the server once to create it.');
  process.exit(0);
}

if (shop.stripeSubscriptionId && config.stripe.secretKey) {
  try {
    await getStripe().subscriptions.cancel(shop.stripeSubscriptionId);
    console.log(`Cancelled sandbox subscription ${shop.stripeSubscriptionId}`);
  } catch (err) {
    console.log(`Could not cancel ${shop.stripeSubscriptionId} (${err.message}). Continuing.`);
  }
}

for (const field of ['stripeSubscriptionId', 'currentPeriodEnd', 'activatedAt', 'graceUntil', 'firstPaidAt', 'marginAlert']) shop.set(field, undefined);
Object.assign(shop, {
  subscriptionStatus: 'inactive',
  planInterval: null,
  camerasAllowed: 0,
  camerasAlwaysOn: 0,
  retentionDays: 30,
  locationsAllowed: 1,
  isFounding: false,
  freeScanUsed: false,
  payments: [],
});
await shop.save();
const cams = await Camera.deleteMany({ shop: shop._id });
const usage = await UsageDaily.deleteMany({ shop: shop._id });
console.log(`Reset "${shop.name}": not subscribed, free scan available, ${cams.deletedCount} camera(s) and ${usage.deletedCount} usage row(s) removed.`);
await mongoose.disconnect();
