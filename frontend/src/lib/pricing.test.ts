import { describe, expect, it } from 'vitest';
import { cameraLines, clampCameras, nextCameraPrice, quote } from './pricing';
import type { Plan } from '../data/types';

const plan = (cameras: number, extra: Partial<Plan> = {}): Plan => ({
  cameras,
  interval: 'month',
  addons: { always_on: 0, retention: false, location: 0 },
  ...extra,
});

describe('graduated camera pricing (offer spec examples)', () => {
  it.each([
    [1, 29],
    [2, 58],
    [4, 96],
    [8, 156],
  ])('%i cameras cost €%i a month', (cameras, total) => {
    expect(quote(plan(cameras)).total).toBe(total);
  });

  it('bills yearly as ten months: 4 cameras = €960 a year', () => {
    const q = quote(plan(4, { interval: 'year' }));
    expect(q.total).toBe(960);
    expect(q.saved).toBe(192);
  });

  it('splits lines by tier', () => {
    expect(cameraLines(5, 'month').map((l) => [l.qty, l.unit])).toEqual([
      [2, 29],
      [2, 19],
      [1, 15],
    ]);
  });
});

describe('add-ons', () => {
  it('prices 24/7 per camera, retention per shop, locations per extra location', () => {
    const q = quote(plan(4, { addons: { always_on: 2, retention: true, location: 1 } }));
    expect(q.addonTotal).toBe(2 * 16 + 5 + 19);
    expect(q.total).toBe(96 + 56);
  });

  it('never bills more 24/7 seats than cameras', () => {
    const q = quote(plan(2, { addons: { always_on: 5, retention: false, location: 0 } }));
    expect(q.lines.find((l) => l.key === 'always_on')?.qty).toBe(2);
  });
});

describe('helpers', () => {
  it('clamps the camera count to 1–50', () => {
    expect(clampCameras(0)).toBe(1);
    expect(clampCameras(51)).toBe(50);
    expect(clampCameras(Number.NaN)).toBe(1);
  });

  it('knows the price of the next camera', () => {
    expect(nextCameraPrice(1)).toBe(29);
    expect(nextCameraPrice(2)).toBe(19);
    expect(nextCameraPrice(4)).toBe(15);
  });
});
