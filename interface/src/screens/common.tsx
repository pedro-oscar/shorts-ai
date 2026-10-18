import { use, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Erro } from "../bindings";
import { NavegacaoContext, useAppStore } from "../context";
import { resumir } from "./formatos";

/**
 * Uma tela com o título dela. O título recebe o foco ao abrir, para quem usa teclado ou
 * leitor de tela saber que a tela mudou.
 */
export function Screen({
  title,
  larga = false,
  children,
}: {
  title: string;
  /** A tela ocupa a janela toda, como as Configurações e os Kits de marca. */
  larga?: boolean;
  children?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <main className={larga ? "screen larga" : "screen"}>
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {children}
    </main>
  );
}

/** O ícone da engrenagem das Configurações. */
function Engrenagem() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </svg>
  );
}

/**
 * O topo de toda tela: a marca, os Lotes, a versão nova do app quando ela já baixou, a conta,
 * as Configurações e o Sobre.
 */
export function Topo({ onOpenSobre }: { onOpenSobre: () => void }) {
  const { t } = useTranslation();
  const navegar = use(NavegacaoContext);
  return (
    <header className="topo">
      <span className="marca">
        <span className="marca-logo" aria-hidden="true" />
        {t("app.nome")}
      </span>
      {navegar && (
        <button
          type="button"
          onClick={() => {
            navegar("lotes");
          }}
        >
          {t("lotes.historico")}
        </button>
      )}
      <span className="espaco" />
      <AtualizacaoPronta />
      <ContaChip />
      {navegar && (
        <button
          type="button"
          className="icone"
          aria-label={t("configuracoes.abrir")}
          title={t("configuracoes.abrir")}
          onClick={() => {
            navegar("configuracoes");
          }}
        >
          <Engrenagem />
        </button>
      )}
      <button type="button" className="discreto" onClick={onOpenSobre}>
        {t("sobre.abrir")}
      </button>
    </header>
  );
}

/**
 * A versão nova do app, já baixada: "Reiniciar e atualizar". Com projeto rodando ou na fila, a
 * pessoa confirma antes, porque o lote para e só volta (Pausado) quando ela o retomar.
 */
function AtualizacaoPronta() {
  const { t } = useTranslation();
  const versao = useAppStore((store) => store.atualizacao);
  const erro = useAppStore((store) => store.erroDaAtualizacao);
  const instalar = useAppStore((store) => store.instalarAtualizacao);
  const loteEmCurso = useAppStore(
    (store) =>
      store.projetos.some((projeto) => {
        const { estado } = resumir(projeto);
        return estado === "emAndamento" || estado === "naFila";
      }) ||
      Object.values(store.versoesFinais).some(
        (versaoFinal) =>
          versaoFinal.estado === "emAndamento" ||
          versaoFinal.estado === "pendente",
      ),
  );
  const [confirmando, setConfirmando] = useState(false);
  if (versao === null) return null;
  return (
    <>
      <span className="chip acento">{t("atualizacao.pronta", { versao })}</span>
      <button
        type="button"
        onClick={() => {
          if (loteEmCurso) setConfirmando(true);
          else void instalar();
        }}
      >
        {t("atualizacao.reiniciar")}
      </button>
      {erro && <ErrorMessage erro={erro} />}
      {confirmando && (
        <Dialogo
          alerta
          titulo={t("atualizacao.reiniciar")}
          onFechar={() => {
            setConfirmando(false);
          }}
        >
          <p>{t("atualizacao.confirmar")}</p>
          <div className="actions fim">
            <button
              type="button"
              onClick={() => {
                setConfirmando(false);
              }}
            >
              {t("atualizacao.agoraNao")}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                setConfirmando(false);
                void instalar();
              }}
            >
              {t("atualizacao.reiniciarAgora")}
            </button>
          </div>
        </Dialogo>
      )}
    </>
  );
}

/** A conta detectada e o plano dela, no topo, quando o Claude Code está logado; abre a Conta. */
function ContaChip() {
  const { t } = useTranslation();
  const conta = useAppStore((store) => store.conta);
  const navegar = use(NavegacaoContext);
  if (conta?.tipo !== "logado") return null;
  const plano = conta.plano
    ? conta.plano.charAt(0).toUpperCase() + conta.plano.slice(1)
    : t("conta.chip.console");
  const texto = [conta.email, plano].filter(Boolean).join(" · ");
  if (!navegar) return <span className="chip">{texto}</span>;
  return (
    <button
      type="button"
      className="conta-chip"
      title={t("conta.titulo")}
      onClick={() => {
        navegar("conta");
      }}
    >
      <span className="ponto" aria-hidden="true" />
      {texto}
    </button>
  );
}

/** Os itens do Aviso de uso e o que sai do computador, no Aviso e no Sobre. */
export function TextoDoAviso({ headingLevel }: { headingLevel: 2 | 3 }) {
  const { t } = useTranslation();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <>
      <p>{t("aviso.introducao")}</p>
      <ul className="notice-items marcada">
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

/** O × dos botões de fechar. */
export function IconeFechar() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M2 2l10 10M12 2L2 12" />
    </svg>
  );
}

/**
 * Uma janela sobre a tela, com o título dela em foco; Esc e o × a fecham. Fica no lugar da
 * árvore em que é usada, para quem a abriu continuar achando o que ela mostra.
 */
export function Dialogo({
  titulo,
  alerta = false,
  onFechar,
  children,
}: {
  titulo: string;
  /** Um pedido de confirmação, que interrompe o que a pessoa fazia. */
  alerta?: boolean;
  onFechar: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // Só ao abrir: quem a abriu redesenha a cada tecla, e o foco tem de ficar no campo.
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    const tecla = (event: KeyboardEvent) => {
      if (event.key === "Escape") onFechar();
    };
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("keydown", tecla);
    };
  }, [onFechar]);
  return (
    <div className="dialogo-fundo">
      <div
        role={alerta ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={id}
        className="dialogo"
      >
        <div className="dialogo-cabeca">
          <h2 id={id} ref={heading} tabIndex={-1}>
            {titulo}
          </h2>
          <button
            type="button"
            className="icone discreto"
            aria-label={t("comum.fechar")}
            onClick={onFechar}
          >
            <IconeFechar />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** O botão ⋯ e o menu que ele abre; fecha com Esc, clicando fora ou ao escolher um item. */
export function Menu({
  rotulo,
  children,
}: {
  /** O nome do menu, como "Mais ações de aula". */
  rotulo: string;
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (event: MouseEvent) => {
      if (!raiz.current?.contains(event.target as Node)) setAberto(false);
    };
    const tecla = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);
  return (
    <div
      className="menu"
      ref={raiz}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("[role=menuitem]"))
          setAberto(false);
      }}
    >
      <button
        type="button"
        className="icone discreto"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label={rotulo}
        title={rotulo}
        onClick={() => {
          setAberto(!aberto);
        }}
      >
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <circle cx="3" cy="8" r="1.6" />
          <circle cx="8" cy="8" r="1.6" />
          <circle cx="13" cy="8" r="1.6" />
        </svg>
      </button>
      {aberto && (
        <div role="menu" aria-label={rotulo} className="menu-lista">
          {children}
        </div>
      )}
    </div>
  );
}

export function ItemDoMenu({
  rotulo,
  disabled = false,
  perigo = false,
  onClick,
  children,
}: {
  /** O nome acessível do item, com o do projeto: "Pausar aula". */
  rotulo: string;
  disabled?: boolean;
  perigo?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-label={rotulo}
      disabled={disabled}
      className={perigo ? "perigo" : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Uma linha que separa grupos de itens do menu. */
export function SeparadorDoMenu() {
  return <div className="separador" role="separator" />;
}
