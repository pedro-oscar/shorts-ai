import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReelDoProjeto } from "../bindings";
import { useAppStore } from "../context";
import type { ProjetoNaFila } from "../store";
import { ErrorMessage, Screen, Topo } from "./common";
import { formatarDuracao, producaoConcluida } from "./formatos";

/** Um reel: o player 9:16, o que o Claude disse dele e a descrição do post. */
function Reel({ reel }: { reel: ReelDoProjeto }) {
  const { t } = useTranslation();
  const urlDoArquivo = useAppStore((store) => store.urlDoArquivo);
  const [copiada, setCopiada] = useState(false);
  const titulo = reel.titulo ?? t("reels.semTitulo");
  const descricao = reel.descricao;
  const informacoes = [
    ["gancho", reel.gancho],
    ["payoff", reel.payoff],
    ["porque", reel.porque],
  ] as const;
  return (
    <article className="reel" aria-label={titulo}>
      {reel.arquivo === null ? (
        <p className="detail">{t("reels.semArquivo")}</p>
      ) : (
        <video
          className="player"
          controls
          preload="metadata"
          src={urlDoArquivo(reel.arquivo)}
        />
      )}
      <h3>{titulo}</h3>
      <p className="detail">
        {[
          formatarDuracao(reel.duracaoEmSegundos),
          reel.nota !== null && t("reels.nota", { nota: reel.nota }),
          reel.categoria,
        ]
          .filter(Boolean)
          .join(" · ")}
        {reel.previa && <span className="chip">{t("reels.previa")}</span>}
      </p>
      <dl>
        {informacoes.map(
          ([chave, valor]) =>
            valor !== null && (
              <div key={chave}>
                <dt>{t(`reels.${chave}`)}</dt>
                <dd>{valor}</dd>
              </div>
            ),
        )}
      </dl>
      {descricao !== null && (
        <>
          <button
            type="button"
            aria-label={t("reels.copiarDescricaoDe", { titulo })}
            onClick={() => {
              void navigator.clipboard.writeText(descricao).then(() => {
                setCopiada(true);
              });
            }}
          >
            {t("reels.copiarDescricao")}
          </button>
          <span role="status">{copiada && t("reels.copiada")}</span>
        </>
      )}
    </article>
  );
}

/** Os reels e as reservas de um projeto, com o que abrir no sistema. */
function Projeto({ projeto }: { projeto: ProjetoNaFila }) {
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
    <section aria-label={projeto.titulo}>
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
              onClick={() => {
                void abrirNoSistema(projeto.id, alvo);
              }}
            >
              {t(`reels.${texto}`)}
            </button>
          ))}
        </div>
      )}
      {erroAoAbrir && <ErrorMessage erro={erroAoAbrir} />}
      {erro && <ErrorMessage erro={erro} />}
      {dados && dados.reels.length === 0 && (
        <p className="detail">{t("reels.semReels")}</p>
      )}
      <div className="reels">
        {dados?.reels.map((reel) => (
          <Reel key={reel.id} reel={reel} />
        ))}
      </div>
      {dados && dados.reservas.length > 0 && (
        <>
          <h3>{t("reels.reservas")}</h3>
          <ul className="reservas" aria-label={t("reels.reservas")}>
            {dados.reservas.map((reserva) => (
              <li key={reserva.id}>
                <strong>{reserva.titulo ?? t("reels.semTitulo")}</strong>
                <span>
                  {reserva.nota !== null &&
                    t("reels.nota", { nota: reserva.nota })}
                </span>
                {reserva.porque !== null && <span>{reserva.porque}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** O passo Reels: os reels agrupados por projeto. */
export function Reels({
  onOpenSobre,
  onVoltar,
}: {
  onOpenSobre: () => void;
  onVoltar: () => void;
}) {
  const { t } = useTranslation();
  const projetos = useAppStore((store) => store.projetos);
  const comReels = projetos.filter(producaoConcluida);
  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <Screen title={t("reels.titulo")}>
        <button type="button" onClick={onVoltar}>
          {t("reels.voltar")}
        </button>
        {comReels.length === 0 && <p>{t("reels.vazio")}</p>}
        {comReels.map((projeto) => (
          <Projeto key={projeto.id} projeto={projeto} />
        ))}
      </Screen>
    </>
  );
}
