import type { Camera, Clip, FlagEvent, Plan, Report, SceneKind, ScriptParams, Shop } from './types';

// Sample content for the front-end preview. All names are fictional.

export const SAMPLE_SHOP: Shop = {
  id: 'shop_byrnes',
  name: "Byrne's Foodstore",
  ownerName: 'Aoife Byrne',
  email: 'aoife@byrnesfoodstore.ie',
  address: '112 Phibsborough Road, Dublin 7, D07 X2Y4',
  isFounding: true,
  freeScanUsed: false,
};

export const DEFAULT_PLAN: Plan = {
  cameras: 4,
  interval: 'month',
  addons: { always_on: 0, retention: false, location: 0 },
};

const CAMERA_NAMES: Array<{ name: string; scene: SceneKind }> = [
  { name: 'Front door', scene: 'door' },
  { name: 'Aisle 2', scene: 'aisle' },
  { name: 'Off-licence', scene: 'fridges' },
  { name: 'Till', scene: 'till' },
  { name: 'Aisle 4', scene: 'aisle' },
  { name: 'Stockroom door', scene: 'door' },
  { name: 'Aisle 1', scene: 'aisle' },
  { name: 'Deli counter', scene: 'till' },
];

export function makeCameras(count: number, usage: number[] = []): Camera[] {
  return Array.from({ length: count }, (_, i) => {
    const preset = CAMERA_NAMES[i % CAMERA_NAMES.length];
    return {
      id: `cam_${String(i + 1).padStart(2, '0')}`,
      code: `CAM ${String(i + 1).padStart(2, '0')}`,
      name: i < CAMERA_NAMES.length ? preset.name : `Camera ${i + 1}`,
      scene: preset.scene,
      alwaysOn: false,
      active: true,
      usedSecondsToday: usage[i] ?? 0,
    };
  });
}

/** Today at hh:mm, as ISO, so "Today" labels stay true whenever the demo is opened. */
export function todayAt(clock: string, daysAgo = 0) {
  const [h, m, s = 0] = clock.split(':').map(Number);
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, s, 0);
  return d.toISOString();
}

// Event templates per scene: what the model saw, in plain, neutral words.
interface Template {
  title: string;
  reason: string;
  observations: (s: ScriptParams) => FlagEvent['observations'];
  notSeen: string[];
}

const TEMPLATES: Record<SceneKind, Template> = {
  aisle: {
    title: 'Possible concealment, aisle 2',
    reason: 'Item lifted from shelf, hand moves inside jacket, item not seen again.',
    observations: (s) => [
      { at: s.reach - 4, text: 'Person stops at the right-hand shelf, middle row.' },
      { at: s.reach, text: 'Right hand lifts a small item from the shelf.' },
      { at: s.conceal, text: 'Hand moves to the inside of the jacket. The item is no longer visible.' },
      { at: s.exit - 6, text: 'Person walks towards the till end of the aisle.' },
      { at: s.exit, text: 'Person leaves the frame. The item has not reappeared.' },
    ],
    notSeen: ['Item returned to the shelf', 'Item placed in a basket'],
  },
  fridges: {
    title: 'Possible concealment, off-licence',
    reason: 'Bottle taken from fridge, placed in a shoulder bag.',
    observations: (s) => [
      { at: s.reach - 3, text: 'Person opens the second fridge door.' },
      { at: s.reach, text: 'One bottle is lifted from the middle shelf.' },
      { at: s.conceal, text: 'Bottle is lowered into a shoulder bag and the bag is closed.' },
      { at: s.exit, text: 'Person leaves the off-licence area towards the front door.' },
    ],
    notSeen: ['Bottle carried in hand to the till', 'Bottle put back in the fridge'],
  },
  door: {
    title: 'Possibly left without paying, front door',
    reason: 'Person carrying an item leaves without stopping at the till.',
    observations: (s) => [
      { at: s.reach, text: 'Person walks from the shop floor towards the door, item in right hand.' },
      { at: s.conceal, text: 'Item moves under the left arm.' },
      { at: s.exit, text: 'Person exits. No stop at the till is visible on this camera.' },
    ],
    notSeen: ['A stop at the till (check CAM 04 for the same time)'],
  },
  till: {
    title: 'Possible concealment, till',
    reason: 'Item taken from the counter display while the till is unattended.',
    observations: (s) => [
      { at: s.reach - 2, text: 'Till is unattended. Person waits at the counter.' },
      { at: s.reach, text: 'Hand reaches into the counter display.' },
      { at: s.conceal, text: 'Hand goes to the coat pocket.' },
      { at: s.exit, text: 'Person leaves before staff return to the till.' },
    ],
    notSeen: ['Payment at the till'],
  },
};

interface EventSeed {
  id: string;
  camera: Camera;
  clipId: string;
  status: FlagEvent['status'];
  confidence: number;
  startClock: string;
  daysAgo?: number;
  duration: number;
  script: Omit<ScriptParams, 'scene'>;
  /** second segment confidence, lower: the "unsure" tail of the flag */
  tail?: number;
}

export function makeEvent(seed: EventSeed): FlagEvent {
  const script: ScriptParams = { scene: seed.camera.scene, ...seed.script };
  const t = TEMPLATES[script.scene];
  const flagStart = Math.max(0, script.reach - 4);
  const mid = script.conceal + 6;
  const segments =
    seed.tail != null
      ? [
          { start: flagStart, end: mid, confidence: seed.confidence },
          { start: mid, end: script.exit, confidence: seed.tail },
        ]
      : [{ start: flagStart, end: script.exit, confidence: seed.confidence }];
  return {
    id: seed.id,
    clipId: seed.clipId,
    cameraId: seed.camera.id,
    status: seed.status,
    title: t.title.replace('aisle 2', seed.camera.name.toLowerCase()),
    reason: t.reason,
    confidence: seed.confidence,
    recordedAt: todayAt(seed.startClock, seed.daysAgo ?? 0),
    startClock: seed.startClock,
    clipDuration: seed.duration,
    segments,
    observations: t.observations(script),
    notSeen: t.notSeen,
    script,
  };
}

/** A shop that has been using Nicked for a few weeks: the "busy shop" preset. */
export function busyShop() {
  const cameras = makeCameras(4, [7.5 * 3600, 4.2 * 3600, 11.9 * 3600, 12 * 3600]);
  const [door, aisle, offy, till] = cameras;
  const clips: Clip[] = [
    clip('clip_a1', aisle.id, 'CAM02_2026-10-10_1400.mp4', 'done', '14:31:25', 98),
    clip('clip_o1', offy.id, 'CAM03_2026-10-10_1130.mp4', 'done', '11:58:02', 84),
    clip('clip_d1', door.id, 'CAM01_2026-10-10_0900.mp4', 'done', '09:12:40', 72),
    clip('clip_t1', till.id, 'CAM04_2026-10-09_1700.mp4', 'done', '17:44:10', 80, 1),
  ];
  const events: FlagEvent[] = [
    makeEvent({ id: 'evt_7k2p', camera: aisle, clipId: 'clip_a1', status: 'needs_review', confidence: 0.87, tail: 0.64, startClock: '14:31:25', duration: 98, script: { side: 'right', enter: 20, reach: 46, conceal: 51, exit: 70 } }),
    makeEvent({ id: 'evt_3m9q', camera: offy, clipId: 'clip_o1', status: 'needs_review', confidence: 0.82, startClock: '11:58:02', duration: 84, script: { side: 'left', enter: 12, reach: 30, conceal: 37, exit: 55 } }),
    makeEvent({ id: 'evt_5x1c', camera: door, clipId: 'clip_d1', status: 'needs_review', confidence: 0.48, startClock: '09:12:40', duration: 72, script: { side: 'right', enter: 8, reach: 22, conceal: 30, exit: 41 } }),
    makeEvent({ id: 'evt_9d4h', camera: aisle, clipId: 'clip_a1', status: 'unsure', confidence: 0.56, startClock: '13:07:51', duration: 90, script: { side: 'left', enter: 14, reach: 38, conceal: 45, exit: 66 } }),
    makeEvent({ id: 'evt_2b8v', camera: till, clipId: 'clip_t1', status: 'confirmed', confidence: 0.91, tail: 0.74, startClock: '17:44:10', daysAgo: 1, duration: 80, script: { side: 'right', enter: 10, reach: 26, conceal: 31, exit: 48 } }),
    makeEvent({ id: 'evt_6r3n', camera: offy, clipId: 'clip_o1', status: 'dismissed', confidence: 0.52, startClock: '10:21:33', daysAgo: 1, duration: 76, script: { side: 'right', enter: 9, reach: 27, conceal: 33, exit: 50 } }),
    makeEvent({ id: 'evt_4t6w', camera: aisle, clipId: 'clip_a1', status: 'dismissed', confidence: 0.61, startClock: '16:02:18', daysAgo: 2, duration: 88, script: { side: 'right', enter: 15, reach: 34, conceal: 40, exit: 62 } }),
  ];
  const confirmed = events.find((e) => e.id === 'evt_2b8v')!;
  confirmed.checklist = { pickedUp: 'yes', concealed: 'yes', passedTill: 'yes', leftShop: 'yes' };
  confirmed.decidedAt = todayAt('18:02:44', 1);
  const report: Report = {
    id: 'rep_0141',
    ref: 'NCK-2026-0141',
    eventId: confirmed.id,
    createdAt: todayAt('18:03:10', 1),
  };
  confirmed.reportId = report.id;
  for (const id of ['evt_6r3n', 'evt_4t6w']) {
    const e = events.find((x) => x.id === id)!;
    e.decidedAt = todayAt('18:10:00', 1);
    e.checklist = { pickedUp: 'yes', concealed: 'no', passedTill: 'cant_tell', leftShop: 'yes' };
  }
  clips[0].eventIds = ['evt_7k2p', 'evt_9d4h', 'evt_4t6w'];
  clips[1].eventIds = ['evt_3m9q', 'evt_6r3n'];
  clips[2].eventIds = ['evt_5x1c'];
  clips[3].eventIds = ['evt_2b8v'];
  return { cameras, clips, events, reports: [report] };
}

function clip(
  id: string,
  cameraId: string,
  fileName: string,
  status: Clip['status'],
  startClock: string,
  durationSeconds: number,
  daysAgo = 0,
): Clip {
  return {
    id,
    cameraId,
    fileName,
    sizeBytes: Math.round(durationSeconds * 1.9e6),
    durationSeconds,
    startClock,
    uploadedAt: todayAt(startClock, daysAgo),
    status,
    progress: 100,
    eventIds: [],
    isFreeScan: false,
  };
}

/**
 * What an upload "finds" in the preview: three flags on the chosen camera,
 * spread through the clip. The real result comes from GET /clips/:id.
 */
export function eventsForUpload(camera: Camera, clipId: string, startClock: string, duration: number): FlagEvent[] {
  const span = Math.max(duration, 98);
  const at = (f: number) => Math.round(span * f);
  const seeds: Array<Pick<EventSeed, 'confidence' | 'tail' | 'script'>> = [
    { confidence: 0.87, tail: 0.64, script: { side: 'right', enter: at(0.2), reach: at(0.47), conceal: at(0.52), exit: at(0.71) } },
    { confidence: 0.74, script: { side: 'left', enter: at(0.15), reach: at(0.4), conceal: at(0.46), exit: at(0.66) } },
    { confidence: 0.48, script: { side: 'right', enter: at(0.1), reach: at(0.33), conceal: at(0.4), exit: at(0.58) } },
  ];
  const [h, m] = startClock.split(':').map(Number);
  return seeds.map((s, i) => {
    const clock = `${String(h).padStart(2, '0')}:${String((m + i * 14) % 60).padStart(2, '0')}:${String(10 + i * 7).padStart(2, '0')}`;
    return makeEvent({
      id: `evt_${clipId.slice(-4)}${i}`,
      camera,
      clipId,
      status: 'needs_review',
      startClock: clock,
      duration: span,
      ...s,
    });
  });
}
