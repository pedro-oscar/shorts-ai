import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  Kit,
  Logo,
  PosicaoDaLogo,
  QuandoAparece,
  VerificacaoDaLogo,
} from "../bindings";
import { useAppStore } from "../context";
import "../fontes";

const NOME_DO_PADRAO = "Padrão";
const POSICOES: PosicaoDaLogo[] = [
  "automatica",
  "superiorEsquerdo",
  "superiorDireito",
  "inferiorEsquerdo",
  "inferiorDireito",
];
const QUANDOS: QuandoAparece[] = ["sempre", "inicio", "fim"];

/** Onde a logo cai no quadro da Amostra; a automática aparece no canto de cima, à direita. */
function cantoDaAmostra(posicao: PosicaoDaLogo) {
  const alto = posicao.startsWith("inferior");
  const esquerdo = posicao.endsWith("Esquerdo");
  return {
    [alto ? "bottom" : "top"]: "8%",
    [esquerdo ? "left" : "right"]: "6%",
  };
}

/** O quadro de exemplo: o título e a legenda com as cores e as fontes do kit em edição. */
function Amostra({ kit, previa }: { kit: Kit; previa: string | undefined }) {
  const { t } = useTranslation();
  const estiloDaFonte = (fonte: string) => ({
    fontFamily: `"${fonte}", sans-serif`,
    fontWeight: 900,
    fontSynthesis: "none",
    textTransform: "uppercase" as const,
  });
  return (
    <div
      className="kit-amostra"
      role="img"
      aria-label={t("kit.amostra")}
      data-testid="amostra-do-kit"
    >
      <span
        className="kit-amostra-titulo"
        style={{
          ...estiloDaFonte(kit.fonteDosTitulos),
          background: kit.corDeDestaque,
        }}
      >
        {t("kit.amostraTitulo")}
      </span>
      <span
        className="kit-amostra-legenda"
        style={estiloDaFonte(kit.fonteDaLegenda)}
      >
        {t("kit.amostraLegenda")}{" "}
        <span style={{ color: kit.corDaPalavra }}>
          {t("kit.amostraPalavra")}
        </span>
      </span>
      {kit.logo && previa && (
        <img
          className="kit-amostra-logo"
          data-testid="logo-da-amostra"
          src={previa}
          alt=""
          style={{
            ...cantoDaAmostra(kit.logo.posicao),
            width: `${String(kit.logo.largura)}%`,
            opacity: kit.logo.opacidade / 100,
          }}
        />
      )}
    </div>
  );
}

/** O bloco "Kit de marca" do passo Padrões: escolher um kit, ajustar e salvar como outro. */
export function KitDeMarca() {
  const kits = useAppStore((store) => store.kits);
  const escolhido = useAppStore((store) => store.padroes.kit);
  const carregar = useAppStore((store) => store.carregarKits);
  const doEscolhido = kits.find((kit) => kit.nome === escolhido);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Outro kit, ou o mesmo salvo de novo, recomeça a edição do zero.
  return doEscolhido ? (
    <EditorDoKit key={JSON.stringify(doEscolhido)} doEscolhido={doEscolhido} />
  ) : null;
}

function EditorDoKit({ doEscolhido }: { doEscolhido: Kit }) {
  const { t } = useTranslation();
  const kits = useAppStore((store) => store.kits);
  const fontes = useAppStore((store) => store.fontesEmbutidas);
  const escolhido = doEscolhido.nome;
  const definirPadroes = useAppStore((store) => store.definirPadroes);
  const salvar = useAppStore((store) => store.salvarKit);
  const apagar = useAppStore((store) => store.apagarKit);
  const escolherLogo = useAppStore((store) => store.escolherLogo);
  const verificarLogo = useAppStore((store) => store.verificarLogo);
  const [rascunho, setRascunho] = useState(doEscolhido);
  const [nome, setNome] = useState("");
  const [verificacao, setVerificacao] = useState<VerificacaoDaLogo | null>(
    null,
  );
  const arquivoDaLogo = rascunho.logo?.arquivo;

  useEffect(() => {
    if (arquivoDaLogo === undefined) return;
    let atual = true;
    void verificarLogo(arquivoDaLogo).then((resultado) => {
      if (atual) setVerificacao(resultado);
    });
    return () => {
      atual = false;
    };
  }, [arquivoDaLogo, verificarLogo]);

  const mudarLogo = (mudancas: Partial<Logo>) => {
    if (rascunho.logo) mudar({ logo: { ...rascunho.logo, ...mudancas } });
  };
  const trocarLogo = async () => {
    const arquivo = await escolherLogo();
    if (arquivo === null) return;
    mudar({
      logo: rascunho.logo
        ? { ...rascunho.logo, arquivo }
        : {
            arquivo,
            posicao: "automatica",
            largura: 14,
            opacidade: 80,
            quando: "sempre",
            proporcao: 1,
          },
    });
  };

  const mudar = (mudancas: Partial<Kit>) => {
    setRascunho({ ...rascunho, ...mudancas });
  };
  const alterado = JSON.stringify(rascunho) !== JSON.stringify(doEscolhido);
  const nomeLivre = nome.trim() !== "" && nome.trim() !== NOME_DO_PADRAO;
  const seletorDeFonte = (
    rotulo: string,
    campo: "fonteDaLegenda" | "fonteDosTitulos",
  ) => (
    <label>
      {rotulo}
      <select
        value={rascunho[campo]}
        onChange={(event) => {
          mudar({ [campo]: event.target.value });
        }}
      >
        {fontes.map((fonte) => (
          <option key={fonte} value={fonte}>
            {fonte}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <fieldset>
      <legend>{t("kit.titulo")}</legend>
      <label>
        {t("kit.kit")}
        <select
          value={escolhido}
          onChange={(event) => {
            definirPadroes({ kit: event.target.value });
          }}
        >
          {kits.map((kit) => (
            <option key={kit.nome} value={kit.nome}>
              {kit.nome}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("kit.corDeDestaque")}
        <input
          type="color"
          value={rascunho.corDeDestaque.toLowerCase()}
          onChange={(event) => {
            mudar({ corDeDestaque: event.target.value });
          }}
        />
      </label>
      <label>
        {t("kit.corDaPalavra")}
        <input
          type="color"
          value={rascunho.corDaPalavra.toLowerCase()}
          onChange={(event) => {
            mudar({ corDaPalavra: event.target.value });
          }}
        />
      </label>
      {seletorDeFonte(t("kit.fonteDaLegenda"), "fonteDaLegenda")}
      {seletorDeFonte(t("kit.fonteDosTitulos"), "fonteDosTitulos")}
      <fieldset>
        <legend>{t("kit.logo")}</legend>
        <button
          type="button"
          onClick={() => {
            void trocarLogo();
          }}
        >
          {rascunho.logo ? t("kit.trocarLogo") : t("kit.escolherLogo")}
        </button>
        {rascunho.logo && (
          <>
            <button
              type="button"
              onClick={() => {
                setVerificacao(null);
                mudar({ logo: null });
              }}
            >
              {t("kit.tirarLogo")}
            </button>
            <p className="detail">{rascunho.logo.arquivo}</p>
            {verificacao && !verificacao.comTransparencia && (
              <p role="alert">{t("kit.semTransparencia")}</p>
            )}
            <label>
              {t("kit.posicao")}
              <select
                value={rascunho.logo.posicao}
                onChange={(event) => {
                  mudarLogo({ posicao: event.target.value as PosicaoDaLogo });
                }}
              >
                {POSICOES.map((posicao) => (
                  <option key={posicao} value={posicao}>
                    {t(`kit.posicoes.${posicao}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("kit.largura", { valor: rascunho.logo.largura })}
              <input
                type="range"
                min={6}
                max={30}
                value={rascunho.logo.largura}
                onChange={(event) => {
                  mudarLogo({ largura: Number(event.target.value) });
                }}
              />
            </label>
            <label>
              {t("kit.opacidade", { valor: rascunho.logo.opacidade })}
              <input
                type="range"
                min={20}
                max={100}
                value={rascunho.logo.opacidade}
                onChange={(event) => {
                  mudarLogo({ opacidade: Number(event.target.value) });
                }}
              />
            </label>
            <label>
              {t("kit.quando")}
              <select
                value={rascunho.logo.quando}
                onChange={(event) => {
                  mudarLogo({ quando: event.target.value as QuandoAparece });
                }}
              >
                {QUANDOS.map((quando) => (
                  <option key={quando} value={quando}>
                    {t(`kit.quandos.${quando}`)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </fieldset>
      <Amostra kit={rascunho} previa={verificacao?.previa} />
      {alterado && <p className="detail">{t("kit.alteradoDica")}</p>}
      <label>
        {t("kit.nome")}
        <input
          type="text"
          value={nome}
          onChange={(event) => {
            setNome(event.target.value);
          }}
        />
      </label>
      <button
        type="button"
        disabled={!nomeLivre}
        onClick={() => {
          void salvar({ ...rascunho, nome: nome.trim() });
        }}
      >
        {t("kit.salvar")}
      </button>
      {escolhido !== NOME_DO_PADRAO && (
        <button
          type="button"
          onClick={() => {
            void apagar(escolhido);
          }}
        >
          {t("kit.apagar", { nome: escolhido })}
        </button>
      )}
    </fieldset>
  );
}
