import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { sampleFrames } from './ffmpeg.js';
import { chat } from './openrouter.js';
import { parseModelJson, validateVerification } from './aiJson.js';
import { findLoadedTerms } from './language.js';

export const VERIFY_SYSTEM_PROMPT = `You check possible incidents flagged by an automated person tracker on CCTV from a small independent shop.

The tracker flags people who spent time at the shelves, never went to the till, and then reached the exit. Many of them simply browsed and left without buying, which is normal. Your job is to look at the frames and say whether you can actually SEE the tracked person conceal a product (put it in a pocket, a bag, or under clothing).

Answer with one verdict:
- "yes": you can see a product being concealed by the person.
- "no": you can see that they did not conceal anything (they put the item back, left empty-handed, carried items openly, or only handled their own phone, wallet, keys or bag).
- "unclear": the view is too dark, blurry, distant or blocked, several people overlap, or the action is ambiguous.

Rules:
- Prefer "unclear" over guessing. Use confidence below 0.5 when unsure.
- Describe actions only. Never describe faces, skin colour, ethnicity, age, gender or other personal traits. You may mention clothing to tell people apart.
- Never use the words theft, steal, thief, shoplifting, crime, suspect or suspicious. Use neutral wording such as "places the item in their jacket pocket".
- Only cite timestamps that appear in the frame labels you were given. Never invent timestamps.

Reply with ONLY this JSON object and nothing else:
{"verdict":"yes"|"no"|"unclear","confidence":0.0-1.0,"reason":"one sentence describing what happens, with timestamps","frames_referenced":["mm:ss.s", "..."],"notes":"camera or visibility issues, or empty string"}`;

const VERDICT_TO_TYPE = { yes: 'possible_concealment', no: 'no_concealment_seen', unclear: 'unclear_activity' };

/** Picks a frame rate so the candidate window never sends more than maxFrames images. */
export function frameRateFor(durationSec, { fps = config.verify.fps, maxFrames = config.verify.maxFrames } = {}) {
  if (durationSec <= 0) return fps;
  return Math.min(fps, maxFrames / durationSec);
}

export function buildVerifyMessages({ frames, candidate, layoutNotes }) {
  const facts = [
    `Tracked person: ${candidate.trackId != null ? `track ${candidate.trackId}` : 'one person'}.`,
    `Window: ${candidate.startTime} to ${candidate.endTime}.`,
    candidate.shelfSeconds != null ? `Tracker measured about ${candidate.shelfSeconds}s in the shelf zone.` : null,
    'Tracker saw no visit to the till before the exit.',
    layoutNotes ? `Shop layout from the owner: ${layoutNotes}` : null,
    `Valid frame labels: ${frames.map((f) => f.label).join(', ')}.`,
  ].filter(Boolean);

  return [
    { role: 'system', content: VERIFY_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: facts.join('\n') },
        ...frames.flatMap((f) => [
          { type: 'text', text: `Frame ${f.label}` },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${f.base64}` } },
        ]),
      ],
    },
  ];
}

/**
 * Samples frames for one YOLO candidate, asks the vision model whether
 * concealment is visible, and validates the answer. Bad JSON (twice) returns
 * verdict "error". API errors (timeout, bad key, no credits) are thrown so the
 * caller can stop early; the caller also turns them into verdict "error".
 */
export async function verifyCandidate({ videoPath, candidate, model, layoutNotes, workDir }) {
  const dir = path.join(workDir || path.join(config.uploadDir, 'frames'), randomUUID());
  const span = candidate.endSec - candidate.startSec;
  const fps = frameRateFor(span);
  const usage = { promptTokens: 0, completionTokens: 0, cost: 0 };
  const addUsage = (u) => {
    usage.promptTokens += u.promptTokens;
    usage.completionTokens += u.completionTokens;
    usage.cost += u.cost;
  };

  try {
    const frames = await sampleFrames(videoPath, dir, {
      fps,
      width: config.verify.frameWidth,
      startSec: candidate.startSec,
      durationSec: span,
    });
    if (!frames.length) {
      return { ai: { verdict: 'error', error: 'No frames could be read for this time window.', model, framesSent: 0 }, eventType: 'ai_check_failed', flags: [], usage };
    }
    for (const f of frames) f.base64 = (await readFile(f.path)).toString('base64');

    const messages = buildVerifyMessages({ frames, candidate, layoutNotes });
    const started = Date.now();
    let reply = await chat({ model, messages });
    addUsage(reply.usage);

    let result;
    try {
      result = validateVerification(parseModelJson(reply.text), frames);
    } catch (firstErr) {
      // One corrective retry for malformed or off-schema JSON.
      reply = await chat({
        model,
        messages: [
          ...messages,
          { role: 'assistant', content: reply.text || '(empty)' },
          { role: 'user', content: `That reply was not usable (${firstErr.message}). Reply again with ONLY the JSON object in the required format.` },
        ],
      });
      addUsage(reply.usage);
      try {
        result = validateVerification(parseModelJson(reply.text), frames);
      } catch (secondErr) {
        return {
          ai: { verdict: 'error', error: `The model returned unusable JSON twice (${secondErr.message}).`, model: reply.model, framesSent: frames.length, latencyMs: Date.now() - started },
          eventType: 'ai_check_failed',
          flags: [],
          usage,
        };
      }
    }

    const flags = [...result.flags];
    const loaded = findLoadedTerms(`${result.reason} ${result.notes}`);
    if (loaded.length) flags.push(`AI wording used loaded terms (${loaded.join(', ')}). The report generator rewrites these neutrally.`);

    return {
      ai: {
        verdict: result.verdict,
        confidence: result.confidence,
        reason: result.reason,
        framesReferenced: result.framesReferenced,
        notes: result.notes,
        model: reply.model,
        latencyMs: Date.now() - started,
        framesSent: frames.length,
      },
      eventType: VERDICT_TO_TYPE[result.verdict],
      flags,
      usage,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
