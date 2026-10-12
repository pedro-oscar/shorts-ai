import { useTranslation } from "react-i18next";

import type { CustoDaSessao, ResumoDeCusto } from "../bindings";
import { formatarDolar, formatarDuracao, temCusto } from "./formatos";

/** O custo estimado de um projeto ou de um lote, com o rateio por reel e a marca de conferir. */
export function ResumoDoCusto({
  custo,
  rotulo,
}: {
  custo: ResumoDeCusto;
  rotulo: string;
}) {
  const { t, i18n } = useTranslation();
  if (!temCusto(custo)) return null;
  return (
    <p className="detail" aria-label={rotulo}>
      {t("custo.estimado", {
        valor: formatarDolar(custo.custoUsd ?? 0, i18n.language),
      })}
      {custo.porReelUsd !== null &&
        ` · ${t("custo.porReel", {
          valor: formatarDolar(custo.porReelUsd, i18n.language),
        })}`}
      {custo.parcial && ` · ${t("custo.parcial")}`}
      {custo.precoAConferir && ` · ${t("custo.aConferir")}`}
    </p>
  );
}

/** A parte dos tokens que veio do cache, em %. */
function percentualDeCache(sessao: CustoDaSessao): number {
  const { entrada, cacheLeitura, cacheCriacao } = sessao.tokens;
  const total = entrada + cacheLeitura + cacheCriacao;
  return total === 0 ? 0 : Math.round((cacheLeitura / total) * 100);
}

/** Uma sessão do Claude: etapa, tokens, % de cache, tempo e modelo. */
function Sessao({ sessao }: { sessao: CustoDaSessao }) {
  const { t, i18n } = useTranslation();
  const { tokens } = sessao;
  const etapa =
    sessao.etapa === "revisao"
      ? t("custo.revisao", { n: sessao.ordem })
      : t(`gerando.etapas.${sessao.etapa}`);
  return (
    <li>
      <strong>{etapa}</strong>{" "}
      {t("custo.sessao", {
        valor: formatarDolar(sessao.custoUsd ?? 0, i18n.language),
        entrada: tokens.entrada,
        saida: tokens.saida,
        cacheLeitura: tokens.cacheLeitura,
        cacheCriacao: tokens.cacheCriacao,
        cache: percentualDeCache(sessao),
        tempo: formatarDuracao(sessao.duracaoS ?? 0),
        modelo: sessao.modelos.join(", "),
      })}
      {sessao.parcial && ` · ${t("custo.parcial")}`}
      {sessao.precoAConferir && ` · ${t("custo.aConferir")}`}
    </li>
  );
}

/** O custo de cada sessão do Claude do projeto. */
export function DetalheDoCusto({ custo }: { custo: ResumoDeCusto }) {
  const { t } = useTranslation();
  if (custo.sessoes.length === 0) return null;
  return (
    <ul className="stages" aria-label={t("custo.detalhe")}>
      {custo.sessoes.map((sessao) => (
        <Sessao
          key={`${sessao.etapa}-${String(sessao.ordem)}`}
          sessao={sessao}
        />
      ))}
    </ul>
  );
}
