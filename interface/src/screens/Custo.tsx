import { useTranslation } from "react-i18next";

import type { CustoDaSessao, ResumoDeCusto } from "../bindings";
import { useAppStore } from "../context";
import {
  INCERTEZA_DO_MULTIPLICADOR,
  formatarDolar,
  formatarDuracao,
  temCusto,
} from "./formatos";

/** Formata um valor em US$ no idioma da interface, em R$ se a pessoa digitou a cotação. */
function useDinheiro() {
  const { i18n } = useTranslation();
  const cotacao = useAppStore((store) => store.cotacao);
  return (usd: number) => formatarDolar(usd, i18n.language, cotacao);
}

/** O custo estimado de um projeto ou de um lote, com o rateio por reel e a marca de conferir. */
export function ResumoDoCusto({
  custo,
  rotulo,
}: {
  custo: ResumoDeCusto;
  rotulo: string;
}) {
  const { t } = useTranslation();
  const plano = useAppStore((store) => store.plano);
  const dinheiro = useDinheiro();
  if (!temCusto(custo)) return null;
  const api = custo.custoUsd ?? 0;
  const fator =
    plano && !plano.precoDeApi && plano.fatorDeCusto
      ? plano.fatorDeCusto
      : null;
  const marcas = (
    <>
      {custo.parcial && ` · ${t("custo.parcial")}`}
      {custo.precoAConferir && ` · ${t("custo.aConferir")}`}
    </>
  );
  const porReel = (usd: number) =>
    custo.porReelUsd !== null &&
    ` · ${t("custo.porReel", { valor: dinheiro(usd) })}`;
  if (fator === null) {
    const chave = plano?.precoDeApi ? "custo.cobranca" : "custo.estimado";
    return (
      <p className="detail" aria-label={rotulo}>
        {t(chave, { valor: dinheiro(api) })}
        {custo.porReelUsd !== null && porReel(custo.porReelUsd)}
        {marcas}
      </p>
    );
  }
  const faixa = t("custo.faixa", {
    de: dinheiro(api * fator * (1 - INCERTEZA_DO_MULTIPLICADOR)),
    ate: dinheiro(api * fator * (1 + INCERTEZA_DO_MULTIPLICADOR)),
  });
  return (
    <div className="detail" role="group" aria-label={rotulo}>
      <p>
        <strong title={faixa}>
          {t("custo.noPlano", { valor: dinheiro(api * fator) })}
        </strong>{" "}
        ({t("custo.estimadoMarca")})
        {custo.porReelUsd !== null && porReel(custo.porReelUsd * fator)}
        {marcas}
      </p>
      <p className="muted">
        {t("custo.emPrecoDeApi", { valor: dinheiro(api) })}
      </p>
    </div>
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
  const { t } = useTranslation();
  const dinheiro = useDinheiro();
  const { tokens } = sessao;
  const etapa =
    sessao.etapa === "revisao"
      ? t("custo.revisao", { n: sessao.ordem })
      : t(`gerando.etapas.${sessao.etapa}`);
  return (
    <li>
      <strong>{etapa}</strong>{" "}
      {t("custo.sessao", {
        valor: dinheiro(sessao.custoUsd ?? 0),
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
