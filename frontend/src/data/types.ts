// Shapes the screens render. Field names follow the draft API contract
// (GET /me, /cameras, /clips/:id, /events, /reports/:id) so wiring the real
// backend in later is a matter of swapping src/demo/store for API calls.

export type Interval = 'month' | 'year';

export interface Plan {
  cameras: number;
  interval: Interval;
  addons: {
    /** Number of cameras with 24/7 monitoring (never more than `cameras`). */
    always_on: number;
    retention: boolean;
    /** Extra locations beyond the first. */
    location: number;
  };
}

export type SubscriptionStatus = 'none' | 'pending' | 'active' | 'past_due' | 'canceled';

export interface Shop {
  id: string;
  name: string;
  ownerName: string;
  email: string;
  address: string;
  isFounding: boolean;
  freeScanUsed: boolean;
}

export interface Entitlements {
  camerasAllowed: number;
  camerasAlwaysOn: number;
  retentionDays: 30 | 90;
  locationsAllowed: number;
  planInterval: Interval;
}

export type SceneKind = 'aisle' | 'door' | 'till' | 'fridges';

export interface Camera {
  id: string;
  /** "CAM 02" */
  code: string;
  /** "Aisle 2" */
  name: string;
  scene: SceneKind;
  alwaysOn: boolean;
  active: boolean;
  usedSecondsToday: number;
}

export const DAILY_CAP_SECONDS = 12 * 3600;
export const ALWAYS_ON_CAP_SECONDS = 24 * 3600;
export const FREE_SCAN_MAX_SECONDS = 3600;

export type ClipStatus = 'queued' | 'analysing' | 'done' | 'failed';

export interface Clip {
  id: string;
  cameraId: string | null;
  fileName: string;
  sizeBytes: number;
  durationSeconds: number;
  /** Wall-clock time the footage starts, "14:31:25" */
  startClock: string;
  uploadedAt: string;
  status: ClipStatus;
  progress: number;
  eventIds: string[];
  isFreeScan: boolean;
  error?: { code: string; message: string };
  /** Live mode */
  videoUrl?: string;
  warnings?: string[];
}

export type EventStatus = 'needs_review' | 'unsure' | 'confirmed' | 'dismissed';

export interface Segment {
  start: number;
  end: number;
  confidence: number;
}

export interface Observation {
  at: number;
  text: string;
}

export type Answer = 'yes' | 'no' | 'cant_tell';

export interface Checklist {
  pickedUp: Answer | null;
  concealed: Answer | null;
  passedTill: Answer | null;
  leftShop: Answer | null;
}

export interface FlagEvent {
  id: string;
  clipId: string;
  cameraId: string;
  status: EventStatus;
  /** "Possible concealment, aisle 2" */
  title: string;
  /** One neutral line for the queue. */
  reason: string;
  confidence: number;
  recordedAt: string;
  startClock: string;
  clipDuration: number;
  segments: Segment[];
  observations: Observation[];
  notSeen: string[];
  /** Which animated stand-in footage to play (demo mode only). */
  script: ScriptParams;
  /** Real footage from the backend. When set, screens show this instead of the stand-in. */
  media?: EventMedia;
  checklist?: Checklist;
  decidedAt?: string;
  reportId?: string;
}

export interface EventMedia {
  videoUrl: string;
  /** YOLO's copy with boxes, track IDs and zones drawn on, if the detector sent one. */
  annotatedUrl: string | null;
  thumbnailUrl: string | null;
  /** Frames the AI cited, with their time in the clip. */
  evidence: Array<{ at: number; label: string; url: string }>;
  /** First look → close look, e.g. "unclear → yes" */
  passes: Array<{ kind: 'overview' | 'close_look'; verdict: string; confidence: number }>;
  aiVerdict: 'yes' | 'no' | 'unclear' | 'error' | null;
  flags: string[];
}

/** Parameters for the illustrated stand-in footage (see components/feed/script.ts). */
export interface ScriptParams {
  scene: SceneKind;
  side: 'left' | 'right';
  enter: number;
  reach: number;
  conceal: number;
  exit: number;
}

export interface Report {
  id: string;
  ref: string;
  eventId: string;
  createdAt: string;
  /** Live mode: the neutral description written from the facts, and downloads. */
  narrative?: string;
  markdownUrl?: string;
  clipUrl?: string;
  sharedWithGardai?: boolean;
  languageWarnings?: string[];
}
