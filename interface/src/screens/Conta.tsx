import { useTranslation } from "react-i18next";
import { Screen, Topo } from "./common";

/** O passo Conta, o primeiro depois do aceite. */
export function Conta({ onOpenSobre }: { onOpenSobre: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <Screen title={t("conta.titulo")} />
    </>
  );
}
