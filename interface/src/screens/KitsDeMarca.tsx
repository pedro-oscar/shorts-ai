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
import { ErrorMessage, Screen, Topo } from "./common";

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

/** A tela Kits de marca: a lista dos kits à esquerda e o editor do escolhido à direita. */
export function KitsDeMarca({
  onOpenSobre,
  onVoltar,
}: {
  onOpenSobre: () => void;
  onVoltar: () => void;
}) {
  const { t } = useTranslation();
  const kits = useAppStore((store) => store.kits);
  const carregar = useAppStore((store) => store.carregarKits);
  const erro = useAppStore((store) => store.erroDeArquivos);
  const [escolhido, setEscolhido] = useState(NOME_DO_PADRAO);
  const doEscolhido =
    kits.find((kit) => kit.nome === escolhido) ??
    kits.find((kit) => kit.nome === NOME_DO_PADRAO);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <Screen larga title={t("kit.tituloTela")}>
        <p className="muted">{t("kit.explicacao")}</p>
        <div className="kits">
          <div className="cartao">
            <h2>{t("kit.seusKits")}</h2>
            <ul className="kits-lista" aria-label={t("kit.seusKits")}>
              {kits.map((kit) => (
                <li key={kit.nome}>
                  <button
                    type="button"
                    aria-pressed={kit.nome === doEscolhido?.nome}
                    onClick={() => {
                      setEscolhido(kit.nome);
                    }}
                  >
                    {kit.nome}
                    {kit.nome === NOME_DO_PADRAO && (
                      <span className="chip">{t("kit.padrao")}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <p className="detail">{t("kit.dicaDaLista")}</p>
          </div>
          {doEscolhido && (
            // Outro kit, ou o mesmo salvo de novo, recomeça a edição do zero.
            <EditorDoKit
              key={JSON.stringify(doEscolhido)}
              doEscolhido={doEscolhido}
              onSalvo={setEscolhido}
              onApagado={() => {
                setEscolhido(NOME_DO_PADRAO);
              }}
            />
          )}
        </div>
        {erro && <ErrorMessage erro={erro} />}
        <div className="actions">
          <button type="button" onClick={onVoltar}>
            {t("kit.voltar")}
          </button>
        </div>
      </Screen>
    </>
  );
}

function EditorDoKit({
  doEscolhido,
  onSalvo,
  onApagado,
}: {
  doEscolhido: Kit;
  onSalvo: (nome: string) => void;
  onApagado: () => void;
}) {
  const { t } = useTranslation();
  const kits = useAppStore((store) => store.kits);
  const fontes = useAppStore((store) => store.fontesEmbutidas);
  const escolhido = doEscolhido.nome;
  const salvar = useAppStore((store) => store.salvarKit);
  const apagar = useAppStore((store) => store.apagarKit);
  const escolherLogo = useAppStore((store) => store.escolherLogo);
  const verificarLogo = useAppStore((store) => store.verificarLogo);
  const [rascunho, setRascunho] = useState(doEscolhido);
  // O Padrão não muda: o que sair dele vira outro kit, com um nome novo.
  const [nome, setNome] = useState(
    escolhido === NOME_DO_PADRAO ? "" : escolhido,
  );
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

  const mudar = (mudancas: Partial<Kit>) => {
    setRascunho({ ...rascunho, ...mudancas });
  };
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

  const alterado = JSON.stringify(rascunho) !== JSON.stringify(doEscolhido);
  const nomeLimpo = nome.trim();
  const nomeLivre = nomeLimpo !== "" && nomeLimpo !== NOME_DO_PADRAO;
  const sobrescreve = kits.some((kit) => kit.nome === nomeLimpo);
  const seletorDeFonte = (
    rotulo: string,
    campo: "fonteDaLegenda" | "fonteDosTitulos",
  ) => (
    <label className="campo">
      <span>{rotulo}</span>
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
    <section
      className="cartao"
      aria-label={t("kit.editorDe", { nome: escolhido })}
    >
      <h2>{t("kit.editorDe", { nome: escolhido })}</h2>
      <div className="kit-editor">
        <div className="campos">
          <div className="campos duas">
            <label className="campo">
              <span>{t("kit.corDeDestaque")}</span>
              <input
                type="color"
                value={rascunho.corDeDestaque.toLowerCase()}
                onChange={(event) => {
                  mudar({ corDeDestaque: event.target.value });
                }}
              />
            </label>
            <label className="campo">
              <span>{t("kit.corDaPalavra")}</span>
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
          </div>
          <fieldset>
            <legend>{t("kit.logo")}</legend>
            <div className="actions">
              <button
                type="button"
                onClick={() => {
                  void trocarLogo();
                }}
              >
                {rascunho.logo ? t("kit.trocarLogo") : t("kit.escolherLogo")}
              </button>
              {rascunho.logo && (
                <button
                  type="button"
                  onClick={() => {
                    setVerificacao(null);
                    mudar({ logo: null });
                  }}
                >
                  {t("kit.tirarLogo")}
                </button>
              )}
            </div>
            {rascunho.logo && (
              <>
                <p className="detail">{rascunho.logo.arquivo}</p>
                {verificacao && !verificacao.comTransparencia && (
                  <p role="alert" className="error">
                    {t("kit.semTransparencia")}
                  </p>
                )}
                <div className="campos duas">
                  <label className="campo">
                    <span>{t("kit.posicao")}</span>
                    <select
                      value={rascunho.logo.posicao}
                      onChange={(event) => {
                        mudarLogo({
                          posicao: event.target.value as PosicaoDaLogo,
                        });
                      }}
                    >
                      {POSICOES.map((posicao) => (
                        <option key={posicao} value={posicao}>
                          {t(`kit.posicoes.${posicao}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="campo">
                    <span>{t("kit.quando")}</span>
                    <select
                      value={rascunho.logo.quando}
                      onChange={(event) => {
                        mudarLogo({
                          quando: event.target.value as QuandoAparece,
                        });
                      }}
                    >
                      {QUANDOS.map((quando) => (
                        <option key={quando} value={quando}>
                          {t(`kit.quandos.${quando}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="campo">
                    <span>
                      {t("kit.largura", { valor: rascunho.logo.largura })}
                    </span>
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
                  <label className="campo">
                    <span>
                      {t("kit.opacidade", { valor: rascunho.logo.opacidade })}
                    </span>
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
                </div>
              </>
            )}
          </fieldset>
        </div>
        <Amostra kit={rascunho} previa={verificacao?.previa} />
      </div>
      {alterado && <p className="detail">{t("kit.alteradoDica")}</p>}
      <div className="campos duas">
        <label className="campo">
          <span>{t("kit.nome")}</span>
          <input
            type="text"
            value={nome}
            onChange={(event) => {
              setNome(event.target.value);
            }}
          />
        </label>
      </div>
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={!nomeLivre}
          onClick={() => {
            void salvar({ ...rascunho, nome: nomeLimpo }).then((salvou) => {
              if (salvou) onSalvo(nomeLimpo);
            });
          }}
        >
          {sobrescreve ? t("kit.salvarMesmo") : t("kit.salvar")}
        </button>
        {escolhido !== NOME_DO_PADRAO && (
          <button
            type="button"
            className="discreto"
            onClick={() => {
              void apagar(escolhido).then(onApagado);
            }}
          >
            {t("kit.apagar", { nome: escolhido })}
          </button>
        )}
      </div>
    </section>
  );
}
