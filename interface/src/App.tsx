import { useCallback, useEffect, useMemo, useState } from "react";
import { I18nextProvider } from "react-i18next";
import {
  NavegacaoContext,
  StoreContext,
  useAppStore,
  type Tela,
} from "./context";
import { createI18n } from "./i18n";
import type { Nucleo } from "./nucleo";
import { Aviso } from "./screens/Aviso";
import { Configuracoes } from "./screens/Configuracoes";
import { Conta } from "./screens/Conta";
import { ErroAoAbrir } from "./screens/ErroAoAbrir";
import { KitsDeMarca } from "./screens/KitsDeMarca";
import { FundoDoQuadro, LinhaDeProducao } from "./screens/LinhaDeProducao";
import { Lotes } from "./screens/Lotes";
import { Preparacao } from "./screens/Preparacao";
import { SalaDeRevisao } from "./screens/SalaDeRevisao";
import { Sobre } from "./screens/Sobre";
import { Videos } from "./screens/Videos";
import { Topo } from "./screens/common";
import { createAppStore } from "./store";
import { useTranslation } from "react-i18next";

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

interface Navegacao {
  /** `null` até a pessoa escolher uma tela: a Linha de produção, ou os Vídeos sem lote. */
  tela: Tela | null;
  /** As telas por onde a pessoa passou, para Voltar. */
  pilha: Tela[];
}

/** O que vem antes da Linha de produção: o erro ao abrir, o Aviso, a Preparação e a Conta. */
function Screens() {
  const { t } = useTranslation();
  const erroAoAbrir = useAppStore((store) => store.erroAoAbrir);
  const aceito = useAppStore((store) => store.aceite !== null);
  const preparacao = useAppStore((store) => store.preparacao);
  const preparado =
    preparacao?.pacotes.every((pacote) => pacote.presente) ?? false;
  const conta = useAppStore((store) => store.conta);
  const verificarConta = useAppStore((store) => store.verificarConta);
  const [sobreOpen, setSobreOpen] = useState(false);
  // Aqui, e não no Aviso, porque o Sobre desmonta o Aviso.
  const [concordo, setConcordo] = useState(false);
  // Aqui, e não nas Telas, porque o Sobre as desmonta.
  const [navegacao, setNavegacao] = useState<Navegacao>({
    tela: null,
    pilha: [],
  });
  const openSobre = useCallback(() => {
    setSobreOpen(true);
  }, []);

  useEffect(() => {
    if (aceito && preparado && conta === null) void verificarConta();
  }, [aceito, preparado, conta, verificarConta]);

  if (erroAoAbrir) return <ErroAoAbrir erro={erroAoAbrir} />;
  if (sobreOpen)
    return (
      <Sobre
        onBack={() => {
          setSobreOpen(false);
        }}
      />
    );
  if (!aceito)
    return (
      <Aviso
        concordo={concordo}
        onConcordoChange={setConcordo}
        onOpenSobre={openSobre}
      />
    );
  // Antes de a Conta abrir, o que falta baixar da primeira execução.
  if (!preparacao) return null;
  if (!preparado) return <Preparacao onOpenSobre={openSobre} />;
  if (conta === null)
    return (
      <>
        <Topo onOpenSobre={openSobre} />
        <main className="screen">
          <p role="status" className="muted">
            {t("conta.verificando")}
          </p>
        </main>
      </>
    );
  return (
    <Telas
      onOpenSobre={openSobre}
      navegacao={navegacao}
      setNavegacao={setNavegacao}
    />
  );
}

/**
 * As telas depois da Conta: a Linha de produção com a folha de Vídeos, a Sala de revisão,
 * os Lotes, as Configurações, os Kits de marca e a Conta.
 */
function Telas({
  onOpenSobre,
  navegacao,
  setNavegacao,
}: {
  onOpenSobre: () => void;
  navegacao: Navegacao;
  setNavegacao: (mudar: Navegacao | ((atual: Navegacao) => Navegacao)) => void;
}) {
  // A Conta só abre sozinha quando falta algo nela, e fica até a pessoa Continuar.
  const portao = useAppStore((store) => !store.contaConferida);
  const conferirConta = useAppStore((store) => store.conferirConta);
  const semLotes = useAppStore((store) => store.lotes.length === 0);
  const abrirLote = useAppStore((store) => store.abrirLote);
  const adicionarAoLoteAtual = useAppStore(
    (store) => store.adicionarAoLoteAtual,
  );
  const telaAtual: Tela = navegacao.tela ?? (semLotes ? "videos" : "linha");
  const navegar = useCallback(
    (proxima: Tela) => {
      setNavegacao((atual) => ({
        tela: proxima,
        pilha: [...atual.pilha, telaAtual],
      }));
    },
    [setNavegacao, telaAtual],
  );
  const voltar = useCallback(() => {
    setNavegacao((atual) => ({
      tela: atual.pilha.at(-1) ?? "linha",
      pilha: atual.pilha.slice(0, -1),
    }));
  }, [setNavegacao]);
  /** Vai para a tela e esquece o caminho até aqui, como ao Gerar. */
  const ir = useCallback(
    (proxima: Tela) => {
      setNavegacao({ tela: proxima, pilha: [] });
    },
    [setNavegacao],
  );

  if (portao)
    return <Conta onOpenSobre={onOpenSobre} onContinuar={conferirConta} />;
  let tela;
  switch (telaAtual) {
    case "linha":
      tela = (
        <LinhaDeProducao
          onOpenSobre={onOpenSobre}
          onVerReels={() => {
            navegar("sala");
          }}
          onAdicionar={() => {
            adicionarAoLoteAtual(true);
            navegar("videos");
          }}
          onNovoLote={() => {
            adicionarAoLoteAtual(false);
            navegar("videos");
          }}
        />
      );
      break;
    case "videos":
      tela = (
        <>
          <Topo onOpenSobre={onOpenSobre} />
          <FundoDoQuadro />
          <Videos
            onGerado={() => {
              ir("linha");
            }}
            onFechar={semLotes ? undefined : voltar}
            onAbrirKits={() => {
              navegar("kits");
            }}
          />
        </>
      );
      break;
    case "sala":
      tela = <SalaDeRevisao onOpenSobre={onOpenSobre} onVoltar={voltar} />;
      break;
    case "lotes":
      tela = (
        <Lotes
          onOpenSobre={onOpenSobre}
          onVoltar={voltar}
          onAbrir={(lote) => {
            abrirLote(lote);
            ir("linha");
          }}
        />
      );
      break;
    case "configuracoes":
      tela = (
        <Configuracoes
          onOpenSobre={onOpenSobre}
          onVoltar={voltar}
          onAbrirKits={() => {
            navegar("kits");
          }}
          onAbrirConta={() => {
            navegar("conta");
          }}
        />
      );
      break;
    case "kits":
      tela = <KitsDeMarca onOpenSobre={onOpenSobre} onVoltar={voltar} />;
      break;
    case "conta":
      tela = <Conta onOpenSobre={onOpenSobre} onVoltar={voltar} />;
      break;
  }
  return <NavegacaoContext value={navegar}>{tela}</NavegacaoContext>;
}
