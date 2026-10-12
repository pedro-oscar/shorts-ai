import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Excecoes, IdiomaDoVideo, ProjetoResumo } from "../bindings";
import { useAppStore } from "../context";
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
    <div className="exceptions">
      <label>
        {t("padroes.quantidade")}
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
      <label>
        {t("padroes.pedido")}
        <textarea
          aria-label={t("excecoes.pedido", { nome })}
          value={campos.pedido}
          onChange={(event) => {
            onChange({ pedido: event.target.value });
          }}
        />
      </label>
      <label>
        {t("padroes.nomesProprios")}
        <textarea
          aria-label={t("excecoes.nomes", { nome })}
          value={campos.nomes}
          onChange={(event) => {
            onChange({ nomes: event.target.value });
          }}
        />
      </label>
      <label>
        {t("padroes.idioma")}
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
      <label>
        {t("excecoes.kitRotulo")}
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
      <label>
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
    </div>
  );
}

/** As Exceções de um projeto que espera a vez: o resumo e o formulário para mudá-las. */
export function ExcecoesDoProjeto({ projeto }: { projeto: ProjetoResumo }) {
  const { t } = useTranslation();
  const definir = useAppStore((store) => store.definirExcecoes);
  const [aberto, setAberto] = useState(false);
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
    <div>
      <ResumoDasExcecoes excecoes={projeto.excecoes} />{" "}
      <button
        type="button"
        aria-label={t("excecoes.abrirDe", { nome })}
        aria-expanded={aberto}
        onClick={() => {
          setAberto(!aberto);
        }}
      >
        {t("excecoes.titulo")}
      </button>
      {aberto && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (faixa === "invalida") return;
            void definir(projeto.id, lerExcecoes(campos, faixa)).then(() => {
              setAberto(false);
            });
          }}
        >
          <CamposDeExcecoes
            nome={nome}
            campos={campos}
            onChange={(mudancas) => {
              setCampos({ ...campos, ...mudancas });
            }}
          />
          <input
            type="text"
            placeholder="0:00"
            aria-label={t("videos.faixaInicio", { nome })}
            value={inicio}
            onChange={(event) => {
              setInicio(event.target.value);
            }}
          />
          <input
            type="text"
            placeholder="—"
            aria-label={t("videos.faixaFim", { nome })}
            value={fim}
            onChange={(event) => {
              setFim(event.target.value);
            }}
          />
          {faixa === "invalida" && (
            <span role="alert" className="detail">
              {t("videos.faixaInvalida", { nome })}
            </span>
          )}
          <button
            type="submit"
            aria-label={t("excecoes.salvarDe", { nome })}
            disabled={faixa === "invalida"}
          >
            {t("excecoes.salvar")}
          </button>
        </form>
      )}
    </div>
  );
}
