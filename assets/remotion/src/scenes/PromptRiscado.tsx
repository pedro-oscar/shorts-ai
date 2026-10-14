import React from 'react';
import {AbsoluteFill, Easing, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

type Linha = {texto: string; at?: number};

const INK = '#111111';
const BODY = '#F5F5F0';
const BAR = '#262B38';
const GRAY = '#9AA0A6';
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// Geometria da janela (caixa 940×760).
const WIN = {x: 60, y: 62, w: 820, h: 606};
const R = 30;
const BAR_H = 88;
const BODY_TOP = WIN.y + BAR_H;
const BODY_BOTTOM = WIN.y + WIN.h;
const CX = WIN.x + WIN.w / 2;
const CY = WIN.y + WIN.h / 2;
const BULLET_X = WIN.x + 56;
const TEXT_X = WIN.x + 100;
const TEXT_MAX_W = WIN.x + WIN.w - 46 - TEXT_X;
// Aba com o título (estilo editor), encostada no corpo.
const TAB_X = WIN.x + 150;
const TAB_Y = WIN.y + 16;
const TAB_PAD = 26;
const TAB_EXTRA = TAB_PAD + 22 + 18 + 22; // margem + ponto "não salvo" + margem
const TAB_TEXT_MAX = WIN.x + WIN.w - 24 - TAB_X - TAB_EXTRA;
const STAMP_DY = (BODY_TOP + BODY_BOTTOM) / 2 - 380; // carimbo centrado no corpo da janela

// Tempos (frames).
const LINE_START = 6; // entrada da 1ª linha
const LINE_GAP = 5; // escalonamento entre linhas
const STRIKE_F = 8; // risco da esquerda para a direita
const SHAKE_F = 6; // tremido do texto riscado
const IMPACT_F = 4; // do labelAt até o carimbo "bater"
const QUAKE_F = 7; // tremor da janela no impacto

/** Largura aproximada de Montserrat 800–900, por caractere, em "em". */
const NARROW = new Set(Array.from('iljtfrI.,;:!|\'"()-'));
const WIDE = new Set(Array.from('mwMW%@'));
const charEm = (c: string) => {
  if (c === ' ') return 0.27;
  if (NARROW.has(c)) return 0.38;
  if (WIDE.has(c)) return 0.92;
  if (c !== c.toLowerCase()) return 0.76; // maiúscula (inclui acentuadas)
  return 0.63;
};
const textEm = (t: string) => Array.from(t).reduce((s, c) => s + charEm(c), 0);
const fitFont = (text: string, maxW: number, base: number, min: number) =>
  Math.max(min, Math.min(base, maxW / Math.max(1, textEm(text))));

/**
 * Janela de prompt com frases "velhas" listadas; cada uma é riscada em vermelho no seu `at` (segundos):
 * o traço corre da esquerda para a direita, o texto fica cinza e treme, e o marcador vira ✕.
 * Em `labelAt`, um carimbo (`label`) bate por cima da janela, que treme no impacto.
 */
export const PromptRiscado: React.FC<
  SceneProps & {titulo?: string; linhas?: Linha[]; label?: string; labelAt?: number}
> = ({titulo = 'Seu prompt', linhas = [], label = '', labelAt = 3, accent, highlight}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const list = linhas.slice(0, 4);
  const n = list.length;
  const rows = n + 1; // + linha do cursor

  // Entrada da janela.
  const enter = spring({frame, fps, config: {damping: 15, stiffness: 150}});
  const winY = interpolate(enter, [0, 1], [70, 0]);
  const winS = interpolate(enter, [0, 1], [0.9, 1]);
  const winOp = interpolate(enter, [0, 0.35], [0, 1], CLAMP);

  // Carimbo e tremor da janela no impacto.
  const labelF = Math.round(labelAt * fps);
  const stampP = label ? spring({frame: frame - labelF, fps, config: {damping: 11, stiffness: 230}}) : 0;
  const stampScale = interpolate(stampP, [0, 1], [1.6, 1]);
  const stampOp = interpolate(stampP, [0, 0.15], [0, 1], CLAMP);
  const stampText = label.toUpperCase();
  const stampFs = fitFont(stampText, 600, 110, 48);
  const kq = frame - labelF - IMPACT_F;
  const quake = label && kq >= 0 && kq < QUAKE_F ? 1 - kq / QUAKE_F : 0;
  const qx = Math.sin((kq + 1) * 2.7) * 11 * quake;
  const qy = Math.cos((kq + 1) * 3.4) * 6 * quake;
  const qr = Math.sin((kq + 1) * 1.9) * 0.9 * quake;

  // Lista.
  const padY = 30;
  const avail = BODY_BOTTOM - BODY_TOP - padY * 2;
  const rowH = Math.min(116, avail / rows);
  const listTop = BODY_TOP + padY + (avail - rowH * rows) / 2;
  const baseFs = Math.min(56, Math.max(40, rowH * 0.58));

  // Título na aba.
  const titleText = titulo.toUpperCase();
  const titleFs = fitFont(titleText, TAB_TEXT_MAX, 38, 36);
  const titleEstW = textEm(titleText) * titleFs;
  const titleSqueeze = titleEstW > TAB_TEXT_MAX;
  const titleW = Math.min(titleEstW, TAB_TEXT_MAX);
  const tabW = titleW + TAB_EXTRA;
  const tabMidY = (TAB_Y + BODY_TOP) / 2;

  // Cursor piscando na linha seguinte à última.
  const cursorP = spring({frame: frame - (LINE_START + n * LINE_GAP), fps, config: {damping: 16, stiffness: 170}});
  const blink = Math.floor(frame / 15) % 2 === 0 ? 1 : 0;
  const cursorCy = listTop + rowH * (n + 0.5);
  const cursorH = baseFs * 1.02;

  // Selo de aspas no canto.
  const badgeP = spring({frame: frame - 12, fps, config: {damping: 10, stiffness: 180}});

  return (
    <AbsoluteFill style={{fontFamily: FONT}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        <ellipse
          cx={470}
          cy={714}
          rx={interpolate(enter, [0, 1], [200, 370])}
          ry={24}
          fill="#000"
          opacity={interpolate(enter, [0, 1], [0, 0.38])}
        />
        <g
          opacity={winOp}
          transform={`translate(${qx} ${winY + qy}) rotate(${qr} ${CX} ${CY}) translate(${CX} ${CY}) scale(${winS}) translate(${-CX} ${-CY})`}
        >
          {/* Sombra deslocada + corpo claro */}
          <rect x={WIN.x + 10} y={WIN.y + 14} width={WIN.w} height={WIN.h} rx={R} fill="#000" opacity={0.35} />
          <rect x={WIN.x} y={WIN.y} width={WIN.w} height={WIN.h} rx={R} fill={BODY} />

          {/* Barra superior escura */}
          <path
            d={`M ${WIN.x} ${BODY_TOP} L ${WIN.x} ${WIN.y + R} A ${R} ${R} 0 0 1 ${WIN.x + R} ${WIN.y} L ${WIN.x + WIN.w - R} ${WIN.y} A ${R} ${R} 0 0 1 ${WIN.x + WIN.w} ${WIN.y + R} L ${WIN.x + WIN.w} ${BODY_TOP} Z`}
            fill={BAR}
          />
          {titulo ? (
            <>
              <line x1={WIN.x} y1={BODY_TOP} x2={TAB_X} y2={BODY_TOP} stroke={INK} strokeWidth={6} strokeLinecap="square" />
              <line x1={TAB_X + tabW} y1={BODY_TOP} x2={WIN.x + WIN.w} y2={BODY_TOP} stroke={INK} strokeWidth={6} strokeLinecap="square" />
              <path
                d={`M ${TAB_X} ${BODY_TOP} L ${TAB_X} ${TAB_Y + 16} A 16 16 0 0 1 ${TAB_X + 16} ${TAB_Y} L ${TAB_X + tabW - 16} ${TAB_Y} A 16 16 0 0 1 ${TAB_X + tabW} ${TAB_Y + 16} L ${TAB_X + tabW} ${BODY_TOP}`}
                fill={BODY}
                stroke={INK}
                strokeWidth={6}
                strokeLinejoin="round"
              />
              <text
                x={TAB_X + TAB_PAD}
                y={tabMidY + 2}
                dominantBaseline="central"
                fontFamily={FONT}
                fontWeight={900}
                fontSize={titleFs}
                fill={INK}
                textLength={titleSqueeze ? TAB_TEXT_MAX : undefined}
                lengthAdjust={titleSqueeze ? 'spacingAndGlyphs' : undefined}
              >
                {titleText}
              </text>
              <circle cx={TAB_X + TAB_PAD + titleW + 22 + 9} cy={tabMidY + 2} r={9} fill={highlight} stroke={INK} strokeWidth={4} />
            </>
          ) : (
            <line x1={WIN.x} y1={BODY_TOP} x2={WIN.x + WIN.w} y2={BODY_TOP} stroke={INK} strokeWidth={6} />
          )}

          {/* Bolinhas da janela */}
          {['#FF5F57', '#FEBC2E', '#28C840'].map((c, k) => (
            <circle key={c} cx={WIN.x + 40 + k * 38} cy={WIN.y + 46} r={13} fill={c} stroke={INK} strokeWidth={4} />
          ))}

          {/* Linhas do prompt */}
          {list.map((it, i) => {
            const cy = listTop + rowH * (i + 0.5);
            const fs = fitFont(it.texto, TEXT_MAX_W, baseFs, 38);
            const estW = textEm(it.texto) * fs;
            const squeeze = estW > TEXT_MAX_W;
            const textW = Math.min(estW, TEXT_MAX_W);

            const inP = spring({frame: frame - (LINE_START + i * LINE_GAP), fps, config: {damping: 16, stiffness: 170}});
            const op = interpolate(inP, [0, 1], [0, 1], CLAMP);
            const slide = interpolate(inP, [0, 1], [-44, 0]);

            const atF = it.at === undefined ? null : Math.round(it.at * fps);
            const k = atF === null ? -1 : frame - atF;
            const strikeP =
              atF === null ? 0 : interpolate(frame, [atF, atF + STRIKE_F], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
            const grayP = atF === null ? 0 : spring({frame: frame - atF, fps, config: {damping: 200}, durationInFrames: 6});
            const popP = atF === null ? 0 : spring({frame: frame - atF, fps, config: {damping: 9, stiffness: 210}});
            const shake = k >= 0 && k < SHAKE_F ? 1 - k / SHAKE_F : 0;
            const sx = Math.sin((k + 1) * 2.9) * 7 * shake;
            const sr = Math.sin((k + 1) * 2.1) * 1.2 * shake;
            const color = interpolateColors(Math.min(1, Math.max(0, grayP)), [0, 1], [INK, GRAY]);

            const bulletS = interpolate(popP, [0, 0.4], [1, 0], CLAMP);
            const xS = Math.max(0, popP);
            const xRot = interpolate(popP, [0, 1], [-120, 0]);
            const b = fs * 0.3;
            const xh = fs * 0.24;
            const chevron = `M ${-b * 0.45} ${-b * 0.8} L ${b * 0.55} 0 L ${-b * 0.45} ${b * 0.8}`;
            const cross = `M ${-xh} ${-xh} L ${xh} ${xh} M ${xh} ${-xh} L ${-xh} ${xh}`;

            // Risco levemente inclinado, passando pelo meio da altura-x.
            const yMid = cy + fs * 0.06;
            const dy = i % 2 ? 5 : 8;
            const x0 = TEXT_X - 14;
            const x1 = TEXT_X + textW + 14;
            const strikeD = `M ${x0} ${yMid + dy} Q ${(x0 + x1) / 2} ${yMid + 3} ${x1} ${yMid - dy + 2}`;

            return (
              <g key={i} opacity={op} transform={`translate(${slide} 0)`}>
                <g transform={`translate(${BULLET_X} ${cy})`}>
                  {bulletS > 0 ? (
                    <g transform={`scale(${bulletS})`}>
                      <path d={chevron} fill="none" stroke={INK} strokeWidth={15} strokeLinecap="round" strokeLinejoin="round" />
                      <path d={chevron} fill="none" stroke={highlight} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
                    </g>
                  ) : null}
                  {xS > 0 ? (
                    <g transform={`rotate(${xRot}) scale(${xS})`}>
                      <path d={cross} fill="none" stroke={INK} strokeWidth={17} strokeLinecap="round" />
                      <path d={cross} fill="none" stroke={accent} strokeWidth={9} strokeLinecap="round" />
                    </g>
                  ) : null}
                </g>
                <g transform={`translate(${sx} 0) rotate(${sr} ${TEXT_X} ${cy})`}>
                  <text
                    x={TEXT_X}
                    y={cy}
                    dominantBaseline="central"
                    fontFamily={FONT}
                    fontWeight={800}
                    fontSize={fs}
                    fill={color}
                    textLength={squeeze ? TEXT_MAX_W : undefined}
                    lengthAdjust={squeeze ? 'spacingAndGlyphs' : undefined}
                  >
                    {it.texto}
                  </text>
                  <path
                    d={strikeD}
                    fill="none"
                    stroke={accent}
                    strokeWidth={11}
                    strokeLinecap="round"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1 - strikeP}
                    opacity={atF !== null && frame >= atF ? 1 : 0}
                  />
                </g>
              </g>
            );
          })}

          {/* Cursor de digitação */}
          <rect
            x={TEXT_X}
            y={cursorCy - cursorH / 2}
            width={13}
            height={cursorH}
            rx={3}
            fill={highlight}
            stroke={INK}
            strokeWidth={4}
            opacity={interpolate(cursorP, [0, 1], [0, 1], CLAMP) * blink}
          />

          {/* Contorno da janela */}
          <rect x={WIN.x} y={WIN.y} width={WIN.w} height={WIN.h} rx={R} fill="none" stroke={INK} strokeWidth={6} />

          {/* Selo de aspas */}
          <g
            transform={`translate(${WIN.x + WIN.w - 24} ${BODY_BOTTOM - 22}) rotate(${interpolate(badgeP, [0, 1], [-50, 8])}) scale(${Math.max(0, badgeP)})`}
          >
            <circle r={44} fill={highlight} stroke={INK} strokeWidth={6} />
            {[-13, 13].map((mx) => (
              <g key={mx}>
                <circle cx={mx} cy={-8} r={10} fill={INK} />
                <path d={`M ${mx + 8} ${-5} Q ${mx + 8} ${12} ${mx - 7} ${18}`} fill="none" stroke={INK} strokeWidth={7} strokeLinecap="round" />
              </g>
            ))}
          </g>
        </g>
      </svg>

      {/* Carimbo final */}
      {label && frame >= labelF ? (
        <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', pointerEvents: 'none'}}>
          <div
            style={{
              transform: `translateY(${STAMP_DY}px) rotate(-10deg) scale(${stampScale})`,
              opacity: stampOp,
              border: `12px solid ${accent}`,
              borderRadius: 24,
              padding: 8,
              background: 'rgba(245,245,240,0.86)',
              boxShadow: '0 0 0 5px #000, inset 0 0 0 5px #000, 0 18px 0 5px rgba(0,0,0,0.3)',
            }}
          >
            <div
              style={{
                border: `4px solid ${accent}`,
                borderRadius: 12,
                padding: '6px 34px',
                fontFamily: FONT,
                fontWeight: 900,
                fontSize: stampFs,
                lineHeight: 1.05,
                letterSpacing: '0.02em',
                color: accent,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                ...outline(10),
              }}
            >
              {stampText}
            </div>
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
