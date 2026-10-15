import { createContext, use } from "react";
import { useStore } from "zustand";
import type { AppStore, AppStoreApi } from "./store";

/** As telas a que o topo e as outras telas levam, depois do Aviso e da Preparação. */
export type Tela =
  "linha" | "videos" | "sala" | "lotes" | "configuracoes" | "kits" | "conta";

/** Muda de tela; `null` enquanto a pessoa não chegou à Linha de produção. */
export const NavegacaoContext = createContext<((tela: Tela) => void) | null>(
  null,
);

export const StoreContext = createContext<AppStoreApi | null>(null);

/** Lê do estado do app o que o seletor escolher, e redesenha quando isso muda. */
export function useAppStore<T>(selector: (store: AppStore) => T): T {
  const store = use(StoreContext);
  if (!store) throw new Error("useAppStore fora do StoreContext");
  return useStore(store, selector);
}
