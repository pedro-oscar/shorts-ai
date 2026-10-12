import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useAppStore } from "../context";
import { formatarTempoEstimado } from "./formatos";
import { useDinheiro } from "./useDinheiro";

/**
 * A estimativa do lote que o passo Padrões mostra antes de gerar: a faixa de custo por vídeo e
 * do lote, as sessões do Claude e o tempo nesta máquina.
 */
export function EstimativaDoLote() {
  const { t } = useTranslation();
  const dinheiro = useDinheiro();
  const plano = useAppStore((store) => store.plano);
  const estimativa = useAppStore((store) => store.estimativa);
  const estimar = useAppStore((store) => store.estimar);
  const padroes = useAppStore((store) => store.padroes);
  const arquivos = useAppStore((store) => store.arquivos);
  const links = useAppStore((store) => store.links);
  const faixas = useAppStore((store) => store.faixas);
  useEffect(() => {
    void estimar();
  }, [estimar, padroes, arquivos, links, faixas]);
  if (!estimativa) return null;
  const fator =
    plano && !plano.precoDeApi && plano.fatorDeCusto ? plano.fatorDeCusto : 1;
  const faixa = (de: number, ate: number) =>
    t("estimativa.faixa", {
      de: dinheiro(de * fator),
      ate: dinheiro(ate * fator),
    });
  return (
    <section aria-label={t("estimativa.titulo")}>
      <h3>{t("estimativa.titulo")}</h3>
      <p className="detail">
        {estimativa.inicial
          ? t("estimativa.inicial")
          : t("estimativa.calibrada", { count: estimativa.execucoes })}
      </p>
      <ul className="detail">
        <li>
          {t("estimativa.porVideo", {
            faixa: faixa(
              estimativa.porVideo.deUsd ?? 0,
              estimativa.porVideo.ateUsd ?? 0,
            ),
          })}
        </li>
        <li>
          {t("estimativa.lote", {
            faixa: faixa(
              estimativa.lote.deUsd ?? 0,
              estimativa.lote.ateUsd ?? 0,
            ),
          })}
        </li>
        <li>{t("estimativa.sessoes", { count: estimativa.sessoes })}</li>
        <li>
          {t("estimativa.tempo", {
            de: formatarTempoEstimado(estimativa.tempo.deS ?? 0),
            ate: formatarTempoEstimado(estimativa.tempo.ateS ?? 0),
          })}
        </li>
      </ul>
      {estimativa.semPreco && (
        <p className="detail">{t("estimativa.semPreco")}</p>
      )}
    </section>
  );
}
