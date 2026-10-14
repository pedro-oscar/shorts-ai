import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * "Como é que você vai apagar fogo com fogo?": um balde joga uma bola de FOGO numa fogueira
 * para "apagá-la" e ela só cresce (≈1,8×), soltando brasas. Rótulo no topo no fim.
 */
const INK = '#1d130d';
const ORANGE = '#FF8A1F';
const WOOD = '#8b5a2b';
const WOOD_DARK = '#5e3a19';
const WOOD_END = '#d9a066';
const METAL = '#9aa6b2';
const METAL_DARK = '#5f6b77';
const PAPER = '#f4efe4';
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// Base da chama (o topo 0–150 px fica livre para o rótulo, mesmo com a chama crescida).
const FX = 380;
const FY = 630;
const FLAME_W = 140;
const FLAME_H = 210;

// Balde (inclinado, à direita).
const BX = 770;
const BY = 370;
const BS = 1.2;
const ROT_TIP = -62;
const MOUTH = {
  x: BX + 78 * BS * Math.sin((ROT_TIP * Math.PI) / 180),
  y: BY - 78 * BS * Math.cos((ROT_TIP * Math.PI) / 180),
};
const TARGET = {x: FX, y: FY - 120};
const ARC_LIFT = 150;
const FLIGHT = 12; // quadros de voo da bola de fogo
const EMBERS = 16;

/** Chama com 3 línguas; base em (0,0), ponta em (~0,-h). `t` anima a forma suavemente. */
const flamePath = (w: number, h: number, t: number, k: number) => {
  const s = (a: number, b: number) => Math.sin(t * a + k * b);
  const tipX = s(0.21, 1.3) * w * 0.18;
  const tipY = -h * (1 + 0.06 * s(0.33, 2.1));
  const lX = -w * 0.62 + s(0.27, 0.7) * w * 0.1;
  const lY = -h * (0.6 + 0.07 * s(0.4, 1.9));
  const rX = w * 0.64 + s(0.24, 2.6) * w * 0.1;
  const rY = -h * (0.66 + 0.07 * s(0.37, 0.4));
  const n = (v: number) => v.toFixed(1);
  return [
    `M ${n(-w)} 0`,
    `C ${n(-w * 1.05)} ${n(-h * 0.3)} ${n(lX - w * 0.08)} ${n(lY + h * 0.18)} ${n(lX)} ${n(lY)}`,
    `C ${n(lX + w * 0.06)} ${n(lY + h * 0.16)} ${n(-w * 0.34)} ${n(-h * 0.55)} ${n(-w * 0.22)} ${n(-h * 0.42)}`,
    `C ${n(-w * 0.12)} ${n(-h * 0.62)} ${n(tipX - w * 0.12)} ${n(tipY + h * 0.25)} ${n(tipX)} ${n(tipY)}`,
    `C ${n(tipX + w * 0.12)} ${n(tipY + h * 0.25)} ${n(w * 0.3)} ${n(-h * 0.6)} ${n(w * 0.26)} ${n(-h * 0.44)}`,
    `C ${n(w * 0.38)} ${n(-h * 0.6)} ${n(rX - w * 0.06)} ${n(rY + h * 0.16)} ${n(rX)} ${n(rY)}`,
    `C ${n(rX + w * 0.08)} ${n(rY + h * 0.18)} ${n(w * 1.05)} ${n(-h * 0.3)} ${n(w)} 0`,
    `C ${n(w * 0.7)} ${n(h * 0.12)} ${n(-w * 0.7)} ${n(h * 0.12)} ${n(-w)} 0 Z`,
  ].join(' ');
};

/** Chama em camadas: accent por fora, laranja no meio, highlight no miolo. */
const Flame: React.FC<{w: number; h: number; t: number; accent: string; highlight: string; stroke?: number}> = ({
  w,
  h,
  t,
  accent,
  highlight,
  stroke = 8,
}) => (
  <g>
    <path d={flamePath(w, h, t, 0)} fill={accent} stroke={INK} strokeWidth={stroke} strokeLinejoin="round" />
    <path d={flamePath(w * 0.74, h * 0.76, t * 1.15, 2)} fill={ORANGE} />
    <path d={flamePath(w * 0.44, h * 0.5, t * 1.3, 4)} fill={highlight} />
  </g>
);

const Log: React.FC<{rot: number; dy: number; len: number}> = ({rot, dy, len}) => (
  <g transform={`translate(0 ${dy}) rotate(${rot})`}>
    <rect x={-len} y={-26} width={len * 2} height={52} rx={26} fill={WOOD} stroke={INK} strokeWidth={8} />
    <path
      d={`M ${-len + 40} -7 L ${len * 0.2} -7 M ${-len * 0.1} 10 L ${len - 50} 10`}
      stroke={WOOD_DARK}
      strokeWidth={6}
      strokeLinecap="round"
    />
    <ellipse cx={len - 16} cy={0} rx={14} ry={21} fill={WOOD_END} stroke={INK} strokeWidth={6} />
    <ellipse cx={len - 16} cy={0} rx={5} ry={9} fill="none" stroke={WOOD_DARK} strokeWidth={4} />
  </g>
);

const ballAt = (t: number) => ({
  x: MOUTH.x + (TARGET.x - MOUTH.x) * t,
  y: MOUTH.y + (TARGET.y - MOUTH.y) * t - Math.sin(Math.PI * t) * ARC_LIFT,
});

export const FogoComFogo: React.FC<
  SceneProps & {label?: string; jogarAt?: number; labelAt?: number; balde?: string}
> = ({label = 'Não apaga!', jogarAt = 0.8, labelAt = 2.0, balde = 'Feitiço', accent, highlight}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const jogarF = Math.round(jogarAt * fps);
  const bucketF = jogarF - Math.round(0.4 * fps);
  const hitF = jogarF + FLIGHT;
  const tHit = frame - hitF;

  // Entrada escalonada: sombra → lenha → chama.
  const shadowIn = spring({frame, fps, config: {damping: 14}});
  const logsIn = spring({frame: frame - 2, fps, config: {damping: 12, stiffness: 140}});
  const fireIn = spring({frame: frame - 6, fps, config: {damping: 9, stiffness: 120}});

  // Crescimento depois do impacto (overshoot) e tremulação mais rápida.
  const grow = spring({frame: frame - hitF, fps, config: {damping: 7, stiffness: 120, mass: 0.9}});
  const flameScale = fireIn * (1 + 0.8 * grow);
  const flickerT = frame + 0.7 * Math.max(0, tHit);

  // Balde.
  const bIn = spring({frame: frame - bucketF, fps, config: {damping: 13, stiffness: 140}});
  const tip = spring({frame: frame - (jogarF - 5), fps, config: {damping: 12, stiffness: 220}});
  const settle = spring({frame: frame - hitF, fps, config: {damping: 14}});
  const bucketRot = -15 + (ROT_TIP + 15) * tip + 34 * settle + (1 - bIn) * 30;
  const bucketX = BX + (1 - bIn) * 420;
  const bucketFlame = Math.max(0, 1 - spring({frame: frame - jogarF, fps, config: {damping: 14, stiffness: 200}}));
  const baldeFont = Math.min(34, 128 / Math.max(1, balde.length * 0.68));

  // Bola de fogo em arco.
  const flying = frame >= jogarF && frame <= hitF;
  const ballT = interpolate(frame, [jogarF, hitF], [0, 1], {...CLAMP, easing: Easing.inOut(Easing.quad)});
  const ball = ballAt(ballT);
  const ahead = ballAt(ballT + 0.03);
  const behind = ballAt(ballT - 0.03);
  const ballAngle = (Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) / Math.PI;
  const ballPop = spring({frame: frame - jogarF, fps, config: {damping: 12, stiffness: 220}});
  const ballScale = ballPop * interpolate(ballT, [0.8, 1], [1, 0.65], CLAMP);
  const tailLen = 140 + Math.sin(frame * 1.3) * 18;

  // Impacto e brilho.
  const ringR = interpolate(tHit, [0, 14], [60, 300], {...CLAMP, easing: Easing.out(Easing.quad)});
  const ringOp = interpolate(tHit, [0, 2, 14], [0, 0.9, 0], CLAMP);
  const flashOp = interpolate(tHit, [0, 1, 8], [0, 0.85, 0], CLAMP);
  const glowR = (210 + 150 * grow) * fireIn;
  const glowOp = (0.32 + 0.33 * Math.min(grow, 1.2)) * (0.92 + 0.08 * Math.sin(frame * 0.5));

  const labelIn = spring({frame: frame - labelAt * fps, fps, config: {damping: 10}});

  return (
    <AbsoluteFill style={{fontFamily: FONT, alignItems: 'center'}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        <defs>
          <radialGradient id="fogo-glow">
            <stop offset="0%" stopColor={highlight} stopOpacity={0.9} />
            <stop offset="45%" stopColor={accent} stopOpacity={0.45} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* sombra + reflexo laranja no chão */}
        <ellipse cx={FX} cy={700} rx={(250 + 90 * grow) * shadowIn} ry={30} fill="#000" opacity={0.35} />
        <ellipse cx={FX} cy={698} rx={(180 + 120 * grow) * fireIn} ry={22} fill={ORANGE} opacity={0.25 * grow} />
        {bIn > 0.001 ? (
          <ellipse cx={bucketX} cy={704} rx={90 * bIn} ry={14} fill="#000" opacity={0.25} />
        ) : null}

        {/* brilho radial */}
        <circle cx={FX} cy={FY - 110} r={Math.max(0, glowR)} fill="url(#fogo-glow)" opacity={glowOp} />

        {/* tora de trás */}
        <g transform={`translate(${FX} ${FY + 18}) scale(${logsIn})`}>
          <Log rot={16} dy={0} len={190} />
        </g>

        {/* chama */}
        <g transform={`translate(${FX} ${FY}) scale(${flameScale})`}>
          <Flame w={FLAME_W} h={FLAME_H} t={flickerT} accent={accent} highlight={highlight} stroke={8 / Math.max(1, flameScale)} />
        </g>

        {/* toras da frente */}
        <g transform={`translate(${FX} ${FY + 18}) scale(${logsIn})`}>
          <Log rot={-16} dy={4} len={190} />
          <Log rot={183} dy={30} len={160} />
        </g>

        {/* brasas subindo (posições determinísticas por índice) */}
        {Array.from({length: EMBERS}).map((_, i) => {
          const tt = tHit - ((i * 5) % 17);
          if (tt < 0) return null;
          const life = 26 + ((i * 11) % 14);
          const cyc = tt % life;
          const p = cyc / life;
          const x = FX + (((i * 73) % 240) - 120) * (0.6 + 0.6 * p) + Math.sin(cyc * 0.25 + i) * 18;
          const rise = 210 + ((i * 37) % 130);
          const y = FY - 90 - rise * Easing.out(Easing.quad)(p);
          const op = interpolate(p, [0, 0.12, 0.7, 1], [0, 1, 0.9, 0]);
          const s = (5 + (i % 3) * 3) * (1 - 0.5 * p);
          return (
            <rect
              key={i}
              x={-s}
              y={-s}
              width={s * 2}
              height={s * 2}
              transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${45 + cyc * 8})`}
              fill={i % 2 ? highlight : ORANGE}
              stroke={INK}
              strokeWidth={2}
              opacity={op}
            />
          );
        })}

        {/* impacto */}
        {tHit >= 0 ? (
          <g>
            <circle cx={TARGET.x} cy={TARGET.y} r={ringR} fill="none" stroke={highlight} strokeWidth={14} opacity={ringOp} />
            <circle cx={TARGET.x} cy={TARGET.y} r={ringR * 0.6} fill={highlight} opacity={flashOp * 0.6} />
          </g>
        ) : null}

        {/* balde (com fogo dentro) */}
        {frame >= bucketF ? (
          <g transform={`translate(${bucketX} ${BY}) rotate(${bucketRot}) scale(${BS})`}>
            <path d="M -86 -70 Q 0 -190 86 -70" fill="none" stroke={INK} strokeWidth={8} strokeLinecap="round" />
            <path
              d="M -88 -78 L 88 -78 L 66 82 Q 0 96 -66 82 Z"
              fill={METAL}
              stroke={INK}
              strokeWidth={8}
              strokeLinejoin="round"
            />
            <path d="M -82 -40 L 82 -40 M -70 58 L 70 58" stroke={METAL_DARK} strokeWidth={7} strokeLinecap="round" />
            <path d="M -60 -66 L -46 70" stroke="#fff" strokeWidth={7} strokeLinecap="round" opacity={0.45} />
            <rect x={-70} y={-24} width={140} height={56} rx={10} fill={PAPER} stroke={INK} strokeWidth={5} />
            <text
              x={0}
              y={4 + baldeFont * 0.36}
              textAnchor="middle"
              fontFamily={FONT}
              fontWeight={900}
              fontSize={baldeFont}
              fill={INK}
            >
              {balde}
            </text>
            <ellipse cx={0} cy={-78} rx={90} ry={18} fill={METAL_DARK} stroke={INK} strokeWidth={7} />
            {bucketFlame > 0.001 ? (
              <g transform={`translate(0 -80) scale(${bucketFlame})`}>
                <Flame w={52} h={72} t={frame * 1.4} accent={accent} highlight={highlight} stroke={6} />
              </g>
            ) : null}
          </g>
        ) : null}

        {/* bola de fogo + rastro */}
        {flying ? (
          <g>
            {[1, 2, 3, 4].map((k) => {
              const tk = ballT - k * 0.07;
              if (tk <= 0) return null;
              const pk = ballAt(tk);
              return (
                <circle
                  key={k}
                  cx={pk.x}
                  cy={pk.y}
                  r={(30 - k * 6) * ballScale}
                  fill={k % 2 ? ORANGE : accent}
                  stroke={INK}
                  strokeWidth={3}
                  opacity={0.85 - k * 0.15}
                />
              );
            })}
            <g transform={`translate(${ball.x.toFixed(1)} ${ball.y.toFixed(1)}) rotate(${ballAngle.toFixed(1)}) scale(${ballScale})`}>
              <path
                d={`M 0 -46 C -50 -42 ${-tailLen * 0.7} -14 ${-tailLen} 0 C ${-tailLen * 0.7} 14 -50 42 0 46 A 46 46 0 0 0 0 -46 Z`}
                fill={accent}
                stroke={INK}
                strokeWidth={7}
                strokeLinejoin="round"
              />
              <path
                d={`M 0 -32 C -36 -28 ${-tailLen * 0.5} -8 ${-tailLen * 0.7} 0 C ${-tailLen * 0.5} 8 -36 28 0 32 A 32 32 0 0 0 0 -32 Z`}
                fill={ORANGE}
              />
              <circle cx={4} cy={0} r={18} fill={highlight} />
            </g>
          </g>
        ) : null}
      </svg>
      {label ? (
        <div
          style={{
            position: 'absolute',
            top: 24,
            padding: '0 30px',
            fontWeight: 900,
            fontSize: 80,
            lineHeight: 1,
            color: highlight,
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
