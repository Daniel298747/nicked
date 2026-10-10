import type { ReactNode } from 'react';
import { cn } from '../../lib/hooks';
import { SCENE_H, SCENE_W } from './script';

export interface Detection {
  box: { x: number; y: number; w: number; h: number };
  label: string;
  /** low confidence draws a dashed box, matching the hatched timeline segment */
  low?: boolean;
}

interface FeedFrameProps {
  /** "CAM 02 · Aisle 2" */
  camera: string;
  clock?: string;
  detection?: Detection | null;
  children: ReactNode;
  size?: 'lg' | 'md' | 'sm';
  rounded?: boolean;
  className?: string;
  /** accessible description for stills; players label themselves */
  label?: string;
  overlay?: ReactNode;
}

/**
 * The dark feed frame from the brand PDF: footage, a mono overlay with the
 * camera and time, and (when flagged) one orange box with a label and
 * corner brackets.
 */
export function FeedFrame({
  camera,
  clock,
  detection,
  children,
  size = 'lg',
  rounded = true,
  className,
  label,
  overlay,
}: FeedFrameProps) {
  const small = size === 'sm';
  return (
    <div
      className={cn('relative aspect-video overflow-hidden bg-feed', rounded && 'rounded-md', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <div className="absolute inset-0">{children}</div>
      {detection && <DetectionBox d={detection} compact={small} />}
      {!small && (
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between font-mono uppercase text-feed-ink',
            size === 'lg' ? 'px-3.5 pt-3 text-overlay tracking-[0.08em]' : 'px-2.5 pt-2 text-[0.625rem] tracking-[0.06em]',
          )}
          aria-hidden="true"
        >
          <span>{camera}</span>
          {clock && (
            <span className="flex items-center gap-1.5 tabular">
              <span className="size-1.5 rounded-full bg-signal" />
              {clock}
            </span>
          )}
        </div>
      )}
      {overlay}
    </div>
  );
}

function DetectionBox({ d, compact }: { d: Detection; compact: boolean }) {
  const left = Math.max(0, (d.box.x / SCENE_W) * 100);
  const top = Math.max(0, (d.box.y / SCENE_H) * 100);
  const right = Math.min(100, ((d.box.x + d.box.w) / SCENE_W) * 100);
  const bottom = Math.min(100, ((d.box.y + d.box.h) / SCENE_H) * 100);
  if (right - left < 2 || bottom - top < 2) return null;
  return (
    <div
      className={cn(
        'pointer-events-none absolute border-signal',
        compact ? 'border-[1.5px]' : 'border-2',
        d.low && 'border-dashed',
      )}
      style={{ left: `${left}%`, top: `${top}%`, width: `${right - left}%`, height: `${bottom - top}%` }}
      aria-hidden="true"
    >
      {!compact && (
        <span className="absolute bottom-full left-[-2px] mb-[3px] whitespace-nowrap bg-signal px-1.5 py-[3px] font-mono text-[0.625rem] font-medium uppercase leading-none tracking-[0.06em] text-on-signal sm:text-overlay">
          {d.label}
        </span>
      )}
      <span className={cn('absolute border-b-2 border-l-2 border-signal', compact ? '-bottom-1 -left-1 size-1.5' : '-bottom-[7px] -left-[7px] size-2.5')} />
      <span className={cn('absolute border-b-2 border-r-2 border-signal', compact ? '-bottom-1 -right-1 size-1.5' : '-bottom-[7px] -right-[7px] size-2.5')} />
    </div>
  );
}

/** White scan line sweeping the frame while analysis runs. */
export function ScanLine() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="anim-scan absolute inset-x-0 top-0 h-full">
        <div className="absolute inset-x-0 -top-8 h-8 bg-linear-to-b from-transparent to-feed-ink/15" />
        <div className="absolute inset-x-0 top-0 h-[2px] bg-feed-ink/85" />
      </div>
    </div>
  );
}
