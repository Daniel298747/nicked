// Brand rules the API owns, so every screen words a flag the same way.
// Source: Nicked brand guidelines v1 (October 2026). "We flag. You decide."
//
// - Every flag starts Flagged. Only the owner moves it to Confirmed or Cleared,
//   and only Confirmed can become Reported to Gardaí.
// - Status is always a word, never colour alone. Cleared is blue, not green.
// - Titles say "possible"; nothing in the UI calls a person a thief.

export const REASSURANCE = 'Nothing goes to the Gardaí until you confirm.';

export const STATUSES = {
  flagged: { label: 'Flagged', fg: '#C23C0B', bg: '#FFEDE5' },
  confirmed: { label: 'Confirmed', fg: '#B42318', bg: '#FDECEA' },
  cleared: { label: 'Cleared', fg: '#1D5FD1', bg: '#E8F0FD' },
  reported: { label: 'Reported to Gardaí', fg: '#FFFFFF', bg: '#0E1F35' },
};

const TITLES = {
  possible_concealment: 'Possible concealment',
  unclear_activity: 'Worth a look',
  ai_check_failed: 'Needs a manual look',
  no_concealment_seen: 'No concealment seen',
};

/** Owner decision (+ whether the report was shared) → brand status key. */
export function statusKey(status, { reported = false } = {}) {
  if (status === 'confirmed') return reported ? 'reported' : 'confirmed';
  if (status === 'dismissed') return 'cleared';
  return 'flagged'; // pending and unsure both still need the owner
}

export function statusBadge(key) {
  return { key, ...STATUSES[key] };
}

const sentenceCase = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function clipLength(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Ready-to-render copy for an incident card:
 *   title "Possible concealment, aisle 3"
 *   meta  "AISLE 3 · 00:42.0 · 87% · 0:18 CLIP"  (JetBrains Mono overlay line)
 */
export function eventDisplay(event, { camera, reported = false } = {}) {
  const key = statusKey(event.status, { reported });
  const base = TITLES[event.eventType] || 'Worth a look';
  const title = camera?.name ? `${base}, ${sentenceCase(camera.name)}` : base;

  const meta = [];
  if (camera?.name) meta.push(camera.name.toUpperCase());
  if (event.startTime) meta.push(event.startTime);
  if (typeof event.ai?.confidence === 'number' && event.ai.verdict !== 'error') {
    meta.push(`${Math.round(event.ai.confidence * 100)}%`);
  }
  meta.push(`${clipLength(event.endSec - event.startSec)} CLIP`);

  return {
    status: statusBadge(key),
    title,
    meta: meta.join(' · '),
    // Keep the reassurance line while a flag is pending.
    reassurance: key === 'flagged' ? REASSURANCE : null,
    keptForLater: event.status === 'unsure',
  };
}

/** Empty review queue: "Quiet day. No flags since 9:14." */
export function emptyQueueMessage(lastFlagAt, timezone = 'Europe/Dublin', now = new Date()) {
  const day = (d) => d.toLocaleDateString('en-IE', { timeZone: timezone });
  if (!lastFlagAt || day(lastFlagAt) !== day(now)) return 'Quiet day. No flags yet today.';
  const time = lastFlagAt.toLocaleTimeString('en-IE', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
  return `Quiet day. No flags since ${time}.`;
}

/** Design tokens for the frontend (GET /api/brand). Dark theme values live in the online design system. */
export const BRAND = {
  name: 'nicked',
  tagline: 'We flag. You decide.',
  colours: {
    navy: '#0E1F35',
    signalOrange: '#FF541C',
    page: '#FFFFFF',
    sections: '#F3F5F8',
    inkMuted: '#556275',
    hairline: '#D9DEE6',
    controlBorder: '#7D8A9C',
    orangeText: '#C23C0B',
    cctvFeed: '#0B1524',
  },
  statuses: STATUSES,
  type: {
    sans: 'Plus Jakarta Sans',
    mono: 'JetBrains Mono',
    scale: {
      displayXl: [64, 800],
      display: [44, 800],
      stat: [48, 800],
      h1: [32, 700],
      h2: [24, 700],
      h3: [18, 700],
      bodyLg: [18, 400],
      body: [15, 400],
      label: [13, 600],
      caption: [12, 500],
    },
  },
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48, 16: 64 },
  radius: { sm: 'inputs, chips', md: 'cards, feed', lg: 'panels, modals', pill: 'buttons, badges' },
  focus: '2px solid #FF541C, 2px offset',
  copy: {
    reassurance: REASSURANCE,
    hero: 'Catch it before it walks out.',
  },
};
