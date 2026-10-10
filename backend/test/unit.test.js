import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, parseTime } from '../src/utils/time.js';
import { parseModelJson, validateVerification, normalizeDetectorResponse, zonesSchema } from '../src/services/aiJson.js';
import { findLoadedTerms } from '../src/services/language.js';
import { frameRateFor } from '../src/services/verify.js';
import { stripeEventPlan } from '../src/services/stripe.js';
import { graduatedAmount, quote, normalizeSelection, entitlementsFromSubscription, kindOf, PRICE_DEFS, lineItemsFor } from '../src/services/pricing.js';
import { localDate, usageLabel } from '../src/services/usage.js';
import { hasPaidAccess } from '../src/middleware/shop.js';
import { buildFacts, assembleMarkdown } from '../src/services/report.js';

const frames = [39, 41, 43, 45].map((s) => ({ seconds: s, label: formatTime(s) }));

test('formatTime / parseTime round-trip', () => {
  assert.equal(formatTime(42.5), '00:42.5');
  assert.equal(formatTime(0), '00:00.0');
  assert.equal(formatTime(3723.4), '1:02:03.4');
  assert.equal(formatTime(59.96), '01:00.0');
  assert.equal(parseTime('00:42'), 42);
  assert.equal(parseTime('01:10'), 70);
  assert.equal(parseTime('1:02:03.4'), 3723.4);
  assert.equal(parseTime(12), 12);
  assert.ok(Number.isNaN(parseTime('00:75')));
  assert.ok(Number.isNaN(parseTime('abc')));
  assert.ok(Number.isNaN(parseTime('')));
});

test('parseModelJson handles fences, prose and garbage', () => {
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('Sure! Here it is: {"a": {"b": 2}} Hope that helps.'), { a: { b: 2 } });
  assert.throws(() => parseModelJson('no json here'), /no JSON/);
  assert.throws(() => parseModelJson('{"a": 1,,}'), /not valid JSON/);
  assert.throws(() => parseModelJson(''), /Empty/);
});

test('validateVerification: ordinary yes with real frames', () => {
  const r = validateVerification(
    { verdict: 'YES', confidence: '0.82', reason: 'Places item in jacket pocket at 00:41.0.', frames_referenced: ['00:41.0', '00:43'] },
    frames,
  );
  assert.equal(r.verdict, 'yes');
  assert.equal(r.confidence, 0.82);
  assert.deepEqual(r.framesReferenced, ['00:41.0', '00:43.0']);
  assert.deepEqual(r.flags, []);
});

test('validateVerification: invented timestamps are dropped, evidence-free yes is downgraded', () => {
  const r = validateVerification(
    { verdict: 'yes', confidence: 0.9, reason: 'Pockets item.', frames_referenced: ['00:12.0', '02:00.0'] },
    frames,
  );
  assert.equal(r.verdict, 'unclear');
  assert.ok(r.confidence <= 0.4);
  assert.equal(r.flags.length, 2);
});

test('validateVerification: bad shapes throw so the caller retries', () => {
  assert.throws(() => validateVerification({ verdict: 'maybe', confidence: 0.5, reason: 'x' }, frames), /verdict/);
  assert.throws(() => validateVerification({ verdict: 'no', confidence: 1.7, reason: 'x' }, frames), /confidence/);
  assert.throws(() => validateVerification({ verdict: 'no', confidence: 0.5 }, frames), /reason/);
});

test('normalizeDetectorResponse: bare array, clamping, malformed events', () => {
  const r = normalizeDetectorResponse(
    [
      { track_id: 4, start_time: 39, end_time: 72, shelf_seconds: 6.4, visited_till: false, rule: 'shelf -> no till -> exit' },
      { track_id: 5, start_time: -2, end_time: 500 },
      { track_id: 6, start_time: 'soon' },
      { track_id: 7, start_time: 50, end_time: 50 },
    ],
    95.2,
  );
  assert.equal(r.candidates.length, 2);
  assert.equal(r.candidates[0].startTime, '00:39.0');
  assert.equal(r.candidates[1].startSec, 0);
  assert.equal(r.candidates[1].endSec, 95.2);
  assert.equal(r.warnings.length, 2);

  const wrapped = normalizeDetectorResponse({ fps: 25, frame_width: 1280, events: [] }, 10);
  assert.equal(wrapped.fps, 25);
  assert.equal(wrapped.frameWidth, 1280);
  assert.throws(() => normalizeDetectorResponse({ events: 'nope' }, 10));
});

test('zones validation', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.ok(zonesSchema.safeParse({ shelf: square, till: square, exit: square }).success);
  assert.ok(!zonesSchema.safeParse({ shelf: square, till: square }).success);
  assert.ok(!zonesSchema.safeParse({ shelf: [[0, 0]], till: square, exit: square }).success);
});

test('frameRateFor caps images per check', () => {
  assert.equal(frameRateFor(5, { fps: 2, maxFrames: 16 }), 2);
  assert.ok(Math.abs(frameRateFor(33, { fps: 2, maxFrames: 16 }) * 33 - 16) < 1e-9);
});

test('findLoadedTerms', () => {
  assert.deepEqual(findLoadedTerms('The person places the item in a bag.'), []);
  assert.deepEqual(findLoadedTerms('The suspect stole a bottle; clear theft.').sort(), ['stole', 'suspect', 'theft']);
  assert.deepEqual(findLoadedTerms('Got NICKED'), ['nicked']);
});

// ---------- Offer & Stripe ----------
const prices = Object.fromEntries(Object.entries(PRICE_DEFS).map(([k, d]) => [k, {
  lookup_key: k, currency: 'eur', recurring: { interval: d.interval }, metadata: { nicked_kind: d.kind },
  ...(d.tiers ? { billing_scheme: 'tiered', tiers: d.tiers.map((t) => ({ ...t, up_to: t.up_to === 'inf' ? null : t.up_to })) } : { unit_amount: d.unit_amount }),
}]));

test('graduated camera pricing matches the offer spec examples', () => {
  const m = prices.camera_monthly.tiers;
  assert.equal(graduatedAmount(m, 1), 2900);
  assert.equal(graduatedAmount(m, 2), 5800);
  assert.equal(graduatedAmount(m, 4), 9600); // €96
  assert.equal(graduatedAmount(m, 8), 15600); // €156
  assert.equal(graduatedAmount(prices.camera_yearly.tiers, 4), 96000); // €960 upfront
});

test('quote: cameras plus add-ons, only the ones chosen', () => {
  const q = quote(normalizeSelection({ cameras: 4, interval: 'month', addons: { always_on: 1, retention: true, extra_locations: 1 } }), prices);
  assert.deepEqual(q.lines.map((l) => [l.lookupKey, l.quantity, l.amount]), [
    ['camera_monthly', 4, 9600], ['always_on_monthly', 1, 1600], ['retention_monthly', 1, 500], ['location_monthly', 1, 1900],
  ]);
  assert.equal(q.total, 13600);
  assert.match(q.display, /136/);
  assert.deepEqual(lineItemsFor(normalizeSelection({ cameras: 2 })).map((l) => l.lookupKey), ['camera_monthly']);
  const yearly = quote(normalizeSelection({ cameras: 4, interval: 'year' }), prices);
  assert.equal(yearly.total, 96000);
});

test('selection validation', () => {
  assert.throws(() => normalizeSelection({ cameras: 0 }), /between 1 and 50/);
  assert.throws(() => normalizeSelection({ cameras: 2, addons: { always_on: 3 } }), /at most as many cameras/);
  assert.throws(() => normalizeSelection({ cameras: 2, interval: 'week' }), /interval/);
  assert.deepEqual(normalizeSelection({ cameras: '3', interval: 'yearly', retention: 'true' }), { cameras: 3, interval: 'year', alwaysOn: 0, retention: true, extraLocations: 0 });
});

test('entitlements are re-derived from subscription items (lookup key or metadata)', () => {
  const sub = {
    status: 'active',
    items: { data: [
      { quantity: 4, current_period_end: 1762690000, price: { lookup_key: 'camera_monthly', recurring: { interval: 'month' } } },
      { quantity: 6, price: { lookup_key: null, metadata: { nicked_kind: 'always_on' } } }, // old Founding price: key moved, metadata stays
      { quantity: 1, price: { lookup_key: 'retention_monthly' } },
      { quantity: 2, price: { lookup_key: 'location_monthly' } },
    ] },
  };
  const e = entitlementsFromSubscription(sub);
  assert.equal(e.camerasAllowed, 4);
  assert.equal(e.camerasAlwaysOn, 4); // capped at the camera count
  assert.equal(e.retentionDays, 90);
  assert.equal(e.locationsAllowed, 3);
  assert.equal(e.planInterval, 'month');
  assert.equal(e.subscriptionStatus, 'active');
  assert.ok(e.currentPeriodEnd instanceof Date);
  assert.equal(entitlementsFromSubscription({ status: 'incomplete', items: { data: [] } }).subscriptionStatus, undefined);
  assert.equal(kindOf({ lookup_key: 'location_yearly' }), 'location');
});

test('webhook plans: checkout links + fetches, invoice.paid activates, payment_failed starts grace', () => {
  const checkout = stripeEventPlan({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', client_reference_id: 'shop1', customer: 'cus_1', subscription: 'sub_1' } } });
  assert.equal(checkout.match.shopId, 'shop1');
  assert.equal(checkout.fetchSubscription, 'sub_1');
  assert.equal(checkout.set.stripeSubscriptionId, 'sub_1');

  const paid = stripeEventPlan({ type: 'invoice.paid', created: 1760000000, data: { object: { id: 'in_1', customer: 'cus_1', amount_paid: 9600, currency: 'eur', parent: { subscription_details: { subscription: 'sub_1', metadata: { shop_id: 'shop1' } } } } } });
  assert.equal(paid.set.subscriptionStatus, 'active');
  assert.equal(paid.set.graceUntil, null);
  assert.equal(paid.payment.amount, 9600);
  assert.equal(paid.match.shopId, 'shop1');
  assert.equal(paid.firstPayment, true);

  const failed = stripeEventPlan({ type: 'invoice.payment_failed', data: { object: { customer: 'cus_1', subscription: 'sub_1' } } });
  assert.equal(failed.grace, 'start');
  assert.equal(failed.set.subscriptionStatus, 'past_due');

  const deleted = stripeEventPlan({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', metadata: { shop_id: 'shop1' } } } });
  assert.equal(deleted.set.subscriptionStatus, 'canceled');
  assert.equal(deleted.onlyIfLinked, true);

  const updated = stripeEventPlan({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', items: { data: [] } } } });
  assert.ok(updated.syncSubscription);
  assert.equal(stripeEventPlan({ type: 'checkout.session.completed', data: { object: { mode: 'payment' } } }), null);
});

test('paid access: active, or past_due inside the grace period', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  assert.equal(hasPaidAccess({ subscriptionStatus: 'active' }, now), true);
  assert.equal(hasPaidAccess({ subscriptionStatus: 'past_due', graceUntil: new Date('2026-10-12T12:00:00Z') }, now), true);
  assert.equal(hasPaidAccess({ subscriptionStatus: 'past_due', graceUntil: new Date('2026-10-09T12:00:00Z') }, now), false);
  assert.equal(hasPaidAccess({ subscriptionStatus: 'canceled' }, now), false);
});

test('usage: shop-local dates and the usage bar label', () => {
  assert.equal(localDate('Europe/Dublin', new Date('2026-10-10T23:30:00Z')), '2026-10-11'); // already tomorrow in Dublin (IST)
  assert.equal(localDate('America/New_York', new Date('2026-10-10T23:30:00Z')), '2026-10-10');
  assert.equal(usageLabel(27000, 43200), '7.5 of 12 hours today');
  assert.equal(usageLabel(0, 86400), '0 of 24 hours today');
});

test('incident facts come from data, report has the checklist and disclaimer', () => {
  const facts = buildFacts({
    shop: { name: 'Demo Shop' },
    clip: { originalName: 'aisle.mp4' },
    event: {
      startTime: '00:39.0', endTime: '01:12.0', status: 'confirmed', reviewedAt: new Date('2026-10-10T12:00:00Z'), reviewNote: '',
      candidate: { rule: 'shelf -> no till -> exit', trackId: 4, shelfSeconds: 6.4, visitedTill: false },
      ai: { verdict: 'yes', confidence: 0.8, reason: 'Places item in pocket at 00:45.0.', framesReferenced: ['00:45.0'], model: 'x/y' },
      checklist: { pickedUpItem: true, concealedItem: true, avoidedTill: true, leftShop: false },
    },
    reference: 'INC-20261010-ABCD',
  });
  assert.equal(facts.ownerReview.checklist['Did they leave the shop with it?'], 'No');
  const md = assembleMarkdown(facts, 'The person picks up an item.');
  assert.match(md, /# Incident report INC-20261010-ABCD/);
  assert.match(md, /\| Did they conceal it \(pocket, bag, under clothing\)\? \| Yes \|/);
  assert.match(md, /does not identify any person/);
});

// ---------- Close-up helpers ----------
import { pickFocus, closeLookWindow, shouldLookCloser } from '../src/services/verify.js';
import { cropRect, boxAt } from '../src/services/crop.js';

const cand = { startSec: 10, endSec: 40, shelfSeconds: 6 };
const opts = { closeLook: true, trustNoAbove: 0.7, closeLookSeconds: 5, closeLookFps: 3 };

test('shouldLookCloser: trusts confident "no", looks closer at yes/unclear/weak no', () => {
  assert.equal(shouldLookCloser({ verdict: 'no', confidence: 0.9, framesSent: 16 }, cand, opts), false);
  assert.equal(shouldLookCloser({ verdict: 'no', confidence: 0.5, framesSent: 16 }, cand, opts), true);
  assert.equal(shouldLookCloser({ verdict: 'yes', confidence: 0.9, framesSent: 16 }, cand, opts), true);
  assert.equal(shouldLookCloser({ verdict: 'unclear', confidence: 0.3, framesSent: 16 }, cand, opts), true);
  assert.equal(shouldLookCloser({ verdict: 'error', framesSent: 16 }, cand, opts), false);
  assert.equal(shouldLookCloser({ verdict: 'yes', confidence: 0.9, framesSent: 16 }, cand, { ...opts, closeLook: false }), false);
  // a 4 s window already sent at ≥3 fps gains nothing from a close-up, unless there are boxes to crop to
  const short = { startSec: 0, endSec: 4 };
  assert.equal(shouldLookCloser({ verdict: 'unclear', confidence: 0.4, framesSent: 16 }, short, opts), false);
  assert.equal(shouldLookCloser({ verdict: 'unclear', confidence: 0.4, framesSent: 16 }, { ...short, boxes: [{ t: 1, box: [0, 0, 1, 1] }] }, opts), true);
});

test('pickFocus: cited frames first, then the middle of the shelf visit', () => {
  assert.equal(pickFocus({ framesReferenced: ['00:31.0', '00:25.0', '00:28.0'] }, cand, 3), 28);
  assert.equal(pickFocus({ framesReferenced: [] }, cand, 3), 10 + 3 + 3);
  assert.equal(pickFocus({ framesReferenced: [] }, { startSec: 10, endSec: 40 }, 3), 25);
  assert.equal(pickFocus({ framesReferenced: ['09:00.0'] }, cand, 3), 40); // clamped
});

test('closeLookWindow stays inside the candidate', () => {
  assert.deepEqual(closeLookWindow(28, cand, 5), { start: 25.5, end: 30.5 });
  assert.deepEqual(closeLookWindow(11, cand, 5), { start: 10, end: 15 });
  assert.deepEqual(closeLookWindow(39.5, cand, 5), { start: 35, end: 40 });
  assert.deepEqual(closeLookWindow(12, { startSec: 10, endSec: 13 }, 5), { start: 10, end: 13 });
});

test('cropRect pads the person box and clamps to the frame', () => {
  assert.deepEqual(cropRect([200, 100, 400, 500], 1280, 720), { left: 130, top: 0, width: 340, height: 680 });
  const edge = cropRect([1200, 600, 1280, 720], 1280, 720);
  assert.ok(edge.left + edge.width <= 1280 && edge.top + edge.height <= 720);
  assert.ok(edge.width >= 224 && edge.height >= 224); // minimum size
  assert.equal(cropRect([2000, 2000, 2100, 2100], 1280, 720), null);
  assert.deepEqual(cropRect([100, 50, 200, 250], 1280, 720, { scale: 2 }).width, 340); // detector ran at half resolution
});

test('boxAt picks the nearest box within a second', () => {
  const boxes = [{ t: 1, box: [1, 1, 2, 2] }, { t: 5, box: [5, 5, 6, 6] }];
  assert.deepEqual(boxAt(boxes, 4.6), [5, 5, 6, 6]);
  assert.equal(boxAt(boxes, 3), null);
});

test('detector boxes and annotated video path are normalised', () => {
  const r = normalizeDetectorResponse({
    annotated_video_path: '/tmp/out_annotated.mp4',
    events: [{ track_id: 4, start_time: 1, end_time: 9, boxes: [{ t: 2, xyxy: [10, 10, 50, 90] }, { t: 1, box: [0, 0, 40, 80] }, { t: 3, box: [50, 50, 10, 10] }, 'junk'] }],
  }, 10);
  assert.equal(r.annotatedVideoPath, '/tmp/out_annotated.mp4');
  assert.deepEqual(r.candidates[0].boxes, [{ t: 1, box: [0, 0, 40, 80] }, { t: 2, box: [10, 10, 50, 90] }]);
});
