import React from 'react';
import {AbsoluteFill, Easing, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * "Coloca a IA no esforço alto e o bichão vai trabalhar sozinho até zerar os seus tokens":
 * robozinho sentado diante de um laptop (visto em 3/4), martelando o teclado sem parar, enquanto a
 * barra gigante de TOKENS esvazia da direita para a esquerda (verde → highlight → accent) até 0.
 * Ao zerar: a barra pisca em accent, um alerta pisca no canto e o carimbo `label` entra.
 */
const INK = '#111';
const BOT = '#cfdbe7';
const BOT_MID = '#8fa3b8';
const BOT_DARK = '#243042';
const SILVER = '#d9e0e8';
const SILVER_MID = '#aab7c5';
const SILVER_DARK = '#7d8b9b';
const WOOD = '#b07a4f';
const WOOD_DARK = '#8a5a36';
const WOOD_DEEP = '#6e4528';
const SWEAT = '#8fd3ff';
const GREEN = '#22c55e';
const LIGHT_OFF = '#3b4a5e';
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

type Pt = [number, number];

// ---------- barra ----------
const BAR = {x: 90, y: 84, w: 760, h: 90, r: 28};
const BAR_CX = BAR.x + BAR.w / 2;
const BAR_CY = BAR.y + BAR.h / 2;

/** Formato pt-BR determinístico (ponto de milhar): 200000 → "200.000". */
const fmt = (n: number) => String(Math.max(0, Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// ---------- laptop em projeção oblíqua (3/4) ----------
// d: da borda da frente (lado do robô) até a dobradiça; w: largura do laptop (recua para o fundo).
const lp = (d: number, w: number): Pt => [400 + d + 0.55 * w, 570 - 0.35 * w];
const add = ([x, y]: Pt, dx: number, dy: number): Pt => [x + dx, y + dy];
const poly = (ps: Pt[]) => ps.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const unit = ([x, y]: Pt): Pt => {
  const l = Math.hypot(x, y);
  return [x / l, y / l];
};

const LD = 160;
const LW = 150;
const LID: Pt = [52, -190]; // tampa inclinada para trás (tela virada para o robô)
const N0 = lp(0, 0);
const N1 = lp(0, LW);
const H0 = lp(LD, 0);
const H1 = lp(LD, LW);
const T0 = add(H0, LID[0], LID[1]);
const T1 = add(H1, LID[0], LID[1]);
const BASE_TOP = poly([N0, N1, H1, H0]);
const BASE_FRONT = poly([N0, H0, add(H0, 0, 12), add(N0, 0, 12)]);
const BASE_END = poly([H0, H1, add(H1, 0, 12), add(H0, 0, 12)]);
const LID_BACK = poly([H0, H1, T1, T0]);
const LID_EDGE = poly([add(H0, -12, 0), H0, T0, add(T0, -12, 0)]);
const LID_C: Pt = [(H0[0] + H1[0] + T0[0] + T1[0]) / 4, (H0[1] + H1[1] + T0[1] + T1[1]) / 4];
const WU = unit([0.55, -0.35]);
const LU = unit(LID);
/** Coloca o logo no plano da tampa (eixo x = largura, eixo y = descendo pela tampa). */
const LOGO_M = `matrix(${WU[0].toFixed(4)} ${WU[1].toFixed(4)} ${(-LU[0]).toFixed(4)} ${(-LU[1]).toFixed(4)} ${LID_C[0].toFixed(1)} ${LID_C[1].toFixed(1)})`;
/** Luz da tela vazando por trás da tampa em direção ao rosto do robô. */
const GLOW = poly([add(T0, -10, -6), add(H0, -10, -2), [328, 476], [328, 326]]);

const KEY_COLS = [12, 34, 56, 78, 100, 122];
const KEY_ROWS = [28, 50, 72, 94, 116];
const KEYS = Array.from({length: KEY_ROWS.length * KEY_COLS.length}).map((_, id) => {
  const d = KEY_ROWS[Math.floor(id / KEY_COLS.length)];
  const w = KEY_COLS[id % KEY_COLS.length];
  return {id, pts: poly([lp(d, w), lp(d, w + 17), lp(d + 16, w + 17), lp(d + 16, w)])};
});

// ---------- mesa ----------
const DESK_TOP = poly([
  [356, 590],
  [740, 590],
  [850, 520],
  [466, 520],
]);
const DESK_SIDE = poly([
  [740, 590],
  [850, 520],
  [850, 542],
  [740, 612],
]);

// ---------- robô ----------
const LIGHT_X = [230, 254, 278];
const EYES = [
  {x: 252, rx: 18},
  {x: 306, rx: 16},
];
const DROPS = [
  {sx: 178, sy: 342, vx: -3.4, vy: -8, rot: -35, off: 0},
  {sx: 342, sy: 328, vx: 3.2, vy: -9, rot: 30, off: 6},
  {sx: 214, sy: 320, vx: -1.4, vy: -10.5, rot: -12, off: 11},
];
const DROP_PERIOD = 17;
const DROP_D = 'M 0 -18 C 7 -6 12 0 12 6 A 12 12 0 0 1 -12 6 C -12 0 -7 -6 0 -18 Z';

const Arm: React.FC<{sx: number; sy: number; cx: number; cy: number; hx: number; hy: number; fill: string}> = ({
  sx,
  sy,
  cx,
  cy,
  hx,
  hy,
  fill,
}) => {
  const d = `M ${sx} ${sy} Q ${cx} ${cy} ${hx} ${hy}`;
  return (
    <g>
      <path d={d} fill="none" stroke={INK} strokeWidth={26} strokeLinecap="round" />
      <path d={d} fill="none" stroke={fill} strokeWidth={13} strokeLinecap="round" />
      <circle cx={hx} cy={hy} r={16} fill={fill} stroke={INK} strokeWidth={6} />
      <circle cx={hx - 5} cy={hy - 5} r={4} fill="#fff" opacity={0.5} />
    </g>
  );
};

/** Linhas de velocidade acima da mão + faíscas quando ela bate na tecla. */
const HandFx: React.FC<{x: number; y: number; restY: number; lift: number; frame: number; seed: number; color: string}> = ({
  x,
  y,
  restY,
  lift,
  frame,
  seed,
  color,
}) => {
  const flick = 0.3 + 0.45 * Math.abs(Math.sin(frame * 1.7 + seed));
  const cy = restY + 12;
  return (
    <g>
      <path
        d={`M ${x - 22} ${y - 30} Q ${x} ${y - 42} ${x + 22} ${y - 30}`}
        fill="none"
        stroke="#fff"
        strokeWidth={5}
        strokeLinecap="round"
        opacity={flick}
      />
      <path
        d={`M ${x - 30} ${y - 46} Q ${x} ${y - 62} ${x + 30} ${y - 46}`}
        fill="none"
        stroke="#fff"
        strokeWidth={5}
        strokeLinecap="round"
        opacity={flick * 0.6}
      />
      {lift < 0.28
        ? [-170, -140, -40, -10].map((deg) => {
            const a = (deg * Math.PI) / 180;
            return (
              <line
                key={deg}
                x1={x + Math.cos(a) * 22}
                y1={cy + Math.sin(a) * 22}
                x2={x + Math.cos(a) * 40}
                y2={cy + Math.sin(a) * 40}
                stroke={color}
                strokeWidth={5}
                strokeLinecap="round"
              />
            );
          })
        : null}
    </g>
  );
};

export const TokensZerando: React.FC<
  SceneProps & {
    titulo?: string;
    inicio?: number;
    drenarAt?: number;
    zerarAt?: number;
    label?: string;
    labelAt?: number;
  }
> = ({
  titulo = 'Tokens',
  inicio = 200000,
  drenarAt = 0.2,
  zerarAt = 2.2,
  label = 'Zerou!',
  labelAt = 2.4,
  accent,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const dF = Math.round(drenarAt * fps);
  const zF = Math.max(dF + 1, Math.round(zerarAt * fps));
  const lF = Math.round(labelAt * fps);

  // ---------- entradas (barra primeiro, robô + laptop 5 frames depois) ----------
  const barIn = spring({frame, fps, config: {damping: 13, stiffness: 170}});
  const shadowIn = spring({frame: frame - 4, fps, config: {damping: 14}});
  const sceneIn = spring({frame: frame - 5, fps, config: {damping: 12, stiffness: 150}});
  const labelIn = spring({frame: frame - lF, fps, config: {damping: 9, stiffness: 190}});
  const labelRot = interpolate(labelIn, [0, 1], [-24, -6]);

  // ---------- barra esvaziando ----------
  const fillAt = (f: number) => interpolate(f, [dF, zF], [1, 0], {...CLAMP, easing: Easing.inOut(Easing.cubic)});
  const p = fillAt(frame);
  const barColor = interpolateColors(p, [0, 0.5, 1], [accent, highlight, GREEN]);
  const tZ = frame - zF;
  const zeroed = tZ >= 0;
  const flashOn = zeroed && tZ < 24 && Math.floor(tZ / 4) % 2 === 0;
  const trackFlash = flashOn ? 0.95 : zeroed ? 0.2 : 0;
  const shakeX = zeroed ? Math.sin(tZ * 2.4) * 12 * Math.exp(-tZ * 0.14) : 0;
  const alertIn = spring({frame: tZ, fps, config: {damping: 8, stiffness: 220}});
  const alertOn = zeroed && Math.floor(tZ / 5) % 2 === 0;
  const coinFade = interpolate(frame, [zF - 3, zF + 3], [1, 0], CLAMP);

  // ---------- digitação frenética ----------
  const bob = Math.sin(frame * 2.2) * 2.5;
  const headTilt = Math.sin(frame * 1.15) * 1.6;
  const antRot = Math.sin(frame * 0.9) * 12;
  const eyeJit = Math.sin(frame * 1.7) * 1.5;
  const liftF = (Math.sin(frame * 1.15 + 2.4) + 1) / 2;
  const liftN = (Math.sin(frame * 1.15) + 1) / 2;
  const far = {x: 528 + Math.sin(frame * 0.5 + 1.3) * 9, rest: 522};
  const near = {x: 479 + Math.sin(frame * 0.5) * 9, rest: 546};
  const farY = far.rest - liftF * 24;
  const nearY = near.rest - liftN * 24;
  const keyBucket = Math.floor(frame / 2);

  const glowColor = zeroed ? accent : barColor;
  const glowOp = zeroed ? (Math.floor(tZ / 3) % 2 === 0 ? 0.3 : 0.12) : 0.16 + 0.06 * Math.sin(frame * 0.8);
  const antColor = zeroed && Math.floor(tZ / 4) % 2 === 0 ? accent : highlight;
  const lightColor = (i: number) => {
    if (zeroed) return Math.floor(tZ / 4) % 2 === 0 ? accent : LIGHT_OFF;
    return Math.floor(frame / 4 + i) % 3 === 0 ? LIGHT_OFF : [GREEN, highlight, accent][i];
  };

  const barT =
    `translate(${shakeX} ${(1 - barIn) * -50}) ` +
    `translate(${BAR_CX} ${BAR_CY}) scale(${barIn}) translate(${-BAR_CX} ${-BAR_CY})`;
  const sceneT = `translate(0 ${(1 - sceneIn) * 120}) translate(470 712) scale(${sceneIn}) translate(-470 -712)`;

  return (
    <AbsoluteFill style={{fontFamily: FONT}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        <defs>
          <clipPath id="tokens-zerando-bar">
            <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={BAR.r} />
          </clipPath>
          <clipPath id="tokens-zerando-head">
            <rect x={170} y={318} width={180} height={140} rx={36} />
          </clipPath>
        </defs>

        <ellipse cx={470} cy={698} rx={390 * shadowIn} ry={46} fill="#000" opacity={0.35} />

        {/* ================= robô + mesa + laptop ================= */}
        <g transform={sceneT}>
          <g transform="translate(-44 0)">
            {/* banquinho */}
            <rect x={200} y={612} width={18} height={100} rx={6} fill={WOOD_DARK} stroke={INK} strokeWidth={5} />
            <rect x={304} y={612} width={18} height={100} rx={6} fill={WOOD_DARK} stroke={INK} strokeWidth={5} />
            <rect x={186} y={596} width={150} height={24} rx={10} fill={WOOD} stroke={INK} strokeWidth={6} />

            {/* pernas de trás da mesa */}
            <rect x={478} y={600} width={18} height={52} rx={5} fill={WOOD_DEEP} stroke={INK} strokeWidth={5} />
            <rect x={826} y={545} width={18} height={107} rx={5} fill={WOOD_DEEP} stroke={INK} strokeWidth={5} />

            {/* pernas do robô (debaixo da mesa) */}
            <g transform="translate(-14 -6)">
              <path
                d="M 300 600 L 404 624 L 408 696"
                fill="none"
                stroke={INK}
                strokeWidth={30}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M 300 600 L 404 624 L 408 696"
                fill="none"
                stroke={BOT_MID}
                strokeWidth={17}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <ellipse cx={430} cy={704} rx={28} ry={12} fill={BOT_DARK} stroke={INK} strokeWidth={5} />
            </g>
            <path
              d="M 300 600 L 404 624 L 408 696"
              fill="none"
              stroke={INK}
              strokeWidth={30}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M 300 600 L 404 624 L 408 696"
              fill="none"
              stroke={BOT}
              strokeWidth={17}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <ellipse cx={430} cy={704} rx={28} ry={12} fill={BOT_DARK} stroke={INK} strokeWidth={5} />

            {/* mesa */}
            <rect x={362} y={606} width={22} height={106} rx={6} fill={WOOD_DARK} stroke={INK} strokeWidth={5} />
            <rect x={712} y={606} width={22} height={106} rx={6} fill={WOOD_DARK} stroke={INK} strokeWidth={5} />
            <polygon points={DESK_SIDE} fill={WOOD_DEEP} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
            <polygon points={DESK_TOP} fill={WOOD} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
            <rect x={356} y={590} width={384} height={22} fill={WOOD_DARK} stroke={INK} strokeWidth={6} strokeLinejoin="round" />

            {/* luz da tela vazando em direção ao robô */}
            <polygon points={GLOW} fill={glowColor} opacity={glowOp} />

            {/* laptop: base + teclado */}
            <polygon points={BASE_FRONT} fill={SILVER_DARK} stroke={INK} strokeWidth={5} strokeLinejoin="round" />
            <polygon points={BASE_END} fill={SILVER_MID} stroke={INK} strokeWidth={5} strokeLinejoin="round" />
            <polygon points={BASE_TOP} fill={SILVER} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
            {KEYS.map((k) => (
              <polygon
                key={k.id}
                points={k.pts}
                fill={(k.id * 7 + keyBucket * 5) % 11 === 0 ? highlight : BOT_DARK}
                stroke={INK}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            ))}

            {/* laptop: tampa (vemos as costas; a tela está virada para o robô) */}
            <polygon points={LID_EDGE} fill={SILVER_DARK} stroke={INK} strokeWidth={5} strokeLinejoin="round" />
            <polygon points={LID_BACK} fill={SILVER_MID} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
            <g transform={LOGO_M}>
              <path
                d="M 0 -34 Q 4 -4 34 0 Q 4 4 0 34 Q -4 4 -34 0 Q -4 -4 0 -34 Z"
                fill={highlight}
                stroke={INK}
                strokeWidth={5}
                strokeLinejoin="round"
              />
            </g>

            {/* braço de trás */}
            <Arm sx={300} sy={494 + bob} cx={404} cy={542} hx={far.x} hy={farY} fill={BOT_MID} />

            {/* corpo + cabeça (tremendo de tanto digitar) */}
            <g transform={`translate(0 ${bob})`}>
              <rect x={182} y={470} width={156} height={132} rx={32} fill={BOT} stroke={INK} strokeWidth={7} />
              <path d="M 198 500 L 198 572" stroke="#fff" strokeWidth={6} strokeLinecap="round" opacity={0.45} />
              <rect x={206} y={496} width={96} height={58} rx={12} fill={BOT_DARK} stroke={INK} strokeWidth={5} />
              {LIGHT_X.map((x, i) => (
                <circle key={x} cx={x} cy={525} r={8} fill={lightColor(i)} stroke={INK} strokeWidth={3} />
              ))}
              <rect x={238} y={450} width={44} height={26} rx={6} fill={BOT_MID} stroke={INK} strokeWidth={6} />

              <g transform={`rotate(${headTilt} 260 460)`}>
                {/* antena */}
                <g transform={`rotate(${antRot} 250 322)`}>
                  <path d="M 250 326 Q 252 304 240 290" fill="none" stroke={INK} strokeWidth={7} strokeLinecap="round" />
                  <circle cx={238} cy={280} r={15} fill={antColor} stroke={INK} strokeWidth={6} />
                  <circle cx={233} cy={275} r={4} fill="#fff" opacity={0.7} />
                </g>
                {/* orelha */}
                <rect x={152} y={364} width={26} height={50} rx={9} fill={highlight} stroke={INK} strokeWidth={6} />
                {/* cabeça com lateral sombreada (3/4) */}
                <rect x={170} y={318} width={180} height={140} rx={36} fill={BOT} />
                <g clipPath="url(#tokens-zerando-head)">
                  <rect x={170} y={318} width={34} height={140} fill={BOT_MID} />
                </g>
                <rect x={170} y={318} width={180} height={140} rx={36} fill="none" stroke={INK} strokeWidth={7} />
                {/* visor */}
                <rect x={214} y={348} width={128} height={88} rx={24} fill={BOT_DARK} stroke={INK} strokeWidth={5} />
                <rect x={214} y={348} width={128} height={88} rx={24} fill={glowColor} opacity={0.14} />
                <path d="M 226 364 Q 232 356 246 356" fill="none" stroke="#fff" strokeWidth={5} strokeLinecap="round" opacity={0.35} />
                {EYES.map((e) => (
                  <g key={e.x}>
                    <ellipse cx={e.x} cy={386} rx={e.rx} ry={21} fill="#fff" />
                    <circle cx={e.x + 6 + eyeJit} cy={392} r={9} fill={INK} />
                    <circle cx={e.x + 3 + eyeJit} cy={389} r={3} fill="#fff" />
                  </g>
                ))}
                {/* boca tensa */}
                <path
                  d="M 262 424 l 8 -6 l 8 6 l 8 -6 l 8 6 l 8 -6 l 8 6"
                  fill="none"
                  stroke={highlight}
                  strokeWidth={5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            </g>

            {/* braço da frente */}
            <Arm sx={330} sy={512 + bob} cx={396} cy={572} hx={near.x} hy={nearY} fill={BOT} />
            <circle cx={330} cy={512 + bob} r={13} fill={BOT_MID} stroke={INK} strokeWidth={5} />

            {/* faíscas e linhas de velocidade */}
            <HandFx x={far.x} y={farY} restY={far.rest} lift={liftF} frame={frame} seed={1.1} color={highlight} />
            <HandFx x={near.x} y={nearY} restY={near.rest} lift={liftN} frame={frame} seed={0} color={highlight} />

            {/* gotas de suor */}
            {DROPS.map((d) => {
              const t = (frame + d.off) % DROP_PERIOD;
              const x = d.sx + d.vx * t;
              const y = d.sy + bob + d.vy * t + 0.9 * t * t;
              const op = interpolate(t, [0, 2, 12, 16], [0, 1, 1, 0], CLAMP) * Math.min(1, sceneIn);
              return (
                <path
                  key={d.off}
                  d={DROP_D}
                  transform={`translate(${x} ${y}) rotate(${d.rot})`}
                  fill={SWEAT}
                  stroke={INK}
                  strokeWidth={4}
                  strokeLinejoin="round"
                  opacity={op}
                />
              );
            })}
          </g>
        </g>

        {/* ================= fichas caindo da ponta da barra ================= */}
        {frame >= dF && frame < zF + 4
          ? Array.from({length: 5}).map((_, i) => {
              const age = frame - dF - i * 3;
              if (age < 0) return null;
              const t = age % 14;
              const pBorn = fillAt(frame - t);
              if (pBorn < 0.02) return null;
              const x = BAR.x + BAR.w * pBorn - 10 + Math.sin(i * 2.3) * 3 * t;
              const y = BAR.y + BAR.h - 4 + t * 6 + t * t * 0.45;
              const op = interpolate(t, [0, 2, 9, 13], [0, 1, 1, 0], CLAMP) * coinFade;
              return (
                <g key={i} transform={`translate(${x} ${y}) rotate(${t * 25 + i * 40})`} opacity={op}>
                  <circle r={13} fill={barColor} stroke={INK} strokeWidth={5} />
                  <rect x={-3} y={-7} width={6} height={14} rx={3} fill="#fff" opacity={0.6} />
                </g>
              );
            })
          : null}

        {/* ================= barra de TOKENS ================= */}
        <g transform={barT} opacity={Math.min(1, barIn * 1.4)}>
          <text
            x={BAR.x + 4}
            y={BAR.y - 18}
            fontFamily={FONT}
            fontWeight={900}
            fontSize={48}
            letterSpacing={2}
            fill="#fff"
            stroke={INK}
            strokeWidth={10}
            strokeLinejoin="round"
            style={{paintOrder: 'stroke'}}
          >
            {titulo.toLocaleUpperCase('pt-BR')}
          </text>
          {flashOn ? (
            <rect
              x={BAR.x - 12}
              y={BAR.y - 12}
              width={BAR.w + 24}
              height={BAR.h + 24}
              rx={BAR.r + 12}
              fill="none"
              stroke={accent}
              strokeWidth={8}
              opacity={0.8}
            />
          ) : null}
          <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={BAR.r} fill="#2a3242" />
          <g clipPath="url(#tokens-zerando-bar)">
            <rect x={BAR.x} y={BAR.y} width={BAR.w * p} height={BAR.h} fill={barColor} />
            <rect x={BAR.x} y={BAR.y + BAR.h - 18} width={BAR.w * p} height={18} fill="#000" opacity={0.15} />
            <rect
              x={BAR.x + 14}
              y={BAR.y + 12}
              width={Math.max(0, BAR.w * p - 28)}
              height={14}
              rx={7}
              fill="#fff"
              opacity={0.3}
            />
            <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} fill={accent} opacity={trackFlash} />
            {Array.from({length: 7}).map((_, i) => {
              const x = BAR.x + (BAR.w * (i + 1)) / 8;
              return (
                <line
                  key={i}
                  x1={x}
                  y1={BAR.y + 10}
                  x2={x}
                  y2={BAR.y + BAR.h - 10}
                  stroke="#000"
                  strokeWidth={4}
                  strokeLinecap="round"
                  opacity={0.22}
                />
              );
            })}
          </g>
          <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={BAR.r} fill="none" stroke={INK} strokeWidth={8} />
          <text
            x={BAR_CX}
            y={BAR_CY + 21}
            textAnchor="middle"
            fontFamily={FONT}
            fontWeight={900}
            fontSize={60}
            fill="#fff"
            stroke={INK}
            strokeWidth={12}
            strokeLinejoin="round"
            style={{paintOrder: 'stroke', fontVariantNumeric: 'tabular-nums'}}
          >
            {fmt(inicio * p)}
          </text>
        </g>

        {/* ================= alerta piscando ao zerar ================= */}
        {zeroed ? (
          <g transform={`translate(852 82) rotate(8) scale(${alertIn * (alertOn ? 1.08 : 0.94)})`}>
            <path
              d="M 0 -52 L 54 42 L -54 42 Z"
              fill={alertOn ? highlight : accent}
              stroke={INK}
              strokeWidth={8}
              strokeLinejoin="round"
            />
            <rect x={-7} y={-24} width={14} height={40} rx={7} fill={INK} />
            <circle cx={0} cy={29} r={8} fill={INK} />
          </g>
        ) : null}
      </svg>

      {label ? (
        <div
          style={{
            position: 'absolute',
            top: 204,
            left: 0,
            right: 0,
            fontWeight: 900,
            fontSize: 90,
            lineHeight: 1,
            color: accent,
            textTransform: 'uppercase',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            transform: `rotate(${labelRot}deg) scale(${labelIn})`,
            ...outline(12),
          }}
        >
          {label}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
