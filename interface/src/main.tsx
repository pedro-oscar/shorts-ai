import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { tauriNucleo } from "./nucleo";
// As fontes da interface vêm empacotadas: o CSP só deixa carregar fontes do próprio app.
import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-ext-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-ext-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow/latin-ext-600.css";
import "@fontsource/barlow/latin-700.css";
import "@fontsource/barlow/latin-ext-700.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-ext-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-ext-700.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html sem o elemento #root");
createRoot(root).render(
  <StrictMode>
    <App nucleo={tauriNucleo} />
  </StrictMode>,
);
