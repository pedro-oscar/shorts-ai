import { useTranslation } from "react-i18next";
import { useAppStore } from "../context";
import { ErrorMessage, Screen, TextoDoAviso, Topo } from "./common";

/** Na primeira execução: o app só passa daqui com "Li e concordo" marcado. */
export function Aviso({
  concordo,
  onConcordoChange,
  onOpenSobre,
}: {
  concordo: boolean;
  onConcordoChange: (concordo: boolean) => void;
  onOpenSobre: () => void;
}) {
  const { t } = useTranslation();
  const aceitarAviso = useAppStore((store) => store.aceitarAviso);
  const sair = useAppStore((store) => store.sair);
  const erro = useAppStore((store) => store.erroAoAceitar);
  const backup = useAppStore((store) => store.backupDasPreferencias);

  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <Screen title={t("aviso.titulo")}>
        {backup && (
          <p role="status" className="info">
            {t("preferencias.corrompidas", { backup })}
          </p>
        )}
        <TextoDoAviso headingLevel={2} />
        <label className="agree">
          <input
            type="checkbox"
            checked={concordo}
            onChange={(event) => {
              onConcordoChange(event.target.checked);
            }}
          />
          {t("aviso.concordo")}
        </label>
        {erro && <ErrorMessage erro={erro} />}
        <div className="actions fim">
          <button type="button" onClick={() => void sair()}>
            {t("aviso.sair")}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!concordo}
            onClick={() => void aceitarAviso()}
          >
            {t("aviso.continuar")}
          </button>
        </div>
      </Screen>
    </>
  );
}
