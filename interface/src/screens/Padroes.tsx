import { useTranslation } from "react-i18next";
import type { IdiomaDoVideo, ModeloDoClaude } from "../bindings";
import { useAppStore } from "../context";
import { ErrorMessage, Screen, Topo } from "./common";

const MODELOS: ModeloDoClaude[] = ["padrao", "opus", "sonnet"];
const IDIOMAS: IdiomaDoVideo[] = ["automatico", "pt", "en"];
const QUANTIDADES = Array.from({ length: 12 }, (_, i) => i + 1);
const REVISOES = [0, 1, 2, 3];

/** O passo Padrões: as opções que valem para todos os projetos do lote. */
export function Padroes({
  onOpenSobre,
  onVoltar,
  onGerado,
}: {
  onOpenSobre: () => void;
  onVoltar: () => void;
  onGerado: () => void;
}) {
  const { t } = useTranslation();
  const padroes = useAppStore((store) => store.padroes);
  const definir = useAppStore((store) => store.definirPadroes);
  const videos = useAppStore((store) => store.arquivos.length);
  const erro = useAppStore((store) => store.erroDeArquivos);
  const gerar = useAppStore((store) => store.gerar);
  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <Screen title={t("padroes.titulo")}>
        <p>{t("padroes.introducao")}</p>
        <label>
          {t("padroes.quantidade")}
          <select
            value={padroes.quantidadeDeReels}
            onChange={(event) => {
              definir({ quantidadeDeReels: Number(event.target.value) });
            }}
          >
            {QUANTIDADES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={padroes.previa}
            onChange={(event) => {
              definir({ previa: event.target.checked });
            }}
          />
          {t("padroes.previa")}
        </label>
        <label>
          {t("padroes.pedido")}
          <textarea
            value={padroes.pedido}
            onChange={(event) => {
              definir({ pedido: event.target.value });
            }}
          />
        </label>
        <p className="detail">{t("padroes.pedidoDica")}</p>
        <details>
          <summary>{t("padroes.maisOpcoes")}</summary>
          <label>
            {t("padroes.revisoes")}
            <select
              value={padroes.revisoes}
              onChange={(event) => {
                definir({ revisoes: Number(event.target.value) });
              }}
            >
              {REVISOES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("padroes.modelo")}
            <select
              value={padroes.modelo}
              onChange={(event) => {
                definir({ modelo: event.target.value as ModeloDoClaude });
              }}
            >
              {MODELOS.map((modelo) => (
                <option key={modelo} value={modelo}>
                  {t(`padroes.modelos.${modelo}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("padroes.nomesProprios")}
            <textarea
              value={padroes.nomesProprios.join("\n")}
              onChange={(event) => {
                definir({ nomesProprios: event.target.value.split("\n") });
              }}
            />
          </label>
          <p className="detail">{t("padroes.nomesDica")}</p>
          <label>
            {t("padroes.idioma")}
            <select
              value={padroes.idiomaDoVideo}
              onChange={(event) => {
                definir({ idiomaDoVideo: event.target.value as IdiomaDoVideo });
              }}
            >
              {IDIOMAS.map((idioma) => (
                <option key={idioma} value={idioma}>
                  {t(`padroes.idiomas.${idioma}`)}
                </option>
              ))}
            </select>
          </label>
        </details>
        {erro && <ErrorMessage erro={erro} />}
        <button type="button" onClick={onVoltar}>
          {t("padroes.voltar")}
        </button>
        <button
          type="button"
          onClick={() => {
            void gerar().then((criou) => {
              if (criou) onGerado();
            });
          }}
        >
          {t("padroes.gerar", {
            reels: t("padroes.reels", { count: padroes.quantidadeDeReels }),
            videos: t("padroes.videos", { count: videos }),
          })}
        </button>
      </Screen>
    </>
  );
}
