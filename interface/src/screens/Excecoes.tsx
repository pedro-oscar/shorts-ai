import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Excecoes, IdiomaDoVideo, ProjetoResumo } from "../bindings";
import { useAppStore } from "../context";
import { Dialogo } from "./common";
import {
  type CamposDasExcecoes,
  camposDas,
  formatarDuracao,
  lerExcecoes,
  lerFaixa,
} from "./formatos";

const IDIOMAS: IdiomaDoVideo[] = ["automatico", "pt", "en"];
const QUANTIDADES = Array.from({ length: 12 }, (_, i) => i + 1);

/** "Usa os padrões do lote", ou um chip para cada exceção definida. */
export function ResumoDasExcecoes({ excecoes }: { excecoes: Excecoes }) {
  const { t } = useTranslation();
  const chips: string[] = [];
  if (excecoes.quantidadeDeReels != null)
    chips.push(
      t("excecoes.chipReels", {
        reels: t("padroes.reels", { count: excecoes.quantidadeDeReels }),
      }),
    );
  if (excecoes.pedido != null) chips.push(t("excecoes.chipPedido"));
  if (excecoes.faixa)
    chips.push(
      t("excecoes.chipFaixa", {
        inicio: formatarDuracao(excecoes.faixa.inicio),
        fim:
          excecoes.faixa.fim === null
            ? "—"
            : formatarDuracao(excecoes.faixa.fim),
      }),
    );
  if (excecoes.nomesProprios != null) chips.push(t("excecoes.chipNomes"));
  if (excecoes.idiomaDoVideo != null)
    chips.push(
      t("excecoes.chipIdioma", {
        idioma: t(`padroes.idiomas.${excecoes.idiomaDoVideo}`),
      }),
    );
  if (excecoes.kit != null)
    chips.push(t("excecoes.chipKit", { kit: excecoes.kit }));
  if (excecoes.semLogo) chips.push(t("excecoes.chipSemLogo"));
  if (chips.length === 0)
    return <span className="detail">{t("excecoes.usaOsPadroes")}</span>;
  return (
    <ul aria-label={t("excecoes.definidas")} className="chips">
      {chips.map((chip) => (
        <li key={chip}>{chip}</li>
      ))}
    </ul>
  );
}

/** Os campos Início e Fim da Faixa de um vídeo; `nome` distingue os vídeos na tela. */
export function CamposDaFaixa({
  nome,
  inicio,
  fim,
  onChange,
}: {
  nome: string;
  inicio: string;
  fim: string;
  onChange: (campo: "inicio" | "fim", texto: string) => void;
}) {
  const { t } = useTranslation();
  const invalida = lerFaixa(inicio, fim) === "invalida";
  return (
    <fieldset>
      <legend>{t("videos.faixa")}</legend>
      <p className="detail">{t("videos.faixaDica")}</p>
      <div className="campos duas">
        <label className="campo">
          <span>{t("videos.inicio")}</span>
          <input
            type="text"
            placeholder="0:00"
            aria-label={t("videos.faixaInicio", { nome })}
            value={inicio}
            onChange={(event) => {
              onChange("inicio", event.target.value);
            }}
          />
        </label>
        <label className="campo">
          <span>{t("videos.fim")}</span>
          <input
            type="text"
            placeholder="—"
            aria-label={t("videos.faixaFim", { nome })}
            value={fim}
            onChange={(event) => {
              onChange("fim", event.target.value);
            }}
          />
        </label>
      </div>
      {invalida && (
        <p role="alert" className="error">
          {t("videos.faixaInvalida", { nome })}
        </p>
      )}
    </fieldset>
  );
}

/** Os campos de Exceção que valem em qualquer lugar; `nome` distingue os vídeos na tela. */
export function CamposDeExcecoes({
  nome,
  campos,
  onChange,
}: {
  nome: string;
  campos: CamposDasExcecoes;
  onChange: (mudancas: Partial<CamposDasExcecoes>) => void;
}) {
  const { t } = useTranslation();
  const kits = useAppStore((store) => store.kits);
  const carregarKits = useAppStore((store) => store.carregarKits);
  useEffect(() => {
    if (kits.length === 0) void carregarKits();
  }, [kits.length, carregarKits]);
  return (
    <fieldset>
      <legend>{t("excecoes.titulo")}</legend>
      <p className="detail">{t("excecoes.dica")}</p>
      <div className="campos duas">
        <label className="campo">
          <span>{t("padroes.quantidade")}</span>
          <select
            aria-label={t("excecoes.quantidade", { nome })}
            value={campos.quantidade}
            onChange={(event) => {
              onChange({ quantidade: event.target.value });
            }}
          >
            <option value="">{t("excecoes.padrao")}</option>
            {QUANTIDADES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>{t("padroes.idioma")}</span>
          <select
            aria-label={t("excecoes.idioma", { nome })}
            value={campos.idioma}
            onChange={(event) => {
              onChange({
                idioma: event.target.value as CamposDasExcecoes["idioma"],
              });
            }}
          >
            <option value="">{t("excecoes.padrao")}</option>
            {IDIOMAS.map((idioma) => (
              <option key={idioma} value={idioma}>
                {t(`padroes.idiomas.${idioma}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="campo">
        <span>{t("padroes.pedido")}</span>
        <textarea
          rows={2}
          aria-label={t("excecoes.pedido", { nome })}
          value={campos.pedido}
          onChange={(event) => {
            onChange({ pedido: event.target.value });
          }}
        />
      </label>
      <label className="campo">
        <span>{t("padroes.nomesProprios")}</span>
        <textarea
          rows={2}
          aria-label={t("excecoes.nomes", { nome })}
          value={campos.nomes}
          onChange={(event) => {
            onChange({ nomes: event.target.value });
          }}
        />
      </label>
      <label className="campo">
        <span>{t("excecoes.kitRotulo")}</span>
        <select
          aria-label={t("excecoes.kit", { nome })}
          value={campos.kit}
          onChange={(event) => {
            onChange({ kit: event.target.value });
          }}
        >
          <option value="">{t("excecoes.padrao")}</option>
          {kits.map((kit) => (
            <option key={kit.nome} value={kit.nome}>
              {kit.nome}
            </option>
          ))}
        </select>
      </label>
      <label className="marcador">
        <input
          type="checkbox"
          aria-label={t("excecoes.semLogo", { nome })}
          checked={campos.semLogo}
          onChange={(event) => {
            onChange({ semLogo: event.target.checked });
          }}
        />
        {t("excecoes.semLogoRotulo")}
      </label>
    </fieldset>
  );
}

/**
 * As Exceções de um projeto que espera a vez: o resumo e a janela para mudá-las, que só
 * grava ao Salvar.
 */
export function ExcecoesDoProjeto({ projeto }: { projeto: ProjetoResumo }) {
  const { t } = useTranslation();
  const [aberto, setAberto] = useState(false);
  const nome = projeto.titulo;
  return (
    <div>
      <ResumoDasExcecoes excecoes={projeto.excecoes} />
      <button
        type="button"
        className="discreto"
        aria-label={t("excecoes.abrirDe", { nome })}
        aria-expanded={aberto}
        onClick={() => {
          setAberto(true);
        }}
      >
        {t("excecoes.titulo")}
      </button>
      {aberto && (
        <JanelaDasExcecoes
          projeto={projeto}
          onFechar={() => {
            setAberto(false);
          }}
        />
      )}
    </div>
  );
}

function JanelaDasExcecoes({
  projeto,
  onFechar,
}: {
  projeto: ProjetoResumo;
  onFechar: () => void;
}) {
  const { t } = useTranslation();
  const definir = useAppStore((store) => store.definirExcecoes);
  const [campos, setCampos] = useState(() => camposDas(projeto.excecoes));
  const [inicio, setInicio] = useState(() =>
    projeto.excecoes.faixa
      ? formatarDuracao(projeto.excecoes.faixa.inicio)
      : "",
  );
  const [fim, setFim] = useState(() =>
    projeto.excecoes.faixa?.fim == null
      ? ""
      : formatarDuracao(projeto.excecoes.faixa.fim),
  );
  const faixa = lerFaixa(inicio, fim);
  const nome = projeto.titulo;
  return (
    <Dialogo titulo={t("ajustes.titulo", { nome })} onFechar={onFechar}>
      <form
        className="campos"
        onSubmit={(event) => {
          event.preventDefault();
          if (faixa === "invalida") return;
          void definir(projeto.id, lerExcecoes(campos, faixa)).then(onFechar);
        }}
      >
        <CamposDaFaixa
          nome={nome}
          inicio={inicio}
          fim={fim}
          onChange={(campo, texto) => {
            if (campo === "inicio") setInicio(texto);
            else setFim(texto);
          }}
        />
        <CamposDeExcecoes
          nome={nome}
          campos={campos}
          onChange={(mudancas) => {
            setCampos({ ...campos, ...mudancas });
          }}
        />
        <div className="actions fim">
          <button type="button" onClick={onFechar}>
            {t("comum.cancelar")}
          </button>
          <button
            type="submit"
            className="primary"
            aria-label={t("excecoes.salvarDe", { nome })}
            disabled={faixa === "invalida"}
          >
            {t("excecoes.salvar")}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
