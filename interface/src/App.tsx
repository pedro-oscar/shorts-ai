import { useEffect, useMemo, useState } from "react";
import { I18nextProvider } from "react-i18next";
import { StoreContext, useAppStore } from "./context";
import { createI18n } from "./i18n";
import type { Nucleo } from "./nucleo";
import { Aviso } from "./screens/Aviso";
import { Conta } from "./screens/Conta";
import { ErroAoAbrir } from "./screens/ErroAoAbrir";
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
  const erroAoAbrir = useAppStore((store) => store.erroAoAbrir);
  const aceito = useAppStore((store) => store.aceite !== null);
  const [sobreOpen, setSobreOpen] = useState(false);
  // Aqui, e não no Aviso, porque o Sobre desmonta o Aviso.
  const [concordo, setConcordo] = useState(false);
  const [passo, setPasso] = useState<"conta" | "videos">("conta");

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
  if (aceito && passo === "videos") return <Videos onOpenSobre={openSobre} />;
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
