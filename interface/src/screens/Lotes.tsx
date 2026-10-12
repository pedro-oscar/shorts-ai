import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../context";
import { Screen, Topo } from "./common";
import { resumir } from "./formatos";

/** O histórico: os lotes da Biblioteca e os vídeos de cada um. */
export function Lotes({
  onOpenSobre,
  onVoltar,
  onAbrir,
}: {
  onOpenSobre: () => void;
  onVoltar: () => void;
  onAbrir: (lote: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lotes = useAppStore((store) => store.lotes);
  const projetos = useAppStore((store) => store.projetos);
  const carregarLotes = useAppStore((store) => store.carregarLotes);
  useEffect(() => {
    void carregarLotes();
  }, [carregarLotes]);
  const formato = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "short",
    timeStyle: "short",
  });
  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <Screen title={t("lotes.titulo")}>
        <button type="button" onClick={onVoltar}>
          {t("lotes.voltar")}
        </button>
        {lotes.length === 0 && <p>{t("lotes.vazio")}</p>}
        <ul className="project-list">
          {lotes.map((lote) => {
            const doLote = projetos.filter((p) => p.lote === lote.id);
            return (
              <li key={lote.id} aria-label={lote.nome}>
                <strong>{lote.nome}</strong>
                <span>
                  {formato.format(new Date(lote.criadoEm))}
                  {` · ${t("lotes.projetos", { count: doLote.length })}`}
                </span>
                <ul aria-label={t("lotes.projetosDe", { nome: lote.nome })}>
                  {doLote.map((projeto) => (
                    <li key={projeto.id}>
                      {projeto.titulo}
                      {` · ${t(`gerando.estados.${resumir(projeto).estado}`)}`}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  aria-label={t("lotes.abrirDe", { nome: lote.nome })}
                  onClick={() => {
                    onAbrir(lote.id);
                  }}
                >
                  {t("lotes.abrir")}
                </button>
              </li>
            );
          })}
        </ul>
      </Screen>
    </>
  );
}
