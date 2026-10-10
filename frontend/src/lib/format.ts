const pad = (n: number) => String(Math.floor(n)).padStart(2, '0');

/** 42 → "00:42", 3723 → "1:02:03" */
export function timecode(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Wall-clock time of a moment inside a clip: ("14:31:25", 42) → "14:32:07" */
export function clockAt(startClock: string, offsetSeconds: number) {
  const [h, m, s] = startClock.split(':').map(Number);
  const total = (h * 3600 + m * 60 + s + Math.floor(offsetSeconds)) % 86400;
  return `${pad(total / 3600)}:${pad((total % 3600) / 60)}:${pad(total % 60)}`;
}

const euroFmt = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});
export const euro = (n: number) => euroFmt.format(n);

/** Seconds → hours with at most one decimal: 27000 → "7.5", 43200 → "12" */
export function hours(seconds: number) {
  const h = Math.round((seconds / 3600) * 10) / 10;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

export const pct = (confidence: number) => `${Math.round(confidence * 100)}%`;

export function fileSize(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

export function minutes(seconds: number) {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

const dayFmt = new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short' });
const longFmt = new Intl.DateTimeFormat('en-IE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-IE', { hour: '2-digit', minute: '2-digit', hour12: false });

export function dayLabel(iso: string, now = new Date()) {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return dayFmt.format(d);
}
export const longDate = (iso: string) => longFmt.format(new Date(iso));
export const clockTime = (iso: string) => timeFmt.format(new Date(iso));
