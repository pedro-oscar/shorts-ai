import type {
  Cotacao,
  Excecoes,
  Faixa,
  IdiomaDoVideo,
  ProjetoResumo,
  ResumoDeCusto,
} from "../bindings";

/**
 * Um valor em dólar, com a vírgula ou o ponto do idioma; centavos até 10, depois inteiros.
 * Com a cotação digitada, o valor sai em reais.
 */
export function formatarDolar(
  valor: number,
  idioma: string,
  cotacao: Cotacao | null = null,
): string {
  const convertido = cotacao ? valor * (cotacao.valor ?? 1) : valor;
  const casas = convertido < 10 ? 2 : 0;
  return convertido.toLocaleString(idioma, {
    style: "currency",
    currency: cotacao ? "BRL" : "USD",
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

/** Há sessão do Claude para mostrar o custo. */
export function temCusto(custo: ResumoDeCusto): boolean {
  return custo.sessoes.length > 0 || (custo.custoUsd ?? 0) > 0;
}

/** `m:ss`, ou `h:mm:ss` a partir de uma hora; `—` quando a duração não é conhecida. */
export function formatarDuracao(segundos: number | null): string {
  if (segundos === null) return "—";
  const total = Math.round(segundos);
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const resto = String(total % 60).padStart(2, "0");
  return horas > 0
    ? `${String(horas)}:${String(minutos).padStart(2, "0")}:${resto}`
    : `${String(minutos)}:${resto}`;
}

/** A Produção do projeto terminou: há reels (ou prévias) para a Galeria. */
export function producaoConcluida(projeto: ProjetoResumo): boolean {
  return projeto.etapas.some(
    (item) => item.etapa === "producao" && item.estado === "concluida",
  );
}

/** O tamanho, dado em MB, como MB ou GB, com a vírgula ou o ponto do idioma. */
export function formatarTamanho(megabytes: number, idioma: string): string {
  const [valor, unidade] =
    megabytes >= 1000 ? [megabytes / 1000, "GB"] : [megabytes, "MB"];
  const digitos = valor >= 100 || unidade === "MB" ? 0 : 1;
  return `${valor.toLocaleString(idioma, { maximumFractionDigits: digitos })} ${unidade}`;
}

/** Segundos de `90`, `1:30` ou `1:02:03`; `null` para o que não é um tempo. */
function lerTempo(texto: string): number | null {
  const partes = texto.trim().split(":");
  if (partes.length > 3 || !partes.every((parte) => /^\d+$/.test(parte)))
    return null;
  return partes.reduce((total, parte) => total * 60 + Number(parte), 0);
}

/** A faixa dos campos Início e Fim: `null` com os dois vazios e `"invalida"` quando não valem. */
export function lerFaixa(
  inicio: string,
  fim: string,
): Faixa | null | "invalida" {
  const semInicio = inicio.trim() === "";
  const semFim = fim.trim() === "";
  if (semInicio && semFim) return null;
  const de = semInicio ? 0 : lerTempo(inicio);
  const ate = semFim ? null : lerTempo(fim);
  if (de === null || (!semFim && ate === null)) return "invalida";
  if (ate !== null && ate <= de) return "invalida";
  return { inicio: de, fim: ate };
}

/** O estado do projeto e a etapa N/5 em que ele está (a próxima a rodar, se parou). */
export function resumir(projeto: ProjetoResumo) {
  const concluidas = projeto.etapas.filter((e) => e.estado === "concluida");
  const iniciado = projeto.etapas.some((e) => e.estado !== "pendente");
  const falhou = projeto.etapas.some((e) => e.estado === "falhou");
  let estado:
    | "falhou"
    | "pronto"
    | "pausado"
    | "cancelado"
    | "aguardandoCota"
    | "emAndamento"
    | "naFila";
  if (falhou) estado = "falhou";
  else if (concluidas.length === projeto.etapas.length) estado = "pronto";
  else if (projeto.parada) estado = projeto.parada;
  else if (iniciado) estado = "emAndamento";
  else estado = "naFila";
  return {
    estado,
    concluidas: concluidas.length,
    etapa: Math.min(concluidas.length + 1, projeto.etapas.length),
  } as const;
}

/** O projeto ainda vai andar: não falhou e não está pronto. */
export function emAberto(projeto: ProjetoResumo): boolean {
  const { estado } = resumir(projeto);
  return estado !== "falhou" && estado !== "pronto";
}

/** Os campos das Exceções de um vídeo, como a pessoa os digita; vazio usa o padrão do lote. */
export interface CamposDasExcecoes {
  quantidade: string;
  pedido: string;
  /** Um nome por linha. */
  nomes: string;
  idioma: "" | IdiomaDoVideo;
}

export const SEM_CAMPOS: CamposDasExcecoes = {
  quantidade: "",
  pedido: "",
  nomes: "",
  idioma: "",
};

/** As Exceções que os campos definem; o que está vazio fica de fora. */
export function lerExcecoes(
  campos: CamposDasExcecoes,
  faixa: Faixa | null,
): Excecoes {
  const nomes = campos.nomes
    .split("\n")
    .map((nome) => nome.trim())
    .filter((nome) => nome !== "");
  const pedido = campos.pedido.trim();
  return {
    quantidadeDeReels:
      campos.quantidade === "" ? null : Number(campos.quantidade),
    pedido: pedido === "" ? null : pedido,
    faixa,
    nomesProprios: nomes.length === 0 ? null : nomes,
    idiomaDoVideo: campos.idioma === "" ? null : campos.idioma,
  };
}

/** Os campos que mostram as Exceções já definidas. */
export function camposDas(excecoes: Excecoes): CamposDasExcecoes {
  return {
    quantidade:
      excecoes.quantidadeDeReels == null
        ? ""
        : String(excecoes.quantidadeDeReels),
    pedido: excecoes.pedido ?? "",
    nomes: (excecoes.nomesProprios ?? []).join("\n"),
    idioma: excecoes.idiomaDoVideo ?? "",
  };
}

/** A faixa em torno do custo efetivo: o multiplicador do plano é uma estimativa. */
export const INCERTEZA_DO_MULTIPLICADOR = 0.3;
