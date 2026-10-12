import { useCallback, useEffect, useMemo, useState } from "react";
import { I18nextProvider } from "react-i18next";
import { AbrirLotesContext, StoreContext, useAppStore } from "./context";
import { createI18n } from "./i18n";
import type { Nucleo } from "./nucleo";
import { Aviso } from "./screens/Aviso";
import { Conta } from "./screens/Conta";
import { ErroAoAbrir } from "./screens/ErroAoAbrir";
import { Gerando } from "./screens/Gerando";
import { Lotes } from "./screens/Lotes";
import { Padroes } from "./screens/Padroes";
import { Preparacao } from "./screens/Preparacao";
import { Reels } from "./screens/Reels";
import { Sobre } from "./screens/Sobre";
import { Videos } from "./screens/Videos";
import { createAppStore } from "./store";

export function App({ nucleo }: { nucleo: Nucleo }) {
  const [store] = useState(() => createAppStore(nucleo));
  useEffect(() => store.getState().connect(), [store]);
  return (
    <StoreContext value={store}>
      <InInterfaceLanguage />
    </StoreContext>
  );
}

/** Nada aparece antes de o núcleo dizer o idioma da interface. */
function InInterfaceLanguage() {
  const idioma = useAppStore((store) => store.app?.idiomaDaInterface);
  const i18n = useMemo(() => (idioma ? createI18n(idioma) : null), [idioma]);
  useEffect(() => {
    if (idioma) document.documentElement.lang = idioma;
  }, [idioma]);

  if (!i18n) return null;
  return (
    <I18nextProvider i18n={i18n}>
      <Screens />
    </I18nextProvider>
  );
}

function Screens() {
  const [lotesOpen, setLotesOpen] = useState(false);
  const aceito = useAppStore((store) => store.aceite !== null);
  const preparado = useAppStore((store) =>
    store.preparacao?.pacotes.every((p) => p.presente),
  );
  const abrirLotes = useCallback(() => {
    setLotesOpen(true);
  }, []);
  return (
    <AbrirLotesContext value={aceito && preparado ? abrirLotes : null}>
      <Passos lotesOpen={lotesOpen} setLotesOpen={setLotesOpen} />
    </AbrirLotesContext>
  );
}

function Passos({
  lotesOpen,
  setLotesOpen,
}: {
  lotesOpen: boolean;
  setLotesOpen: (aberto: boolean) => void;
}) {
  const erroAoAbrir = useAppStore((store) => store.erroAoAbrir);
  const aceito = useAppStore((store) => store.aceite !== null);
  const preparacao = useAppStore((store) => store.preparacao);
  const [sobreOpen, setSobreOpen] = useState(false);
  // Aqui, e não no Aviso, porque o Sobre desmonta o Aviso.
  const [concordo, setConcordo] = useState(false);
  const loteAberto = useAppStore((store) => store.lotes.some((l) => l.aberto));
  const abrirLote = useAppStore((store) => store.abrirLote);
  const adicionarAoLoteAtual = useAppStore(
    (store) => store.adicionarAoLoteAtual,
  );
  const gerar = useAppStore((store) => store.gerar);
  const adicionando = useAppStore((store) => store.adicionandoAoLote);
  const [passo, setPasso] = useState<
    "conta" | "videos" | "padroes" | "gerando" | "reels" | null
  >(null);
  // Com um lote aberto, o app abre direto em Gerando.
  const passoAtual = passo ?? (loteAberto ? "gerando" : "conta");

  if (erroAoAbrir) return <ErroAoAbrir erro={erroAoAbrir} />;
  if (sobreOpen)
    return (
      <Sobre
        onBack={() => {
          setSobreOpen(false);
        }}
      />
    );
  const openSobre = () => {
    setSobreOpen(true);
  };
  // Antes de a Conta abrir, o que falta baixar da primeira execução.
  if (aceito && !preparacao) return null;
  if (aceito && preparacao && !preparacao.pacotes.every((p) => p.presente))
    return <Preparacao onOpenSobre={openSobre} />;
  if (aceito && lotesOpen)
    return (
      <Lotes
        onOpenSobre={openSobre}
        onVoltar={() => {
          setLotesOpen(false);
        }}
        onAbrir={(lote) => {
          abrirLote(lote);
          setLotesOpen(false);
          setPasso("gerando");
        }}
      />
    );
  if (aceito && passoAtual === "reels")
    return (
      <Reels
        onOpenSobre={openSobre}
        onVoltar={() => {
          setPasso("gerando");
        }}
      />
    );
  if (aceito && passoAtual === "gerando")
    return (
      <Gerando
        onOpenSobre={openSobre}
        onVerReels={() => {
          setPasso("reels");
        }}
        onAdicionar={() => {
          adicionarAoLoteAtual(true);
          setPasso("videos");
        }}
        onNovoLote={() => {
          adicionarAoLoteAtual(false);
          setPasso("videos");
        }}
      />
    );
  if (aceito && passoAtual === "padroes")
    return (
      <Padroes
        onOpenSobre={openSobre}
        onVoltar={() => {
          setPasso("videos");
        }}
        onGerado={() => {
          setPasso("gerando");
        }}
      />
    );
  if (aceito && passoAtual === "videos")
    return (
      <Videos
        onOpenSobre={openSobre}
        onContinuar={() => {
          if (!adicionando) {
            setPasso("padroes");
            return;
          }
          // Os vídeos entram no fim da fila do lote, com os padrões dele.
          void gerar().then((criou) => {
            if (criou) setPasso("gerando");
          });
        }}
        onVoltar={
          adicionando
            ? () => {
                adicionarAoLoteAtual(false);
                setPasso("gerando");
              }
            : undefined
        }
      />
    );
  return aceito ? (
    <Conta
      onOpenSobre={openSobre}
      onContinuar={() => {
        setPasso("videos");
      }}
    />
  ) : (
    <Aviso
      concordo={concordo}
      onConcordoChange={setConcordo}
      onOpenSobre={openSobre}
    />
  );
}
