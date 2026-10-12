import {measureText} from '@remotion/layout-utils';
import {cabecaAt} from '../components/camera';
import {TOPO_SEGURO, type Trecho} from '../logo';
import {SCENE_BOX} from '../scenes/types';
import type {Style} from '../theme';
import type {ClipInfo, FaceTrack, Motion} from '../types';

/**
 * Posicionamento automático: nenhum texto ou card fica em cima da cabeça de quem está em foco.
 *
 * Para cada motion, junta a caixa da cabeça (cabelo → pescoço) em todos os frames em que ele
 * aparece e escolhe um espaço livre:
 *   1. acima da cabeça (abaixo da barra do app)
 *   2. entre a cabeça e a legenda
 * Encolhe o elemento até uma escala mínima para caber. Se um card não cabe em lugar nenhum, vira
 * cena "full" (substitui a imagem por alguns segundos em vez de cobrir o rosto). Dois motions
 * simultâneos não disputam o mesmo espaço. O retângulo da logo é reservado: nenhum elemento
 * ocupa o espaço dela enquanto ela aparece.
 */

export type Area = {top: number; height: number};
export type Zona = 'acima' | 'abaixo' | 'tela';
export type Placement = {area: Area; scale: number; zona: Zona; layout?: 'card' | 'full'};

const FOLGA = 28; // distância mínima entre o elemento e a cabeça
const MEIA_LEGENDA = 150; // a legenda ocupa ~±150 px em volta de captionY

const ESCALA_MIN: Record<string, number> = {title: 0.62, keyword: 0.5, counter: 0.55, scene: 0.5};

/** Quantas linhas o texto ocupa em caixa alta na fonte dos títulos, medido com a fonte já carregada. */
const linhas = (texto: string, fontSize: number, larguraMax: number, fonte: string, letterSpacing: number) => {
  const largura = (t: string) =>
    measureText({
      text: t,
      fontFamily: `"${fonte}"`,
      fontWeight: 900,
      fontSize,
      letterSpacing: `${letterSpacing}px`,
      textTransform: 'uppercase',
      validateFontIsLoaded: true,
    }).width;
  let total = 1;
  let atual = '';
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (atual && largura(tentativa) > larguraMax) {
      total += 1;
      atual = palavra;
    } else {
      atual = tentativa;
    }
  }
  return total;
};

/** Altura natural (escala 1) de cada tipo de elemento, em px. null = não ocupa espaço. */
export const alturaNatural = (m: Motion, fonte: string): number | null => {
  switch (m.type) {
    case 'title':
      return linhas(m.text, 64, 870, fonte, 0) * 68 + 40;
    case 'keyword':
      return linhas(m.text, 120, 980, fonte, -2) * 116 + 30;
    case 'counter':
      return 160 + (m.label ? 76 : 0);
    case 'scene':
      return SCENE_BOX.height + 10;
    default:
      return null;
  }
};

const TELA_CHEIA = (H: number): Placement => ({area: {top: 0, height: H}, scale: 1, zona: 'tela', layout: 'full'});

export const planejarLayout = (
  motions: Motion[],
  clip: ClipInfo,
  face: FaceTrack,
  style: Style,
  fps: number,
  W: number,
  H: number,
  logo: Trecho[] = [],
): (Placement | null)[] => {
  const limiteLegenda = H * style.captionY - MEIA_LEGENDA;
  const ocupado: {zona: Zona; de: number; ate: number}[] = [];

  return motions.map((m) => {
    if (m.type === 'flash' || m.type === 'zoom' || m.type === 'shake') return null;
    if (m.type === 'scene' && (m.layout ?? 'full') === 'full') return TELA_CHEIA(H);
    const precisa = alturaNatural(m, style.fonteTitulos);
    if (precisa === null) return null;

    const de = Math.round(m.start * fps);
    const ate = Math.round(m.end * fps);
    let topoCabeca = Infinity;
    let baseCabeca = -Infinity;
    for (let f = de; f <= ate; f += 3) {
      const c = cabecaAt(clip, face, motions, f, fps, W, H);
      topoCabeca = Math.min(topoCabeca, c.top);
      baseCabeca = Math.max(baseCabeca, c.bottom);
    }

    // A logo ocupa a faixa de cima ou a de baixo enquanto aparece; o elemento fica fora dela.
    let topoLivre = TOPO_SEGURO;
    let limiteBaixo = limiteLegenda;
    for (const t of logo) {
      if (t.de >= ate || de >= t.ate) continue;
      if (t.caixa.top < H / 2) topoLivre = Math.max(topoLivre, t.caixa.bottom + FOLGA);
      else limiteBaixo = Math.min(limiteBaixo, t.caixa.top - FOLGA);
    }
    const zonas: {zona: Zona; area: Area}[] = [
      {zona: 'acima', area: {top: topoLivre, height: topoCabeca - FOLGA - topoLivre}},
      {zona: 'abaixo', area: {top: baseCabeca + FOLGA, height: limiteBaixo - (baseCabeca + FOLGA)}},
    ];
    const minimo = ESCALA_MIN[m.type] ?? 0.6;
    const livre = (z: Zona) => !ocupado.some((o) => o.zona === z && o.de < ate && de < o.ate);
    const cabeInteiro = (a: Area) => a.height >= precisa;
    const cabeReduzido = (a: Area) => a.height >= precisa * minimo;

    let escolha =
      zonas.find((z) => livre(z.zona) && cabeInteiro(z.area)) ??
      zonas.find((z) => livre(z.zona) && cabeReduzido(z.area)) ??
      zonas.find((z) => cabeReduzido(z.area));

    if (!escolha) {
      if (m.type === 'scene') return TELA_CHEIA(H);
      // Sem espaço (rosto muito fechado): a maior zona, na escala mínima. Pode encostar, mas o mínimo possível.
      escolha = zonas[0].area.height >= zonas[1].area.height ? zonas[0] : zonas[1];
    }
    ocupado.push({zona: escolha.zona, de, ate});
    const scale = Math.max(minimo, Math.min(1, escolha.area.height / precisa));
    return {
      area: {top: escolha.area.top, height: Math.max(escolha.area.height, precisa * scale)},
      scale,
      zona: escolha.zona,
      layout: m.type === 'scene' ? 'card' : undefined,
    };
  });
};
