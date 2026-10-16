import React from 'react';
import {AbsoluteFill, Easing, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * "A mágoa é como comida que fica no estômago: não digere, incomoda e dói": um estômago rosado
 * entra na tela e um caroço escuro cai pelo esôfago e quica lá dentro. O estômago trabalha
 * (ondula, solta bolhas, a carinha olha para a pedra), mas o caroço não se desfaz. Em `dorAt` ele
 * esquenta para vermelho, treme, faz careta e raios de dor piscam em volta; em `labelAt` o caroço
 * pulsa e entra o rótulo (e, se houver, o texto `caroco` escrito na pedra).
 */

const INK = '#111';
const PINK = '#f9a8b8';
const PINK_SHADE = '#f472b6';
const HOLE = '#db2777';
const HOT = '#ff6a5c';
const HOT_SHADE = '#e11d48';
const HOT_HOLE = '#9f1239';
const STONE = '#3f3f46';
const STONE_DARK = '#18181b';
const STONE_SHINE = '#a1a1aa';
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// Centro do desenho (escala/tremor) e deslocamento que centraliza o conjunto na caixa 940×760.
const CX = 500;
const CY = 450;
const SHIFT = 'translate(-65 10)';

// Caroço: cai pelo esôfago (x = ESO_X) e pousa no fundo (base em REST_Y).
const ESO_X = 530;
const ESO_TOP = 150;
const REST_X = 455;
const START_Y = -120;
const REST_Y = 620;
const STONE_PTS = '-88,-30 -70,-92 -20,-124 44,-118 86,-80 92,-28 60,0 -56,0';
const STONE_FACET = '44,-118 86,-80 92,-28 60,0 12,0 30,-58';

const DUODENO = 'M 690 506 C 760 498 806 536 800 596 C 794 652 744 682 682 678';

/** Contorno do estômago em "J" com o esôfago; `w` é a fase da peristalse (onda fundo → piloro). */
const stomachD = (w: number, closed: boolean) => {
  const a = 9 * Math.sin(w);
  const b = 9 * Math.sin(w - 1.3);
  const c = 8 * Math.sin(w - 2.6);
  const d = 7 * Math.sin(w - 3.9);
  return [
    'M 492 150',
    'C 488 200 500 250 494 296',
    `C 452 ${246 - a} ${306 - a} ${246 - a} ${276 - 0.6 * a} 360`,
    `C ${250 - b} 470 ${296 - 0.5 * b} ${640 + c} 450 ${650 + c}`,
    `C 592 ${660 + c} ${690 + 0.5 * d} ${612 + d} 724 530`,
    'L 712 484',
    `C 680 ${520 - 0.5 * d} 612 ${530 - 0.5 * d} 590 470`,
    'C 574 420 572 350 570 286',
    'C 570 240 564 200 568 150',
    closed ? 'Z' : '',
  ].join(' ');
};

const BUBBLES = [
  {x: 318, y: 600, r: 11, per: 46, off: 0},
  {x: 348, y: 560, r: 7, per: 40, off: 9},
  {x: 572, y: 575, r: 9, per: 44, off: 25},
  {x: 600, y: 625, r: 8, per: 38, off: 17},
  {x: 652, y: 600, r: 11, per: 52, off: 30},
];

// Raios de dor: ponto de partida (fora do contorno), ângulo para fora, atraso e cor.
const BOLTS: {x: number; y: number; a: number; d: number; c: 'a' | 'h'}[] = [
  {x: 292, y: 270, a: -140, d: 0, c: 'h'},
  {x: 664, y: 440, a: -45, d: 3, c: 'a'},
  {x: 236, y: 470, a: 180, d: 6, c: 'a'},
  {x: 836, y: 560, a: 10, d: 9, c: 'h'},
  {x: 318, y: 625, a: 135, d: 12, c: 'h'},
];
const ZIG = 'M 0 0 L 16 -16 L 32 16 L 48 -16 L 64 16 L 80 -16 L 94 0';
const RAYS = [
  {r: 0, k: 1, dx: 0},
  {r: -30, k: 0.6, dx: 14},
  {r: 30, k: 0.6, dx: 14},
];

/** Carinha do estômago: neutra (olha para a pedra, pisca) → dolorida (> <, sobrancelha, boca ondulada). */
const Face: React.FC<{pain: number; look: number; blink: number; blush: string}> = ({pain, look, blink, blush}) => {
  const calmOp = interpolate(pain, [0, 0.5], [1, 0], CLAMP);
  const painOp = interpolate(pain, [0.3, 0.8], [0, 1], CLAMP);
  const line = {fill: 'none', stroke: INK, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const};
  return (
    <g>
      <ellipse cx={-64} cy={28} rx={15} ry={8} fill={blush} opacity={0.6} />
      <ellipse cx={64} cy={28} rx={15} ry={8} fill={blush} opacity={0.6} />
      <g opacity={calmOp}>
        <g transform={`translate(${5 * look} ${7 * look})`}>
          <ellipse cx={-40} cy={0} rx={11} ry={16 * blink} fill={INK} />
          <ellipse cx={40} cy={0} rx={11} ry={16 * blink} fill={INK} />
        </g>
        <path d="M -18 42 Q 0 54 18 42" {...line} strokeWidth={7} />
      </g>
      <g opacity={painOp} transform={`scale(${0.7 + 0.3 * painOp})`}>
        <path d="M -54 -14 L -30 0 L -54 14 M 54 -14 L 30 0 L 54 14" {...line} strokeWidth={8} />
        <path d="M -66 -30 L -28 -42 M 66 -30 L 28 -42" {...line} strokeWidth={7} />
        <path d="M -36 46 q 9 -12 18 0 q 9 12 18 0 q 9 -12 18 0 q 9 12 18 0" {...line} strokeWidth={7} />
      </g>
    </g>
  );
};

export const Estomago: React.FC<
  SceneProps & {label?: string; labelAt?: number; caroco?: string; dorAt?: number}
> = ({label = '', labelAt = 2.0, caroco = '', dorAt = 1.5, accent, highlight}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const labelF = Math.round(labelAt * fps);
  const labelIn = spring({frame: frame - labelF, fps, config: {damping: 10}});
  const labelSize = Math.max(48, Math.min(80, Math.floor(1220 / Math.max(1, label.length))));
  const carocoSize = Math.max(22, Math.min(42, Math.floor(270 / Math.max(1, caroco.length))));

  // --- Entrada do estômago.
  const enter = spring({frame, fps, config: {damping: 12, stiffness: 140}});

  // --- Caroço: cai pelo esôfago; o excesso da mola é refletido no "chão" e vira quique.
  const stoneF = Math.round(0.2 * fps);
  const landF = stoneF + Math.round(0.27 * fps);
  const drop = (f: number) => spring({frame: f - stoneF, fps, config: {damping: 14, stiffness: 120}});
  const p = drop(frame);
  const speed = interpolate(Math.abs(p - drop(frame - 1)) * (fps / 30), [0, 0.08], [0, 1], CLAMP);
  const near = interpolate(Math.abs(1 - p), [0, 0.1], [1, 0], CLAMP);
  const stoneY = interpolate(1 - Math.abs(1 - p), [0, 1], [START_Y, REST_Y]);
  const landed = interpolate(frame, [landF, landF + Math.round(0.3 * fps)], [0, 1], {
    ...CLAMP,
    easing: Easing.out(Easing.cubic),
  });
  const moveX = interpolate(frame, [stoneF + Math.round(0.15 * fps), landF], [ESO_X, REST_X], {
    ...CLAMP,
    easing: Easing.inOut(Easing.cubic),
  });
  // Estica ao cair, afina dentro do esôfago, achata no impacto; pulsa quando é revelado.
  const tube = interpolate(stoneY, [ESO_TOP - 20, ESO_TOP + 40, 300, 380], [0, 1, 1, 0], CLAMP);
  const squeeze = Math.max(0.6 * speed * (1 - near), tube);
  const impact = speed * near;
  const reveal = interpolate(frame, [labelF, labelF + 4, labelF + 14], [0, 1, 0], {
    ...CLAMP,
    easing: Easing.inOut(Easing.quad),
  });
  const stoneSx = (1 - 0.5 * squeeze + 0.25 * impact) * (1 + 0.12 * reveal);
  const stoneSy = (1 + 0.3 * squeeze - 0.22 * impact) * (1 + 0.12 * reveal);

  // --- Dor: esquenta, pulsa (batida curta + cólica a cada ~1,7 s) e treme.
  const dorF = Math.round(dorAt * fps);
  const tD = frame - dorF;
  const hurting = tD >= 0;
  const heat = spring({frame: tD, fps, config: {damping: 200}, durationInFrames: Math.round(0.5 * fps)});
  const beat = hurting ? Math.pow((1 + Math.sin(tD * 0.42 - Math.PI / 2)) / 2, 3) : 0;
  const cramp = hurting ? Math.pow(Math.max(0, Math.sin(tD * 0.12 - 0.6)), 6) : 0;
  const calm = interpolate(tD, [1.5 * fps, 3 * fps], [1, 0.55], {...CLAMP, easing: Easing.inOut(Easing.sin)});
  const cr = heat * cramp;
  const shakeAmp = heat * (3 * calm + 4 * cramp);
  const shakeX = hurting ? shakeAmp * (Math.sin(tD * 2.3) + 0.5 * Math.sin(tD * 3.7 + 1.1)) : 0;
  const shakeR = hurting ? shakeAmp * 0.35 * Math.sin(tD * 2.9 + 0.4) : 0;
  const hot = Math.min(1, heat * (0.72 + 0.28 * Math.max(beat, cramp)));
  const fill = interpolateColors(hot, [0, 1], [PINK, HOT]);
  const shade = interpolateColors(hot, [0, 1], [PINK_SHADE, HOT_SHADE]);
  const hole = interpolateColors(hot, [0, 1], [HOLE, HOT_HOLE]);
  const faceP = spring({frame: tD, fps, config: {damping: 12, stiffness: 200}});
  const blink = interpolate(frame % 66, [44, 46, 49], [1, 0.1, 1], {...CLAMP, easing: Easing.inOut(Easing.quad)});

  // --- Corpo: peristalse (onda no contorno + respiração), tranco do caroço, pulso e cólica.
  const wave = frame * 0.16;
  const wob = Math.sin(frame * 0.11);
  const per = 0.012 + 0.008 * heat;
  const kick = spring({frame: frame - landF, fps, config: {damping: 8, stiffness: 200}});
  const bump = frame >= landF ? 0.06 * (1 - kick) : 0;
  const pulse = 1 + 0.025 * heat * beat;
  const bodySx = enter * pulse * (1 + per * wob) * (1 + 0.7 * bump) * (1 - 0.05 * cr);
  const bodySy = enter * pulse * (1 - per * wob) * (1 - bump) * (1 + 0.04 * cr);
  const body = `translate(${CX + shakeX} ${CY}) rotate(${shakeR}) scale(${bodySx} ${bodySy}) translate(${-CX} ${-CY})`;
  const fillD = stomachD(wave, true);
  const lineD = stomachD(wave, false);

  // --- Caroço: balança devagar (não se desfaz) e treme junto na dor.
  const jitter = hurting ? heat * 2 * Math.sin(tD * 3.1) : 0;
  const stoneX = moveX + landed * 6 * Math.sin(frame * 0.07) + jitter;
  const stoneRot = -24 * (1 - Math.min(1, p)) + landed * 6 * Math.sin(frame * 0.1 + 0.8);
  const stoneCy = stoneY - 62;

  // --- Anel de revelação no caroço quando o rótulo entra.
  const ringT = interpolate(frame, [labelF, labelF + Math.round(0.7 * fps)], [0, 1], {
    ...CLAMP,
    easing: Easing.out(Easing.cubic),
  });
  const ringOp = frame >= labelF && (label || caroco) ? 1 - ringT : 0;

  return (
    <AbsoluteFill style={{fontFamily: FONT, alignItems: 'center'}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        <defs>
          <clipPath id="estomago-dentro">
            <path d={fillD} />
          </clipPath>
          <clipPath id="estomago-queda">
            <path d={fillD} />
            <rect x={-400} y={-800} width={1800} height={800 + ESO_TOP + 2} />
          </clipPath>
          <radialGradient id="estomago-halo">
            <stop offset="0%" stopColor="#fff" stopOpacity={0.16} />
            <stop offset="100%" stopColor="#fff" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="estomago-dor">
            <stop offset="0%" stopColor={accent} stopOpacity={0.8} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </radialGradient>
          <filter id="estomago-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={16} />
          </filter>
        </defs>

        <g transform={SHIFT}>
          {/* sombra, halo e brilho vermelho da dor */}
          <ellipse cx={520} cy={722} rx={Math.max(0, 270 * enter)} ry={22} fill="#000" opacity={0.35} />
          <circle cx={530} cy={440} r={Math.max(0, 340 * enter)} fill="url(#estomago-halo)" />
          {heat > 0.001 ? (
            <circle cx={530} cy={450} r={380} fill="url(#estomago-dor)" opacity={heat * (0.3 + 0.3 * Math.max(beat, cramp))} />
          ) : null}

          <g transform={body}>
            {/* intestino curtinho (atrás) */}
            <path d={DUODENO} fill="none" stroke={INK} strokeWidth={50} strokeLinecap="round" />
            <path d={DUODENO} fill="none" stroke={fill} strokeWidth={34} strokeLinecap="round" />

            {/* estômago: preenchimento, sombra interna, brilho e bolhas */}
            <path d={fillD} fill={fill} />
            <g clipPath="url(#estomago-dentro)">
              <path d={fillD} fill="none" stroke={shade} strokeWidth={46} opacity={0.55} />
              <path d="M 300 420 Q 296 330 372 290" fill="none" stroke="#fff" strokeWidth={12} strokeLinecap="round" opacity={0.45} />
              <path d="M 506 168 Q 500 220 506 268" fill="none" stroke="#fff" strokeWidth={7} strokeLinecap="round" opacity={0.4} />
              {BUBBLES.map((b, i) => {
                const c = ((frame + b.off) % b.per) / b.per;
                const rise = Easing.out(Easing.quad)(c);
                const op = interpolate(c, [0, 0.2, 0.75, 1], [0, 0.75, 0.75, 0], CLAMP) * landed;
                if (op <= 0.01) return null;
                return (
                  <circle
                    key={i}
                    cx={b.x + 5 * Math.sin(frame * 0.15 + i * 1.7)}
                    cy={b.y - 100 * rise}
                    r={b.r * (0.6 + 0.4 * rise)}
                    fill="#fff"
                    fillOpacity={0.55}
                    stroke={shade}
                    strokeWidth={3}
                    opacity={op}
                  />
                );
              })}
              {heat > 0.001 ? (
                <circle
                  cx={stoneX}
                  cy={stoneCy}
                  r={110}
                  fill={accent}
                  filter="url(#estomago-blur)"
                  opacity={heat * (0.35 + 0.4 * Math.max(beat, cramp))}
                />
              ) : null}
            </g>

            {/* boca do esôfago */}
            <ellipse cx={ESO_X} cy={ESO_TOP} rx={38} ry={10} fill={hole} stroke={INK} strokeWidth={7} />

            {/* caroço (recortado pelo tubo/estômago, visível acima do esôfago na queda) */}
            {frame >= stoneF ? (
              <g clipPath="url(#estomago-queda)">
                <g transform={`translate(${stoneX} ${stoneY}) rotate(${stoneRot}) scale(${stoneSx} ${stoneSy})`}>
                  <polygon points={STONE_PTS} fill={STONE} />
                  <polygon points={STONE_FACET} fill={STONE_DARK} />
                  <polyline points="44,-118 30,-58 12,0" fill="none" stroke={INK} strokeWidth={4} strokeLinejoin="round" opacity={0.45} />
                  <polyline
                    points="-66,-80 -24,-108 18,-108"
                    fill="none"
                    stroke={STONE_SHINE}
                    strokeWidth={7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.7}
                  />
                  <circle cx={-46} cy={-62} r={6} fill="#fff" opacity={0.35} />
                  <polygon points={STONE_PTS} fill="none" stroke={INK} strokeWidth={8} strokeLinejoin="round" />
                </g>
              </g>
            ) : null}

            {/* contorno grosso por cima */}
            <path d={lineD} fill="none" stroke={INK} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />

            {/* carinha */}
            <g transform="translate(410 392)">
              <Face pain={faceP} look={landed} blink={blink} blush={shade} />
            </g>

            {/* revelação: anel no caroço e texto opcional sobre ele */}
            {ringOp > 0.001 ? (
              <circle
                cx={stoneX}
                cy={stoneCy}
                r={80 + 90 * ringT}
                fill="none"
                stroke={highlight}
                strokeWidth={2 + 8 * (1 - ringT)}
                opacity={ringOp}
              />
            ) : null}
            {caroco ? (
              <g transform={`translate(${stoneX} ${stoneCy + 2}) rotate(${stoneRot * 0.5}) scale(${labelIn})`}>
                <text
                  x={0}
                  y={carocoSize * 0.36}
                  textAnchor="middle"
                  fontFamily={FONT}
                  fontWeight={900}
                  fontSize={carocoSize}
                  fill={highlight}
                  stroke={INK}
                  strokeWidth={9}
                  strokeLinejoin="round"
                  paintOrder="stroke"
                >
                  {caroco.toUpperCase()}
                </text>
              </g>
            ) : null}
          </g>

          {/* raios de dor em zigue-zague, escalonados, pulsando e piscando */}
          {hurting
            ? BOLTS.map((b, i) => {
                const s = spring({frame: tD - b.d, fps, config: {damping: 9, stiffness: 180}});
                if (s <= 0.001) return null;
                const bb = Math.pow((1 + Math.sin(tD * 0.42 - Math.PI / 2 - i * 1.1)) / 2, 2);
                const off = Math.floor((tD + i * 5) / 6) % 3 === 2;
                const op = off ? interpolate(calm, [0.55, 1], [0.75, 0.3], CLAMP) : 1;
                const sc = s * (0.8 + 0.3 * bb) * (1 + 0.3 * cramp);
                const push = 12 + 18 * bb + 14 * cramp;
                const color = b.c === 'a' ? accent : highlight;
                return (
                  <g
                    key={i}
                    transform={`translate(${b.x + shakeX * 0.6} ${b.y}) rotate(${b.a}) translate(${push} 0) scale(${sc})`}
                    opacity={op}
                  >
                    {RAYS.map((z) => (
                      <path
                        key={`o${z.r}`}
                        d={ZIG}
                        transform={`rotate(${z.r}) translate(${z.dx} 0) scale(${z.k})`}
                        fill="none"
                        stroke={INK}
                        strokeWidth={17}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                    {RAYS.map((z) => (
                      <path
                        key={`c${z.r}`}
                        d={ZIG}
                        transform={`rotate(${z.r}) translate(${z.dx} 0) scale(${z.k})`}
                        fill="none"
                        stroke={color}
                        strokeWidth={8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                  </g>
                );
              })
            : null}
        </g>
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
