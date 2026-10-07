import { createInstance, type i18n } from "i18next";
import type { IdiomaDaInterface } from "./bindings";
import { en } from "./locales/en";
import { ptBR } from "./locales/pt-BR";

declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: typeof ptBR };
  }
}

/** Os textos no idioma que o núcleo escolheu; os recursos vêm juntos, sem carga assíncrona. */
export function createI18n(idioma: IdiomaDaInterface): i18n {
  const instance = createInstance();
  void instance.init({
    lng: idioma,
    resources: { "pt-BR": { translation: ptBR }, en: { translation: en } },
    initAsync: false,
    // O React já escapa o que mostra.
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return instance;
}
