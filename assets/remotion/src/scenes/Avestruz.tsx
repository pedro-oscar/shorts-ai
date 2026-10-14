import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * "Elas pensam que se ignorarem o diabo, o diabo vai deixá-las quietas. Inocentes": um avestruz
 * enterra a cabeça na areia e fica de rabo para cima, tremendo, enquanto atrás dele uma sombra
 * enorme com chifres cresce do chão e acende os olhos vermelhos.
 */

const INK = '#17110f';
const PINK = '#f4aca6';
const BEAK = '#f2c08c';
const FEATHER = '#26222b';
const FEATHER_LIGHT = '#3d3846';
const PLUME = '#fbfbf7';
const SAND = '#ecd39c';
const SAND_FRONT = '#dfbd7c';
const SAND_MOUND = '#e7c785';
const SAND_LINE = '#b8924f';
const GRAIN = '#c99a52';
const DEVIL = '#140a12';
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const EASE = Easing.inOut(Easing.cubic);

type Pt = {x: number; y: number};

const PIVOT: Pt = {x: 410, y: 528}; // quadril: o corpo gira em torno daqui
const NECK_BASE: Pt = {x: 322, y: 448};
const HIP_L: Pt = {x: 380, y: 522};
const HIP_R: Pt = {x: 434, y: 522};
const JOINT_L: Pt = {x: 398, y: 612};
const JOINT_R: Pt = {x: 454, y: 610};
const FOOT_L: Pt = {x: 378, y: 698};
const FOOT_R: Pt = {x: 438, y: 698};

// Pescoço: pontos de controle em pé → enterrado.
const NECK_UP = {p1: {x: 300, y: 380}, p2: {x: 318, y: 300}, p3: {x: 292, y: 238}};
const NECK_DOWN = {p1: {x: 240, y: 475}, p2: {x: 200, y: 560}, p3: {x: 212, y: 684}};

const BURY: Pt = {x: 212, y: 654}; // topo do montinho de areia

const GRAINS = [
  {vx: -210, vy: -360, r: 7},
  {vx: -140, vy: -500, r: 5},
  {vx: -60, vy: -590, r: 8},
  {vx: 20, vy: -620, r: 6},
  {vx: 90, vy: -540, r: 5},
  {vx: 160, vy: -430, r: 7},
  {vx: 230, vy: -320, r: 6},
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t)});

/** Rotação no sentido do `rotate()` do SVG (horário na tela). */
const rotAround = (p: Pt, c: Pt, deg: number): Pt => {
  const r = (deg * Math.PI) / 180;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return {x: c.x + dx * Math.cos(r) - dy * Math.sin(r), y: c.y + dx * Math.sin(r) + dy * Math.cos(r)};
};

const Leg: React.FC<{hip: Pt; joint: Pt; foot: Pt}> = ({hip, joint, foot}) => {
  const d = `M ${hip.x} ${hip.y} L ${joint.x} ${joint.y} L ${foot.x} ${foot.y}`;
  return (
    <g>
      <path d={d} fill="none" stroke={INK} strokeWidth={26} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={PINK} strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={joint.x} cy={joint.y} r={11} fill={PINK} stroke={INK} strokeWidth={6} />
      <ellipse cx={foot.x - 16} cy={foot.y + 4} rx={26} ry={10} fill={PINK} stroke={INK} strokeWidth={6} />
    </g>
  );
};

/** Cabeça de perfil olhando para a esquerda; origem = ponta do pescoço. */
const Head: React.FC = () => (
  <g>
    <path d="M -28 -20 L -64 -8 Q -67 -3 -62 0 L -28 4 Z" fill={BEAK} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
    <circle cx={-10} cy={-10} r={24} fill={PINK} stroke={INK} strokeWidth={7} />
    <path d="M -14 -33 L -18 -46 M -6 -34 L -4 -48 M 2 -32 L 10 -44" stroke={INK} strokeWidth={4} strokeLinecap="round" />
    <circle cx={-16} cy={-15} r={8} fill="#fff" stroke={INK} strokeWidth={3} />
    <circle cx={-19} cy={-14} r={4} fill={INK} />
    <path d="M -24 -24 L -28 -29 M -18 -25 L -19 -31" stroke={INK} strokeWidth={3} strokeLinecap="round" />
  </g>
);

const DEVIL_PATH = [
  'M -150 0',
  'C -146 -110 -138 -230 -116 -290',
  'Q -102 -325 -58 -335',
  'C -78 -360 -76 -420 -50 -440',
  'C -72 -460 -110 -482 -122 -518',
  'C -80 -502 -50 -482 -30 -456',
  'Q 0 -466 30 -456',
  'C 50 -482 80 -502 122 -518',
  'C 110 -482 72 -460 50 -440',
  'C 76 -420 78 -360 58 -335',
  'Q 102 -325 116 -290',
  'C 138 -230 146 -110 150 0',
  'Z',
].join(' ');

export const Avestruz: React.FC<
  SceneProps & {label?: string; enterrarAt?: number; sombraAt?: number; labelAt?: number}
> = ({label = 'Cabeça na areia', enterrarAt = 0.3, sombraAt = 2.0, labelAt = 0.9, accent, highlight}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enterF = Math.round(enterrarAt * fps);
  const sombraF = Math.round(sombraAt * fps);

  const labelIn = spring({frame: frame - labelAt * fps, fps, config: {damping: 10}});

  // Enterrar: pescoço curva para baixo em ~0,6 s.
  const bury = spring({
    frame: frame - enterF,
    fps,
    config: {damping: 14, stiffness: 120},
    durationInFrames: Math.round(0.6 * fps),
  });
  const settled = interpolate(bury, [0.7, 1], [0, 1], CLAMP);
  const moundIn = spring({frame: frame - enterF - 9, fps, config: {damping: 9, stiffness: 180}});
  const splashF = enterF + 11;

  // Sombra: cresce, olhos acendem, piscam uma vez; céu escurece.
  const grow = spring({frame: frame - sombraF, fps, config: {damping: 11, stiffness: 80}});
  const devilScale = interpolate(grow, [0, 1], [0.3, 1]);
  const devilOp = interpolate(grow, [0, 0.25], [0, 0.86], CLAMP);
  const breathe = 1 + 0.02 * Math.sin(frame / 7) * grow;
  const eyesOn = spring({frame: frame - sombraF - 14, fps, config: {damping: 16, stiffness: 140}});
  const blinkF = sombraF + 34;
  const blink = interpolate(frame, [blinkF, blinkF + 3, blinkF + 7], [1, 0.08, 1], {...CLAMP, easing: EASE});
  const dark = spring({frame: frame - sombraF, fps, config: {damping: 200}, durationInFrames: Math.round(0.9 * fps)});

  // Tremedeira: começa ao enterrar e piora quando a sombra aparece.
  const shakeAmp = settled * (1 + 1.8 * eyesOn);
  const shake = Math.sin(frame * 2.1) * shakeAmp;
  const bodyAng = -22 * bury + shake;

  // Pescoço e cabeça.
  const sway = Math.sin(frame / 5) * 4 * (1 - bury);
  const p0 = rotAround(NECK_BASE, PIVOT, bodyAng);
  const p1 = lerpPt(NECK_UP.p1, NECK_DOWN.p1, bury);
  const p2 = lerpPt(NECK_UP.p2, NECK_DOWN.p2, bury);
  const p3 = lerpPt({x: NECK_UP.p3.x + sway, y: NECK_UP.p3.y}, NECK_DOWN.p3, bury);
  const neckD = `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}`;
  const headAng = interpolate(bury, [0, 1], [0, -90]) + sway * 1.5;
  const headOp = interpolate(bury, [0.7, 0.88], [1, 0], CLAMP);

  const hipL = rotAround(HIP_L, PIVOT, bodyAng);
  const hipR = rotAround(HIP_R, PIVOT, bodyAng);
  const plumeWag = Math.sin(frame * 2.3) * 5 * shakeAmp;
  const trembleOp = settled * (0.55 + 0.45 * Math.sin(frame * 0.9));

  return (
    <AbsoluteFill style={{fontFamily: FONT, alignItems: 'center'}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        <defs>
          <linearGradient id="avestruz-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#9fd8ef" />
            <stop offset="0.75" stopColor="#fdf0d2" />
          </linearGradient>
          <clipPath id="avestruz-box">
            <rect x={0} y={0} width={940} height={760} rx={36} />
          </clipPath>
          <filter id="avestruz-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation={8} />
          </filter>
        </defs>

        <g clipPath="url(#avestruz-box)">
          {/* céu, sol e dunas */}
          <rect x={0} y={0} width={940} height={760} fill="url(#avestruz-sky)" />
          <circle cx={130} cy={190} r={52} fill={highlight} opacity={0.9} />
          <path d="M 0 590 Q 200 540 420 575 Q 650 610 940 555 L 940 760 L 0 760 Z" fill={SAND} stroke={SAND_LINE} strokeWidth={6} />
          <path d="M 0 672 Q 260 640 520 686 Q 760 722 940 676 L 940 760 L 0 760 Z" fill={SAND_FRONT} />
          <path
            d="M 540 615 q 30 -10 60 0 M 80 625 q 30 -10 60 0 M 620 735 q 40 -12 80 0 M 120 730 q 40 -12 80 0"
            fill="none"
            stroke={SAND_LINE}
            strokeWidth={4}
            strokeLinecap="round"
            opacity={0.6}
          />

          {/* céu escurecendo */}
          <rect x={0} y={0} width={940} height={760} fill="#1a0a1e" opacity={0.35 * dark} />

          {/* sombra do diabo atrás */}
          <ellipse cx={770} cy={652} rx={170 * grow} ry={18} fill="#000" opacity={0.3 * grow} />
          <g
            transform={`translate(770 650) scale(${devilScale * breathe} ${devilScale})`}
            opacity={devilOp}
          >
            <path d={DEVIL_PATH} fill={DEVIL} strokeLinejoin="round" />
          </g>
          <g transform={`translate(770 650) scale(${devilScale * breathe} ${devilScale})`} opacity={eyesOn}>
            <g transform={`translate(0 -388) scale(1 ${blink}) translate(0 388)`}>
              <g filter="url(#avestruz-glow)">
                <circle cx={-32} cy={-388} r={22} fill={accent} />
                <circle cx={32} cy={-388} r={22} fill={accent} />
              </g>
              <path d="M -56 -398 Q -28 -406 -10 -380 Q -36 -374 -56 -398 Z" fill={accent} />
              <path d="M 56 -398 Q 28 -406 10 -380 Q 36 -374 56 -398 Z" fill={accent} />
            </g>
            <path
              d="M -32 -352 L -21 -343 L -10 -352 L 0 -343 L 10 -352 L 21 -343 L 32 -352"
              fill="none"
              stroke={accent}
              strokeWidth={4}
              strokeLinejoin="round"
              opacity={0.7}
            />
          </g>

          {/* avestruz */}
          <ellipse cx={410} cy={704} rx={125} ry={16} fill="#000" opacity={0.25} />
          <Leg hip={hipR} joint={JOINT_R} foot={FOOT_R} />
          <Leg hip={hipL} joint={JOINT_L} foot={FOOT_L} />
          <path d={neckD} fill="none" stroke={INK} strokeWidth={34} strokeLinecap="round" />
          <path d={neckD} fill="none" stroke={PINK} strokeWidth={21} strokeLinecap="round" />

          <g transform={`rotate(${bodyAng} ${PIVOT.x} ${PIVOT.y})`}>
            <g transform={`rotate(${plumeWag} 500 445)`}>
              {[-42, -12, 18].map((a) => (
                <ellipse
                  key={a}
                  cx={550}
                  cy={445}
                  rx={46}
                  ry={19}
                  transform={`rotate(${a} 500 445)`}
                  fill={PLUME}
                  stroke={INK}
                  strokeWidth={6}
                />
              ))}
            </g>
            <ellipse cx={410} cy={468} rx={112} ry={68} fill={FEATHER} stroke={INK} strokeWidth={7} />
            <path
              d="M 340 445 Q 420 405 500 440 Q 455 486 352 474 Z"
              fill={FEATHER_LIGHT}
              stroke={INK}
              strokeWidth={5}
              strokeLinejoin="round"
            />
            <path
              d="M 372 470 q 15 14 30 0 q 15 14 30 0 q 15 14 30 0"
              fill="none"
              stroke="#5a5463"
              strokeWidth={4}
              strokeLinecap="round"
            />
            {/* risquinhos de tremedeira */}
            <g opacity={trembleOp}>
              {[
                'M 612 392 q 10 14 0 28',
                'M 632 382 q 14 22 0 46',
                'M 596 340 q -4 -16 8 -26',
              ].map((d) => (
                <g key={d}>
                  <path d={d} fill="none" stroke={INK} strokeWidth={11} strokeLinecap="round" />
                  <path d={d} fill="none" stroke={highlight} strokeWidth={6} strokeLinecap="round" />
                </g>
              ))}
            </g>
          </g>

          <g transform={`translate(${p3.x} ${p3.y}) rotate(${headAng})`} opacity={headOp}>
            <Head />
          </g>

          {/* montinho de areia por cima da cabeça */}
          <g transform={`translate(${BURY.x} 708) scale(${0.5 + 0.5 * moundIn} ${moundIn}) translate(${-BURY.x} -708)`}>
            <path d="M 130 708 Q 160 656 212 652 Q 264 656 294 708 Q 212 716 130 708 Z" fill={SAND_MOUND} />
            <path d="M 130 708 Q 160 656 212 652 Q 264 656 294 708" fill="none" stroke={SAND_LINE} strokeWidth={6} strokeLinecap="round" />
          </g>

          {/* grãos espirrando */}
          {GRAINS.map((g, i) => {
            const t = (frame - splashF - (i % 3)) / fps;
            if (t < 0 || t > 0.9) return null;
            const x = BURY.x + g.vx * t;
            const y = BURY.y + g.vy * t + 0.5 * 1500 * t * t;
            const op = interpolate(t, [0, 0.55, 0.85], [1, 1, 0], {...CLAMP, easing: EASE});
            return <circle key={i} cx={x} cy={y} r={g.r} fill={GRAIN} stroke="#7a5a2a" strokeWidth={2.5} opacity={op} />;
          })}
        </g>
      </svg>
      {label ? (
        <div
          style={{
            position: 'absolute',
            top: 30,
            fontWeight: 900,
            fontSize: Math.max(48, Math.min(80, Math.floor(1220 / label.length))),
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
