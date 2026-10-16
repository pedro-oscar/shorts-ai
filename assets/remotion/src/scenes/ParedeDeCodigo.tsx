import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/** Geometria na caixa 940×760. */
const JANELA = {x: 90, w: 760, top: 56, bottom: 692, raio: 28};
const BORDA = 8;
const BARRA = 66; // barra de título (inclui a linha preta de baixo)
const CODE_W = JANELA.w - BORDA * 2; // 744
const CODE_H = JANELA.bottom - JANELA.top - BORDA * 2 - BARRA; // área de código cheia (554)
const CODE_ZEN = 270; // área de código depois do colapso
const PAD_Y = 18;
const GUTTER = {x: 26, w: 30};
const CODE_X = 84;
const RECUO = 34;
const CODE_MAX = CODE_W - 34;
const TOKEN_GAP = 14;
const SPIN = 68;
const TEXTO_W = CODE_W - 88 - SPIN - 24;

const FUNDO = '#0f172a';
const BARRA_COR = '#334155';
const CINZA = '#94a3b8';
const SINTAXE = ['#60a5fa', '#f472b6', '#4ade80', '#fb923c', '#94a3b8'];
const RECUOS = [0, 1, 1, 2, 3, 3, 2, 1, 2, 2, 3, 4, 2, 1, 0, 1, 2];
const BOLINHAS = ['#ff5f57', '#febc2e', '#28c840'];

const milhar = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

type Token = {x: number; w: number; cor: string};

/** Barrinhas coloridas de uma "linha de código" (determinísticas pelo índice da linha). */
const tokensDa = (k: number): Token[] => {
  if (k % 7 === 5) return []; // linha em branco
  const n = 1 + ((k * 5 + 3) % 4);
  let x = CODE_X + RECUOS[k % RECUOS.length] * RECUO;
  const out: Token[] = [];
  for (let j = 0; j < n; j++) {
    const w = Math.min(36 + ((k * 37 + j * 61) % 9) * 20, CODE_MAX - x);
    if (w < 24) break;
    out.push({x, w, cor: SINTAXE[(k * 3 + j * 2 + (k >> 2)) % SINTAXE.length]});
    x += w + TOKEN_GAP;
  }
  return out;
};

/**
 * "Parede de código": um terminal entupido de linhas rolando sem parar que, de repente,
 * colapsa numa única linha limpa de progresso (spinner + resumo + barra). É o "Zen Mode":
 * esconde o código e mostra só o que está sendo feito.
 */
export const ParedeDeCodigo: React.FC<SceneProps & {label?: string; linhas?: number; resumo?: string}> = ({
  label = 'Zen Mode',
  linhas = 14,
  resumo = 'Criando o site…',
  accent,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const V = Math.max(4, Math.min(30, Math.round(Number(linhas) || 14)));
  const temLabel = label.trim() !== '';
  const texto = resumo.trim() !== '' ? resumo : 'Criando o site…';

  // Entrada da janela (f0–10) e respiro final (f90–120)
  const entra = spring({frame, fps, config: {damping: 13, stiffness: 160}});
  const respiro = interpolate(frame, [90, 105, 120], [0, 1, 0], {easing: Easing.inOut(Easing.sin), ...CLAMP});
  const escala = interpolate(entra, [0, 1], [0.72, 1]) * (1 + 0.014 * respiro);
  const sobe = interpolate(entra, [0, 1], [140, 0]);
  const aparece = interpolate(entra, [0, 0.25], [0, 1], CLAMP);

  // Colapso da janela (f60+): a área de código encolhe e a janela sobe um pouco
  const zen = spring({frame: frame - 60, fps, config: {damping: 18, stiffness: 110}});
  const codeH = interpolate(zen, [0, 1], [CODE_H, CODE_ZEN]);
  const winH = codeH + BARRA + BORDA * 2;
  const centro = interpolate(zen, [0, 1], [(JANELA.top + JANELA.bottom) / 2, temLabel ? 410 : 380]);
  const winTop = centro - winH / 2;

  // Parede de código (f6–55): enche a tela e depois rola cada vez mais rápido
  const enche = interpolate(frame, [6, 22], [0, V], {easing: Easing.inOut(Easing.quad), ...CLAMP});
  const rola = interpolate(frame, [16, 72], [0, V * 2.4], {easing: Easing.in(Easing.quad), ...CLAMP});
  const emitidas = enche + rola;
  const deslocado = Math.max(0, emitidas - V);
  const passo = (CODE_H - PAD_Y * 2) / V;
  const bh = Math.max(6, Math.min(18, passo * 0.5));
  const cy = CODE_H / 2;

  const paredes: React.ReactNode[] = [];
  if (frame < 74) {
    const primeira = Math.max(0, Math.floor(deslocado) - 1);
    const ultima = Math.ceil(emitidas) - 1;
    for (let k = primeira; k <= ultima; k++) {
      const yBase = PAD_Y + (k - deslocado + 0.5) * passo;
      // Colapso (f55–72): de fora para dentro, cada linha desliza para o centro e se espreme
      const dist = Math.min(1, Math.abs(yBase - cy) / (CODE_H / 2));
      const ini = 55 + (1 - dist) * 6;
      const g = interpolate(frame, [ini, ini + 11], [0, 1], {easing: Easing.inOut(Easing.cubic), ...CLAMP});
      const y = yBase + (cy - yBase) * g;
      const op = interpolate(g, [0.55, 1], [1, 0], CLAMP);
      // A linha mais nova é "digitada" da esquerda para a direita
      const revela = Math.min(1, Math.max(0, emitidas - k));
      const toks = tokensDa(k);
      const inicio = toks.length > 0 ? toks[0].x : CODE_X;
      const fim = toks.length > 0 ? toks[toks.length - 1].x + toks[toks.length - 1].w : CODE_X;
      const corte = inicio + revela * (fim - inicio);
      paredes.push(
        <g
          key={k}
          opacity={op}
          transform={`translate(${CODE_W / 2} ${y}) scale(${1 - 0.3 * g} ${1 - g}) translate(${-CODE_W / 2} 0)`}
        >
          <rect x={GUTTER.x} y={-bh * 0.35} width={GUTTER.w} height={bh * 0.7} rx={bh * 0.35} fill={BARRA_COR} />
          {toks.map((t, j) => {
            const w = Math.max(0, Math.min(t.w, corte - t.x));
            return w > 0 ? <rect key={j} x={t.x} y={-bh / 2} width={w} height={bh} rx={bh / 2} fill={t.cor} /> : null;
          })}
        </g>,
      );
    }
  }

  // Contador "+1.248 linhas" na barra de título (some no colapso)
  const contagem = Math.round(interpolate(frame, [8, 58], [0, 1248], {easing: Easing.in(Easing.quad), ...CLAMP}));
  const contadorOp = interpolate(frame, [8, 13], [0, 1], CLAMP) * interpolate(frame, [56, 64], [1, 0], CLAMP);

  // Costura: as linhas colapsadas viram um risco luminoso no centro (f58–76)
  const costura = interpolate(frame, [58, 68], [0, 1], {easing: Easing.out(Easing.cubic), ...CLAMP});
  const costuraOp = interpolate(frame, [58, 62, 68, 76], [0, 1, 1, 0], CLAMP);
  const costuraW = (CODE_W - 120) * costura;

  // Linha limpa de progresso (f66–90), escalonada: spinner, texto, barra
  const spinIn = spring({frame: frame - 66, fps, config: {damping: 11, stiffness: 160}});
  const textoIn = spring({frame: frame - 70, fps, config: {damping: 14, stiffness: 140}});
  const barraIn = spring({frame: frame - 74, fps, config: {damping: 16, stiffness: 140}});
  const giro = interpolate(frame, [66, 120], [0, 540], {extrapolateLeft: 'clamp'});
  const pulso = interpolate(frame % 16, [0, 8, 16], [1, 1.12, 1], {easing: Easing.inOut(Easing.sin)});
  const progresso = interpolate(frame, [74, 120], [0.02, 0.96], {easing: Easing.out(Easing.cubic), ...CLAMP});
  const brilho = interpolate(Math.max(0, frame - 76) % 28, [0, 28], [-40, 120], {easing: Easing.inOut(Easing.quad)});
  const fonte = Math.max(36, Math.min(56, Math.floor(TEXTO_W / (Math.max(1, texto.length) * 0.62))));

  // Rótulo (f72–84)
  const labelIn = spring({frame: frame - 72, fps, config: {damping: 10}});
  const labelFonte = Math.max(44, Math.min(80, Math.floor(860 / (Math.max(1, label.length) * 0.74))));

  return (
    <AbsoluteFill style={{fontFamily: FONT}}>
      {/* Sombra elíptica */}
      <svg width="100%" height="100%" viewBox="0 0 940 760" style={{position: 'absolute', inset: 0}}>
        <ellipse
          cx={470}
          cy={Math.min(724, winTop + winH + 28)}
          rx={350 * interpolate(entra, [0, 1], [0.5, 1])}
          ry={24}
          fill="#000"
          opacity={0.35 * aparece}
        />
      </svg>

      {/* Janela do terminal */}
      <div
        style={{
          position: 'absolute',
          left: JANELA.x,
          top: winTop,
          width: JANELA.w,
          height: winH,
          boxSizing: 'border-box',
          border: `${BORDA}px solid #000`,
          borderRadius: JANELA.raio,
          background: FUNDO,
          overflow: 'hidden',
          boxShadow: '0 0 0 5px #475569, 0 28px 60px rgba(0,0,0,0.5)',
          opacity: aparece,
          transform: `translateY(${sobe}px) scale(${escala})`,
        }}
      >
        {/* Barra de título */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: BARRA,
            boxSizing: 'border-box',
            background: BARRA_COR,
            borderBottom: '5px solid #000',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '0 26px',
          }}
        >
          {BOLINHAS.map((cor) => (
            <div
              key={cor}
              style={{width: 26, height: 26, borderRadius: 13, background: cor, border: '3px solid #000', boxSizing: 'border-box'}}
            />
          ))}
          <div
            style={{
              marginLeft: 'auto',
              fontSize: 36,
              fontWeight: 800,
              color: '#cbd5e1',
              opacity: contadorOp,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            +{milhar(contagem)} linhas
          </div>
        </div>

        {/* Área de código */}
        <div style={{position: 'absolute', left: 0, right: 0, top: BARRA, height: codeH, overflow: 'hidden'}}>
          <svg
            width={CODE_W}
            height={CODE_H}
            viewBox={`0 0 ${CODE_W} ${CODE_H}`}
            style={{position: 'absolute', left: 0, top: (codeH - CODE_H) / 2}}
          >
            {paredes}
            <rect
              x={(CODE_W - costuraW) / 2}
              y={cy - 3}
              width={costuraW}
              height={6}
              rx={3}
              fill={highlight}
              opacity={costuraOp}
            />
          </svg>

          {/* Linha limpa de progresso */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 28,
              padding: '0 44px',
            }}
          >
            <div style={{display: 'flex', alignItems: 'center', gap: 24}}>
              <svg
                width={SPIN}
                height={SPIN}
                viewBox="-40 -40 80 80"
                style={{
                  flexShrink: 0,
                  overflow: 'visible',
                  opacity: interpolate(spinIn, [0, 0.3], [0, 1], CLAMP),
                  transform: `scale(${spinIn * pulso}) rotate(${giro}deg)`,
                }}
              >
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <line key={`c${i}`} x1={0} y1={-9} x2={0} y2={-30} stroke="#000" strokeWidth={17} strokeLinecap="round" transform={`rotate(${i * 60})`} />
                ))}
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <line key={`a${i}`} x1={0} y1={-9} x2={0} y2={-30} stroke={accent} strokeWidth={9} strokeLinecap="round" transform={`rotate(${i * 60})`} />
                ))}
              </svg>
              <span
                style={{
                  display: 'inline-block',
                  maxWidth: TEXTO_W,
                  fontSize: fonte,
                  fontWeight: 800,
                  lineHeight: 1.1,
                  color: '#fff',
                  overflowWrap: 'break-word',
                  opacity: interpolate(textoIn, [0, 0.4], [0, 1], CLAMP),
                  transform: `translateX(${interpolate(textoIn, [0, 1], [40, 0])}px)`,
                }}
              >
                {texto}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                opacity: interpolate(barraIn, [0, 0.3], [0, 1], CLAMP),
                transform: `translateY(${interpolate(barraIn, [0, 1], [24, 0])}px)`,
              }}
            >
              <div
                style={{
                  position: 'relative',
                  flex: 1,
                  height: 20,
                  borderRadius: 10,
                  background: '#1e293b',
                  border: '3px solid #000',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${progresso * 100}%`,
                    borderRadius: 10,
                    background: highlight,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: `${brilho}%`,
                      width: 90,
                      background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.75), rgba(255,255,255,0))',
                    }}
                  />
                </div>
              </div>
              <div
                style={{
                  minWidth: 100,
                  textAlign: 'right',
                  fontSize: 36,
                  fontWeight: 800,
                  color: CINZA,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {Math.round(progresso * 100)}%
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Rótulo */}
      {temLabel ? (
        <div
          style={{
            position: 'absolute',
            top: 30,
            left: 0,
            right: 0,
            padding: '0 40px',
            fontWeight: 900,
            fontSize: labelFonte,
            lineHeight: 1.05,
            letterSpacing: 2,
            color: accent,
            textTransform: 'uppercase',
            textAlign: 'center',
            transform: `scale(${labelIn * (1 + 0.03 * respiro)})`,
            ...outline(10),
          }}
        >
          {label}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
