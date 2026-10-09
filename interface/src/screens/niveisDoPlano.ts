import type { NivelDoPlano } from "../bindings";

const TODOS: NivelDoPlano[] = [
  "pro",
  "max5x",
  "max20x",
  "teamPadrao",
  "teamPremium",
  "enterprise",
];

/** Os níveis que o `subscriptionType` do Claude Code deixa em aberto; `null` é o Console. */
export function niveisDoPlano(plano: string | null): NivelDoPlano[] {
  switch (plano) {
    case null:
      return ["console"];
    case "pro":
      return ["pro"];
    case "max":
      return ["max5x", "max20x"];
    case "team":
      return ["teamPadrao", "teamPremium"];
    case "enterprise":
      return ["enterprise"];
    default:
      return TODOS;
  }
}
