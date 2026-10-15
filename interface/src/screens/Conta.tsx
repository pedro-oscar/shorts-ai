import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../context";
import { ErrorMessage, Screen, Topo } from "./common";
import { contaPronta } from "./contaPronta";
import { PlanoDaConta } from "./PlanoDaConta";

/**
 * A Conta: só deixa continuar com o Claude Code instalado, atualizado e logado. Abre sozinha
 * quando falta algo; depois, pela conta no topo ou pelas Configurações.
 */
export function Conta({
  onOpenSobre,
  onContinuar,
  onVoltar,
}: {
  onOpenSobre: () => void;
  /** Segue para a Linha de produção; só quando a Conta abriu sozinha. */
  onContinuar?: () => void;
  /** Volta para onde a pessoa estava; só quando ela abriu a Conta. */
  onVoltar?: () => void;
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
  const chaveDeApi = useAppStore((store) => store.chaveDeApiNoAmbiente);
  const instalar = useAppStore((store) => store.instalarClaudeCode);
  const atualizar = useAppStore((store) => store.atualizarClaudeCode);
  const verificarConta = useAppStore((store) => store.verificarConta);
  const entrar = useAppStore((store) => store.entrarNoClaudeCode);
  const testar = useAppStore((store) => store.testarClaude);
  const podeContinuar = useAppStore(contaPronta);

  useEffect(() => {
    void verificarConta();
  }, [verificarConta]);

  return (
    <>
      <Topo onOpenSobre={onOpenSobre} />
      <Screen title={t("conta.titulo")}>
        <p className="muted">{t("conta.introducao")}</p>
        <section className="cartao" aria-labelledby="conta-claude">
          <h2 id="conta-claude">{t("conta.claudeCode")}</h2>
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
            <>
              <p role="status">
                {t("conta.versaoAntiga", {
                  versao: conta.versao,
                  minima: conta.minima,
                })}
              </p>
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
              <label className="marcador">
                <input
                  type="checkbox"
                  checked={porTerminal}
                  disabled={entrando}
                  onChange={(event) => {
                    setPorTerminal(event.target.checked);
                  }}
                />
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
                <span className="ponto" aria-hidden="true" />{" "}
                {t("conta.logado", {
                  conta: conta.email ?? conta.metodo,
                })}
              </p>
              {teste === "testando" && (
                <p role="status">{t("conta.testando")}</p>
              )}
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
          {saida.length > 0 && (
            <pre className="saida" aria-label={t("conta.saida")}>
              {saida.join("\n")}
            </pre>
          )}
          {erro && <ErrorMessage erro={erro} />}
        </section>
        {conta?.tipo === "logado" && (
          <div className="cartao">
            <PlanoDaConta plano={conta.plano} />
          </div>
        )}
        <div className="actions fim">
          {onVoltar && (
            <button type="button" onClick={onVoltar}>
              {t("conta.voltar")}
            </button>
          )}
          {onContinuar && (
            <button
              type="button"
              className="primary"
              disabled={!podeContinuar}
              onClick={onContinuar}
            >
              {t("conta.continuar")}
            </button>
          )}
        </div>
      </Screen>
    </>
  );
}
