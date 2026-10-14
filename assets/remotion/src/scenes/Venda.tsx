import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * "Uma venda escura entrou na minha mente": rosto de um homem, de frente, sendo vendado por uma
 * faixa preta que entra da esquerda para a direita; as pontas do nó balançam, um véu escuro cresce
 * em volta e pontos de interrogação flutuam ao redor da cabeça.
 */
const SKIN = '#f2c29b';
const SKIN_DARK = '#d99c74';
const INK = '#1d130d';
const HAIR = '#2a1a10';
const SHIRT = '#34405a';
const BAND = '#121216';
const BAND_FOLD = '#2a2a33';
const BAND_RIM = '#6c7488';
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const HEAD_D =
  'M 470 196 C 568 196 624 266 624 372 C 624 472 580 560 470 580 ' +
  'C 360 560 316 472 316 372 C 316 266 372 196 470 196 Z';
const HAIR_D =
  'M 310 364 C 296 244 366 176 470 176 C 574 176 644 244 630 364 ' +
  'C 616 318 602 290 584 270 C 530 292 412 294 356 270 C 338 290 324 318 310 364 Z';
const BAND_D = 'M 294 350 Q 470 324 646 350 L 646 430 Q 470 452 294 430 Z';
// Ponta do nó com corte em "V" (rabo de andorinha), apontando para +x a partir da origem.
const TAIL_D = 'M 0 -15 C 48 -24 96 -10 142 -22 L 124 4 L 148 28 C 98 18 50 28 0 15 Z';

const QUESTIONS = [
  {x: 214, y: 300, size: 124, rot: -12, delay: 0},
  {x: 738, y: 262, size: 104, rot: 10, delay: 6},
  {x: 192, y: 540, size: 88, rot: -4, delay: 12},
];

const Tail: React.FC<{rot: number; len: number}> = ({rot, len}) => (
  <g transform={`rotate(${rot}) scale(${len} 1)`}>
    <path d={TAIL_D} fill="none" stroke={BAND_RIM} strokeWidth={14} strokeLinejoin="round" />
    <path d={TAIL_D} fill={BAND} stroke="#000" strokeWidth={6} strokeLinejoin="round" />
    <path d="M 10 -4 C 50 -10 90 -2 126 -10" fill="none" stroke="#fff" strokeWidth={3} opacity={0.25} />
  </g>
);

export const Venda: React.FC<SceneProps & {label?: string; vendarAt?: number; labelAt?: number}> = ({
  label = 'Não enxergava nada',
  vendarAt = 0.6,
  labelAt = 1.8,
  accent,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const vendF = Math.round(vendarAt * fps);
  const knotF = vendF + 7;
  const afterF = vendF + 10;

  // Entrada escalonada: sombra → busto.
  const shadowIn = spring({frame, fps, config: {damping: 14}});
  const headIn = spring({frame: frame - 2, fps, config: {damping: 11, stiffness: 140}});
  const labelIn = spring({frame: frame - labelAt * fps, fps, config: {damping: 10}});

  // Piscada única antes da venda.
  const blink = interpolate(frame, [9, 12, 15], [1, 0.08, 1], {...CLAMP, easing: Easing.inOut(Easing.quad)});

  // Venda: revelada da esquerda para a direita, puxão leve na cabeça quando chega ao nó.
  const bandP = spring({frame: frame - vendF, fps, config: {damping: 14, stiffness: 150}});
  const bandW = 400 * Math.min(1, Math.max(0, bandP));
  const tTug = frame - knotF;
  const tug = tTug >= 0 ? Math.sin(tTug * 0.5) * 5 * Math.exp(-tTug * 0.12) : 0;

  // Pontas do nó: balanço amortecido + leve oscilação contínua.
  const knotIn = spring({frame: frame - knotF, fps, config: {damping: 9, stiffness: 200}});
  const tk = Math.max(0, frame - knotF);
  const decay = Math.exp(-tk * 0.07);
  const swing1 = 24 * decay * Math.sin(tk * 0.42) + 3 * Math.sin(frame * 0.08);
  const swing2 = 20 * decay * Math.sin(tk * 0.42 + 0.9) + 3 * Math.sin(frame * 0.08 + 1.3);

  // Reação: sobrancelhas preocupadas, boca para baixo.
  const worry = spring({frame: frame - afterF, fps, config: {damping: 14}});

  // Véu escuro crescendo a partir da venda.
  const veilP = interpolate(frame, [afterF, afterF + 24], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
  const veilR = 80 + 640 * veilP;

  const showBand = frame >= vendF;
  const browL = `M 384 ${322 - 6 * worry} L 446 ${316 - 18 * worry}`;
  const browR = `M 494 ${316 - 18 * worry} L 556 ${322 - 6 * worry}`;
  const mouthY = 508;
  const mouth = `M 432 ${mouthY + 4 * worry} Q 470 ${mouthY + 16 - 36 * worry} 508 ${mouthY + 4 * worry}`;

  const labelSize = Math.max(48, Math.min(80, Math.floor(1220 / Math.max(1, label.length))));

  return (
    <AbsoluteFill style={{fontFamily: FONT, alignItems: 'center'}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        <defs>
          <radialGradient id="venda-veu">
            <stop offset="0%" stopColor="#000" stopOpacity={0.85} />
            <stop offset="55%" stopColor="#000" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#000" stopOpacity={0} />
          </radialGradient>
          <clipPath id="venda-clip">
            <rect x={270} y={290} width={bandW} height={180} />
          </clipPath>
        </defs>

        {/* véu atrás da cabeça */}
        {veilP > 0 ? <circle cx={470} cy={390} r={veilR} fill="url(#venda-veu)" opacity={0.75 * veilP} /> : null}

        <ellipse cx={470} cy={714} rx={290 * shadowIn} ry={28} fill="#000" opacity={0.35} />

        <g transform={`translate(470 700) scale(${headIn}) rotate(${tug}) translate(-470 -700)`}>
          {/* ombros + pescoço */}
          <path
            d="M 212 712 C 218 640 300 612 398 602 L 470 662 L 542 602 C 640 612 722 640 728 712 Z"
            fill={SHIRT}
            stroke={INK}
            strokeWidth={10}
            strokeLinejoin="round"
          />
          <path
            d="M 422 540 L 418 606 L 470 660 L 522 606 L 518 540 Z"
            fill={SKIN_DARK}
            stroke={INK}
            strokeWidth={9}
            strokeLinejoin="round"
          />

          {/* orelhas */}
          <ellipse cx={318} cy={398} rx={24} ry={42} fill={SKIN} stroke={INK} strokeWidth={8} />
          <ellipse cx={622} cy={398} rx={24} ry={42} fill={SKIN} stroke={INK} strokeWidth={8} />

          {/* cabeça + cabelo */}
          <path d={HEAD_D} fill={SKIN} stroke={INK} strokeWidth={10} strokeLinejoin="round" />
          <path d={HAIR_D} fill={HAIR} stroke={INK} strokeWidth={9} strokeLinejoin="round" />

          {/* rosto */}
          <path d={browL} fill="none" stroke={INK} strokeWidth={10} strokeLinecap="round" />
          <path d={browR} fill="none" stroke={INK} strokeWidth={10} strokeLinecap="round" />
          {[418, 522].map((cx) => (
            <g key={cx} transform={`translate(${cx} 382) scale(1 ${blink})`}>
              <ellipse rx={24} ry={24} fill="#fff" stroke={INK} strokeWidth={6} />
              <circle r={11} fill={INK} />
              <circle cx={-4} cy={-5} r={3.5} fill="#fff" />
            </g>
          ))}
          <path
            d="M 470 412 Q 456 452 464 460 Q 476 466 488 456"
            fill="none"
            stroke={INK}
            strokeWidth={7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d={mouth} fill="none" stroke={INK} strokeWidth={8} strokeLinecap="round" />

          {/* venda */}
          {showBand ? (
            <g>
              <g clipPath="url(#venda-clip)">
                <path d={BAND_D} fill="none" stroke={BAND_RIM} strokeWidth={16} strokeLinejoin="round" />
                <path d={BAND_D} fill={BAND} stroke="#000" strokeWidth={6} strokeLinejoin="round" />
                <path d="M 318 388 Q 470 368 622 388" fill="none" stroke={BAND_FOLD} strokeWidth={5} />
                <path d="M 318 412 Q 470 394 622 412" fill="none" stroke={BAND_FOLD} strokeWidth={4} />
                <path d="M 318 356 Q 470 334 622 356" fill="none" stroke="#fff" strokeWidth={5} opacity={0.3} />
              </g>
              {knotIn > 0.001 ? (
                <g transform={`translate(644 392)`}>
                  <Tail rot={14 + swing1} len={knotIn} />
                  <Tail rot={56 + swing2} len={knotIn * 0.85} />
                  <g transform={`scale(${knotIn})`}>
                    <ellipse rx={24} ry={28} fill="none" stroke={BAND_RIM} strokeWidth={14} />
                    <ellipse rx={24} ry={28} fill={BAND} stroke="#000" strokeWidth={6} />
                    <path d="M -10 -14 Q 0 -20 10 -14" fill="none" stroke="#fff" strokeWidth={4} opacity={0.3} />
                  </g>
                </g>
              ) : null}
            </g>
          ) : null}
        </g>

        {/* véu leve por cima, escurecendo o rosto */}
        {veilP > 0 ? <circle cx={470} cy={390} r={veilR} fill="url(#venda-veu)" opacity={0.22 * veilP} /> : null}

        {/* pontos de interrogação */}
        {QUESTIONS.map((q, i) => {
          const s = spring({frame: frame - (afterF + 6 + q.delay), fps, config: {damping: 9, stiffness: 180}});
          if (s <= 0.001) return null;
          const fy = Math.sin(frame * 0.09 + i * 2.1) * 10;
          const fr = Math.sin(frame * 0.07 + i * 1.7) * 7;
          return (
            <g key={i} transform={`translate(${q.x} ${q.y + fy}) rotate(${q.rot + fr}) scale(${s})`}>
              <text
                x={0}
                y={q.size * 0.36}
                textAnchor="middle"
                fontFamily={FONT}
                fontWeight={900}
                fontSize={q.size}
                fill={highlight}
                stroke={INK}
                strokeWidth={10}
                strokeLinejoin="round"
                paintOrder="stroke"
              >
                ?
              </text>
            </g>
          );
        })}
      </svg>
      {label ? (
        <div
          style={{
            position: 'absolute',
            top: 30,
            maxWidth: 900,
            fontWeight: 900,
            fontSize: labelSize,
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
