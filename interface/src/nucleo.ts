import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { commands, events, type Evento } from "./bindings";

/**
 * O núcleo como a interface o vê: os comandos gerados pelo tauri-specta e os eventos dele.
 * Nos testes, um núcleo falso (test/fakeNucleo.ts) faz o mesmo papel, sem o Tauri.
 */
export type Nucleo = typeof commands & {
  /** Passa ao ouvinte cada evento do núcleo; a promessa traz a função que para de ouvir. */
  listen: (listener: (evento: Evento) => void) => Promise<() => void>;
  /** O endereço pelo qual a interface toca o arquivo da Biblioteca. */
  urlDoArquivo: (caminho: string) => string;
  /** Passa ao ouvinte os caminhos dos arquivos que a pessoa soltou na janela. */
  aoSoltarArquivos: (
    listener: (caminhos: string[]) => void,
  ) => Promise<() => void>;
};

export const tauriNucleo: Nucleo = {
  ...commands,
  listen: (listener) =>
    events.eventoDoNucleo.listen((event) => {
      listener(event.payload);
    }),
  urlDoArquivo: convertFileSrc,
  aoSoltarArquivos: (listener) =>
    getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop") listener(event.payload.paths);
    }),
};
