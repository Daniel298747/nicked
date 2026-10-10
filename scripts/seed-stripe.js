// Creates the product and monthly price in your Stripe SANDBOX. Safe to run twice.
// Usage: npm run stripe:seed
import { config } from '../src/config.js';
import { getStripe } from '../src/services/stripe.js';

const AMOUNT = Number(process.env.PLAN_AMOUNT_CENTS || 2900); // €29.00
const CURRENCY = process.env.PLAN_CURRENCY || 'eur';

const stripe = getStripe();
const key = config.stripe.priceLookupKey;

const existing = await stripe.prices.list({ lookup_keys: [key], active: true, expand: ['data.product'], limit: 1 });
if (existing.data[0]) {
  const p = existing.data[0];
  console.log(`Price already exists: ${p.id} (${p.unit_amount / 100} ${p.currency.toUpperCase()}/${p.recurring?.interval}) on "${p.product.name}"`);
  process.exit(0);
}

const product = await stripe.products.create({
  name: `${config.appName} Shop Plan`,
  description: 'AI review of shop CCTV clips: flagged moments, AI checks, owner review and incident reports.',
});
const price = await stripe.prices.create({
  product: product.id,
  unit_amount: AMOUNT,
  currency: CURRENCY,
  recurring: { interval: 'month' },
  lookup_key: key,
  transfer_lookup_key: true,
});

console.log(`Created product ${product.id} and price ${price.id}: ${AMOUNT / 100} ${CURRENCY.toUpperCase()}/month (lookup key "${key}")`);
