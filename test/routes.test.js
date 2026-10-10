// HTTP-level tests with the Mongoose models stubbed, so no database is needed.
// They cover the paywall, upload validation, review rules and the Stripe webhook.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmp = mkdtempSync(path.join(tmpdir(), 'routes-'));
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.ZONES_FILE = path.join(tmp, 'no-zones.json');
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.OPENROUTER_API_KEY = '';

let base;
let server;
let M; // modules
const shop = {
  id: '64b000000000000000000001',
  _id: '64b000000000000000000001',
  name: 'Demo Corner Shop',
  subscriptionStatus: 'inactive',
  payments: [],
  save: async () => {},
  toPublic() { return { id: this.id, subscriptionStatus: this.subscriptionStatus, payments: this.payments }; },
};

before(async () => {
  const mongoose = (await import('mongoose')).default;
  mongoose.set('bufferCommands', false); // un-stubbed DB calls fail fast instead of hanging
  M = {
    app: await import('../src/app.js'),
    Shop: (await import('../src/models/Shop.js')).Shop,
    Clip: (await import('../src/models/Clip.js')).Clip,
    Event: (await import('../src/models/Event.js')).Event,
    Incident: (await import('../src/models/Incident.js')).Incident,
    StripeEvent: (await import('../src/models/StripeEvent.js')).StripeEvent,
    Stripe: (await import('stripe')).default,
  };
  mock.method(M.Shop, 'findById', async () => shop);
  mock.method(M.Shop, 'findOne', () => ({ sort: async () => shop, then: (r) => r(shop) }));

  server = M.app.createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
});

const uploadForm = (name, bytes) => {
  const form = new FormData();
  form.append('clip', new Blob([bytes]), name);
  return form;
};

test('health works without a database', async () => {
  const r = await fetch(`${base}/api/health`).then((x) => x.json());
  assert.equal(r.ok, true);
  assert.equal(r.detector, 'mock');
});

test('paywall: upload is blocked with 402 until subscribed', async () => {
  shop.subscriptionStatus = 'inactive';
  const res = await fetch(`${base}/api/clips`, { method: 'POST', body: uploadForm('a.mp4', 'x') });
  assert.equal(res.status, 402);
  assert.equal((await res.json()).code, 'SUBSCRIPTION_REQUIRED');
});

test('upload: wrong file type → 415', async () => {
  shop.subscriptionStatus = 'active';
  const res = await fetch(`${base}/api/clips`, { method: 'POST', body: uploadForm('notes.txt', 'hello') });
  assert.equal(res.status, 415);
  assert.match((await res.json()).error, /Upload a video file/);
});

test('upload: missing file → 400', async () => {
  const res = await fetch(`${base}/api/clips`, { method: 'POST', body: new FormData() });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'NO_FILE');
});

test('upload: corrupt video → 422 and the file is deleted', async () => {
  const res = await fetch(`${base}/api/clips`, { method: 'POST', body: uploadForm('broken.mp4', Buffer.alloc(4096, 7)) });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).code, 'UNREADABLE_VIDEO');
  assert.deepEqual(readdirSync(path.join(process.env.UPLOAD_DIR, 'clips')), []);
});

test('upload: bad zones JSON → 400', async () => {
  const form = uploadForm('a.mp4', 'x');
  form.append('zones', '{not json');
  const res = await fetch(`${base}/api/clips`, { method: 'POST', body: form });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'BAD_ZONES');
});

test('upload: valid video → 202 and processing starts', async () => {
  const video = path.join(tmp, 'ok.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=640x360:rate=25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  let created;
  const create = mock.method(M.Clip, 'create', async (doc) => {
    created = doc;
    return { ...doc, id: 'c1', toPublic: () => ({ id: 'c1', status: 'queued', durationSec: doc.durationSec }) };
  });
  const findById = mock.method(M.Clip, 'findById', async () => null); // background job finds nothing and exits

  const res = await fetch(`${base}/api/clips`, { method: 'POST', body: uploadForm('aisle cam.mp4', readFileSync(video)) });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.clip.status, 'queued');
  assert.ok(Math.abs(created.durationSec - 3) < 0.2);
  assert.equal(created.height, 360);
  assert.equal(created.originalName, 'aisle cam.mp4');
  create.mock.restore();
  await new Promise((r) => setTimeout(r, 50));
  findById.mock.restore();
});

test('review: confirming needs every checklist answer', async () => {
  const event = {
    id: 'e1', status: 'pending', checklist: {}, save: async () => {},
    toPublic() { return { id: 'e1', status: this.status, checklist: this.checklist }; },
  };
  const findOne = mock.method(M.Event, 'findOne', async () => event);
  const exists = mock.method(M.Incident, 'exists', async () => null);
  const id = '64b0000000000000000000e1';

  let res = await fetch(`${base}/api/events/${id}/review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'confirmed', checklist: { pickedUpItem: true } }),
  });
  assert.equal(res.status, 400);
  assert.deepEqual((await res.json()).details.missing, ['concealedItem', 'avoidedTill', 'leftShop']);

  res = await fetch(`${base}/api/events/${id}/review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'confirmed', checklist: { pickedUpItem: true, concealedItem: false, avoidedTill: true, leftShop: false } }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.event.status, 'confirmed');
  assert.equal(body.warnings.length, 1); // confirmed but "no" to concealing and leaving

  res = await fetch(`${base}/api/events/${id}/review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'maybe' }),
  });
  assert.equal(res.status, 400);
  findOne.mock.restore();
  exists.mock.restore();
});

test('stripe webhook: bad signature → 400', async () => {
  const res = await fetch(`${base}/api/billing/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=bad' }, body: '{}',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'BAD_SIGNATURE');
});

test('stripe webhook: signed invoice.paid activates the shop and records the payment once', async () => {
  shop.subscriptionStatus = 'inactive';
  shop.payments = [];
  const seen = new Set();
  const exists = mock.method(M.StripeEvent, 'exists', async ({ _id }) => (seen.has(_id) ? { _id } : null));
  const create = mock.method(M.StripeEvent, 'create', async ({ _id }) => seen.add(_id));

  const payload = JSON.stringify({
    id: 'evt_test_1', object: 'event', type: 'invoice.paid', created: 1760090000,
    data: { object: {
      id: 'in_test_1', object: 'invoice', customer: 'cus_test', amount_paid: 2900, currency: 'eur',
      parent: { subscription_details: { subscription: 'sub_test', metadata: { shopId: shop.id } } },
      lines: { data: [{ period: { end: 1762690000 } }] }, status_transitions: { paid_at: 1760090000 },
    } },
  });
  const stripe = new M.Stripe('sk_test_dummy');
  const send = () => fetch(`${base}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test_secret' }) },
    body: payload,
  }).then((r) => r.json());

  const first = await send();
  assert.equal(first.received, true);
  assert.equal(shop.subscriptionStatus, 'active');
  assert.equal(shop.stripeSubscriptionId, 'sub_test');
  assert.equal(shop.payments.length, 1);
  assert.equal(shop.payments[0].amount, 2900);

  const second = await send(); // Stripe retry of the same event
  assert.equal(second.duplicate, true);
  assert.equal(shop.payments.length, 1);
  exists.mock.restore();
  create.mock.restore();
});

test('unknown route → JSON 404', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, 'NOT_FOUND');
});
