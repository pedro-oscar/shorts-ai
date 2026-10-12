import { use, useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Erro } from "../bindings";
import {
  AbrirConfiguracoesContext,
  AbrirLotesContext,
  useAppStore,
} from "../context";

/**
 * Uma tela com o título dela. O título recebe o foco ao abrir, para quem usa teclado ou
 * leitor de tela saber que a tela mudou.
 */
export function Screen({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <main className="screen">
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {children}
    </main>
  );
}

export function Topo({ onOpenSobre }: { onOpenSobre: () => void }) {
  const { t } = useTranslation();
  const abrirLotes = use(AbrirLotesContext);
  const abrirConfiguracoes = use(AbrirConfiguracoesContext);
  return (
    <header className="top-bar">
      <span className="brand">{t("app.nome")}</span>
      <div className="top-actions">
        <ContaChip />
        {abrirLotes && (
          <button type="button" onClick={abrirLotes}>
            {t("lotes.historico")}
          </button>
        )}
        {abrirConfiguracoes && (
          <button type="button" onClick={abrirConfiguracoes}>
            {t("configuracoes.abrir")}
          </button>
        )}
        <button type="button" onClick={onOpenSobre}>
          {t("sobre.abrir")}
        </button>
      </div>
    </header>
  );
}

/** A conta detectada e o plano dela, no topo, quando o Claude Code está logado. */
function ContaChip() {
  const { t } = useTranslation();
  const conta = useAppStore((store) => store.conta);
  if (conta?.tipo !== "logado") return null;
  const plano = conta.plano
    ? conta.plano.charAt(0).toUpperCase() + conta.plano.slice(1)
    : t("conta.chip.console");
  return (
    <span className="chip">
      {[conta.email, plano].filter(Boolean).join(" · ")}
    </span>
  );
}

/** Os itens do Aviso de uso e o que sai do computador, no Aviso e no Sobre. */
export function TextoDoAviso({ headingLevel }: { headingLevel: 2 | 3 }) {
  const { t } = useTranslation();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <>
      <p>{t("aviso.introducao")}</p>
      <ul className="notice-items">
        <li>{t("aviso.itens.pessoal")}</li>
        <li>{t("aviso.itens.conta")}</li>
        <li>{t("aviso.itens.cota")}</li>
        <li>{t("aviso.itens.direito")}</li>
        <li>{t("aviso.itens.remotion")}</li>
      </ul>
      <Heading>{t("aviso.privacidadeTitulo")}</Heading>
      <p>{t("aviso.privacidade")}</p>
    </>
  );
}

export function ErrorMessage({ erro }: { erro: Erro }) {
  const { t } = useTranslation();
  const caminho = "caminho" in erro ? erro.caminho : undefined;
  const id = "id" in erro ? erro.id : undefined;
  const url = "url" in erro ? erro.url : undefined;
  return (
    <div role="alert" className="error">
      <p>{t(`erros.${erro.codigo}`, { caminho, id, url })}</p>
      {"detalhe" in erro && (
        <p className="detail">
          {t("erros.detalhe", { detalhe: erro.detalhe })}
        </p>
      )}
    </div>
  );
}
