import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../context";
import { ErrorMessage, Screen, Topo } from "./common";
import type { PlanoConfirmado } from "../bindings";
import { niveisDoPlano } from "./niveisDoPlano";
import { PlanoDaConta } from "./PlanoDaConta";

/** O passo Conta: só deixa continuar com o Claude Code instalado, atualizado e logado. */
export function Conta({
  onOpenSobre,
  onContinuar,
}: {
  onOpenSobre: () => void;
  onContinuar: () => void;
}) {
  const { t } = useTranslation();
  const conta = useAppStore((store) => store.conta);
  const entrando = useAppStore((store) => store.entrando);
  const teste = useAppStore((store) => store.testeDoClaude);
  const erro = useAppStore((store) => store.erroDaConta);
  const instalando = useAppStore((store) => store.instalando);
  const atualizando = useAppStore((store) => store.atualizando);
  const saida = useAppStore((store) => store.saidaDoComando);
  const porTerminal = useAppStore((store) => store.loginPorTerminal);
  const setPorTerminal = useAppStore((store) => store.setLoginPorTerminal);
  const plano = useAppStore((store) => store.plano);
  const chaveDeApi = useAppStore((store) => store.chaveDeApiNoAmbiente);
  const instalar = useAppStore((store) => store.instalarClaudeCode);
  const atualizar = useAppStore((store) => store.atualizarClaudeCode);
  const verificarConta = useAppStore((store) => store.verificarConta);
  const entrar = useAppStore((store) => store.entrarNoClaudeCode);
  const testar = useAppStore((store) => store.testarClaude);

  useEffect(() => {
    void verificarConta();
  }, [verificarConta]);

  const logado = conta?.tipo === "logado";
  const planoConfirmado =
    conta?.tipo === "logado" &&
    plano !== null &&
    planoServe(conta.plano, plano);
  const podeContinuar =
    logado &&
    !entrando &&
    (teste === "ok" || teste === "pendente") &&
    planoConfirmado;
  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <Screen title={t("conta.titulo")}>
        {conta === null && <p role="status">{t("conta.verificando")}</p>}
        {conta && conta.tipo !== "naoInstalado" && (
          <p className="muted">
            {t("conta.versaoEncontrada", { versao: conta.versao })}
          </p>
        )}
        {chaveDeApi && <p className="muted">{t("conta.chaveDeApi")}</p>}
        {conta?.tipo === "naoInstalado" && (
          <>
            <p role="status">{t("conta.naoInstalado")}</p>
            {instalando && <p role="status">{t("conta.instalando")}</p>}
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={instalando}
                onClick={() => void instalar()}
              >
                {t("conta.instalar")}
              </button>
            </div>
          </>
        )}
        {conta?.tipo === "versaoAntiga" && (
          <p role="status">
            {t("conta.versaoAntiga", {
              versao: conta.versao,
              minima: conta.minima,
            })}
          </p>
        )}
        {conta?.tipo === "versaoAntiga" && (
          <>
            {atualizando && <p role="status">{t("conta.atualizando")}</p>}
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={atualizando}
                onClick={() => void atualizar()}
              >
                {t("conta.atualizar")}
              </button>
            </div>
          </>
        )}
        {conta?.tipo === "semLogin" && (
          <>
            <p role="status">{t("conta.semLogin")}</p>
            <p className="muted">{t("conta.loginSeparado")}</p>
            {entrando && <p role="status">{t("conta.entrando")}</p>}
            <label>
              <input
                type="checkbox"
                checked={porTerminal}
                disabled={entrando}
                onChange={(event) => {
                  setPorTerminal(event.target.checked);
                }}
              />{" "}
              {t("conta.loginPorTerminal")}
            </label>
            {porTerminal && (
              <p className="muted">{t("conta.loginPorTerminalAjuda")}</p>
            )}
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={entrando}
                onClick={() => void entrar("assinatura")}
              >
                {t("conta.entrar")}
              </button>
              <button
                type="button"
                disabled={entrando}
                onClick={() => void entrar("console")}
              >
                {t("conta.entrarConsole")}
              </button>
            </div>
          </>
        )}
        {conta?.tipo === "logado" && (
          <>
            <p>
              {t("conta.logado", {
                conta: conta.email ?? conta.metodo,
              })}
            </p>
            {teste === "testando" && <p role="status">{t("conta.testando")}</p>}
            {teste === "ok" && <p role="status">{t("conta.testeOk")}</p>}
            {teste === "falhou" && (
              <div className="actions">
                <button type="button" onClick={() => void testar()}>
                  {t("conta.testarDeNovo")}
                </button>
              </div>
            )}
            <PlanoDaConta plano={conta.plano} />
          </>
        )}
        {saida.length > 0 && (
          <pre className="saida" aria-label={t("conta.saida")}>
            {saida.join("\n")}
          </pre>
        )}
        {erro && <ErrorMessage erro={erro} />}
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={!podeContinuar}
            onClick={onContinuar}
          >
            {t("conta.continuar")}
          </button>
        </div>
      </Screen>
    </>
  );
}

/** O plano confirmado serve à conta de agora (a pessoa pode ter trocado de conta). */
function planoServe(subscriptionType: string | null, plano: PlanoConfirmado) {
  return niveisDoPlano(subscriptionType).includes(plano.nivel);
}
