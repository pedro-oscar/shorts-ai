import {carregarFonte, familia} from './fonts';
import type {MotionStyle} from './types';

/** A fonte das cenas e do kit Padrão. */
export const FONT = 'Montserrat';
void carregarFonte(FONT);

export const WIDTH = 1080;
export const HEIGHT = 1920;
export const FPS = 30;

/** O estilo com os padrões preenchidos; as fontes viram os nomes do kit. */
export type Style = Required<Omit<MotionStyle, 'fontes'>> & {fonteLegenda: string; fonteTitulos: string};

/** O CSS `font-family` da fonte da legenda e o da dos títulos. */
export const familiaLegenda = (s: Style) => familia(s.fonteLegenda);
export const familiaTitulos = (s: Style) => familia(s.fonteTitulos);

export const resolveStyle = (s: MotionStyle | undefined): Style => ({
  fonteLegenda: s?.fontes?.legenda ?? FONT,
  fonteTitulos: s?.fontes?.titulos ?? FONT,
  accent: s?.accent ?? '#FF2D2D',
  highlight: s?.highlight ?? '#FFE600',
  captionY: s?.captionY ?? 0.66,
  grain: s?.grain ?? true,
  captionGroupMs: s?.captionGroupMs ?? 900,
  uppercase: s?.uppercase ?? true,
  fadeOut: s?.fadeOut ?? 0.5,
});

/** Contorno preto grosso legível sobre qualquer fundo. */
export const outline = (px: number) => ({
  WebkitTextStroke: `${px}px #000`,
  paintOrder: 'stroke fill' as const,
});

export const normalizeWord = (w: string) =>
  w
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}$%]/gu, '')
    .toLowerCase();
