import { createContext, use } from "react";
import { useStore } from "zustand";
import type { AppStore, AppStoreApi } from "./store";

/** Abre o histórico de lotes; `null` enquanto a pessoa não chegou aos passos. */
export const AbrirLotesContext = createContext<(() => void) | null>(null);

/** Abre as Configurações; `null` enquanto a pessoa não chegou aos passos. */
export const AbrirConfiguracoesContext = createContext<(() => void) | null>(
  null,
);

export const StoreContext = createContext<AppStoreApi | null>(null);

/** Lê do estado do app o que o seletor escolher, e redesenha quando isso muda. */
export function useAppStore<T>(selector: (store: AppStore) => T): T {
  const store = use(StoreContext);
  if (!store) throw new Error("useAppStore fora do StoreContext");
  return useStore(store, selector);
}
