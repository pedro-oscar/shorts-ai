import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

type Tipo = 'site' | 'texto';

// Grade de 3 colunas; cada item é desenhado em coordenadas locais centradas (270×184).
const COLS = 3;
const CW = 270;
const CH = 184;
const GAP = 24;
const MAX_H = 620;
const CX = 470;
const CY = 345;
const STAGGER = 3;
const PULSE_EVERY = 28;
const GRAD_ID = 'clones-hero-grad';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/** Mini janela de navegador: barra com 3 bolinhas, hero em degradê, título, 2 linhas e botão. */
const SiteItem: React.FC<{accent: string; highlight: string}> = ({accent, highlight}) => (
  <g>
    <rect x={-135} y={-92} width={270} height={184} rx={16} fill="#f8fafc" />
    <path d="M -135 -62 V -76 A 16 16 0 0 1 -119 -92 H 119 A 16 16 0 0 1 135 -76 V -62 Z" fill="#e2e8f0" />
    <line x1={-135} y1={-62} x2={135} y2={-62} stroke="#000" strokeWidth={4} />
    <circle cx={-112} cy={-77} r={6} fill={accent} stroke="#000" strokeWidth={2} />
    <circle cx={-94} cy={-77} r={6} fill={highlight} stroke="#000" strokeWidth={2} />
    <circle cx={-76} cy={-77} r={6} fill="#22c55e" stroke="#000" strokeWidth={2} />
    <rect x={-54} y={-83} width={150} height={12} rx={6} fill="#fff" stroke="#000" strokeWidth={2} />
    <rect x={-123} y={-52} width={246} height={84} rx={10} fill={`url(#${GRAD_ID})`} stroke="#000" strokeWidth={3} />
    <rect x={-82} y={-41} width={164} height={22} rx={6} fill="#fff" />
    <rect x={-42} y={-11} width={84} height={26} rx={13} fill="#fff" stroke="#000" strokeWidth={3} />
    <rect x={-24} y={-2} width={48} height={8} rx={4} fill="#7c3aed" />
    <rect x={-112} y={44} width={224} height={12} rx={6} fill="#cbd5e1" />
    <rect x={-84} y={66} width={168} height={12} rx={6} fill="#cbd5e1" />
    <rect x={-135} y={-92} width={270} height={184} rx={16} fill="none" stroke="#000" strokeWidth={5} />
  </g>
);

/** Folha/post: avatar, título e linhas de texto (todas iguais). */
const TextoItem: React.FC = () => (
  <g>
    <path
      d="M -121 -92 H 105 L 135 -62 V 78 Q 135 92 121 92 H -121 Q -135 92 -135 78 V -78 Q -135 -92 -121 -92 Z"
      fill="#f8fafc"
      stroke="#000"
      strokeWidth={5}
      strokeLinejoin="round"
    />
    <path d="M 105 -92 V -62 H 135" fill="#cbd5e1" stroke="#000" strokeWidth={4} strokeLinejoin="round" />
    <circle cx={-106} cy={-64} r={14} fill={`url(#${GRAD_ID})`} stroke="#000" strokeWidth={3} />
    <rect x={-82} y={-74} width={168} height={20} rx={6} fill="#1e293b" />
    {[236, 236, 236, 206, 128].map((w, i) => (
      <rect key={i} x={-118} y={-34 + i * 22} width={w} height={11} rx={5.5} fill="#94a3b8" />
    ))}
  </g>
);

/**
 * "Um monte de site com a mesma cara": grade de mini sites (ou posts) idênticos que entram em
 * sequência, pulsam juntos e recebem um carimbo com o `label` (ex.: "Cara de IA").
 */
export const Clones: React.FC<SceneProps & {label?: string; n?: number; tipo?: Tipo}> = ({
  label = '',
  n = 9,
  tipo = 'site',
  accent,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const count = Number.isFinite(n) ? Math.max(4, Math.min(12, Math.round(n))) : 9;
  const rows = Math.ceil(count / COLS);
  const fullW = COLS * CW + (COLS - 1) * GAP;
  const fullH = rows * CH + (rows - 1) * GAP;
  const s = Math.min(1, MAX_H / fullH);
  const gridW = fullW * s;
  const gridH = fullH * s;

  // Tempo: entrada escalonada → pulso sincronizado (repete) → carimbo.
  const pulseStart = (count - 1) * STAGGER + 12;
  const stampStart = Math.max(45, pulseStart + 9);
  const pulseT = frame < pulseStart ? -1 : (frame - pulseStart) % PULSE_EVERY;
  const pulse =
    pulseT < 0 ? 1 : interpolate(pulseT, [0, 5, 12], [1, 1.05, 1], {...clamp, easing: Easing.inOut(Easing.quad)});

  const stamp = label ? spring({frame: frame - stampStart, fps, config: {damping: 13, stiffness: 220, mass: 0.8}}) : 0;
  const stampScale = interpolate(stamp, [0, 1], [2, 1]);
  const stampOpacity = interpolate(stamp, [0, 0.25], [0, 1], clamp);
  const hitT = frame - stampStart - 4;
  const shakeAmp = label && hitT >= 0 ? interpolate(hitT, [0, 14], [7, 0], {...clamp, easing: Easing.out(Easing.cubic)}) : 0;
  const shakeX = Math.sin(hitT * 2.6) * shakeAmp;
  const shakeY = Math.cos(hitT * 3.3) * shakeAmp * 0.6;
  const gridOpacity = interpolate(stamp, [0, 1], [1, 0.82], clamp);

  const shadowIn = spring({frame, fps, config: {damping: 20}});
  const item = tipo === 'texto' ? <TextoItem /> : <SiteItem accent={accent} highlight={highlight} />;
  const fontSize = label.length <= 11 ? 96 : label.length <= 16 ? 80 : 66;

  return (
    <AbsoluteFill style={{fontFamily: FONT}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        <defs>
          <linearGradient id={GRAD_ID} x1="0" y1="0" x2="1" y2="0.6">
            <stop offset="0" stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
        <ellipse
          cx={CX}
          cy={CY + gridH / 2 + 40}
          rx={(gridW / 2) * 0.9 * shadowIn}
          ry={26}
          fill="#000"
          opacity={0.35 * shadowIn}
        />
        <g transform={`translate(${CX + shakeX * 0.5} ${CY + shakeY * 0.5}) scale(${s})`} opacity={gridOpacity}>
          {Array.from({length: count}).map((_, i) => {
            const r = Math.floor(i / COLS);
            const c = i % COLS;
            const inRow = r === rows - 1 ? count - r * COLS : COLS;
            const rowOffset = ((COLS - inRow) * (CW + GAP)) / 2;
            const x = -fullW / 2 + rowOffset + c * (CW + GAP) + CW / 2;
            const y = -fullH / 2 + r * (CH + GAP) + CH / 2;
            const pop = spring({frame: frame - i * STAGGER, fps, config: {damping: 12, stiffness: 180}});
            const rot = interpolate(pop, [0, 1], [i % 2 === 0 ? -12 : 10, 0]);
            return (
              <g key={i} transform={`translate(${x} ${y}) rotate(${rot}) scale(${pop * pulse})`}>
                {item}
              </g>
            );
          })}
        </g>
      </svg>
      {label ? (
        <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
          <div
            style={{
              transform: `translate(${shakeX}px, ${CY - 380 + shakeY}px) rotate(-8deg) scale(${stampScale})`,
              opacity: stampOpacity,
              maxWidth: 820,
              padding: '16px 40px',
              border: `10px solid ${accent}`,
              borderRadius: 18,
              background: 'rgba(11,13,18,0.85)',
              boxShadow: '0 0 0 5px #000, inset 0 0 0 5px #000, 0 18px 40px rgba(0,0,0,0.5)',
              fontWeight: 900,
              fontSize,
              lineHeight: 1.05,
              letterSpacing: 2,
              color: accent,
              textTransform: 'uppercase',
              textAlign: 'center',
              ...outline(10),
            }}
          >
            {label}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
