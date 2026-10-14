import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * O Espírito Santo "conserta" a oração: uma pessoa ora, o balão traz o pedido errado, que é riscado
 * (carimbo "NÃO É ISSO"); depois uma pomba chega voando, o texto errado some e o pedido certo
 * aparece em destaque, com brilhos e um check.
 */

const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const INK = '#111';

// Balão (caixa 940×760): retângulo arredondado com rabicho apontando para a cabeça da pessoa.
const BALLOON_PATH =
  'M 360 170 H 840 Q 900 170 900 230 V 420 Q 900 480 840 480 H 450 L 240 525 L 375 480 H 360 Q 300 480 300 420 V 230 Q 300 170 360 170 Z';
const TAIL_TIP = {x: 240, y: 525};
const CENTER = {x: 600, y: 325};

const sizeFor = (s: string) => (s.length <= 14 ? 64 : s.length <= 26 ? 56 : 46);

const SPARKLE = 'M 0 -22 Q 4 -4 22 0 Q 4 4 0 22 Q -4 4 -22 0 Q -4 -4 0 -22 Z';

const Pomba: React.FC<{frame: number; highlight: string}> = ({frame, highlight}) => {
  const near = Math.sin(frame * 0.85);
  const far = Math.sin(frame * 0.85 + 0.6);
  const wing = 'M -6 0 C -8 -50 30 -92 82 -100 C 72 -60 52 -22 34 6 Z';
  return (
    <g>
      <circle cx={0} cy={0} r={110} fill="url(#oc-dove-glow)" />
      {/* asa de trás */}
      <g transform={`translate(4 -4) scale(1 ${0.15 + 0.85 * far})`}>
        <path d={wing} fill="#dfe3ea" stroke={INK} strokeWidth={6} strokeLinejoin="round" />
      </g>
      {/* cauda */}
      <path d="M 38 4 L 98 -14 L 104 22 L 44 26 Z" fill="#fff" stroke={INK} strokeWidth={6} strokeLinejoin="round" />
      {/* corpo */}
      <ellipse cx={0} cy={10} rx={58} ry={30} fill="#fff" stroke={INK} strokeWidth={6} />
      {/* cabeça */}
      <circle cx={-52} cy={-12} r={22} fill="#fff" stroke={INK} strokeWidth={6} />
      <path d="M -72 -16 L -94 -7 L -72 0 Z" fill={highlight} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
      <circle cx={-57} cy={-16} r={4} fill={INK} />
      {/* asa da frente */}
      <g transform={`translate(10 2) scale(1 ${0.15 + 0.85 * near})`}>
        <path d={wing} fill="#fff" stroke={INK} strokeWidth={6} strokeLinejoin="round" />
        <path d="M 20 -30 C 34 -55 52 -72 70 -82" fill="none" stroke="#c9ced8" strokeWidth={4} strokeLinecap="round" />
      </g>
    </g>
  );
};

const Pessoa: React.FC<{bob: number}> = ({bob}) => {
  const clothes = '#4C6EF5';
  const skin = '#F2C9A0';
  const limb = (x1: number, y1: number, x2: number, y2: number, w: number, color: string) => (
    <>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={INK} strokeWidth={w + 12} strokeLinecap="round" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={w} strokeLinecap="round" />
    </>
  );
  return (
    <g>
      {/* canela no chão (de joelhos, virada para a direita) */}
      <rect x={78} y={680} width={130} height={36} rx={18} fill={clothes} stroke={INK} strokeWidth={6} />
      <g transform={`translate(0 ${bob})`}>
        {/* coxa */}
        {limb(188, 694, 150, 625, 46, clothes)}
        {/* tronco */}
        <ellipse cx={158} cy={585} rx={50} ry={64} fill={clothes} stroke={INK} strokeWidth={6} />
        {/* braço: ombro → cotovelo → mãos unidas */}
        {limb(170, 556, 206, 590, 24, clothes)}
        {limb(206, 590, 236, 540, 22, clothes)}
        <ellipse cx={240} cy={528} rx={13} ry={26} transform="rotate(18 240 528)" fill={skin} stroke={INK} strokeWidth={6} />
        {/* cabeça levemente erguida */}
        <circle cx={176} cy={500} r={36} fill={skin} stroke={INK} strokeWidth={6} />
        <path d="M 142 494 Q 146 460 182 462 Q 206 466 210 486 Q 186 476 160 488 Z" fill="#3a2a20" stroke={INK} strokeWidth={5} strokeLinejoin="round" />
        <path d="M 192 506 Q 198 510 204 506" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />
      </g>
    </g>
  );
};

export const OracaoCorrigida: React.FC<
  SceneProps & {titulo?: string; errado?: string; certo?: string; riscarAt?: number; corrigirAt?: number}
> = ({titulo = '', errado = 'O que eu pedi', certo = 'O que eu precisava', riscarAt = 0.5, corrigirAt = 3, accent, highlight}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const r = Math.round(riscarAt * fps);
  const c = Math.round(corrigirAt * fps);

  // Entrada escalonada
  const titleIn = spring({frame, fps, config: {damping: 12, stiffness: 160}});
  const personIn = spring({frame: frame - 3, fps, config: {damping: 14}});
  const balloonIn = spring({frame: frame - 7, fps, config: {damping: 11, stiffness: 150}});
  const textIn = spring({frame: frame - 12, fps, config: {damping: 13, stiffness: 140}});

  // Risco
  const strike = interpolate(frame, [r, r + 12], [0, 1], {...CLAMP, easing: Easing.inOut(Easing.cubic)});
  const shakeEnv = interpolate(frame, [r + 4, r + 12, r + 22], [0, 1, 0], CLAMP);
  const shakeX = Math.sin(frame * 1.9) * 6 * shakeEnv;
  const stamp = spring({frame: frame - r - 10, fps, config: {damping: 13, stiffness: 260}});

  // Correção: pomba entra, passa pelo balão e pousa no canto superior esquerdo
  const f1 = interpolate(frame, [c, c + 16], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
  const f2 = interpolate(frame, [c + 20, c + 38], [0, 1], {...CLAMP, easing: Easing.inOut(Easing.cubic)});
  const start = {x: 1070, y: -90};
  const perch = {x: 390, y: 190};
  const doveX = interpolate(f1, [0, 1], [start.x, CENTER.x]) + (perch.x - CENTER.x) * f2;
  const doveY =
    interpolate(f1, [0, 1], [start.y, CENTER.y]) -
    Math.sin(f1 * Math.PI) * 50 +
    (perch.y - CENTER.y) * f2 -
    Math.sin(f2 * Math.PI) * 60 +
    Math.sin(frame / 6) * 6 * f2;
  const doveRot = interpolate(f1, [0, 1], [-22, 0]) + Math.sin(f2 * Math.PI) * 12;
  const doveScale = interpolate(f1, [0, 1], [0.6, 1.1]) - 0.3 * f2;
  const doveOpacity = interpolate(frame, [c, c + 4], [0, 1], CLAMP);

  const swap = spring({frame: frame - c - 12, fps, config: {damping: 200}});
  const certoIn = spring({frame: frame - c - 12, fps, config: {damping: 10, stiffness: 140}});
  const checkIn = spring({frame: frame - c - 22, fps, config: {damping: 9, stiffness: 200}});
  const burstT = frame - c - 12;
  const burstOpacity = interpolate(burstT, [0, 6, 30], [0, 1, 0], CLAMP);

  const textBox: React.CSSProperties = {
    position: 'absolute',
    left: 330,
    top: 185,
    width: 540,
    height: 280,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    fontWeight: 900,
    textTransform: 'uppercase',
    lineHeight: 1.05,
  };
  const clamp2: React.CSSProperties = {
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    padding: '8px 10px',
  };

  return (
    <AbsoluteFill style={{fontFamily: FONT}}>
      {/* chão + pessoa */}
      <svg style={{position: 'absolute', inset: 0}} width="100%" height="100%" viewBox="0 0 940 760">
        <ellipse cx={420} cy={718} rx={360} ry={26} fill="#000" opacity={0.3} />
        <g
          opacity={personIn}
          transform={`translate(${interpolate(personIn, [0, 1], [-120, 0])} ${interpolate(personIn, [0, 1], [40, 0])})`}
        >
          <ellipse cx={160} cy={716} rx={115} ry={14} fill="#000" opacity={0.35} />
          <Pessoa bob={Math.sin(frame / 12) * 2} />
        </g>
      </svg>

      {/* balão + textos */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `scale(${balloonIn})`,
          transformOrigin: `${TAIL_TIP.x}px ${TAIL_TIP.y}px`,
        }}
      >
        <svg style={{position: 'absolute', inset: 0}} width="100%" height="100%" viewBox="0 0 940 760">
          <path d={BALLOON_PATH} fill="none" stroke={highlight} strokeWidth={34} strokeLinejoin="round" opacity={0.35 * swap} />
          <path d={BALLOON_PATH} fill="#fff" stroke={INK} strokeWidth={12} strokeLinejoin="round" />
          <path d={BALLOON_PATH} fill="none" stroke={highlight} strokeWidth={5} strokeLinejoin="round" opacity={swap} />
        </svg>

        {/* pedido errado */}
        <div
          style={{
            ...textBox,
            fontSize: sizeFor(errado),
            color: INK,
            opacity: textIn * (1 - swap),
            transform: `translateX(${shakeX}px) scale(${interpolate(textIn, [0, 1], [0.6, 1]) * (1 - 0.3 * swap)})`,
          }}
        >
          <span style={clamp2}>{errado}</span>
        </div>

        {/* pedido certo */}
        <div
          style={{
            ...textBox,
            fontSize: sizeFor(certo),
            color: highlight,
            opacity: interpolate(certoIn, [0, 0.3], [0, 1], CLAMP),
            transform: `scale(${interpolate(certoIn, [0, 1], [0.3, 1])}) rotate(${interpolate(certoIn, [0, 1], [-6, 0])}deg)`,
          }}
        >
          <span style={{...clamp2, ...outline(8)}}>{certo}</span>
        </div>

        {/* risco vermelho */}
        <svg style={{position: 'absolute', inset: 0}} width="100%" height="100%" viewBox="0 0 940 760">
          <g opacity={1 - swap} transform={`translate(${shakeX} 0)`}>
            <path
              d="M 345 352 Q 470 300 600 320 T 858 288"
              pathLength={1}
              strokeDasharray="1 1"
              strokeDashoffset={1 - strike}
              fill="none"
              stroke={INK}
              strokeWidth={26}
              strokeLinecap="round"
              opacity={strike > 0 ? 0.9 : 0}
            />
            <path
              d="M 345 352 Q 470 300 600 320 T 858 288"
              pathLength={1}
              strokeDasharray="1 1"
              strokeDashoffset={1 - strike}
              fill="none"
              stroke={accent}
              strokeWidth={16}
              strokeLinecap="round"
              opacity={strike > 0 ? 1 : 0}
            />
          </g>
        </svg>

        {/* carimbo */}
        <div
          style={{
            position: 'absolute',
            left: 640,
            top: 140,
            fontWeight: 900,
            fontSize: 34,
            color: accent,
            background: '#fff',
            border: `6px solid ${accent}`,
            borderRadius: 12,
            padding: '4px 16px',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            boxShadow: '0 6px 0 rgba(0,0,0,0.35)',
            opacity: interpolate(stamp, [0, 0.3], [0, 1], CLAMP) * (1 - swap),
            transform: `rotate(-10deg) scale(${interpolate(stamp, [0, 1], [2.4, 1])})`,
          }}
        >
          Não é isso
        </div>
      </div>

      {/* brilhos, check e pomba */}
      <svg style={{position: 'absolute', inset: 0}} width="100%" height="100%" viewBox="0 0 940 760">
        <defs>
          <radialGradient id="oc-dove-glow">
            <stop offset="0%" stopColor={highlight} stopOpacity={0.55} />
            <stop offset="60%" stopColor={highlight} stopOpacity={0.18} />
            <stop offset="100%" stopColor={highlight} stopOpacity={0} />
          </radialGradient>
        </defs>

        {burstT > 0
          ? Array.from({length: 9}).map((_, i) => {
              const p = spring({frame: burstT - (i % 3), fps, config: {damping: 20, stiffness: 90}});
              const ang = ((i * 40 + 15) * Math.PI) / 180;
              const dist = interpolate(p, [0, 1], [40, 250 + (i % 3) * 40]);
              const x = CENTER.x + Math.cos(ang) * dist * 1.25;
              const y = CENTER.y + Math.sin(ang) * dist * 0.8;
              const s = interpolate(p, [0, 0.5, 1], [0.3, 1.3, 0.8]);
              return (
                <path
                  key={i}
                  d={SPARKLE}
                  transform={`translate(${x} ${y}) rotate(${frame * 4 + i * 20}) scale(${s})`}
                  fill={highlight}
                  stroke={INK}
                  strokeWidth={3}
                  opacity={burstOpacity}
                />
              );
            })
          : null}

        {/* check */}
        <g transform={`translate(868 462) scale(${checkIn}) rotate(${interpolate(checkIn, [0, 1], [-40, 0])})`}>
          <rect x={-46} y={-46} width={92} height={92} rx={22} fill="#22c55e" stroke={INK} strokeWidth={7} />
          <path d="M -24 2 L -6 20 L 26 -18" fill="none" stroke="#fff" strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {/* pomba */}
        <g opacity={doveOpacity} transform={`translate(${doveX} ${doveY}) rotate(${doveRot}) scale(${doveScale})`}>
          <Pomba frame={frame} highlight={highlight} />
        </g>
      </svg>

      {titulo ? (
        <div
          style={{
            position: 'absolute',
            top: 20,
            left: 0,
            right: 0,
            fontWeight: 900,
            fontSize: 60,
            color: '#fff',
            textTransform: 'uppercase',
            textAlign: 'center',
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
