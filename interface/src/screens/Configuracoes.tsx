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
/** Quantos vídeos ao mesmo tempo a pessoa pode escolher, além do automático. */
const VIDEOS = [1, 2, 3, 4, 5, 6];
const SECOES = [
  "biblioteca",
  "idioma",
  "videos",
  "conta",
  "moeda",
  "kits",
  "regras",
  "diagnostico",
  "sobre",
] as const;

/**
 * A engrenagem do topo: a Biblioteca, o idioma, a conta e o plano, a moeda, os kits de
 * marca, as regras aprendidas, o Diagnóstico e o Sobre, com um índice ao lado.
 */
export function Configuracoes({
  onOpenSobre,
  onVoltar,
  onAbrirKits,
  onAbrirConta,
}: {
  onOpenSobre: () => void;
  onVoltar: () => void;
  onAbrirKits: () => void;
  onAbrirConta: () => void;
}) {
  const { t } = useTranslation();
  const biblioteca = useAppStore((store) => store.biblioteca);
  const idioma = useAppStore((store) => store.app?.idiomaDaInterface);
  const erro = useAppStore((store) => store.erroDasConfiguracoes);
  const trocarBiblioteca = useAppStore((store) => store.trocarBiblioteca);
  const definirIdioma = useAppStore((store) => store.definirIdioma);
  const paralelismo = useAppStore((store) => store.paralelismo);
  const definirVideos = useAppStore((store) => store.definirVideosAoMesmoTempo);
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
      <Screen larga title={t("configuracoes.titulo")}>
        {erro && <ErrorMessage erro={erro} />}
        <div className="configuracoes">
          <nav className="indice" aria-label={t("configuracoes.indice")}>
            {SECOES.map((secao) => (
              <a key={secao} href={`#configuracoes-${secao}`}>
                {t(`configuracoes.secoes.${secao}`)}
              </a>
            ))}
            <button type="button" onClick={onVoltar}>
              {t("configuracoes.voltar")}
            </button>
          </nav>
          <div className="secoes">
            <section className="cartao" id="configuracoes-biblioteca">
              <h2>{t("configuracoes.bibliotecaTitulo")}</h2>
              <p>
                {t("configuracoes.bibliotecaAtual", { caminho: biblioteca })}
              </p>
              <p className="muted">{t("configuracoes.bibliotecaDica")}</p>
              <div className="actions">
                <button type="button" onClick={() => void trocarBiblioteca()}>
                  {t("configuracoes.trocarBiblioteca")}
                </button>
              </div>
            </section>

            <section className="cartao" id="configuracoes-idioma">
              <h2>{t("configuracoes.idiomaTitulo")}</h2>
              <label className="campo">
                <span>{t("configuracoes.idioma")}</span>
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
            </section>

            <section className="cartao" id="configuracoes-videos">
              <h2>{t("configuracoes.videosTitulo")}</h2>
              <label className="campo">
                <span>{t("configuracoes.videos")}</span>
                <select
                  value={paralelismo?.videosAoMesmoTempo ?? ""}
                  onChange={(event) => {
                    const valor = event.target.value;
                    void definirVideos(valor === "" ? null : Number(valor));
                  }}
                >
                  <option value="">
                    {t("configuracoes.videosAutomatico", {
                      count: paralelismo?.automatico ?? 1,
                    })}
                  </option>
                  {VIDEOS.map((videos) => (
                    <option key={videos} value={videos}>
                      {videos}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">{t("configuracoes.videosDica")}</p>
            </section>

            <section className="cartao" id="configuracoes-conta">
              <h2>{t("configuracoes.contaTitulo")}</h2>
              {conta?.tipo === "logado" ? (
                <>
                  <p>
                    {t("conta.logado", { conta: conta.email ?? conta.metodo })}
                  </p>
                  <PlanoDaConta plano={conta.plano} />
                  <MultiplicadorDoPlano />
                </>
              ) : (
                <p className="muted">{t("configuracoes.semConta")}</p>
              )}
              <div className="actions">
                <button type="button" onClick={onAbrirConta}>
                  {t("configuracoes.abrirConta")}
                </button>
              </div>
            </section>

            <section className="cartao" id="configuracoes-moeda">
              <Moeda />
            </section>

            <section className="cartao" id="configuracoes-kits">
              <h2>{t("configuracoes.kitsTitulo")}</h2>
              <p className="muted">{t("configuracoes.kitsDica")}</p>
              <div className="actions">
                <button type="button" onClick={onAbrirKits}>
                  {t("configuracoes.abrirKits")}
                </button>
              </div>
            </section>

            <section className="cartao" id="configuracoes-regras">
              <RegrasAprendidas />
            </section>

            <section className="cartao" id="configuracoes-diagnostico">
              <h2>{t("configuracoes.diagnosticoTitulo")}</h2>
              <p className="muted">{t("configuracoes.diagnosticoDica")}</p>
              <div className="actions">
                <button
                  type="button"
                  onClick={() => {
                    setDiagnostico(true);
                  }}
                >
                  {t("configuracoes.abrirDiagnostico")}
                </button>
              </div>
            </section>

            <section className="cartao" id="configuracoes-sobre">
              <h2>{t("configuracoes.sobreTitulo")}</h2>
              <div className="actions">
                <button type="button" onClick={onOpenSobre}>
                  {t("configuracoes.abrirSobre")}
                </button>
              </div>
            </section>
          </div>
        </div>
      </Screen>
    </>
  );
}
