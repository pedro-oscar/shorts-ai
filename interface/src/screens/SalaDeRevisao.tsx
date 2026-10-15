import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReelDoProjeto } from "../bindings";
import { useAppStore } from "../context";
import type {
  LeituraDoProjeto,
  ProjetoNaFila,
  VersaoFinalDoProjeto,
} from "../store";
import { ErrorMessage, Topo } from "./common";
import { ResumoDoCusto } from "./Custo";
import { formatarDuracao, producaoConcluida } from "./formatos";

/**
 * O player 9:16. Onde o sistema não toca o reel no app (o WebKitGTK do Linux, ADR 0008), o
 * botão o abre no player do sistema.
 */
function Player({
  projeto,
  corte,
  arquivo,
  titulo,
}: {
  projeto: string;
  corte: string;
  arquivo: string;
  titulo: string;
}) {
  const { t } = useTranslation();
  const urlDoArquivo = useAppStore((store) => store.urlDoArquivo);
  const abrirNoSistema = useAppStore((store) => store.abrirNoSistema);
  const [tocaNoApp, setTocaNoApp] = useState(true);
  if (tocaNoApp)
    return (
      <video
        className="player"
        controls
        preload="metadata"
        src={urlDoArquivo(arquivo)}
        onError={() => {
          setTocaNoApp(false);
        }}
      />
    );
  return (
    <div className="player player-parado">
      <p>{t("sala.naoTocaNoApp")}</p>
      <button
        type="button"
        aria-label={t("sala.assistirNoSistemaDe", { titulo })}
        onClick={() => {
          void abrirNoSistema(projeto, { reel: corte });
        }}
      >
        {t("sala.assistirNoSistema")}
      </button>
    </div>
  );
}

/** O reel escolhido: o player, o que o Claude disse dele e a descrição do post. */
function ReelEmDetalhe({
  projeto,
  reel,
}: {
  projeto: string;
  reel: ReelDoProjeto;
}) {
  const { t } = useTranslation();
  const [copiada, setCopiada] = useState(false);
  const titulo = reel.titulo ?? t("sala.semTitulo");
  const descricao = reel.descricao;
  const informacoes = [
    ["gancho", reel.gancho],
    ["payoff", reel.payoff],
    ["porque", reel.porque],
  ] as const;
  return (
    <article className="reel" aria-label={titulo}>
      <div className="reel-player">
        {reel.arquivo === null ? (
          <p className="detail">{t("sala.semArquivo")}</p>
        ) : (
          <Player
            key={reel.id}
            projeto={projeto}
            corte={reel.id}
            arquivo={reel.arquivo}
            titulo={titulo}
          />
        )}
      </div>
      <div className="reel-info">
        <h2>{titulo}</h2>
        <p className="detail">
          {[
            formatarDuracao(reel.duracaoEmSegundos),
            reel.nota !== null && t("sala.nota", { nota: reel.nota }),
            reel.categoria,
          ]
            .filter(Boolean)
            .join(" · ")}
          {reel.previa && (
            <>
              {" "}
              <span className="chip acento">{t("sala.previa")}</span>
            </>
          )}
        </p>
        <dl>
          {informacoes.map(
            ([chave, valor]) =>
              valor !== null && (
                <div key={chave}>
                  <dt>{t(`sala.${chave}`)}</dt>
                  <dd>{valor}</dd>
                </div>
              ),
          )}
        </dl>
        {descricao !== null && (
          <div className="descricao">
            <div>
              <span className="rotulo">{t("sala.descricao")}</span>
              <button
                type="button"
                className="discreto"
                aria-label={t("sala.copiarDescricaoDe", { titulo })}
                onClick={() => {
                  void navigator.clipboard.writeText(descricao).then(() => {
                    setCopiada(true);
                  });
                }}
              >
                {t("sala.copiarDescricao")}
              </button>
            </div>
            <p>{descricao}</p>
            <span role="status" className="detail">
              {copiada && t("sala.copiada")}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}

/** Um projeto em que ainda há prévia no lugar da versão final. */
function temPrevia(leitura: LeituraDoProjeto | undefined) {
  return (
    leitura?.status === "ok" && leitura.data.reels.some((reel) => reel.previa)
  );
}

/** O render da versão final está na fila ou em andamento. */
function renderizando(
  versao: VersaoFinalDoProjeto | undefined,
): versao is VersaoFinalDoProjeto {
  return versao?.estado === "pendente" || versao?.estado === "emAndamento";
}

/** O render da versão final do projeto: o botão que o pede, ou o andamento dele. */
function VersaoFinal({ projeto, titulo }: { projeto: string; titulo: string }) {
  const { t } = useTranslation();
  const gerarVersaoFinal = useAppStore((store) => store.gerarVersaoFinal);
  const versao = useAppStore((store) => store.versoesFinais[projeto]);
  return (
    <>
      {renderizando(versao) ? (
        <p role="status" className="detail">
          {versao.percentual === null
            ? t("sala.versaoFinal")
            : t("sala.versaoFinalComProgresso", {
                percentual: versao.percentual,
              })}
        </p>
      ) : (
        <button
          type="button"
          className="sucesso"
          aria-label={t("sala.gerarVersaoFinalDe", { titulo })}
          onClick={() => {
            void gerarVersaoFinal([projeto]);
          }}
        >
          {t("sala.gerarVersaoFinal")}
        </button>
      )}
      {versao?.estado === "falhou" && (
        <p role="alert" className="error">
          {t("sala.versaoFinalFalhou", { titulo, falha: versao.falha })}
        </p>
      )}
    </>
  );
}

/** Um projeto na tira da esquerda: as ações dele, os reels para escolher e as reservas. */
function GrupoDoProjeto({
  projeto,
  escolhido,
  onEscolher,
}: {
  projeto: ProjetoNaFila;
  /** O id do reel escolhido, se é deste projeto. */
  escolhido: string | null;
  onEscolher: (reel: string) => void;
}) {
  const { t } = useTranslation();
  const carregarGaleria = useAppStore((store) => store.carregarGaleria);
  const abrirNoSistema = useAppStore((store) => store.abrirNoSistema);
  const leitura = useAppStore((store) => store.galeria[projeto.id]);
  const erroAoAbrir = useAppStore((store) => store.errosAoAbrir[projeto.id]);
  useEffect(() => {
    void carregarGaleria(projeto.id);
  }, [carregarGaleria, projeto.id]);
  const dados = leitura?.status === "ok" ? leitura.data : undefined;
  const erro = leitura?.status === "error" ? leitura.error : undefined;
  // Sem a pasta, não há o que abrir.
  const naoEncontrado = erro?.codigo === "projetoNaoEncontrado";
  return (
    <section className="sala-projeto" aria-label={projeto.titulo}>
      <div className="sala-projeto-cabeca">
        <h2>{projeto.titulo}</h2>
        {!naoEncontrado && (
          <div className="actions">
            {(
              [
                ["pasta", "abrirPasta"],
                ["roteiro", "abrirRoteiro"],
                ["logs", "abrirLogs"],
              ] as const
            ).map(([alvo, texto]) => (
              <button
                key={alvo}
                type="button"
                className="discreto"
                onClick={() => {
                  void abrirNoSistema(projeto.id, alvo);
                }}
              >
                {t(`sala.${texto}`)}
              </button>
            ))}
          </div>
        )}
        {dados && (
          <ResumoDoCusto custo={dados.custo} rotulo={t("custo.projeto")} />
        )}
        {temPrevia(leitura) && (
          <VersaoFinal projeto={projeto.id} titulo={projeto.titulo} />
        )}
        {erroAoAbrir && <ErrorMessage erro={erroAoAbrir} />}
        {erro && <ErrorMessage erro={erro} />}
        {dados && dados.reels.length === 0 && (
          <p className="detail">{t("sala.semReels")}</p>
        )}
      </div>
      {dados?.reels.map((reel) => {
        const titulo = reel.titulo ?? t("sala.semTitulo");
        return (
          <button
            key={reel.id}
            type="button"
            className="reel-botao"
            aria-pressed={escolhido === reel.id}
            aria-label={titulo}
            onClick={() => {
              onEscolher(reel.id);
            }}
          >
            <span className="reel-miniatura" aria-hidden="true" />
            <span>
              <span>{titulo}</span>
              <span className="detail">
                {[
                  reel.nota !== null && t("sala.nota", { nota: reel.nota }),
                  formatarDuracao(reel.duracaoEmSegundos),
                  reel.previa && t("sala.previa"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </button>
        );
      })}
      {dados && dados.reservas.length > 0 && (
        <>
          <span className="rotulo">{t("sala.reservas")}</span>
          <ul className="reservas" aria-label={t("sala.reservas")}>
            {dados.reservas.map((reserva) => (
              <li key={reserva.id}>
                <strong>{reserva.titulo ?? t("sala.semTitulo")}</strong>
                {reserva.nota !== null && (
                  <span className="detail">
                    {t("sala.nota", { nota: reserva.nota })}
                  </span>
                )}
                {reserva.porque !== null && (
                  <span className="detail">{reserva.porque}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** A Sala de revisão: os reels do lote numa tira, e o escolhido em detalhe. */
export function SalaDeRevisao({
  onOpenSobre,
  onVoltar,
}: {
  onOpenSobre: () => void;
  onVoltar: () => void;
}) {
  const { t } = useTranslation();
  const loteAtual = useAppStore((store) => store.loteAtual);
  const lote = useAppStore((store) =>
    store.lotes.find((item) => item.id === store.loteAtual),
  );
  const projetos = useAppStore((store) => store.projetos);
  const comReels = projetos
    .filter((projeto) => projeto.lote === loteAtual)
    .filter(producaoConcluida);
  const gerarVersaoFinal = useAppStore((store) => store.gerarVersaoFinal);
  const erroDaVersaoFinal = useAppStore((store) => store.erroDaVersaoFinal);
  const galeria = useAppStore((store) => store.galeria);
  const versoesFinais = useAppStore((store) => store.versoesFinais);
  const [escolhido, setEscolhido] = useState<{
    projeto: string;
    reel: string;
  } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const paraRenderizar = comReels.filter(
    (projeto) =>
      temPrevia(galeria[projeto.id]) &&
      !renderizando(versoesFinais[projeto.id]),
  );
  // O reel escolhido, ou o primeiro que houver enquanto a pessoa não escolhe um.
  const reelDe = (projeto: string, reel: string) => {
    const leitura = galeria[projeto];
    return leitura?.status === "ok"
      ? leitura.data.reels.find((item) => item.id === reel)
      : undefined;
  };
  let atual: { projeto: string; reel: ReelDoProjeto } | null = null;
  if (escolhido) {
    const reel = reelDe(escolhido.projeto, escolhido.reel);
    if (reel) atual = { projeto: escolhido.projeto, reel };
  }
  if (!atual)
    for (const projeto of comReels) {
      const leitura = galeria[projeto.id];
      const primeiro =
        leitura?.status === "ok" ? leitura.data.reels[0] : undefined;
      if (primeiro) {
        atual = { projeto: projeto.id, reel: primeiro };
        break;
      }
    }
  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <main className="linha">
        <div className="sala-topo">
          <button type="button" onClick={onVoltar}>
            {t("sala.voltar")}
          </button>
          <h1 ref={heading} tabIndex={-1}>
            {t("sala.titulo")}
          </h1>
          {lote && (
            <span className="muted">
              {t("sala.doLote", { nome: lote.nome })}
            </span>
          )}
          <span className="espaco" />
          {paraRenderizar.length > 0 && (
            <button
              type="button"
              className="sucesso"
              onClick={() => {
                void gerarVersaoFinal(
                  paraRenderizar.map((projeto) => projeto.id),
                );
              }}
            >
              {t("sala.gerarVersaoFinalDoLote")}
            </button>
          )}
        </div>
        {erroDaVersaoFinal && (
          <div className="linha-avisos">
            <ErrorMessage erro={erroDaVersaoFinal} />
          </div>
        )}
        <div className="sala">
          <nav className="sala-nav" aria-label={t("sala.reelsDoLote")}>
            {comReels.length === 0 && <p>{t("sala.vazio")}</p>}
            {comReels.map((projeto) => (
              <GrupoDoProjeto
                key={projeto.id}
                projeto={projeto}
                escolhido={atual?.projeto === projeto.id ? atual.reel.id : null}
                onEscolher={(reel) => {
                  setEscolhido({ projeto: projeto.id, reel });
                }}
              />
            ))}
          </nav>
          {atual ? (
            <ReelEmDetalhe
              key={`${atual.projeto}/${atual.reel.id}`}
              projeto={atual.projeto}
              reel={atual.reel}
            />
          ) : (
            <div className="sala-vazia">
              <p>{t("sala.escolhaUmReel")}</p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
