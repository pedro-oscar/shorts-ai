import type { Faixa, ProjetoResumo } from "../bindings";

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
  if (inicio.trim() === "" && fim.trim() === "") return null;
  const de = inicio.trim() === "" ? 0 : lerTempo(inicio);
  const ate = fim.trim() === "" ? null : lerTempo(fim);
  if (de === null || (fim.trim() !== "" && ate === null)) return "invalida";
  if (ate !== null && ate <= de) return "invalida";
  return { inicio: de, fim: ate };
}
