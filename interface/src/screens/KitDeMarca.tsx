import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Kit } from "../bindings";
import { useAppStore } from "../context";
import "../fontes";

const NOME_DO_PADRAO = "Padrão";

/** O quadro de exemplo: o título e a legenda com as cores e as fontes do kit em edição. */
function Amostra({ kit }: { kit: Kit }) {
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
  const [rascunho, setRascunho] = useState(doEscolhido);
  const [nome, setNome] = useState("");

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
      <Amostra kit={rascunho} />
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
