import type React from 'react';

/** Toda cena é desenhada para esta caixa; o SceneFrame posiciona e escala (layout full ou card). */
export const SCENE_BOX = {width: 940, height: 760} as const;

/** Toda cena recebe as cores do estilo + as props livres de motion.json. */
export type SceneProps = {
  accent: string;
  highlight: string;
};

/** Uma cena do registro: o componente e as props que o motion.json pode passar a ele. */
export type Cena = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  componente: React.FC<any>;
  props: readonly string[];
};

/**
 * Registra uma cena com as props que ela aceita do motion.json, uma chave por prop:
 * `cena(Dinheiro, {label: true, notas: true})`. O tsc confere a lista com o tipo do componente
 * (prop a mais ou a menos é erro), e o `validar` a lê do index.ts para apontar, no roteiro, a prop
 * que a cena não aceita. `accent` e `highlight` vêm do estilo e ficam fora.
 */
export const cena = <P extends SceneProps>(
  componente: React.FC<P>,
  props: NoInfer<Record<Exclude<keyof P, keyof SceneProps>, true>>,
): Cena => ({componente, props: Object.keys(props)});
