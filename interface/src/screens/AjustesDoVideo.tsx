import { useTranslation } from "react-i18next";
import { useAppStore } from "../context";
import { Dialogo } from "./common";
import { CamposDaFaixa, CamposDeExcecoes } from "./Excecoes";
import { SEM_CAMPOS } from "./formatos";

/**
 * A janela Ajustes de um vídeo da folha: a Faixa e as Exceções dele, aplicadas na hora à
 * lista. `chave` é o caminho do arquivo ou o endereço do link.
 */
export function AjustesDoVideo({
  chave,
  nome,
  onFechar,
}: {
  chave: string;
  nome: string;
  onFechar: () => void;
}) {
  const { t } = useTranslation();
  const faixa = useAppStore((store) => store.faixas[chave]);
  const definirFaixa = useAppStore((store) => store.definirFaixa);
  const campos = useAppStore((store) => store.excecoes[chave] ?? SEM_CAMPOS);
  const definirExcecoes = useAppStore((store) => store.definirExcecoesDoVideo);
  return (
    <Dialogo titulo={t("ajustes.titulo", { nome })} onFechar={onFechar}>
      <CamposDaFaixa
        nome={nome}
        inicio={faixa?.inicio ?? ""}
        fim={faixa?.fim ?? ""}
        onChange={(campo, texto) => {
          definirFaixa(chave, campo, texto);
        }}
      />
      <CamposDeExcecoes
        nome={nome}
        campos={campos}
        onChange={(mudancas) => {
          definirExcecoes(chave, mudancas);
        }}
      />
      <div className="actions fim">
        <button type="button" className="primary" onClick={onFechar}>
          {t("ajustes.pronto")}
        </button>
      </div>
    </Dialogo>
  );
}
