import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { IdiomaDoVideo, ModeloDoClaude, Padroes } from "../bindings";
import { useAppStore } from "../context";

const MODELOS: ModeloDoClaude[] = ["padrao", "opus", "sonnet"];
const IDIOMAS: IdiomaDoVideo[] = ["automatico", "pt", "en"];
const QUANTIDADES = Array.from({ length: 12 }, (_, i) => i + 1);
const REVISOES = [0, 1, 2, 3];

/** Os padrões do lote em chips, para ler de relance na folha de Vídeos. */
export function ResumoDosPadroes({ padroes }: { padroes: Padroes }) {
  const { t } = useTranslation();
  const chips = [
    t("padroes.chipReels", {
      reels: t("padroes.reels", { count: padroes.quantidadeDeReels }),
    }),
    padroes.previa ? t("padroes.chipPrevia") : t("padroes.chipSemPrevia"),
    t("padroes.chipKit", { kit: padroes.kit ?? "" }),
    t("padroes.chipRevisoes", { count: padroes.revisoes }),
    t("padroes.chipIdioma", {
      idioma: t(`padroes.idiomas.${padroes.idiomaDoVideo}`),
    }),
  ];
  if (padroes.modelo !== "padrao")
    chips.push(t(`padroes.modelos.${padroes.modelo}`));
  const pedido = padroes.pedido.trim();
  return (
    <>
      <ul className="chips" aria-label={t("padroes.doLote")}>
        {chips.map((chip) => (
          <li key={chip}>{chip}</li>
        ))}
      </ul>
      {pedido !== "" && (
        <p className="detail">{t("padroes.chipPedido", { pedido })}</p>
      )}
    </>
  );
}

/** O formulário dos Padrões: as opções que valem para todos os projetos do lote. */
export function PadroesDoLote({ onAbrirKits }: { onAbrirKits: () => void }) {
  const { t } = useTranslation();
  const padroes = useAppStore((store) => store.padroes);
  const definir = useAppStore((store) => store.definirPadroes);
  const kits = useAppStore((store) => store.kits);
  const carregarKits = useAppStore((store) => store.carregarKits);
  useEffect(() => {
    void carregarKits();
  }, [carregarKits]);
  return (
    <div className="padroes-form">
      <p className="detail">{t("padroes.introducao")}</p>
      <div className="campos duas">
        <label className="campo">
          <span>{t("padroes.quantidade")}</span>
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
        <label className="campo">
          <span>{t("padroes.kit")}</span>
          <select
            value={padroes.kit}
            onChange={(event) => {
              definir({ kit: event.target.value });
            }}
          >
            {kits.map((kit) => (
              <option key={kit.nome} value={kit.nome}>
                {kit.nome}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="actions">
        <button type="button" className="discreto" onClick={onAbrirKits}>
          {t("padroes.gerenciarKits")}
        </button>
      </div>
      <label className="marcador">
        <input
          type="checkbox"
          checked={padroes.previa}
          onChange={(event) => {
            definir({ previa: event.target.checked });
          }}
        />
        {t("padroes.previa")}
      </label>
      <label className="campo">
        <span>{t("padroes.pedido")}</span>
        <textarea
          rows={2}
          placeholder={t("padroes.pedidoDica")}
          value={padroes.pedido}
          onChange={(event) => {
            definir({ pedido: event.target.value });
          }}
        />
      </label>
      <details>
        <summary>{t("padroes.maisOpcoes")}</summary>
        <div className="campos">
          <div className="campos duas">
            <label className="campo">
              <span>{t("padroes.revisoes")}</span>
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
            <label className="campo">
              <span>{t("padroes.modelo")}</span>
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
          </div>
          <label className="campo">
            <span>{t("padroes.nomesProprios")}</span>
            <textarea
              rows={2}
              placeholder={t("padroes.nomesDica")}
              value={padroes.nomesProprios.join("\n")}
              onChange={(event) => {
                definir({ nomesProprios: event.target.value.split("\n") });
              }}
            />
          </label>
          <label className="campo">
            <span>{t("padroes.idioma")}</span>
            <select
              value={padroes.idiomaDoVideo}
              onChange={(event) => {
                definir({
                  idiomaDoVideo: event.target.value as IdiomaDoVideo,
                });
              }}
            >
              {IDIOMAS.map((idioma) => (
                <option key={idioma} value={idioma}>
                  {t(`padroes.idiomas.${idioma}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>
    </div>
  );
}
