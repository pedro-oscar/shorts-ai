import type { ProjetoResumo } from "../bindings";

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
