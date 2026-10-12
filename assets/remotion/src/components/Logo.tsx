import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {tamanhoDaLogo, type Trecho} from '../logo';
import type {Marca} from '../types';

/** A logo do kit no canto escolhido para cada trecho, com uma entrada e uma saída suaves. */
export const Logo: React.FC<{marca: Marca; trechos: Trecho[]}> = ({marca, trechos}) => {
  const frame = useCurrentFrame();
  const {fps, width} = useVideoConfig();
  const trecho = trechos.find((t) => frame >= t.de && frame < t.ate);
  if (!trecho) return null;
  const {w, h} = tamanhoDaLogo(marca, width);
  // O arquivo vem como remotion/public/logo.<ext>; o staticFile parte do public/.
  const arquivo = marca.arquivo.replace(/^remotion\/public\//, '');
  // A entrada e a saída valem para a janela inteira, não para cada trecho.
  const primeiro = trechos[0]?.de ?? 0;
  const ultimo = trechos[trechos.length - 1]?.ate ?? 0;
  const suave = Math.max(1, Math.round(0.25 * fps));
  const opacidade =
    marca.opacidade *
    interpolate(frame, [primeiro, primeiro + suave, ultimo - suave, ultimo], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <Img
        src={staticFile(arquivo)}
        style={{
          position: 'absolute',
          left: trecho.caixa.left,
          top: trecho.caixa.top,
          width: w,
          height: h,
          objectFit: 'contain',
          opacity: opacidade,
        }}
      />
    </AbsoluteFill>
  );
};
