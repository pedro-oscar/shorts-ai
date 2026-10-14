import React from 'react';
import {AbsoluteFill, Easing, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * Raciocínio blindado: um cérebro brilhante num pedestal, protegido por uma redoma de vidro com cadeado.
 * Uma lupa gigante (o concorrente, com um olho espiando) entra pela esquerda, avança, bate no campo de
 * força e é repelida tremendo; a redoma pisca, solta ondas e um carimbo "ACESSO NEGADO" bate por cima.
 */
const INK = '#111';
const METAL = '#B9C0C8';
const METAL_DARK = '#7D8690';
const PINK = '#f9a8d4';
const PINK_DARK = '#ec4899';
const GLASS = '#38bdf8';
const WOOD = '#6b3f1c';
const WOOD_DARK = '#4a2a12';
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

// redoma: paredes retas + meia-lua, apoiada no aro do pedestal
const DOME = {cx: 590, base: 585, r: 175, wallTop: 400};
const DOME_D =
  `M ${DOME.cx - DOME.r} ${DOME.base} L ${DOME.cx - DOME.r} ${DOME.wallTop} ` +
  `A ${DOME.r} ${DOME.r} 0 0 1 ${DOME.cx + DOME.r} ${DOME.wallTop} L ${DOME.cx + DOME.r} ${DOME.base} Z`;
const BRAIN = {x: 590, y: 440};
const LOCK = {x: 590, y: 614};
/** Ponto da redoma onde a lente encosta. */
const CONTACT = {x: 416, y: 380};
const LENS_R = 92;
/** Centro da lente no instante do choque (borda do aro tocando o contorno da redoma). */
const LENS_HIT = {x: CONTACT.x - LENS_R - 20, y: CONTACT.y};
const LUPA_START = {x: -270, y: 250, rot: -35};
const LUPA_HOVER = {x: 210, y: 360, rot: -10};
const KNOCK = {x: -150, y: 80, rot: -22};
const STAMP = {x: 540, y: 295};

/** Contorno do cérebro: elipse com "gomos" (Bézier quadráticas empurradas para fora). */
const BRAIN_D = (() => {
  const n = 14;
  const pt = (a: number, k: number) =>
    `${(Math.cos(a) * 112 * k).toFixed(1)} ${(Math.sin(a) * 84 * k).toFixed(1)}`;
  const segs = Array.from({length: n}).map((_, i) => {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    return `Q ${pt((a0 + a1) / 2, 1.22)} ${pt(a1, 1)}`;
  });
  return `M ${pt(0, 1)} ${segs.join(' ')} Z`;
})();
const MIDLINE = 'M 0 -86 Q -12 -62 2 -40 Q 14 -18 -2 4 Q -14 26 2 48 Q 10 62 0 82';
/** Sulcos do hemisfério esquerdo (o direito é espelhado). */
const SULCI = [
  'M -98 -18 Q -78 -40 -58 -24 Q -42 -10 -60 8',
  'M -62 -58 Q -44 -68 -34 -50',
  'M -96 34 Q -78 18 -62 34 Q -50 48 -66 56',
  'M -34 14 Q -18 24 -28 46',
];

const SPARKS: ReadonlyArray<{x: number; y: number}> = [
  {x: -150, y: -70},
  {x: 140, y: -95},
  {x: 140, y: 50},
  {x: -145, y: 55},
  {x: -62, y: -140},
  {x: 75, y: -135},
];
const STAR_D = 'M 0 -16 L 4.5 -4.5 L 16 0 L 4.5 4.5 L 0 16 L -4.5 4.5 L -16 0 L -4.5 -4.5 Z';

// grade hexagonal do campo de força
const HEX_S = 24;
const HEX_W = Math.sqrt(3) * HEX_S;
const HEX_H = 3 * HEX_S;
const HEX_D =
  `M ${(HEX_W / 2).toFixed(2)} 0 L ${HEX_W.toFixed(2)} ${HEX_S / 2} L ${HEX_W.toFixed(2)} ${HEX_S * 1.5} ` +
  `L ${(HEX_W / 2).toFixed(2)} ${HEX_S * 2} L 0 ${HEX_S * 1.5} L 0 ${HEX_S / 2} Z ` +
  `M ${(HEX_W / 2).toFixed(2)} ${HEX_S * 2} L ${(HEX_W / 2).toFixed(2)} ${HEX_H}`;

const BURST_PTS = Array.from({length: 20})
  .map((_, i) => {
    const r = i % 2 ? 28 : 62;
    const a = (i / 20) * Math.PI * 2;
    return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
  })
  .join(' ');
const RAY_ANGLES = Array.from({length: 10}).map((_, i) => ((i * 36 + 18) * Math.PI) / 180);

const Brain: React.FC = () => (
  <g>
    {/* tronco */}
    <path
      d="M -20 70 Q -20 104 -6 116 Q 8 122 16 106 Q 22 92 20 70 Z"
      fill={PINK}
      stroke={INK}
      strokeWidth={7}
      strokeLinejoin="round"
    />
    <path d={BRAIN_D} fill={PINK} stroke={INK} strokeWidth={9} strokeLinejoin="round" />
    <g fill="none" stroke={PINK_DARK} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round">
      <path d={MIDLINE} strokeWidth={7} />
      {SULCI.map((d) => (
        <path key={d} d={d} />
      ))}
      <g transform="scale(-1 1)">
        {SULCI.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </g>
    <path d="M -70 -50 Q -54 -70 -26 -72" fill="none" stroke="#fff" strokeWidth={8} strokeLinecap="round" opacity={0.6} />
  </g>
);

const Padlock: React.FC<{color: string}> = ({color}) => (
  <g>
    <path d="M -22 -18 L -22 -44 A 22 22 0 0 1 22 -44 L 22 -18" fill="none" stroke={INK} strokeWidth={20} strokeLinecap="round" />
    <path d="M -22 -18 L -22 -44 A 22 22 0 0 1 22 -44 L 22 -18" fill="none" stroke="#cfd6de" strokeWidth={9} strokeLinecap="round" />
    <rect x={-38} y={-26} width={76} height={60} rx={12} fill={color} stroke={INK} strokeWidth={7} />
    <rect x={-28} y={-17} width={10} height={36} rx={5} fill="#fff" opacity={0.45} />
    <circle cx={0} cy={0} r={8} fill={INK} />
    <path d="M -4 2 L 4 2 L 7 20 L -7 20 Z" fill={INK} />
  </g>
);

/** Lupa com origem no centro da lente; cabo para baixo-esquerda. `squint` fecha o olho (0..1). */
const Lupa: React.FC<{squint: number}> = ({squint}) => (
  <g>
    {/* cabo */}
    <g transform="rotate(45)">
      <rect x={-20} y={LENS_R + 4} width={40} height={36} rx={6} fill={METAL_DARK} stroke={INK} strokeWidth={6} />
      <rect x={-27} y={LENS_R + 36} width={54} height={156} rx={25} fill={WOOD} stroke={INK} strokeWidth={8} />
      <rect x={-15} y={LENS_R + 50} width={9} height={126} rx={4.5} fill="#fff" opacity={0.18} />
      {[70, 96, 122].map((dy) => (
        <line
          key={dy}
          x1={-19}
          x2={19}
          y1={LENS_R + 36 + dy}
          y2={LENS_R + 36 + dy}
          stroke={WOOD_DARK}
          strokeWidth={5}
          strokeLinecap="round"
        />
      ))}
    </g>
    {/* olho espiando atrás da lente */}
    <g transform={`scale(1 ${1 - 0.85 * squint})`}>
      <ellipse cx={0} cy={0} rx={54} ry={34} fill="#fff" stroke={INK} strokeWidth={6} />
      <circle cx={18} cy={0} r={20} fill="#1f2937" />
      <circle cx={18} cy={0} r={9} fill={INK} />
      <circle cx={11} cy={-7} r={5} fill="#fff" />
    </g>
    {/* lente translúcida + reflexo */}
    <circle r={LENS_R} fill="#bae6fd" fillOpacity={0.35} />
    <path d="M -60 -22 A 64 64 0 0 1 -22 -60" fill="none" stroke="#fff" strokeWidth={12} strokeLinecap="round" opacity={0.85} />
    <circle cx={-66} cy={8} r={6} fill="#fff" opacity={0.8} />
    {/* aro */}
    <circle r={LENS_R} fill="none" stroke={INK} strokeWidth={26} />
    <circle r={LENS_R} fill="none" stroke="#4b5563" strokeWidth={5} />
  </g>
);

export const Blindado: React.FC<
  SceneProps & {label?: string; carimbo?: string; lupaAt?: number; bloqueioAt?: number; labelAt?: number}
> = ({
  label = 'Blindado',
  carimbo = 'Acesso negado',
  lupaAt = 0.3,
  bloqueioAt = 1.4,
  labelAt = 2.2,
  accent,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const lF = Math.round(lupaAt * fps);
  const bF = Math.round(bloqueioAt * fps);
  const labF = Math.round(labelAt * fps);
  const sF = bF + 2;
  const tB = frame - bF;
  const hit = tB >= 0;

  // ---------- entrada escalonada: pedestal -> cérebro -> redoma -> cadeado ----------
  const pedIn = spring({frame, fps, config: {damping: 13, stiffness: 150}});
  const brainIn = spring({frame: frame - 2, fps, config: {damping: 11, stiffness: 140}});
  const domeIn = spring({frame: frame - 7, fps, config: {damping: 12, stiffness: 150}});
  const lockIn = spring({frame: frame - 13, fps, config: {damping: 10, stiffness: 200}});
  const labelIn = spring({frame: frame - labF, fps, config: {damping: 10}});

  // ---------- impacto no campo de força ----------
  const flash = interpolate(tB, [0, 1, 6, 11], [0, 1, 1, 0], {...CLAMP, easing: Easing.inOut(Easing.quad)});
  const domeStroke = interpolateColors(flash, [0, 1], [GLASS, highlight]);
  const decay = hit ? Math.exp(-tB * 0.2) : 0;
  const jolt = hit ? Math.sin(tB * 2.8) * 6 * decay : 0;
  const lockJig = hit ? Math.sin(tB * 2.5) * 10 * decay : 0;
  const burstS = spring({frame: tB, fps, config: {damping: 12, stiffness: 300}});
  const burstOp = interpolate(tB, [0, 1, 7, 13], [0, 1, 1, 0], {...CLAMP, easing: Easing.out(Easing.quad)});
  const raysP = interpolate(tB, [0, 10], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
  const raysOp = interpolate(tB, [0, 1, 9, 15], [0, 1, 1, 0], {...CLAMP, easing: Easing.out(Easing.quad)});

  // ---------- cérebro vivo ----------
  const pulse = 1 + 0.03 * Math.sin(frame * 0.25);
  const bob = Math.sin(frame * 0.12) * 5;
  const glowOp = Math.min(1, brainIn * (0.7 + 0.2 * Math.sin(frame * 0.25)) + 0.35 * flash);

  // ---------- lupa: entra, fareja, dá o bote, é repelida ----------
  const enter = spring({frame: frame - lF, fps, config: {damping: 14, stiffness: 90}});
  const preX = mix(LUPA_START.x, LUPA_HOVER.x, enter) + Math.sin(frame * 0.18) * 8 * enter;
  const preY = mix(LUPA_START.y, LUPA_HOVER.y, enter) + Math.sin(frame * 0.28) * 7 * enter;
  const preRot = mix(LUPA_START.rot, LUPA_HOVER.rot, enter) + Math.sin(frame * 0.2) * 3 * enter;
  const lungeFrom = Math.min(bF - 1, Math.max(lF, bF - 10));
  // Easing.back: recua um pouco (antecipação) e avança acelerando até encostar exatamente em bF
  const lunge = interpolate(frame, [lungeFrom, bF], [0, 1], {...CLAMP, easing: Easing.back(1.8)});
  const knock = spring({frame: tB, fps, config: {damping: 9, stiffness: 170, mass: 0.8}});
  const shake = hit ? Math.exp(-tB * 0.13) : 0;
  const lupaX = hit ? LENS_HIT.x + KNOCK.x * knock + Math.sin(tB * 3.1) * 12 * shake : mix(preX, LENS_HIT.x, lunge);
  const lupaY = hit
    ? LENS_HIT.y + KNOCK.y * knock + Math.sin(tB * 0.15) * 4 * (1 - shake)
    : mix(preY, LENS_HIT.y, lunge);
  const lupaRot = hit ? KNOCK.rot * knock + Math.sin(tB * 2.4 + 1) * 4 * shake : mix(preRot, 0, lunge);
  const squint = interpolate(tB, [0, 2, 16, 22], [0, 1, 1, 0], {...CLAMP, easing: Easing.inOut(Easing.quad)});

  // ---------- carimbo ----------
  const stampIn = spring({frame: frame - sF, fps, config: {damping: 12, stiffness: 240}});
  const stampOp = interpolate(frame - sF, [0, 3], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});

  const pedT = `translate(${DOME.cx} 686) scale(${pedIn}) translate(${-DOME.cx} -686)`;

  return (
    <AbsoluteFill style={{fontFamily: FONT, alignItems: 'center'}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        <defs>
          <radialGradient id="blindado-glow">
            <stop offset="0%" stopColor={highlight} stopOpacity={0.5} />
            <stop offset="55%" stopColor={highlight} stopOpacity={0.16} />
            <stop offset="100%" stopColor={highlight} stopOpacity={0} />
          </radialGradient>
          <clipPath id="blindado-dome">
            <path d={DOME_D} />
          </clipPath>
          <pattern id="blindado-hex" width={HEX_W} height={HEX_H} patternUnits="userSpaceOnUse">
            <path d={HEX_D} fill="none" stroke={domeStroke} strokeWidth={2.5} />
          </pattern>
        </defs>

        <ellipse cx={DOME.cx} cy={692} rx={300 * pedIn} ry={30} fill="#000" opacity={0.35} />

        <g transform={`translate(${jolt} ${(1 - pedIn) * 90})`}>
          {/* pedestal metálico */}
          <g transform={pedT}>
            <rect x={360} y={648} width={460} height={38} rx={12} fill={METAL_DARK} stroke={INK} strokeWidth={7} />
            <path d="M 420 600 L 760 600 L 788 652 L 392 652 Z" fill={METAL} stroke={INK} strokeWidth={7} strokeLinejoin="round" />
            <path d="M 432 614 L 748 614" stroke="#fff" strokeWidth={5} strokeLinecap="round" opacity={0.35} />
            <circle cx={428} cy={634} r={6} fill={METAL_DARK} stroke={INK} strokeWidth={3} />
            <circle cx={752} cy={634} r={6} fill={METAL_DARK} stroke={INK} strokeWidth={3} />
          </g>

          {/* brilho + cérebro + faíscas de pensamento */}
          <circle cx={BRAIN.x} cy={BRAIN.y + bob} r={175} fill="url(#blindado-glow)" opacity={glowOp} />
          <g transform={`translate(${BRAIN.x} ${BRAIN.y + bob}) scale(${brainIn * pulse})`}>
            <Brain />
          </g>
          {SPARKS.map((s, i) => {
            const sIn = spring({frame: frame - 6 - i * 2, fps, config: {damping: 10, stiffness: 180}});
            const tw = 0.55 + 0.45 * Math.sin(frame * 0.3 + i * 1.7);
            return (
              <path
                key={i}
                d={STAR_D}
                transform={`translate(${BRAIN.x + s.x} ${BRAIN.y + s.y + bob}) rotate(${frame * 3 + i * 30}) scale(${sIn * tw})`}
                fill={highlight}
                stroke={INK}
                strokeWidth={3}
                strokeLinejoin="round"
              />
            );
          })}

          {/* redoma / campo de força */}
          <g transform={`translate(${DOME.cx} ${DOME.base}) scale(${domeIn}) translate(${-DOME.cx} ${-DOME.base})`}>
            <path d={DOME_D} fill={GLASS} opacity={0.22 + 0.2 * flash} />
            <g clipPath="url(#blindado-dome)">
              <rect
                x={DOME.cx - DOME.r}
                y={DOME.wallTop - DOME.r}
                width={DOME.r * 2}
                height={DOME.base - DOME.wallTop + DOME.r}
                fill="url(#blindado-hex)"
                opacity={0.14 + 0.55 * flash}
              />
              {hit
                ? [0, 4, 8].map((d) => {
                    const t = tB - d;
                    const p = interpolate(t, [0, 22], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
                    const op = interpolate(t, [0, 2, 22], [0, 0.9, 0], {...CLAMP, easing: Easing.inOut(Easing.quad)});
                    return (
                      <circle
                        key={d}
                        cx={CONTACT.x}
                        cy={CONTACT.y}
                        r={20 + p * 360}
                        fill="none"
                        stroke={interpolateColors(p, [0, 1], [highlight, GLASS])}
                        strokeWidth={12 - 8 * p}
                        opacity={op}
                      />
                    );
                  })
                : null}
            </g>
            <path d="M 448 540 L 448 405 Q 452 320 510 278" fill="none" stroke="#fff" strokeWidth={10} strokeLinecap="round" opacity={0.45} />
            <path d="M 474 540 L 474 500" fill="none" stroke="#fff" strokeWidth={8} strokeLinecap="round" opacity={0.3} />
            <path d="M 724 300 Q 744 330 748 372" fill="none" stroke="#fff" strokeWidth={8} strokeLinecap="round" opacity={0.3} />
            <path d={DOME_D} fill="none" stroke={highlight} strokeWidth={30} strokeLinejoin="round" opacity={0.35 * flash} />
            <path d={DOME_D} fill="none" stroke={INK} strokeWidth={15} strokeLinejoin="round" />
            <path d={DOME_D} fill="none" stroke={domeStroke} strokeWidth={7} strokeLinejoin="round" />
          </g>

          {/* aro do pedestal (cobre a base da redoma) */}
          <g transform={pedT}>
            <rect x={392} y={574} width={396} height={28} rx={14} fill={METAL} stroke={INK} strokeWidth={7} />
            <path d="M 412 583 L 768 583" stroke="#fff" strokeWidth={4} strokeLinecap="round" opacity={0.45} />
          </g>

          {/* cadeado na base */}
          <g transform={`translate(${LOCK.x} ${LOCK.y - (1 - lockIn) * 40}) rotate(${lockJig}) scale(${lockIn})`}>
            <Padlock color={highlight} />
          </g>
        </g>

        {/* lupa (o concorrente) */}
        {frame >= lF ? (
          <g transform={`translate(${lupaX} ${lupaY}) rotate(${lupaRot})`}>
            <Lupa squint={squint} />
          </g>
        ) : null}

        {/* estouro + raios no ponto de contato */}
        {hit ? (
          <g transform={`translate(${CONTACT.x} ${CONTACT.y})`}>
            <polygon
              points={BURST_PTS}
              transform={`rotate(${tB * 4}) scale(${burstS})`}
              fill={highlight}
              stroke={INK}
              strokeWidth={5}
              strokeLinejoin="round"
              opacity={burstOp}
            />
            <g opacity={raysOp} strokeLinecap="round">
              {RAY_ANGLES.map((a) => {
                const r1 = 72 + raysP * 40;
                const r2 = 92 + raysP * 100;
                const x1 = Math.cos(a) * r1;
                const y1 = Math.sin(a) * r1;
                const x2 = Math.cos(a) * r2;
                const y2 = Math.sin(a) * r2;
                return (
                  <g key={a}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={INK} strokeWidth={14} />
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={highlight} strokeWidth={7} />
                  </g>
                );
              })}
            </g>
          </g>
        ) : null}
      </svg>

      {frame >= sF && carimbo ? (
        <div
          style={{
            position: 'absolute',
            left: STAMP.x,
            top: STAMP.y,
            fontWeight: 900,
            fontSize: 68,
            lineHeight: 1,
            color: accent,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            border: `9px solid ${accent}`,
            borderRadius: 16,
            padding: '12px 28px',
            background: 'rgba(11,13,18,0.55)',
            boxShadow: '0 0 0 5px #000, inset 0 0 0 5px #000, 0 10px 0 rgba(0,0,0,0.35)',
            opacity: stampOp,
            transform: `translate(-50%, -50%) rotate(-8deg) scale(${interpolate(stampIn, [0, 1], [1.6, 1])})`,
            ...outline(8),
          }}
        >
          {carimbo}
        </div>
      ) : null}

      {label ? (
        <div
          style={{
            position: 'absolute',
            top: 30,
            fontWeight: 900,
            fontSize: 96,
            lineHeight: 1,
            color: highlight,
            textTransform: 'uppercase',
            textAlign: 'center',
            whiteSpace: 'nowrap',
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
