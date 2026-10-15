import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useAppStore } from "../context";
import { formatarTempoEstimado } from "./formatos";
import { useDinheiro } from "./useDinheiro";

/**
 * A estimativa do lote que a folha de Vídeos mostra antes de gerar: a faixa de custo do lote
 * e por vídeo, as sessões do Claude e o tempo nesta máquina.
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
    <section className="estimativa" aria-label={t("estimativa.titulo")}>
      <strong>
        {t("estimativa.lote", {
          faixa: faixa(estimativa.lote.deUsd ?? 0, estimativa.lote.ateUsd ?? 0),
        })}
      </strong>
      <span>
        {[
          t("estimativa.porVideo", {
            faixa: faixa(
              estimativa.porVideo.deUsd ?? 0,
              estimativa.porVideo.ateUsd ?? 0,
            ),
          }),
          t("estimativa.sessoes", { count: estimativa.sessoes }),
          t("estimativa.tempo", {
            de: formatarTempoEstimado(estimativa.tempo.deS ?? 0),
            ate: formatarTempoEstimado(estimativa.tempo.ateS ?? 0),
          }),
        ].join(" · ")}
      </span>
      <span className="detail">
        {estimativa.inicial
          ? t("estimativa.inicial")
          : t("estimativa.calibrada", { count: estimativa.execucoes })}
      </span>
      {estimativa.semPreco && (
        <span className="detail">{t("estimativa.semPreco")}</span>
      )}
    </section>
  );
}
