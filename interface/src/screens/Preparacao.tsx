import { useTranslation } from "react-i18next";
import { useAppStore } from "../context";
import { Screen, Topo } from "./common";
import type { AndamentoDoPacote } from "../store";
import { formatarTamanho } from "./formatos";

/**
 * A preparação da primeira execução: mostra o que falta e quanto vai ocupar, baixa tudo e
 * deixa cada pacote contar o próprio andamento. O fluxo segue sozinho quando nada mais falta.
 */
export function Preparacao({ onOpenSobre }: { onOpenSobre: () => void }) {
  const { t, i18n } = useTranslation();
  const preparacao = useAppStore((store) => store.preparacao);
  const andamento = useAppStore((store) => store.andamentoDaPreparacao);
  const preparando = useAppStore((store) => store.preparando);
  const preparar = useAppStore((store) => store.preparar);
  if (!preparacao) return null;

  const faltam = preparacao.pacotes.filter((pacote) => !pacote.presente);
  const total = faltam.reduce((soma, pacote) => soma + pacote.tamanhoEmMb, 0);
  const tamanho = (mb: number) => formatarTamanho(mb, i18n.language);
  const falhou = Object.values(andamento).some((a) => a.estado === "falhou");
  const situacao = (
    presente: boolean,
    atual: AndamentoDoPacote | undefined,
  ) => {
    if (presente) return t("preparacao.presente");
    switch (atual?.estado) {
      case "emAndamento":
        return t("preparacao.baixando");
      case "falhou":
        return t("preparacao.falhou", { detalhe: atual.falha ?? "" });
      default:
        return t("preparacao.falta");
    }
  };
  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <Screen title={t("preparacao.titulo")}>
        <p>{t("preparacao.introducao")}</p>
        <ul className="pacotes">
          {preparacao.pacotes.map(({ pacote, presente, tamanhoEmMb }) => {
            const nome = t(`preparacao.pacotes.${pacote}`);
            const atual = andamento[pacote];
            return (
              <li key={pacote}>
                <strong>{nome}</strong>
                <span className="detail">
                  {t("preparacao.tamanho", {
                    tamanho: tamanho(tamanhoEmMb),
                  })}
                </span>
                <span>{situacao(presente, atual)}</span>
                {atual?.estado === "emAndamento" && (
                  <progress
                    aria-label={t("preparacao.progresso", { pacote: nome })}
                    max={100}
                    value={atual.percentual ?? undefined}
                  />
                )}
                {atual?.estado === "concluida" && (
                  <span>{t("preparacao.concluido")}</span>
                )}
              </li>
            );
          })}
        </ul>
        <p>
          {t("preparacao.total", {
            tamanho: tamanho(total),
            livre:
              preparacao.espacoLivreEmMb === null
                ? "—"
                : tamanho(preparacao.espacoLivreEmMb),
          })}
        </p>
        {preparacao.poucoEspaco && (
          <p role="alert" className="error">
            {t("preparacao.pouco")}
          </p>
        )}
        <button
          type="button"
          disabled={preparando}
          onClick={() => {
            void preparar();
          }}
        >
          {falhou ? t("preparacao.tentarDeNovo") : t("preparacao.baixar")}
        </button>
      </Screen>
    </>
  );
}
