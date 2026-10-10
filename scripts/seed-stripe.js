// Creates the Nicked offer in your Stripe SANDBOX: 4 Products and 8 Prices (monthly + yearly),
// found by lookup key. Safe to run more than once: existing Prices are left alone.
// Usage: npm run stripe:seed
import { getStripe } from '../src/services/stripe.js';
import { PRICE_DEFS, PRODUCT_INFO, formatEur } from '../src/services/pricing.js';

const stripe = getStripe();
const keys = Object.keys(PRICE_DEFS);
const existing = await stripe.prices.list({ lookup_keys: keys, active: true, limit: 20 });
const have = new Set(existing.data.map((p) => p.lookup_key));

// One Product per kind, found by metadata so re-runs reuse it.
const products = {};
for await (const p of stripe.products.list({ active: true, limit: 100 })) {
  if (p.metadata?.nicked_kind && !products[p.metadata.nicked_kind]) products[p.metadata.nicked_kind] = p;
}
for (const [kind, info] of Object.entries(PRODUCT_INFO)) {
  if (!products[kind]) {
    products[kind] = await stripe.products.create({ name: info.name, description: info.description, metadata: { nicked_kind: kind } });
    console.log(`Created product "${info.name}" (${products[kind].id})`);
  }
}

for (const [lookupKey, def] of Object.entries(PRICE_DEFS)) {
  if (have.has(lookupKey)) {
    console.log(`✓ ${lookupKey} already exists`);
    continue;
  }
  const base = {
    product: products[def.kind].id,
    currency: 'eur',
    lookup_key: lookupKey,
    recurring: { interval: def.interval },
    tax_behavior: 'exclusive',
    metadata: { nicked_kind: def.kind },
  };
  const price = def.tiers
    ? await stripe.prices.create({ ...base, billing_scheme: 'tiered', tiers_mode: 'graduated', tiers: def.tiers })
    : await stripe.prices.create({ ...base, unit_amount: def.unit_amount });
  const desc = def.tiers ? def.tiers.map((t) => `${t.up_to === 'inf' ? 'rest' : `≤${t.up_to}`} at ${formatEur(t.unit_amount)}`).join(', ') : formatEur(def.unit_amount);
  console.log(`Created ${lookupKey} (${price.id}): ${desc} per ${def.interval}`);
}
console.log('\nDone. Example: 4 cameras monthly = €96 (2 × €29 + 2 × €19).');
