import { useTranslation } from "react-i18next";
import { useAppStore } from "../context";
import { ErrorMessage, Screen, TextoDoAviso } from "./common";

/**
 * A versão, o Aviso de uso com a data do aceite e as licenças, com o link do código-fonte que
 * a GPL do ffmpeg pede; antes e depois do aceite.
 */
export function Sobre({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const versao = useAppStore((store) => store.app?.versao ?? "");
  const codigoFonte = useAppStore((store) => store.app?.codigoFonte ?? "");
  const abrirCodigoFonte = useAppStore((store) => store.abrirCodigoFonte);
  const erroDoCodigoFonte = useAppStore((store) => store.erroDoCodigoFonte);
  const aceite = useAppStore((store) => store.aceite);

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date(iso));

  return (
    <Screen title={t("sobre.titulo")}>
      <p>{t("sobre.versao", { versao })}</p>

      <h2>{t("aviso.titulo")}</h2>
      <p className="muted">
        {aceite
          ? t("sobre.aceitoEm", { data: formatDate(aceite.data) })
          : t("sobre.naoAceito")}
      </p>
      <TextoDoAviso headingLevel={3} />

      <h2>{t("sobre.licencaTitulo")}</h2>
      <p>{t("sobre.licenca")}</p>

      <h2>{t("sobre.terceirosTitulo")}</h2>
      <ul className="marcada">
        <li>
          {t("sobre.ffmpeg")} <code className="endereco">{codigoFonte}</code>{" "}
          <button
            type="button"
            className="discreto"
            onClick={() => {
              void abrirCodigoFonte();
            }}
          >
            {t("sobre.abrirPagina")}
          </button>
        </li>
        <li>{t("sobre.ytDlp")}</li>
        <li>{t("sobre.whisper")}</li>
        <li>{t("sobre.yunet")}</li>
        <li>{t("sobre.remotion")}</li>
        <li>{t("sobre.fontes")}</li>
      </ul>
      {erroDoCodigoFonte && <ErrorMessage erro={erroDoCodigoFonte} />}
      <p className="muted">{t("sobre.textos")}</p>

      <div className="actions fim">
        <button type="button" onClick={onBack}>
          {t("sobre.voltar")}
        </button>
      </div>
    </Screen>
  );
}
