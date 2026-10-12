import {loadFont} from '@remotion/fonts';

// Fontes OFL empacotadas no bundle: o render não depende de internet (Google Fonts pode estar bloqueado).
// Cada arquivo cobre um subconjunto (latin ou latin-ext); o unicode-range faz o navegador escolher.
const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

import montserrat_latin_700 from '@fontsource/montserrat/files/montserrat-latin-700-normal.woff2';
import montserrat_latin_800 from '@fontsource/montserrat/files/montserrat-latin-800-normal.woff2';
import montserrat_latin_900 from '@fontsource/montserrat/files/montserrat-latin-900-normal.woff2';
import montserrat_latin_ext_700 from '@fontsource/montserrat/files/montserrat-latin-ext-700-normal.woff2';
import montserrat_latin_ext_800 from '@fontsource/montserrat/files/montserrat-latin-ext-800-normal.woff2';
import montserrat_latin_ext_900 from '@fontsource/montserrat/files/montserrat-latin-ext-900-normal.woff2';
import anton_latin_400 from '@fontsource/anton/files/anton-latin-400-normal.woff2';
import anton_latin_ext_400 from '@fontsource/anton/files/anton-latin-ext-400-normal.woff2';
import bebas_neue_latin_400 from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2';
import bebas_neue_latin_ext_400 from '@fontsource/bebas-neue/files/bebas-neue-latin-ext-400-normal.woff2';
import archivo_black_latin_400 from '@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2';
import archivo_black_latin_ext_400 from '@fontsource/archivo-black/files/archivo-black-latin-ext-400-normal.woff2';
import bangers_latin_400 from '@fontsource/bangers/files/bangers-latin-400-normal.woff2';
import bangers_latin_ext_400 from '@fontsource/bangers/files/bangers-latin-ext-400-normal.woff2';
import oswald_latin_400 from '@fontsource/oswald/files/oswald-latin-400-normal.woff2';
import oswald_latin_700 from '@fontsource/oswald/files/oswald-latin-700-normal.woff2';
import oswald_latin_ext_400 from '@fontsource/oswald/files/oswald-latin-ext-400-normal.woff2';
import oswald_latin_ext_700 from '@fontsource/oswald/files/oswald-latin-ext-700-normal.woff2';
import poppins_latin_700 from '@fontsource/poppins/files/poppins-latin-700-normal.woff2';
import poppins_latin_800 from '@fontsource/poppins/files/poppins-latin-800-normal.woff2';
import poppins_latin_900 from '@fontsource/poppins/files/poppins-latin-900-normal.woff2';
import poppins_latin_ext_700 from '@fontsource/poppins/files/poppins-latin-ext-700-normal.woff2';
import poppins_latin_ext_800 from '@fontsource/poppins/files/poppins-latin-ext-800-normal.woff2';
import poppins_latin_ext_900 from '@fontsource/poppins/files/poppins-latin-ext-900-normal.woff2';
import inter_latin_700 from '@fontsource/inter/files/inter-latin-700-normal.woff2';
import inter_latin_800 from '@fontsource/inter/files/inter-latin-800-normal.woff2';
import inter_latin_900 from '@fontsource/inter/files/inter-latin-900-normal.woff2';
import inter_latin_ext_700 from '@fontsource/inter/files/inter-latin-ext-700-normal.woff2';
import inter_latin_ext_800 from '@fontsource/inter/files/inter-latin-ext-800-normal.woff2';
import inter_latin_ext_900 from '@fontsource/inter/files/inter-latin-ext-900-normal.woff2';

type Arquivos = {latin: Record<number, string>; ext: Record<number, string>};

/** Os pesos que o tema usa (700–900). Numa fonte sem esse peso, o arquivo mais próximo serve, sem negrito sintético. */
const PESOS = ['700', '800', '900'] as const;

const FONTES: Record<string, Arquivos> = {
  'Montserrat': {latin: {700: montserrat_latin_700, 800: montserrat_latin_800, 900: montserrat_latin_900}, ext: {700: montserrat_latin_ext_700, 800: montserrat_latin_ext_800, 900: montserrat_latin_ext_900}},
  'Anton': {latin: {400: anton_latin_400}, ext: {400: anton_latin_ext_400}},
  'Bebas Neue': {latin: {400: bebas_neue_latin_400}, ext: {400: bebas_neue_latin_ext_400}},
  'Archivo Black': {latin: {400: archivo_black_latin_400}, ext: {400: archivo_black_latin_ext_400}},
  'Bangers': {latin: {400: bangers_latin_400}, ext: {400: bangers_latin_ext_400}},
  'Oswald': {latin: {400: oswald_latin_400, 700: oswald_latin_700}, ext: {400: oswald_latin_ext_400, 700: oswald_latin_ext_700}},
  'Poppins': {latin: {700: poppins_latin_700, 800: poppins_latin_800, 900: poppins_latin_900}, ext: {700: poppins_latin_ext_700, 800: poppins_latin_ext_800, 900: poppins_latin_ext_900}},
  'Inter': {latin: {700: inter_latin_700, 800: inter_latin_800, 900: inter_latin_900}, ext: {700: inter_latin_ext_700, 800: inter_latin_ext_800, 900: inter_latin_ext_900}},
};

/** Os nomes das fontes embutidas, os mesmos que o núcleo confere no roteiro. */
export const FONTES_EMBUTIDAS = Object.keys(FONTES);

/** O arquivo do peso pedido, ou o mais próximo que a fonte tem. */
const arquivoDoPeso = (arquivos: Record<number, string>, peso: number): string => {
  const pesos = Object.keys(arquivos).map(Number);
  const perto = pesos.reduce((a, b) => (Math.abs(b - peso) < Math.abs(a - peso) ? b : a));
  return arquivos[perto];
};

const carregando = new Map<string, Promise<void>>();

/** Carrega a fonte (latin + latin-ext, pesos 700–900). Cada fonte carrega uma vez. */
export const carregarFonte = (nome: string): Promise<void> => {
  const arquivos = FONTES[nome];
  if (!arquivos) return Promise.reject(new Error(`Fonte "${nome}" fora do catálogo embutido`));
  let promessa = carregando.get(nome);
  if (!promessa) {
    promessa = Promise.all(
      PESOS.flatMap((peso) => [
        loadFont({family: nome, url: arquivoDoPeso(arquivos.latin, Number(peso)), weight: peso, unicodeRange: LATIN}),
        loadFont({family: nome, url: arquivoDoPeso(arquivos.ext, Number(peso)), weight: peso, unicodeRange: LATIN_EXT}),
      ]),
    ).then(() => undefined);
    carregando.set(nome, promessa);
  }
  return promessa;
};

/** Fonte com reserva: se a escolhida não carregar, o texto cai em sans-serif. */
export const familia = (nome: string) => `"${nome}", sans-serif`;
