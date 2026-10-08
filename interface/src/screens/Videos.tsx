import { useTranslation } from "react-i18next";
import { Screen, Topo } from "./common";

/** O passo Vídeos, o segundo depois da Conta. */
export function Videos({ onOpenSobre }: { onOpenSobre: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <Screen title={t("videos.titulo")} />
    </>
  );
}
