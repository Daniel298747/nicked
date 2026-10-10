import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { CHECKLIST_KEYS } from '../models/Event.js';
import { chat } from './openrouter.js';
import { findLoadedTerms } from './language.js';

export const CHECKLIST_LABELS = {
  pickedUpItem: 'Did the person pick up an item?',
  concealedItem: 'Did they conceal it (pocket, bag, under clothing)?',
  avoidedTill: 'Did they pass or avoid the till without paying?',
  leftShop: 'Did they leave the shop with it?',
};

const REPORT_SYSTEM_PROMPT = `You write the description section of a shop incident report that a shop owner may choose to give to the Gardaí (Irish police).

Write 80 to 150 words in plain, neutral, factual English:
- Use only the facts provided. Do not add details, motives or assumptions.
- Refer to "the person". Never identify anyone or describe their face, skin colour, ethnicity, age or gender. Clothing is fine if it is in the facts.
- Describe actions in time order with the timestamps given.
- Never use the words theft, steal, stole, stolen, thief, shoplifting, crime, criminal, suspect, suspicious, guilty or nicked.
- Say that the owner reviewed the footage and state their checklist answers.
- No headings, bullet points or sign-off. Plain paragraph text only.`;

/** Facts are assembled in code from the database, never by the model. */
export function buildFacts({ shop, clip, event, reference, now = new Date() }) {
  return {
    reference,
    shop: shop.name,
    generatedAt: now.toISOString(),
    video: clip.originalName,
    timeWindow: `${event.startTime} – ${event.endTime} (video time)`,
    tracker: {
      rule: event.candidate?.rule,
      trackId: event.candidate?.trackId,
      secondsAtShelf: event.candidate?.shelfSeconds,
      visitedTill: event.candidate?.visitedTill ?? false,
    },
    aiCheck: {
      verdict: event.ai?.verdict,
      confidence: event.ai?.confidence,
      observation: event.ai?.reason,
      framesCited: event.ai?.framesReferenced || [],
      model: event.ai?.model,
      closeLook: Boolean(event.ai?.closeLook),
      croppedToPerson: Boolean(event.ai?.cropped),
    },
    ownerReview: {
      decision: event.status,
      reviewedAt: event.reviewedAt?.toISOString?.() || null,
      checklist: Object.fromEntries(CHECKLIST_KEYS.map((k) => [CHECKLIST_LABELS[k], event.checklist?.[k] ? 'Yes' : 'No'])),
      note: event.reviewNote || '',
    },
  };
}

export function newReference(now = new Date()) {
  const d = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `INC-${d}-${randomBytes(2).toString('hex').toUpperCase()}`;
}

/** Writes the narrative with the text model; retries once if loaded terms slip in. */
export async function writeNarrative(facts, { model = config.openrouter.reportModel } = {}) {
  const messages = [
    { role: 'system', content: REPORT_SYSTEM_PROMPT },
    { role: 'user', content: `Facts (JSON):\n${JSON.stringify(facts, null, 2)}` },
  ];
  let reply = await chat({ model, messages, temperature: 0.2, maxTokens: 400 });
  let text = reply.text.trim();
  let loaded = findLoadedTerms(text);

  if (loaded.length) {
    reply = await chat({
      model,
      temperature: 0,
      maxTokens: 400,
      messages: [
        ...messages,
        { role: 'assistant', content: text },
        { role: 'user', content: `Rewrite it without these words: ${loaded.join(', ')}. Describe actions only.` },
      ],
    });
    text = reply.text.trim();
    loaded = findLoadedTerms(text);
  }

  if (!text) throw new Error('The report model returned an empty description.');
  return {
    narrative: text,
    model: reply.model,
    languageWarnings: loaded.length ? [`Contains loaded terms (${loaded.join(', ')}). Edit before sharing.`] : [],
  };
}

export function assembleMarkdown(facts, narrative) {
  const lines = [
    `# Incident report ${facts.reference}`,
    '',
    `**Shop:** ${facts.shop}  `,
    `**Generated:** ${facts.generatedAt}  `,
    `**Video:** ${facts.video}  `,
    `**Time window:** ${facts.timeWindow}`,
    '',
    '## Description',
    '',
    narrative,
    '',
    '## Owner review',
    '',
    '| Question | Answer |',
    '|---|---|',
    ...Object.entries(facts.ownerReview.checklist).map(([q, a]) => `| ${q} | ${a} |`),
    '',
    facts.ownerReview.note ? `**Owner's note:** ${facts.ownerReview.note}\n` : '',
    `Reviewed and confirmed by the shop owner${facts.ownerReview.reviewedAt ? ` on ${facts.ownerReview.reviewedAt}` : ''}.`,
    '',
    '## How this was flagged',
    '',
    `- **Tracker rule:** ${facts.tracker.rule || 'n/a'}${facts.tracker.secondsAtShelf != null ? ` (about ${facts.tracker.secondsAtShelf}s at the shelf, no till visit)` : ''}`,
    `- **AI check (${facts.aiCheck.model || 'n/a'}):** ${facts.aiCheck.verdict || 'n/a'}${facts.aiCheck.confidence != null ? `, confidence ${facts.aiCheck.confidence}` : ''}${facts.aiCheck.closeLook ? ` (overview, then a close-up${facts.aiCheck.croppedToPerson ? ' cropped to the person' : ''})` : ''}`,
    facts.aiCheck.framesCited.length ? `- **Frames cited:** ${facts.aiCheck.framesCited.join(', ')}` : '',
    '',
    '---',
    '',
    '_This report describes observed actions only. It does not identify any person or establish wrongdoing. It was drafted with AI assistance and reviewed by the shop owner, who decides whether to share it._',
  ];
  return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');
}
