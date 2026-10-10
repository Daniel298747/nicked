// Runs the real ffmpeg sampling and the real OpenRouter client code against a
// local mock of OpenRouter's chat completions endpoint. No network, no database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmp = mkdtempSync(path.join(tmpdir(), 'pipeline-'));
const video = path.join(tmp, 'aisle.mp4');
const replies = [];
const requests = [];
let server;
let mods;

before(async () => {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=40:size=1280x720:rate=25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);

  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      requests.push(JSON.parse(body));
      const next = replies.shift() || { status: 500, text: 'no reply queued' };
      if (next.status && next.status !== 200) {
        res.writeHead(next.status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: next.text, code: next.status } }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'gen-1', object: 'chat.completion', created: 1, model: 'mock/vision-1',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: next.text } }],
        usage: { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050, cost: 0.0012 },
      }));
    });
  });
  await new Promise((r) => server.listen(0, r));

  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
  process.env.MOCK_DETECTIONS_DIR = path.join(tmp, 'mock');
  mods = {
    verify: await import('../src/services/verify.js'),
    detector: await import('../src/services/detector.js'),
    openrouter: await import('../src/services/openrouter.js'),
  };
});

after(() => {
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
});

const candidate = { trackId: 4, startSec: 4, endSec: 37, startTime: '00:04.0', endTime: '00:37.0', shelfSeconds: 6.4 };
const imagesIn = (reqBody) => reqBody.messages[1].content.filter((p) => p.type === 'image_url');
const labelsIn = (reqBody) => reqBody.messages[1].content.filter((p) => p.type === 'text' && p.text.startsWith('Frame ')).map((p) => p.text.slice(6));

test('ordinary: frames are capped, labelled on the video timeline, and the verdict is parsed', async () => {
  replies.push({ text: '```json\n{"verdict":"yes","confidence":0.81,"reason":"Places item in jacket pocket at 00:12.2.","frames_referenced":["00:12.2","00:99.0"],"notes":""}\n```' });
  requests.length = 0;
  const r = await mods.verify.verifyCandidate({ videoPath: video, candidate, model: 'mock/vision-1' });

  const sent = requests[0];
  assert.equal(sent.model, 'mock/vision-1');
  assert.ok(imagesIn(sent).length <= 16, `sent ${imagesIn(sent).length} images`);
  assert.ok(imagesIn(sent).length >= 15);
  assert.ok(imagesIn(sent)[0].image_url.url.startsWith('data:image/jpeg;base64,'));
  assert.equal(labelsIn(sent)[0], '00:04.0'); // labels follow the original video, not the cut
  assert.deepEqual(sent.usage, { include: true });

  // "00:12.2" and "00:99.0" weren't among the frames sent, so the "yes" has no evidence and is downgraded.
  assert.ok(!labelsIn(sent).includes('00:12.2'));
  assert.equal(r.ai.verdict, 'unclear');
  assert.ok(r.flags.some((f) => f.includes('downgraded')));
  assert.equal(r.ai.framesSent, imagesIn(sent).length);
  assert.ok(r.usage.cost > 0);
});

test('ordinary: a "yes" citing a real frame stays "yes"; invented timestamps are flagged', async () => {
  requests.length = 0;
  // First do a dry run to learn the labels that will be sent
  replies.push({ text: '{"verdict":"no","confidence":0.7,"reason":"Puts item back at 00:06.","frames_referenced":[],"notes":""}' });
  await mods.verify.verifyCandidate({ videoPath: video, candidate, model: 'mock/vision-1' });
  const real = labelsIn(requests[0]);

  replies.push({ text: JSON.stringify({ verdict: 'yes', confidence: 0.81, reason: `Places item in pocket at ${real[3]}.`, frames_referenced: [real[3], '09:59.0'], notes: '' }) });
  const r = await mods.verify.verifyCandidate({ videoPath: video, candidate, model: 'mock/vision-1' });
  assert.equal(r.ai.verdict, 'yes');
  assert.equal(r.eventType, 'possible_concealment');
  assert.deepEqual(r.ai.framesReferenced, [real[3]]);
  assert.match(r.flags[0], /Ignored 1 timestamp/);
});

test('failure: malformed JSON triggers one corrective retry', async () => {
  requests.length = 0;
  replies.push({ text: 'I think they took something {verdict: yes' });
  replies.push({ text: '{"verdict":"unclear","confidence":0.3,"reason":"View blocked by shelf at 00:10.","frames_referenced":[],"notes":"Shelf blocks view"}' });
  const r = await mods.verify.verifyCandidate({ videoPath: video, candidate, model: 'mock/vision-1' });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].messages.at(-1).role, 'user');
  assert.match(requests[1].messages.at(-1).content, /not usable/);
  assert.equal(r.ai.verdict, 'unclear');
  assert.equal(r.usage.promptTokens, 2000); // both calls counted
});

test('failure: malformed JSON twice gives verdict "error" (candidate still reaches the owner)', async () => {
  replies.push({ text: 'nope' }, { text: '{"verdict":"perhaps"}' });
  const r = await mods.verify.verifyCandidate({ videoPath: video, candidate, model: 'mock/vision-1' });
  assert.equal(r.ai.verdict, 'error');
  assert.equal(r.eventType, 'ai_check_failed');
  assert.match(r.ai.error, /unusable JSON twice/);
});

test('failure: bad API key is thrown, described plainly, and marked fatal', async () => {
  replies.push({ status: 401, text: 'No auth credentials found' });
  await assert.rejects(
    () => mods.verify.verifyCandidate({ videoPath: video, candidate, model: 'mock/vision-1' }),
    (err) => {
      assert.equal(mods.openrouter.describeAiError(err), 'OpenRouter rejected the API key.');
      assert.equal(mods.openrouter.isFatalAiError(err), true);
      return true;
    },
  );
});

test('loaded words in the AI reason are flagged', async () => {
  requests.length = 0;
  replies.push({ text: '{"verdict":"no","confidence":0.6,"reason":"No theft visible; person is not a suspect.","frames_referenced":[],"notes":""}' });
  const r = await mods.verify.verifyCandidate({ videoPath: video, candidate, model: 'mock/vision-1' });
  assert.equal(r.ai.verdict, 'no');
  assert.ok(r.flags.some((f) => f.includes('theft')));
});

test('mock detector: fake candidate, or a detect.py events.json dropped into mock-detections/', async () => {
  const fake = await mods.detector.detectCandidates({ videoPath: video, originalName: 'aisle.mp4', durationSec: 40 });
  assert.equal(fake.mode, 'mock');
  assert.equal(fake.candidates.length, 1);
  assert.equal(fake.candidates[0].startSec, 12);

  mkdirSync(process.env.MOCK_DETECTIONS_DIR, { recursive: true });
  writeFileSync(path.join(process.env.MOCK_DETECTIONS_DIR, 'aisle.json'), JSON.stringify([
    { track_id: 4, start_time: 3, end_time: 45, shelf_seconds: 6.4, visited_till: false, rule: 'shelf -> no till -> exit' },
  ]));
  const fromFile = await mods.detector.detectCandidates({ videoPath: video, originalName: 'aisle.mp4', durationSec: 40 });
  assert.equal(fromFile.mode, 'mock-file');
  assert.equal(fromFile.candidates[0].endSec, 40); // clamped to the video
});

test('HTTP detector: clear error when the Python service is down', async () => {
  const { config } = await import('../src/config.js');
  config.detector.url = 'http://127.0.0.1:9';
  await assert.rejects(
    () => mods.detector.detectCandidates({ videoPath: video, originalName: 'aisle.mp4', durationSec: 40 }),
    /Can't reach the detector/,
  );
  config.detector.url = '';
});

test('incident narrative: loaded words trigger one rewrite', async () => {
  const report = await import('../src/services/report.js');
  requests.length = 0;
  replies.push({ text: 'The suspect picks up a bottle at 00:41.0 and the theft continues.' });
  replies.push({ text: 'The person picks up a bottle at 00:41.0 and places it in their jacket pocket.' });
  const r = await report.writeNarrative({ reference: 'INC-1' }, { model: 'mock/text-1' });
  assert.equal(requests.length, 2);
  assert.match(requests[1].messages.at(-1).content, /without these words: suspect, theft/);
  assert.equal(r.narrative, 'The person picks up a bottle at 00:41.0 and places it in their jacket pocket.');
  assert.deepEqual(r.languageWarnings, []);

  replies.push({ text: 'The thief leaves.' }, { text: 'The thief still leaves.' });
  const stubborn = await report.writeNarrative({ reference: 'INC-2' }, { model: 'mock/text-1' });
  assert.match(stubborn.languageWarnings[0], /Edit before sharing/);
});
