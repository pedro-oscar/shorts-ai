import React from 'react';
import {AbsoluteFill, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT} from '../theme';
import type {SceneProps} from './types';

type Item = {label: string; emoji?: string; at?: number};

const INK = '#1a1a1a';
const WOOD = '#A9692F';
const WOOD_DARK = '#7C4A1E';
const METAL = '#B9C0C8';
const METAL_DARK = '#7D8690';

// Geometria da prancheta (caixa 940×760).
const BOARD = {x: 110, y: 48, w: 720, h: 680};
const PAPER = {x: 148, y: 108, w: 644, h: 596};
const LIST_RIGHT = 715; // fim da área do texto (o emoji fica à direita)
const EMOJI_X = 750;

/** Largura aproximada de Montserrat 900 em caixa alta, em "em". */
const EM = 0.74;
const fitFont = (text: string, maxW: number, base: number, min: number) =>
  Math.max(min, Math.min(base, maxW / (Math.max(1, text.length) * EM)));

/**
 * Prancheta com lista de tarefas: cada item é marcado com ✓ (traço animado) no seu `at` (segundos),
 * o texto passa de cinza para preto com um "pop" e o emoji salta ao lado. No último, entra o carimbo "PRONTO".
 */
export const Checklist: React.FC<SceneProps & {title?: string; items?: Item[]}> = ({
  title = '',
  items = [],
  accent,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const list = items.slice(0, 6);
  const n = Math.max(1, list.length);
  const atFrame = list.map((it, i) => Math.round((it.at ?? 0.4 + i * 0.8) * fps));
  const lastAt = list.length ? Math.max(...atFrame) : 0;

  // Entrada da prancheta: sobe + leve rotação até 0.
  const enter = spring({frame, fps, config: {damping: 13, stiffness: 170}});
  const boardY = interpolate(enter, [0, 1], [520, 0]);
  const boardRot = interpolate(enter, [0, 1], [-9, 0]);

  // Carimbo final e o "tranco" que ele dá na prancheta.
  const stampP = list.length ? spring({frame: frame - lastAt - 6, fps, config: {damping: 11, stiffness: 180}}) : 0;
  const thump = interpolate(stampP, [0, 0.55, 1], [1, 0.975, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  // Título.
  const titleText = title.toUpperCase();
  const titleFs = fitFont(titleText, PAPER.w - 70, 66, 42);
  const titleY = PAPER.y + 72;
  const titleW = Math.min(PAPER.w - 50, titleText.length * EM * titleFs + 30);
  const marker = spring({frame: frame - 8, fps, config: {damping: 15}});

  // Área da lista.
  const listTop = title ? PAPER.y + 132 : PAPER.y + 40;
  const listBottom = PAPER.y + PAPER.h - 92; // espaço para o carimbo no canto
  const rowH = Math.min(124, (listBottom - listTop) / n);
  const box = Math.min(62, rowH * 0.74);
  const boxX = PAPER.x + 30;
  const labelX = boxX + box + 26;
  const baseFs = Math.max(54, Math.min(66, rowH * 0.62));

  return (
    <AbsoluteFill style={{fontFamily: FONT}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        <ellipse
          cx={470}
          cy={738}
          rx={interpolate(enter, [0, 1], [180, 340])}
          ry={20}
          fill="#000"
          opacity={interpolate(enter, [0, 1], [0, 0.38])}
        />
        <g transform={`translate(0 ${boardY}) rotate(${boardRot} 470 400) translate(470 400) scale(${thump}) translate(-470 -400)`}>
          {/* Prancheta de madeira */}
          <rect x={BOARD.x} y={BOARD.y} width={BOARD.w} height={BOARD.h} rx={38} fill={WOOD} stroke={INK} strokeWidth={9} />
          <rect x={BOARD.x + 14} y={BOARD.y + 14} width={BOARD.w - 28} height={BOARD.h - 28} rx={28} fill="none" stroke={WOOD_DARK} strokeWidth={4} opacity={0.6} />
          {[0, 1, 2].map((k) => (
            <path
              key={k}
              d={`M ${BOARD.x + 18} ${BOARD.y + 200 + k * 190} q 120 ${k % 2 ? -18 : 18} 240 0`}
              fill="none"
              stroke={WOOD_DARK}
              strokeWidth={4}
              strokeLinecap="round"
              opacity={0.55}
            />
          ))}

          {/* Folha */}
          <rect x={PAPER.x + 8} y={PAPER.y + 10} width={PAPER.w} height={PAPER.h} rx={10} fill="#000" opacity={0.22} />
          <rect x={PAPER.x} y={PAPER.y} width={PAPER.w} height={PAPER.h} rx={10} fill="#fff" stroke={INK} strokeWidth={6} />

          {/* Clipe metálico */}
          <path
            d="M 330 128 L 330 92 Q 330 78 344 78 L 400 78 L 410 40 Q 414 26 428 26 L 512 26 Q 526 26 530 40 L 540 78 L 596 78 Q 610 78 610 92 L 610 128 Q 610 140 598 140 L 342 140 Q 330 140 330 128 Z"
            fill={METAL}
            stroke={INK}
            strokeWidth={7}
            strokeLinejoin="round"
          />
          <ellipse cx={470} cy={52} rx={30} ry={13} fill={WOOD_DARK} stroke={INK} strokeWidth={5} />
          <line x1={348} y1={96} x2={592} y2={96} stroke="#fff" strokeWidth={5} strokeLinecap="round" opacity={0.7} />
          <line x1={348} y1={124} x2={592} y2={124} stroke={METAL_DARK} strokeWidth={5} strokeLinecap="round" />

          {/* Título com marca-texto */}
          {title ? (
            <g>
              <rect
                x={470 - titleW / 2}
                y={titleY - titleFs * 0.5}
                width={titleW}
                height={titleFs * 1.0}
                rx={8}
                fill={highlight}
                transform={`translate(${470 - titleW / 2} 0) scale(${marker} 1) translate(${-(470 - titleW / 2)} 0)`}
              />
              <text
                x={470}
                y={titleY}
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily={FONT}
                fontWeight={900}
                fontSize={titleFs}
                fill={INK}
              >
                {titleText}
              </text>
            </g>
          ) : null}

          {/* Itens */}
          {list.map((it, i) => {
            const at = atFrame[i];
            const cy = listTop + rowH * (i + 0.5);
            const label = it.label.toUpperCase();
            const fs = fitFont(label, LIST_RIGHT - labelX, baseFs, 40);

            const check = spring({frame: frame - at, fps, config: {damping: 16, stiffness: 140}, durationInFrames: 10});
            const pop = spring({frame: frame - at, fps, config: {damping: 9, stiffness: 200}});
            const scale = interpolate(pop, [0, 0.5, 1], [1, 1.16, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
            const color = interpolateColors(Math.min(1, pop), [0, 1], ['#B4B4B4', '#111111']);
            const boxStroke = interpolateColors(Math.min(1, pop), [0, 1], ['#9A9A9A', INK]);

            const jump = spring({frame: frame - at - 3, fps, config: {damping: 8, stiffness: 190}});
            const emojiScale = interpolate(jump, [0, 1], [0, 1]);
            const emojiY = interpolate(jump, [0, 0.6, 1], [30, -26, 0], {extrapolateRight: 'clamp'});
            const emojiFs = Math.min(66, rowH * 0.66);

            const bx = boxX;
            const by = cy - box / 2;
            return (
              <g key={i}>
                {i > 0 ? (
                  <line x1={PAPER.x + 24} y1={cy - rowH / 2} x2={PAPER.x + PAPER.w - 24} y2={cy - rowH / 2} stroke="#E3E3E3" strokeWidth={3} />
                ) : null}
                <rect x={bx} y={by} width={box} height={box} rx={10} fill="#fff" stroke={boxStroke} strokeWidth={6} />
                <path
                  d={`M ${bx + box * 0.16} ${by + box * 0.52} L ${bx + box * 0.42} ${by + box * 0.8} L ${bx + box * 1.02} ${by - box * 0.12}`}
                  fill="none"
                  stroke={accent}
                  strokeWidth={Math.max(9, box * 0.2)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={1 - Math.min(1, Math.max(0, check))}
                  opacity={frame >= at ? 1 : 0}
                />
                <g transform={`translate(${labelX} ${cy}) scale(${scale})`}>
                  <text x={0} y={0} dominantBaseline="central" fontFamily={FONT} fontWeight={900} fontSize={fs} fill={color}>
                    {label}
                  </text>
                </g>
                {it.emoji ? (
                  <g transform={`translate(${EMOJI_X} ${cy + emojiY}) scale(${emojiScale})`}>
                    <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={emojiFs}>
                      {it.emoji}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}

          {/* Carimbo PRONTO */}
          {list.length ? (
            <g
              transform={`translate(630 672) rotate(${interpolate(stampP, [0, 1], [-70, -12])}) scale(${interpolate(stampP, [0, 1], [2.4, 1])})`}
              opacity={interpolate(stampP, [0, 0.25], [0, 0.95], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}
            >
              <rect x={-120} y={-42} width={240} height={84} rx={14} fill="#fff" fillOpacity={0.85} stroke={accent} strokeWidth={9} />
              <rect x={-107} y={-30} width={214} height={60} rx={8} fill="none" stroke={accent} strokeWidth={3} />
              <text x={0} y={2} textAnchor="middle" dominantBaseline="central" fontFamily={FONT} fontWeight={900} fontSize={46} fill={accent}>
                PRONTO
              </text>
            </g>
          ) : null}
        </g>
      </svg>
    </AbsoluteFill>
  );
};
