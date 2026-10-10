/**
 * Clip timestamps are labelled to a tenth of a second ("00:42.5") so that
 * frames sampled at 2 fps each get a unique label the model can quote back.
 */
export function formatTime(seconds) {
  const tenths = Math.max(0, Math.round(Number(seconds) * 10));
  const h = Math.floor(tenths / 36000);
  const m = Math.floor((tenths % 36000) / 600);
  const secTenths = tenths % 600;
  const ss = `${String(Math.floor(secTenths / 10)).padStart(2, '0')}.${secTenths % 10}`;
  const mm = String(m).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Parses "42", "00:42", "00:42.5" or "1:02:03.4" into seconds. Returns NaN if invalid. */
export function parseTime(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : NaN;
  if (typeof value !== 'string') return NaN;
  const parts = value.trim().split(':');
  if (parts.length === 0 || parts.length > 3) return NaN;

  const last = parts.length - 1;
  const valid = parts.every((p, i) => (i === last ? /^\d+(\.\d+)?$/.test(p) : /^\d+$/.test(p)));
  if (!valid) return NaN;

  const nums = parts.map(Number);
  for (let i = 1; i < nums.length; i++) if (nums[i] >= 60) return NaN;
  return nums.reduce((total, n) => total * 60 + n, 0);
}
