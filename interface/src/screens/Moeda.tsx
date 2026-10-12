import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../context";

/** US$ ou R$: em reais, com a cotação que a pessoa digitou e o dia em que o fez. */
export function Moeda() {
  const { t } = useTranslation();
  const cotacao = useAppStore((store) => store.cotacao);
  const definirCotacao = useAppStore((store) => store.definirCotacao);
  const [texto, setTexto] = useState<string | null>(null);

  const valor = texto ?? (cotacao?.valor == null ? "" : String(cotacao.valor));
  const numero = Number(valor.replace(",", "."));
  return (
    <section aria-labelledby="moeda-titulo">
      <h2 id="moeda-titulo">{t("configuracoes.moedaTitulo")}</h2>
      <p className="muted">{t("configuracoes.moedaDica")}</p>
      <label>
        {t("configuracoes.cotacao")}
        <input
          type="text"
          inputMode="decimal"
          value={valor}
          onChange={(event) => {
            setTexto(event.target.value);
          }}
        />
      </label>
      {cotacao && (
        <p className="muted">
          {t("configuracoes.cotacaoDe", {
            data: new Date(`${cotacao.data}T12:00:00`).toLocaleDateString(),
          })}
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          disabled={valor.trim() === "" || Number.isNaN(numero)}
          onClick={() => {
            void definirCotacao(numero).then(() => {
              setTexto(null);
            });
          }}
        >
          {t("configuracoes.usarReais")}
        </button>
        <button
          type="button"
          disabled={cotacao === null}
          onClick={() => {
            void definirCotacao(null).then(() => {
              setTexto(null);
            });
          }}
        >
          {t("configuracoes.usarDolares")}
        </button>
      </div>
    </section>
  );
}
