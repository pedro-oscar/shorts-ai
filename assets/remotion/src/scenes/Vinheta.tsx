import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * Vinheta de capítulo em pé: a frase entra palavra por palavra, em letras grandes, quebrada em
 * linhas que cabem na largura. Serve para cobrir as vinhetas 16:9 do vídeo de origem (texto que
 * vaza das laterais no recorte 9:16). `rotulo` opcional numa tarja acima; palavras em `destaque`
 * na cor `highlight`; uma barra `accent` cresce embaixo quando a frase termina.
 */

const H = 760;
const LARGURA = 860; // largura útil das linhas
const CHAR = 0.78; // largura média de um caractere em Montserrat 900 caixa alta (folgada)
const ESPACO = 0.3;
const ALTURA_LINHA = 1.06;
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const norm = (w: string) =>
  w
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();

/** Maior fonte (até 150 px) em que as linhas cabem na largura e na altura disponíveis. */
const quebrar = (palavras: string[], alturaMax: number): {fs: number; linhas: number[][]} => {
  for (let fs = 150; fs > 40; fs -= 4) {
    const larg = (i: number) => palavras[i].length * CHAR * fs;
    if (palavras.some((_, i) => larg(i) > LARGURA)) continue;
    const linhas: number[][] = [];
    let atual: number[] = [];
    let w = 0;
    palavras.forEach((_, i) => {
      const extra = (atual.length ? ESPACO * fs : 0) + larg(i);
      if (atual.length && w + extra > LARGURA) {
        linhas.push(atual);
        atual = [i];
        w = larg(i);
      } else {
        atual.push(i);
        w += extra;
      }
    });
    if (atual.length) linhas.push(atual);
    if (linhas.length * fs * ALTURA_LINHA <= alturaMax) return {fs, linhas};
  }
  return {fs: 40, linhas: [palavras.map((_, i) => i)]};
};

export const Vinheta: React.FC<
  SceneProps & {
    texto?: string;
    rotulo?: string;
    destaque?: string[];
    /** segundos entre uma palavra e a próxima */
    intervalo?: number;
  }
> = ({texto = '', rotulo = '', destaque = [], intervalo = 0.12, accent, highlight}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const palavras = texto.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const marcadas = new Set(destaque.map(norm));
  const tag = rotulo.trim().toUpperCase();
  const alturaTexto = H - 60 - (tag ? 130 : 0) - 70;
  const {fs, linhas} = quebrar(palavras, alturaTexto);

  const t0 = tag ? 5 : 0;
  const passo = Math.max(1, Math.round(intervalo * fps));
  const fimF = t0 + (palavras.length - 1) * passo + 8;
  const tagIn = spring({frame, fps, config: {damping: 11, stiffness: 180}});
  const barra = interpolate(frame, [fimF, fimF + 10], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});

  return (
    <AbsoluteFill style={{fontFamily: FONT, alignItems: 'center', justifyContent: 'center', gap: 30}}>
      {tag ? (
        <div
          style={{
            background: accent,
            color: '#fff',
            fontWeight: 900,
            fontSize: 46,
            letterSpacing: 2,
            padding: '12px 30px',
            borderRadius: 14,
            boxShadow: '0 14px 30px rgba(0,0,0,0.45)',
            opacity: interpolate(tagIn, [0, 0.4], [0, 1], CLAMP),
            transform: `translateY(${interpolate(tagIn, [0, 1], [-40, 0])}px) rotate(-2deg) scale(${interpolate(tagIn, [0, 1], [0.8, 1])})`,
          }}
        >
          {tag}
        </div>
      ) : null}
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
        {linhas.map((linha, li) => (
          <div key={li} style={{display: 'flex', whiteSpace: 'nowrap', lineHeight: ALTURA_LINHA, gap: ESPACO * fs}}>
            {linha.map((i) => {
              const s = spring({frame: frame - t0 - i * passo, fps, config: {damping: 12, stiffness: 190}});
              return (
                <span
                  key={i}
                  style={{
                    display: 'inline-block',
                    fontWeight: 900,
                    fontSize: fs,
                    color: marcadas.has(norm(palavras[i])) ? highlight : '#fff',
                    opacity: interpolate(s, [0, 0.3], [0, 1], CLAMP),
                    transform: `translateY(${interpolate(s, [0, 1], [50, 0])}px) scale(${interpolate(s, [0, 1], [0.7, 1])})`,
                    ...outline(Math.round(fs / 9)),
                  }}
                >
                  {palavras[i]}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div
        style={{
          width: 520 * barra,
          height: 16,
          borderRadius: 8,
          background: accent,
          border: barra > 0 ? '4px solid #000' : 'none',
        }}
      />
    </AbsoluteFill>
  );
};
