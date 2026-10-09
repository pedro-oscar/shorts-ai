import { useTranslation } from "react-i18next";
import { useAppStore } from "../context";
import { ErrorMessage, Screen, Topo } from "./common";
import { formatarDuracao } from "./formatos";

/** O passo Vídeos: os arquivos do computador que viram um lote ao apertar Gerar. */
export function Videos({
  onOpenSobre,
  onGerado,
}: {
  onOpenSobre: () => void;
  onGerado: () => void;
}) {
  const { t } = useTranslation();
  const arquivos = useAppStore((store) => store.arquivos);
  const erro = useAppStore((store) => store.erroDeArquivos);
  const biblioteca = useAppStore((store) => store.biblioteca);
  const escolher = useAppStore((store) => store.escolherArquivos);
  const remover = useAppStore((store) => store.removerArquivo);
  const gerar = useAppStore((store) => store.gerar);
  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <Screen title={t("videos.titulo")}>
        <div role="tablist">
          <button type="button" role="tab" aria-selected="true">
            {t("videos.abaArquivos")}
          </button>
        </div>
        <div role="tabpanel" className="drop-zone">
          <p>{t("videos.soltar")}</p>
          <button
            type="button"
            onClick={() => {
              void escolher();
            }}
          >
            {t("videos.escolher")}
          </button>
        </div>
        {erro && <ErrorMessage erro={erro} />}
        {arquivos.length > 0 && (
          <ul aria-label={t("videos.lista")} className="file-list">
            {arquivos.map((arquivo) => (
              <li key={arquivo.caminho}>
                <span className="file-name">{arquivo.nome}</span>
                <span className="file-duration">
                  {formatarDuracao(arquivo.duracaoEmSegundos)}
                </span>
                <button
                  type="button"
                  aria-label={t("videos.removerArquivo", {
                    nome: arquivo.nome,
                  })}
                  onClick={() => {
                    remover(arquivo.caminho);
                  }}
                >
                  {t("videos.remover")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="detail">
          {t("videos.biblioteca", { pasta: biblioteca })}
        </p>
        <button
          type="button"
          disabled={arquivos.length === 0}
          onClick={() => {
            void gerar().then((criou) => {
              if (criou) onGerado();
            });
          }}
        >
          {t("videos.gerar")}
        </button>
      </Screen>
    </>
  );
}
