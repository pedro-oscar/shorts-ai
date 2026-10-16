import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * "Quando você perdoa, aí sim as suas orações vão ser ouvidas e aceitas diante de Deus":
 * mãos em oração entram de baixo com um brilho atrás; delas sobem, uma a uma, chaminhas de luz
 * em zigue-zague até um ponto de luz no alto. Em `aceitarAt` o feixe do céu se abre (raios girando
 * devagar), cada chama "entra" na luz com um clarão e um selo verde com check pula ao lado das mãos.
 */

const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const INK = '#111';
const SKIN = '#f2c7a5';
const SKIN_DARK = '#d9a07c';
const SLEEVE = '#3B5BDB';
const SLEEVE_DARK = '#2B47B0';
const CUFF = '#F1F3F7';
const GREEN = '#16a34a';
const LIGHT_CORE = '#FFFBE0';

// Geometria (caixa 940×760).
const HANDS = {x: 470, y: 545}; // centro das palmas: pontas dos dedos em y≈405, mangas até y≈735
const CORE = {x: 470, y: 190}; // ponto de luz no alto, para onde sobem as orações
const SEAL = {x: 742, y: 430};
const START_Y = 395;
const RAYS = 12;

// Metade esquerda das mãos (a direita é o espelho). Origem = centro das palmas.
const HAND_D = 'M 0 -140 C -20 -128 -52 -92 -64 -46 C -74 -6 -74 40 -62 100 L 0 106 Z';
const INDEX_D = 'M -6 -112 C -22 -98 -40 -72 -48 -40';
const THUMB_D = 'M -3 78 C -26 72 -32 22 -24 -12 C -20 -28 -6 -28 -3 -14 Z';
const SLEEVE_D = 'M -80 86 L 6 94 L -36 190 L -196 190 Z';
const CUFF_D = 'M -80 86 L 6 94 L -3 114 L -102 106 Z';
const FOLD_D = 'M -64 142 Q -92 158 -118 184';

const FLAME =
  'M 0 -40 C 10 -26 30 -10 30 12 C 30 30 16 42 0 42 C -16 42 -30 30 -30 12 C -30 -10 -10 -26 0 -40 Z';
const FLAME_CORE =
  'M 0 -4 C 6 4 14 12 14 21 C 14 28 8 32 0 32 C -8 32 -14 28 -14 21 C -14 12 -6 4 0 -4 Z';
const SPARKLE = 'M 0 -22 Q 4 -4 22 0 Q 4 4 0 22 Q -4 4 -22 0 Q -4 -4 0 -22 Z';
const CHECK = 'M -30 2 L -9 24 L 32 -22';

// 5 orações: atraso de saída (frames) e zigue-zague determinístico (seed = índice).
const DELAYS = [0, 4, 9, 13, 18];
const BALLOONS = DELAYS.map((delay, i) => ({delay, spread: Math.sin((i + 1) * 2.3) * 95, phase: i * 1.9}));

// Brilhinhos em volta da luz (relativos ao centro dela).
const SPARKLES = [
  {x: -178, y: -24, s: 0.9},
  {x: 172, y: -58, s: 1},
  {x: 158, y: 92, s: 0.8},
  {x: -160, y: 100, s: 0.7},
];

const HandHalf: React.FC = () => (
  <g>
    <path d={HAND_D} fill={SKIN} stroke={INK} strokeWidth={7} strokeLinejoin="round" />
    <path d={INDEX_D} fill="none" stroke={SKIN_DARK} strokeWidth={5} strokeLinecap="round" />
    <path d={THUMB_D} fill={SKIN} stroke={INK} strokeWidth={5} strokeLinejoin="round" />
  </g>
);

const SleeveHalf: React.FC = () => (
  <g>
    <path d={SLEEVE_D} fill={SLEEVE} stroke={INK} strokeWidth={7} strokeLinejoin="round" />
    <path d={FOLD_D} fill="none" stroke={SLEEVE_DARK} strokeWidth={6} strokeLinecap="round" />
    <path d={CUFF_D} fill={CUFF} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
  </g>
);

export const OracaoOuvida: React.FC<
  SceneProps & {label?: string; labelAt?: number; subirAt?: number; aceitarAt?: number}
> = ({label = '', labelAt = 2.6, subirAt = 1.0, aceitarAt = 2.4, accent, highlight}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = Math.round(subirAt * fps);
  const a = Math.round(aceitarAt * fps);
  const l = Math.round(labelAt * fps);
  // Duração da subida: a primeira oração chega à luz quando o feixe se abre.
  const travel = Math.max(22, Math.min(48, a - s));

  // Mãos: entrada de baixo, empurrãozinho a cada oração solta, respiração.
  const handsIn = spring({frame, fps, config: {damping: 14, stiffness: 140}});
  const handsY = interpolate(handsIn, [0, 1], [320, 0]);
  const handsOp = interpolate(handsIn, [0, 0.3], [0, 1], CLAMP);
  const nudge = Math.max(
    0,
    ...BALLOONS.map((b) =>
      interpolate(frame, [s + b.delay, s + b.delay + 3, s + b.delay + 10], [0, 1, 0], {
        ...CLAMP,
        easing: Easing.inOut(Easing.quad),
      }),
    ),
  );
  const breathe = 1 + 0.015 * Math.sin(frame / 13);
  const glowOp =
    Math.min(
      1,
      interpolate(frame, [2, 16], [0, 0.7], {...CLAMP, easing: Easing.out(Easing.quad)}) +
        0.3 * Math.min(1, spring({frame: frame - s, fps, config: {damping: 200}})),
    ) *
    (0.85 + 0.15 * Math.sin(frame / 9));

  // Luz do alto: brilho fraco desde o início; abre e intensifica em aceitarAt.
  const idle = interpolate(frame, [6, 24], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});
  const open = spring({frame: frame - a, fps, config: {damping: 14, stiffness: 120}});
  const openC = Math.min(1, open);
  const pulse = Math.max(
    0,
    ...BALLOONS.map((b) => {
      const arr = s + b.delay + travel;
      return interpolate(frame, [arr, arr + 3, arr + 11], [0, 1, 0], {...CLAMP, easing: Easing.inOut(Easing.quad)});
    }),
  );
  const coreBase = interpolate(open, [0, 1], [24, 54]);
  const coreR = coreBase * (1 + 0.14 * pulse) * (1 + 0.03 * Math.sin(frame * 0.25));
  const coneSX = interpolate(open, [0, 1], [0.3, 1]);
  const coneOp = 0.35 * idle + 0.65 * openC;
  const haloR = interpolate(open, [0, 1], [110, 250]) * (1 + 0.03 * Math.sin(frame * 0.2));
  const haloOp = Math.min(1, 0.55 * idle + 0.45 * openC);
  const rayP = spring({frame: frame - a - 2, fps, config: {damping: 10, stiffness: 170}});
  const rayOp = interpolate(rayP, [0, 0.25], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});
  const rayRot = Math.max(0, frame - a) * 0.45;

  // Selo "aceita"
  const sealIn = spring({frame: frame - a - 5, fps, config: {damping: 9, stiffness: 190}});
  const sealRot = interpolate(sealIn, [0, 1], [-35, 0]);
  const draw = interpolate(frame, [a + 12, a + 24], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
  const sealBurst = interpolate(frame, [a + 6, a + 26], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
  const sealBob = Math.sin(Math.max(0, frame - a - 5) / 10) * 3;

  const labelIn = spring({frame: frame - l, fps, config: {damping: 10, stiffness: 150}});
  const labelSize = Math.max(52, Math.min(96, Math.floor(1300 / Math.max(1, label.length))));

  return (
    <AbsoluteFill style={{fontFamily: FONT}}>
      <svg style={{position: 'absolute', inset: 0}} width="100%" height="100%" viewBox="0 0 940 760">
        <defs>
          <linearGradient id="oo-cone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={highlight} stopOpacity={0.65} />
            <stop offset="50%" stopColor={highlight} stopOpacity={0.25} />
            <stop offset="100%" stopColor={highlight} stopOpacity={0} />
          </linearGradient>
          <radialGradient id="oo-halo">
            <stop offset="0%" stopColor={highlight} stopOpacity={0.9} />
            <stop offset="45%" stopColor={highlight} stopOpacity={0.35} />
            <stop offset="100%" stopColor={highlight} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="oo-hands">
            <stop offset="0%" stopColor={highlight} stopOpacity={0.55} />
            <stop offset="55%" stopColor={highlight} stopOpacity={0.2} />
            <stop offset="100%" stopColor={highlight} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="oo-flame">
            <stop offset="0%" stopColor={highlight} stopOpacity={0.7} />
            <stop offset="100%" stopColor={highlight} stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* feixe de luz descendo do alto */}
        <path
          d="M 438 -10 L 502 -10 L 690 660 L 250 660 Z"
          fill="url(#oo-cone)"
          opacity={coneOp}
          transform={`translate(${CORE.x} 0) scale(${coneSX} 1) translate(${-CORE.x} 0)`}
        />

        {/* halo e raios girando em volta da luz */}
        <g transform={`translate(${CORE.x} ${CORE.y})`}>
          <circle r={haloR} fill="url(#oo-halo)" opacity={haloOp} />
          {frame >= a
            ? Array.from({length: RAYS}).map((_, i) => {
                const ri = coreBase + 16;
                const ro = ri + rayP * (i % 2 === 0 ? 74 : 48);
                return (
                  <g key={i} transform={`rotate(${i * (360 / RAYS) + rayRot})`} opacity={rayOp}>
                    <line x1={ri} y1={0} x2={ro} y2={0} stroke={INK} strokeWidth={22} strokeLinecap="round" />
                    <line x1={ri} y1={0} x2={ro} y2={0} stroke={highlight} strokeWidth={12} strokeLinecap="round" />
                  </g>
                );
              })
            : null}
        </g>

        {/* brilho atrás das mãos */}
        <circle cx={HANDS.x} cy={520} r={220} fill="url(#oo-hands)" opacity={glowOp} />

        {/* sombra */}
        <ellipse cx={HANDS.x} cy={743} rx={230 * handsIn} ry={20} fill="#000" opacity={0.35 * handsOp} />

        {/* mãos em oração */}
        <g
          opacity={handsOp}
          transform={`translate(${HANDS.x} ${HANDS.y + handsY - 6 * nudge}) translate(0 190) scale(${breathe}) translate(0 -190)`}
        >
          <HandHalf />
          <g transform="scale(-1 1)">
            <HandHalf />
          </g>
          <SleeveHalf />
          <g transform="scale(-1 1)">
            <SleeveHalf />
          </g>
        </g>

        {/* orações subindo */}
        {BALLOONS.map((b, i) => {
          const st = s + b.delay;
          if (frame < st) return null;
          const p = interpolate(frame, [st, st + travel], [0, 1], {...CLAMP, easing: Easing.inOut(Easing.quad)});
          if (p >= 1) return null;
          const env = Math.sin(Math.PI * p);
          const wave = p * Math.PI * 3 + b.phase;
          const x = CORE.x + env * (b.spread + 34 * Math.sin(wave));
          const y = interpolate(p, [0, 1], [START_Y, CORE.y]);
          const tilt = env * 14 * Math.cos(wave);
          const sc = interpolate(p, [0, 0.15, 0.65, 1], [0.25, 1, 1.12, 0.3]);
          const op = interpolate(p, [0, 0.06, 0.8, 1], [0, 1, 1, 0]);
          const flick = 1 + 0.07 * Math.sin(frame * 0.9 + i * 2.1);
          return (
            <g key={i} opacity={op} transform={`translate(${x} ${y}) rotate(${tilt}) scale(${sc})`}>
              <circle r={58} fill="url(#oo-flame)" />
              <g transform={`scale(${2 - flick} ${flick})`}>
                <path d={FLAME} fill={highlight} stroke={INK} strokeWidth={5} strokeLinejoin="round" />
                <path d={FLAME_CORE} fill="#fff" />
              </g>
            </g>
          );
        })}

        {/* núcleo da luz (as orações entram nele) */}
        <g transform={`translate(${CORE.x} ${CORE.y})`} opacity={idle}>
          <circle r={coreR + 9} fill={highlight} />
          <circle r={coreR} fill={LIGHT_CORE} />
        </g>

        {/* clarão quando cada oração entra na luz */}
        {BALLOONS.map((b, i) => {
          const arr = s + b.delay + travel;
          const q = interpolate(frame, [arr, arr + 12], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
          if (q <= 0 || q >= 1) return null;
          return (
            <g key={i} transform={`translate(${CORE.x} ${CORE.y})`} opacity={1 - q}>
              <circle r={coreBase + 8 + 64 * q} fill="none" stroke="#fff" strokeWidth={8 * (1 - q) + 2} />
              <path
                d={SPARKLE}
                transform={`rotate(${q * 90 + i * 25}) scale(${interpolate(q, [0, 0.35, 1], [0.6, 1.7, 0.8])})`}
                fill={highlight}
                stroke={INK}
                strokeWidth={3}
              />
            </g>
          );
        })}

        {/* brilhinhos piscando depois que a luz abre */}
        {frame >= a ? (
          <g transform={`translate(${CORE.x} ${CORE.y})`}>
            {SPARKLES.map((sp, i) => {
              const appear = spring({frame: frame - a - 8 - i * 3, fps, config: {damping: 10, stiffness: 200}});
              const tw = 0.5 + 0.5 * Math.sin((frame - a) * 0.4 + i * 1.9);
              const sc = appear * sp.s * (0.55 + 0.6 * tw);
              if (sc <= 0.01) return null;
              return (
                <path
                  key={i}
                  d={SPARKLE}
                  transform={`translate(${sp.x} ${sp.y}) rotate(${frame * 2 + i * 25}) scale(${sc})`}
                  fill={highlight}
                  stroke={INK}
                  strokeWidth={3}
                  opacity={Math.min(1, appear) * (0.45 + 0.55 * tw)}
                />
              );
            })}
          </g>
        ) : null}

        {/* selo "aceita" */}
        {frame >= a + 5 ? (
          <g transform={`translate(${SEAL.x} ${SEAL.y + sealBob})`}>
            {sealBurst > 0 && sealBurst < 1 ? (
              <circle
                r={70 + 60 * sealBurst}
                fill="none"
                stroke={highlight}
                strokeWidth={10 * (1 - sealBurst) + 1}
                opacity={1 - sealBurst}
              />
            ) : null}
            <g transform={`rotate(${sealRot}) scale(${sealIn})`}>
              <circle cx={6} cy={9} r={70} fill="#000" opacity={0.3} />
              <circle r={70} fill={GREEN} stroke={INK} strokeWidth={8} />
              <circle r={55} fill="none" stroke="#fff" strokeWidth={4} opacity={0.55} />
              <path
                d={CHECK}
                pathLength={1}
                strokeDasharray="1 1"
                strokeDashoffset={1 - draw}
                fill="none"
                stroke="#fff"
                strokeWidth={16}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={draw > 0 ? 1 : 0}
              />
            </g>
          </g>
        ) : null}
      </svg>

      {label ? (
        <div
          style={{
            position: 'absolute',
            top: 30,
            left: 20,
            right: 20,
            fontWeight: 900,
            fontSize: labelSize,
            lineHeight: 1,
            color: accent,
            textTransform: 'uppercase',
            textAlign: 'center',
            transform: `translateY(${interpolate(labelIn, [0, 1], [-30, 0])}px) scale(${labelIn})`,
            ...outline(12),
          }}
        >
          {label}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
