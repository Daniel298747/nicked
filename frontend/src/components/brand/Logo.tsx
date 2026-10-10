import { CAMERA, WORDMARK_PATH } from './logoPaths';
import { cn } from '../../lib/hooks';

const { cx } = CAMERA;

function Camera() {
  return (
    <g>
      <rect x={cx - 20.5} y={10.2} width={41} height={8.4} rx={2.6} fill="#FF541C" />
      <path d={`M${cx - 14} 18.6H${cx + 14}V24.4A14 14 0 0 1 ${cx - 14} 24.4Z`} fill="#FF541C" />
      <circle cx={cx} cy={27.5} r={8.2} fill="#FFFFFF" />
      <circle cx={cx} cy={27.5} r={5.2} fill="#0E1F35" />
      <circle cx={cx + 2.1} cy={25.4} r={1.8} fill="#FFFFFF" />
    </g>
  );
}

/** Lowercase wordmark with the camera over the i. Navy on light, white on navy/dark. */
export function Logo({ className, reversed = false }: { className?: string; reversed?: boolean }) {
  return (
    <svg viewBox="4 8 304 95" className={cn('h-7 w-auto', className)} role="img" aria-label="Nicked">
      <path d={WORDMARK_PATH} fill={reversed ? '#FFFFFF' : 'currentColor'} />
      <Camera />
    </svg>
  );
}

/** The camera alone, for small spaces. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox={`${cx - 21} 9.5 42 30`} className={cn('h-6 w-auto', className)} aria-hidden="true">
      <Camera />
    </svg>
  );
}
