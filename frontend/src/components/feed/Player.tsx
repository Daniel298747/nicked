import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Crosshair, Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import type { FlagEvent, Observation, Segment } from '../../data/types';
import { clockAt, pct, timecode } from '../../lib/format';
import { cn } from '../../lib/hooks';
import { FeedFrame } from './FeedFrame';
import { Scene } from './Scene';
import { actorAt, segmentAt } from './script';

export const HIGH_CONFIDENCE = 0.7;

export interface PlayerState {
  t: number;
  playing: boolean;
  rate: number;
  duration: number;
  toggle: () => void;
  pause: () => void;
  seek: (t: number) => void;
  setRate: (r: number) => void;
}

/** Clock for the stand-in footage. Same surface a <video> element would give. */
export function usePlayer(duration: number, initial = 0): PlayerState {
  const [t, setT] = useState(initial);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const tRef = useRef(initial);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const next = tRef.current + ((now - last) / 1000) * rate;
      last = now;
      if (next >= duration) {
        tRef.current = duration;
        setT(duration);
        setPlaying(false);
        return;
      }
      tRef.current = next;
      setT(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate, duration]);

  const seek = useCallback(
    (to: number) => {
      const v = Math.min(duration, Math.max(0, to));
      tRef.current = v;
      setT(v);
    },
    [duration],
  );

  const toggle = useCallback(() => {
    if (tRef.current >= duration) {
      tRef.current = 0;
      setT(0);
    }
    setPlaying((p) => !p);
  }, [duration]);

  const pause = useCallback(() => setPlaying(false), []);

  return { t, playing, rate, duration, toggle, pause, seek, setRate };
}

const RATES = [0.5, 1, 2];

export function FeedPlayer({ event, camera, player }: { event: FlagEvent; camera: string; player: PlayerState }) {
  const { t, duration, playing } = player;
  const seg = segmentAt(event.segments, t);
  const actor = actorAt(event.script, t);
  const detection =
    seg && actor.visible
      ? {
          box: actor.box,
          label: `Possible concealment · ${pct(seg.confidence)}`,
          low: seg.confidence < HIGH_CONFIDENCE,
        }
      : null;

  const nextFlag = () => {
    const starts = event.segments.map((s) => s.start).sort((a, b) => a - b);
    const next = starts.find((s) => s > t + 0.5) ?? starts[0];
    player.seek(next);
  };
  const cycleRate = () => player.setRate(RATES[(RATES.indexOf(player.rate) + 1) % RATES.length]);

  return (
    <section aria-label={`Footage from ${camera}`} className="overflow-hidden rounded-md bg-feed">
      <FeedFrame camera={camera} clock={clockAt(event.startClock, t)} detection={detection} rounded={false}>
        <Scene script={event.script} t={t} />
      </FeedFrame>
      <div className="px-3 pb-3 pt-1 sm:px-4">
        <Timeline
          duration={duration}
          t={t}
          segments={event.segments}
          observations={event.observations}
          onSeek={player.seek}
        />
        <div className="mt-1 flex flex-wrap items-center gap-1 text-feed-ink">
          <FeedButton label={playing ? 'Pause' : 'Play'} onClick={player.toggle} keyshortcut="Space">
            {playing ? <Pause size={18} strokeWidth={1.75} /> : <Play size={18} strokeWidth={1.75} />}
          </FeedButton>
          <FeedButton label="Back 5 seconds" onClick={() => player.seek(t - 5)}>
            <RotateCcw size={16} strokeWidth={1.75} />
          </FeedButton>
          <FeedButton label="Forward 5 seconds" onClick={() => player.seek(t + 5)}>
            <RotateCw size={16} strokeWidth={1.75} />
          </FeedButton>
          <span className="ml-1 font-mono text-caption tabular text-feed-ink">
            {timecode(t)} <span className="text-feed-muted">/ {timecode(duration)}</span>
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={nextFlag}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-label font-semibold text-feed-ink transition-colors duration-[140ms] hover:bg-feed-track"
          >
            <Crosshair size={16} strokeWidth={1.75} aria-hidden="true" />
            Jump to flag
          </button>
          <button
            type="button"
            onClick={cycleRate}
            aria-label={`Playback speed ${player.rate}×. Change speed`}
            className="inline-flex h-9 min-w-12 items-center justify-center rounded-full px-2 font-mono text-caption tabular text-feed-ink transition-colors duration-[140ms] hover:bg-feed-track"
          >
            {player.rate}×
          </button>
        </div>
      </div>
    </section>
  );
}

function FeedButton({
  label,
  onClick,
  children,
  keyshortcut,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  keyshortcut?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-keyshortcuts={keyshortcut}
      title={label}
      className="inline-flex size-10 items-center justify-center rounded-full text-feed-ink transition-[background-color,transform] duration-[140ms] ease-[var(--ease-press)] hover:bg-feed-track active:translate-y-px"
    >
      {children}
    </button>
  );
}

/**
 * Clip timeline on the dark feed: solid orange = high-confidence flag,
 * hatched orange = lower confidence, white line = playhead.
 */
export function Timeline({
  duration,
  t,
  segments,
  observations = [],
  onSeek,
  progress,
  label = 'Clip timeline',
}: {
  duration: number;
  t?: number;
  segments: Segment[];
  observations?: Observation[];
  onSeek?: (t: number) => void;
  /** analysis progress 0-100: draws how much of the clip has been checked */
  progress?: number;
  label?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const interactive = !!onSeek && t != null;

  const fromPointer = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || !onSeek) return;
    onSeek(((clientX - r.left) / r.width) * duration);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    fromPointer(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) fromPointer(e.clientX);
  };
  const onPointerUp = () => {
    dragging.current = false;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive || t == null) return;
    const step = e.shiftKey ? 5 : 1;
    const map: Record<string, number> = {
      ArrowLeft: t - step,
      ArrowRight: t + step,
      ArrowDown: t - step,
      ArrowUp: t + step,
      PageDown: t - 10,
      PageUp: t + 10,
      Home: 0,
      End: duration,
    };
    if (e.key in map) {
      e.preventDefault();
      e.stopPropagation();
      onSeek!(map[e.key]);
    }
  };
  const at = (s: number) => `${(Math.min(duration, Math.max(0, s)) / duration) * 100}%`;

  return (
    <div
      ref={trackRef}
      className={cn('relative h-9 touch-none select-none', interactive && 'cursor-pointer')}
      role={interactive ? 'slider' : 'img'}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? label : `${label}: ${segments.length} flagged ${segments.length === 1 ? 'moment' : 'moments'}`}
      aria-valuemin={interactive ? 0 : undefined}
      aria-valuemax={interactive ? Math.round(duration) : undefined}
      aria-valuenow={interactive ? Math.round(t!) : undefined}
      aria-valuetext={interactive ? `${timecode(t!)} of ${timecode(duration)}` : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <div className="absolute inset-x-0 top-3.5 h-2.5 overflow-hidden rounded-[3px] bg-feed-track">
        {progress != null && (
          <div className="absolute inset-y-0 left-0 bg-feed-line transition-[width] duration-200" style={{ width: `${progress}%` }} />
        )}
      </div>
      {segments.map((s, i) => {
        const high = s.confidence >= HIGH_CONFIDENCE;
        return (
          <div
            key={`${s.start}-${i}`}
            className={cn(
              'anim-grow-x absolute top-3.5 h-2.5 rounded-[2px]',
              high ? 'bg-signal' : 'hatch outline outline-1 -outline-offset-1 outline-signal',
            )}
            style={{ left: at(s.start), width: `calc(${at(s.end)} - ${at(s.start)})`, animationDelay: `${i * 90}ms` }}
          />
        );
      })}
      {observations.map((o) => (
        <div key={o.at} className="absolute top-1.5 h-1.5 w-px bg-feed-muted" style={{ left: at(o.at) }} />
      ))}
      {t != null && (
        <div className="pointer-events-none absolute inset-y-0.5 w-0.5 -translate-x-1/2 bg-feed-ink" style={{ left: at(t) }}>
          <div className="absolute -top-0.5 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-feed-ink" />
        </div>
      )}
    </div>
  );
}
