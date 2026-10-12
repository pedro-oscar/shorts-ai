import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { IdiomaDaInterface } from "../bindings";
import { useAppStore } from "../context";
import { Diagnostico } from "./Diagnostico";
import { Moeda } from "./Moeda";
import { MultiplicadorDoPlano } from "./MultiplicadorDoPlano";
import { PlanoDaConta } from "./PlanoDaConta";
import { RegrasAprendidas } from "./RegrasAprendidas";
import { ErrorMessage, Screen, Topo } from "./common";

const IDIOMAS: IdiomaDaInterface[] = ["pt-BR", "en"];

/** A engrenagem do topo: a Biblioteca, o idioma da interface, as regras aprendidas, o Diagnóstico e o Sobre. */
export function Configuracoes({
  onOpenSobre,
  onVoltar,
}: {
  onOpenSobre: () => void;
  onVoltar: () => void;
}) {
  const { t } = useTranslation();
  const biblioteca = useAppStore((store) => store.biblioteca);
  const idioma = useAppStore((store) => store.app?.idiomaDaInterface);
  const erro = useAppStore((store) => store.erroDasConfiguracoes);
  const trocarBiblioteca = useAppStore((store) => store.trocarBiblioteca);
  const definirIdioma = useAppStore((store) => store.definirIdioma);
  const conta = useAppStore((store) => store.conta);
  const verificarConta = useAppStore((store) => store.verificarConta);
  const [diagnostico, setDiagnostico] = useState(false);

  useEffect(() => {
    if (conta === null) void verificarConta();
  }, [conta, verificarConta]);

  if (diagnostico)
    return (
      <Diagnostico
        onOpenSobre={onOpenSobre}
        onVoltar={() => {
          setDiagnostico(false);
        }}
      />
    );
  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <Screen title={t("configuracoes.titulo")}>
        {erro && <ErrorMessage erro={erro} />}

        <h2>{t("configuracoes.bibliotecaTitulo")}</h2>
        <p>{t("configuracoes.bibliotecaAtual", { caminho: biblioteca })}</p>
        <p className="muted">{t("configuracoes.bibliotecaDica")}</p>
        <button type="button" onClick={() => void trocarBiblioteca()}>
          {t("configuracoes.trocarBiblioteca")}
        </button>

        <h2>{t("configuracoes.idiomaTitulo")}</h2>
        <label>
          {t("configuracoes.idioma")}
          <select
            value={idioma}
            onChange={(event) => {
              void definirIdioma(event.target.value as IdiomaDaInterface);
            }}
          >
            {IDIOMAS.map((opcao) => (
              <option key={opcao} value={opcao}>
                {t(`configuracoes.idiomas.${opcao}`)}
              </option>
            ))}
          </select>
        </label>

        <h2>{t("configuracoes.contaTitulo")}</h2>
        {conta?.tipo === "logado" ? (
          <>
            <PlanoDaConta plano={conta.plano} />
            <MultiplicadorDoPlano />
          </>
        ) : (
          <p className="muted">{t("configuracoes.semConta")}</p>
        )}

        <Moeda />

        <RegrasAprendidas />

        <h2>{t("configuracoes.diagnosticoTitulo")}</h2>
        <button
          type="button"
          onClick={() => {
            setDiagnostico(true);
          }}
        >
          {t("configuracoes.abrirDiagnostico")}
        </button>

        <div className="actions">
          <button type="button" onClick={onOpenSobre}>
            {t("configuracoes.abrirSobre")}
          </button>
          <button type="button" onClick={onVoltar}>
            {t("configuracoes.voltar")}
          </button>
        </div>
      </Screen>
    </>
  );
}
