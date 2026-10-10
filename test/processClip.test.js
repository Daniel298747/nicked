// The whole background job (detector → AI checks → events) with stubbed models
// and a mock OpenRouter server. No database or network needed.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmp = mkdtempSync(path.join(tmpdir(), 'job-'));
const video = path.join(tmp, 'shopfloor.mp4');
let server;
let mode = 'normal';
let M;

before(async () => {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=30:size=1280x720:rate=25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);

  // Mock OpenRouter: "yes" for the candidate starting at 00:02.0, "no" for anything else.
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (mode === 'badkey') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'No auth credentials found', code: 401 } }));
      }
      const first = JSON.parse(body).messages[1].content.find((p) => p.type === 'text' && p.text.startsWith('Frame ')).text.slice(6);
      const answer = first === '00:02.0'
        ? { verdict: 'yes', confidence: 0.84, reason: `Places item in jacket pocket at ${first}.`, frames_referenced: [first], notes: '' }
        : { verdict: 'no', confidence: 0.77, reason: 'Puts the item back and leaves empty-handed.', frames_referenced: [], notes: '' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'g', object: 'chat.completion', created: 1, model: 'mock/vision-1', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answer) } }], usage: { prompt_tokens: 900, completion_tokens: 40, cost: 0.001 } }));
    });
  });
  await new Promise((r) => server.listen(0, r));

  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
  process.env.MOCK_DETECTIONS_DIR = path.join(tmp, 'mock');
  mkdirSync(process.env.MOCK_DETECTIONS_DIR, { recursive: true });
  writeFileSync(path.join(process.env.MOCK_DETECTIONS_DIR, 'shopfloor.json'), JSON.stringify([
    { track_id: 4, start_time: 2, end_time: 14, shelf_seconds: 5.2, visited_till: false, rule: 'shelf -> no till -> exit' },
    { track_id: 9, start_time: 16, end_time: 29, shelf_seconds: 3.1, visited_till: false, rule: 'shelf -> no till -> exit' },
  ]));

  const mongoose = (await import('mongoose')).default;
  mongoose.set('bufferCommands', false);
  M = {
    job: await import('../src/jobs/processClip.js'),
    Clip: (await import('../src/models/Clip.js')).Clip,
    Event: (await import('../src/models/Event.js')).Event,
    Shop: (await import('../src/models/Shop.js')).Shop,
  };
});

after(() => {
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
});

function stubDb() {
  const clip = {
    id: 'c1', _id: 'c1', shop: 's1', storedPath: video, originalName: 'shopfloor.mp4', durationSec: 30, height: 720,
    zones: null, warnings: [], counts: {}, usage: {}, progress: {},
    async save() {},
  };
  const inserted = [];
  const stubs = [
    mock.method(M.Clip, 'findById', async () => clip),
    mock.method(M.Clip, 'updateOne', async (_q, update) => {
      if (update.status) Object.assign(clip, update);
      if (update.$inc) clip.progress.checked = (clip.progress.checked || 0) + 1;
    }),
    mock.method(M.Shop, 'findById', async () => ({ layoutNotes: 'Till bottom-right, door top-left.' })),
    mock.method(M.Event, 'find', () => ({ select: async () => [] })),
    mock.method(M.Event, 'deleteMany', async () => ({})),
    mock.method(M.Event, 'insertMany', async (docs) => inserted.push(...docs)),
  ];
  return { clip, inserted, restore: () => stubs.forEach((s) => s.mock.restore()) };
}

test('job: YOLO candidates → AI verdicts → events, with counts, cost and queue membership', async () => {
  mode = 'normal';
  const db = stubDb();
  await M.job.processClip('c1', { model: 'mock/vision-1' });
  const { clip, inserted } = db;
  db.restore();

  assert.equal(clip.status, 'done', clip.error);
  assert.equal(clip.stage, 'finished');
  assert.equal(clip.detector.mode, 'mock-file');
  assert.deepEqual(clip.counts, { candidates: 2, aiYes: 1, aiNo: 1, aiUnclear: 0, aiError: 0 });
  assert.equal(clip.progress.checked, 2);
  assert.ok(clip.usage.cost > 0);
  assert.ok(clip.warnings.some((w) => w.includes('mock detector')));

  const yes = inserted.find((e) => e.candidate.trackId === 4);
  const no = inserted.find((e) => e.candidate.trackId === 9);
  assert.equal(yes.ai.verdict, 'yes');
  assert.equal(yes.inQueue, true);
  assert.equal(yes.eventType, 'possible_concealment');
  assert.equal(yes.startTime, '00:02.0');
  assert.equal(no.ai.verdict, 'no');
  assert.equal(no.inQueue, false); // kept for the "false alarms removed" stat, hidden from the queue
});

test('job: a bad OpenRouter key stops AI checks early but candidates still reach the owner', async () => {
  mode = 'badkey';
  const db = stubDb();
  await M.job.processClip('c1', { model: 'mock/vision-1' });
  const { clip, inserted } = db;
  db.restore();

  assert.equal(clip.status, 'done');
  assert.equal(clip.counts.aiError, 2);
  assert.ok(inserted.every((e) => e.ai.verdict === 'error' && e.inQueue));
  assert.equal(inserted[0].ai.error, 'OpenRouter rejected the API key.');
  assert.ok(clip.warnings.some((w) => w.startsWith('AI checks stopped early')));
});
