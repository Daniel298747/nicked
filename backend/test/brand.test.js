import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventDisplay, emptyQueueMessage, statusKey, REASSURANCE } from '../src/services/brand.js';
import { normalizeDetectorResponse } from '../src/services/aiJson.js';
import { findLoadedTerms } from '../src/services/language.js';

const event = (over = {}) => ({
  status: 'pending',
  eventType: 'possible_concealment',
  startTime: '00:42.0',
  startSec: 42,
  endSec: 60,
  ai: { verdict: 'yes', confidence: 0.87 },
  ...over,
});

test('owner decisions map to the four brand statuses', () => {
  assert.equal(statusKey('pending'), 'flagged');
  assert.equal(statusKey('unsure'), 'flagged');
  assert.equal(statusKey('dismissed'), 'cleared');
  assert.equal(statusKey('confirmed'), 'confirmed');
  assert.equal(statusKey('confirmed', { reported: true }), 'reported');
  // Only Confirmed can become Reported
  assert.equal(statusKey('dismissed', { reported: true }), 'cleared');
});

test('incident card copy: possible, sentence case, mono meta, reassurance while pending', () => {
  const d = eventDisplay(event(), { camera: { name: 'Aisle 3' } });
  assert.equal(d.title, 'Possible concealment, aisle 3');
  assert.equal(d.meta, 'AISLE 3 · 00:42.0 · 87% · 0:18 CLIP');
  assert.equal(d.status.label, 'Flagged');
  assert.equal(d.reassurance, REASSURANCE);
  assert.deepEqual(findLoadedTerms(`${d.title} ${d.meta}`), []);
});

test('reviewed events drop the reassurance line; failed AI checks show no confidence', () => {
  const cleared = eventDisplay(event({ status: 'dismissed' }));
  assert.equal(cleared.status.label, 'Cleared');
  assert.equal(cleared.reassurance, null);
  const failed = eventDisplay(event({ eventType: 'ai_check_failed', ai: { verdict: 'error', confidence: 0 } }));
  assert.equal(failed.title, 'Needs a manual look');
  assert.ok(!failed.meta.includes('%'));
});

test('empty queue: "Quiet day. No flags since 9:14."', () => {
  const now = new Date('2026-10-10T15:00:00Z');
  assert.equal(emptyQueueMessage(new Date('2026-10-10T08:14:00Z'), 'Europe/Dublin', now), 'Quiet day. No flags since 9:14.');
  assert.equal(emptyQueueMessage(new Date('2026-10-08T08:14:00Z'), 'Europe/Dublin', now), 'Quiet day. No flags yet today.');
  assert.equal(emptyQueueMessage(null, 'Europe/Dublin', now), 'Quiet day. No flags yet today.');
});

test('detector pose hint is kept on the candidate', () => {
  const { candidates } = normalizeDetectorResponse(
    { events: [{ track_id: 2, start_time: 0, end_time: 12, hand_to_waist: true, hand_to_waist_at: 1.32 }] },
    12,
  );
  assert.equal(candidates[0].handToWaist, true);
  assert.equal(candidates[0].handToWaistSec, 1.32);
});
