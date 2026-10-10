import type { ScriptParams, SceneKind, Segment } from '../../data/types';

// Positions the stand-in person over time. Coordinates are in the 640x360
// scene space. u = across the floor (-1 left, 1 right), d = depth (0 far, 1 near).

export const SCENE_W = 640;
export const SCENE_H = 360;

export interface ActorFrame {
  visible: boolean;
  x: number;
  y: number;
  /** figure height in px */
  h: number;
  walking: boolean;
  /** 0 = arm down, 1 = arm fully extended to the shelf */
  reach: number;
  /** -1 left, 1 right: the side the arm reaches to */
  armSide: -1 | 1;
  holding: boolean;
  /** hand pulled in to the jacket */
  tucked: number;
  opacity: number;
  /** box around the person, in scene px */
  box: { x: number; y: number; w: number; h: number };
}

interface Key {
  t: number;
  u: number;
  d: number;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp01 = (k: number) => Math.min(1, Math.max(0, k));
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

function project(scene: SceneKind, u: number, d: number) {
  if (scene === 'till') {
    // seen from behind the counter: shallower depth range
    const y = lerp(198, 262, d);
    const half = lerp(240, 330, d);
    return { x: 320 + u * half, y, h: lerp(120, 170, d) };
  }
  if (scene === 'door') {
    const y = lerp(214, 372, d);
    const half = lerp(60, 340, d);
    return { x: 320 + u * half, y, h: lerp(92, 230, d) };
  }
  const y = lerp(206, 372, d);
  const half = lerp(66, 330, d);
  return { x: 320 + u * half, y, h: lerp(62, 210, d) };
}

function path(s: ScriptParams): Key[] {
  const side = s.side === 'right' ? 1 : -1;
  const standAt = s.reach - 4;
  const leaveFrom = s.conceal + 4;
  switch (s.scene) {
    case 'door':
      return [
        { t: s.enter, u: side * 1.25, d: 0.78 },
        { t: standAt, u: side * 0.3, d: 0.5 },
        { t: leaveFrom, u: side * 0.1, d: 0.32 },
        { t: s.exit, u: 0, d: 0.02 },
      ];
    case 'till':
      return [
        { t: s.enter, u: 1.35, d: 0.3 },
        { t: standAt, u: -0.15, d: 0.35 },
        { t: leaveFrom, u: -0.18, d: 0.35 },
        { t: s.exit, u: -1.4, d: 0.3 },
      ];
    default:
      return [
        { t: s.enter, u: side * 0.05, d: 0.02 },
        { t: standAt, u: side * 0.5, d: 0.42 },
        { t: leaveFrom, u: side * 0.48, d: 0.45 },
        { t: s.exit, u: -side * 1.5, d: 0.92 },
      ];
  }
}

export function actorAt(s: ScriptParams, t: number): ActorFrame {
  const keys = path(s);
  const first = keys[0];
  const last = keys[keys.length - 1];
  const hidden: ActorFrame = {
    visible: false, x: 0, y: 0, h: 0, walking: false, reach: 0, armSide: 1,
    holding: false, tucked: 0, opacity: 0, box: { x: 0, y: 0, w: 0, h: 0 },
  };
  if (t < first.t || t > last.t) return hidden;

  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const k = clamp01((t - a.t) / Math.max(0.001, b.t - a.t));
  const moving = Math.abs(a.u - b.u) + Math.abs(a.d - b.d) > 0.05;
  const kk = moving ? ease(k) : k;
  const u = lerp(a.u, b.u, kk);
  const d = lerp(a.d, b.d, kk);
  const p = project(s.scene, u, d);

  const walking = moving && k > 0.02 && k < 0.98;
  const bob = walking ? -Math.abs(Math.sin(t * 5.5)) * p.h * 0.015 : 0;

  // Arm: out to the shelf at `reach`, back in to the jacket at `conceal`.
  const reachIn = clamp01((t - (s.reach - 1.2)) / 1.2);
  const reachOut = clamp01((t - (s.conceal - 1.5)) / 1.5);
  const reach = s.scene === 'door' ? 0.25 * (1 - reachOut) : reachIn * (1 - reachOut);
  const tucked = clamp01((t - (s.conceal - 1.5)) / 1.5) * (1 - clamp01((t - (s.conceal + 3)) / 1.5));
  const holding = t >= s.reach && t < s.conceal + 0.5;

  const fadeOut = s.scene === 'door' ? clamp01((s.exit - t) / 3) : 1;
  const fadeIn = s.scene === 'aisle' || s.scene === 'fridges' ? clamp01((t - s.enter) / 1.5) : 1;

  const armSide: -1 | 1 = s.scene === 'till' ? 1 : s.side === 'right' ? 1 : -1;
  const halfW = p.h * (0.17 + 0.2 * reach);
  const bx = armSide === 1 ? p.x - p.h * 0.17 : p.x - halfW;
  return {
    visible: true,
    x: p.x,
    y: p.y + bob,
    h: p.h,
    walking,
    reach,
    armSide,
    holding,
    tucked,
    opacity: Math.min(fadeOut, fadeIn),
    box: {
      x: bx - p.h * 0.05,
      y: p.y + bob - p.h * 1.03,
      w: halfW + p.h * 0.17 + p.h * 0.1,
      h: p.h * 1.06,
    },
  };
}

/** The segment covering time t, if any. */
export function segmentAt(segments: Segment[], t: number) {
  return segments.find((s) => t >= s.start && t <= s.end) ?? null;
}

/** A good still for thumbnails: mid-reach. */
export const keyMoment = (s: ScriptParams) => s.reach + 0.5;
