import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * "Já deu uma ótima resposta, mas não consegue parar de falar": a pessoa (busto, camisa social,
 * gravata) fala sem parar (boca abrindo e fechando). A cada fala, um balão novo nasce da boca e
 * empurra os anteriores para cima (os antigos encolhem, ficam semitransparentes e tortos, numa
 * pilha bagunçada); a pessoa ganha uma gota de suor (até 3) e arregala os olhos. No canto superior
 * direito, um cronômetro corre de `de` até `ate` (m:ss); passando de 2:00 o mostrador fica na cor
 * `accent` e pisca de leve.
 */

type Fala = {texto: string; at?: number};
type Relogio = {de?: number; ate?: number};

const PADRAO: Fala[] = [
  {texto: 'Continua…', at: 0.1},
  {texto: 'E também…', at: 1.2},
  {texto: 'Só complementando…', at: 2.2},
  {texto: 'Mais um ponto…', at: 3.4},
  {texto: 'Tem mais uma coisa…', at: 4.4},
];
const MAX_FALAS = 6;

const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const INK = '#111';
const SKIN = '#F2C9A0';
const SKIN_DARK = '#DCA57C';
const HAIR = '#3A2A20';
const SHIRT = '#DCEBFA';
const SHIRT_DARK = '#9DB9D8';
const MOUTH_FILL = '#8B1E1E';
const TONGUE = '#E5737A';
const SWEAT = '#7CC8F4';
const METAL = '#A3ABB5';

// Pessoa (caixa 940×760): busto embaixo à esquerda, cabeça levemente virada para os balões.
const HEAD = {x: 196, y: 470, r: 94};
const MOUTH = {x: 210, y: 530};
const HAIR_D =
  'M 100 465 C 88 387 134 361 196 361 C 258 361 304 387 292 465 ' +
  'C 286 435 276 413 262 399 C 226 407 170 405 134 393 C 118 411 106 437 100 465 Z';
const SHIRT_D = 'M 30 728 C 34 666 90 630 152 620 L 196 648 L 240 620 C 302 630 358 666 362 728 Z';
const DROP_D = 'M 0 -18 C 5 -9 12 -1 12 7 A 12 12 0 0 1 -12 7 C -12 -1 -5 -9 0 -18 Z';
const GOTAS = [
  {x: 266, y: 428, s: 1.1},
  {x: 128, y: 440, s: 0.95},
  {x: 200, y: 410, s: 0.85},
];

// Balões: ponta do rabicho do balão mais novo (fora do rosto, à direita da boca).
const TIP = {x: 302, y: 544};
const BAL_LEFT = 344; // borda esquerda mínima (caixa girada) — longe do rosto
const BAL_RIGHT = 918; // borda direita máxima (sobra para contorno e sombra)
const BASE_CY = 574; // centro do balão mais novo
const BOX_R = 926;
const BOX_B = 744;
const W_MAX = 560;
const PAD_X = 30;
const PAD_Y = 22;
const RAIO = 22;
const FS_MAX = 44;
const FS_MIN_1LINHA = 36;
const TEXTO_MAX = W_MAX - 2 * PAD_X;
const ROT = [-3, 4, -5, 3, -4, 5];
const JIT = [8, 34, 0, 26, 14, 40];
const STEP_MAX = 80;

// Cronômetro (canto superior direito): mostrador digital à esquerda, relógio de ponteiro à direita.
const DIAL_X = 856;
const DIAL_R = 58;
const TELA_TXT_R = 782; // texto alinhado à direita, antes do relógio
const TELA_W = 144;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Largura estimada (em em) do texto em Montserrat 800, com folga. */
const larguraEm = (s: string): number => {
  let w = 0;
  for (const ch of s.normalize('NFD').replace(/[̀-ͯ]/g, '')) {
    if (ch === ' ') w += 0.28;
    else if (ch === '…') w += 0.92;
    else if ('ijl.,:;!|\'I'.includes(ch)) w += 0.33;
    else if ('frt'.includes(ch)) w += 0.45;
    else if (ch === 'm') w += 1.06;
    else if (ch === 'w') w += 0.94;
    else if (ch === 'M' || ch === 'W') w += 1.08;
    else if (ch >= '0' && ch <= '9') w += 0.7;
    else if (ch !== ch.toLowerCase()) w += 0.8;
    else w += 0.66;
  }
  return Math.max(0.5, w * 1.04);
};

/** Melhor quebra em 2 linhas (a mais equilibrada). */
const quebrar = (t: string): string[] => {
  const palavras = t.split(/\s+/).filter((p) => p !== '');
  if (palavras.length < 2) return [t];
  let melhor: string[] = [t];
  let melhorW = Infinity;
  for (let i = 1; i < palavras.length; i++) {
    const l1 = palavras.slice(0, i).join(' ');
    const l2 = palavras.slice(i).join(' ');
    const w = Math.max(larguraEm(l1), larguraEm(l2));
    if (w < melhorW) {
      melhorW = w;
      melhor = [l1, l2];
    }
  }
  return melhor;
};

const encurtar = (t: string) => (t.length > 70 ? `${t.slice(0, 69).trimEnd()}…` : t);

const segundos = (v: unknown, padrao: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(5999, Math.max(0, v)) : padrao;

/** Balão retangular arredondado com rabicho saindo da borda esquerda (y1 < y2) até (px, py). */
const balaoD = (a: number, b: number, r: number, y1: number, y2: number, px: number, py: number) =>
  `M ${-a + r} ${-b} H ${a - r} A ${r} ${r} 0 0 1 ${a} ${-b + r} V ${b - r} A ${r} ${r} 0 0 1 ${a - r} ${b} ` +
  `H ${-a + r} A ${r} ${r} 0 0 1 ${-a} ${b - r} V ${y2} L ${px} ${py} L ${-a} ${y1} V ${-b + r} ` +
  `A ${r} ${r} 0 0 1 ${-a + r} ${-b} Z`;

/** Fatia do mostrador (0–360°, a partir das 12h, sentido horário). */
const fatia = (deg: number, r: number): string => {
  if (deg < 0.5) return '';
  if (deg > 359.5) return `M 0 ${-r} A ${r} ${r} 0 1 1 0 ${r} A ${r} ${r} 0 1 1 0 ${-r} Z`;
  const rad = (deg * Math.PI) / 180;
  return `M 0 0 L 0 ${-r} A ${r} ${r} 0 ${deg > 180 ? 1 : 0} 1 ${r * Math.sin(rad)} ${-r * Math.cos(rad)} Z`;
};

const Pessoa: React.FC<{boca: number; nervoso: number; gotas: {p: number; y: number}[]; gravata: string}> = ({
  boca,
  nervoso: k,
  gotas,
  gravata,
}) => {
  const mx = MOUTH.x;
  const my = MOUTH.y;
  const bw = 20 + 4 * boca;
  const bocaD =
    `M ${mx - bw} ${my} Q ${mx} ${my - 4 - 3 * boca} ${mx + bw} ${my} ` +
    `Q ${mx} ${my + 8 + 34 * boca} ${mx - bw} ${my} Z`;

  // Olhos arregalam e sobrancelhas sobem (preocupadas) conforme o nervoso aumenta.
  const eyeY = 474 - 2 * k;
  const erx = 14 + 4 * k;
  const ery = 16 + 8 * k;
  const pr = 7.5 - 2 * k;
  const browL = `M 150 ${444 - 4 * k} Q 170 ${434 - 8 * k} 190 ${440 - 16 * k}`;
  const browR = `M 214 ${440 - 16 * k} Q 234 ${434 - 8 * k} 256 ${444 - 4 * k}`;

  return (
    <g>
      {/* pescoço e camisa social */}
      <rect x={170} y={540} width={52} height={112} rx={10} fill={SKIN_DARK} stroke={INK} strokeWidth={6} />
      <path d={SHIRT_D} fill={SHIRT} stroke={INK} strokeWidth={7} strokeLinejoin="round" />
      <path d="M 82 668 Q 92 698 90 726" fill="none" stroke={SHIRT_DARK} strokeWidth={6} strokeLinecap="round" />
      <path d="M 310 668 Q 300 698 302 726" fill="none" stroke={SHIRT_DARK} strokeWidth={6} strokeLinecap="round" />
      <rect x={244} y={678} width={40} height={32} rx={5} fill="none" stroke={SHIRT_DARK} strokeWidth={5} />
      {/* gravata */}
      <path d="M 190 670 L 202 670 L 214 728 L 178 728 Z" fill={gravata} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
      <path d="M 185 646 L 207 646 L 203 672 L 189 672 Z" fill={gravata} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
      {/* colarinho */}
      <path d="M 150 619 L 194 650 L 164 678 Z" fill="#fff" stroke={INK} strokeWidth={5} strokeLinejoin="round" />
      <path d="M 242 619 L 198 650 L 228 678 Z" fill="#fff" stroke={INK} strokeWidth={5} strokeLinejoin="round" />

      {/* orelhas, rosto e cabelo */}
      <ellipse cx={104} cy={488} rx={14} ry={24} fill={SKIN} stroke={INK} strokeWidth={6} />
      <ellipse cx={288} cy={488} rx={12} ry={22} fill={SKIN} stroke={INK} strokeWidth={6} />
      <circle cx={HEAD.x} cy={HEAD.y} r={HEAD.r} fill={SKIN} stroke={INK} strokeWidth={7} />
      <path d={HAIR_D} fill={HAIR} stroke={INK} strokeWidth={6} strokeLinejoin="round" />

      {/* bochechas coradas (nervoso) */}
      <ellipse cx={150} cy={512} rx={18} ry={9} fill="#F19A8A" opacity={0.15 + 0.45 * k} />
      <ellipse cx={258} cy={510} rx={18} ry={9} fill="#F19A8A" opacity={0.15 + 0.45 * k} />

      {/* sobrancelhas */}
      <path d={browL} fill="none" stroke={INK} strokeWidth={8} strokeLinecap="round" />
      <path d={browR} fill="none" stroke={INK} strokeWidth={8} strokeLinecap="round" />

      {/* olhos (olhando para os balões) */}
      {[172, 232].map((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy={eyeY} rx={erx} ry={ery} fill="#fff" stroke={INK} strokeWidth={5} />
          <circle cx={cx + 3} cy={eyeY - 1} r={pr} fill={INK} />
          <circle cx={cx + 5} cy={eyeY - 4} r={2.2} fill="#fff" />
        </g>
      ))}

      {/* nariz */}
      <path
        d="M 214 488 Q 202 504 216 508"
        fill="none"
        stroke={INK}
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* boca falando */}
      <defs>
        <clipPath id="fsf-boca">
          <path d={bocaD} />
        </clipPath>
      </defs>
      <path d={bocaD} fill={MOUTH_FILL} />
      {boca > 0.2 ? (
        <ellipse cx={mx + 4} cy={my + 6 + 14 * boca} rx={12} ry={7} fill={TONGUE} clipPath="url(#fsf-boca)" />
      ) : null}
      <path d={bocaD} fill="none" stroke={INK} strokeWidth={6} strokeLinejoin="round" />

      {/* gotas de suor */}
      {GOTAS.map((g, j) => {
        const p = gotas[j]?.p ?? 0;
        if (p <= 0.001) return null;
        const y = gotas[j]?.y ?? 0;
        return (
          <g key={j} transform={`translate(${g.x} ${g.y + y}) scale(${g.s * p})`} opacity={Math.min(1, p)}>
            <path d={DROP_D} fill={SWEAT} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
            <ellipse cx={-4} cy={4} rx={3} ry={5} fill="#fff" opacity={0.85} />
          </g>
        );
      })}
    </g>
  );
};

const Cronometro: React.FC<{v: number; cy: number; frame: number; accent: string; highlight: string}> = ({
  v,
  cy,
  frame,
  accent,
  highlight,
}) => {
  const seg = Math.max(0, Math.floor(v + 1e-6));
  const txt = `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
  const passou = seg >= 120;
  const cor = passou ? accent : highlight;
  const pisca = passou ? 0.72 + 0.28 * (0.5 + 0.5 * Math.cos(frame * 0.45)) : 1;
  const digFs = Math.min(56, Math.floor(TELA_W / larguraEm(txt)));
  const ang = v * 6; // ponteiro: uma volta a cada 60 s mostrados
  const wedge = fatia(((ang % 360) + 360) % 360, DIAL_R - 7);
  const R = DIAL_R;

  return (
    <g>
      {/* mostrador digital (fundo escuro) */}
      <rect x={616} y={cy - 38} width={200} height={76} rx={22} fill="#1E222B" stroke={INK} strokeWidth={7} />
      <rect x={627} y={cy - 27} width={170} height={54} rx={13} fill="#07080B" />
      <text
        x={TELA_TXT_R}
        y={cy + digFs * 0.35}
        textAnchor="end"
        fontFamily={FONT}
        fontWeight={900}
        fontSize={digFs}
        fill={cor}
        opacity={pisca}
        style={{fontVariantNumeric: 'tabular-nums'}}
      >
        {txt}
      </text>

      {/* cronômetro de ponteiro */}
      <g transform={`translate(${DIAL_X} ${cy})`}>
        <g transform="rotate(45)">
          <rect x={-8} y={-R - 16} width={16} height={20} rx={4} fill={METAL} stroke={INK} strokeWidth={5} />
        </g>
        <rect x={-10} y={-R - 18} width={20} height={22} rx={4} fill={METAL} stroke={INK} strokeWidth={5} />
        <rect x={-18} y={-R - 28} width={36} height={13} rx={6} fill={METAL} stroke={INK} strokeWidth={5} />
        <circle r={R} fill="#fff" stroke={INK} strokeWidth={7} />
        {wedge ? <path d={wedge} fill={cor} opacity={0.5} /> : null}
        {Array.from({length: 12}).map((_, i) => (
          <line
            key={i}
            x1={0}
            y1={-R + 8}
            x2={0}
            y2={-R + (i % 3 === 0 ? 20 : 14)}
            stroke={INK}
            strokeWidth={i % 3 === 0 ? 5 : 3}
            strokeLinecap="round"
            transform={`rotate(${i * 30})`}
          />
        ))}
        <g transform={`rotate(${ang})`}>
          <line x1={0} y1={12} x2={0} y2={-R + 12} stroke={INK} strokeWidth={6} strokeLinecap="round" />
        </g>
        <circle r={8} fill={accent} stroke={INK} strokeWidth={3} />
      </g>
    </g>
  );
};

export const FalaSemFim: React.FC<
  SceneProps & {falas?: Fala[]; relogio?: Relogio | null; label?: string; labelAt?: number}
> = ({falas = PADRAO, relogio = {de: 40, ate: 160}, label = '', labelAt = 5.2, accent, highlight}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // ---- Dados (protegidos contra JSON malformado) ----
  const validas = (Array.isArray(falas) ? falas : []).filter(
    (f) => !!f && typeof f === 'object' && typeof f.texto === 'string' && f.texto.trim() !== '',
  );
  const fonte = (validas.length > 0 ? validas : PADRAO).slice(0, MAX_FALAS);
  const comTempo: {texto: string; at: number; i: number}[] = [];
  let anterior = -0.9; // sem `at`: 0.1 s para a primeira, depois a cada 1.0 s
  fonte.forEach((f, i) => {
    const at = typeof f.at === 'number' && Number.isFinite(f.at) && f.at >= 0 ? f.at : anterior + 1.0;
    anterior = at;
    comTempo.push({texto: encurtar(f.texto.trim()), at, i});
  });
  comTempo.sort((x, y) => x.at - y.at || x.i - y.i);

  const rel =
    relogio === null
      ? null
      : (() => {
          const o: Relogio = relogio && typeof relogio === 'object' ? relogio : {};
          return {de: segundos(o.de, 40), ate: segundos(o.ate, 160)};
        })();

  const labelTxt = typeof label === 'string' ? label.trim() : '';
  const labelFs = labelTxt ? Math.floor(Math.min(80, 860 / (0.72 * labelTxt.length))) : 0;
  const lAt = typeof labelAt === 'number' && Number.isFinite(labelAt) && labelAt >= 0 ? labelAt : 5.2;

  // ---- Layout estático: faixa do label (se houver) → cronômetro → área livre dos balões ----
  const bandH = labelTxt ? Math.round(labelFs * 1.1) + 22 : 0;
  const dialY = bandH + 8 + 96;
  const areaTop = rel ? dialY + DIAL_R + 18 : bandH + 16;

  const baloes = comTempo.map((f, idx) => {
    let linhas = [f.texto];
    let fs = Math.min(FS_MAX, Math.floor(TEXTO_MAX / larguraEm(f.texto)));
    if (fs < FS_MIN_1LINHA) {
      const dois = quebrar(f.texto);
      if (dois.length === 2) {
        const fs2 = Math.min(FS_MAX - 2, Math.floor(TEXTO_MAX / Math.max(larguraEm(dois[0]), larguraEm(dois[1]))));
        if (fs2 > fs) {
          linhas = dois;
          fs = fs2;
        }
      }
    }
    fs = Math.max(1, fs);
    const textoW = Math.max(...linhas.map(larguraEm)) * fs;
    const w = clamp(textoW + 2 * PAD_X, 190, W_MAX);
    const h = Math.max(88, linhas.length * fs * 1.12 + 2 * PAD_Y);
    const rr = (Math.abs(ROT[idx % ROT.length]) * Math.PI) / 180;
    const ex = (w / 2) * Math.cos(rr) + (h / 2) * Math.sin(rr);
    const ey = (w / 2) * Math.sin(rr) + (h / 2) * Math.cos(rr);
    const cx = clamp(BAL_LEFT + JIT[idx % JIT.length] + ex, BAL_LEFT + ex, BAL_RIGHT - ex);
    // overshoot da entrada (escala a partir da ponta do rabicho) sem sair da caixa
    const dir = cx + ex;
    const baixo = BASE_CY + ey;
    const cima = BASE_CY - ey;
    const sMax = Math.max(
      1,
      Math.min(
        1.12,
        (BOX_R - TIP.x) / Math.max(1, dir - TIP.x),
        baixo > TIP.y ? (BOX_B - TIP.y) / (baixo - TIP.y) : Infinity,
        cima < TIP.y ? (TIP.y - areaTop) / (TIP.y - cima) : Infinity,
      ),
    );
    return {at: f.at, atF: Math.round(f.at * fps), linhas, fs, w, h, ey, cx, sMax};
  });
  const n = baloes.length;

  const escala = (d: number) => Math.max(0.62, 1 - 0.08 * d);
  const opac = (d: number) => Math.max(0.42, 1 - 0.18 * d);
  const eyMax = Math.max(...baloes.map((b) => b.ey));
  const passo =
    n > 1 ? clamp((BASE_CY - areaTop - 6 - eyMax * escala(n - 1)) / (n - 1), 20, STEP_MAX) : 0;

  // ---- Animação ----
  const entra = baloes.map((b) => spring({frame: frame - b.atF, fps, config: {damping: 13, stiffness: 190}}));
  const empurra = baloes.map((b) => spring({frame: frame - b.atF, fps, config: {damping: 20, stiffness: 140}}));
  const mostradas = entra.reduce((s, p) => s + clamp(p, 0, 1), 0);
  const nervoso = clamp(mostradas / n, 0, 1);

  // Fala: boca abre e fecha (determinístico) da primeira fala até 1 s depois da última.
  const f0 = baloes[0].atF;
  const fimFala = baloes[n - 1].atF + Math.round(1.0 * fps);
  const env = interpolate(frame, [f0, f0 + 3, fimFala, fimFala + 6], [0, 1, 1, 0], {
    ...CLAMP,
    easing: Easing.inOut(Easing.quad),
  });
  const boca = env * Math.abs(Math.sin(frame * 0.62)) * (0.72 + 0.28 * Math.sin(frame * 0.27 + 1.3));

  // Uma gota de suor a cada fala nova (da 2ª à 4ª), escorrendo devagar.
  const gotas = GOTAS.map((_, j) => {
    const alvo = baloes[j + 1];
    if (!alvo) return {p: 0, y: 0};
    const g0 = alvo.atF + 3;
    const p = spring({frame: frame - g0, fps, config: {damping: 10, stiffness: 200}});
    const y = interpolate(frame, [g0 + 6, g0 + 40], [0, 10], {...CLAMP, easing: Easing.in(Easing.quad)});
    return {p, y};
  });

  // Entrada escalonada: pessoa (0) → cronômetro (+4).
  const personIn = spring({frame, fps, config: {damping: 15, stiffness: 200}});
  const personS = interpolate(personIn, [0, 1], [0.85, 1]);
  const personY = interpolate(personIn, [0, 1], [60, 0]) + Math.sin(frame / 14) * 2 - 3 * boca;
  const personOp = interpolate(personIn, [0, 0.4], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});
  const tremor = Math.sin(frame * 2.1) * 1.5 * nervoso * env;

  const clockIn = spring({frame: frame - 4, fps, config: {damping: 12, stiffness: 180}});
  const clockS = interpolate(clockIn, [0, 1], [0.4, 1]);
  const clockOp = interpolate(clockIn, [0, 0.35], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});

  // Cronômetro corre (com easing) do início até a última fala + 0.6 s.
  const fimRel = Math.max(1, Math.round((baloes[n - 1].at + 0.6) * fps));
  const pRel = interpolate(frame, [0, fimRel], [0, 1], {...CLAMP, easing: Easing.inOut(Easing.quad)});
  const v = rel ? rel.de + (rel.ate - rel.de) * pRel : 0;

  const lF = Math.round(lAt * fps);
  const labelIn = spring({frame: frame - lF, fps, config: {damping: 11, stiffness: 160}});
  const labelOp = interpolate(labelIn, [0, 0.3], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});

  return (
    <AbsoluteFill style={{fontFamily: FONT}}>
      <svg style={{position: 'absolute', inset: 0}} width="100%" height="100%" viewBox="0 0 940 760">
        {/* sombra */}
        <ellipse cx={HEAD.x} cy={732} rx={200 * Math.min(1, personIn)} ry={18} fill="#000" opacity={0.35} />

        {/* pessoa */}
        <g
          opacity={personOp}
          transform={`translate(${tremor} ${personY}) translate(${HEAD.x} 728) scale(${personS}) translate(${-HEAD.x} -728)`}
        >
          <Pessoa boca={boca} nervoso={nervoso} gotas={gotas} gravata={accent} />
        </g>

        {/* cronômetro */}
        {rel ? (
          <g
            opacity={clockOp}
            transform={`translate(${DIAL_X} ${dialY}) scale(${clockS}) translate(${-DIAL_X} ${-dialY})`}
          >
            <Cronometro v={v} cy={dialY} frame={frame} accent={accent} highlight={highlight} />
          </g>
        ) : null}

        {/* pilha de balões (o mais novo por cima, embaixo, com o rabicho na boca) */}
        {baloes.map((b, i) => {
          const pIn = entra[i];
          if (pIn <= 0.001) return null;
          let d = 0;
          for (let j = i + 1; j < n; j++) d += Math.max(0, empurra[j]);
          const dC = Math.min(1, d);
          const sc = escala(d);
          const rot = ROT[i % ROT.length] * (0.55 + 0.45 * dC);
          const cy = BASE_CY - d * passo;
          const sInRaw = interpolate(pIn, [0, 1], [0.3, 1]);
          const sIn = sInRaw > 1 ? Math.min(sInRaw, b.sMax) : sInRaw;
          const op =
            interpolate(pIn, [0, 0.25], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)}) * opac(d);

          // Rabicho: alvo (boca) em coordenadas locais do balão; encurta conforme o balão envelhece.
          const rad = (rot * Math.PI) / 180;
          const dx = TIP.x - b.cx;
          const dy = TIP.y - cy;
          const lx = (dx * Math.cos(rad) + dy * Math.sin(rad)) / sc;
          const ly = (-dx * Math.sin(rad) + dy * Math.cos(rad)) / sc;
          const a = b.w / 2;
          const bb = b.h / 2;
          const hw = interpolate(dC, [0, 1], [14, 10]);
          const lim = Math.max(0, bb - RAIO - hw);
          const yc = clamp(ly, -lim, lim);
          const vx = Math.min(lx + a, -8);
          const vy = ly - yc;
          const L0 = Math.hypot(vx, vy);
          const L = interpolate(dC, [0, 1], [L0, Math.min(L0, 28)]);
          const path = balaoD(a, bb, RAIO, yc - hw, yc + hw, -a + (vx / L0) * L, yc + (vy / L0) * L);

          return (
            <g
              key={i}
              opacity={op}
              transform={`translate(${TIP.x} ${TIP.y}) scale(${sIn}) translate(${-TIP.x} ${-TIP.y})`}
            >
              <g transform={`translate(${b.cx} ${cy}) rotate(${rot}) scale(${sc})`}>
                <path d={path} transform="translate(7 9)" fill="#000" opacity={0.3} />
                <path d={path} fill="#fff" stroke={INK} strokeWidth={7} strokeLinejoin="round" />
                <text fontFamily={FONT} fontWeight={800} fontSize={b.fs} fill={INK} textAnchor="middle">
                  {b.linhas.map((ln, li) => (
                    <tspan key={li} x={0} y={(li - (b.linhas.length - 1) / 2) * b.fs * 1.12 + b.fs * 0.35}>
                      {ln}
                    </tspan>
                  ))}
                </text>
              </g>
            </g>
          );
        })}
      </svg>

      {labelTxt ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 14,
            fontWeight: 900,
            fontSize: labelFs,
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
            color: accent,
            textTransform: 'uppercase',
            textAlign: 'center',
            opacity: labelOp,
            transform: `translateY(${interpolate(labelIn, [0, 1], [-30, 0])}px) scale(${labelIn})`,
            transformOrigin: 'center top',
            ...outline(12),
          }}
        >
          {labelTxt}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
