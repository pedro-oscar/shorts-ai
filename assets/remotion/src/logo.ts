import {cabecaAt, type Caixa} from './components/camera';
import type {ClipInfo, FaceTrack, Marca, Motion} from './types';

export const TOPO_SEGURO = 150; // barra/status do app
const MARGEM_LATERAL = 40;
const MARGEM_INFERIOR = 180; // abaixo da legenda, fora da UI do app
const ALTURA_MAX = 320; // uma logo alta não chega até a legenda
const TRECHO_S = 3; // a logo escolhe o canto de novo a cada trecho
const JANELA_S = 3; // "só no início" e "só no fim"

export type Canto = 'superiorEsquerdo' | 'superiorDireito' | 'inferiorEsquerdo' | 'inferiorDireito';
const CANTOS: Canto[] = ['superiorEsquerdo', 'superiorDireito', 'inferiorEsquerdo', 'inferiorDireito'];

/** Um trecho do reel (em frames) em que a logo fica num canto, com o retângulo que ela ocupa. */
export type Trecho = {de: number; ate: number; canto: Canto; caixa: Caixa};

export const tamanhoDaLogo = (marca: Marca, W: number) => {
  let w = marca.largura * W;
  let h = w * marca.proporcao;
  if (h > ALTURA_MAX) {
    w *= ALTURA_MAX / h;
    h = ALTURA_MAX;
  }
  return {w, h};
};

const caixaDoCanto = (canto: Canto, w: number, h: number, W: number, H: number): Caixa => {
  const left = canto.endsWith('Esquerdo') ? MARGEM_LATERAL : W - MARGEM_LATERAL - w;
  const top = canto.startsWith('superior') ? TOPO_SEGURO : H - MARGEM_INFERIOR - h;
  return {top, bottom: top + h, left, right: left + w};
};

const distancia = (a: Caixa, b: Caixa) =>
  Math.hypot(
    Math.max(0, a.left - b.right, b.left - a.right),
    Math.max(0, a.top - b.bottom, b.top - a.bottom),
  );

/** O intervalo de frames [de, ate) em que a logo aparece. */
const janela = (marca: Marca, total: number, fps: number): [number, number] => {
  const j = Math.min(total, Math.round(JANELA_S * fps));
  if (marca.quando === 'inicio') return [0, j];
  if (marca.quando === 'fim') return [total - j, total];
  return [0, total];
};

/**
 * Onde a logo fica em cada trecho. O canto automático é o mais longe da cabeça de quem está em
 * foco em todo o trecho; um canto fixo só vale enquanto não encosta na cabeça — a logo nunca
 * cobre o rosto.
 */
export const planejarLogo = (
  marca: Marca | undefined,
  clip: ClipInfo,
  face: FaceTrack,
  motions: Motion[],
  total: number,
  fps: number,
  W: number,
  H: number,
): Trecho[] => {
  if (!marca) return [];
  const {w, h} = tamanhoDaLogo(marca, W);
  const [inicio, fim] = janela(marca, total, fps);
  const passo = Math.round(TRECHO_S * fps);
  const trechos: Trecho[] = [];
  for (let de = inicio; de < fim; de += passo) {
    const ate = Math.min(fim, de + passo);
    const cabecas: Caixa[] = [];
    for (let f = de; f < ate; f += 3) cabecas.push(cabecaAt(clip, face, motions, f, fps, W, H));
    const folga = (canto: Canto) => {
      const caixa = caixaDoCanto(canto, w, h, W, H);
      const centro = {x: (caixa.left + caixa.right) / 2, y: (caixa.top + caixa.bottom) / 2};
      const perto = cabecas.reduce(
        (menor, c) => Math.min(menor, distancia(caixa, c)),
        Infinity,
      );
      const longe = cabecas.reduce(
        (menor, c) => Math.min(menor, Math.hypot(centro.x - (c.left + c.right) / 2, centro.y - (c.top + c.bottom) / 2)),
        Infinity,
      );
      return perto + longe / 10000; // o desempate é o centro mais longe
    };
    const melhor = CANTOS.reduce((a, b) => (folga(b) > folga(a) ? b : a));
    const fixo = marca.posicao === 'automatica' ? undefined : marca.posicao;
    const canto = fixo && folga(fixo) >= 1 ? fixo : melhor;
    trechos.push({de, ate, canto, caixa: caixaDoCanto(canto, w, h, W, H)});
  }
  return trechos;
};
