import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, parseTime } from '../src/utils/time.js';
import { parseModelJson, validateVerification, normalizeDetectorResponse, zonesSchema } from '../src/services/aiJson.js';
import { findLoadedTerms } from '../src/services/language.js';
import { frameRateFor } from '../src/services/verify.js';
import { shopUpdateFromStripeEvent } from '../src/services/stripe.js';
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

test('Stripe: checkout.session.completed activates the shop by metadata', () => {
  const u = shopUpdateFromStripeEvent({
    type: 'checkout.session.completed',
    data: { object: { mode: 'subscription', payment_status: 'paid', metadata: { shopId: 'abc' }, customer: 'cus_1', subscription: 'sub_1', customer_details: { email: 'Owner@Shop.ie' } } },
  });
  assert.equal(u.match.shopId, 'abc');
  assert.equal(u.set.subscriptionStatus, 'active');
  assert.equal(u.set.stripeSubscriptionId, 'sub_1');
  assert.equal(u.activate, true);
  assert.equal(shopUpdateFromStripeEvent({ type: 'checkout.session.completed', data: { object: { mode: 'payment' } } }), null);
});

test('Stripe: invoice.paid records a payment (new and old API shapes)', () => {
  const newer = shopUpdateFromStripeEvent({
    type: 'invoice.paid',
    created: 1760000000,
    data: { object: { id: 'in_1', customer: 'cus_1', amount_paid: 2900, currency: 'eur', parent: { subscription_details: { subscription: 'sub_1', metadata: { shopId: 'abc' } } }, lines: { data: [{ period: { end: 1762600000 } }] }, status_transitions: { paid_at: 1760000001 } } },
  });
  assert.equal(newer.match.shopId, 'abc');
  assert.equal(newer.match.subscriptionId, 'sub_1');
  assert.equal(newer.payment.amount, 2900);
  assert.equal(newer.set.subscriptionStatus, 'active');
  assert.ok(newer.set.currentPeriodEnd instanceof Date);

  const older = shopUpdateFromStripeEvent({
    type: 'invoice.paid',
    data: { object: { id: 'in_2', customer: 'cus_1', subscription: 'sub_9', amount_paid: 2900, currency: 'eur' } },
  });
  assert.equal(older.match.subscriptionId, 'sub_9');
});

test('Stripe: subscription events map statuses and never downgrade to inactive', () => {
  const del = shopUpdateFromStripeEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled', customer: 'cus_1' } } });
  assert.equal(del.set.subscriptionStatus, 'canceled');
  const incomplete = shopUpdateFromStripeEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'incomplete', customer: 'cus_1' } } });
  assert.equal(incomplete.set.subscriptionStatus, undefined);
  const pastDue = shopUpdateFromStripeEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'past_due', items: { data: [{ current_period_end: 1762600000 }] } } } });
  assert.equal(pastDue.set.subscriptionStatus, 'past_due');
  assert.ok(pastDue.set.currentPeriodEnd instanceof Date);
  assert.equal(shopUpdateFromStripeEvent({ type: 'charge.refunded', data: { object: {} } }), null);
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
