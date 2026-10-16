import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

type Nivel = {label: string; sub?: string; emoji?: string; at?: number};

const DEFAULT_NIVEIS: Nivel[] = [
  {label: 'Conclusão', sub: 'sempre', emoji: '🎯', at: 0.2},
  {label: 'Sustentação', sub: 'se precisar', emoji: '🧱', at: 1.6},
  {label: 'Detalhes', sub: 'se pedirem', emoji: '🔍', at: 3.0},
];

const CX = 470;
const BASE_W = 850; // largura da base da pirâmide (andar de baixo)
const APEX_W = 440; // largura do topo do andar 1
const GAP = 14; // vão entre os andares
const MAX_H = 190;
const BOTTOM = 690;
/** O conteúdo de um andar nunca passa de CX ± 420 (cabe na caixa 940 mesmo com escala 1.04). */
const RIGHT_MAX = 420;
/** Largura aproximada de Montserrat 900 em caixa alta, por caractere (em "em"). */
const CHAR_EM = 0.72;
/** Idem para Montserrat 700 em caixa mista (o `sub`). */
const SUB_EM = 0.6;
const SUB_RATIO = 0.56;
const STROKE = 9;
const STEP_S = 1.2; // espaçamento quando falta `at`

const FALL = {damping: 16, stiffness: 160, mass: 1};
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const OUT = Easing.out(Easing.cubic);

/** Partículas de poeira (determinísticas) em cada canto de baixo do andar que assenta. */
const DUST = [
  {dx: 40, dy: -8, r: 13},
  {dx: 22, dy: -30, r: 10},
  {dx: 62, dy: -22, r: 8},
] as const;

/** Primeiro frame em que a mola de queda chega ao lugar (o "impacto"). */
const firstHit = (fps: number): number => {
  for (let f = 1; f < fps * 3; f++) {
    if (spring({frame: f, fps, config: FALL}) >= 1) return f;
  }
  return Math.round(fps * 0.3);
};

const estiloDoAndar = (i: number, n: number, accent: string, highlight: string) => {
  if (i === 0) return {fill: accent, ink: '#fff', edge: '#111'};
  if (i === n - 1) return {fill: '#334155', ink: '#fff', edge: '#111'};
  if (i === 1) return {fill: highlight, ink: '#111', edge: highlight};
  return {fill: '#64748b', ink: '#fff', edge: '#111'};
};

/**
 * Regra dos três níveis: pirâmide montada de cima para baixo. Cada andar cai no segundo em que
 * é falado (`at`, em segundos desde o início da cena), quica de leve e assenta com tremor e poeira.
 * O andar mais recente fica maior/brilhante; no fim, o nível 1 pulsa ("comece por aqui").
 */
export const Niveis: React.FC<SceneProps & {titulo?: string; niveis?: Nivel[]}> = ({
  titulo = '',
  niveis = DEFAULT_NIVEIS,
  accent,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const title = typeof titulo === 'string' ? titulo.trim() : '';
  const lista = (Array.isArray(niveis) ? niveis : [])
    .filter((v) => typeof v === 'object' && v !== null && typeof v.label === 'string' && v.label.trim() !== '')
    .slice(0, 4);
  if (lista.length === 0) return null;
  const n = lista.length;

  // Frames de entrada (monotônicos). Sem `at`: 1.2 s depois do anterior.
  const starts: number[] = [];
  let prevAt = 0.2 - STEP_S;
  lista.forEach((nv, i) => {
    const at = typeof nv.at === 'number' && Number.isFinite(nv.at) ? Math.max(0, nv.at) : prevAt + STEP_S;
    prevAt = at;
    const f = Math.round(at * fps);
    starts.push(i === 0 ? f : Math.max(f, starts[i - 1] + 3));
  });
  const hitF = firstHit(fps);
  const hits = starts.map((s) => s + hitF);

  // Geometria: andares de altura h empilhados; meia-largura cresce linearmente para baixo.
  const top = title ? 132 : 34;
  const avail = BOTTOM - top;
  const h = Math.min(MAX_H, (avail - (n - 1) * GAP) / n);
  const total = n * h + (n - 1) * GAP;
  const y0 = top + (avail - total) / 2;
  const yBase = y0 + total;
  const slope = n === 1 ? 0.35 : (BASE_W - APEX_W) / 2 / total;
  const halfAt = (y: number) => BASE_W / 2 - slope * (yBase - y);

  // Texto de cada andar: fonte reduzida até caber; andares de baixo não ficam maiores que o de cima.
  let prevFs = 0;
  const andares = lista.map((nv, i) => {
    const cy = y0 + i * (h + GAP) + h / 2;
    const hwM = halfAt(cy);
    const hwT = hwM - (slope * h) / 2;
    const hwB = hwM + (slope * h) / 2;
    const label = nv.label.trim().toUpperCase();
    const sub = typeof nv.sub === 'string' ? nv.sub.trim() : '';
    const emoji = typeof nv.emoji === 'string' ? nv.emoji.trim() : '';

    const r = Math.max(18, Math.min(36, h * 0.19)); // selo no lado esquerdo do trapézio
    const es = emoji ? Math.min(h * 0.34, 66) : 0;
    const emojiW = es * 1.12;
    const g2 = emoji ? es * 0.22 : 0;
    const leftLim = -hwM + r + 12;
    const rightLim = hwM - slope * h * 0.24 - 24; // borda direita na altura do topo do texto
    const textAvail = rightLim - leftLim - emojiW - g2;
    const perFs = Math.max([...label].length * CHAR_EM, [...sub].length * SUB_EM * SUB_RATIO, 1);
    const fsMax = Math.min(h * 0.3, 60);
    let fs = Math.min(fsMax, textAvail / perFs);
    if (i > 0) fs = Math.min(fs, Math.max(prevFs, fsMax * 0.8));
    fs = Math.max(fs, Math.min(fsMax, 28));
    prevFs = fs;
    const ss = fs * SUB_RATIO;

    // Centralizado no eixo se couber; senão encostado no selo (pode passar um pouco do trapézio).
    const contentW = emojiW + g2 + perFs * fs;
    const centered = contentW / 2 <= Math.min(-leftLim, rightLim);
    const x0 = centered ? -contentW / 2 : leftLim;
    const k = Math.min(1, (RIGHT_MAX - x0) / contentW);

    const capL = 0.72 * fs;
    const capS = sub ? 0.7 * ss : 0;
    const lineGap = sub ? 0.3 * fs : 0;
    const blockH = capL + lineGap + capS;
    const yL = -blockH / 2 + capL;
    const yS = yL + lineGap + capS;

    return {cy, hwT, hwM, hwB, label, sub, emoji, r, es, emojiW, g2, fs, ss, x0, k, yL, yS};
  });

  // "Assentou": mola curta a partir do impacto. O mais recente fica ativo até o próximo assentar.
  const land = (i: number) =>
    i < n ? spring({frame: frame - hits[i], fps, config: {damping: 200}, durationInFrames: 8}) : 0;

  // Tremor da pirâmide inteira a cada impacto (mais forte nos andares de baixo, que são maiores).
  let shakeX = 0;
  let shakeY = 0;
  hits.forEach((hf, i) => {
    const t = frame - hf;
    if (t < 0) return;
    const decay = interpolate(t, [0, 12], [1, 0], {...CLAMP, easing: OUT});
    const amp = 2.5 + 3 * (n > 1 ? i / (n - 1) : 1);
    shakeX += amp * Math.sin(t * 2.4) * decay;
    shakeY += amp * 0.45 * Math.sin(t * 3.3) * decay;
  });

  // Pulso do nível 1 depois que todos entraram.
  const tAll = frame - (hits[n - 1] + 8);
  const pulseAmp = interpolate(tAll, [0, 12], [0, 1], {...CLAMP, easing: Easing.inOut(Easing.quad)});
  const wave = (1 - Math.cos(((tAll / fps) * Math.PI * 2) / 1.2)) / 2;
  const pulse = 1 + 0.03 * pulseAmp * wave;

  // Sombra acompanha o andar mais largo que já assentou.
  const shadowRx = Math.max(0, ...andares.map((a, i) => a.hwB * 0.95 * land(i)));
  const shadowOp = 0.34 * land(0);

  const titleIn = spring({frame: frame - 1, fps, config: {damping: 12, stiffness: 170}});
  const titleSize = Math.min(76, 880 / (Math.max(1, [...title].length) * CHAR_EM));

  return (
    <AbsoluteFill style={{fontFamily: FONT, alignItems: 'center'}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        {shadowRx > 1 ? (
          <ellipse cx={CX} cy={yBase + 26} rx={shadowRx} ry={26} fill="#000" opacity={shadowOp} />
        ) : null}

        <g transform={`translate(${shakeX} ${shakeY})`}>
          {/* Andares de baixo para cima: o que está caindo passa por trás dos que já assentaram. */}
          {andares.map((_, j) => {
            const i = n - 1 - j;
            const a = andares[i];
            const t = frame - starts[i];
            if (t < 0) return null;

            const p = spring({frame: t, fps, config: FALL});
            const drop = i === 0 ? Math.min(a.cy + h / 2, 320) : h + GAP;
            const dy = -drop * Math.abs(1 - p); // overshoot vira um quique curto para cima
            const opacity = interpolate(t, [0, 4], [0, 1], {...CLAMP, easing: OUT});

            const ti = frame - hits[i];
            const squash = ti < 0 ? 0 : interpolate(ti, [0, 7], [1, 0], {...CLAMP, easing: OUT});
            const sx = 1 + 0.035 * squash;
            const sy = 1 - 0.07 * squash;

            const active = Math.max(0, land(i) - land(i + 1));
            const sc = (1 + 0.04 * active) * (i === 0 ? pulse : 1);
            const glow = Math.min(1, active + (i === 0 ? 0.6 * pulseAmp * wave : 0));
            const st = estiloDoAndar(i, n, accent, highlight);

            const pts = (yA: number, yB: number) => {
              const hA = a.hwM + slope * yA;
              const hB = a.hwM + slope * yB;
              return `${-hA},${yA} ${hA},${yA} ${hB},${yB} ${-hB},${yB}`;
            };
            const body = pts(-h / 2, h / 2);
            const glossH = Math.max(5, h * 0.055);
            const glossW = Math.max(0, a.hwT - 30);

            return (
              <g
                key={`n${i}`}
                opacity={opacity}
                transform={`translate(${CX} ${a.cy + dy}) scale(${sc}) translate(0 ${h / 2}) scale(${sx} ${sy}) translate(0 ${-h / 2})`}
              >
                {glow > 0.01 ? (
                  <polygon points={body} fill="none" stroke="#fff" strokeWidth={24} strokeLinejoin="round" opacity={0.45 * glow} />
                ) : null}
                <polygon points={body} fill={st.fill} />
                {/* espessura da laje + faixa de brilho */}
                <polygon points={pts(h / 2 - h * 0.14, h / 2)} fill="#000" opacity={0.18} />
                <rect x={-glossW} y={-h / 2 + h * 0.09} width={glossW * 2} height={glossH} rx={glossH / 2} fill="#fff" opacity={0.35} />
                {active > 0.01 ? <polygon points={body} fill="#fff" opacity={0.14 * active} /> : null}
                <polygon points={body} fill="none" stroke="#111" strokeWidth={STROKE} strokeLinejoin="round" />

                {/* selo com o número do nível, na aresta esquerda */}
                <g transform={`translate(${-a.hwM} 0)`}>
                  <circle r={a.r} fill="#fff" stroke="#111" strokeWidth={Math.max(4, a.r * 0.2)} />
                  <text y={a.r * 0.42} textAnchor="middle" fontFamily={FONT} fontWeight={900} fontSize={a.r * 1.2} fill="#111">
                    {i + 1}
                  </text>
                </g>

                <g transform={`translate(${a.x0} 0) scale(${a.k})`}>
                  {a.emoji ? (
                    <text x={a.emojiW / 2} y={a.es * 0.36} textAnchor="middle" fontSize={a.es}>
                      {a.emoji}
                    </text>
                  ) : null}
                  <text
                    x={a.emojiW + a.g2}
                    y={a.yL}
                    fontFamily={FONT}
                    fontWeight={900}
                    fontSize={a.fs}
                    fill={st.ink}
                    stroke={st.edge}
                    strokeWidth={a.fs * 0.14}
                    strokeLinejoin="round"
                    paintOrder="stroke fill"
                  >
                    {a.label}
                  </text>
                  {a.sub ? (
                    <text
                      x={a.emojiW + a.g2}
                      y={a.yS}
                      fontFamily={FONT}
                      fontWeight={700}
                      fontSize={a.ss}
                      fill={st.ink}
                      opacity={0.85}
                      stroke={st.edge}
                      strokeWidth={a.ss * 0.14}
                      strokeLinejoin="round"
                      paintOrder="stroke fill"
                    >
                      {a.sub}
                    </text>
                  ) : null}
                </g>
              </g>
            );
          })}

          {/* Poeira no impacto: nuvenzinhas saindo dos cantos de baixo do andar que assentou. */}
          {andares.map((a, i) => {
            const t = frame - hits[i];
            if (t < 0 || t > 24) return null;
            const mult = 0.8 + 0.4 * (n > 1 ? i / (n - 1) : 1);
            const yC = a.cy + h / 2 - 4;
            return (
              <g key={`d${i}`}>
                {[-1, 1].flatMap((side) =>
                  DUST.map((d, k) => {
                    const q = interpolate(t, [0, 14 + k * 4], [0, 1], {...CLAMP, easing: OUT});
                    if (q >= 1) return null;
                    const x = Math.min(928, Math.max(12, CX + side * (a.hwB - 6 + d.dx * mult * q)));
                    return (
                      <circle
                        key={`${side}_${k}`}
                        cx={x}
                        cy={yC + d.dy * mult * q}
                        r={d.r * mult * (0.5 + 0.8 * q)}
                        fill="#e5e7eb"
                        stroke="#111"
                        strokeWidth={3}
                        opacity={0.9 * (1 - q)}
                      />
                    );
                  }),
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {title ? (
        <div
          style={{
            position: 'absolute',
            top: 28,
            width: '100%',
            fontWeight: 900,
            fontSize: titleSize,
            lineHeight: 1.1,
            color: accent,
            textTransform: 'uppercase',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            transform: `translateY(${(1 - titleIn) * -30}px) scale(${titleIn})`,
            ...outline(12),
          }}
        >
          {title}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
