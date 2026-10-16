import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * Bateria grande esvaziando enquanto um personagem trabalha ao lado; fichas de token saem da bateria
 * para ele. Ex.: "a IA trabalha sozinha até zerar os seus tokens". Se terminar abaixo de 10%, a bateria
 * pisca em vermelho, o personagem para e treme e aparece "ZERADO". Se `ate > de`, a bateria enche (verde).
 */

const VERDE = '#22c55e';
const CORPO = '#1e2433';
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// Geometria na caixa 940×760
const BW = 560; // corpo da bateria
const BH = 260;
const TW = 34; // polo positivo (à direita)
const TH = 112;
const BY = 250;
const PAD = 18;
const BASE = BY + BH; // "chão"
const BONECO_X = 150;
const N_FICHAS = 10;

const lim = (n: number) => Math.max(0, Math.min(100, n));

export const Bateria: React.FC<SceneProps & {label?: string; de?: number; ate?: number; emoji?: string}> = ({
  label = 'Tokens',
  de = 100,
  ate = 0,
  emoji = '🤖',
  accent,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const ini = lim(de);
  const fim = lim(ate);
  const enchendo = fim > ini;
  const zerou = !enchendo && fim < 10;
  const temBoneco = emoji !== '';

  const bx = temBoneco ? 316 : (940 - BW - TW) / 2;
  const cx = bx + BW / 2;
  const cy = BY + BH / 2;
  const innerW = BW - PAD * 2;
  const innerH = BH - PAD * 2;

  // Entradas escalonadas
  const entra = spring({frame, fps, config: {damping: 11, stiffness: 140}});
  const labelIn = spring({frame: frame - 3, fps, config: {damping: 10}});
  const bonecoIn = spring({frame: frame - 6, fps, config: {damping: 12, stiffness: 130}});

  // Carga: f12–70
  const nivel = interpolate(frame, [12, 70], [ini, fim], {...CLAMP, easing: Easing.inOut(Easing.cubic)});
  const cor = enchendo || nivel > 50 ? VERDE : nivel >= 20 ? highlight : accent;
  const fillW = Math.max(0, (innerW * nivel) / 100);

  // Final (f70+): pisca em vermelho e "ZERADO"
  const alerta = zerou ? interpolate(frame, [70, 76], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)}) : 0;
  const pisca = alerta * (0.55 + 0.45 * Math.sin((frame - 70) * 0.5));
  const popIn = zerou ? spring({frame: frame - 72, fps, config: {damping: 8, stiffness: 160}}) : 0;

  // Personagem: trabalha (pula/balança) e, se zerou, para e treme
  const trabalho = zerou ? interpolate(frame, [64, 72], [1, 0], {...CLAMP, easing: Easing.inOut(Easing.cubic)}) : 1;
  const pulo = Math.abs(Math.sin(frame / 4)) * 22 * trabalho;
  const ginga = Math.sin(frame / 5) * 9 * trabalho;
  const tremX = alerta * Math.sin(frame * 2.1) * 5;
  const tremR = alerta * Math.sin(frame * 1.7) * 3;
  const bonecoX = interpolate(bonecoIn, [0, 1], [-260, 0]) + tremX;
  const bonecoY = interpolate(bonecoIn, [0, 1], [180, 0]) - pulo + alerta * 6;

  // Fichas de token voando da bateria para o personagem (ao contrário se estiver enchendo)
  const fichas =
    ini !== fim
      ? Array.from({length: N_FICHAS}).map((_, i) => {
          const s = 12 + i * 5;
          const t = interpolate(frame, [s, s + 16], [0, 1], {...CLAMP, easing: Easing.inOut(Easing.quad)});
          if (t <= 0 || t >= 1) return null;
          const off = ((i * 37) % 90) - 45;
          const a = temBoneco ? {x: bx + 30, y: cy + off} : {x: bx + 90 + ((i * 131) % 380), y: BY + 60};
          const b = temBoneco ? {x: BONECO_X + 20, y: BASE - 90} : {x: a.x + (i % 2 ? 60 : -60), y: BY - 90};
          const [p0, p1] = enchendo ? [b, a] : [a, b];
          const arco = temBoneco ? 110 + (i % 3) * 35 : 40;
          const x = interpolate(t, [0, 1], [p0.x, p1.x]);
          const y = interpolate(t, [0, 1], [p0.y, p1.y]) - Math.sin(Math.PI * t) * arco;
          const sc = interpolate(t, [0, 0.2, 0.8, 1], [0.2, 1, 1, 0.4]);
          const op = interpolate(t, [0, 0.1, 0.85, 1], [0, 1, 1, 0]);
          return (
            <g key={i} transform={`translate(${x} ${y}) scale(${sc})`} opacity={op}>
              <circle r={24} fill={highlight} stroke="#000" strokeWidth={6} />
              <circle r={11} fill="none" stroke="#000" strokeWidth={4} opacity={0.35} />
            </g>
          );
        })
      : null;

  return (
    <AbsoluteFill style={{fontFamily: FONT}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        {/* sombras */}
        <ellipse cx={bx + (BW + TW) / 2} cy={BASE + 24} rx={Math.max(0, 320 * entra)} ry={28} fill="#000" opacity={0.35} />
        {temBoneco ? (
          <ellipse
            cx={BONECO_X + bonecoX}
            cy={BASE + 24}
            rx={Math.max(0, 72 * (1 - pulo / 60) * Math.min(1, bonecoIn))}
            ry={14}
            fill="#000"
            opacity={0.35}
          />
        ) : null}

        {/* bateria */}
        <g transform={`translate(${cx} ${cy}) scale(${entra}) translate(${-cx} ${-cy})`}>
          {alerta > 0 ? (
            <rect
              x={bx - 16}
              y={BY - 16}
              width={BW + 32}
              height={BH + 32}
              rx={58}
              fill="none"
              stroke={accent}
              strokeWidth={22}
              opacity={pisca * 0.6}
            />
          ) : null}
          <rect x={bx + BW - 10} y={cy - TH / 2} width={TW + 10} height={TH} rx={14} fill={CORPO} stroke="#000" strokeWidth={10} />
          <rect x={bx} y={BY} width={BW} height={BH} rx={44} fill={CORPO} stroke="#000" strokeWidth={10} />
          <rect x={bx + PAD} y={BY + PAD} width={fillW} height={innerH} rx={24} fill={cor} />
          <rect x={bx + PAD + 12} y={BY + PAD + 14} width={Math.max(0, fillW - 24)} height={26} rx={13} fill="#fff" opacity={0.3} />
          {[1, 2, 3, 4].map((k) => (
            <line
              key={k}
              x1={bx + PAD + (innerW * k) / 5}
              x2={bx + PAD + (innerW * k) / 5}
              y1={BY + PAD + 10}
              y2={BY + BH - PAD - 10}
              stroke="#000"
              strokeWidth={6}
              opacity={0.3}
            />
          ))}
          {alerta > 0 ? (
            <rect x={bx + PAD} y={BY + PAD} width={innerW} height={innerH} rx={24} fill={accent} opacity={pisca * 0.55} />
          ) : null}
        </g>

        {fichas}
      </svg>

      {/* porcentagem no centro da bateria */}
      <div
        style={{
          position: 'absolute',
          left: bx,
          top: BY,
          width: BW,
          height: BH,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 900,
          fontSize: 110,
          lineHeight: 1,
          color: '#fff',
          transform: `scale(${entra})`,
          ...outline(10),
        }}
      >
        {Math.round(nivel)}%
      </div>

      {label ? (
        <div
          style={{
            position: 'absolute',
            top: 40,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontWeight: 900,
            fontSize: 84,
            lineHeight: 1.1,
            color: highlight,
            textTransform: 'uppercase',
            opacity: Math.min(1, labelIn * 1.5),
            transform: `translateY(${interpolate(labelIn, [0, 1], [-60, 0])}px) scale(${labelIn})`,
            ...outline(12),
          }}
        >
          {label}
        </div>
      ) : null}

      {temBoneco ? (
        <div
          style={{
            position: 'absolute',
            left: BONECO_X - 100,
            top: BASE - 200,
            width: 200,
            height: 200,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            fontSize: 150,
            lineHeight: 1,
            opacity: Math.min(1, bonecoIn * 1.5),
            transform: `translate(${bonecoX}px, ${bonecoY}px) rotate(${ginga + tremR}deg)`,
            transformOrigin: '50% 100%',
          }}
        >
          {emoji}
        </div>
      ) : null}

      {zerou ? (
        <div
          style={{
            position: 'absolute',
            left: bx,
            width: BW + TW,
            top: BASE + 64,
            textAlign: 'center',
            fontWeight: 900,
            fontSize: 64,
            lineHeight: 1,
            color: accent,
            whiteSpace: 'nowrap',
            opacity: Math.min(1, popIn * 2),
            transform: `scale(${popIn}) rotate(-4deg)`,
            ...outline(10),
          }}
        >
          ⚠️ ZERADO
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
