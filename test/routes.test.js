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
  freeScanUsed: true,
  set(k, v) { this[k] = v; },
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
    Camera: (await import('../src/models/Camera.js')).Camera,
  };
  // No cameras in these tests unless a test says otherwise
  mock.method(M.Camera, 'findOne', () => ({ sort: async () => null }));
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
  const founding = mock.method(M.Shop, 'countDocuments', async () => 3);

  const payload = JSON.stringify({
    id: 'evt_test_1', object: 'event', type: 'invoice.paid', created: 1760090000,
    data: { object: {
      id: 'in_test_1', object: 'invoice', customer: 'cus_test', amount_paid: 2900, currency: 'eur',
      parent: { subscription_details: { subscription: 'sub_test', metadata: { shop_id: shop.id } } },
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

  assert.equal(shop.isFounding, true); // 4th shop to pay
  assert.ok(shop.firstPaidAt instanceof Date);

  const second = await send(); // Stripe retry of the same event
  assert.equal(second.duplicate, true);
  assert.equal(shop.payments.length, 1);
  exists.mock.restore();
  create.mock.restore();
  founding.mock.restore();
});

test('unknown route → JSON 404', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, 'NOT_FOUND');
});


test('evidence: thumbnail and cited frames are served as images, with URLs in the event JSON', async () => {
  const { mkdirSync, copyFileSync } = await import('node:fs');
  const key = 'clip1/40-4-1';
  const dir = path.join(process.env.UPLOAD_DIR, 'evidence', key);
  mkdirSync(dir, { recursive: true });
  const jpg = path.join(tmp, 'f.jpg');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180', '-frames:v', '1', jpg]);
  copyFileSync(jpg, path.join(dir, 'close_look-00-45-5.jpg'));

  const doc = new M.Event({
    shop: shop._id, clip: '64b0000000000000000000c1', startSec: 4, endSec: 37,
    ai: { verdict: 'yes', confidence: 0.86, evidenceKey: key, thumbnail: 'close_look-00-45-5.jpg',
      evidence: [{ label: '00:45.5', file: 'close_look-00-45-5.jpg', cropped: true }],
      passes: [{ kind: 'overview', verdict: 'unclear' }, { kind: 'close_look', verdict: 'yes' }] },
  });
  const findOne = mock.method(M.Event, 'findOne', async () => doc);

  const pub = doc.toPublic();
  assert.equal(pub.ai.thumbnailUrl, `/api/events/${pub.id}/thumbnail`);
  assert.deepEqual(pub.ai.evidence, [{ label: '00:45.5', cropped: true, url: `/api/events/${pub.id}/evidence/0` }]);
  assert.equal(pub.ai.verdictChangedByCloseLook, true);
  assert.equal(pub.ai.evidenceKey, undefined); // internal paths never leave the server

  let res = await fetch(`${base}${pub.ai.thumbnailUrl}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /image\/jpeg/);
  res = await fetch(`${base}${pub.ai.evidence[0].url}`);
  assert.equal(res.status, 200);
  res = await fetch(`${base}/api/events/${pub.id}/evidence/5`);
  assert.equal(res.status, 404);
  findOne.mock.restore();
});

test('retention: footage past the shop retention period is deleted unless it backs a report', async () => {
  const { runRetention } = await import('../src/jobs/retention.js');
  const deleted = [];
  const cutoffs = [];
  const mk = (id) => ({ _id: id, storedPath: path.join(tmp, `${id}.mp4`), deleteOne: async () => deleted.push(id) });
  const stubs = [
    mock.method(M.Shop, 'find', () => ({ select: async () => [{ _id: 's30', retentionDays: 30 }, { _id: 's90', retentionDays: 90 }] })),
    mock.method(M.Clip, 'find', async (q) => {
      cutoffs.push([q.shop, Math.round((Date.now() - q.createdAt.$lt) / 86_400_000)]);
      return q.shop === 's30' ? [mk('old-with-report'), mk('old-plain')] : [];
    }),
    mock.method(M.Incident, 'exists', async ({ clip }) => (clip === 'old-with-report' ? { _id: 'i1' } : null)),
    mock.method(M.Incident, 'find', async () => []),
    mock.method(M.Incident, 'deleteMany', async () => ({})),
    mock.method(M.Event, 'deleteMany', async () => ({})),
  ];
  const r = await runRetention();
  assert.deepEqual(r, { deleted: 1, keptForIncidents: 1 });
  assert.deepEqual(deleted, ['old-plain']);
  assert.deepEqual(cutoffs, [['s30', 30], ['s90', 90]]); // 90 days with the retention add-on
  stubs.forEach((s) => s.mock.restore());
});

test('free scan: one clip up to an hour for a shop that never subscribed, then the paywall', async () => {
  const video = path.join(tmp, 'free.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x180:rate=25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  Object.assign(shop, { subscriptionStatus: 'inactive', freeScanUsed: false });
  const create = mock.method(M.Clip, 'create', async (doc) => ({ ...doc, id: 'c2', toPublic: () => ({ id: 'c2', freeScan: doc.freeScan }) }));
  const findById = mock.method(M.Clip, 'findById', async () => null);

  let res = await fetch(`${base}/api/clips`, { method: 'POST', body: uploadForm('free.mp4', readFileSync(video)) });
  assert.equal(res.status, 202);
  assert.equal((await res.json()).freeScan, true);
  assert.equal(shop.freeScanUsed, true);

  res = await fetch(`${base}/api/clips`, { method: 'POST', body: uploadForm('free.mp4', readFileSync(video)) });
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.code, 'SUBSCRIPTION_REQUIRED');
  assert.equal(body.details.freeScanAvailable, false);
  create.mock.restore();
  await new Promise((r) => setTimeout(r, 50));
  findById.mock.restore();
});

test('daily cap: a camera that used its 12 hours today gets a 429', async () => {
  const video = path.join(tmp, 'cap.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x180:rate=25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  shop.subscriptionStatus = 'active';
  const { UsageDaily } = await import('../src/models/UsageDaily.js');
  const camera = { _id: 'cam1', name: 'Camera 1', active: true, alwaysOn: false };
  M.Camera.findOne.mock.mockImplementation(() => ({ sort: async () => camera }));
  const usage = mock.method(UsageDaily, 'findOne', async () => ({ analysedSeconds: 43_200 }));

  const res = await fetch(`${base}/api/clips`, { method: 'POST', body: uploadForm('cap.mp4', readFileSync(video)) });
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.code, 'DAILY_CAP');
  assert.match(body.error, /Camera 1 has used its 12 hours/);
  assert.equal(body.details.usage.label, '12 of 12 hours today');
  usage.mock.restore();
  M.Camera.findOne.mock.mockImplementation(() => ({ sort: async () => null }));
});

test('cameras follow the plan: created on first payment, most recent paused on downgrade, revived on upgrade', async () => {
  const { syncCameras } = await import('../src/services/usage.js');
  const saved = [];
  const save = mock.method(M.Camera.prototype, 'save', async function () { saved.push(this); this.createdAt ??= new Date(Date.now() + saved.length); return this; });
  let existing = [];
  const find = mock.method(M.Camera, 'find', () => ({ sort: async () => existing }));
  const owner = { _id: '64b000000000000000000009', camerasAllowed: 4, camerasAlwaysOn: 1 };

  await syncCameras(owner);
  assert.deepEqual(saved.map((c) => c.name), ['Camera 1', 'Camera 2', 'Camera 3', 'Camera 4']);
  assert.deepEqual(saved.map((c) => c.alwaysOn), [true, false, false, false]);

  existing = saved.splice(0).map((c, i) => Object.assign(c, { createdAt: new Date(2026, 9, 10, 12, i) }));
  await syncCameras({ ...owner, camerasAllowed: 2, camerasAlwaysOn: 0 });
  assert.deepEqual(existing.map((c) => c.active), [true, true, false, false]); // most recently added paused
  assert.equal(existing[0].alwaysOn, false);

  await syncCameras({ ...owner, camerasAllowed: 3 });
  assert.deepEqual(existing.map((c) => c.active), [true, true, true, false]); // oldest paused one comes back first
  save.mock.restore();
  find.mock.restore();
});

test('stripe webhook: customer.subscription.updated sets the plan from its items (4 cameras, 24/7, 90 days)', async () => {
  Object.assign(shop, { subscriptionStatus: 'inactive', stripeSubscriptionId: undefined, camerasAllowed: 0 });
  const exists = mock.method(M.StripeEvent, 'exists', async () => null);
  const create = mock.method(M.StripeEvent, 'create', async () => ({}));
  const find = mock.method(M.Camera, 'find', () => ({ sort: async () => [] }));
  const save = mock.method(M.Camera.prototype, 'save', async function () { return this; });

  const payload = JSON.stringify({
    id: 'evt_sub_1', object: 'event', type: 'customer.subscription.updated', created: 1760090000,
    data: { object: {
      id: 'sub_new', object: 'subscription', status: 'active', customer: 'cus_test', metadata: { shop_id: shop.id },
      items: { data: [
        { id: 'si_1', quantity: 4, current_period_end: 1762690000, price: { lookup_key: 'camera_monthly', recurring: { interval: 'month' }, metadata: { nicked_kind: 'camera' } } },
        { id: 'si_2', quantity: 1, price: { lookup_key: 'always_on_monthly', metadata: { nicked_kind: 'always_on' } } },
        { id: 'si_3', quantity: 1, price: { lookup_key: 'retention_monthly', metadata: { nicked_kind: 'retention' } } },
      ] },
    } },
  });
  const stripe = new M.Stripe('sk_test_dummy');
  const res = await fetch(`${base}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test_secret' }) },
    body: payload,
  });
  assert.equal(res.status, 200);
  assert.equal(shop.subscriptionStatus, 'active');
  assert.equal(shop.stripeSubscriptionId, 'sub_new');
  assert.equal(shop.camerasAllowed, 4);
  assert.equal(shop.camerasAlwaysOn, 1);
  assert.equal(shop.retentionDays, 90);
  assert.equal(save.mock.callCount(), 4); // Camera 1–4 created
  [exists, create, find, save].forEach((m) => m.mock.restore());
});
