import { memo } from 'react';
import type { SceneKind, ScriptParams } from '../../data/types';
import { actorAt, type ActorFrame } from './script';

// Illustrated stand-in for CCTV footage, drawn in the brand PDF's
// "detection frame" style. Fixed dark palette: footage looks the same in
// both themes. Replace with <video> once the backend serves real clips.
const P = {
  wall: '#111e33',
  ceiling: '#0d192b',
  floor: '#0e1a2d',
  floorLine: '#16243a',
  shelf: '#16253d',
  edge: '#2b3f63',
  products: ['#22355a', '#1e3050', '#2a4170', '#263b60', '#1b2c4a'],
  glass: '#18304f',
  daylight: '#2a4467',
  window: '#1b2e4b',
  light: '#1e3150',
  counter: '#1a2942',
  figure: '#2e4468',
  head: '#3b5782',
  legs: '#243756',
  item: '#7392c6',
};

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const rand = (a: number, b: number) => {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - Math.floor(v);
};
const pts = (p: Array<[number, number]>) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

function ShelfUnit({ mirror, kind }: { mirror: boolean; kind: 'shelf' | 'fridge' }) {
  const X = (x: number) => (mirror ? 640 - x : x);
  const IN = 250;
  const yTop = (x: number) => lerp(28, 84, x / IN);
  const yBot = (x: number) => lerp(332, 206, x / IN);
  const at = (x: number, f: number) => lerp(yTop(x), yBot(x), f);
  const N = kind === 'fridge' ? 6 : 8;
  const xs = Array.from({ length: N + 1 }, (_, k) => IN * (1 - Math.pow(1 - k / N, 1.45)));
  const bands = [0, 0.25, 0.5, 0.75];
  const products: Array<{ p: string; fill: string }> = [];
  bands.forEach((fTop, b) => {
    const fBot = b === 3 ? 0.92 : fTop + 0.25;
    for (let k = 0; k < N; k++) {
      const pieces = kind === 'fridge' ? 3 : 1;
      const cw = (xs[k + 1] - xs[k]) / pieces;
      for (let j = 0; j < pieces; j++) {
        const gap = cw * (kind === 'fridge' ? 0.22 : 0.1);
        const x0 = xs[k] + j * cw + gap;
        const x1 = xs[k] + (j + 1) * cw - gap;
        const hf = kind === 'fridge' ? 0.62 + 0.25 * rand(b + j, k) : 0.45 + 0.4 * rand(b, k + (mirror ? 9 : 0));
        const top = fBot - (fBot - fTop - 0.03) * hf;
        products.push({
          p: pts([
            [X(x0), at(x0, top)],
            [X(x1), at(x1, top)],
            [X(x1), at(x1, fBot - 0.008)],
            [X(x0), at(x0, fBot - 0.008)],
          ]),
          fill: P.products[Math.floor(rand(k + j, b + (mirror ? 3 : 0)) * P.products.length)],
        });
      }
    }
  });
  return (
    <g>
      <polygon points={pts([[X(0), 28], [X(IN), 84], [X(IN), 206], [X(0), 332]])} fill={kind === 'fridge' ? P.glass : P.shelf} />
      {products.map((pr, i) => (
        <polygon key={i} points={pr.p} fill={pr.fill} />
      ))}
      {[0.25, 0.5, 0.75, 0.92].map((f) => (
        <line key={f} x1={X(0)} y1={at(0, f)} x2={X(IN)} y2={at(IN, f)} stroke={P.edge} strokeWidth={f === 0.92 ? 3 : 2} />
      ))}
      {kind === 'fridge' &&
        xs.filter((_, k) => k % 2 === 0).map((x, i) => (
          <line key={i} x1={X(x)} y1={yTop(x)} x2={X(x)} y2={yBot(x)} stroke="#33507a" strokeWidth={2} />
        ))}
      <line x1={X(IN)} y1={84} x2={X(IN)} y2={206} stroke={P.edge} strokeWidth={2} />
    </g>
  );
}

function AisleBackdrop({ fridges }: { fridges: boolean }) {
  return (
    <g>
      <polygon points={pts([[0, 0], [640, 0], [640, 28], [390, 84], [250, 84], [0, 28]])} fill={P.ceiling} />
      <rect x={292} y={16} width={56} height={5} fill={P.light} />
      <rect x={302} y={44} width={36} height={3} fill={P.light} />
      <rect x={250} y={84} width={140} height={122} fill={P.wall} />
      <rect x={292} y={112} width={56} height={34} fill={fridges ? '#1d3352' : '#172840'} />
      <polygon points={pts([[0, 332], [250, 206], [390, 206], [640, 332], [640, 360], [0, 360]])} fill={P.floor} />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <line key={i} x1={250 + i * (140 / 6)} y1={206} x2={-60 + i * (760 / 6)} y2={360} stroke={P.floorLine} strokeWidth={1.5} />
      ))}
      {[232, 262, 304].map((y) => (
        <line key={y} x1={0} y1={y} x2={640} y2={y} stroke={P.floorLine} strokeWidth={1} />
      ))}
      <ShelfUnit mirror={false} kind={fridges ? 'fridge' : 'shelf'} />
      <ShelfUnit mirror kind="shelf" />
    </g>
  );
}

function DoorBackdrop() {
  return (
    <g>
      <rect x={0} y={0} width={640} height={214} fill={P.wall} />
      <rect x={60} y={58} width={180} height={112} fill={P.window} />
      <rect x={400} y={58} width={180} height={112} fill={P.window} />
      <line x1={150} y1={58} x2={150} y2={170} stroke={P.edge} strokeWidth={3} />
      <line x1={490} y1={58} x2={490} y2={170} stroke={P.edge} strokeWidth={3} />
      <rect x={92} y={84} width={42} height={58} fill="#22385a" />
      <rect x={272} y={64} width={96} height={150} fill={P.daylight} />
      <rect x={272} y={64} width={96} height={150} fill="none" stroke={P.edge} strokeWidth={5} />
      <line x1={320} y1={64} x2={320} y2={214} stroke={P.edge} strokeWidth={3} />
      <line x1={282} y1={146} x2={312} y2={146} stroke="#4a6390" strokeWidth={3} strokeLinecap="round" />
      <line x1={328} y1={146} x2={358} y2={146} stroke="#4a6390" strokeWidth={3} strokeLinecap="round" />
      <rect x={0} y={214} width={640} height={146} fill={P.floor} />
      <polygon points={pts([[252, 214], [388, 214], [432, 262], [208, 262]])} fill={P.floorLine} />
      <polygon points={pts([[0, 36], [76, 68], [76, 318], [0, 360]])} fill={P.shelf} />
      {[110, 170, 230, 290].map((y, i) => (
        <line key={y} x1={0} y1={y + 10 - i * 2} x2={76} y2={y + 18 - i * 4} stroke={P.edge} strokeWidth={2} />
      ))}
    </g>
  );
}

function DoorForeground() {
  return (
    <g>
      <polygon points={pts([[512, 196], [640, 178], [640, 312], [512, 258]])} fill={P.counter} />
      <line x1={512} y1={196} x2={640} y2={178} stroke={P.edge} strokeWidth={3} />
    </g>
  );
}

function TillBackdrop() {
  return (
    <g>
      <rect x={0} y={0} width={640} height={172} fill={P.wall} />
      <rect x={70} y={58} width={74} height={114} fill={P.daylight} />
      <rect x={70} y={58} width={74} height={114} fill="none" stroke={P.edge} strokeWidth={4} />
      <rect x={400} y={64} width={220} height={108} fill={P.shelf} />
      {[90, 118, 146].map((y) => (
        <line key={y} x1={400} y1={y} x2={620} y2={y} stroke={P.edge} strokeWidth={2} />
      ))}
      {Array.from({ length: 18 }, (_, i) => (
        <rect key={i} x={406 + (i % 9) * 24} y={i < 9 ? 72 : 100} width={16} height={16} fill={P.products[i % 5]} />
      ))}
      <rect x={0} y={172} width={640} height={188} fill={P.floor} />
      {[200, 236].map((y) => (
        <line key={y} x1={0} y1={y} x2={640} y2={y} stroke={P.floorLine} strokeWidth={1} />
      ))}
    </g>
  );
}

function TillForeground() {
  return (
    <g>
      <polygon points={pts([[0, 264], [640, 242], [640, 360], [0, 360]])} fill={P.counter} />
      <line x1={0} y1={264} x2={640} y2={242} stroke={P.edge} strokeWidth={3} />
      <rect x={312} y={226} width={92} height={28} fill="#22355a" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={318 + i * 17} y={214} width={12} height={14} fill={P.products[(i + 2) % 5]} />
      ))}
      <rect x={440} y={196} width={86} height={48} fill="#22355a" />
      <rect x={450} y={176} width={58} height={24} fill={P.figure} />
      <rect x={548} y={224} width={24} height={18} fill="#22355a" />
    </g>
  );
}

const Backdrop = memo(function Backdrop({ kind }: { kind: SceneKind }) {
  if (kind === 'door') return <DoorBackdrop />;
  if (kind === 'till') return <TillBackdrop />;
  return <AisleBackdrop fridges={kind === 'fridges'} />;
});

const Foreground = memo(function Foreground({ kind }: { kind: SceneKind }) {
  if (kind === 'door') return <DoorForeground />;
  if (kind === 'till') return <TillForeground />;
  return null;
});

function Figure({ f, t }: { f: ActorFrame; t: number }) {
  const { x, y, h: H } = f;
  const side = f.armSide;
  const swing = f.walking ? Math.sin(t * 5.5) * H * 0.035 : 0;
  const legW = H * 0.085;
  const hipY = y - H * 0.46;
  const torsoTop = y - H * 0.84;
  const torsoW = H * 0.32;
  const shoulder = { x: x + side * H * 0.12, y: torsoTop + H * 0.07 };
  const rest = { x: x + side * H * 0.16 - swing * 0.6, y: y - H * 0.47 };
  const out = { x: x + side * H * 0.42, y: y - H * 0.66 };
  const tuck = { x: x + side * H * 0.02, y: y - H * 0.64 };
  const mid = { x: lerp(rest.x, out.x, f.reach), y: lerp(rest.y, out.y, f.reach) };
  const hand = { x: lerp(mid.x, tuck.x, f.tucked), y: lerp(mid.y, tuck.y, f.tucked) };
  return (
    <g opacity={f.opacity}>
      <line
        x1={x - side * H * 0.12}
        y1={torsoTop + H * 0.07}
        x2={x - side * H * 0.15 + swing * 0.6}
        y2={y - H * 0.47}
        stroke={P.legs}
        strokeWidth={H * 0.065}
        strokeLinecap="round"
      />
      <rect x={x - H * 0.1 + swing} y={hipY} width={legW} height={H * 0.46} rx={legW / 2} fill={P.legs} />
      <rect x={x + H * 0.015 - swing} y={hipY} width={legW} height={H * 0.46} rx={legW / 2} fill={P.legs} />
      <rect x={x - torsoW / 2} y={torsoTop} width={torsoW} height={H * 0.42} rx={H * 0.07} fill={P.figure} />
      <circle cx={x} cy={y - H * 0.925} r={H * 0.08} fill={P.head} />
      <line
        x1={shoulder.x}
        y1={shoulder.y}
        x2={hand.x}
        y2={hand.y}
        stroke={P.figure}
        strokeWidth={H * 0.068}
        strokeLinecap="round"
      />
      {f.holding && (
        <rect x={hand.x - H * 0.03} y={hand.y - H * 0.06} width={H * 0.06} height={H * 0.085} rx={1.5} fill={P.item} />
      )}
    </g>
  );
}

export function Scene({ script, t }: { script: ScriptParams; t: number }) {
  const f = actorAt(script, t);
  return (
    <svg viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice" className="block h-full w-full" aria-hidden="true">
      <rect width={640} height={360} fill="var(--feed)" />
      <Backdrop kind={script.scene} />
      {f.visible && <Figure f={f} t={t} />}
      <Foreground kind={script.scene} />
      <rect width={640} height={360} fill="url(#feed-vignette)" />
      <defs>
        <radialGradient id="feed-vignette" cx="50%" cy="50%" r="75%">
          <stop offset="60%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.45" />
        </radialGradient>
      </defs>
    </svg>
  );
}
