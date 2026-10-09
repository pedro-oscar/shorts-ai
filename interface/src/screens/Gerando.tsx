import { useTranslation } from "react-i18next";
import type { ProjetoResumo } from "../bindings";
import { useAppStore } from "../context";
import type { AcaoDoClaude } from "../store";
import { Screen, Topo } from "./common";
import { producaoConcluida } from "./formatos";

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

/** Uma ação como o Claude a fez: "→ Read …", ou o texto que ele escreveu, entre aspas. */
function Acao({ acao }: { acao: AcaoDoClaude }) {
  const { t } = useTranslation();
  if (acao.ferramenta === "texto")
    return <li>{t("gerando.textoDoClaude", { texto: acao.alvo ?? "" })}</li>;
  return (
    <li>
      {acao.alvo === null
        ? t("gerando.acaoSemAlvo", { ferramenta: acao.ferramenta })
        : t("gerando.acao", { ferramenta: acao.ferramenta, alvo: acao.alvo })}
    </li>
  );
}

/** O passo Gerando: cada projeto do lote com o estado e as etapas, ao vivo. */
export function Gerando({
  onOpenSobre,
  onVerReels,
}: {
  onOpenSobre: () => void;
  onVerReels: () => void;
}) {
  const { t } = useTranslation();
  const projetos = useAppStore((store) => store.projetos);
  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <Screen title={t("gerando.titulo")}>
        {projetos.some(producaoConcluida) && (
          <button type="button" onClick={onVerReels}>
            {t("gerando.verReels")}
          </button>
        )}
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
                  {projeto.percentual !== null &&
                    ` · ${t("gerando.percentual", {
                      percentual: projeto.percentual,
                    })}`}
                </span>
                <progress
                  value={resumo.concluidas + (projeto.percentual ?? 0) / 100}
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
                {projeto.acoes.length > 0 && (
                  <ol
                    className="claude-actions"
                    aria-label={t("gerando.acoesDoClaude")}
                  >
                    {projeto.acoes.map((acao) => (
                      <Acao key={acao.numero} acao={acao} />
                    ))}
                  </ol>
                )}
                {projeto.tokens && (
                  <p className="detail">
                    {t("gerando.tokens", {
                      entrada: projeto.tokens.entrada,
                      cache: projeto.tokens.cache,
                    })}
                  </p>
                )}
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
