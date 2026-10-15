import type { PlanoConfirmado } from "../bindings";
import type { AppStore } from "../store";
import { niveisDoPlano } from "./niveisDoPlano";

/** O plano confirmado serve à conta de agora (a pessoa pode ter trocado de conta). */
function planoServe(subscriptionType: string | null, plano: PlanoConfirmado) {
  return niveisDoPlano(subscriptionType).includes(plano.nivel);
}

/** A conta está pronta para gerar: Claude Code logado, respondendo e com o plano confirmado. */
export function contaPronta(store: AppStore): boolean {
  const { conta, plano, entrando, testeDoClaude } = store;
  return (
    conta?.tipo === "logado" &&
    !entrando &&
    (testeDoClaude === "ok" || testeDoClaude === "pendente") &&
    plano !== null &&
    planoServe(conta.plano, plano)
  );
}
