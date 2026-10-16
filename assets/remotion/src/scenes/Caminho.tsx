import React, {useId} from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * "Explicar todo o percurso × ir direto ao ponto": duas faixas empilhadas em cartões escuros.
 * Em cima, um caminho tortuoso (zigue-zague, laço, idas e vindas, alfinetes de parada) se desenha
 * devagar enquanto uma bolinha o percorre, parando em cada alfinete. Em `retoAt` entra a faixa de
 * baixo: uma seta reta e grossa na cor `highlight` dispara da partida até a bandeira, que dá um pop
 * com selo ✓; logo depois a faixa de cima esmaece. `titulo` opcional no topo.
 */

type Faixa = {rotulo?: string; texto?: string};
type Pt = {x: number; y: number};
/** Ponto de passagem do caminho torto; `s` < 1 deixa a curva mais "quebrada" ali (zigue-zague). */
type Way = Pt & {s?: number};
type Band = {
  y0: number;
  h: number;
  rot: string;
  txt: string;
  rotFs: number;
  fs: number;
  textY: number;
  cy: number;
  sy: number;
  pole: number;
};

const INK = '#111';
const CARD = '#1e2433';
const ROAD = '#2e374b';
const DASH = '#d4dbe6';
const LABEL = '#cbd5e1';
const PIN = '#94a3b8';
const OK = '#22c55e';
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const W = 940;
const H = 760;
const CARD_X = 20;
const CARD_W = 900;
const CARD_CX = CARD_X + CARD_W / 2;
const GAP = 20;
const START_X = CARD_X + 62;
const FLAG_X = CARD_X + CARD_W - 112;
const ARROW_FROM = START_X + 18;
const ARROW_TO = FLAG_X - 10;
const REF_W = 740; // largura do desenho de referência do caminho torto (x de 0 a 740)
const REF_AMP = 64; // |y| máximo do desenho de referência
const STEPS = 14; // amostras por trecho entre pontos de passagem
const SHARP = 0.15;
const PIN_AT = [2, 6, 16, 21, 26]; // índices em WAY onde ficam os alfinetes (paradas)
const PIN_D = 'M 0 0 C -3 -7 -10 -12 -10 -20 A 10 10 0 1 1 10 -20 C 10 -12 3 -7 0 0 Z';
const CHECK_D = 'M -12 1 L -4 10 L 13 -9';
const CHECK_LEN = 38;
const FLAG_COLS = 4;
const FLAG_ROWS = 3;
const FLAG_CW = 13;
const FLAG_CH = 11;

/** Laço tipo montanha-russa: entra por baixo, dá a volta no sentido anti-horário e sai à direita. */
const LOOP: Way[] = Array.from({length: 9}, (_, k) => {
  const f = (k * Math.PI) / 4;
  return {x: 290 + 56 * Math.sin(f) + 7 * f, y: 56 * Math.cos(f)};
});

const WAY: Way[] = [
  {x: 0, y: 0},
  // zigue-zague
  {x: 32, y: -50, s: SHARP},
  {x: 68, y: 44, s: SHARP},
  {x: 104, y: -48, s: SHARP},
  {x: 140, y: 42, s: SHARP},
  {x: 190, y: -35},
  {x: 240, y: 56},
  // laço (índices 7–15)
  ...LOOP,
  // idas e vindas
  {x: 390, y: 42},
  {x: 425, y: -5},
  {x: 405, y: -52},
  {x: 455, y: -64},
  {x: 505, y: -40},
  {x: 515, y: 10},
  {x: 470, y: 45},
  {x: 520, y: 64},
  {x: 580, y: 40},
  {x: 610, y: -20},
  {x: 655, y: -55},
  {x: 700, y: -30},
  {x: 715, y: 15},
  {x: REF_W, y: 0},
];

/** Spline de Hermite pelos pontos de passagem, amostrada em polilinha (comprimento exato e ponto em qualquer distância). */
const REF_PTS: Pt[] = (() => {
  const tan = (i: number): Pt => {
    const a = WAY[Math.max(0, i - 1)];
    const b = WAY[Math.min(WAY.length - 1, i + 1)];
    const s = WAY[i].s ?? 1;
    return {x: ((b.x - a.x) / 2) * s, y: ((b.y - a.y) / 2) * s};
  };
  const out: Pt[] = [{x: WAY[0].x, y: WAY[0].y}];
  for (let i = 0; i < WAY.length - 1; i++) {
    const p0 = WAY[i];
    const p1 = WAY[i + 1];
    const m0 = tan(i);
    const m1 = tan(i + 1);
    for (let k = 1; k <= STEPS; k++) {
      const t = k / STEPS;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      out.push({
        x: h00 * p0.x + h10 * m0.x + h01 * p1.x + h11 * m1.x,
        y: h00 * p0.y + h10 * m0.y + h01 * p1.y + h11 * m1.y,
      });
    }
  }
  return out;
})();

const round1 = (v: number) => Math.round(v * 10) / 10;
const popAt = (x: number, y: number, s: number) =>
  `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${Math.max(0, s).toFixed(3)}) translate(${(-x).toFixed(1)} ${(-y).toFixed(1)})`;

const measure = (pts: Pt[]): number[] => {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return cum;
};

const pointAt = (pts: Pt[], cum: number[], d: number): Pt => {
  const total = cum[cum.length - 1];
  if (d <= 0) return pts[0];
  if (d >= total) return pts[pts.length - 1];
  let i = 1;
  while (cum[i] < d) i++;
  const f = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
  return {x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f};
};

/** Distribui rótulo, desenho e texto dentro do cartão; a fonte do texto encolhe para nunca vazar. */
const layoutBand = (y0: number, h: number, f: Faixa): Band => {
  const rot = (f.rotulo ?? '').trim().toUpperCase();
  const txt = (f.texto ?? '').trim().toUpperCase();
  const rotFs = Math.min(26, Math.floor(600 / (0.8 * Math.max(1, rot.length))));
  const fs = Math.min(64, Math.floor((CARD_W - 64) / (0.76 * Math.max(1, txt.length))));
  const textY = y0 + h - 26;
  const top = y0 + (rot ? 64 : 26);
  const bottom = txt ? textY - fs * 0.74 - 16 : y0 + h - 26;
  const amp = (bottom - top) / 2;
  const shift = Math.min(14, amp * 0.15); // linha um pouco abaixo do meio: bandeira e alfinetes sobem
  return {
    y0,
    h,
    rot,
    txt,
    rotFs,
    fs,
    textY,
    cy: top + amp + shift,
    sy: Math.max(0.5, Math.min(1.1, (amp - shift - 4) / REF_AMP)),
    pole: Math.max(40, Math.min(72, amp + shift - 12)),
  };
};

const Card: React.FC<{b: Band}> = ({b}) => (
  <g>
    <rect x={CARD_X} y={b.y0 + 10} width={CARD_W} height={b.h} rx={34} fill="#000" opacity={0.3} />
    <rect x={CARD_X} y={b.y0} width={CARD_W} height={b.h} rx={34} fill={CARD} stroke={INK} strokeWidth={8} />
  </g>
);

const Rotulo: React.FC<{b: Band; p: number}> = ({b, p}) =>
  b.rot ? (
    <text
      x={CARD_X + 32}
      y={b.y0 + 46}
      fontFamily={FONT}
      fontWeight={800}
      fontSize={b.rotFs}
      letterSpacing={3}
      fill={LABEL}
      opacity={interpolate(p, [0, 0.4], [0, 1], CLAMP)}
      transform={`translate(${((1 - p) * -30).toFixed(1)} 0)`}
    >
      {b.rot}
    </text>
  ) : null;

const Texto: React.FC<{b: Band; color: string; s: number}> = ({b, color, s}) =>
  b.txt ? (
    <text
      x={CARD_CX}
      y={b.textY}
      textAnchor="middle"
      fontFamily={FONT}
      fontWeight={900}
      fontSize={b.fs}
      fill={color}
      stroke="#000"
      strokeWidth={8}
      strokeLinejoin="round"
      paintOrder="stroke"
      opacity={interpolate(s, [0, 0.3], [0, 1], CLAMP)}
      transform={popAt(CARD_CX, b.textY - b.fs * 0.37, s)}
    >
      {b.txt}
    </text>
  ) : null;

const Partida: React.FC<{x: number; y: number; fill: string; s: number}> = ({x, y, fill, s}) => (
  <g transform={`translate(${x} ${y.toFixed(1)}) scale(${Math.max(0, s).toFixed(3)})`}>
    <circle r={17} fill={fill} stroke={INK} strokeWidth={6} />
    <circle r={6} fill={INK} />
  </g>
);

/** Bandeira quadriculada de chegada com a base do mastro em (x, y); o pano balança de leve. */
const Bandeira: React.FC<{x: number; y: number; h: number; t: number; light: string}> = ({x, y, h, t, light}) => {
  const top = y - h;
  const wave = (i: number) => Math.sin(t * 0.2 - i * 1.1) * 2.4 * (i / FLAG_COLS);
  const at = (i: number, r: number) => `${(x + i * FLAG_CW).toFixed(1)} ${(top + r * FLAG_CH + wave(i)).toFixed(1)}`;
  const edgeTop = Array.from({length: FLAG_COLS + 1}, (_, i) => at(i, 0));
  const edgeBottom = Array.from({length: FLAG_COLS + 1}, (_, i) => at(FLAG_COLS - i, FLAG_ROWS));
  const cloth = `M ${[...edgeTop, ...edgeBottom].join(' L ')} Z`;
  return (
    <g>
      <ellipse cx={x} cy={y + 3} rx={18} ry={5} fill="#000" opacity={0.35} />
      <path d={cloth} fill={light} />
      {Array.from({length: FLAG_COLS * FLAG_ROWS}, (_, k) => {
        const c = k % FLAG_COLS;
        const r = Math.floor(k / FLAG_COLS);
        return (c + r) % 2 ? (
          <path key={k} d={`M ${at(c, r)} L ${at(c + 1, r)} L ${at(c + 1, r + 1)} L ${at(c, r + 1)} Z`} fill={INK} />
        ) : null;
      })}
      <path d={cloth} fill="none" stroke={INK} strokeWidth={4} strokeLinejoin="round" />
      <line x1={x} y1={y} x2={x} y2={top - 4} stroke={INK} strokeWidth={11} strokeLinecap="round" />
      <line x1={x} y1={y} x2={x} y2={top - 4} stroke="#e5e7eb" strokeWidth={5} strokeLinecap="round" />
      <circle cx={x} cy={top - 8} r={6} fill={light} stroke={INK} strokeWidth={3} />
    </g>
  );
};

export const Caminho: React.FC<
  SceneProps & {
    titulo?: string;
    torto?: Faixa;
    reto?: Faixa;
    retoAt?: number;
  }
> = ({
  titulo = '',
  torto = {rotulo: 'Júnior', texto: 'Todo o caminho'},
  reto = {rotulo: 'Executivo', texto: 'Onde chegou'},
  retoAt = 2.4,
  accent,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const maskId = `caminho-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const sec = (s: number) => Math.round(s * fps);

  // Layout: título opcional no topo; as duas faixas dividem o resto.
  const title = titulo.trim();
  const top0 = title ? 120 : 14;
  const cardH = (H - 14 - top0 - GAP) / 2;
  const A = layoutBand(top0, cardH, torto);
  const B = layoutBand(top0 + cardH + GAP, cardH, reto);
  const titleFs = Math.min(72, Math.floor(880 / (0.76 * Math.max(1, title.length))));

  // Tempos (frames).
  const t0 = title ? 3 : 0;
  const drawStartF = t0 + sec(0.2);
  const drawEndF = Math.max(drawStartF + sec(0.8), sec(Math.min(2.2, retoAt - 0.2)));
  const retoF = sec(retoAt);
  const growStartF = retoF + sec(0.2);
  const arriveF = retoF + sec(0.6);
  const dimF = retoF + sec(0.8);
  const tA = frame - arriveF;

  // Título.
  const titleIn = spring({frame, fps, config: {damping: 10}});

  // Faixa de cima: entrada escalonada.
  const topIn = spring({frame: frame - t0, fps, config: {damping: 14, stiffness: 170}});
  const topStart = spring({frame: frame - t0 - 3, fps, config: {damping: 10, stiffness: 200}});
  const topRot = spring({frame: frame - t0 - 6, fps, config: {damping: 14}});
  const topFlag = spring({frame: frame - t0 - 9, fps, config: {damping: 10, stiffness: 180}});
  const topTxt = spring({frame: frame - t0 - 12, fps, config: {damping: 11, stiffness: 160}});
  const dim = interpolate(frame, [dimF, dimF + 8], [1, 0.5], {...CLAMP, easing: Easing.out(Easing.quad)});
  const topOp = interpolate(topIn, [0, 0.35], [0, 1], CLAMP) * dim;
  const topMid = A.y0 + A.h / 2;

  // Caminho torto em coordenadas do cartão.
  const sx = (FLAG_X - START_X) / REF_W;
  const pts = REF_PTS.map((p) => ({x: round1(START_X + p.x * sx), y: round1(A.cy + p.y * A.sy)}));
  const cum = measure(pts);
  const total = cum[cum.length - 1];
  const pathD = pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');

  // A bolinha anda de alfinete em alfinete (acelera e freia em cada trecho) e o traço a acompanha.
  const stopFr = [0, ...PIN_AT.map((k) => cum[k * STEPS] / total), 1];
  const stopF = stopFr.map((f) => drawStartF + f * (drawEndF - drawStartF));
  const prog = interpolate(frame, stopF, stopFr, {...CLAMP, easing: Easing.inOut(Easing.cubic)});
  const dist = prog * total;
  const ball = pointAt(pts, cum, dist);
  const ahead = pointAt(pts, cum, dist + 6);
  const behind = pointAt(pts, cum, dist - 6);
  const dl = Math.hypot(ahead.x - behind.x, ahead.y - behind.y) || 1;
  const look = {x: (ahead.x - behind.x) / dl, y: (ahead.y - behind.y) / dl};

  // Faixa de baixo.
  const botIn = spring({frame: frame - retoF, fps, config: {damping: 13, stiffness: 170}});
  const botStart = spring({frame: frame - retoF - 3, fps, config: {damping: 10, stiffness: 200}});
  const botRot = spring({frame: frame - retoF - 6, fps, config: {damping: 14}});
  const botFlag = spring({frame: frame - retoF - 9, fps, config: {damping: 10, stiffness: 180}});
  const botTxt = spring({frame: frame - retoF - 12, fps, config: {damping: 11, stiffness: 160}});
  const botOp = interpolate(botIn, [0, 0.35], [0, 1], CLAMP);
  const botMid = B.y0 + B.h / 2;
  const grow = interpolate(frame, [growStartF, arriveF], [0, 1], {...CLAMP, easing: Easing.inOut(Easing.cubic)});
  const tipX = interpolate(grow, [0, 1], [ARROW_FROM, ARROW_TO], CLAMP);
  const bodyEnd = Math.max(ARROW_FROM, tipX - 30);
  const headS = interpolate(grow, [0, 0.15], [0.4, 1], CLAMP);

  // Chegada: pop da bandeira, estalo, selo ✓, borda acesa e texto pulsando.
  const flagPop = interpolate(tA, [0, 4, 12], [1, 1.35, 1], {...CLAMP, easing: Easing.out(Easing.quad)});
  const txtBump = interpolate(tA, [0, 4, 12], [1, 1.12, 1], {...CLAMP, easing: Easing.out(Easing.quad)});
  const burst = interpolate(tA, [0, 9], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
  const burstOp = interpolate(tA, [0, 3, 12], [0, 1, 0], CLAMP);
  const sealIn = spring({frame: tA - 1, fps, config: {damping: 9, stiffness: 190}});
  const check = interpolate(tA, [5, 11], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});
  const glow = interpolate(tA, [0, 6], [0, 1], CLAMP);
  const clothC = {x: FLAG_X + (FLAG_COLS * FLAG_CW) / 2, y: B.cy - B.pole + (FLAG_ROWS * FLAG_CH) / 2};

  return (
    <AbsoluteFill style={{fontFamily: FONT, alignItems: 'center'}}>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
        <defs>
          {/* revela o caminho torto até a bolinha */}
          <mask id={maskId} maskUnits="userSpaceOnUse" x={-100} y={-100} width={W + 200} height={H + 200}>
            <path
              d={pathD}
              fill="none"
              stroke="#fff"
              strokeWidth={26}
              strokeLinejoin="round"
              strokeLinecap="butt"
              strokeDasharray={`${total.toFixed(2)} ${(total + 50).toFixed(2)}`}
              strokeDashoffset={(total - dist).toFixed(2)}
            />
          </mask>
        </defs>

        {/* ===== faixa de cima: caminho torto ===== */}
        <g
          opacity={topOp}
          transform={`translate(${CARD_CX} ${(topMid + (1 - topIn) * -46).toFixed(1)}) scale(${(0.9 + 0.1 * topIn).toFixed(3)}) translate(${-CARD_CX} ${(-topMid).toFixed(1)})`}
        >
          <Card b={A} />
          <Rotulo b={A} p={topRot} />
          <Texto b={A} color="#fff" s={topTxt} />

          <g mask={`url(#${maskId})`}>
            <path d={pathD} fill="none" stroke={ROAD} strokeWidth={20} strokeLinecap="round" strokeLinejoin="round" />
            <path d={pathD} fill="none" stroke={DASH} strokeWidth={6} strokeDasharray="14 12" strokeLinejoin="round" />
          </g>

          <Partida x={START_X} y={A.cy} fill="#e5e7eb" s={topStart} />
          <g transform={popAt(FLAG_X, A.cy, topFlag)}>
            <Bandeira x={FLAG_X} y={A.cy} h={A.pole} t={frame} light={LABEL} />
          </g>

          {/* alfinetes: aparecem quando a bolinha chega neles */}
          {PIN_AT.map((k, i) => {
            const p = pts[k * STEPS];
            const s = spring({frame: frame - Math.round(stopF[i + 1]) + 1, fps, config: {damping: 8, stiffness: 240}});
            return s > 0.001 ? (
              <g key={k} transform={`translate(${p.x} ${p.y}) scale(${s.toFixed(3)})`}>
                <path d={PIN_D} fill={PIN} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
                <circle cx={0} cy={-20} r={4} fill="#fff" />
              </g>
            ) : null;
          })}

          {/* bolinha com olhinhos olhando para onde vai */}
          <g transform={`translate(${ball.x.toFixed(1)} ${ball.y.toFixed(1)}) scale(${Math.max(0, topStart).toFixed(3)})`}>
            <circle r={13} fill="#f8fafc" stroke={INK} strokeWidth={5} />
            <circle cx={look.x * 4 - 4} cy={look.y * 4 - 2} r={2.4} fill={INK} />
            <circle cx={look.x * 4 + 4} cy={look.y * 4 - 2} r={2.4} fill={INK} />
          </g>
        </g>

        {/* ===== faixa de baixo: caminho reto ===== */}
        {frame >= retoF ? (
          <g
            opacity={botOp}
            transform={`translate(${CARD_CX} ${(botMid + (1 - botIn) * 60).toFixed(1)}) scale(${(0.9 + 0.1 * botIn).toFixed(3)}) translate(${-CARD_CX} ${(-botMid).toFixed(1)})`}
          >
            <Card b={B} />
            {glow > 0 ? (
              <rect
                x={CARD_X + 8}
                y={B.y0 + 8}
                width={CARD_W - 16}
                height={B.h - 16}
                rx={27}
                fill="none"
                stroke={highlight}
                strokeWidth={4}
                opacity={0.75 * glow}
              />
            ) : null}
            <Rotulo b={B} p={botRot} />
            <Texto b={B} color={highlight} s={botTxt * txtBump} />

            {/* seta reta */}
            {frame >= growStartF ? (
              <g>
                <line x1={ARROW_FROM} y1={B.cy} x2={bodyEnd} y2={B.cy} stroke={INK} strokeWidth={32} strokeLinecap="round" />
                <line x1={ARROW_FROM} y1={B.cy} x2={bodyEnd} y2={B.cy} stroke={highlight} strokeWidth={18} strokeLinecap="round" />
                <g transform={`translate(${tipX.toFixed(1)} ${B.cy.toFixed(1)}) scale(${headS.toFixed(3)})`}>
                  <path d="M 0 0 L -40 -27 L -40 27 Z" fill={highlight} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
                </g>
              </g>
            ) : null}

            <Partida x={START_X} y={B.cy} fill="#fff" s={botStart} />
            <g transform={popAt(FLAG_X, B.cy, botFlag * flagPop)}>
              <Bandeira x={FLAG_X} y={B.cy} h={B.pole} t={frame} light="#fff" />
            </g>

            {/* estalo na chegada */}
            {tA >= 0 && tA <= 12 ? (
              <g transform={`translate(${clothC.x.toFixed(1)} ${clothC.y.toFixed(1)})`} opacity={burstOp}>
                {Array.from({length: 8}).map((_, i) => {
                  const a = (i * Math.PI) / 4 + 0.39;
                  const r0 = 36 + 20 * burst;
                  const r1 = 46 + 36 * burst;
                  const d = `M ${(Math.cos(a) * r0).toFixed(1)} ${(Math.sin(a) * r0).toFixed(1)} L ${(Math.cos(a) * r1).toFixed(1)} ${(Math.sin(a) * r1).toFixed(1)}`;
                  return (
                    <g key={i}>
                      <path d={d} stroke={INK} strokeWidth={13} strokeLinecap="round" />
                      <path d={d} stroke={highlight} strokeWidth={6} strokeLinecap="round" />
                    </g>
                  );
                })}
              </g>
            ) : null}

            {/* selo ✓ */}
            {tA >= 1 ? (
              <g
                transform={`translate(${FLAG_X + 54} ${(B.cy - B.pole + 2).toFixed(1)}) rotate(${((1 - sealIn) * -50).toFixed(1)}) scale(${Math.max(0, sealIn).toFixed(3)})`}
              >
                <circle r={27} fill={OK} stroke={INK} strokeWidth={6} />
                {check > 0 ? (
                  <path
                    d={CHECK_D}
                    fill="none"
                    stroke="#fff"
                    strokeWidth={7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={`${CHECK_LEN} ${CHECK_LEN * 2}`}
                    strokeDashoffset={(CHECK_LEN * (1 - check)).toFixed(2)}
                  />
                ) : null}
              </g>
            ) : null}
          </g>
        ) : null}
      </svg>
      {title ? (
        <div
          style={{
            position: 'absolute',
            top: 24,
            left: 0,
            right: 0,
            fontWeight: 900,
            fontSize: titleFs,
            lineHeight: 1,
            color: accent,
            textTransform: 'uppercase',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            transform: `scale(${titleIn})`,
            ...outline(12),
          }}
        >
          {title}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
