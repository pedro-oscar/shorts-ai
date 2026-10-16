import React from 'react';
import {AbsoluteFill, Easing, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * Automação em etapas (Lead → Pesquisa → CRM → WhatsApp). Um pulso percorre as ligações e cada
 * etapa acende ao recebê-lo. Com `quebraEm: k`, a ligação entre a etapa k−1 e a k estoura (✕
 * vermelho) e as etapas seguintes ficam apagadas; sem quebra, um ✓ grande fecha o fluxo.
 */

type Etapa = {emoji?: string; label: string};
type No = {x: number; y: number; r: number; labelAbove: boolean};
type Seg = {ax: number; ay: number; bx: number; by: number; ux: number; uy: number; len: number};

const W = 940;
const H = 760;
const VERDE = '#22c55e';
const CINZA = '#6b7280';
const LINHA = '#4b5563';
const FUNDO_NO = '#1f2937';

// Linha do tempo (frames): o 1º nó acende em INICIO; o pulso leva LIGACAO frames por ligação e
// espera PAUSA frames em cada nó antes de seguir.
const INICIO = 20;
const PAUSA = 4;
const LIGACAO = 10;
const SETA = 30;

const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const SAIDA = Easing.out(Easing.cubic);
const SUAVE = Easing.inOut(Easing.cubic);

const PADRAO: Etapa[] = [
  {emoji: '📩', label: 'Lead'},
  {emoji: '🔎', label: 'Pesquisa'},
  {emoji: '🗂️', label: 'CRM'},
  {emoji: '💬', label: 'WhatsApp'},
];

const rampa = (frame: number, de: number, ate: number, easing = SAIDA) =>
  interpolate(frame, [de, ate], [0, 1], {...CLAMP, easing});

const entraEm = (i: number) => 4 + i * 5;
const partida = (i: number) => INICIO + PAUSA + i * (LIGACAO + PAUSA);
const acendeEm = (i: number) => (i === 0 ? INICIO : partida(i - 1) + LIGACAO);

/** 1–2 etapas: linha; 4: grade 2×2 em "Z"; 3 e 5: zigue-zague (rótulos de cima acima do nó). */
const montarLayout = (n: number, dy: number): No[] => {
  const cima = 290 + dy;
  const baixo = 530 + dy;
  if (n <= 2) {
    const xs = n === 1 ? [470] : n === 2 ? [250, 690] : [];
    return xs.map((x) => ({x, y: 410 + dy, r: 95, labelAbove: false}));
  }
  if (n === 4) {
    return [
      {x: 240, y: cima, r: 90, labelAbove: true},
      {x: 700, y: cima, r: 90, labelAbove: true},
      {x: 240, y: baixo, r: 90, labelAbove: false},
      {x: 700, y: baixo, r: 90, labelAbove: false},
    ];
  }
  const r = n >= 5 ? 80 : 90;
  const margem = n >= 5 ? 120 : 170;
  const passo = (W - 2 * margem) / (n - 1);
  return Array.from({length: n}, (_, i) => ({
    x: margem + i * passo,
    y: i % 2 === 0 ? cima : baixo,
    r,
    labelAbove: i % 2 === 0,
  }));
};

/** Um único tamanho de rótulo para todos os nós (36–42px), o maior que cabe sem encostar. */
const tamanhoLabel = (nos: No[], etapas: Etapa[]): number => {
  let fs = 42;
  nos.forEach((no, i) => {
    let largura = 2 * Math.min(no.x, W - no.x) - 10;
    nos.forEach((o, j) => {
      if (j !== i && o.labelAbove === no.labelAbove && Math.abs(o.y - no.y) < 1) {
        largura = Math.min(largura, Math.abs(o.x - no.x) - 24);
      }
    });
    const chars = Math.max(1, String(etapas[i]?.label ?? '').length);
    fs = Math.min(fs, (largura - 12) / (chars * 0.74));
  });
  return Math.max(36, Math.round(fs));
};

/** Canto do nó (em graus, y para baixo) mais longe das ligações e do rótulo: onde vai o selo ✓/⚠️. */
const CANTOS = [-45, 45, -135, 135];
const distAng = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
const cantoLivre = (nos: No[], i: number): number => {
  const no = nos[i];
  const evitar = [no.labelAbove ? -90 : 90];
  for (const j of [i - 1, i + 1]) {
    if (j >= 0 && j < nos.length) evitar.push((Math.atan2(nos[j].y - no.y, nos[j].x - no.x) * 180) / Math.PI);
  }
  let melhor = CANTOS[0];
  let folga = -1;
  for (const c of CANTOS) {
    const f = Math.min(...evitar.map((e) => distAng(c, e)));
    if (f > folga) {
      folga = f;
      melhor = c;
    }
  }
  return melhor;
};
const noCanto = (no: No, ang: number, dist: number) => ({
  x: no.x + Math.cos((ang * Math.PI) / 180) * dist,
  y: no.y + Math.sin((ang * Math.PI) / 180) * dist,
});

const ligar = (a: No, b: No): Seg => {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / d;
  const uy = (b.y - a.y) / d;
  const ax = a.x + ux * (a.r + 14);
  const ay = a.y + uy * (a.r + 14);
  const bx = b.x - ux * (b.r + 12);
  const by = b.y - uy * (b.r + 12);
  return {ax, ay, bx, by, ux, uy, len: Math.max(1, Math.hypot(bx - ax, by - ay))};
};
const ponto = (s: Seg, f: number) => ({x: s.ax + (s.bx - s.ax) * f, y: s.ay + (s.by - s.ay) * f});
const seta = (s: Seg) => {
  const cx = s.bx - s.ux * SETA;
  const cy = s.by - s.uy * SETA;
  const nx = -s.uy * 21;
  const ny = s.ux * 21;
  return `${s.bx},${s.by} ${cx + nx},${cy + ny} ${cx - nx},${cy - ny}`;
};

/** Linha grossa com contorno preto. */
const traco = (x1: number, y1: number, x2: number, y2: number, cor: string) => (
  <>
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#000" strokeWidth={24} strokeLinecap="round" />
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={cor} strokeWidth={12} strokeLinecap="round" />
  </>
);

/** Selo verde com ✓. */
const selo = (key: string, x: number, y: number, r: number, s: number) => {
  const d = `M ${-r * 0.42} ${r * 0.02} L ${-r * 0.1} ${r * 0.34} L ${r * 0.45} ${-r * 0.3}`;
  return (
    <g key={key} transform={`translate(${x} ${y}) scale(${s})`}>
      <circle r={r} fill={VERDE} stroke="#000" strokeWidth={Math.max(5, r * 0.14)} />
      <path d={d} fill="none" stroke="#000" strokeWidth={r * 0.26 + 8} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#fff" strokeWidth={r * 0.26} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
};

export const Fluxo: React.FC<SceneProps & {title?: string; etapas?: Etapa[]; quebraEm?: number}> = ({
  title = '',
  etapas = PADRAO,
  quebraEm = -1,
  accent,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const lista = etapas.slice(0, 5);
  const n = lista.length;
  const nos = montarLayout(n, title ? 0 : -40);
  const segs = nos.slice(1).map((b, i) => ligar(nos[i], b));
  const cantos = nos.map((_, i) => cantoLivre(nos, i));
  const fs = tamanhoLabel(nos, lista);

  // Quebra: a ligação k−1 → k estoura quando o pulso chega na metade dela.
  const k = Number.isInteger(quebraEm) && quebraEm >= 1 && quebraEm < n ? quebraEm : -1;
  const quebra = k >= 1;
  const tQuebra = quebra ? partida(k - 1) + LIGACAO / 2 : 0;
  const desde = frame - tQuebra;
  const partiu = quebra && desde >= 0;
  const apagar = partiu ? rampa(frame, tQuebra + 4, tQuebra + 14) : 0;

  const vivo = (i: number) => !quebra || i < k;
  const morto = (i: number) => (quebra && i >= k ? apagar : 0);
  const aceso = (i: number) => (vivo(i) ? rampa(frame, acendeEm(i), acendeEm(i) + 6) : 0);
  const pop = (i: number) => spring({frame: frame - entraEm(i), fps, config: {damping: 11, stiffness: 170}});
  const escala = (i: number) => {
    const bump = vivo(i) ? Math.sin(Math.PI * rampa(frame, acendeEm(i), acendeEm(i) + 8)) : 0;
    return pop(i) * (1 + 0.08 * bump);
  };
  const trilha = (i: number) => {
    if (quebra && i > k - 1) return 0;
    const p = rampa(frame, partida(i), partida(i) + LIGACAO, SUAVE);
    return quebra && i === k - 1 ? Math.min(0.5, p) : p;
  };

  const sucesso = !quebra && n > 0;
  const tFim = acendeEm(n - 1) + 6;

  // Tranco da cena inteira no estouro.
  const tremor = partiu ? 1 - rampa(frame, tQuebra, tQuebra + 14) : 0;
  const jx = Math.sin(desde * 2.9) * 9 * tremor;
  const jy = Math.cos(desde * 3.7) * 5 * tremor;

  const tituloIn = spring({frame, fps, config: {damping: 12, stiffness: 180}});
  const sombraIn = spring({frame, fps, config: {damping: 16}});
  const chao = nos.length
    ? Math.max(...nos.map((no) => (no.labelAbove ? no.y + no.r : no.y + no.r + 16 + fs * 1.2))) + 42
    : 700;

  // ✓ grande no fim (sem quebra).
  let fim: React.ReactNode = null;
  if (sucesso && frame >= tFim) {
    const no = nos[n - 1];
    const R = 56;
    const c = noCanto(no, cantos[n - 1], no.r + 14);
    const x = Math.min(W - R - 8, Math.max(R + 8, c.x));
    const y = Math.min(H - R - 8, Math.max(R + 8, c.y));
    const q = rampa(frame, tFim, tFim + 16);
    fim = (
      <g>
        <circle cx={x} cy={y} r={R + 10 + 60 * q} fill="none" stroke={VERDE} strokeWidth={12 * (1 - q) + 1} opacity={1 - q} />
        {selo('fim', x, y, R, spring({frame: frame - tFim, fps, config: {damping: 8, stiffness: 190}}))}
      </g>
    );
  }

  // Estouro: faíscas + ✕ vermelho tremendo + ⚠️ na primeira etapa que não recebeu.
  let estouro: React.ReactNode = null;
  let alerta: React.ReactNode = null;
  if (partiu) {
    const meio = ponto(segs[k - 1], 0.5);
    const q = rampa(frame, tQuebra, tQuebra + 12);
    const xPop = spring({frame: desde - 3, fps, config: {damping: 8, stiffness: 220}});
    const treme = 1 - rampa(frame, tQuebra + 3, tQuebra + 24);
    const tx = Math.sin(desde * 3.1) * 10 * treme;
    const giro = Math.sin(desde * 2.3) * 10 * treme;
    estouro = (
      <g>
        <circle cx={meio.x} cy={meio.y} r={20 + 110 * q} fill="none" stroke={accent} strokeWidth={12 * (1 - q) + 1} opacity={1 - q} />
        {Array.from({length: 8}).map((_, j) => {
          const a = ((j * 45 + 22.5) * Math.PI) / 180;
          const r1 = 22 + 85 * q;
          const r2 = r1 + 34 * (1 - q) + 4;
          return (
            <line
              key={j}
              x1={meio.x + Math.cos(a) * r1}
              y1={meio.y + Math.sin(a) * r1}
              x2={meio.x + Math.cos(a) * r2}
              y2={meio.y + Math.sin(a) * r2}
              stroke={highlight}
              strokeWidth={8}
              strokeLinecap="round"
              opacity={1 - q}
            />
          );
        })}
        {desde >= 3 ? (
          <g transform={`translate(${meio.x + tx} ${meio.y}) rotate(${giro}) scale(${xPop})`}>
            <circle r={56} fill={accent} stroke="#000" strokeWidth={8} />
            <path d="M -21 -21 L 21 21 M 21 -21 L -21 21" stroke="#000" strokeWidth={28} strokeLinecap="round" />
            <path d="M -21 -21 L 21 21 M 21 -21 L -21 21" stroke="#fff" strokeWidth={15} strokeLinecap="round" />
          </g>
        ) : null}
      </g>
    );
    const tAlerta = tQuebra + 12;
    if (frame >= tAlerta) {
      const c = noCanto(nos[k], cantos[k], nos[k].r + 4);
      const aPop = spring({frame: frame - tAlerta, fps, config: {damping: 9, stiffness: 180}});
      alerta = (
        <div
          style={{
            position: 'absolute',
            left: c.x - 40,
            top: c.y - 40,
            width: 80,
            height: 80,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 54,
            lineHeight: 1,
            transform: `scale(${aPop})`,
          }}
        >
          ⚠️
        </div>
      );
    }
  }

  return (
    <AbsoluteFill style={{fontFamily: FONT, transform: `translate(${jx}px, ${jy}px)`}}>
      {/* Base: sombra, ligações e nós */}
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} style={{position: 'absolute', left: 0, top: 0}}>
        <ellipse cx={470} cy={Math.min(chao, H - 30)} rx={360 * sombraIn} ry={26} fill="#000" opacity={0.35} />

        {segs.map((s, i) => {
          const ent = rampa(frame, entraEm(i + 1) + 2, entraEm(i + 1) + 10);
          if (ent <= 0) return null;
          const fCorpo = Math.max(0, 1 - SETA / s.len);
          const fimCorpo = ponto(s, fCorpo);

          if (partiu && i === k - 1) {
            // Ligação partida: as metades se afastam e caem girando em torno de cada nó.
            const sp = spring({frame: desde, fps, config: {damping: 9, stiffness: 160}});
            const meio = ponto(s, 0.5);
            const gap = sp * Math.max(8, Math.min(70, (fCorpo - 0.5) * s.len - 12));
            const lado = s.ux >= 0 ? 1 : -1;
            return (
              <g key={i}>
                <g transform={`rotate(${16 * sp * lado} ${s.ax} ${s.ay})`}>
                  {traco(s.ax, s.ay, meio.x - s.ux * gap, meio.y - s.uy * gap, accent)}
                </g>
                <g transform={`rotate(${-16 * sp * lado} ${s.bx} ${s.by})`} opacity={1 - 0.6 * apagar}>
                  {traco(meio.x + s.ux * gap, meio.y + s.uy * gap, fimCorpo.x, fimCorpo.y, LINHA)}
                  <polygon points={seta(s)} fill={LINHA} stroke="#000" strokeWidth={7} strokeLinejoin="round" />
                </g>
              </g>
            );
          }

          const p = trilha(i);
          const base = ponto(s, ent * fCorpo);
          const luz = ponto(s, Math.min(p, fCorpo));
          return (
            <g key={i} opacity={1 - 0.6 * morto(i)}>
              {traco(s.ax, s.ay, base.x, base.y, LINHA)}
              {p > 0.01 ? (
                <line x1={s.ax} y1={s.ay} x2={luz.x} y2={luz.y} stroke={VERDE} strokeWidth={12} strokeLinecap="round" />
              ) : null}
              <polygon
                points={seta(s)}
                fill={p >= 0.97 ? VERDE : LINHA}
                stroke="#000"
                strokeWidth={7}
                strokeLinejoin="round"
                opacity={interpolate(ent, [0.7, 1], [0, 1], CLAMP)}
              />
            </g>
          );
        })}

        {nos.map((no, i) => {
          if (pop(i) <= 0.001) return null;
          const l = aceso(i);
          return (
            <g key={i} transform={`translate(${no.x} ${no.y}) scale(${escala(i)})`} opacity={1 - 0.6 * morto(i)}>
              <circle r={no.r + 10} fill="none" stroke={VERDE} strokeWidth={14} opacity={0.35 * l} />
              <circle r={no.r} fill={FUNDO_NO} stroke="#000" strokeWidth={8} />
              <circle r={no.r - 9} fill="none" stroke={interpolateColors(l, [0, 1], [CINZA, VERDE])} strokeWidth={10} />
            </g>
          );
        })}

        {nos.map((no, i) => {
          if (!vivo(i) || frame < acendeEm(i)) return null;
          const q = rampa(frame, acendeEm(i), acendeEm(i) + 14);
          if (q >= 1) return null;
          return (
            <circle
              key={`onda${i}`}
              cx={no.x}
              cy={no.y}
              r={no.r + 8 + 50 * q}
              fill="none"
              stroke={VERDE}
              strokeWidth={10 * (1 - q) + 1}
              opacity={1 - q}
            />
          );
        })}
      </svg>

      {/* Emojis e rótulos */}
      {nos.map((no, i) => {
        const e = lista[i];
        const l = aceso(i);
        const m = morto(i);
        const p = pop(i);
        const ly = no.labelAbove ? no.y - no.r - 16 - fs * 0.6 : no.y + no.r + 16 + fs * 0.6;
        return (
          <React.Fragment key={i}>
            <div
              style={{
                position: 'absolute',
                left: no.x - no.r,
                top: no.y - no.r,
                width: no.r * 2,
                height: no.r * 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: e.emoji ? no.r : no.r * 0.85,
                fontWeight: 900,
                color: '#fff',
                lineHeight: 1,
                transform: `scale(${escala(i)})`,
                opacity: (0.7 + 0.3 * l) * (1 - m) + 0.4 * m,
                filter: `grayscale(${1 - l})`,
                ...(e.emoji ? {} : outline(8)),
              }}
            >
              {e.emoji ? e.emoji : i + 1}
            </div>
            <div
              style={{
                position: 'absolute',
                left: no.x - 260,
                width: 520,
                top: ly - fs * 0.6,
                height: fs * 1.2,
                lineHeight: `${fs * 1.2}px`,
                textAlign: 'center',
                fontSize: fs,
                fontWeight: 800,
                color: '#fff',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                opacity: Math.min(1, p) * (1 - 0.6 * m),
                transform: `scale(${p})`,
                ...outline(6),
              }}
            >
              {e.label}
            </div>
          </React.Fragment>
        );
      })}

      {/* Por cima: pulso, selos ✓, estouro ✕ */}
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} style={{position: 'absolute', left: 0, top: 0}}>
        {segs.map((s, i) => {
          const t0 = partida(i);
          if (frame < t0 || frame >= t0 + LIGACAO) return null;
          if (quebra && (i > k - 1 || (i === k - 1 && partiu))) return null;
          const [p2, p1, p0] = [2, 1, 0].map((d) => ponto(s, rampa(frame - d, t0, t0 + LIGACAO, SUAVE)));
          return (
            <g key={`pulso${i}`}>
              <circle cx={p2.x} cy={p2.y} r={8} fill={highlight} opacity={0.35} />
              <circle cx={p1.x} cy={p1.y} r={11} fill={highlight} opacity={0.6} />
              <circle cx={p0.x} cy={p0.y} r={30} fill={highlight} opacity={0.3} />
              <circle cx={p0.x} cy={p0.y} r={16} fill={highlight} stroke="#000" strokeWidth={4} />
            </g>
          );
        })}

        {nos.map((no, i) => {
          if (!vivo(i) || (sucesso && i === n - 1) || frame < acendeEm(i) + 2) return null;
          const c = noCanto(no, cantos[i], no.r + 2);
          return selo(`ok${i}`, c.x, c.y, 26, spring({frame: frame - acendeEm(i) - 2, fps, config: {damping: 9, stiffness: 200}}));
        })}

        {fim}
        {estouro}
      </svg>

      {alerta}

      {title ? (
        <div
          style={{
            position: 'absolute',
            top: 26,
            left: 30,
            right: 30,
            textAlign: 'center',
            fontWeight: 900,
            fontSize: 64,
            lineHeight: 1.15,
            color: '#fff',
            textTransform: 'uppercase',
            transform: `scale(${tituloIn})`,
            ...outline(10),
          }}
        >
          {title}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
