import { useTranslation } from "react-i18next";
import type { ProjetoResumo } from "../bindings";
import { useAppStore } from "../context";
import { Screen, Topo } from "./common";

/** O estado do projeto e a etapa N/5 em que ele está (a próxima a rodar, se parou). */
function resumir(projeto: ProjetoResumo) {
  const concluidas = projeto.etapas.filter((e) => e.estado === "concluida");
  const iniciado = projeto.etapas.some((e) => e.estado !== "pendente");
  const falhou = projeto.etapas.some((e) => e.estado === "falhou");
  const estado = falhou
    ? "falhou"
    : concluidas.length === projeto.etapas.length
      ? "pronto"
      : iniciado
        ? "emAndamento"
        : "naFila";
  return {
    estado,
    concluidas: concluidas.length,
    etapa: Math.min(concluidas.length + 1, projeto.etapas.length),
  } as const;
}

/** O passo Gerando: cada projeto do lote com o estado e as etapas, ao vivo. */
export function Gerando({ onOpenSobre }: { onOpenSobre: () => void }) {
  const { t } = useTranslation();
  const projetos = useAppStore((store) => store.projetos);
  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <Screen title={t("gerando.titulo")}>
        <ul className="project-list">
          {projetos.map((projeto) => {
            const resumo = resumir(projeto);
            return (
              <li key={projeto.id} aria-label={projeto.titulo}>
                <strong>{projeto.titulo}</strong>
                <span>
                  {t(`gerando.estados.${resumo.estado}`)}
                  {resumo.estado === "emAndamento" &&
                    ` · ${t("gerando.etapaNdeM", {
                      n: resumo.etapa,
                      m: projeto.etapas.length,
                    })}`}
                </span>
                <progress
                  value={resumo.concluidas}
                  max={projeto.etapas.length}
                  aria-label={t("gerando.progresso", { nome: projeto.titulo })}
                />
                <ol className="stages">
                  {projeto.etapas.map((item) => (
                    <li key={item.etapa}>
                      {t(`gerando.etapas.${item.etapa}`)}:{" "}
                      {t(`gerando.estadosDaEtapa.${item.estado}`)}
                    </li>
                  ))}
                </ol>
                {projeto.falha && (
                  <p role="alert" className="error detail">
                    {t("erros.detalhe", { detalhe: projeto.falha })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </Screen>
    </>
  );
}
