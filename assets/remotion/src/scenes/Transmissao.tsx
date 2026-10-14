import React from 'react';
import {AbsoluteFill, Easing, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

type Pessoa = {emoji: string; label: string; at?: number};

const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
/** Largura aproximada de Montserrat 900 em caixa alta, por caractere (em "em"). */
const CHAR_EM = 0.76;

// Torre (esquerda)
const TX = 175;
const BY = 688;

// Casas (direita)
const CARD_W = 500;
const CARD_X = 420;
const CARD_CX = CARD_X + CARD_W / 2;

// Ondas: WAVE_K arcos simultâneos, um novo a cada WAVE_P frames (loop determinístico).
const WAVE_P = 10;
const WAVE_K = 4;
const WAVE_L = WAVE_P * WAVE_K;
const WAVE_START = 8;
const MAX_R = 900;
const A1 = (-38 * Math.PI) / 180;
const A2 = (66 * Math.PI) / 180;

/**
 * Programa de rádio/TV falando com quem está "do outro lado": ondas saem de uma torre de transmissão
 * e chegam às casas (uma pessoa por janela, cada uma entrando no seu `at`). Quando a onda passa,
 * a janela acende. Em `comigoAt`, a pessoa `destaque` reage com um balão "É COMIGO!".
 */
export const Transmissao: React.FC<
  SceneProps & {titulo?: string; pessoas?: Pessoa[]; comigoAt?: number; destaque?: number; comigo?: string}
> = ({
  titulo = '',
  pessoas = [
    {emoji: '👩‍👧', label: 'Mãe aflita'},
    {emoji: '🤒', label: 'Doente'},
    {emoji: '😔', label: 'Depressão'},
  ],
  comigoAt = undefined,
  destaque = 0,
  comigo = 'É comigo!',
  accent,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const lista = pessoas.slice(0, 4);
  const n = lista.length;

  // ---- Layout vertical ----
  const top = titulo ? 118 : 26;
  const TY = top + (titulo ? 70 : 80); // luz no topo da torre (origem das ondas)
  const LT = TY + 40; // topo da treliça
  const avail = 734 - top;
  const slot = avail / Math.max(1, n);
  const s = Math.min(1, slot / 195);
  const roofH = 40 * s;
  const bodyH = 140 * s;
  const pad = 13 * s;
  const winS = bodyH - 2 * pad;
  const cardCY = (i: number) => top + slot * i + (slot - (roofH + bodyH)) / 2 + roofH + bodyH / 2;

  const starts = lista.map((p, i) => Math.round((p.at ?? i * 0.5) * fps));

  // ---- Torre ----
  const towerIn = spring({frame, fps, config: {damping: 12, stiffness: 120}});
  const lightIn = spring({frame: frame - 6, fps, config: {damping: 8, stiffness: 200}});
  const signIn = spring({frame: frame - 4, fps, config: {damping: 10, stiffness: 180}});
  const blink = interpolate(frame % 24, [0, 3, 12, 24], [0.35, 1, 1, 0.35], {
    ...CLAMP,
    easing: Easing.inOut(Easing.quad),
  });

  const legX = (u: number, side: number) => TX + side * (110 - 94 * u);
  const legY = (u: number) => BY - (BY - LT) * u;
  const levels = [0, 0.25, 0.48, 0.68, 0.85, 1];
  let braces = '';
  levels.forEach((u, k) => {
    if (k > 0) braces += `M${legX(u, -1)} ${legY(u)} L${legX(u, 1)} ${legY(u)} `;
    if (k < levels.length - 1) {
      const v = levels[k + 1];
      braces += `M${legX(u, -1)} ${legY(u)} L${legX(v, 1)} ${legY(v)} `;
      braces += `M${legX(u, 1)} ${legY(u)} L${legX(v, -1)} ${legY(v)} `;
    }
  });
  const legs = `M${legX(0, -1)} ${legY(0)} L${legX(1, -1)} ${legY(1)} M${legX(0, 1)} ${legY(0)} L${legX(1, 1)} ${legY(1)}`;

  // ---- Ondas ----
  const waves: {r: number; o: number}[] = [];
  for (let j = 0; j < WAVE_K; j++) {
    const age = frame - WAVE_START - j * WAVE_P;
    if (age < 0) continue;
    const ph = age % WAVE_L;
    const r = interpolate(ph, [0, WAVE_L], [26, MAX_R], {...CLAMP, easing: Easing.out(Easing.quad)});
    const o = interpolate(ph, [0, 4, WAVE_L * 0.7, WAVE_L], [0, 1, 0.75, 0], {
      ...CLAMP,
      easing: Easing.inOut(Easing.quad),
    });
    waves.push({r, o});
  }
  const arc = (r: number) =>
    `M${TX + r * Math.cos(A1)} ${TY + r * Math.sin(A1)} A${r} ${r} 0 0 1 ${TX + r * Math.cos(A2)} ${TY + r * Math.sin(A2)}`;

  // ---- "É comigo!" ----
  const dIdx = Math.max(0, Math.min(n - 1, Math.round(destaque)));
  const cf = comigoAt === undefined ? null : Math.round(comigoAt * fps);
  const tC = cf === null ? -1 : frame - cf;
  const on = cf !== null && n > 0 && tC >= 0;
  const pop = on ? spring({frame: tC, fps, config: {damping: 7, stiffness: 200}}) : 0;
  const focus = on ? spring({frame: tC, fps, config: {damping: 200}, durationInFrames: 8}) : 0;
  const rayP = on ? spring({frame: tC - 1, fps, config: {damping: 10, stiffness: 220}}) : 0;
  const bubbleIn = on ? spring({frame: tC - 3, fps, config: {damping: 9, stiffness: 210}}) : 0;
  const markP = on ? spring({frame: tC - 7, fps, config: {damping: 12, stiffness: 200}}) : 0;
  const beat = on ? 0.025 * Math.sin((tC / fps) * Math.PI * 2 * 1.8) * focus : 0;

  const titleIn = spring({frame: frame - 2, fps, config: {damping: 10}});
  const titleSize = Math.min(60, 880 / (Math.max(1, titulo.length) * CHAR_EM));

  const hw = CARD_W / 2;
  const hh = bodyH / 2;
  const winCxLocal = -hw + pad + winS / 2;

  const renderCard = (pz: Pessoa, i: number) => {
    const st = starts[i];
    if (frame < st) return null;
    const p = spring({frame: frame - st, fps, config: {damping: 12, stiffness: 150}});
    const cy = cardCY(i);
    const isD = on && i === dIdx;
    const dx = interpolate(p, [0, 1], [240, 0]);
    const sc = interpolate(p, [0, 1], [0.5, 1]) * (isD ? 1 + 0.07 * pop + beat : 1);
    const opacity = interpolate(p, [0, 0.3], [0, 1], CLAMP);
    // As outras casas escurecem com uma película opaca (com opacidade, as ondas apareceriam através delas).
    const dim = on && !isD ? 0.45 * focus : 0;

    // A janela acende quando a frente de onda passa por ela.
    const dist = Math.hypot(CARD_X + pad + winS / 2 - TX, cy - TY);
    let lit = 0;
    for (const w of waves) {
      lit = Math.max(lit, w.o * interpolate(w.r - dist, [-50, 0, 80], [0, 1, 0], CLAMP));
    }
    lit = Math.max(lit * Math.min(1, p), isD ? focus : 0);

    const label = pz.label.toUpperCase();
    const labelX = -hw + pad + winS + 18 * s;
    const labelMaxW = hw - 16 - labelX;
    const fs = Math.min(40 * s, labelMaxW / (Math.max(1, label.length) * CHAR_EM));
    const eFs = 90 * s * (1 + 0.06 * lit);

    return (
      <g key={`c${i}`} opacity={opacity} transform={`translate(${CARD_CX + dx} ${cy}) scale(${sc})`}>
        {/* linhas de impacto (HQ) atrás da casa em destaque */}
        {isD
          ? Array.from({length: 14}).map((_, k) => {
              const a = (k / 14) * Math.PI * 2 + 0.2;
              const L = 52 * s * rayP * (k % 2 ? 0.6 : 1) * (1 + 0.15 * Math.sin(tC * 0.8 + k));
              const rx0 = hw + 16;
              const ry0 = hh + 16;
              const x1 = Math.cos(a) * rx0;
              const y1 = Math.sin(a) * ry0;
              const x2 = Math.cos(a) * (rx0 + L);
              const y2 = Math.sin(a) * (ry0 + L);
              return (
                <g key={`r${k}`}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#000" strokeWidth={14} strokeLinecap="round" />
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={highlight} strokeWidth={7} strokeLinecap="round" />
                </g>
              );
            })
          : null}

        {/* brilho quando a onda chega */}
        <rect x={-hw - 14} y={-hh - 14} width={CARD_W + 28} height={bodyH + 28} rx={30 * s} fill={highlight} opacity={0.45 * lit} />
        {/* sombra */}
        <rect x={-hw + 8} y={-hh + 10} width={CARD_W} height={bodyH} rx={18 * s} fill="#000" opacity={0.35} />
        {/* telhado */}
        <polygon
          points={`${-hw - 12},${-hh + 6} ${hw + 12},${-hh + 6} 0,${-hh - roofH}`}
          fill={accent}
          stroke="#000"
          strokeWidth={7}
          strokeLinejoin="round"
        />
        {/* parede */}
        <rect
          x={-hw}
          y={-hh}
          width={CARD_W}
          height={bodyH}
          rx={18 * s}
          fill={interpolateColors(lit, [0, 1], ['#22314d', '#34507e'])}
          stroke="#000"
          strokeWidth={7}
        />
        {isD ? (
          <g opacity={focus}>
            <rect x={-hw - 9} y={-hh - 9} width={CARD_W + 18} height={bodyH + 18} rx={24 * s} fill="none" stroke="#000" strokeWidth={18} />
            <rect x={-hw - 9} y={-hh - 9} width={CARD_W + 18} height={bodyH + 18} rx={24 * s} fill="none" stroke={accent} strokeWidth={10} />
          </g>
        ) : null}
        {/* janela */}
        <rect
          x={-hw + pad}
          y={-winS / 2}
          width={winS}
          height={winS}
          rx={14 * s}
          fill={interpolateColors(lit, [0, 1], ['#0d1525', '#fff2a8'])}
          stroke="#000"
          strokeWidth={6}
        />
        <rect x={-hw + pad + 10 * s} y={-winS / 2 + 9 * s} width={winS * 0.32} height={8 * s} rx={4 * s} fill="#fff" opacity={0.3} />
        <text x={winCxLocal} y={eFs * 0.35} textAnchor="middle" fontSize={eFs}>
          {pz.emoji}
        </text>
        {/* rótulo */}
        <text
          x={labelX}
          y={fs * 0.36}
          fontFamily={FONT}
          fontWeight={900}
          fontSize={fs}
          fill="#fff"
          stroke="#000"
          strokeWidth={Math.max(6, fs * 0.22)}
          strokeLinejoin="round"
          paintOrder="stroke fill"
        >
          {label}
        </text>
        {dim > 0 ? (
          <g opacity={dim}>
            <polygon points={`${-hw - 12},${-hh + 6} ${hw + 12},${-hh + 6} 0,${-hh - roofH}`} fill="#0b0f19" />
            <rect x={-hw} y={-hh} width={CARD_W} height={bodyH} rx={18 * s} fill="#0b0f19" />
          </g>
        ) : null}
      </g>
    );
  };

  // ---- Balão ----
  const bText = comigo.toUpperCase();
  const bFs = Math.min(56, 380 / (Math.max(1, bText.length) * CHAR_EM));
  const bw = Math.min(450, bText.length * bFs * CHAR_EM + 70);
  const bh = bFs * 1.75;
  const dcy = n > 0 ? cardCY(dIdx) : 0;
  const bx = Math.max(bw / 2 + 12, CARD_X + 50 - bw / 2);
  const by = Math.min(Math.max(dcy - bodyH * 0.5, top + bh / 2 - 6), 740 - bh / 2);
  const tipX = CARD_X + 24;
  const tipY = dcy + bodyH * 0.1;
  const tail = `${bx + bw / 2 - 92},${by + bh / 2 - 10} ${bx + bw / 2 - 36},${by + bh / 2 - 10} ${tipX},${tipY}`;
  const ox = bx + bw / 2 - 50;
  const oy = by + bh / 2;
  const mx = bx - bw / 2 + 8;
  const my = by - bh / 2 + 6;

  return (
    <AbsoluteFill style={{fontFamily: FONT, alignItems: 'center'}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        {/* ---- Torre ---- */}
        <ellipse cx={TX} cy={BY + 26} rx={175 * towerIn} ry={20} fill="#000" opacity={0.35 * Math.min(1, towerIn)} />
        <g transform={`translate(${TX} ${BY}) scale(${0.6 + 0.4 * towerIn} ${towerIn}) translate(${-TX} ${-BY})`}>
          <path d={braces} fill="none" stroke="#000" strokeWidth={15} strokeLinecap="round" strokeLinejoin="round" />
          <path d={braces} fill="none" stroke="#e8edf3" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
          <path d={legs} fill="none" stroke="#000" strokeWidth={22} strokeLinecap="round" />
          <path d={legs} fill="none" stroke="#f8fafc" strokeWidth={11} strokeLinecap="round" />
          {/* mastro + plataforma */}
          <line x1={TX} y1={LT} x2={TX} y2={TY + 10} stroke="#000" strokeWidth={13} strokeLinecap="round" />
          <line x1={TX} y1={LT} x2={TX} y2={TY + 10} stroke={accent} strokeWidth={6} strokeLinecap="round" />
          <rect x={TX - 30} y={LT - 7} width={60} height={14} rx={5} fill={accent} stroke="#000" strokeWidth={5} />
          {/* base */}
          <rect x={TX - 135} y={BY - 4} width={270} height={22} rx={6} fill="#475569" stroke="#000" strokeWidth={6} />
        </g>
        {/* placa AO VIVO */}
        <g transform={`translate(${TX} ${BY - 64}) scale(${signIn})`}>
          <rect x={-83} y={-24} width={166} height={48} rx={12} fill={accent} stroke="#000" strokeWidth={6} />
          <circle cx={-60} cy={0} r={8} fill="#fff" opacity={blink} />
          <text x={12} y={8} textAnchor="middle" fontFamily={FONT} fontWeight={900} fontSize={22} fill="#fff">
            AO VIVO
          </text>
        </g>

        {/* ---- Ondas ---- */}
        {waves.map((w, j) => {
          const sw = interpolate(w.r, [26, MAX_R], [11, 5], CLAMP);
          return (
            <g key={`w${j}`} opacity={w.o * Math.min(1, lightIn)}>
              <path d={arc(w.r)} fill="none" stroke="#000" strokeWidth={sw + 8} strokeLinecap="round" />
              <path d={arc(w.r)} fill="none" stroke={highlight} strokeWidth={sw} strokeLinecap="round" />
            </g>
          );
        })}

        {/* luz piscando no topo */}
        <g transform={`translate(${TX} ${TY}) scale(${lightIn})`}>
          <circle r={32} fill={accent} opacity={0.35 * blink} />
          <circle r={16} fill={interpolateColors(blink, [0.35, 1], ['#7a1010', accent])} stroke="#000" strokeWidth={5} />
          <circle cx={-5} cy={-5} r={4} fill="#fff" opacity={0.8 * blink} />
        </g>

        {/* ---- Casas ---- */}
        {lista.map((pz, i) => (i === dIdx && on ? null : renderCard(pz, i)))}
        {on ? renderCard(lista[dIdx], dIdx) : null}

        {/* ---- Balão "É comigo!" ---- */}
        {on ? (
          <g transform={`translate(${ox} ${oy}) scale(${bubbleIn}) rotate(-4) translate(${-ox} ${-oy})`}>
            {[200, 235, 270].map((deg, k) => {
              const a = (deg * Math.PI) / 180;
              const L = 34 * markP;
              const x1 = mx + Math.cos(a) * 10;
              const y1 = my + Math.sin(a) * 10;
              const x2 = mx + Math.cos(a) * (10 + L);
              const y2 = my + Math.sin(a) * (10 + L);
              return (
                <g key={`m${k}`}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#000" strokeWidth={13} strokeLinecap="round" />
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={accent} strokeWidth={6} strokeLinecap="round" />
                </g>
              );
            })}
            <polygon points={tail} fill="#fff" stroke="#000" strokeWidth={7} strokeLinejoin="round" />
            <rect x={bx - bw / 2} y={by - bh / 2} width={bw} height={bh} rx={bh * 0.45} fill="#fff" stroke="#000" strokeWidth={7} />
            <polygon points={tail} fill="#fff" />
            <text x={bx} y={by + bFs * 0.36} textAnchor="middle" fontFamily={FONT} fontWeight={900} fontSize={bFs} fill="#111">
              {bText}
            </text>
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
