import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { tauriNucleo } from "./nucleo";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html sem o elemento #root");
createRoot(root).render(
  <StrictMode>
    <App nucleo={tauriNucleo} />
  </StrictMode>,
);
