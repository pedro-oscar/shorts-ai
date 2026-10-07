import { useTranslation } from "react-i18next";
import type { Erro } from "../bindings";
import { useAppStore } from "../context";
import { ErrorMessage, Screen } from "./common";

/** As preferências não puderam ser lidas: sem saber do aceite, o app não segue. */
export function ErroAoAbrir({ erro }: { erro: Erro }) {
  const { t } = useTranslation();
  const sair = useAppStore((store) => store.sair);
  return (
    <Screen title={t("app.nome")}>
      <ErrorMessage erro={erro} />
      <div className="actions">
        <button type="button" onClick={() => void sair()}>
          {t("aviso.sair")}
        </button>
      </div>
    </Screen>
  );
}
