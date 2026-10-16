import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * "Mod" do Claude Code que divide o terminal ao meio: à esquerda o terminal trabalhando (linhas de
 * código estilizadas rolando, cursor piscando); à direita um painel "Aprenda" (≈ 40% da largura)
 * desliza para dentro e recebe cartões de dica, um a um ("React: monta a tela").
 */

const PADRAO = ['HTML: a estrutura', 'CSS: o visual', 'JS: a interação'];
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const TINTA = '#111827';
const TERMINAL = '#0f172a';
const PAINEL = '#1e293b';
const BARRA = '#273449';
const CORES_CODIGO = ['#38bdf8', '#4ade80', '#64748b'];

/** Geometria na caixa 940×760 (o interior da janela desconta a borda). */
const WIN = {x: 40, w: 860, h: 600, borda: 8, raio: 30};
const BAR_H = 54;
const BAR_LINHA = 5;
const INNER_W = WIN.w - 2 * WIN.borda; // 844
const INNER_H = WIN.h - 2 * WIN.borda; // 584
const CORPO_H = INNER_H - BAR_H - BAR_LINHA; // 525
const DIV_W = 6;
const DIV_X = Math.round(INNER_W * 0.58); // posição final da divisória: painel com ≈ 40% da largura
const PAINEL_W = INNER_W - DIV_X - DIV_W; // 348
const PAINEL_PAD = 14;
const CABECALHO_H = 70;
const CARD_W = PAINEL_W - 2 * PAINEL_PAD; // 320
const CARD_BORDA = 5;
const CARD_PAD = {x: 14, y: 8};
const CARD_GAP = 10;
const CARD_EXTRA = 2 * CARD_PAD.y + 2 * CARD_BORDA;
const TEXTO_W = CARD_W - 2 * CARD_BORDA - 2 * CARD_PAD.x; // 282
const TEXTO_EST = TEXTO_W - 8; // folga na estimativa de largura
const CARDS_H = CORPO_H - CABECALHO_H - PAINEL_PAD; // altura disponível para os cartões
const LH = 1.1;
const FS_MAX = 42;
const FS_MIN = 30;
const PESO_ROTULO = 1.05; // rótulo em 900 é um pouco mais largo

/** Terminal: linhas de "código" (barrinhas). */
const COD_X = 34;
const COD_TOPO = 26;
const COD_LINHA = 36;
const COD_BARRA = 16;
const COD_GAP = 12;
const RECUO = 32;
const COD_MAX_W = DIV_X - COD_X - 34; // nunca passa da divisória
const CABE_SEM_ROLAR = Math.floor((CORPO_H - 40 - COD_TOPO - COD_BARRA) / COD_LINHA) + 1;
const RECUOS = [0, 1, 1, 2, 2, 3, 2, 1, 0, 1, 2, 2, 1, 0];
const MAX_LINHAS = 90;
const DIGITA = 5; // frames para "digitar" uma linha

/** Tempos (30 fps). */
const JANELA_AT = 2;
const SPLIT_AT = 16;
const CARD0 = 30;
const CARD_STEP = 16;

/** Linhas chegam em rajadas de 3 (a cada 4 frames), com pausa: dá tempo de o cursor piscar. */
const inicioLinha = (i: number) => 8 + Math.floor(i / 3) * 20 + (i % 3) * 4;
const cardAt = (i: number) => CARD0 + i * CARD_STEP;

/** Pseudoaleatório determinístico em [0, 1). */
const rnd = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

type Linha = {recuo: number; segs: {w: number; cor: string}[]; total: number};

const codigo = (i: number): Linha => {
  if (i % 7 === 6) return {recuo: 0, segs: [], total: 0}; // linha em branco
  const recuo = RECUOS[i % RECUOS.length];
  const n = 1 + Math.floor(rnd(i * 3 + 1) * 3);
  const brutos = Array.from({length: n}, (_, k) => ({
    w: 46 + Math.round(rnd(i * 7 + k * 13 + 2) * 124),
    cor: CORES_CODIGO[Math.floor(rnd(i * 5 + k * 11 + 3) * CORES_CODIGO.length)],
  }));
  const gaps = (n - 1) * COD_GAP;
  const max = COD_MAX_W - recuo * RECUO - gaps;
  const soma = brutos.reduce((a, s) => a + s.w, 0);
  const fator = soma > max ? max / soma : 1;
  const segs = brutos.map((s) => ({w: Math.floor(s.w * fator), cor: s.cor}));
  return {recuo, segs, total: segs.reduce((a, s) => a + s.w, 0) + gaps};
};

type Dica = {rotulo: string; texto: string};

/** "React: monta a tela" → rótulo "React" + texto "monta a tela" (sem dois-pontos: só texto). */
const separa = (s: string): Dica => {
  const limpo = s.replace(/^💡\s*/u, '').trim();
  const i = limpo.indexOf(':');
  if (i <= 0) return {rotulo: '', texto: limpo};
  return {rotulo: limpo.slice(0, i).trim(), texto: limpo.slice(i + 1).trim()};
};

/** Largura aproximada (em em) de cada caractere em Montserrat 800, com folga. */
const emDe = (ch: string): number => {
  if (ch === ' ') return 0.28;
  if (/[mwMW]/.test(ch)) return 0.96;
  if (/[0-9]/.test(ch)) return 0.66;
  if (/\p{Lu}/u.test(ch)) return 0.78;
  if (/[ijlrtf.,:;'!|]/.test(ch)) return 0.4;
  if (/\p{Ll}/u.test(ch)) return 0.64;
  return 1.15; // emoji e símbolos
};

const largura = (s: string, px: number) => Array.from(s).reduce((a, ch) => a + emDe(ch), 0) * px;

/** Linhas que o texto ocupa no cartão (quebra por palavra) e a largura da maior palavra. */
const quebra = (texto: string, px: number): {linhas: number; maior: number} => {
  const palavras = texto.split(/\s+/).filter((p) => p !== '');
  const espaco = emDe(' ') * px;
  let linhas = palavras.length > 0 ? 1 : 0;
  let atual = 0;
  let maior = 0;
  for (const p of palavras) {
    const w = largura(p, px);
    maior = Math.max(maior, w);
    if (atual > 0 && atual + espaco + w > TEXTO_EST) {
      linhas += 1;
      atual = 0;
    }
    atual += (atual > 0 ? espaco : 0) + w;
  }
  return {linhas, maior};
};

const mede = (dicas: Dica[], fs: number): {linhas: number; cabe: boolean} => {
  let linhas = 0;
  let altura = (dicas.length - 1) * CARD_GAP;
  let cabe = true;
  for (const d of dicas) {
    const r = quebra(d.rotulo, fs * PESO_ROTULO);
    const t = quebra(d.texto, fs);
    if (r.maior > TEXTO_EST || t.maior > TEXTO_EST) cabe = false;
    linhas += r.linhas + t.linhas;
    altura += (r.linhas + t.linhas) * fs * LH + CARD_EXTRA;
  }
  return {linhas, cabe: cabe && altura <= CARDS_H};
};

/** Maior fonte que cabe no painel; aceita encolher até 4px se isso evitar quebrar linha. */
const escolheFonte = (dicas: Dica[]): number => {
  const cabem: {fs: number; linhas: number}[] = [];
  for (let fs = FS_MAX; fs >= FS_MIN; fs--) {
    const m = mede(dicas, fs);
    if (m.cabe) cabem.push({fs, linhas: m.linhas});
  }
  if (cabem.length === 0) return FS_MIN;
  const topo = cabem[0];
  return cabem.filter((c) => c.fs >= topo.fs - 4).reduce((a, c) => (c.linhas < a.linhas ? c : a), topo).fs;
};

export const PainelLateral: React.FC<SceneProps & {title?: string; dicas?: string[]}> = ({
  title = '',
  dicas = PADRAO,
  accent,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const titulo = typeof title === 'string' ? title.trim() : '';
  const entrada: string[] = Array.isArray(dicas) ? dicas : [];
  const validas = entrada
    .filter((d): d is string => typeof d === 'string')
    .map(separa)
    .filter((d) => d.rotulo !== '' || d.texto !== '');
  const lista = (validas.length > 0 ? validas : PADRAO.map(separa)).slice(0, 4);
  const fs = escolheFonte(lista);

  // Título (f0–8)
  const tituloIn = spring({frame, fps, config: {damping: 11, stiffness: 180}});
  // Uma linha só (a janela começa logo abaixo): Montserrat 900 em caixa alta ≈ 0,8 em por letra
  const tituloFonte = Math.max(34, Math.min(68, Math.floor(880 / (Math.max(1, Array.from(titulo).length) * 0.82))));

  // Janela (f2–12)
  const winTop = titulo ? 106 : 72;
  const entra = spring({frame: frame - JANELA_AT, fps, config: {damping: 18, stiffness: 200}});
  const sobe = interpolate(entra, [0, 1], [300, 0]);
  const aparece = interpolate(entra, [0, 0.3], [0, 1], CLAMP);

  // Divisória (f16–30) + botão "dividir" da barra que acende logo antes
  const split = spring({frame: frame - SPLIT_AT, fps, config: {damping: 16, stiffness: 120}});
  const divX = interpolate(split, [0, 1], [INNER_W, DIV_X]);
  const ligado = interpolate(frame, [SPLIT_AT - 2, SPLIT_AT + 3], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});
  const clique = interpolate(frame, [SPLIT_AT - 5, SPLIT_AT - 1, SPLIT_AT + 5], [1, 0.78, 1], {
    ...CLAMP,
    easing: Easing.inOut(Easing.quad),
  });

  // Lâmpada do cabeçalho: entra com o painel e pulsa a cada cartão novo
  const lampada = spring({frame: frame - (SPLIT_AT + 8), fps, config: {damping: 9, stiffness: 200}});
  const pulso = lista.reduce(
    (a, _, i) =>
      a +
      interpolate(frame, [cardAt(i), cardAt(i) + 4, cardAt(i) + 12], [0, 1, 0], {
        ...CLAMP,
        easing: Easing.inOut(Easing.quad),
      }),
    0,
  );

  // Terminal: linhas surgindo e rolando devagar quando a área enche
  let total = 0;
  while (total < MAX_LINHAS && inicioLinha(total) <= frame) total++;
  let rolagem = 0;
  for (let i = CABE_SEM_ROLAR; i < total; i++) {
    rolagem += COD_LINHA * spring({frame: frame - inicioLinha(i), fps, config: {damping: 200}, durationInFrames: 8});
  }
  const digitado = (i: number) =>
    interpolate(frame, [inicioLinha(i), inicioLinha(i) + DIGITA], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
  const primeira = Math.max(0, Math.floor(rolagem / COD_LINHA) - 1);
  const visiveis = Array.from({length: Math.max(0, total - primeira)}, (_, k) => primeira + k);

  // Cursor no fim da linha mais recente: aceso enquanto digita, pisca nas pausas
  const ultima = total - 1;
  const linhaUlt = ultima >= 0 ? codigo(ultima) : null;
  const pUlt = ultima >= 0 ? digitado(ultima) : 1;
  const cursorX = linhaUlt
    ? COD_X + linhaUlt.recuo * RECUO + linhaUlt.total * pUlt + (linhaUlt.total > 0 ? 10 : 0)
    : COD_X;
  const cursorY = COD_TOPO + Math.max(0, ultima) * COD_LINHA - rolagem;
  const cursorOn = pUlt < 1 || Math.floor(frame / 7) % 2 === 0;

  return (
    <AbsoluteFill style={{fontFamily: FONT}}>
      {/* Sombra elíptica */}
      <svg width="100%" height="100%" viewBox="0 0 940 760" style={{position: 'absolute', inset: 0}}>
        <ellipse
          cx={470}
          cy={winTop + WIN.h + 22}
          rx={380 * interpolate(entra, [0, 1], [0.5, 1])}
          ry={22}
          fill="#000"
          opacity={0.35 * interpolate(entra, [0, 1], [0, 1], CLAMP)}
        />
      </svg>

      {/* Janela do terminal */}
      <div
        style={{
          position: 'absolute',
          left: WIN.x,
          top: winTop,
          width: WIN.w,
          height: WIN.h,
          opacity: aparece,
          transform: `translateY(${sobe}px)`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            boxSizing: 'border-box',
            background: TERMINAL,
            border: `${WIN.borda}px solid #000`,
            borderRadius: WIN.raio,
            overflow: 'hidden',
          }}
        >
          {/* Barra superior */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: INNER_W,
              height: BAR_H + BAR_LINHA,
              boxSizing: 'border-box',
              padding: '0 22px',
              background: BARRA,
              borderBottom: `${BAR_LINHA}px solid #000`,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            {[accent, highlight, '#22c55e'].map((c, i) => (
              <div key={i} style={{width: 24, height: 24, borderRadius: 12, background: c, border: '3px solid #000'}} />
            ))}
            <div style={{flex: 1}} />
            <svg width={46} height={34} viewBox="0 0 46 34" style={{transform: `scale(${clique})`}}>
              <rect x={3} y={3} width={40} height={28} rx={7} fill="none" stroke="#64748b" strokeWidth={4} />
              <line x1={27} y1={3} x2={27} y2={31} stroke="#64748b" strokeWidth={4} />
              <g opacity={ligado}>
                <path d="M27 3 H36 A7 7 0 0 1 43 10 V24 A7 7 0 0 1 36 31 H27 Z" fill={highlight} opacity={0.4} />
                <rect x={3} y={3} width={40} height={28} rx={7} fill="none" stroke={highlight} strokeWidth={4} />
                <line x1={27} y1={3} x2={27} y2={31} stroke={highlight} strokeWidth={4} />
              </g>
            </svg>
          </div>

          {/* Corpo */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: BAR_H + BAR_LINHA,
              width: INNER_W,
              height: CORPO_H,
              overflow: 'hidden',
            }}
          >
            {/* Código sendo escrito */}
            {visiveis.map((i) => {
              const l = codigo(i);
              if (l.segs.length === 0) return null;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: COD_X + l.recuo * RECUO,
                    top: COD_TOPO + i * COD_LINHA - rolagem,
                    width: l.total * digitado(i),
                    height: COD_BARRA,
                    borderRadius: COD_BARRA / 2,
                    overflow: 'hidden',
                  }}
                >
                  <div style={{display: 'flex', gap: COD_GAP, width: l.total}}>
                    {l.segs.map((s, k) => (
                      <div
                        key={k}
                        style={{width: s.w, height: COD_BARRA, borderRadius: COD_BARRA / 2, background: s.cor, flexShrink: 0}}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            {/* Cursor */}
            <div
              style={{
                position: 'absolute',
                left: cursorX,
                top: cursorY - 5,
                width: 14,
                height: COD_BARRA + 10,
                borderRadius: 3,
                background: '#f8fafc',
                opacity: cursorOn ? 1 : 0,
              }}
            />
            {/* Esmaecido no topo (linhas saindo ao rolar) */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: INNER_W,
                height: 34,
                background: `linear-gradient(${TERMINAL}, rgba(15,23,42,0))`,
              }}
            />

            {/* Painel lateral + divisória */}
            {split > 0.001 ? (
              <>
                <div
                  style={{
                    position: 'absolute',
                    left: divX + DIV_W,
                    right: 0,
                    top: 0,
                    height: CORPO_H,
                    background: PAINEL,
                    overflow: 'hidden',
                  }}
                >
                  <div style={{position: 'absolute', left: 0, top: 0, width: PAINEL_W, height: CORPO_H}}>
                    {/* Cabeçalho "Aprenda" */}
                    <div
                      style={{
                        position: 'absolute',
                        left: PAINEL_PAD - 6,
                        top: 0,
                        height: CABECALHO_H,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <svg
                        width={64}
                        height={64}
                        viewBox="0 0 64 64"
                        style={{flexShrink: 0, overflow: 'visible', transform: `scale(${lampada * (1 + 0.16 * pulso)})`}}
                      >
                        <defs>
                          <radialGradient id="painelLateralBrilho">
                            <stop offset="0%" stopColor={highlight} stopOpacity={0.75} />
                            <stop offset="100%" stopColor={highlight} stopOpacity={0} />
                          </radialGradient>
                        </defs>
                        <circle cx={32} cy={26} r={30} fill="url(#painelLateralBrilho)" opacity={0.3 + 0.7 * pulso} />
                        <path
                          d="M32 3 V8 M17.3 17.5 L12.9 15 M46.7 17.5 L51.1 15 M13 28 H9 M51 28 H55"
                          stroke={highlight}
                          strokeWidth={3.5}
                          strokeLinecap="round"
                        />
                        <path
                          d="M25.5 41 V37.3 A13 13 0 1 1 38.5 37.3 V41 Z"
                          fill={highlight}
                          stroke="#000"
                          strokeWidth={3.5}
                          strokeLinejoin="round"
                        />
                        <path d="M26 23 A7 7 0 0 1 31 17" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" opacity={0.85} />
                        <rect x={24} y={42} width={16} height={8} rx={3} fill="#cbd5e1" stroke="#000" strokeWidth={3} />
                        <rect x={27.5} y={50} width={9} height={5} rx={2.5} fill="#000" />
                      </svg>
                      <div
                        style={{
                          fontSize: 38,
                          fontWeight: 900,
                          lineHeight: 1,
                          letterSpacing: 1,
                          color: highlight,
                          textTransform: 'uppercase',
                          whiteSpace: 'nowrap',
                          ...outline(6),
                        }}
                      >
                        Aprenda
                      </div>
                    </div>

                    {/* Cartões de dica */}
                    <div
                      style={{
                        position: 'absolute',
                        left: PAINEL_PAD,
                        top: CABECALHO_H,
                        width: CARD_W,
                        height: CARDS_H,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: CARD_GAP,
                      }}
                    >
                      {lista.map((d, i) => {
                        const p = spring({frame: frame - cardAt(i), fps, config: {damping: 16, stiffness: 170}});
                        return (
                          <div
                            key={i}
                            style={{
                              flexShrink: 0,
                              boxSizing: 'border-box',
                              width: CARD_W,
                              padding: `${CARD_PAD.y}px ${CARD_PAD.x}px`,
                              background: '#fff',
                              border: `${CARD_BORDA}px solid #000`,
                              borderRadius: 18,
                              boxShadow: '0 6px 0 rgba(0,0,0,0.45)',
                              opacity: interpolate(p, [0, 0.4], [0, 1], CLAMP),
                              transform: `translateX(${interpolate(p, [0, 1], [150, 0])}px) rotate(${interpolate(p, [0, 1], [5, 0])}deg)`,
                            }}
                          >
                            {d.rotulo ? (
                              <div
                                style={{
                                  fontSize: fs,
                                  fontWeight: 900,
                                  lineHeight: LH,
                                  color: accent,
                                  overflowWrap: 'break-word',
                                }}
                              >
                                {d.rotulo}
                              </div>
                            ) : null}
                            {d.texto ? (
                              <div
                                style={{
                                  fontSize: fs,
                                  fontWeight: 800,
                                  lineHeight: LH,
                                  color: TINTA,
                                  overflowWrap: 'break-word',
                                }}
                              >
                                {d.texto}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Divisória com alça */}
                <div style={{position: 'absolute', left: divX, top: 0, width: DIV_W, height: CORPO_H, background: '#000'}} />
                <div
                  style={{
                    position: 'absolute',
                    left: divX + DIV_W / 2 - 11,
                    top: CORPO_H / 2 - 36,
                    width: 22,
                    height: 72,
                    boxSizing: 'border-box',
                    borderRadius: 11,
                    background: '#475569',
                    border: '4px solid #000',
                  }}
                />
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Título */}
      {titulo ? (
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: 0,
            right: 0,
            padding: '0 30px',
            fontWeight: 900,
            fontSize: tituloFonte,
            lineHeight: 1.05,
            color: highlight,
            textTransform: 'uppercase',
            textAlign: 'center',
            whiteSpace: 'nowrap',
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
