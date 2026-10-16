import React, {useId} from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * "Blindado contra a concorrência": escudo grande com cadeado no centro; espiões vêm de fora,
 * batem na borda (faísca + tranco no escudo) e ricocheteiam girando. Os ataques se repetem em
 * ondas espelhadas enquanto a cena durar.
 */

type Pt = readonly [number, number];
/** Trajetória de um atacante: ponto de contato na borda do escudo, normal para fora, origem e destino do ricochete. */
type Rota = {contato: Pt; normal: Pt; de: Pt; para: Pt; giro: number};
type Ataque = {emoji: string; rota: Rota; inicio: number; chegada: number};

const CX = 470;
const CY = 430;
const EMOJI = 90;
const AFASTAMENTO = 52; // centro do emoji → borda do escudo no impacto
const INICIO = 18;
const ESCALONA = 7;
const IDA = 12;
const VOLTA = 20;
const ONDA = 42;
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// Ordem: esquerda, direita, baixo-esquerda, baixo-direita, cima-esquerda, cima-direita.
const ROTAS: readonly Rota[] = [
  {contato: [290, 390], normal: [-1, 0], de: [-90, 520], para: [-130, 190], giro: -540},
  {contato: [650, 360], normal: [1, 0], de: [1030, 500], para: [1070, 160], giro: 540},
  {contato: [343, 565], normal: [-0.76, 0.65], de: [-80, 830], para: [40, 990], giro: -720},
  {contato: [597, 565], normal: [0.76, 0.65], de: [1020, 830], para: [900, 990], giro: 720},
  {contato: [300, 285], normal: [-0.6, -0.8], de: [-90, 300], para: [-60, -130], giro: -540},
  {contato: [640, 285], normal: [0.6, -0.8], de: [1030, 300], para: [1000, -130], giro: 540},
];

const espelhar = (r: Rota): Rota => ({
  contato: [940 - r.contato[0], r.contato[1]],
  normal: [-r.normal[0], r.normal[1]],
  de: [940 - r.de[0], r.de[1]],
  para: [940 - r.para[0], r.para[1]],
  giro: -r.giro,
});

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Contorno do escudo centrado em (0,0), 360 de largura × 420 de altura, escalado por s. */
const escudoPath = (s: number) => {
  const p = (x: number, y: number) => `${x * s} ${y * s}`;
  return (
    `M ${p(0, -200)} C ${p(70, -160)} ${p(130, -150)} ${p(180, -150)} L ${p(180, -10)} ` +
    `C ${p(180, 110)} ${p(100, 180)} ${p(0, 220)} C ${p(-100, 180)} ${p(-180, 110)} ${p(-180, -10)} ` +
    `L ${p(-180, -150)} C ${p(-130, -150)} ${p(-70, -160)} ${p(0, -200)} Z`
  );
};

const ALCA = 'M -52 -20 L -52 -68 A 52 52 0 0 1 52 -68 L 52 -20';

const Cadeado: React.FC<{cor: string}> = ({cor}) => (
  <g>
    <path d={ALCA} fill="none" stroke="#000" strokeWidth={34} />
    <path d={ALCA} fill="none" stroke="#dbe3ee" strokeWidth={18} />
    <rect x={-86} y={-28} width={172} height={138} rx={24} fill={cor} stroke="#000" strokeWidth={8} />
    <rect x={-70} y={-14} width={18} height={108} rx={9} fill="#fff" opacity={0.4} />
    <circle cx={0} cy={28} r={19} fill="#111" />
    <path d="M -9 36 L 9 36 L 14 78 L -14 78 Z" fill="#111" />
  </g>
);

export const Escudo: React.FC<SceneProps & {label?: string; icone?: string; atacantes?: string[]}> = ({
  label = '',
  icone = '🔒',
  atacantes = ['🕵️', '🕵️', '🕵️'],
  accent,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const uid = `escudo-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  // Ondas de ataque (a 2ª é espelhada) enquanto couber um impacto inteiro antes do fim.
  const ataques: Ataque[] = [];
  for (let onda = 0; onda < 20; onda++) {
    const base = INICIO + onda * ONDA;
    const ultimaChegada = base + (atacantes.length - 1) * ESCALONA + IDA;
    if (onda > 0 && ultimaChegada > durationInFrames - 8) break;
    for (let i = 0; i < atacantes.length; i++) {
      const r = ROTAS[i % ROTAS.length];
      const inicio = base + i * ESCALONA;
      ataques.push({emoji: atacantes[i], rota: onda % 2 ? espelhar(r) : r, inicio, chegada: inicio + IDA});
    }
  }

  // Tranco do escudo a cada impacto: escala 1 → 1,04 → 1 e um empurrão para dentro.
  const trancos = ataques.map((a) =>
    interpolate(frame, [a.chegada, a.chegada + 3, a.chegada + 12], [0, 1, 0], {...CLAMP, easing: Easing.out(Easing.quad)}),
  );
  const tranco = Math.min(1, trancos.reduce((s, v) => s + v, 0));
  const empurraX = ataques.reduce((s, a, k) => s - a.rota.normal[0] * trancos[k] * 10, 0);
  const empurraY = ataques.reduce((s, a, k) => s - a.rota.normal[1] * trancos[k] * 10, 0);
  const balancoCadeado = ataques.reduce((s, a, k) => s + (a.rota.normal[0] > 0 ? -1 : 1) * trancos[k] * 7, 0);

  const entra = spring({frame, fps, config: {damping: 12, stiffness: 150}});
  const opEscudo = interpolate(frame, [0, 6], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});
  const flutua = Math.sin(frame / 14) * 5;
  const escala = interpolate(entra, [0, 1], [0.6, 1]) * (1 + 0.04 * tranco);
  const sombra = interpolate(frame, [0, 12], [0, 0.4], {...CLAMP, easing: Easing.out(Easing.quad)});
  const pulso = interpolate(Math.sin(frame / 6), [-1, 1], [0.35, 0.6]);
  const brilho = (pulso + 0.35 * tranco) * opEscudo;
  const varre = interpolate(frame, [48, 68], [-330, 330], {...CLAMP, easing: Easing.inOut(Easing.cubic)});

  const cadeadoIn = spring({frame: frame - 8, fps, config: {damping: 6, stiffness: 180}});
  const cadeadoRot = interpolate(cadeadoIn, [0, 1], [-30, 0]) + balancoCadeado;
  const labelIn = spring({frame: frame - 6, fps, config: {damping: 10}});

  return (
    <AbsoluteFill style={{fontFamily: FONT, alignItems: 'center'}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        <defs>
          <linearGradient id={`${uid}-aco`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a9bfd9" />
            <stop offset="50%" stopColor="#5f7a9e" />
            <stop offset="100%" stopColor="#2e3f58" />
          </linearGradient>
          <radialGradient id={`${uid}-brilho`}>
            <stop offset="0%" stopColor={highlight} stopOpacity={0.6} />
            <stop offset="55%" stopColor={highlight} stopOpacity={0.18} />
            <stop offset="100%" stopColor={highlight} stopOpacity={0} />
          </radialGradient>
          <clipPath id={`${uid}-corte`}>
            <path d={escudoPath(1)} />
          </clipPath>
        </defs>

        <ellipse cx={CX} cy={692} rx={210 * escala - flutua} ry={26 * escala} fill="#000" opacity={sombra} />

        <g transform={`translate(${CX + empurraX} ${CY + empurraY + flutua}) scale(${escala})`} opacity={opEscudo}>
          <ellipse cx={0} cy={10} rx={300} ry={320} fill={`url(#${uid}-brilho)`} opacity={brilho} />
          <path d={escudoPath(1)} fill={`url(#${uid}-aco)`} />
          <g clipPath={`url(#${uid}-corte)`}>
            <rect x={-200} y={-220} width={200} height={460} fill="#fff" opacity={0.1} />
            {frame >= 48 && frame <= 68 ? (
              <rect x={varre - 35} y={-260} width={70} height={520} fill="#fff" opacity={0.3} transform="skewX(-20)" />
            ) : null}
          </g>
          <path d={escudoPath(0.86)} fill="none" stroke={highlight} strokeWidth={7} strokeLinejoin="round" />
          <path d={escudoPath(1)} fill="none" stroke="#000" strokeWidth={8} strokeLinejoin="round" />
          {[
            [-128, -112],
            [128, -112],
            [-120, 50],
            [120, 50],
          ].map(([x, y]) => (
            <circle key={`${x}${y}`} cx={x} cy={y} r={10} fill="#dbe3ee" stroke="#000" strokeWidth={4} />
          ))}
          <g transform={`translate(0 -4) rotate(${cadeadoRot}) scale(${cadeadoIn})`}>
            {icone === '🔒' ? (
              <Cadeado cor={highlight} />
            ) : (
              <>
                <circle r={112} fill="#000" opacity={0.25} />
                <text x={0} y={6} fontSize={170} textAnchor="middle" dominantBaseline="central">
                  {icone}
                </text>
              </>
            )}
          </g>
        </g>

        {ataques.map((a, k) => {
          if (frame < a.inicio || frame > a.chegada + VOLTA) return null;
          const {contato, normal, de, para, giro} = a.rota;
          const alvoX = contato[0] + normal[0] * AFASTAMENTO;
          const alvoY = contato[1] + normal[1] * AFASTAMENTO;
          const voltando = frame >= a.chegada;
          const ida = interpolate(frame, [a.inicio, a.chegada], [0, 1], {...CLAMP, easing: Easing.in(Easing.quad)});
          const volta = interpolate(frame, [a.chegada, a.chegada + VOLTA], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
          const x = voltando ? mix(alvoX, para[0], volta) : mix(de[0], alvoX, ida);
          const y = voltando ? mix(alvoY, para[1], volta) : mix(de[1], alvoY, ida) - Math.sin(ida * Math.PI) * 40;
          const rot = voltando ? giro * volta : -normal[0] * 12 + Math.sin((frame - a.inicio) * 0.9) * 6;
          const esc = interpolate(frame, [a.chegada - 2, a.chegada, a.chegada + 3, a.chegada + VOLTA], [1, 0.82, 1.08, 0.7], {
            ...CLAMP,
            easing: Easing.inOut(Easing.quad),
          });
          const op = interpolate(frame, [a.chegada + 4, a.chegada + VOLTA], [1, 0], {...CLAMP, easing: Easing.in(Easing.quad)});
          // Linhas de velocidade atrás do atacante enquanto ele avança.
          const dx = alvoX - de[0];
          const dy = alvoY - de[1];
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          return (
            <g key={k}>
              {!voltando
                ? [-20, 20].map((o) => (
                    <line
                      key={o}
                      x1={x - ux * 60 - uy * o}
                      y1={y - uy * 60 + ux * o}
                      x2={x - ux * 130 - uy * o}
                      y2={y - uy * 130 + ux * o}
                      stroke="#fff"
                      strokeWidth={6}
                      strokeLinecap="round"
                      opacity={0.45}
                    />
                  ))
                : null}
              <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${esc})`} opacity={op}>
                <text x={0} y={0} fontSize={EMOJI} textAnchor="middle" dominantBaseline="central">
                  {a.emoji}
                </text>
              </g>
            </g>
          );
        })}

        {ataques.map((a, k) => {
          if (frame < a.chegada || frame > a.chegada + 12) return null;
          const s = interpolate(frame, [a.chegada, a.chegada + 12], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
          const giroRaios = (k % 2) * (Math.PI / 8);
          return (
            <g key={k} transform={`translate(${a.rota.contato[0]} ${a.rota.contato[1]})`} opacity={1 - s}>
              <circle r={16 + 74 * s} fill="none" stroke={highlight} strokeWidth={12 - 8 * s} />
              {Array.from({length: 8}).map((_, j) => {
                const ang = (j / 8) * Math.PI * 2 + giroRaios;
                const r1 = 22 + 46 * s;
                const r2 = 46 + 84 * s;
                return (
                  <line
                    key={j}
                    x1={Math.cos(ang) * r1}
                    y1={Math.sin(ang) * r1}
                    x2={Math.cos(ang) * r2}
                    y2={Math.sin(ang) * r2}
                    stroke={highlight}
                    strokeWidth={8}
                    strokeLinecap="round"
                  />
                );
              })}
              <circle r={30 * (1 - s)} fill="#fff" />
            </g>
          );
        })}
      </svg>
      {label ? (
        <div
          style={{
            position: 'absolute',
            top: 40,
            fontWeight: 900,
            fontSize: 80,
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
