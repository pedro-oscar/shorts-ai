import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * "Deus abriu a terra e os rebeldes caíram na cratera" (Moisés e a rebelião de Corá): bloco de chão
 * de deserto com duas tendas e cinco pessoinhas. O chão treme, uma rachadura em zigue-zague se desenha
 * no meio e as duas metades se afastam, revelando a fenda escura com brilho vermelho no fundo; as três
 * figuras do meio caem uma a uma, girando e sumindo na fenda, e as duas das bordas ficam. Rótulo no topo.
 */
const INK = '#111';
const EDGE = '#2b1a0d';
const CRACK_INK = '#1a0e05';
const TOP_BACK = '#a06c38';
const TOP_FRONT = '#8b5a2b';
const SIDE = '#5c3a1a';
const BAND = '#4a2e14';
const PATCH = '#7a4b22';
const SAND = '#b5824e';
const STONE = '#c49a6c';
const WALL = '#3f2511';
const ABYSS = '#130705';
const DUST = '#d2b289';
const ORANGE = '#FF8A1F';
const TENT = '#e4d5b2';
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

type Pt = [number, number];
type Side = -1 | 1;

// Bloco de chão em leve perspectiva: face de cima (trapézio) + face da frente. Topo 0–140 livre p/ rótulo.
const CX = 470;
const BACK_Y = 372;
const FRONT_Y = 552;
const BOTTOM_Y = 668;
const BACK_HALF = 260; // meia largura da borda de trás
const FRONT_HALF = 340; // meia largura da borda da frente
const D_MAX = 100; // quanto cada metade anda para o lado
const TILT = 2; // graus que cada metade afunda para dentro
const FALL_TO = 712; // até onde as figuras caem (já dentro da fenda)
const G = 0.8; // gravidade das pedrinhas (px/frame²)

// Rachadura em zigue-zague: da borda de trás até a da frente e descendo pela face da frente.
const CRACK: Pt[] = [
  [470, 372],
  [446, 412],
  [494, 452],
  [452, 500],
  [486, 552],
  [462, 600],
  [482, 640],
  [470, 668],
];
// Rachaduras menores que saem da principal (cada uma pertence a uma metade).
const BRANCHES: Array<{side: Side; pts: Pt[]}> = [
  {side: -1, pts: [[446, 412], [418, 398], [392, 404]]},
  {side: -1, pts: [[452, 500], [424, 512], [402, 506]]},
  {side: -1, pts: [[462, 600], [434, 614]]},
  {side: 1, pts: [[494, 452], [524, 440], [552, 446]]},
  {side: 1, pts: [[469, 526], [500, 536], [522, 528]]},
  {side: 1, pts: [[482, 640], [512, 628]]},
];

// Textura do chão (desenhada nas duas metades, cada uma recortada no seu contorno).
const PATCHES: Array<[number, number, number, number]> = [
  [300, 420, 50, 12],
  [612, 412, 44, 10],
  [392, 522, 64, 14],
  [690, 520, 54, 12],
  [530, 396, 30, 8],
  [252, 474, 36, 9],
  [566, 490, 36, 9],
];
const SANDS: Array<[number, number, number, number]> = [
  [344, 462, 36, 7],
  [604, 458, 42, 8],
  [214, 530, 30, 6],
  [734, 470, 26, 6],
];
const STONES: Array<[number, number, number]> = [
  [270, 536, 11],
  [652, 470, 9],
  [592, 538, 10],
  [372, 398, 7],
  [748, 528, 9],
  [560, 514, 8],
];
const FRONT_STONES: Array<[number, number, number, number]> = [
  [196, 614, 15, 9],
  [330, 648, 11, 7],
  [606, 604, 14, 8],
  [746, 642, 12, 8],
  [420, 630, 12, 7],
  [262, 588, 8, 5],
  [690, 584, 9, 5],
];
const BAND_D =
  'M 110 586 C 250 578 360 596 470 588 C 580 580 700 596 830 586 L 830 622 C 700 632 580 616 470 626 C 360 636 250 618 110 624 Z';
const LIP_D = `M ${CX - FRONT_HALF} ${FRONT_Y - 5} L ${CX + FRONT_HALF} ${FRONT_Y - 5}`;

const TENTS: Array<{side: Side; x: number; y: number; s: number}> = [
  {side: -1, x: 300, y: 402, s: 0.85},
  {side: 1, x: 640, y: 400, s: 0.85},
];

// Pessoinhas: `on` = metade onde ficam (-1/1) ou 0 = em cima da fenda (caem, na ordem `order`).
type Person = {x: number; y: number; on: -1 | 0 | 1; robe: string; skin: string; scarf?: string; spin: number; order: number};
const PEOPLE: Person[] = [
  {x: 228, y: 505, on: -1, robe: '#7d8a5a', skin: '#d9a477', spin: 0, order: 0},
  {x: 432, y: 440, on: 0, robe: '#8c4a4a', skin: '#b97a4f', scarf: '#d8cbb0', spin: -250, order: 0},
  {x: 478, y: 525, on: 0, robe: '#4f6d8a', skin: '#e0b083', spin: 230, order: 2},
  {x: 530, y: 468, on: 0, robe: '#d6c7a1', skin: '#a8693f', scarf: '#7a5a3a', spin: 270, order: 1},
  {x: 706, y: 482, on: 1, robe: '#6a5a80', skin: '#d39b6a', scarf: '#d8cbb0', spin: 0, order: 0},
];

const poly = (pts: Pt[], close = true) =>
  pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + (close ? ' Z' : '');

const polyLen = (pts: Pt[]) =>
  pts.reduce((acc, p, i) => (i ? acc + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : acc), 0);

const CRACK_LEN = polyLen(CRACK);

/** x da rachadura na altura y (antes de abrir). */
const crackX = (y: number) => {
  for (let i = 1; i < CRACK.length; i++) {
    const [x1, y1] = CRACK[i - 1];
    const [x2, y2] = CRACK[i];
    if (y <= y2) return x1 + ((x2 - x1) * (y - y1)) / (y2 - y1);
  }
  return CX;
};

/** Pseudoaleatório determinístico em [0, 1). */
const rnd = (i: number, k: number) => {
  const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

// Pedrinhas que saltam da rachadura quando o chão abre.
const PEBBLES = Array.from({length: 14}, (_, i) => {
  const side: Side = i % 2 ? 1 : -1;
  const y0 = BACK_Y + 24 + rnd(i, 1) * (FRONT_Y - BACK_Y - 44);
  return {
    y0,
    x0: crackX(y0) + side * 4,
    delay: Math.floor(rnd(i, 2) * 8),
    vx: side * (0.8 + rnd(i, 3) * 2.4),
    vy: 7 + rnd(i, 4) * 6,
    size: 6 + rnd(i, 5) * 7,
    spin: side * (6 + rnd(i, 6) * 14),
    color: i % 3 === 0 ? STONE : i % 3 === 1 ? TOP_FRONT : SIDE,
  };
});

// Brasas subindo do fundo da fenda.
const EMBERS = Array.from({length: 8}, (_, i) => ({
  dx: (rnd(i, 11) - 0.5) * 90,
  period: 38 + Math.floor(rnd(i, 12) * 24),
  off: rnd(i, 13),
  h: 170 + rnd(i, 14) * 130,
  r: 3 + rnd(i, 15) * 3.5,
}));

// Nuvens de poeira: pequenas enquanto a rachadura corre, grandes quando as metades se afastam.
const CRACK_PUFFS: Array<{pt: number; side: Side; delay: number}> = [
  {pt: 1, side: -1, delay: 3},
  {pt: 2, side: 1, delay: 6},
  {pt: 3, side: -1, delay: 9},
  {pt: 4, side: 1, delay: 12},
];
const OPEN_PUFFS = Array.from({length: 10}, (_, k) => ({
  pt: k % 5,
  side: (k % 2 ? 1 : -1) as Side,
  delay: (k * 4) % 13,
  dur: 55 + ((k * 9) % 25),
  r: 34 + ((k * 7) % 18),
}));

const persp = (y: number) => interpolate(y, [BACK_Y, FRONT_Y], [0.84, 1], CLAMP);

const pivotX = (side: Side) => CX + side * FRONT_HALF;
/** A metade afunda `tilt` graus (pivô no canto de baixo de fora) e anda `gap` px para o lado. */
const halfTransform = (side: Side, gap: number, tilt: number) =>
  `translate(${(side * gap).toFixed(2)} 0) rotate(${(-side * tilt).toFixed(3)} ${pivotX(side)} ${BOTTOM_Y})`;
/** Mesmo movimento de `halfTransform`, aplicado a um ponto (para desenhar a fenda entre as metades). */
const movePt = ([x, y]: Pt, side: Side, gap: number, tilt: number): Pt => {
  const a = (-side * tilt * Math.PI) / 180;
  const dx = x - pivotX(side);
  const dy = y - BOTTOM_Y;
  return [pivotX(side) + dx * Math.cos(a) - dy * Math.sin(a) + side * gap, BOTTOM_Y + dx * Math.sin(a) + dy * Math.cos(a)];
};

const halfTop = (side: Side): Pt[] => [[CX + side * BACK_HALF, BACK_Y], ...CRACK.slice(0, 5), [CX + side * FRONT_HALF, FRONT_Y]];
const halfFront = (side: Side): Pt[] => [[CX + side * FRONT_HALF, FRONT_Y], ...CRACK.slice(4), [CX + side * FRONT_HALF, BOTTOM_Y]];
const halfWhole = (side: Side): Pt[] => [
  [CX + side * BACK_HALF, BACK_Y],
  ...CRACK,
  [CX + side * FRONT_HALF, BOTTOM_Y],
  [CX + side * FRONT_HALF, FRONT_Y],
];
const WHOLE_TOP: Pt[] = [
  [CX - BACK_HALF, BACK_Y],
  [CX + BACK_HALF, BACK_Y],
  [CX + FRONT_HALF, FRONT_Y],
  [CX - FRONT_HALF, FRONT_Y],
];
const WHOLE_FRONT: Pt[] = [
  [CX - FRONT_HALF, FRONT_Y],
  [CX + FRONT_HALF, FRONT_Y],
  [CX + FRONT_HALF, BOTTOM_Y],
  [CX - FRONT_HALF, BOTTOM_Y],
];

/** Pessoinha de túnica, pés em (0,0), ~126 px de altura. `arms` em graus a partir de "para baixo". */
const Figure: React.FC<{p: Person; arms: [number, number]; panic: number}> = ({p, arms, panic}) => (
  <g>
    <ellipse cx={-11} cy={-3} rx={10} ry={6} fill={INK} />
    <ellipse cx={11} cy={-3} rx={10} ry={6} fill={INK} />
    <path
      d="M -15 -82 Q 0 -88 15 -82 L 30 -6 Q 0 3 -30 -6 Z"
      fill={p.robe}
      stroke={INK}
      strokeWidth={6}
      strokeLinejoin="round"
    />
    <path d="M -21 -44 L 21 -44" stroke="#000" strokeOpacity={0.25} strokeWidth={6} />
    {arms.map((deg, j) => {
      const side = j ? 1 : -1;
      const a = (deg * Math.PI) / 180;
      const sx = side * 13;
      const sy = -74;
      const ex = sx + side * 36 * Math.sin(a);
      const ey = sy + 36 * Math.cos(a);
      const arm = `M ${sx} ${sy} L ${ex.toFixed(1)} ${ey.toFixed(1)}`;
      return (
        <g key={j}>
          <path d={arm} stroke={INK} strokeWidth={16} strokeLinecap="round" />
          <path d={arm} stroke={p.robe} strokeWidth={8} strokeLinecap="round" />
          <circle cx={ex} cy={ey} r={6.5} fill={p.skin} stroke={INK} strokeWidth={4} />
        </g>
      );
    })}
    <circle cx={0} cy={-104} r={22} fill={p.skin} stroke={INK} strokeWidth={6} />
    {p.scarf ? (
      <path
        d="M -26 -76 L -26 -102 C -26 -134 26 -134 26 -102 L 26 -76 L 16 -78 L 16 -102 C 16 -118 -16 -118 -16 -102 L -16 -78 Z"
        fill={p.scarf}
        stroke={INK}
        strokeWidth={5}
        strokeLinejoin="round"
      />
    ) : null}
    <circle cx={-7.5} cy={-104} r={3.4 + panic} fill={INK} />
    <circle cx={7.5} cy={-104} r={3.4 + panic} fill={INK} />
    {panic > 0.3 ? (
      <ellipse cx={0} cy={-93} rx={4.5} ry={2 + 4 * Math.min(1, panic)} fill={INK} />
    ) : (
      <path d="M -6 -94 Q 0 -90 6 -94" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
    )}
  </g>
);

/** Tenda com a base em (0,0). */
const Tent: React.FC = () => (
  <g>
    <ellipse cx={0} cy={2} rx={56} ry={8} fill="#000" opacity={0.22} />
    <path d="M 0 -62 L 0 -76" stroke={EDGE} strokeWidth={5} strokeLinecap="round" />
    <path d="M -52 0 L 0 -62 L 52 0 Z" fill={TENT} stroke={EDGE} strokeWidth={6} strokeLinejoin="round" />
    <path d="M -14 0 L 0 -36 L 14 0 Z" fill="#3a2410" stroke={EDGE} strokeWidth={4} strokeLinejoin="round" />
    <path d="M -26 -31 L -40 -14" stroke="#c9b68e" strokeWidth={4} strokeLinecap="round" />
  </g>
);

/** Uma metade do bloco de chão (coordenadas do bloco inteiro; quem move é o transform de fora). */
const Half: React.FC<{
  side: Side;
  crackP: number;
  branchP: number;
  glowLine: number;
  accent: string;
  children?: React.ReactNode;
}> = ({side, crackP, branchP, glowLine, accent, children}) => {
  const id = `ta-half-${side < 0 ? 'l' : 'r'}`;
  const ox = CX + side * FRONT_HALF;
  const bx = CX + side * BACK_HALF;
  const [fx, fy] = CRACK[0];
  const [lx, ly] = CRACK[CRACK.length - 1];
  const [ex, ey] = CRACK[4];
  const crackD = poly(CRACK, false);
  return (
    <g>
      <defs>
        <clipPath id={id}>
          <path d={poly(halfWhole(side))} />
        </clipPath>
      </defs>
      <path d={poly(halfFront(side))} fill={SIDE} />
      <path d={poly(halfTop(side))} fill="url(#ta-top)" />
      <g clipPath={`url(#${id})`}>
        <path d={BAND_D} fill={BAND} />
        {FRONT_STONES.map(([x, y, rx, ry], i) => (
          <ellipse key={i} cx={x} cy={y} rx={rx} ry={ry} fill="#7a5230" stroke={EDGE} strokeWidth={4} />
        ))}
        {PATCHES.map(([x, y, rx, ry], i) => (
          <ellipse key={i} cx={x} cy={y} rx={rx} ry={ry} fill={PATCH} />
        ))}
        {SANDS.map(([x, y, rx, ry], i) => (
          <ellipse key={i} cx={x} cy={y} rx={rx} ry={ry} fill={SAND} opacity={0.8} />
        ))}
        {STONES.map(([x, y, r], i) => (
          <ellipse key={i} cx={x} cy={y} rx={r} ry={r * 0.7} fill={STONE} stroke={EDGE} strokeWidth={4} />
        ))}
        <path d={LIP_D} stroke={SAND} strokeWidth={5} opacity={0.7} />
      </g>
      {/* contorno de fora + quina da frente */}
      <path
        d={`M ${fx} ${fy} L ${bx} ${BACK_Y} L ${ox} ${FRONT_Y} L ${ox} ${BOTTOM_Y} L ${lx} ${ly}`}
        fill="none"
        stroke={EDGE}
        strokeWidth={7}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d={`M ${ox} ${FRONT_Y} L ${ex} ${ey}`} stroke={EDGE} strokeWidth={6} strokeLinecap="round" />
      {/* rachadura = borda de dentro desta metade */}
      {crackP > 0.001 ? (
        <g>
          <path
            d={crackD}
            fill="none"
            stroke={CRACK_INK}
            strokeWidth={8}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={CRACK_LEN}
            strokeDashoffset={CRACK_LEN * (1 - crackP)}
          />
          {glowLine > 0.01 ? (
            <path
              d={crackD}
              fill="none"
              stroke={accent}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={CRACK_LEN}
              strokeDashoffset={CRACK_LEN * (1 - crackP)}
              opacity={glowLine}
            />
          ) : null}
        </g>
      ) : null}
      {branchP > 0.001
        ? BRANCHES.filter((b) => b.side === side).map((b, i) => {
            const len = polyLen(b.pts);
            return (
              <path
                key={i}
                d={poly(b.pts, false)}
                fill="none"
                stroke={CRACK_INK}
                strokeWidth={6}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={len}
                strokeDashoffset={len * (1 - branchP)}
              />
            );
          })
        : null}
      {children}
    </g>
  );
};

export const TerraAbrindo: React.FC<
  SceneProps & {
    label?: string;
    labelAt?: number;
    abrirAt?: number;
    cairAt?: number;
  }
> = ({label = '', labelAt = 0.3, abrirAt = 1.2, cairAt = 3.5, accent, highlight}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const labelF = Math.round(labelAt * fps);
  const abrirF = Math.round(abrirAt * fps);
  const cairF = Math.round(cairAt * fps);
  const openF = abrirF + 16; // metades se afastam quando a rachadura termina de correr
  const fallF = Math.max(cairF, openF + 20); // ninguém cai antes de a fenda estar aberta

  // --- Entrada: chão sobe de baixo; tendas e pessoas brotam escalonadas.
  const groundIn = spring({frame, fps, config: {damping: 14, stiffness: 150}});
  const tentIn = spring({frame: frame - 3, fps, config: {damping: 11, stiffness: 170}});
  const enter = PEOPLE.map((_, i) => spring({frame: frame - (4 + i * 4), fps, config: {damping: 10, stiffness: 170}}));
  const stageY = (1 - groundIn) * 340;

  // --- Tremor (senoide com envelope) + rachadura se desenhando.
  const tq = frame - abrirF;
  const quake = interpolate(frame, [abrirF, abrirF + 3, abrirF + 12, abrirF + 15], [0, 10, 8, 0], {
    ...CLAMP,
    easing: Easing.inOut(Easing.quad),
  });
  const rumble = interpolate(frame, [openF, openF + 4, openF + 20, openF + 30], [0, 5, 3, 0], {
    ...CLAMP,
    easing: Easing.inOut(Easing.quad),
  });
  const amp = Math.max(quake, rumble);
  const shakeX = amp * Math.sin(tq * 2.7);
  const shakeY = amp * 0.45 * Math.sin(tq * 3.9 + 1.2);
  const crackP = interpolate(frame, [abrirF + 2, abrirF + 16], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
  const branchP = interpolate(frame, [abrirF + 8, abrirF + 20], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});

  // --- Abertura: as metades se afastam e afundam um pouco para dentro.
  const openP = spring({frame: frame - openF, fps, config: {damping: 14, stiffness: 70, mass: 1.1}});
  const gap = openP * D_MAX;
  const tilt = openP * TILT;
  const glowLine = interpolate(openP, [0, 0.25], [1, 0], CLAMP);

  // Fenda = espaço entre as bordas de dentro das metades + bico irregular embaixo.
  const leftEdge = CRACK.map((p) => movePt(p, -1, gap, tilt));
  const rightEdge = CRACK.map((p) => movePt(p, 1, gap, tilt));
  const lt = leftEdge[0];
  const rt = rightEdge[0];
  const lb = leftEdge[leftEdge.length - 1];
  const rb = rightEdge[rightEdge.length - 1];
  const baseY = (lb[1] + rb[1]) / 2;
  const depth = 58 * openP;
  const atX = (t: number) => lb[0] + (rb[0] - lb[0]) * t;
  const vPts: Pt[] = [
    [atX(0.2), baseY + depth * 0.4],
    [atX(0.36), baseY + depth * 0.3],
    [atX(0.5), baseY + depth],
    [atX(0.64), baseY + depth * 0.45],
    [atX(0.8), baseY + depth * 0.25],
  ];
  const chasmD = poly([...leftEdge, ...vPts, ...[...rightEdge].reverse()]);
  const vD = poly([lb, ...vPts, rb], false);
  const wallW = (y: number) => (12 + (26 * (y - BACK_Y)) / (BOTTOM_Y - BACK_Y)) * openP;
  const wallL = poly([...leftEdge, ...[...leftEdge].reverse().map(([x, y]): Pt => [x + wallW(y), y])]);
  const wallR = poly([...rightEdge, ...[...rightEdge].reverse().map(([x, y]): Pt => [x - wallW(y), y])]);
  const backH = 30 * openP;
  const backWall = poly([lt, rt, [rt[0], rt[1] + backH], [lt[0], lt[1] + backH]]);
  const rimL = poly(leftEdge.map(([x, y]): Pt => [x + 5, y]), false);
  const rimR = poly(rightEdge.map(([x, y]): Pt => [x - 5, y]), false);

  // --- Queda das figuras do meio, uma a uma.
  const fallStart = (k: number) => fallF + k * 5;
  const fallOf = (k: number) =>
    interpolate(frame, [fallStart(k) + 4, fallStart(k) + 34], [0, 1], {...CLAMP, easing: Easing.in(Easing.quad)});
  const middle = PEOPLE.map((p, i) => ({p, i}))
    .filter(({p}) => p.on === 0)
    .sort((a, b) => a.p.y - b.p.y);

  // --- Brilho da fenda: pulsa e dá um clarão quando cada figura some.
  const pulse = 0.8 + 0.2 * Math.sin(frame * 0.22);
  const flare = middle.reduce((acc, {p}) => {
    const v = fallStart(p.order) + 30;
    return acc + interpolate(frame, [v, v + 5, v + 24], [0, 0.3, 0], CLAMP);
  }, 0);
  const glowOp = Math.min(1, openP * pulse + flare);
  const emberF = openF + 8;
  const emberIn = interpolate(frame, [emberF, emberF + 12], [0, 1], CLAMP);

  // --- Pânico: braços para cima e agitando; as das bordas se inclinam para longe da fenda.
  const panic = PEOPLE.map((_, i) => spring({frame: frame - (abrirF + 3 + i * 2), fps, config: {damping: 12, stiffness: 140}}));
  const lean = spring({frame: frame - cairF - 4, fps, config: {damping: 12, stiffness: 120}}) * 7;
  const calm = interpolate(frame, [fallF + 40, fallF + 70], [1, 0.35], {...CLAMP, easing: Easing.inOut(Easing.quad)});
  const armsOf = (i: number, extra: number, k: number): [number, number] => {
    const base = interpolate(panic[i], [0, 1], [16, 140]);
    const w = panic[i] * (18 + extra) * k;
    return [base + w * Math.sin(frame * 0.55 + i * 1.7), base + w * Math.sin(frame * 0.6 + i * 2.3 + 1.4)];
  };

  const standing = (side: Side) => {
    const i = PEOPLE.findIndex((q) => q.on === side);
    if (i < 0) return null;
    const p = PEOPLE[i];
    const s = persp(p.y) * enter[i];
    if (s <= 0.001) return null;
    const rot = Math.sin(frame * 0.08 + i * 1.3) * 2 + side * lean;
    return (
      <g transform={`translate(${p.x} ${p.y}) rotate(${rot.toFixed(2)}) scale(${s.toFixed(4)})`}>
        <ellipse cx={0} cy={0} rx={30} ry={7} fill="#000" opacity={0.25} />
        <Figure p={p} arms={armsOf(i, 0, calm)} panic={panic[i]} />
      </g>
    );
  };

  const puff = (key: string, x: number, y: number, side: Side, t: number, dur: number, rMax: number) => {
    if (t < 0 || t > dur) return null;
    const g = interpolate(t, [0, dur], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
    const r = 8 + (rMax - 8) * g;
    const op = interpolate(t, [0, 4, dur], [0, 0.55, 0], CLAMP);
    const yy = y - 28 * g;
    return (
      <g key={key} opacity={op}>
        <circle cx={x} cy={yy} r={r} fill={DUST} />
        <circle cx={x + side * r * 0.65} cy={yy + r * 0.25} r={r * 0.7} fill={DUST} />
      </g>
    );
  };

  const labelIn = spring({frame: frame - labelF, fps, config: {damping: 10}});
  const labelFont = Math.max(48, Math.min(80, Math.floor(1220 / Math.max(1, label.length))));

  return (
    <AbsoluteFill style={{fontFamily: FONT, alignItems: 'center'}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        <defs>
          <linearGradient id="ta-top" gradientUnits="userSpaceOnUse" x1={0} y1={BACK_Y} x2={0} y2={FRONT_Y}>
            <stop offset="0%" stopColor={TOP_BACK} />
            <stop offset="100%" stopColor={TOP_FRONT} />
          </linearGradient>
          <radialGradient id="ta-glow">
            <stop offset="0%" stopColor={ORANGE} stopOpacity={0.95} />
            <stop offset="45%" stopColor={accent} stopOpacity={0.65} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="ta-core">
            <stop offset="0%" stopColor={highlight} stopOpacity={0.95} />
            <stop offset="50%" stopColor={ORANGE} stopOpacity={0.6} />
            <stop offset="100%" stopColor={ORANGE} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="ta-spill">
            <stop offset="0%" stopColor={accent} stopOpacity={0.5} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </radialGradient>
          <clipPath id="ta-chasm">
            <path d={chasmD} />
          </clipPath>
          {/* cada figura do meio aparece inteira acima dos próprios pés e, abaixo deles, só dentro da fenda */}
          {middle.map(({p, i}) => (
            <clipPath key={i} id={`ta-fall-${i}`}>
              <rect x={-100} y={-400} width={1140} height={p.y + 407} />
              <path d={chasmD} />
            </clipPath>
          ))}
        </defs>

        {/* sombra do bloco */}
        <ellipse cx={CX} cy={716} rx={(380 + gap * 0.9) * groundIn} ry={24} fill="#000" opacity={0.35} />

        <g
          transform={`translate(${shakeX.toFixed(2)} ${(stageY + shakeY).toFixed(2)})`}
          opacity={Math.min(1, groundIn * 1.6)}
        >
          {/* fenda: fundo quase preto, paredes, brilho vermelho embaixo */}
          {openP > 0.002 ? (
            <g>
              <g clipPath="url(#ta-chasm)">
                <path d={chasmD} fill={ABYSS} />
                <path d={wallL} fill={WALL} />
                <path d={wallR} fill={WALL} />
                <path d={backWall} fill={WALL} />
                <ellipse cx={CX} cy={baseY + 10} rx={120} ry={170} fill="url(#ta-glow)" opacity={glowOp} />
                <ellipse cx={CX} cy={baseY + depth * 0.55} rx={60} ry={46} fill="url(#ta-core)" opacity={glowOp} />
                <path d={rimL} fill="none" stroke={accent} strokeWidth={3} opacity={0.45 * glowOp} />
                <path d={rimR} fill="none" stroke={accent} strokeWidth={3} opacity={0.45 * glowOp} />
              </g>
              <path d={vD} fill="none" stroke={EDGE} strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ) : null}

          {/* chão inteiro por baixo das metades (esconde a emenda antes de abrir) */}
          {openP < 0.01 ? (
            <g>
              <path d={poly(WHOLE_FRONT)} fill={SIDE} />
              <path d={BAND_D} fill={BAND} />
              <path d={poly(WHOLE_TOP)} fill="url(#ta-top)" />
              <path d={LIP_D} stroke={SAND} strokeWidth={5} opacity={0.7} />
            </g>
          ) : null}

          {/* as duas metades, cada uma com sua tenda e quem fica de pé */}
          {([-1, 1] as Side[]).map((side) => (
            <g key={side} transform={halfTransform(side, gap, tilt)}>
              <Half side={side} crackP={crackP} branchP={branchP} glowLine={glowLine} accent={accent}>
                {TENTS.filter((t) => t.side === side).map((t, i) => (
                  <g key={i} transform={`translate(${t.x} ${t.y}) scale(${(t.s * tentIn).toFixed(4)})`}>
                    <Tent />
                  </g>
                ))}
                {standing(side)}
              </Half>
            </g>
          ))}

          {/* luz vermelha vazando pela boca da fenda */}
          {openP > 0.002 ? (
            <ellipse cx={CX} cy={FRONT_Y + 30} rx={170} ry={70} fill="url(#ta-spill)" opacity={openP * pulse * 0.6} />
          ) : null}

          {/* poeira */}
          {CRACK_PUFFS.map((c, k) =>
            puff(`c${k}`, CRACK[c.pt][0] + c.side * 10, CRACK[c.pt][1] - 6, c.side, frame - abrirF - c.delay, 24, 24),
          )}
          {OPEN_PUFFS.map((c, k) =>
            puff(
              `o${k}`,
              CRACK[c.pt][0] + c.side * (gap * 0.7 + 14),
              CRACK[c.pt][1] - 8,
              c.side,
              frame - openF - c.delay,
              c.dur,
              c.r,
            ),
          )}

          {/* brasas subindo do fundo */}
          {emberIn > 0
            ? EMBERS.map((e, i) => {
                const u = ((frame - emberF) / e.period + e.off) % 1;
                const rise = Easing.out(Easing.quad)(u);
                const x = CX + e.dx * (0.5 + 0.5 * u) + Math.sin(u * 7 + i) * 8;
                const y = baseY + depth * 0.6 - rise * e.h;
                return (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={e.r * (1 - 0.4 * u)}
                    fill={i % 2 ? highlight : ORANGE}
                    opacity={emberIn * Math.sin(u * Math.PI) * 0.9}
                  />
                );
              })
            : null}

          {/* figuras do meio: ficam no ar sobre a fenda, depois caem girando e somem */}
          {middle.map(({p, i}) => {
            const t0 = fallStart(p.order);
            const fall = fallOf(p.order);
            if (fall >= 0.999) return null;
            const s = persp(p.y) * enter[i] * (1 - 0.72 * fall);
            if (s <= 0.001) return null;
            const hop = interpolate(frame, [t0, t0 + 5, t0 + 10], [0, -16, 0], {
              ...CLAMP,
              easing: Easing.inOut(Easing.sin),
            });
            const x = interpolate(fall, [0, 1], [p.x, CX]);
            const y = p.y + hop + fall * (FALL_TO - p.y);
            const teeter = Math.min(1, openP) * Math.sin(frame * 0.3 + i * 2.1) * 6;
            const rot = (teeter + Math.sin(frame * 0.08 + i * 1.3) * 2) * (1 - fall) + p.spin * fall;
            const op = interpolate(fall, [0.35, 0.85], [1, 0], CLAMP);
            return (
              <g key={i} clipPath={`url(#ta-fall-${i})`}>
                <g
                  transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rot.toFixed(2)} 0 ${(-55 * s).toFixed(2)}) scale(${s.toFixed(4)})`}
                  opacity={op}
                >
                  <ellipse cx={0} cy={0} rx={30} ry={7} fill="#000" opacity={0.25 * (1 - Math.min(1, openP))} />
                  <Figure p={p} arms={armsOf(i, fall * 30, 1)} panic={Math.max(panic[i], fall)} />
                </g>
              </g>
            );
          })}

          {/* pedrinhas saltando da rachadura e caindo na fenda */}
          {PEBBLES.map((b, i) => {
            const t = frame - openF - b.delay;
            const life = (2 * b.vy) / G + 12;
            if (t < 0 || t > life) return null;
            const x = b.x0 + b.vx * t;
            const y = b.y0 - b.vy * t + 0.5 * G * t * t;
            const op = interpolate(t, [0, 1, life - 10, life], [0, 1, 1, 0], CLAMP);
            const z = b.size;
            return (
              <path
                key={i}
                transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(t * b.spin).toFixed(1)})`}
                d={`M ${-z} 0 L ${-z * 0.5} ${-z * 0.8} L ${z * 0.6} ${-z * 0.7} L ${z} ${z * 0.1} L ${z * 0.3} ${z * 0.8} L ${-z * 0.6} ${z * 0.6} Z`}
                fill={b.color}
                stroke={EDGE}
                strokeWidth={3}
                strokeLinejoin="round"
                opacity={op}
              />
            );
          })}
        </g>
      </svg>
      {label ? (
        <div
          style={{
            position: 'absolute',
            top: 30,
            padding: '0 30px',
            fontWeight: 900,
            fontSize: labelFont,
            lineHeight: 1,
            color: accent,
            textTransform: 'uppercase',
            textAlign: 'center',
            transform: `scale(${labelIn})`,
            ...outline(12),
          }}
        >
          {label}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
