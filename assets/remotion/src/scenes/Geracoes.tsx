import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

const W = 940;
const OY = 40;
/** Linha do tempo: sai das mãos (esquerda, mais baixa) e sobe levemente até "hoje" (direita). */
const LX0 = 150;
const LX1 = 800;
const LY0 = 540 + OY;
const LY1 = 470 + OY;
/** Mãos postas: centro x e base (punho da manga). */
const HX = 88;
const HY = LY0 + 4;
const HLY = HY - 227; // luz acima das mãos
const INK = '#111';
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const BODY = ['#8d99ae', '#b08968', '#6c757d', '#a3b18a', '#c9ada7', '#7f5539', '#adb5bd'];
/** Largura aproximada por caractere (em "em") de Montserrat 900 / 800. */
const CHAR_EM = 0.76;
const CHAR_EM_800 = 0.68;
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const lineY = (x: number) => LY0 + ((LY1 - LY0) * (x - LX0)) / (LX1 - LX0);

const firstFrame = (fn: (f: number) => number, target: number, from: number, to: number) => {
  for (let f = from; f <= to; f++) if (fn(f) >= target) return f;
  return to;
};

/** Pessoinha com os pés na origem (altura ~67 na escala 1). */
const person = (key: string, x: number, y: number, s: number, body: string, head: string, sw = 5) => (
  <g key={key} transform={`translate(${x} ${y}) scale(${s})`}>
    <path
      d="M -17 0 L -17 -22 Q -17 -38 0 -38 Q 17 -38 17 -22 L 17 0 Z"
      fill={body}
      stroke={INK}
      strokeWidth={sw}
      strokeLinejoin="round"
    />
    <circle cx={0} cy={-53} r={14} fill={head} stroke={INK} strokeWidth={sw} />
    <circle cx={-5} cy={-58} r={4} fill="#fff" opacity={0.55} />
  </g>
);

/** Estrela de 4 pontas (brilho). */
const sparkle = (key: string, cx: number, cy: number, r: number, fill: string, opacity: number) =>
  r > 0.5 ? (
    <path
      key={key}
      d={`M ${cx} ${cy - r} Q ${cx} ${cy} ${cx + r} ${cy} Q ${cx} ${cy} ${cx} ${cy + r} Q ${cx} ${cy} ${cx - r} ${cy} Q ${cx} ${cy} ${cx} ${cy - r} Z`}
      fill={fill}
      stroke={INK}
      strokeWidth={3}
      strokeLinejoin="round"
      opacity={opacity}
    />
  ) : null;

/**
 * "Jesus orou por todas as gerações": mãos postas no Ano 33, linha do tempo que se desenha até
 * "Hoje", grupos de pessoinhas (um por marco) surgindo ao longo dela, um fio de luz que sai da
 * oração e toca cada geração e, em `voceAt`, "VOCÊ" destacado no fim da linha.
 */
export const Geracoes: React.FC<
  SceneProps & {
    titulo?: string;
    inicio?: string;
    fim?: string;
    marcos?: string[];
    voce?: string;
    voceAt?: number;
  }
> = ({
  titulo = '',
  inicio = 'Ano 33',
  fim = 'Hoje',
  marcos = ['Séc. V', 'Séc. XII', 'Séc. XVIII'],
  voce = 'Você',
  voceAt = 3.5,
  accent,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // --- Tempos ---
  const lineStart = 6;
  const lineEnd = lineStart + Math.round(1.5 * fps);
  const lineProg = (f: number) =>
    interpolate(f, [lineStart, lineEnd], [0, 1], {...CLAMP, easing: Easing.inOut(Easing.cubic)});

  const voceF = Math.max(1, Math.round(voceAt * fps));
  const travelEndRaw = voceF - 2;
  const travelStart = Math.max(lineStart + 8, Math.min(lineEnd, travelEndRaw - 18));
  const travelEnd = Math.max(travelStart + 6, travelEndRaw);
  const lightProg = (f: number) =>
    interpolate(f, [travelStart, travelEnd], [0, 1], {...CLAMP, easing: Easing.inOut(Easing.sin)});

  // --- Layout dos marcos ---
  const n = marcos.length;
  const A = LX0 + 60;
  const B = LX1 - 120;
  const spacing = n > 0 ? (B - A) / n : 0;
  const gs = n > 0 ? Math.min(1, (spacing - 6) / 110) : 1;
  const xs = marcos.map((_, i) => A + spacing * (i + 0.5));
  const ts = xs.map((x) => (x - LX0) / (LX1 - LX0));
  const appearF = ts.map((t) => firstFrame(lineProg, t - 0.04, lineStart, lineEnd));
  const touchF = ts.map((t) => firstFrame(lightProg, t, travelStart, travelEnd));

  // --- Valores do frame atual ---
  const prog = lineProg(frame);
  const lp = lightProg(frame);
  const tipX = LX0 + prog * (LX1 - LX0);
  const lx = LX0 + lp * (LX1 - LX0);
  const lightVis = interpolate(frame, [travelStart, travelStart + 5, travelEnd, travelEnd + 8], [0, 1, 1, 0], CLAMP);

  const shadowIn = spring({frame, fps, config: {damping: 200}});
  const handsIn = spring({frame, fps, config: {damping: 11, stiffness: 140}});
  const glowIn = spring({frame: frame - 5, fps, config: {damping: 10, stiffness: 120}});
  const inicioIn = spring({frame: frame - 9, fps, config: {damping: 12}});
  const titleIn = spring({frame: frame - 2, fps, config: {damping: 10}});
  const depart = interpolate(frame - travelStart, [0, 4, 18], [0, 1, 0], {...CLAMP, easing: Easing.out(Easing.quad)});
  const breathe = 1 + 0.02 * Math.sin((frame / fps) * Math.PI * 2 * 0.8);
  const glowPulse = 1 + 0.08 * Math.sin((frame / fps) * Math.PI * 2 * 1.3) + 0.35 * depart;

  const endCapIn = spring({frame: frame - lineEnd + 2, fps, config: {damping: 10, stiffness: 180}});
  const fimIn = spring({frame: frame - lineEnd, fps, config: {damping: 12}});
  const fimBump = interpolate(frame - voceF, [0, 4, 14], [0, 0.25, 0], {...CLAMP, easing: Easing.out(Easing.quad)});

  // --- Destaque final ---
  const tV = frame - voceF;
  const pop = spring({frame: tV, fps, config: {damping: 6, stiffness: 160, mass: 0.7}});
  const raysP = spring({frame: tV - 2, fps, config: {damping: 14, stiffness: 90}});
  const textPop = spring({frame: tV - 3, fps, config: {damping: 8, stiffness: 170}});
  const arrowIn = spring({frame: tV - 8, fps, config: {damping: 9, stiffness: 180}});
  const ring = interpolate(tV, [0, 20], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
  const bigFeetY = LY1 - 13;
  const bigS = 2.1;
  const bigCy = bigFeetY - 70;
  const voceText = voce.toUpperCase();
  const vfs = Math.min(80, 420 / (Math.max(1, voceText.length) * CHAR_EM));
  const vw = voceText.length * CHAR_EM * vfs;
  const vcx = Math.max(12 + vw / 2, Math.min(LX1, W - 12 - vw / 2));
  const vy = bigFeetY - bigS * 67 - 70;
  const bob = 4 * Math.sin((frame / fps) * Math.PI * 2 * 1.6);

  const inicioFs = Math.min(34, 170 / (Math.max(1, inicio.length) * CHAR_EM_800));
  const fimFs = Math.min(30, 180 / (Math.max(1, fim.length) * CHAR_EM_800));
  const titleText = titulo.toUpperCase();
  const titleSize = Math.min(60, 880 / (Math.max(1, titleText.length) * CHAR_EM));

  const handHalf = (
    <>
      <path
        d="M 0 -175 C 14 -175 26 -150 32 -115 L 42 -60 C 46 -38 34 -22 18 -22 L 0 -22 Z"
        fill="#f2c49b"
        stroke={INK}
        strokeWidth={7}
        strokeLinejoin="round"
      />
      <path d="M 10 -96 Q 22 -74 18 -50" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />
      <path d="M 6 -165 Q 16 -150 20 -128" fill="none" stroke="#fff" strokeWidth={4} strokeLinecap="round" opacity={0.5} />
    </>
  );

  return (
    <AbsoluteFill style={{fontFamily: FONT, alignItems: 'center'}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        <ellipse cx={470} cy={712} rx={410 * shadowIn} ry={28} fill="#000" opacity={0.35 * shadowIn} />

        {/* Halos das gerações tocadas pela luz */}
        {xs.map((gx, i) => {
          const glow = spring({frame: frame - touchF[i], fps, config: {damping: 200}, durationInFrames: 10});
          const flash = interpolate(frame - touchF[i], [0, 3, 18], [0, 1, 0], {...CLAMP, easing: Easing.out(Easing.quad)});
          const op = 0.3 * glow + 0.45 * flash;
          if (op <= 0.001) return null;
          return (
            <ellipse
              key={`h${i}`}
              cx={gx}
              cy={lineY(gx) - 13 - 40 * gs}
              rx={78 * gs * (1 + 0.15 * flash)}
              ry={56 * gs * (1 + 0.15 * flash)}
              fill={highlight}
              opacity={op}
            />
          );
        })}

        {/* Linha do tempo (contorno escuro + highlight), desenhada progressivamente */}
        {prog > 0.001 ? (
          <g>
            <line x1={LX0} y1={LY0} x2={LX1} y2={LY1} stroke="#000" strokeWidth={26} strokeLinecap="round"
              pathLength={1} strokeDasharray={1} strokeDashoffset={1 - prog} />
            <line x1={LX0} y1={LY0} x2={LX1} y2={LY1} stroke={highlight} strokeWidth={14} strokeLinecap="round"
              pathLength={1} strokeDasharray={1} strokeDashoffset={1 - prog} />
          </g>
        ) : null}
        {prog > 0.001 && prog < 0.999 ? (
          <circle cx={tipX} cy={lineY(tipX)} r={9} fill="#fff" opacity={0.9} />
        ) : null}

        {/* Fio de luz: o trecho já percorrido fica aceso */}
        {lp > 0.001 ? (
          <line x1={LX0} y1={LY0} x2={LX1} y2={LY1} stroke="#fff" strokeWidth={5} strokeLinecap="round"
            pathLength={1} strokeDasharray={1} strokeDashoffset={1 - lp} opacity={0.9} />
        ) : null}

        {/* Ponto final da linha ("hoje") */}
        {endCapIn > 0.001 ? (
          <circle cx={LX1} cy={LY1} r={15 * endCapIn} fill={highlight} stroke="#000" strokeWidth={6} />
        ) : null}

        {/* Luz sobre as mãos */}
        {glowIn > 0.001 ? (
          <g transform={`translate(${HX} ${HLY}) scale(${glowIn * glowPulse})`}>
            <circle r={44} fill={highlight} opacity={0.3} />
            {Array.from({length: 8}).map((_, k) => {
              const a = ((k * 45 + frame * 0.7) * Math.PI) / 180;
              const r0 = 27;
              const r1 = 42;
              return (
                <g key={`lr${k}`}>
                  <line x1={Math.cos(a) * r0} y1={Math.sin(a) * r0} x2={Math.cos(a) * r1} y2={Math.sin(a) * r1}
                    stroke="#000" strokeWidth={10} strokeLinecap="round" />
                  <line x1={Math.cos(a) * r0} y1={Math.sin(a) * r0} x2={Math.cos(a) * r1} y2={Math.sin(a) * r1}
                    stroke={highlight} strokeWidth={5} strokeLinecap="round" />
                </g>
              );
            })}
            <circle r={18} fill={highlight} stroke="#000" strokeWidth={5} />
            <circle cx={-5} cy={-5} r={6} fill="#fff" opacity={0.7} />
          </g>
        ) : null}

        {/* Mãos postas (a oração) */}
        {handsIn > 0.001 ? (
          <g transform={`translate(${HX} ${HY}) scale(${handsIn * breathe})`}>
            <ellipse cx={0} cy={-100} rx={70} ry={95} fill={highlight} opacity={0.18 + 0.35 * depart} />
            <g transform="scale(-1 1)">{handHalf}</g>
            <g>{handHalf}</g>
            <path d="M -40 -26 L 40 -26 L 46 4 L -46 4 Z" fill="#f4f4f4" stroke={INK} strokeWidth={7} strokeLinejoin="round" />
            <line x1={0} y1={-24} x2={0} y2={2} stroke={INK} strokeWidth={4} />
          </g>
        ) : null}

        {/* Rótulo do início */}
        {inicio && inicioIn > 0.001 ? (
          <g transform={`translate(${HX} ${HY + 54}) scale(${inicioIn})`} opacity={Math.min(1, inicioIn * 2)}>
            <text x={0} y={0} textAnchor="middle" fontFamily={FONT} fontWeight={900} fontSize={inicioFs}
              fill={highlight} stroke="#000" strokeWidth={7} strokeLinejoin="round" paintOrder="stroke">
              {inicio}
            </text>
          </g>
        ) : null}

        {/* Luz viajando pela linha */}
        {lightVis > 0.001 ? (
          <g transform={`translate(${lx} ${lineY(lx)})`} opacity={lightVis}>
            <circle r={30} fill={highlight} opacity={0.45} />
            <circle r={13} fill="#fff" stroke={highlight} strokeWidth={4} />
            {sparkle('ls', 0, 0, 24 * (1 + 0.15 * Math.sin((frame / fps) * Math.PI * 2 * 3)), '#fff', 0.85)}
          </g>
        ) : null}

        {/* Gerações: grupos de 3 pessoinhas + rótulo do marco */}
        {xs.map((gx, i) => {
          const app = appearF[i];
          const flash = interpolate(frame - touchF[i], [0, 3, 18], [0, 1, 0], {...CLAMP, easing: Easing.out(Easing.quad)});
          const offs = [-36, 0, 36];
          const scs = [0.95, 1.12, 0.95];
          const people = [0, 2, 1].map((j) => {
            const p = spring({frame: frame - (app + j * 4), fps, config: {damping: 9, stiffness: 170}});
            if (p <= 0.001) return null;
            const px = gx + offs[j] * gs;
            return person(
              `p${i}-${j}`,
              px,
              lineY(px) - 13,
              scs[j] * gs * p * (1 + 0.12 * flash),
              BODY[(i * 3 + j) % BODY.length],
              SKIN[(i * 2 + j) % SKIN.length],
            );
          });

          const label = marcos[i];
          const labelIn = spring({frame: frame - app - 5, fps, config: {damping: 12}});
          const fs = Math.min(32, Math.min(2 * spacing - 16, 240) / (Math.max(1, label.length) * CHAR_EM_800));
          const baseY = lineY(gx);
          const ly = baseY + (i % 2 ? 106 : 62);
          const tickEnd = ly - fs * 0.9;
          return (
            <g key={`g${i}`}>
              {people}
              {sparkle(`s${i}`, gx + 44 * gs, baseY - 13 - 95 * gs, 18 * flash, '#fff', flash)}
              {label && labelIn > 0.001 ? (
                <g opacity={Math.min(1, labelIn * 2)}>
                  {tickEnd > baseY + 18 ? (
                    <line x1={gx} y1={baseY + 16} x2={gx} y2={baseY + 16 + (tickEnd - baseY - 16) * labelIn}
                      stroke="#000" strokeWidth={5} strokeLinecap="round" opacity={0.75} />
                  ) : null}
                  <g transform={`translate(${gx} ${ly - fs * 0.36}) scale(${labelIn})`}>
                    <text x={0} y={fs * 0.36} textAnchor="middle" fontFamily={FONT} fontWeight={800} fontSize={fs}
                      fill="#fff" stroke="#000" strokeWidth={6} strokeLinejoin="round" paintOrder="stroke">
                      {label}
                    </text>
                  </g>
                </g>
              ) : null}
            </g>
          );
        })}

        {/* Rótulo do fim */}
        {fim && fimIn > 0.001 ? (
          <g transform={`translate(${LX1} ${LY1 + 58 - fimFs * 0.36}) scale(${fimIn * (1 + fimBump)})`}
            opacity={Math.min(1, fimIn * 2)}>
            <text x={0} y={fimFs * 0.36} textAnchor="middle" fontFamily={FONT} fontWeight={900} fontSize={fimFs}
              fill={highlight} stroke="#000" strokeWidth={7} strokeLinejoin="round" paintOrder="stroke">
              {fim}
            </text>
          </g>
        ) : null}

        {/* VOCÊ: raios, anel, pessoinha maior, seta e texto */}
        {tV >= 0 ? (
          <g>
            <g opacity={0.9}>
              <circle cx={LX1} cy={bigCy} r={95 * raysP} fill={highlight} opacity={0.35} />
              {Array.from({length: 12}).map((_, k) => {
                const a = ((k * 30 + tV * 0.8) * Math.PI) / 180;
                const da = (5 * Math.PI) / 180;
                const L = (k % 2 ? 120 : 165) * raysP;
                return (
                  <polygon
                    key={`r${k}`}
                    points={`${LX1},${bigCy} ${LX1 + Math.cos(a - da) * L},${bigCy + Math.sin(a - da) * L} ${LX1 + Math.cos(a + da) * L},${bigCy + Math.sin(a + da) * L}`}
                    fill={highlight}
                    opacity={0.6}
                  />
                );
              })}
            </g>
            {ring > 0 && ring < 1 ? (
              <circle cx={LX1} cy={bigCy} r={60 + 120 * ring} fill="none" stroke={accent}
                strokeWidth={10 * (1 - ring)} opacity={1 - ring} />
            ) : null}
            {pop > 0.001 ? person('voce', LX1, bigFeetY, bigS * pop, accent, '#f1c27d', 6) : null}
            {arrowIn > 0.001 ? (
              <g transform={`translate(${LX1} ${vy + 44 + bob}) scale(${arrowIn})`}>
                <polygon points="-22,-14 22,-14 0,12" fill={highlight} stroke="#000" strokeWidth={6} strokeLinejoin="round" />
              </g>
            ) : null}
            {voceText && textPop > 0.001 ? (
              <g transform={`translate(${vcx} ${vy - vfs * 0.36}) scale(${textPop})`}>
                <text x={0} y={vfs * 0.36} textAnchor="middle" fontFamily={FONT} fontWeight={900} fontSize={vfs}
                  fill={accent} stroke="#000" strokeWidth={12} strokeLinejoin="round" paintOrder="stroke">
                  {voceText}
                </text>
              </g>
            ) : null}
          </g>
        ) : null}
      </svg>
      {titulo ? (
        <div
          style={{
            position: 'absolute',
            top: 20,
            width: '100%',
            fontWeight: 900,
            fontSize: titleSize,
            lineHeight: 1.1,
            color: '#fff',
            textTransform: 'uppercase',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            transform: `scale(${titleIn})`,
            ...outline(8),
          }}
        >
          {titulo}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
