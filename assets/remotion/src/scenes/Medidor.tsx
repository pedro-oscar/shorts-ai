import React from 'react';
import {AbsoluteFill, Easing, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * Medidor de risco (velocímetro semicircular): gomos do verde (seguro) ao vermelho (perigoso), com os
 * níveis rotulados ao redor; o ponteiro avança um nível a cada `passo` frames até `ate`. Se parar no
 * último, gomo e rótulo piscam em vermelho, a agulha treme e surge um ⚠️ (+ o texto `alerta`).
 * Ex.: modos de permissão Ask → Plan → Edits → Auto → Bypass.
 */

const PADRAO = ['Baixo', 'Médio', 'Alto'];
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const SAI = Easing.out(Easing.cubic);

const VERDE = '#22c55e';
const AMARELO = '#facc15';
const ESCURO = '#7a0c0c'; // fase apagada do pisca-pisca
const CORPO = '#1e2433';
const TICK = '#475569';
const AGULHA = '#f8fafc';
const TEXTO = '#e5e7eb';

// Geometria na caixa 940×760
const W = 940;
const H = 760;
const CX = W / 2;
const MARGEM = 30;
const LIM_X = CX - MARGEM; // meia-largura útil a partir do centro
const BORDA = 8; // contorno preto dos gomos
const GAP = 16; // folga entre o arco e os rótulos
const SEP = 10; // folga mínima entre rótulos
const BASE_H = 40; // base reta sob o semicírculo
const R_MAX = 330;
const R_BOM = 270;
const R_MIN = 200;
const FOLGA = 1.1; // o rótulo aceso cresce ~10%
const T0 = 12; // frame em que o ponteiro chega ao nível 0

const rad = (g: number) => (g * Math.PI) / 180;

/** Ângulo (graus; 180 = esquerda, 90 = topo, 0 = direita) do centro do gomo i. */
const angulo = (i: number, n: number) => 180 - ((i + 0.5) * 180) / n;

/** Largura aproximada de um texto em Montserrat 900 (superestima de leve, por segurança). */
const largura = (texto: string, fonte: number) => {
  let em = 0;
  for (const ch of texto) {
    if (/[\s.,:;!|'iljI]/.test(ch)) em += 0.34;
    else if (/[tfr]/.test(ch)) em += 0.47;
    else if (/[mwMW]/.test(ch)) em += 1;
    else if ((ch.codePointAt(0) ?? 0) > 0x2000) em += 1.25; // emoji/símbolo
    else if (ch !== ch.toLowerCase()) em += 0.78;
    else if (ch === 's') em += 0.56;
    else em += 0.66;
  }
  return em * fonte;
};

/** Revela um traço de comprimento `comp` até a fração `t` (desenho com strokeDasharray). */
const tracejado = (comp: number, t: number): React.SVGAttributes<SVGPathElement> =>
  t >= 1 ? {} : {strokeDasharray: `${comp + 2} ${comp + 2}`, strokeDashoffset: (comp + 2) * (1 - t)};

type Rotulo = {a: number; d: number; hw: number; hh: number};
type Layout = {ok: boolean; fonte: number; r: number; topo: number; rotulos: Rotulo[]};

/** Posiciona os rótulos fora do arco (raio r) e diz se tudo cabe na caixa sem sobreposição. */
const montar = (lista: string[], fonte: number, r: number, alturaMax: number): Layout => {
  const n = lista.length;
  const vao = 180 / n;
  const hh = (fonte * 0.56 + 4) * FOLGA;
  const hws = lista.map((t) => (largura(t, fonte) / 2 + 4) * FOLGA);
  const dist = (a: number, hw: number) => r + BORDA + GAP + hw * Math.abs(Math.cos(rad(a))) + hh * Math.sin(rad(a));
  const cabe = (a: number, d: number, hw: number) => Math.abs(Math.cos(rad(a))) * d + hw <= LIM_X;

  // Desvio mínimo (graus, rumo ao topo, até 35% do gomo) para o rótulo caber na largura
  const maxDesvio = Math.floor(vao * 0.35);
  const precisa = lista.map((_, i) => {
    const a0 = angulo(i, n);
    const sentido = a0 > 90 ? -1 : 1;
    for (let s = 0; s <= maxDesvio; s++) {
      const a = a0 + sentido * s;
      if (cabe(a, dist(a, hws[i]), hws[i])) return s;
    }
    return -1;
  });
  let ok = precisa.every((s) => s >= 0);
  const desvio = (s: number) => (s < 0 ? maxDesvio : s);

  // Pares espelhados usam o mesmo desvio (simetria)
  const rotulos: Rotulo[] = lista.map((_, i) => {
    const a0 = angulo(i, n);
    const s = Math.abs(a0 - 90) < 0.01 ? 0 : Math.max(desvio(precisa[i]), desvio(precisa[n - 1 - i]));
    const a = a0 > 90 ? a0 - s : a0 + s;
    return {a, d: dist(a, hws[i]), hw: hws[i], hh};
  });

  // Rótulos que se tocam: o mais alto se afasta do arco (escalonamento)
  const colide = (p: Rotulo, q: Rotulo) =>
    Math.abs(Math.cos(rad(p.a)) * p.d - Math.cos(rad(q.a)) * q.d) < p.hw + q.hw + SEP &&
    Math.abs(Math.sin(rad(p.a)) * p.d - Math.sin(rad(q.a)) * q.d) < p.hh + q.hh + SEP;
  for (let volta = 0; volta < 200; volta++) {
    let mexeu = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const p = rotulos[i];
        const q = rotulos[j];
        if (colide(p, q)) {
          (Math.sin(rad(p.a)) >= Math.sin(rad(q.a)) ? p : q).d += 4;
          mexeu = true;
        }
      }
    }
    if (!mexeu) break;
    if (volta === 199) ok = false;
  }

  if (!rotulos.every((k) => cabe(k.a, k.d, k.hw))) ok = false;
  const topo = Math.max(r + BORDA + 6, ...rotulos.map((k) => Math.sin(rad(k.a)) * k.d + k.hh));
  if (topo > alturaMax) ok = false;
  return {ok, fonte, r, topo, rotulos};
};

/** Maior fonte (≥ 38) e maior raio (até 330) em que todos os rótulos cabem sem se tocar. */
const planejar = (lista: string[], alturaMax: number): Layout => {
  const n = lista.length;
  const base = n <= 3 ? 50 : n === 4 ? 46 : n === 5 ? 44 : 40;
  let melhor: Layout | null = null;
  for (let fonte = base; fonte >= 30; fonte -= 2) {
    for (let r = R_MAX; r >= R_MIN; r -= 5) {
      const l = montar(lista, fonte, r, alturaMax);
      if (!l.ok) continue;
      if (r >= R_BOM) return l;
      if (!melhor || r > melhor.r) melhor = l;
      break;
    }
    if (melhor && fonte <= 38) return melhor;
  }
  return melhor ?? montar(lista, 30, R_MIN, alturaMax);
};

export const Medidor: React.FC<
  SceneProps & {title?: string; niveis?: string[]; ate?: number; passo?: number; alerta?: string}
> = ({title = '', niveis = PADRAO, ate, passo = 18, alerta = '', accent, highlight}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // Dados (protegidos contra valores inválidos)
  const lista = React.useMemo(() => {
    const limpa = (Array.isArray(niveis) ? niveis : [])
      .map((t) => (typeof t === 'string' ? t.trim() : ''))
      .filter((t) => t !== '')
      .slice(0, 6);
    return limpa.length >= 2 ? limpa : PADRAO;
  }, [niveis]);
  const n = lista.length;
  const fim =
    typeof ate === 'number' && Number.isFinite(ate) ? Math.max(0, Math.min(n - 1, Math.round(ate))) : n - 1;
  const intervalo = typeof passo === 'number' && Number.isFinite(passo) && passo > 0 ? Math.max(4, passo) : 18;
  const ultimo = fim === n - 1;
  const titulo = typeof title === 'string' ? title.trim() : '';
  const textoAlerta = ultimo && typeof alerta === 'string' ? alerta.trim() : '';

  // Título (encolhe se for longo) e texto de alerta
  const temTitulo = titulo !== '';
  const tituloEm = Math.max(1, largura(titulo.toUpperCase(), 1));
  const tituloFonte = Math.max(40, Math.min(68, Math.floor(860 / tituloEm)));
  const tituloLinhas = tituloEm * tituloFonte > W - 2 * MARGEM ? 2 : 1;
  const topoLivre = temTitulo ? 14 + tituloLinhas * tituloFonte * 1.05 + 22 : MARGEM;
  const alertaEm = Math.max(1, largura(textoAlerta.toUpperCase(), 1));
  const alertaFonte = Math.max(36, Math.min(60, Math.floor(820 / alertaEm)));
  const alertaLinhas = alertaEm * alertaFonte > W - 2 * MARGEM ? 2 : 1;
  const baixo = textoAlerta ? BASE_H + 18 + alertaLinhas * alertaFonte * 1.15 + 8 : BASE_H + 40;
  const alturaMax = H - MARGEM - topoLivre - baixo;

  // Layout: raio e fonte dos rótulos escolhidos para caber; centro vertical equilibrado
  const layout = React.useMemo(() => planejar(lista, alturaMax), [lista, alturaMax]);
  const {r, fonte, rotulos} = layout;
  const cy = topoLivre + layout.topo + Math.max(0, alturaMax - layout.topo) / 2;
  const yBase = cy + BASE_H;

  const vao = 180 / n;
  const th = Math.round(r * 0.27); // espessura dos gomos
  const rm = r - th / 2; // linha central dos gomos
  const rFace = r - th - BORDA; // borda interna (face escura)
  const ext = (BORDA / rm) * (180 / Math.PI); // contorno preto passa um pouco das pontas
  const pino = Math.max(26, r * 0.12);
  const lAgulha = r - th * 0.68;
  const wAgulha = Math.max(12, r * 0.05);
  const cauda = lAgulha * 0.2;

  const ponto = (a: number, raio: number): [number, number] => [
    CX + Math.cos(rad(a)) * raio,
    cy - Math.sin(rad(a)) * raio,
  ];
  const arco = (a0: number, a1: number, raio: number) => {
    const [x0, y0] = ponto(a0, raio);
    const [x1, y1] = ponto(a1, raio);
    return `M ${x0} ${y0} A ${raio} ${raio} 0 0 1 ${x1} ${y1}`;
  };
  const cores = lista.map((_, i) => interpolateColors(i / (n - 1), [0, 0.5, 1], [VERDE, AMARELO, accent]));

  // Entrada (f0–12): corpo cresce, arco se desenha, título e rótulos entram
  const entra = spring({frame, fps, config: {damping: 14, stiffness: 160}});
  const desenho = interpolate(frame, [0, 12], [0, 1], {...CLAMP, easing: SAI});
  const tituloIn = spring({frame: frame - 1, fps, config: {damping: 10, stiffness: 140}});

  // Ponteiro: nível 0 em ~f12, depois um gomo a cada `intervalo` frames (mola com leve overshoot)
  const chegada = (k: number) => T0 + k * intervalo;
  const mola = (inicio: number) => spring({frame: frame - inicio, fps, config: {damping: 13, stiffness: 170, mass: 0.7}});
  let angAgulha = 180 + (angulo(0, n) - 180) * mola(5);
  for (let k = 1; k <= fim; k++) angAgulha -= vao * mola(chegada(k) - 5);

  // Gomo/rótulo aceso = nível atual do ponteiro
  const acende = (k: number) => (k === 0 ? T0 - 4 : chegada(k) - 1);
  const rampa = (t: number) => interpolate(frame, [t, t + 6], [0, 1], {...CLAMP, easing: SAI});
  const aceso = lista.map((_, k) => (k > fim ? 0 : rampa(acende(k)) - (k < fim ? rampa(acende(k + 1)) : 0)));

  // Alerta (só se parar no último nível): pisca, agulha treme, ⚠️ e texto
  const tAlerta = chegada(fim);
  const alertaIn = ultimo ? interpolate(frame, [tAlerta, tAlerta + 8], [0, 1], {...CLAMP, easing: SAI}) : 0;
  const pisca = ultimo ? 0.5 + 0.5 * Math.cos(Math.max(0, frame - tAlerta) * 0.5) : 0;
  const pulso = alertaIn * pisca;
  const tremor = alertaIn * (Math.sin(frame * 2.7) * 1.6 + Math.sin(frame * 4.3) * 0.8);
  const avisoIn = ultimo ? spring({frame: frame - tAlerta - 2, fps, config: {damping: 12, stiffness: 180}}) : 0;
  const textoIn = textoAlerta ? spring({frame: frame - tAlerta - 6, fps, config: {damping: 10, stiffness: 150}}) : 0;

  // ⚠️ na face, entre o topo e a esquerda (longe da agulha parada no último gomo)
  const [tx, ty] = ponto((180 + angulo(n - 1, n)) / 2, rFace * 0.52);
  const lado = rFace * 0.66;
  const triangulo = `M 0 ${-0.577 * lado} L ${0.5 * lado} ${0.289 * lado} L ${-0.5 * lado} ${0.289 * lado} Z`;

  const rb = r + BORDA - 4;
  const rc = 16;
  const corpo = `M ${CX - rb} ${yBase - rc} L ${CX - rb} ${cy} A ${rb} ${rb} 0 0 1 ${CX + rb} ${cy} L ${CX + rb} ${yBase - rc} Q ${CX + rb} ${yBase} ${CX + rb - rc} ${yBase} L ${CX - rb + rc} ${yBase} Q ${CX - rb} ${yBase} ${CX - rb} ${yBase - rc} Z`;
  const agulha = [
    [-cauda, -wAgulha * 0.7],
    [0, -wAgulha],
    [lAgulha, -3],
    [lAgulha, 3],
    [0, wAgulha],
    [-cauda, wAgulha * 0.7],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(' ');
  const giro = -(angAgulha + tremor);

  // Gomos acesos por cima dos demais
  const ordem = lista.map((_, i) => i).sort((a, b) => aceso[a] - aceso[b] || a - b);

  return (
    <AbsoluteFill style={{fontFamily: FONT}}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{position: 'absolute', inset: 0, overflow: 'visible'}}
      >
        {/* Sombra elíptica */}
        <ellipse
          cx={CX}
          cy={yBase + 14}
          rx={(r + 40) * interpolate(entra, [0, 1], [0.5, 1])}
          ry={24}
          fill="#000"
          opacity={0.35 * Math.min(1, entra)}
        />

        <g transform={`translate(${CX} ${cy}) scale(${entra}) translate(${-CX} ${-cy})`}>
          {/* Corpo: face semicircular + base */}
          <path d={corpo} fill={CORPO} stroke="#000" strokeWidth={8} strokeLinejoin="round" />
          {pulso > 0.01 ? (
            <path
              d={`M ${CX - rFace} ${cy} A ${rFace} ${rFace} 0 0 1 ${CX + rFace} ${cy} Z`}
              fill={accent}
              opacity={0.14 * pulso}
            />
          ) : null}

          {/* Marcas na face */}
          <g opacity={desenho}>
            {lista.map((_, i) => {
              const [x0, y0] = ponto(angulo(i, n), rFace - 22);
              const [x1, y1] = ponto(angulo(i, n), rFace - 8);
              return <line key={`c${i}`} x1={x0} y1={y0} x2={x1} y2={y1} stroke={TICK} strokeWidth={4} strokeLinecap="round" />;
            })}
            {lista.slice(1).map((_, j) => {
              const a = 180 - (j + 1) * vao;
              const [x0, y0] = ponto(a, rFace - 30);
              const [x1, y1] = ponto(a, rFace - 8);
              return <line key={`b${j}`} x1={x0} y1={y0} x2={x1} y2={y1} stroke={TICK} strokeWidth={7} strokeLinecap="round" />;
            })}
          </g>

          {/* Luz do nível atual: feixe do pino até o gomo + anel externo */}
          {lista.map((_, i) => {
            const extra = i === n - 1 ? pulso : 0;
            if (aceso[i] < 0.01 && extra < 0.01) return null;
            const a0 = 180 - i * vao;
            const a1 = a0 - vao;
            const [x0, y0] = ponto(a0, r - th);
            const [x1, y1] = ponto(a1, r - th);
            return (
              <g key={i}>
                <path
                  d={`M ${CX} ${cy} L ${x0} ${y0} A ${r - th} ${r - th} 0 0 1 ${x1} ${y1} Z`}
                  fill={cores[i]}
                  opacity={0.18 * aceso[i] + 0.2 * extra}
                />
                <path
                  d={arco(a0, a1, r + BORDA + 8)}
                  fill="none"
                  stroke={cores[i]}
                  strokeWidth={14}
                  opacity={0.35 * aceso[i] + 0.35 * extra}
                />
              </g>
            );
          })}

          {/* Gomos (desenhados com strokeDasharray) */}
          {ordem.map((i) => {
            const local = interpolate(desenho * n - i, [0, 1], [0, 1], CLAMP);
            if (local <= 0.001) return null;
            const a0 = 180 - i * vao;
            const a1 = a0 - vao;
            const [mx, my] = ponto(a0 - vao / 2, rm);
            const ac = aceso[i];
            const alarme = i === n - 1 ? pulso : 0;
            const esc = 1 + 0.1 * ac + 0.06 * alarme;
            const cor =
              i === n - 1 && alertaIn > 0
                ? interpolateColors(alertaIn * (1 - pisca), [0, 1], [cores[i], ESCURO])
                : cores[i];
            const branco = Math.min(0.5, 0.18 * ac + 0.25 * alarme);
            const rBrilho = r - th * 0.22;
            return (
              <g key={i} transform={`translate(${mx} ${my}) scale(${esc}) translate(${-mx} ${-my})`}>
                <path
                  d={arco(a0 + ext, a1 - ext, rm)}
                  fill="none"
                  stroke="#000"
                  strokeWidth={th + 2 * BORDA}
                  {...tracejado(rm * rad(vao + 2 * ext), local)}
                />
                <path d={arco(a0, a1, rm)} fill="none" stroke={cor} strokeWidth={th} {...tracejado(rm * rad(vao), local)} />
                {branco > 0.01 ? (
                  <path d={arco(a0, a1, rm)} fill="none" stroke="#fff" strokeWidth={th} opacity={branco} />
                ) : null}
                <path
                  d={arco(a0 - vao * 0.14, a1 + vao * 0.14, rBrilho)}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={Math.max(5, th * 0.12)}
                  strokeLinecap="round"
                  opacity={0.3 + 0.2 * ac}
                  {...tracejado(rBrilho * rad(vao * 0.72), local)}
                />
              </g>
            );
          })}

          {/* ⚠️ grande na face */}
          {ultimo && avisoIn > 0.001 ? (
            <g
              transform={`translate(${tx} ${ty}) rotate(${Math.sin(frame * 0.35) * 4 * alertaIn}) scale(${
                interpolate(avisoIn, [0, 1], [0.3, 1]) * (1 + 0.07 * pisca)
              })`}
              opacity={interpolate(avisoIn, [0, 0.3], [0, 1], CLAMP)}
            >
              <circle r={lado * 0.62} fill={accent} opacity={0.15 + 0.3 * pisca} />
              <path d={triangulo} fill={highlight} stroke="#000" strokeWidth={10} strokeLinejoin="round" />
              <line
                x1={0}
                y1={-lado * 0.3}
                x2={0}
                y2={lado * 0.02}
                stroke="#000"
                strokeWidth={lado * 0.1}
                strokeLinecap="round"
              />
              <circle cx={0} cy={lado * 0.16} r={lado * 0.065} fill="#000" />
            </g>
          ) : null}

          {/* Agulha (sombra, corpo com contorno, faixa) e pino */}
          <g transform={`translate(${CX + 5} ${cy + 7}) rotate(${giro})`}>
            <polygon points={agulha} fill="#000" opacity={0.3} />
          </g>
          <g transform={`translate(${CX} ${cy}) rotate(${giro})`}>
            <polygon points={agulha} fill={AGULHA} stroke="#000" strokeWidth={8} strokeLinejoin="round" />
            <line x1={pino + 6} y1={0} x2={lAgulha - 26} y2={0} stroke={accent} strokeWidth={5} strokeLinecap="round" />
          </g>
          <circle cx={CX} cy={cy} r={pino} fill={accent} stroke="#000" strokeWidth={8} />
          <circle cx={CX - pino * 0.28} cy={cy - pino * 0.28} r={pino * 0.3} fill="#fff" opacity={0.55} />
        </g>
      </svg>

      {/* Rótulos dos níveis */}
      {rotulos.map((k, i) => {
        const ent = spring({frame: frame - (5 + i * 4), fps, config: {damping: 12, stiffness: 150}});
        const ac = aceso[i];
        const alarme = i === n - 1 ? pulso : 0;
        const esc = interpolate(ent, [0, 1], [0.3, 1]) * (1 + 0.1 * ac + 0.05 * alarme);
        const cos = Math.cos(rad(k.a));
        const sin = Math.sin(rad(k.a));
        const recua = (1 - Math.min(1, ent)) * 30;
        const brilho = Math.max(ac, alarme);
        const cor = interpolateColors(alarme, [0, 1], [interpolateColors(ac, [0, 1], [TEXTO, '#ffffff']), accent]);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: CX + cos * k.d,
              top: cy - sin * k.d,
              transform: `translate(-50%, -50%) translate(${-cos * recua}px, ${sin * recua}px) scale(${esc})`,
              opacity: interpolate(ent, [0, 0.4], [0, 1], CLAMP),
              whiteSpace: 'nowrap',
              fontWeight: 900,
              fontSize: fonte,
              lineHeight: 1.1,
              color: cor,
              textShadow:
                brilho > 0.01
                  ? `0 0 ${Math.round(26 * brilho)}px ${cores[i]}, 0 0 ${Math.round(10 * brilho)}px ${cores[i]}`
                  : 'none',
              ...outline(8),
            }}
          >
            {lista[i]}
          </div>
        );
      })}

      {/* Texto de alerta */}
      {textoAlerta ? (
        <div
          style={{
            position: 'absolute',
            left: MARGEM,
            right: MARGEM,
            top: yBase + 18,
            textAlign: 'center',
            fontWeight: 900,
            fontSize: alertaFonte,
            lineHeight: 1.15,
            color: accent,
            textTransform: 'uppercase',
            opacity: interpolate(textoIn, [0, 0.3], [0, 1], CLAMP),
            transform: `scale(${interpolate(textoIn, [0, 1], [0.4, 1]) * (1 + 0.04 * pulso)}) rotate(-3deg)`,
            ...outline(10),
          }}
        >
          {textoAlerta}
        </div>
      ) : null}

      {/* Título */}
      {temTitulo ? (
        <div
          style={{
            position: 'absolute',
            top: 14,
            left: 0,
            right: 0,
            padding: `0 ${MARGEM}px`,
            fontWeight: 900,
            fontSize: tituloFonte,
            lineHeight: 1.05,
            color: highlight,
            textTransform: 'uppercase',
            textAlign: 'center',
            transform: `scale(${tituloIn})`,
            ...outline(10),
          }}
        >
          {titulo}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
