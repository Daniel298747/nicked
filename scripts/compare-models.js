// Runs the same YOLO candidates through several OpenRouter models and prints a table.
// This is the "Stay curious" model comparison slide.
//
// Usage:
//   npm run models:compare -- <video> <candidates.json> <modelA,modelB,...> [expected.json]
//
// candidates.json: detect.py output (array) or { events: [...] }
// expected.json (optional): { "<track_id>": "yes" | "no" | "unclear" }, your own labels for scoring
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { probeVideo } from '../src/services/ffmpeg.js';
import { normalizeDetectorResponse } from '../src/services/aiJson.js';
import { verifyCandidate } from '../src/services/verify.js';
import { describeAiError } from '../src/services/openrouter.js';

const [video, candidatesFile, modelList, expectedFile] = process.argv.slice(2);
if (!video || !candidatesFile || !modelList) {
  console.error('Usage: npm run models:compare -- <video> <candidates.json> <modelA,modelB> [expected.json]');
  process.exit(1);
}

const { durationSec } = await probeVideo(video);
const { candidates } = normalizeDetectorResponse(JSON.parse(await readFile(candidatesFile, 'utf8')), durationSec);
const expected = expectedFile ? JSON.parse(await readFile(expectedFile, 'utf8')) : {};
const models = modelList.split(',').map((m) => m.trim()).filter(Boolean);

const rows = [];
for (const model of models) {
  for (const c of candidates) {
    let r;
    try {
      r = await verifyCandidate({ videoPath: path.resolve(video), candidate: c, model });
    } catch (err) {
      r = { ai: { verdict: 'error', error: describeAiError(err) }, usage: { cost: 0 } };
    }
    const want = expected[String(c.trackId)];
    rows.push({
      model,
      track: c.trackId,
      window: `${c.startTime}-${c.endTime}`,
      verdict: r.ai.verdict,
      confidence: r.ai.confidence ?? '',
      correct: want ? (want === r.ai.verdict ? 'yes' : 'NO') : '',
      latencyMs: r.ai.latencyMs ?? '',
      costUsd: r.usage?.cost ? r.usage.cost.toFixed(5) : '',
      reason: r.ai.reason || r.ai.error || '',
    });
    console.log(`${model} | track ${c.trackId} → ${r.ai.verdict}${r.ai.confidence != null ? ` (${r.ai.confidence})` : ''}`);
  }
}

console.log('\nSummary');
for (const model of models) {
  const mine = rows.filter((r) => r.model === model);
  const scored = mine.filter((r) => r.correct);
  const right = scored.filter((r) => r.correct === 'yes').length;
  const avgMs = Math.round(mine.reduce((s, r) => s + (Number(r.latencyMs) || 0), 0) / (mine.length || 1));
  const cost = mine.reduce((s, r) => s + (Number(r.costUsd) || 0), 0);
  console.log(`${model.padEnd(45)} ${scored.length ? `${right}/${scored.length} correct` : 'no labels'} | avg ${avgMs} ms | $${cost.toFixed(4)}`);
}

const csv = [
  Object.keys(rows[0] || {}).join(','),
  ...rows.map((r) => Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')),
].join('\n');
await writeFile('model-comparison.csv', csv);
console.log('\nSaved model-comparison.csv');
