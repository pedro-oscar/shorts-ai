import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Dependencia, Diagnostico as Retrato } from "../bindings";
import { useAppStore } from "../context";
import { ErrorMessage, Screen, Topo } from "./common";

/** A situação de uma dependência, em uma frase. */
function situacaoEmTexto(t: TFunction, dependencia: Dependencia): string {
  const { situacao } = dependencia;
  switch (situacao.tipo) {
    case "presente":
      return situacao.versao
        ? t("diagnostico.presenteComVersao", { versao: situacao.versao })
        : t("diagnostico.presente");
    case "ausente":
      return t("diagnostico.ausente");
    case "incompleta":
      return t("diagnostico.incompleta", {
        faltam: situacao.faltam.join(", "),
      });
  }
}

function contaEmTexto(t: TFunction, conta: Retrato["conta"]): string {
  switch (conta.tipo) {
    case "naoInstalado":
      return t("diagnostico.conta.naoInstalado");
    case "versaoAntiga":
      return t("diagnostico.conta.versaoAntiga", {
        versao: conta.versao,
        minima: conta.minima,
      });
    case "semLogin":
      return t("diagnostico.conta.semLogin", { versao: conta.versao });
    case "logado":
      return t("diagnostico.conta.logado", {
        versao: conta.versao,
        plano: conta.plano ?? t("diagnostico.conta.planoConsole"),
      });
  }
}

function discoEmTexto(t: TFunction, retrato: Retrato): string {
  return retrato.espacoLivreEmMb === null
    ? t("diagnostico.discoDesconhecido")
    : t("diagnostico.discoLivre", {
        gb: (retrato.espacoLivreEmMb / 1000).toFixed(1),
      });
}

/** O relatório para colar onde a pessoa pedir ajuda: sem caminhos nem e-mail. */
function relatorio(
  t: TFunction,
  versao: string,
  retrato: Retrato,
  teste: "pendente" | "testando" | "ok" | "falhou",
): string {
  const linhas = [
    t("diagnostico.relatorio", { versao }),
    `${t("diagnostico.gpu")}: ${t(`diagnostico.gpus.${retrato.gpu}`)}`,
    `${t("diagnostico.disco")}: ${discoEmTexto(t, retrato)}`,
    ...retrato.dependencias.map(
      (dependencia) =>
        `${t(`diagnostico.nomes.${dependencia.nome}`)}: ${situacaoEmTexto(t, dependencia)}`,
    ),
    `${t("diagnostico.claudeCode")}: ${contaEmTexto(t, retrato.conta)}`,
  ];
  if (teste === "ok") linhas.push(t("diagnostico.testeOk"));
  if (teste === "falhou") linhas.push(t("diagnostico.testeFalhou"));
  return linhas.join("\n");
}

/** O que a máquina tem e o que falta; a pessoa copia o relatório para pedir ajuda. */
export function Diagnostico({
  onOpenSobre,
  onVoltar,
}: {
  onOpenSobre: () => void;
  onVoltar: () => void;
}) {
  const { t } = useTranslation();
  const versao = useAppStore((store) => store.app?.versao ?? "");
  const retrato = useAppStore((store) => store.diagnostico);
  const carregar = useAppStore((store) => store.carregarDiagnostico);
  const teste = useAppStore((store) => store.testeDoClaude);
  const erro = useAppStore((store) => store.erroDaConta);
  const testar = useAppStore((store) => store.testarClaude);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <Screen title={t("diagnostico.titulo")}>
        {retrato === null ? (
          <p role="status">{t("diagnostico.carregando")}</p>
        ) : (
          <>
            <dl>
              <dt>{t("diagnostico.gpu")}</dt>
              <dd>{t(`diagnostico.gpus.${retrato.gpu}`)}</dd>
              <dt>{t("diagnostico.disco")}</dt>
              <dd>{discoEmTexto(t, retrato)}</dd>
            </dl>
            <h2>{t("diagnostico.dependencias")}</h2>
            <ul aria-label={t("diagnostico.dependencias")}>
              {retrato.dependencias.map((dependencia) => (
                <li key={dependencia.nome}>
                  {`${t(`diagnostico.nomes.${dependencia.nome}`)}: ${situacaoEmTexto(t, dependencia)}`}
                </li>
              ))}
            </ul>
            <h2>{t("diagnostico.claudeCode")}</h2>
            <p>{contaEmTexto(t, retrato.conta)}</p>
            <div className="actions">
              <button
                type="button"
                disabled={teste === "testando"}
                onClick={() => void testar()}
              >
                {t("diagnostico.testar")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const texto = relatorio(t, versao, retrato, teste);
                  void navigator.clipboard.writeText(texto).then(() => {
                    setCopiado(true);
                  });
                }}
              >
                {t("diagnostico.copiar")}
              </button>
            </div>
            {teste === "testando" && (
              <p role="status">{t("diagnostico.testando")}</p>
            )}
            {teste === "ok" && <p role="status">{t("diagnostico.testeOk")}</p>}
            {teste === "falhou" && erro && <ErrorMessage erro={erro} />}
            {copiado && <p role="status">{t("diagnostico.copiado")}</p>}
          </>
        )}
        <div className="actions">
          <button type="button" onClick={onVoltar}>
            {t("diagnostico.voltar")}
          </button>
        </div>
      </Screen>
    </>
  );
}
