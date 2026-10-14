import React from 'react';
import {AbsoluteFill, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

type Step = {label: string; emoji?: string; at?: number};

const CARD_W = 720;
const CARD_X = (940 - CARD_W) / 2;
const MAX_H = 140;
const BOTTOM = 692;

/** Largura aproximada de Montserrat 900 em caixa alta, por caractere (em "em"). */
const CHAR_EM = 0.76;

/**
 * Etapas empilhadas na vertical (Gancho → Desenvolvimento → Payoff), cada uma surgindo no
 * segundo em que é falada (`at`, em segundos desde o início da cena), ligadas por setas que crescem.
 * A etapa mais recente fica maior/brilhante; a última entra em `accent` com um pulso.
 */
export const Etapas: React.FC<SceneProps & {title?: string; steps?: Step[]}> = ({
  title = '',
  steps = [
    {label: 'Gancho', emoji: '🪝'},
    {label: 'Desenvolvimento', emoji: '📈'},
    {label: 'Payoff', emoji: '💥'},
  ],
  accent,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (steps.length === 0) return null;
  const n = steps.length;

  // Frames de entrada (monotônicos, para as setas nunca andarem para trás).
  const starts: number[] = [];
  steps.forEach((s, i) => {
    const f = Math.round((s.at ?? i * 0.5) * fps);
    starts.push(i === 0 ? f : Math.max(f, starts[i - 1] + 2));
  });

  // Layout vertical: cartões de até 140 px; setas com metade da altura do cartão.
  const top = title ? 128 : 36;
  const avail = BOTTOM - top;
  const h = Math.min(MAX_H, avail / (n + 0.5 * (n - 1)));
  const gap = n > 1 ? Math.min(h * 0.75, (avail - n * h) / (n - 1)) : 0;
  const total = n * h + (n - 1) * gap;
  const y0 = top + (avail - total) / 2;
  const cardY = (i: number) => y0 + i * (h + gap);

  const enter = (i: number) => spring({frame: frame - (starts[i] - 1), fps, config: {damping: 12, stiffness: 150}});
  const settle = (i: number) =>
    i < n ? spring({frame: frame - starts[i], fps, config: {damping: 200}, durationInFrames: 8}) : 0;

  const titleIn = spring({frame: frame - 2, fps, config: {damping: 10}});
  const titleSize = Math.min(66, 880 / (Math.max(1, title.length) * CHAR_EM));
  const shadowIn = spring({frame: frame - starts[0], fps, config: {damping: 200}});

  // Pulso da última etapa: oscilação amortecida + anel que se expande.
  const tLast = frame - starts[n - 1];
  const bump = tLast > 0 ? 0.07 * Math.sin((tLast / fps) * Math.PI * 2 * 2.2) * Math.exp(-tLast / 9) : 0;
  const ring = interpolate(tLast, [4, 22], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const r = h * 0.37;
  const labelMaxW = CARD_W - h - 50;

  return (
    <AbsoluteFill style={{fontFamily: FONT, alignItems: 'center'}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        <ellipse
          cx={470}
          cy={Math.min(730, y0 + total + 30)}
          rx={330 * shadowIn}
          ry={26}
          fill="#000"
          opacity={0.35 * shadowIn}
        />

        {/* Setas entre as etapas: crescem logo antes da próxima entrar. */}
        {steps.slice(1).map((_, k) => {
          const i = k + 1;
          const aStart = Math.max(starts[i - 1] + 3, starts[i] - 9);
          const dur = Math.max(4, starts[i] - aStart);
          const a = spring({frame: frame - aStart, fps, config: {damping: 200}, durationInFrames: dur});
          const head = spring({frame: frame - (aStart + dur * 0.6), fps, config: {damping: 10, stiffness: 220}});
          const yA = cardY(i - 1) + h + 10;
          const yB = cardY(i) - 8;
          const hs = Math.min(26, gap * 0.42);
          const yShaftEnd = yB - hs;
          return (
            <g key={`a${i}`}>
              <line x1={470} y1={yA} x2={470} y2={yShaftEnd} stroke="#000" strokeWidth={20} strokeLinecap="round"
                pathLength={1} strokeDasharray={1} strokeDashoffset={1 - a} />
              <line x1={470} y1={yA} x2={470} y2={yShaftEnd} stroke={highlight} strokeWidth={9} strokeLinecap="round"
                pathLength={1} strokeDasharray={1} strokeDashoffset={1 - a} />
              <g transform={`translate(470 ${yShaftEnd}) scale(${head})`}>
                <polygon
                  points={`${-hs * 1.05},0 ${hs * 1.05},0 0,${hs}`}
                  fill={highlight}
                  stroke="#000"
                  strokeWidth={6}
                  strokeLinejoin="round"
                />
              </g>
            </g>
          );
        })}

        {steps.map((s, i) => {
          const p = enter(i);
          if (frame < starts[i] - 1) return null;
          const isLast = i === n - 1 && n > 1;
          const active = Math.max(0, settle(i) - settle(i + 1));
          const dir = i % 2 === 0 ? -1 : 1;
          const dx = interpolate(p, [0, 1], [dir * 280, 0]);
          const sc = interpolate(p, [0, 1], [0.45, 1]) * (1 + 0.05 * active) * (isLast ? 1 + bump : 1);
          const opacity = interpolate(p, [0, 0.35], [0, 1], {extrapolateRight: 'clamp'});
          const cy = cardY(i) + h / 2;

          const fill = isLast
            ? accent
            : interpolateColors(active, [0, 1], ['#d9dde3', '#ffffff']);
          const text = s.label.toUpperCase();
          const fs = Math.min(h * 0.4, labelMaxW / (Math.max(1, text.length) * CHAR_EM));
          const bx = -CARD_W / 2 + h / 2;

          return (
            <g key={`s${i}`} opacity={opacity} transform={`translate(${470 + dx} ${cy}) scale(${sc})`}>
              {/* brilho da etapa ativa */}
              <rect x={-CARD_W / 2 - 12} y={-h / 2 - 12} width={CARD_W + 24} height={h + 24} rx={(h + 24) / 2}
                fill={highlight} opacity={0.55 * active} />
              {isLast && ring > 0 && ring < 1 ? (
                <rect x={-CARD_W / 2} y={-h / 2} width={CARD_W} height={h} rx={h / 2} fill="none"
                  stroke={accent} strokeWidth={8 * (1 - ring)} opacity={1 - ring}
                  transform={`scale(${1 + ring * 0.12} ${1 + ring * 0.5})`} />
              ) : null}
              <rect x={-CARD_W / 2} y={-h / 2} width={CARD_W} height={h} rx={h / 2} fill={fill} stroke="#000" strokeWidth={8} />
              {/* faixa de brilho */}
              <rect x={-CARD_W / 2 + h * 0.6} y={-h / 2 + h * 0.13} width={CARD_W - h * 1.2} height={h * 0.1} rx={h * 0.05}
                fill="#fff" opacity={isLast ? 0.3 : 0.6} />

              {/* badge com emoji + número */}
              <circle cx={bx} cy={0} r={r} fill={isLast ? '#fff' : highlight} stroke="#000" strokeWidth={7} />
              {s.emoji ? (
                <text x={bx} y={r * 0.36} textAnchor="middle" fontSize={r * 1.05}>
                  {s.emoji}
                </text>
              ) : (
                <text x={bx} y={r * 0.38} textAnchor="middle" fontFamily={FONT} fontWeight={900} fontSize={r * 1.1} fill="#111">
                  {i + 1}
                </text>
              )}
              {s.emoji ? (
                <g transform={`translate(${bx + r * 0.78} ${-r * 0.72})`}>
                  <circle r={r * 0.42} fill="#111" stroke="#fff" strokeWidth={3} />
                  <text y={r * 0.17} textAnchor="middle" fontFamily={FONT} fontWeight={900} fontSize={r * 0.5} fill="#fff">
                    {i + 1}
                  </text>
                </g>
              ) : null}

              <text
                x={-CARD_W / 2 + h + 18}
                y={fs * 0.36}
                fontFamily={FONT}
                fontWeight={900}
                fontSize={fs}
                fill={isLast ? '#fff' : '#111'}
                stroke={isLast ? '#000' : 'none'}
                strokeWidth={isLast ? fs * 0.16 : 0}
                strokeLinejoin="round"
                paintOrder="stroke fill"
              >
                {text}
              </text>
            </g>
          );
        })}
      </svg>
      {title ? (
        <div
          style={{
            position: 'absolute',
            top: 22,
            width: '100%',
            fontWeight: 900,
            fontSize: titleSize,
            lineHeight: 1.1,
            color: highlight,
            textTransform: 'uppercase',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            transform: `scale(${titleIn})`,
            ...outline(10),
          }}
        >
          {title}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
