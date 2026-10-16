import React from 'react';
import {AbsoluteFill, Easing, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * "A pessoa tira a força da própria ideia antes de apresentá-la": uma lâmpada grande (a excelente
 * ideia) entra e acende forte (bulbo amarelo com miolo quase branco, halo que pulsa, raios que crescem).
 * Depois, frases de autojustificativa ("Eu acho que talvez…", "É só minha percepção", "Posso estar
 * errada") batem nela como etiquetas, alternando esquerda/direita. A cada batida a lâmpada treme, pisca
 * e perde brilho, até ficar cinza, com o filamento escuro e sem raios, em `apagarAt`. Por fim o rótulo
 * entra no topo.
 */

const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const INK = '#111';
const BULB_OFF = '#9aa3ad';
const METAL = '#A3ABB5';
const METAL_DARK = '#636C77';
const LIGHT_CORE = '#FFFBE0';
const FILAMENT_ON = '#F76707';
const FILAMENT_OFF = '#3D434B';

// Geometria (caixa 940×760). A lâmpada é desenhada em coordenadas locais (centro do bulbo em (0, -2))
// e ampliada S vezes: bulbo de y≈214 a y≈506 (~290 px) e base da rosca em y≈630.
const LAMP = {x: 470, y: 350};
const S = 2;
const BULB_C = -2 * S; // centro do bulbo (px) relativo a LAMP
const BULB_D = 'M -34 78 C -36 54 -66 36 -66 -2 A 66 66 0 1 1 66 -2 C 66 36 36 54 34 78 Z';
const FILAMENT_D = 'M -12 78 L -10 24 Q -5 6 0 24 Q 5 6 10 24 L 12 78';
const SHADOW_Y = 668;

// 10 posições a cada 36°, sem o raio que apontaria para a rosca (90°): 9 raios.
const RAYS = Array.from({length: 10}, (_, i) => -90 + i * 36).filter((a) => a !== 90);
const RAY_IN = 160; // raio interno (px), fora do bulbo

// Etiquetas: a borda interna gruda na lâmpada; esquerda vai de ~12 a 480, direita de 460 a ~928.
// O topo (0–130) fica livre para o rótulo.
const TAG_EDGE = {esq: 480, dir: 460};
const TAG_Y: number[][] = [[300], [270, 430], [240, 370, 500], [232, 322, 412, 502]];
const TAG_ROT = [-4, 4, 3, -3];
const TAG_PAD_X = 20;
const TAG_PAD_Y = 8;
const TAG_BORDER = 6;
const TAG_MAX_W = 468;
const TAG_TEXT_W = TAG_MAX_W - 2 * (TAG_PAD_X + TAG_BORDER);
const TAG_FONT_MAX = 40;
const TAG_LINE = 1.12;

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// Largura aproximada (em "em") do texto em Montserrat 800, um pouco folgada para nunca vazar.
const charEm = (ch: string): number => {
  if (ch === ' ') return 0.27;
  if (ch === '…') return 0.86;
  if ('mwMW'.includes(ch)) return 1.05;
  if ('iljtfrI.,;:!|\'"'.includes(ch)) return 0.42;
  if (ch !== ch.toLowerCase()) return 0.8;
  return 0.66;
};
const textEm = (s: string): number => Array.from(s).reduce((w, ch) => w + charEm(ch), 0);

type Ajuste = {linhas: string[]; size: number};
/** Uma linha até 40 px; se ficar menor que 30 px, tenta quebrar em 2 linhas na melhor palavra. */
const ajustaEtiqueta = (s: string): Ajuste => {
  const cabe = (linhas: string[]): number =>
    Math.floor(Math.min(TAG_FONT_MAX, TAG_TEXT_W / Math.max(1, ...linhas.map(textEm))));
  let melhor: Ajuste = {linhas: [s], size: cabe([s])};
  if (melhor.size >= 30) return melhor;
  const palavras = s.split(/\s+/);
  for (let k = 1; k < palavras.length; k++) {
    const linhas = [palavras.slice(0, k).join(' '), palavras.slice(k).join(' ')];
    const size = cabe(linhas);
    if (size > melhor.size) melhor = {linhas, size};
  }
  return melhor;
};

export const IdeiaApagando: React.FC<
  SceneProps & {
    frases?: string[];
    frasesAt?: number;
    intervalo?: number;
    apagarAt?: number;
    label?: string;
    labelAt?: number;
  }
> = ({
  frases = ['Eu acho que talvez…', 'É só minha percepção', 'Posso estar errada'],
  frasesAt = 1.2,
  intervalo = 0.7,
  apagarAt = 3.6,
  label = 'Sem força',
  labelAt = 3.8,
  accent,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const bruto: unknown[] = Array.isArray(frases) ? frases : [];
  const lista = bruto
    .filter((f): f is string => typeof f === 'string' && f.trim() !== '')
    .map((f) => f.trim())
    .slice(0, 4);
  const n = lista.length;
  const ajustes = lista.map(ajustaEtiqueta);
  const rotulo = typeof label === 'string' ? label.trim() : '';

  // Tempos (frames)
  const lit = Math.round(0.15 * fps); // acende logo depois de entrar
  const hit = Math.round(0.17 * fps); // da entrada da etiqueta até ela bater na lâmpada
  const f0 = Math.max(0, Math.round(num(frasesAt, 1.2) * fps));
  const gap = Math.max(0, num(intervalo, 0.7)) * fps;
  const starts = lista.map((_, i) => f0 + Math.round(i * gap));
  const hits = starts.map((s) => s + hit);
  const fEnd = Math.max(f0 + hit + 1, Math.round(num(apagarAt, 3.6) * fps));
  const l = Math.round(num(labelAt, 3.8) * fps);

  // Entrada da lâmpada e acendimento
  const lampIn = spring({frame, fps, config: {damping: 12, stiffness: 170}});
  const lampOp = interpolate(lampIn, [0, 0.3], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});
  const liga = Math.min(1, Math.max(0, spring({frame: frame - lit, fps, config: {damping: 18, stiffness: 260}})));
  const haloIn = spring({frame: frame - lit, fps, config: {damping: 14, stiffness: 140}});
  const pulse = interpolate(frame, [lit, lit + 0.2 * fps, lit + 0.6 * fps], [0, 1, 0], {
    ...CLAMP,
    easing: Easing.inOut(Easing.quad),
  });

  // Quanto já apagou (0 = acesa, 1 = apagada): degrau a cada batida + leve queda contínua entre elas;
  // chega a 1 exatamente em apagarAt.
  const ts: number[] = [0];
  const vs: number[] = [0];
  const marca = (t: number, v: number) => {
    if (t <= ts[ts.length - 1] || t >= fEnd) return;
    ts.push(t);
    vs.push(Math.min(1, Math.max(v, vs[vs.length - 1])));
  };
  marca(f0, 0);
  hits.forEach((h, i) => {
    marca(h, vs[vs.length - 1] + 0.05);
    marca(h + Math.round(0.2 * fps), (0.8 * (i + 1)) / n);
  });
  ts.push(fEnd);
  vs.push(1);
  const apagado = interpolate(frame, ts, vs, {...CLAMP, easing: Easing.inOut(Easing.quad)});

  // Batida: tremor + pisca determinísticos (seno do frame), que somem em ~0,4 s.
  const choque = hits.reduce(
    (m, h) =>
      Math.max(
        m,
        interpolate(frame, [h - 1, h, h + Math.max(2, Math.round(0.4 * fps))], [0, 1, 0], {
          ...CLAMP,
          easing: Easing.out(Easing.quad),
        }),
      ),
    0,
  );
  const pisca = choque * (0.5 + 0.5 * Math.sin(frame * 3.7));
  const vivo = liga * (1 - apagado);
  const brilho = Math.min(1, Math.max(0, vivo * (1 - 0.6 * pisca)));

  const shakeX = choque * Math.sin(frame * 2.9) * 10;
  const shakeY = choque * Math.cos(frame * 3.4) * 4;
  const shakeR = choque * Math.sin(frame * 2.3) * 3;
  const bob = Math.sin(frame / 12) * 4 * vivo;

  const lampScale = interpolate(lampIn, [0, 1], [0.3, 1]) * (1 + 0.06 * pulse) * (1 - 0.04 * apagado);
  const bulbFill = interpolateColors(brilho, [0, 1], [BULB_OFF, highlight]);
  const filament = interpolateColors(brilho, [0, 1], [FILAMENT_OFF, FILAMENT_ON]);
  const raio = interpolate(brilho, [0.2, 1], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});
  const haloR = 300 * Math.max(0, haloIn) * (0.3 + 0.7 * brilho) * (1 + 0.22 * pulse);
  const haloOp = Math.min(1, Math.max(0, haloIn)) * brilho;

  // Rótulo
  const labelIn = spring({frame: frame - l, fps, config: {damping: 10, stiffness: 150}});
  const labelSize = Math.floor(Math.min(84, 860 / (0.76 * Math.max(1, rotulo.length))));

  return (
    <AbsoluteFill style={{fontFamily: FONT, overflow: 'hidden'}}>
      <svg style={{position: 'absolute', inset: 0}} width="100%" height="100%" viewBox="0 0 940 760">
        <defs>
          <radialGradient id="ideia-halo">
            <stop offset="0%" stopColor={highlight} stopOpacity={0.8} />
            <stop offset="45%" stopColor={highlight} stopOpacity={0.3} />
            <stop offset="100%" stopColor={highlight} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="ideia-core">
            <stop offset="0%" stopColor="#fff" stopOpacity={1} />
            <stop offset="55%" stopColor={LIGHT_CORE} stopOpacity={0.85} />
            <stop offset="100%" stopColor={LIGHT_CORE} stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* sombra */}
        <ellipse cx={LAMP.x} cy={SHADOW_Y} rx={Math.max(0, 170 * lampIn)} ry={22} fill="#000" opacity={0.35} />

        <g
          opacity={lampOp}
          transform={`translate(${LAMP.x + shakeX} ${LAMP.y + bob + shakeY}) rotate(${shakeR}) scale(${lampScale})`}
        >
          {/* halo e raios (centrados no bulbo) */}
          <g transform={`translate(0 ${BULB_C})`}>
            {haloR > 1 && haloOp > 0.01 ? <circle r={haloR} fill="url(#ideia-halo)" opacity={haloOp} /> : null}
            {RAYS.map((ang) => {
              const d = Math.min(Math.abs(ang + 90), 360 - Math.abs(ang + 90)) / 36; // 0 no topo … 4 embaixo
              const cresce = spring({frame: frame - lit - 1 - d * 0.04 * fps, fps, config: {damping: 10, stiffness: 210}});
              const len = (d % 2 === 0 ? 74 : 52) * Math.max(0, cresce) * raio;
              if (len < 1) return null;
              return (
                <g key={ang} transform={`rotate(${ang})`} opacity={Math.min(1, cresce * 2)}>
                  <line x1={RAY_IN} y1={0} x2={RAY_IN + len} y2={0} stroke={INK} strokeWidth={26} strokeLinecap="round" />
                  <line x1={RAY_IN} y1={0} x2={RAY_IN + len} y2={0} stroke={highlight} strokeWidth={14} strokeLinecap="round" />
                </g>
              );
            })}
          </g>

          {/* lâmpada (coordenadas locais × S) */}
          <g transform={`scale(${S})`}>
            <path d={BULB_D} fill={bulbFill} stroke={INK} strokeWidth={4.5} strokeLinejoin="round" />
            <circle cx={0} cy={-6} r={56} fill="url(#ideia-core)" opacity={brilho} />
            <path d="M 28 -50 A 56 56 0 0 1 51 22" fill="none" stroke="#000" strokeWidth={7} strokeLinecap="round" opacity={0.1} />
            <path
              d={FILAMENT_D}
              fill="none"
              stroke={LIGHT_CORE}
              strokeWidth={8}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.8 * brilho}
            />
            <path d={FILAMENT_D} fill="none" stroke={filament} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            <path d="M -44 -18 Q -42 -46 -16 -54" fill="none" stroke="#fff" strokeWidth={7} strokeLinecap="round" opacity={0.7} />

            {/* rosca */}
            <rect x={-38} y={74} width={76} height={50} rx={10} fill={METAL} stroke={INK} strokeWidth={4.5} />
            {[88, 100, 112].map((y) => (
              <path key={y} d={`M -32 ${y - 3} L 32 ${y + 3}`} stroke={METAL_DARK} strokeWidth={4} strokeLinecap="round" />
            ))}
            <rect x={-26} y={80} width={7} height={38} rx={3.5} fill="#fff" opacity={0.35} />
            <path d="M -22 124 L 22 124 L 14 140 L -14 140 Z" fill={FILAMENT_OFF} stroke={INK} strokeWidth={4.5} strokeLinejoin="round" />
          </g>
        </g>
      </svg>

      {/* etiquetas de autojustificativa (grudadas: tremem junto com a lâmpada) */}
      <div style={{position: 'absolute', inset: 0, transform: `translate(${shakeX}px, ${bob + shakeY}px)`}}>
        {lista.map((txt, i) => {
          if (frame < starts[i]) return null;
          const esq = i % 2 === 0;
          const lado = esq ? -1 : 1;
          const p = spring({frame: frame - starts[i], fps, config: {damping: 11, stiffness: 190, mass: 0.8}});
          const rot = (TAG_ROT[i] ?? 0) + interpolate(p, [0, 1], [lado * 14, 0]);
          const dx = interpolate(p, [0, 1], [lado * 150, 0]); // passa um pouco do ponto (bate) e volta
          const sc = interpolate(p, [0, 1], [0.45, 1]);
          const op = interpolate(p, [0, 0.25], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});
          const {linhas, size} = ajustes[i] ?? {linhas: [txt], size: 32};
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: TAG_Y[n - 1]?.[i] ?? 360,
                ...(esq ? {right: 940 - TAG_EDGE.esq} : {left: TAG_EDGE.dir}),
                transformOrigin: esq ? '100% 50%' : '0% 50%',
                transform: `translateY(-50%) translateX(${dx}px) rotate(${rot}deg) scale(${sc})`,
                opacity: op,
                padding: `${TAG_PAD_Y}px ${TAG_PAD_X}px`,
                background: '#fff',
                border: `${TAG_BORDER}px solid ${INK}`,
                borderRadius: 18,
                boxShadow: '7px 9px 0 rgba(0,0,0,0.35)',
                fontWeight: 800,
                fontSize: size,
                lineHeight: TAG_LINE,
                color: INK,
                whiteSpace: 'nowrap',
                textAlign: 'center',
              }}
            >
              {linhas.map((ln, k) => (
                <div key={k}>{ln}</div>
              ))}
            </div>
          );
        })}
      </div>

      {rotulo ? (
        <div
          style={{
            position: 'absolute',
            top: 22,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontWeight: 900,
            fontSize: labelSize,
            lineHeight: 1.1,
            color: accent,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            opacity: Math.min(1, labelIn * 1.5),
            transform: `translateY(${interpolate(labelIn, [0, 1], [-50, 0])}px) scale(${labelIn})`,
            ...outline(12),
          }}
        >
          {rotulo}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
