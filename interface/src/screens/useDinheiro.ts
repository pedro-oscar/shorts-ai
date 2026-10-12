import { useTranslation } from "react-i18next";

import { useAppStore } from "../context";
import { formatarDolar } from "./formatos";

/** Formata um valor em US$ no idioma da interface, em R$ se a pessoa digitou a cotação. */
export function useDinheiro() {
  const { i18n } = useTranslation();
  const cotacao = useAppStore((store) => store.cotacao);
  return (usd: number) => formatarDolar(usd, i18n.language, cotacao);
}
