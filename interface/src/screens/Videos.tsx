import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../context";
import { ErrorMessage, Screen, Topo } from "./common";
import { CamposDeExcecoes, ResumoDasExcecoes } from "./Excecoes";
import { SEM_CAMPOS, formatarDuracao, lerExcecoes, lerFaixa } from "./formatos";

/**
 * O passo Vídeos: os arquivos do computador e os links do YouTube que formam o lote, que o
 * passo Padrões gera.
 */
export function Videos({
  onOpenSobre,
  onContinuar,
  onVoltar,
}: {
  onOpenSobre: () => void;
  onContinuar: () => void;
  /** Só ao acrescentar vídeos a um lote que roda: volta para o Gerando. */
  onVoltar?: () => void;
}) {
  const { t } = useTranslation();
  const arquivos = useAppStore((store) => store.arquivos);
  const erro = useAppStore((store) => store.erroDeArquivos);
  const biblioteca = useAppStore((store) => store.biblioteca);
  const escolher = useAppStore((store) => store.escolherArquivos);
  const remover = useAppStore((store) => store.removerArquivo);
  const links = useAppStore((store) => store.links);
  const adicionarLinks = useAppStore((store) => store.adicionarLinks);
  const removerLink = useAppStore((store) => store.removerLink);
  const definirDireito = useAppStore((store) => store.definirDireitoDeUso);
  const definirDireitoDeTodos = useAppStore(
    (store) => store.definirDireitoDeUsoDeTodos,
  );
  const faixas = useAppStore((store) => store.faixas);
  const definirFaixa = useAppStore((store) => store.definirFaixa);
  const excecoes = useAppStore((store) => store.excecoes);
  const definirExcecoes = useAppStore((store) => store.definirExcecoesDoVideo);
  const [aba, setAba] = useState<"arquivos" | "link">("arquivos");
  const [texto, setTexto] = useState("");
  // Só links consultados e com o direito de uso confirmado seguem para o lote.
  const linksPrecisamDeAtencao = links.some(
    (link) => link.estado !== "pronto" || !link.direitoDeUso,
  );
  const faixaInvalida = (chave: string) => {
    const campos = faixas[chave];
    return campos ? lerFaixa(campos.inicio, campos.fim) === "invalida" : false;
  };
  const algumaFaixaInvalida =
    arquivos.some((arquivo) => faixaInvalida(arquivo.caminho)) ||
    links.some((link) => faixaInvalida(link.url));
  const camposDaFaixa = (chave: string, nome: string) => (
    <>
      {(["inicio", "fim"] as const).map((campo) => (
        <input
          key={campo}
          type="text"
          placeholder={campo === "inicio" ? "0:00" : "—"}
          aria-label={t(
            campo === "inicio" ? "videos.faixaInicio" : "videos.faixaFim",
            { nome },
          )}
          value={faixas[chave]?.[campo] ?? ""}
          onChange={(event) => {
            definirFaixa(chave, campo, event.target.value);
          }}
        />
      ))}
      {faixaInvalida(chave) && (
        <span role="alert" className="detail">
          {t("videos.faixaInvalida", { nome })}
        </span>
      )}
    </>
  );
  const excecoesDe = (chave: string, nome: string) => {
    const campos = excecoes[chave] ?? SEM_CAMPOS;
    const faixa = lerFaixa(
      faixas[chave]?.inicio ?? "",
      faixas[chave]?.fim ?? "",
    );
    return (
      <>
        <ResumoDasExcecoes
          excecoes={lerExcecoes(campos, faixa === "invalida" ? null : faixa)}
        />
        <details>
          <summary aria-label={t("excecoes.abrirDe", { nome })}>
            {t("excecoes.titulo")}
          </summary>
          <CamposDeExcecoes
            nome={nome}
            campos={campos}
            onChange={(mudancas) => {
              definirExcecoes(chave, mudancas);
            }}
          />
        </details>
      </>
    );
  };
  const prontos = links.filter((link) => link.estado === "pronto");
  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <Screen title={t("videos.titulo")}>
        {onVoltar && (
          <button type="button" onClick={onVoltar}>
            {t("videos.voltar")}
          </button>
        )}
        <div role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={aba === "arquivos"}
            onClick={() => {
              setAba("arquivos");
            }}
          >
            {t("videos.abaArquivos")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={aba === "link"}
            onClick={() => {
              setAba("link");
            }}
          >
            {t("videos.abaLink")}
          </button>
        </div>
        {aba === "arquivos" ? (
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
        ) : (
          <form
            role="tabpanel"
            onSubmit={(event) => {
              event.preventDefault();
              void adicionarLinks(texto);
              setTexto("");
            }}
          >
            <label>
              {t("videos.linksRotulo")}
              <textarea
                rows={3}
                value={texto}
                onChange={(event) => {
                  setTexto(event.target.value);
                }}
              />
            </label>
            <button type="submit" disabled={texto.trim() === ""}>
              {t("videos.linksAdicionar")}
            </button>
          </form>
        )}
        {erro && <ErrorMessage erro={erro} />}
        {arquivos.length > 0 && (
          <ul aria-label={t("videos.lista")} className="file-list">
            {arquivos.map((arquivo) => (
              <li key={arquivo.caminho}>
                <span className="file-name">{arquivo.nome}</span>
                <span className="file-duration">
                  {formatarDuracao(arquivo.duracaoEmSegundos)}
                </span>
                {camposDaFaixa(arquivo.caminho, arquivo.nome)}
                {excecoesDe(arquivo.caminho, arquivo.nome)}
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
        {links.length > 0 && (
          <>
            <ul aria-label={t("videos.linksLista")} className="file-list">
              {links.map((link) => (
                <li key={link.url}>
                  {link.estado === "consultando" && (
                    <span className="file-name">
                      {t("videos.linkConsultando", { url: link.url })}
                    </span>
                  )}
                  {link.estado === "erro" && <ErrorMessage erro={link.erro} />}
                  {link.estado === "pronto" && (
                    <>
                      <span className="file-name">
                        {link.info.titulo}
                        <span className="detail">
                          {" · "}
                          {link.info.canal}
                        </span>
                      </span>
                      <span className="file-duration">
                        {formatarDuracao(link.info.duracaoEmSegundos)}
                      </span>
                      <label>
                        <input
                          type="checkbox"
                          aria-label={t("videos.direitoDeUsoDe", {
                            titulo: link.info.titulo,
                          })}
                          checked={link.direitoDeUso}
                          onChange={(event) => {
                            definirDireito(link.url, event.target.checked);
                          }}
                        />
                        {t("videos.direitoDeUso")}
                      </label>
                      {camposDaFaixa(link.url, link.info.titulo)}
                      {excecoesDe(link.url, link.info.titulo)}
                    </>
                  )}
                  <button
                    type="button"
                    aria-label={t("videos.removerLink", {
                      titulo:
                        link.estado === "pronto" ? link.info.titulo : link.url,
                    })}
                    onClick={() => {
                      removerLink(link.url);
                    }}
                  >
                    {t("videos.remover")}
                  </button>
                </li>
              ))}
            </ul>
            {prontos.length > 1 && (
              <label>
                <input
                  type="checkbox"
                  checked={prontos.every((link) => link.direitoDeUso)}
                  onChange={(event) => {
                    definirDireitoDeTodos(event.target.checked);
                  }}
                />
                {t("videos.direitoParaTodos")}
              </label>
            )}
          </>
        )}
        <p className="detail">
          {t("videos.biblioteca", { pasta: biblioteca })}
        </p>
        <button
          type="button"
          disabled={
            arquivos.length + links.length === 0 ||
            linksPrecisamDeAtencao ||
            algumaFaixaInvalida
          }
          onClick={onContinuar}
        >
          {t("videos.continuar")}
        </button>
      </Screen>
    </>
  );
}
