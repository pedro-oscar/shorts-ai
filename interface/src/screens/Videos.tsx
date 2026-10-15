import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../context";
import type { LinkNaLista } from "../store";
import { AjustesDoVideo } from "./AjustesDoVideo";
import { ErrorMessage, IconeFechar } from "./common";
import { EstimativaDoLote } from "./Estimativa";
import { ResumoDasExcecoes } from "./Excecoes";
import { SEM_CAMPOS, formatarDuracao, lerExcecoes, lerFaixa } from "./formatos";
import { PadroesDoLote, ResumoDosPadroes } from "./Padroes";

function IconeLixeira() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M3 4h10M6 4V2.5h4V4M5 4l.6 9h4.8L11 4" />
    </svg>
  );
}

/**
 * A folha de Vídeos sobre a Linha de produção: os arquivos do computador e os links do
 * YouTube que formam o lote, os Padrões dele e o botão que o gera. Ao acrescentar a um lote
 * que roda, os vídeos entram no fim da fila dele, com os padrões dele.
 */
export function Videos({
  onGerado,
  onFechar,
  onAbrirKits,
}: {
  onGerado: () => void;
  /** Volta para a Linha de produção; sem lote nenhum, não há para onde voltar. */
  onFechar?: () => void;
  onAbrirKits: () => void;
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
  const excecoes = useAppStore((store) => store.excecoes);
  const padroes = useAppStore((store) => store.padroes);
  const adicionando = useAppStore((store) => store.adicionandoAoLote);
  const lote = useAppStore((store) =>
    store.lotes.find((item) => item.id === store.loteAtual),
  );
  const gerar = useAppStore((store) => store.gerar);
  const [texto, setTexto] = useState("");
  /** O vídeo cuja janela de Ajustes está aberta: o caminho ou o endereço. */
  const [ajustando, setAjustando] = useState<string | null>(null);
  const [editandoPadroes, setEditandoPadroes] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  // Só links consultados e com o direito de uso confirmado seguem para o lote.
  const linksPrecisamDeAtencao = links.some(
    (link) => link.estado !== "pronto" || !link.direitoDeUso,
  );
  const faixaDe = (chave: string) =>
    lerFaixa(faixas[chave]?.inicio ?? "", faixas[chave]?.fim ?? "");
  const algumaFaixaInvalida = [
    ...arquivos.map((arquivo) => arquivo.caminho),
    ...links.map((link) => link.url),
  ].some((chave) => faixaDe(chave) === "invalida");
  const total = arquivos.length + links.length;
  const prontos = links.filter((link) => link.estado === "pronto");

  /** O resumo do que a pessoa ajustou no vídeo, o botão Ajustar e a janela dele. */
  const ajustes = (chave: string, nome: string) => {
    const faixa = faixaDe(chave);
    return {
      resumo: (
        <div className="detail">
          <ResumoDasExcecoes
            excecoes={lerExcecoes(
              excecoes[chave] ?? SEM_CAMPOS,
              faixa === "invalida" ? null : faixa,
            )}
          />
        </div>
      ),
      botao: (
        <button
          type="button"
          aria-label={t("ajustes.abrirDe", { nome })}
          onClick={() => {
            setAjustando(chave);
          }}
        >
          {t("ajustes.abrir")}
        </button>
      ),
      extra: (
        <>
          {ajustando !== chave && faixa === "invalida" && (
            <p role="alert" className="error">
              {t("videos.faixaInvalida", { nome })}
            </p>
          )}
          {ajustando === chave && (
            <AjustesDoVideo
              chave={chave}
              nome={nome}
              onFechar={() => {
                setAjustando(null);
              }}
            />
          )}
        </>
      ),
    };
  };

  const linha = (link: LinkNaLista) => {
    const nome = link.estado === "pronto" ? link.info.titulo : link.url;
    const { resumo, botao, extra } = ajustes(link.url, nome);
    return (
      <li key={link.url}>
        {link.estado === "consultando" && (
          <>
            <span className="video-duracao" aria-hidden="true">
              …
            </span>
            <div className="video-nome">
              <strong>{t("videos.linkConsultando", { url: link.url })}</strong>
            </div>
            <span />
          </>
        )}
        {link.estado === "erro" && (
          <>
            <span className="video-duracao" aria-hidden="true">
              !
            </span>
            <div className="video-nome">
              <strong>{link.url}</strong>
            </div>
            <span />
          </>
        )}
        {link.estado === "pronto" && (
          <>
            <span className="video-duracao" aria-hidden="true">
              {formatarDuracao(link.info.duracaoEmSegundos)}
            </span>
            <div className="video-nome">
              <strong>{link.info.titulo}</strong>
              <div className="detail">
                <span>{link.info.canal}</span>
                <span>·</span>
                <span>{formatarDuracao(link.info.duracaoEmSegundos)}</span>
                {resumo}
              </div>
            </div>
            {botao}
          </>
        )}
        <button
          type="button"
          className="icone discreto"
          aria-label={t("videos.removerLink", { titulo: nome })}
          title={t("videos.remover")}
          onClick={() => {
            removerLink(link.url);
          }}
        >
          <IconeLixeira />
        </button>
        {link.estado === "erro" && <ErrorMessage erro={link.erro} />}
        {link.estado === "pronto" && (
          <label className="marcador">
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
        )}
        {extra}
      </li>
    );
  };

  const rotuloDoBotao =
    total === 0
      ? t("videos.gerar")
      : adicionando
        ? t("videos.colocarNaFila", {
            videos: t("padroes.videos", { count: total }),
          })
        : t("padroes.gerar", {
            reels: t("padroes.reels", { count: padroes.quantidadeDeReels }),
            videos: t("padroes.videos", { count: total }),
          });

  return (
    <div className="folha-fundo">
      <aside className="folha" aria-labelledby="videos-titulo">
        <div className="folha-cabeca">
          <div>
            <h1 id="videos-titulo" ref={heading} tabIndex={-1}>
              {t("videos.titulo")}
            </h1>
            <p className="detail">
              {adicionando && lote
                ? t("videos.aoLote", { nome: lote.nome })
                : t("videos.loteNovo")}
            </p>
          </div>
          {onFechar && (
            <button
              type="button"
              className="icone"
              aria-label={t("comum.fechar")}
              title={t("comum.fechar")}
              onClick={onFechar}
            >
              <IconeFechar />
            </button>
          )}
        </div>

        <div className="drop-zone">
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
        <form
          className="links-form"
          onSubmit={(event) => {
            event.preventDefault();
            void adicionarLinks(texto);
            setTexto("");
          }}
        >
          <label className="campo">
            <span>{t("videos.linksRotulo")}</span>
            <textarea
              rows={2}
              placeholder="https://www.youtube.com/watch?v=…"
              value={texto}
              onChange={(event) => {
                setTexto(event.target.value);
              }}
            />
          </label>
          <div className="actions fim">
            <button type="submit" disabled={texto.trim() === ""}>
              {t("videos.linksAdicionar")}
            </button>
          </div>
        </form>
        {erro && <ErrorMessage erro={erro} />}

        {arquivos.length > 0 && (
          <ul aria-label={t("videos.lista")} className="videos-lista">
            {arquivos.map((arquivo) => {
              const { resumo, botao, extra } = ajustes(
                arquivo.caminho,
                arquivo.nome,
              );
              return (
                <li key={arquivo.caminho}>
                  <span className="video-duracao" aria-hidden="true">
                    {formatarDuracao(arquivo.duracaoEmSegundos)}
                  </span>
                  <div className="video-nome">
                    <strong>{arquivo.nome}</strong>
                    <div className="detail">{resumo}</div>
                  </div>
                  {botao}
                  <button
                    type="button"
                    className="icone discreto"
                    aria-label={t("videos.removerArquivo", {
                      nome: arquivo.nome,
                    })}
                    title={t("videos.remover")}
                    onClick={() => {
                      remover(arquivo.caminho);
                    }}
                  >
                    <IconeLixeira />
                  </button>
                  {extra}
                </li>
              );
            })}
          </ul>
        )}
        {links.length > 0 && (
          <>
            <ul aria-label={t("videos.linksLista")} className="videos-lista">
              {links.map(linha)}
            </ul>
            {prontos.length > 1 && (
              <label className="marcador">
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

        {!adicionando && (
          <section className="padroes-resumo" aria-labelledby="padroes-titulo">
            <div>
              <h2 id="padroes-titulo">{t("padroes.titulo")}</h2>
              <button
                type="button"
                className="discreto"
                aria-expanded={editandoPadroes}
                onClick={() => {
                  setEditandoPadroes(!editandoPadroes);
                }}
              >
                {editandoPadroes
                  ? t("padroes.fecharEdicao")
                  : t("padroes.editar")}
              </button>
            </div>
            {editandoPadroes ? (
              <PadroesDoLote onAbrirKits={onAbrirKits} />
            ) : (
              <ResumoDosPadroes padroes={padroes} />
            )}
          </section>
        )}
        <p className="detail">
          {t("videos.biblioteca", { pasta: biblioteca })}
        </p>

        <div className="folha-rodape">
          {!adicionando && <EstimativaDoLote />}
          <button
            type="button"
            className="primary"
            disabled={
              total === 0 || linksPrecisamDeAtencao || algumaFaixaInvalida
            }
            onClick={() => {
              void gerar().then((criou) => {
                if (criou) onGerado();
              });
            }}
          >
            {rotuloDoBotao}
          </button>
        </div>
      </aside>
    </div>
  );
}
