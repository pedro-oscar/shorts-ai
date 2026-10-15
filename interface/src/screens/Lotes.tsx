import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../context";
import { Screen, Topo } from "./common";
import { VideoAusente } from "./LinhaDeProducao";
import { resumir } from "./formatos";

/** O histórico: os lotes da Biblioteca e os vídeos de cada um, para abrir na Linha. */
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
  const loteAtual = useAppStore((store) => store.loteAtual);
  const projetos = useAppStore((store) => store.projetos);
  const tirarDoHistorico = useAppStore((store) => store.tirarDoHistorico);
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
      <Screen larga title={t("lotes.titulo")}>
        <div className="actions">
          <button type="button" onClick={onVoltar}>
            {t("lotes.voltar")}
          </button>
        </div>
        {lotes.length === 0 && <p className="muted">{t("lotes.vazio")}</p>}
        <ul className="lotes">
          {lotes.map((lote) => {
            const doLote = projetos.filter((p) => p.lote === lote.id);
            return (
              <li
                key={lote.id}
                aria-label={lote.nome}
                className={lote.id === loteAtual ? "aberto" : undefined}
              >
                <div>
                  <strong>{lote.nome}</strong>
                  {lote.aberto && (
                    <>
                      {" "}
                      <span className="chip acento">{t("lotes.aberto")}</span>
                    </>
                  )}
                </div>
                <span className="detail">
                  {formato.format(new Date(lote.criadoEm))}
                  {` · ${t("lotes.projetos", { count: doLote.length })}`}
                </span>
                <ul aria-label={t("lotes.projetosDe", { nome: lote.nome })}>
                  {doLote.map((projeto) => (
                    <li key={projeto.id}>
                      {projeto.titulo}
                      {` · ${t(`linha.estados.${resumir(projeto).estado}`)}`}
                      {projeto.videoAusente && (
                        <VideoAusente projeto={projeto} />
                      )}
                    </li>
                  ))}
                  {lote.ausentes.map((id) => (
                    <li key={id}>
                      {id}
                      {` · ${t("lotes.naoEncontrado")} · `}
                      <button
                        type="button"
                        className="discreto"
                        aria-label={t("lotes.tirarDe", { nome: id })}
                        onClick={() => {
                          void tirarDoHistorico(id);
                        }}
                      >
                        {t("lotes.tirarDoHistorico")}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="actions">
                  <button
                    type="button"
                    className={lote.id === loteAtual ? undefined : "primary"}
                    aria-label={t("lotes.abrirDe", { nome: lote.nome })}
                    onClick={() => {
                      onAbrir(lote.id);
                    }}
                  >
                    {t("lotes.abrir")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </Screen>
    </>
  );
}
