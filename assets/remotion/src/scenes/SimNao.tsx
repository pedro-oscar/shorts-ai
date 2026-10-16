import React from 'react';
import {AbsoluteFill, Easing, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * Lista "onde funciona / onde não funciona": cada item entra deslizando como uma pílula clara e,
 * logo depois, ganha um selo — ✓ verde (funciona) ou ✗ vermelho (não funciona; a pílula treme,
 * fica acinzentada e o rótulo é riscado).
 */

type Item = {label: string; ok: boolean; emoji?: string};

const PADRAO: Item[] = [
  {label: 'Item 1', ok: true},
  {label: 'Item 2', ok: true},
  {label: 'Item 3', ok: false},
];
const INTERVALO_PADRAO = 18;
const MAX_ITENS = 5;
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const VERDE = '#16a34a';
const TINTA = '#111827';

/** Geometria na caixa 940×760. */
const PILL = {x: 80, w: 780, borda: 6};
const LISTA_FIM = 730;
const PAD_L = 30;
const PAD_R = 16;
const GAP = 18;
const PRIMEIRA_ENTRADA = 6;
const SELO_ATRASO = 8; // frames entre a entrada do item e o selo

/** Traços do selo no viewBox 0 0 100 100. */
const CHECK = 'M 27 52 L 43 68 L 74 35';
const CHECK_LEN = 68;
const X1 = 'M 33 33 L 67 67';
const X2 = 'M 67 33 L 33 67';
const X_LEN = 49;

/** Traço branco desenhado progressivamente (0 → 1). */
const Traco: React.FC<{d: string; len: number; p: number}> = ({d, len, p}) =>
  p > 0.01 ? (
    <path
      d={d}
      fill="none"
      stroke="#fff"
      strokeWidth={12}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={len}
      strokeDashoffset={len * (1 - p)}
    />
  ) : null;

/** Círculo-selo à direita da pílula. `t` = frames desde o momento do selo (negativo = ainda não). */
const Selo: React.FC<{ok: boolean; t: number; fps: number; d: number; cor: string}> = ({ok, t, fps, d, cor}) => {
  const pop = spring({frame: t, fps, config: {damping: 9, stiffness: 220, mass: 0.7}});
  const giro = interpolate(pop, [0, 1], [-35, 0]);
  const vazio = interpolate(pop, [0, 0.6], [1, 0], CLAMP);
  const onda = interpolate(t, [2, 16], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
  const traco = (atraso: number, dur: number) =>
    spring({frame: t - atraso, fps, config: {damping: 200}, durationInFrames: dur});

  return (
    <svg width={d} height={d} viewBox="0 0 100 100" style={{flexShrink: 0, overflow: 'visible'}}>
      {/* Encaixe vazio antes do selo */}
      {vazio > 0.01 ? (
        <circle
          cx={50}
          cy={50}
          r={40}
          fill="#e5e7eb"
          stroke="#9ca3af"
          strokeWidth={5}
          strokeDasharray="9 7"
          opacity={vazio}
        />
      ) : null}
      {/* Onda de impacto */}
      {onda > 0 && onda < 1 ? (
        <circle
          cx={50}
          cy={50}
          r={46 + onda * 30}
          fill="none"
          stroke={cor}
          strokeWidth={6 * (1 - onda) + 1}
          opacity={0.9 * (1 - onda)}
        />
      ) : null}
      {t >= 0 ? (
        <g transform={`translate(50 50) rotate(${giro}) scale(${pop}) translate(-50 -50)`}>
          <circle cx={50} cy={50} r={44} fill={cor} stroke="#000" strokeWidth={6} />
          <ellipse cx={36} cy={27} rx={15} ry={7} fill="#fff" opacity={0.22} transform="rotate(-30 36 27)" />
          {ok ? (
            <Traco d={CHECK} len={CHECK_LEN} p={traco(4, 10)} />
          ) : (
            <>
              <Traco d={X1} len={X_LEN} p={traco(4, 7)} />
              <Traco d={X2} len={X_LEN} p={traco(8, 7)} />
            </>
          )}
        </g>
      ) : null}
    </svg>
  );
};

export const SimNao: React.FC<SceneProps & {title?: string; itens?: Item[]; intervalo?: number}> = ({
  title = '',
  itens = PADRAO,
  intervalo = INTERVALO_PADRAO,
  accent,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // Dados (protegidos contra JSON malformado)
  const validos = (Array.isArray(itens) ? itens : []).filter(
    (it) => it && typeof it.label === 'string' && it.label.trim() !== '',
  );
  const lista = (validos.length > 0 ? validos : PADRAO).slice(0, MAX_ITENS);
  const n = lista.length;
  const passo =
    typeof intervalo === 'number' && Number.isFinite(intervalo) && intervalo >= 0 ? intervalo : INTERVALO_PADRAO;
  const titulo = typeof title === 'string' ? title.trim() : '';

  // Título (f0–8)
  const tituloIn = spring({frame, fps, config: {damping: 10, stiffness: 160}});
  const tituloFonte = Math.max(48, Math.min(72, Math.floor(880 / (Math.max(1, titulo.length) * 0.74))));
  const tituloLinhas = titulo ? Math.min(2, Math.ceil((titulo.length * 0.74 * tituloFonte) / 880)) : 0;
  const listaTopo = titulo ? 22 + tituloLinhas * tituloFonte * 1.05 + 26 : 40;

  // Pílulas empilhadas e centralizadas no espaço abaixo do título
  const gap = n <= 3 ? 36 : n === 4 ? 24 : 16;
  const espaco = LISTA_FIM - listaTopo;
  const pillH = Math.min(140, Math.floor((espaco - gap * (n - 1)) / n));
  const total = n * pillH + gap * (n - 1);
  const inicioY = listaTopo + (espaco - total) / 2;
  const seloD = Math.min(104, Math.round(pillH * 0.74));

  // Emoji (reserva a coluna para todos se algum tiver) e texto (encolhe; mínimo 36px)
  const temEmoji = lista.some((it) => typeof it.emoji === 'string' && it.emoji !== '');
  const emojiFonte = Math.min(62, Math.round(pillH * 0.46));
  const emojiW = temEmoji ? Math.round(emojiFonte * 1.3) : 0;
  const textoW = PILL.w - 2 * PILL.borda - PAD_L - PAD_R - seloD - GAP - (temEmoji ? emojiW + GAP : 0);
  const base = n >= 5 ? 46 : n === 4 ? 50 : 56;
  const maior = Math.max(1, ...lista.map((it) => it.label.length));
  const fonte = Math.max(36, Math.min(base, Math.floor(textoW / (maior * 0.62))));

  return (
    <AbsoluteFill style={{fontFamily: FONT}}>
      {lista.map((it, i) => {
        const ok = it.ok === true;
        const entrada = PRIMEIRA_ENTRADA + i * passo;
        const t0 = entrada + SELO_ATRASO;
        const dir = i % 2 === 0 ? -1 : 1;

        // Entrada deslizando da lateral (alternando os lados)
        const p = spring({frame: frame - entrada, fps, config: {damping: 16, stiffness: 170}});
        const desliza = interpolate(p, [0, 1], [dir * 280, 0]);
        const inclina = interpolate(p, [0, 1], [dir * 4, 0]);
        const aparece = interpolate(p, [0, 0.25], [0, 1], CLAMP);

        // ✗: tremidinho curto e determinístico
        const tt = frame - (t0 + 2);
        const amp = ok ? 0 : interpolate(tt, [0, 9], [14, 0], {...CLAMP, easing: Easing.out(Easing.quad)});
        const treme = tt > 0 ? Math.sin(tt * 2.4) * amp : 0;
        const tremeGiro = tt > 0 ? Math.sin(tt * 2.4 + 1.2) * amp * 0.06 : 0;

        // Estado final: ✓ fica levemente esverdeada (com um "pulo"); ✗ fica cinza e riscada
        const efeito = spring({frame: frame - t0 - 5, fps, config: {damping: 200}, durationInFrames: 12});
        const fundo = interpolateColors(efeito, [0, 1], ['#ffffff', ok ? '#ecfdf3' : '#d1d5db']);
        const pulo = ok
          ? interpolate(frame - t0, [0, 4, 10], [1, 1.035, 1], {...CLAMP, easing: Easing.inOut(Easing.quad)})
          : interpolate(efeito, [0, 1], [1, 0.97]);
        const apaga = ok ? 1 : interpolate(efeito, [0, 1], [1, 0.6]);

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: PILL.x,
              top: inicioY + i * (pillH + gap),
              width: PILL.w,
              height: pillH,
              boxSizing: 'border-box',
              borderRadius: pillH / 2,
              border: `${PILL.borda}px solid #000`,
              background: fundo,
              boxShadow: '0 9px 0 rgba(0,0,0,0.45)',
              display: 'flex',
              alignItems: 'center',
              gap: GAP,
              padding: `0 ${PAD_R}px 0 ${PAD_L}px`,
              opacity: aparece,
              transform: `translateX(${desliza + treme}px) rotate(${inclina + tremeGiro}deg) scale(${pulo})`,
            }}
          >
            {temEmoji ? (
              <div
                style={{
                  width: emojiW,
                  flexShrink: 0,
                  textAlign: 'center',
                  fontSize: emojiFonte,
                  lineHeight: 1,
                  opacity: apaga,
                  filter: ok ? undefined : `grayscale(${efeito})`,
                }}
              >
                {it.emoji ?? ''}
              </div>
            ) : null}
            <div style={{flex: 1, minWidth: 0, display: 'flex', alignItems: 'center'}}>
              <span
                style={{
                  position: 'relative',
                  fontSize: fonte,
                  fontWeight: 900,
                  lineHeight: 1.05,
                  color: TINTA,
                  opacity: apaga,
                }}
              >
                {it.label}
                {!ok ? (
                  <span
                    style={{
                      position: 'absolute',
                      left: -6,
                      right: -6,
                      top: '52%',
                      height: 7,
                      marginTop: -3.5,
                      borderRadius: 4,
                      background: '#4b5563',
                      transform: `scaleX(${efeito})`,
                      transformOrigin: 'left center',
                    }}
                  />
                ) : null}
              </span>
            </div>
            <Selo ok={ok} t={frame - t0} fps={fps} d={seloD} cor={ok ? VERDE : accent} />
          </div>
        );
      })}

      {/* Título */}
      {titulo ? (
        <div
          style={{
            position: 'absolute',
            top: 22,
            left: 0,
            right: 0,
            padding: '0 30px',
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
