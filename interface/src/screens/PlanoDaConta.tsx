import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { NivelDoPlano, PeriodoDeCobranca } from "../bindings";
import { useAppStore } from "../context";
import { niveisDoPlano } from "./niveisDoPlano";

const PRECO_DE_API: NivelDoPlano[] = ["console", "enterprise"];

/** A pessoa confirma o nível e a cobrança do plano, que o Claude Code não informa. */
export function PlanoDaConta({ plano }: { plano: string | null }) {
  const { t } = useTranslation();
  const confirmado = useAppStore((store) => store.plano);
  const confirmarPlano = useAppStore((store) => store.confirmarPlano);
  const niveis = niveisDoPlano(plano);
  const [nivel, setNivel] = useState<NivelDoPlano | null>(
    confirmado && niveis.includes(confirmado.nivel)
      ? confirmado.nivel
      : ((niveis.length === 1 ? niveis[0] : null) ?? null),
  );
  const [periodo, setPeriodo] = useState<PeriodoDeCobranca>(
    confirmado?.periodo ?? "mensal",
  );
  const precoDeApi = nivel !== null && PRECO_DE_API.includes(nivel);
  const nomeDoNivel = (n: NivelDoPlano) => t(`conta.plano.niveis.${n}`);

  return (
    <section aria-labelledby="plano-titulo">
      <h2 id="plano-titulo">{t("conta.plano.titulo")}</h2>
      <p className="muted">{t("conta.plano.explicacao")}</p>
      <fieldset>
        <legend>{t("conta.plano.nivel")}</legend>
        {niveis.map((opcao) => (
          <label key={opcao}>
            <input
              type="radio"
              name="nivel-do-plano"
              checked={nivel === opcao}
              onChange={() => {
                setNivel(opcao);
              }}
            />{" "}
            {nomeDoNivel(opcao)}
            {PRECO_DE_API.includes(opcao) &&
              ` (${t("conta.plano.precoDeApi")})`}
          </label>
        ))}
      </fieldset>
      {nivel !== null && !precoDeApi && (
        <fieldset>
          <legend>{t("conta.plano.cobranca")}</legend>
          {(["mensal", "anual"] as const).map((opcao) => (
            <label key={opcao}>
              <input
                type="radio"
                name="periodo-do-plano"
                checked={periodo === opcao}
                onChange={() => {
                  setPeriodo(opcao);
                }}
              />{" "}
              {t(`conta.plano.periodos.${opcao}`)}
            </label>
          ))}
        </fieldset>
      )}
      <div className="actions">
        <button
          type="button"
          disabled={nivel === null}
          onClick={() => {
            if (nivel !== null) void confirmarPlano(nivel, periodo);
          }}
        >
          {t("conta.plano.confirmar")}
        </button>
      </div>
      {confirmado && niveis.includes(confirmado.nivel) && (
        <p role="status">
          {confirmado.precoDeApi
            ? t("conta.plano.confirmadoPrecoDeApi", {
                nivel: nomeDoNivel(confirmado.nivel),
              })
            : t("conta.plano.confirmado", {
                nivel: nomeDoNivel(confirmado.nivel),
                periodo: t(
                  `conta.plano.periodos.${confirmado.periodo ?? "mensal"}`,
                ).toLowerCase(),
              })}
        </p>
      )}
    </section>
  );
}
