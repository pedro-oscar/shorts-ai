import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../context";
import { ErrorMessage, Screen, Topo } from "./common";

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
  const verificarConta = useAppStore((store) => store.verificarConta);
  const entrar = useAppStore((store) => store.entrarNoClaudeCode);
  const testar = useAppStore((store) => store.testarClaude);

  useEffect(() => {
    void verificarConta();
  }, [verificarConta]);

  const logado = conta?.tipo === "logado";
  const podeContinuar =
    logado && !entrando && (teste === "ok" || teste === "pendente");
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
        {conta?.tipo === "naoInstalado" && (
          <p role="status">{t("conta.naoInstalado")}</p>
        )}
        {conta?.tipo === "versaoAntiga" && (
          <p role="status">
            {t("conta.versaoAntiga", {
              versao: conta.versao,
              minima: conta.minima,
            })}
          </p>
        )}
        {conta?.tipo === "semLogin" && (
          <>
            <p role="status">{t("conta.semLogin")}</p>
            <p className="muted">{t("conta.loginSeparado")}</p>
            {entrando && <p role="status">{t("conta.entrando")}</p>}
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={entrando}
                onClick={() => void entrar()}
              >
                {t("conta.entrar")}
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
          </>
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
