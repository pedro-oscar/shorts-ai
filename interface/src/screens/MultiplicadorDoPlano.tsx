import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../context";

/** O multiplicador do plano em uso, que a pessoa pode ajustar; só a assinatura tem um. */
export function MultiplicadorDoPlano() {
  const { t, i18n } = useTranslation();
  const plano = useAppStore((store) => store.plano);
  const definirMultiplicador = useAppStore(
    (store) => store.definirMultiplicador,
  );
  const [texto, setTexto] = useState<string | null>(null);
  if (!plano || plano.precoDeApi || !plano.multiplicador) return null;

  const valor = texto ?? String(plano.multiplicador);
  const numero = Number(valor.replace(",", "."));
  return (
    <section aria-labelledby="multiplicador-titulo">
      <h3 id="multiplicador-titulo">{t("configuracoes.multiplicador")}</h3>
      <p className="muted">
        {t("configuracoes.multiplicadorDica", {
          nivel: t(`conta.plano.niveis.${plano.nivel}`),
          padrao: (plano.multiplicadorPadrao ?? 1).toLocaleString(
            i18n.language,
          ),
        })}
      </p>
      <label>
        {t("configuracoes.multiplicadorCampo")}
        <input
          type="text"
          inputMode="decimal"
          value={valor}
          onChange={(event) => {
            setTexto(event.target.value);
          }}
        />
      </label>
      <div className="actions">
        <button
          type="button"
          disabled={valor.trim() === "" || Number.isNaN(numero)}
          onClick={() => {
            void definirMultiplicador(numero).then(() => {
              setTexto(null);
            });
          }}
        >
          {t("configuracoes.salvarMultiplicador")}
        </button>
        <button
          type="button"
          disabled={plano.multiplicadorProprio == null}
          onClick={() => {
            void definirMultiplicador(null).then(() => {
              setTexto(null);
            });
          }}
        >
          {t("configuracoes.multiplicadorPadrao")}
        </button>
      </div>
    </section>
  );
}
