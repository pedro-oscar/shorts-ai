import {Avestruz} from './Avestruz';
import {Bateria} from './Bateria';
import {Blindado} from './Blindado';
import {CaboDeGuerra} from './CaboDeGuerra';
import {Caminho} from './Caminho';
import {Checklist} from './Checklist';
import {Clones} from './Clones';
import {Comparacao} from './Comparacao';
import {Dinheiro} from './Dinheiro';
import {Escudo} from './Escudo';
import {Estomago} from './Estomago';
import {Etapas} from './Etapas';
import {FalaSemFim} from './FalaSemFim';
import {Fluxo} from './Fluxo';
import {FogoComFogo} from './FogoComFogo';
import {Geracoes} from './Geracoes';
import {Grafico} from './Grafico';
import {IdeiaApagando} from './IdeiaApagando';
import {Lampada} from './Lampada';
import {Marionete} from './Marionete';
import {Medidor} from './Medidor';
import {Niveis} from './Niveis';
import {OracaoCorrigida} from './OracaoCorrigida';
import {OracaoOuvida} from './OracaoOuvida';
import {PainelLateral} from './PainelLateral';
import {ParedeDeCodigo} from './ParedeDeCodigo';
import {PastaApagada} from './PastaApagada';
import {PromptRiscado} from './PromptRiscado';
import {ReuniaoCansada} from './ReuniaoCansada';
import {SimNao} from './SimNao';
import {TerraAbrindo} from './TerraAbrindo';
import {TokensZerando} from './TokensZerando';
import {Transmissao} from './Transmissao';
import {Venda} from './Venda';
import {Vinheta} from './Vinheta';
import {cena, type Cena} from './types';

/**
 * Registro de cenas usadas em motion.json ({"type": "scene", "name": "<chave>", "props": {...}}).
 * Cena nova = arquivo novo nesta pasta + uma linha em SCENES, com as props que ela aceita
 * (`Nome: cena(Nome, {prop: true, ...})`, ver `cena` em types.ts) + um exemplo em EXEMPLOS.
 * O `validar` lê este registro: aponta a cena que não está aqui e a prop que ela não aceita.
 * Cada cena registrada vira a composição "cena-<Nome>" para pré-visualizar:
 *   shorts-cli cena <Nome> <segundos> [card|full]
 */
export const SCENES: Record<string, Cena> = {
  Grafico: cena(Grafico, {title: true, bars: true, prefix: true, suffix: true}),
  Comparacao: cena(Comparacao, {title: true, left: true, right: true}),
  Dinheiro: cena(Dinheiro, {label: true, notas: true}),
  Etapas: cena(Etapas, {title: true, steps: true}),
  Checklist: cena(Checklist, {title: true, items: true}),
  PromptRiscado: cena(PromptRiscado, {titulo: true, linhas: true, label: true, labelAt: true}),
  Lampada: cena(Lampada, {balao: true, balaoAt: true, acenderAt: true, label: true, labelAt: true}),
  Venda: cena(Venda, {label: true, vendarAt: true, labelAt: true}),
  Marionete: cena(Marionete, {label: true, fiosAt: true, labelAt: true}),
  FogoComFogo: cena(FogoComFogo, {label: true, jogarAt: true, labelAt: true, balde: true}),
  TokensZerando: cena(TokensZerando, {titulo: true, inicio: true, drenarAt: true, zerarAt: true, label: true, labelAt: true}),
  Blindado: cena(Blindado, {label: true, carimbo: true, lupaAt: true, bloqueioAt: true, labelAt: true}),
  Transmissao: cena(Transmissao, {titulo: true, pessoas: true, comigoAt: true, destaque: true, comigo: true}),
  Geracoes: cena(Geracoes, {titulo: true, inicio: true, fim: true, marcos: true, voce: true, voceAt: true}),
  OracaoCorrigida: cena(OracaoCorrigida, {titulo: true, errado: true, certo: true, riscarAt: true, corrigirAt: true}),
  Avestruz: cena(Avestruz, {label: true, enterrarAt: true, sombraAt: true, labelAt: true}),
  SimNao: cena(SimNao, {title: true, itens: true, intervalo: true}),
  Fluxo: cena(Fluxo, {title: true, etapas: true, quebraEm: true}),
  Medidor: cena(Medidor, {title: true, niveis: true, ate: true, passo: true, alerta: true}),
  Niveis: cena(Niveis, {titulo: true, niveis: true}),
  Escudo: cena(Escudo, {label: true, icone: true, atacantes: true}),
  Caminho: cena(Caminho, {titulo: true, torto: true, reto: true, retoAt: true}),
  IdeiaApagando: cena(IdeiaApagando, {frases: true, frasesAt: true, intervalo: true, apagarAt: true, label: true, labelAt: true}),
  Vinheta: cena(Vinheta, {texto: true, rotulo: true, destaque: true, intervalo: true}),
  Bateria: cena(Bateria, {label: true, de: true, ate: true, emoji: true}),
  Clones: cena(Clones, {label: true, n: true, tipo: true}),
  ParedeDeCodigo: cena(ParedeDeCodigo, {label: true, linhas: true, resumo: true}),
  PastaApagada: cena(PastaApagada, {label: true, nome: true}),
  FalaSemFim: cena(FalaSemFim, {falas: true, relogio: true, label: true, labelAt: true}),
  ReuniaoCansada: cena(ReuniaoCansada, {pessoas: true, cansarAt: true, label: true, labelAt: true}),
  CaboDeGuerra: cena(CaboDeGuerra, {esquerda: true, direita: true, label: true, labelAt: true, vencedor: true, vencedorAt: true}),
  Estomago: cena(Estomago, {label: true, labelAt: true, caroco: true, dorAt: true}),
  OracaoOuvida: cena(OracaoOuvida, {label: true, labelAt: true, subirAt: true, aceitarAt: true}),
  PainelLateral: cena(PainelLateral, {title: true, dicas: true}),
  TerraAbrindo: cena(TerraAbrindo, {label: true, labelAt: true, abrirAt: true, cairAt: true}),
};

/** Props de exemplo (e duração em segundos) usadas só na pré-visualização "cena-<Nome>". */
export const EXEMPLOS: Record<string, {props: Record<string, unknown>; dur?: number}> = {
  Grafico: {
    props: {title: 'Caixa no mês', prefix: 'R$ ', suffix: ' mil', bars: [{label: 'Jan', value: 12}, {label: 'Fev', value: 18}, {label: 'Mar', value: 31}]},
  },
  Comparacao: {
    props: {title: 'Por que quebra?', left: {label: 'Falta de cliente', value: 'Raro', emoji: '🙋'}, right: {label: 'Falta de caixa', value: 'Quase sempre', emoji: '💸'}},
  },
  Dinheiro: {props: {label: 'Controle o caixa'}},
  Etapas: {
    props: {
      title: 'O que viraliza',
      steps: [
        {emoji: '🪝', label: 'Gancho', at: 0},
        {emoji: '📈', label: 'Desenvolvimento', at: 2.0},
        {emoji: '💥', label: 'Payoff', at: 3.2},
      ],
    },
  },
  Checklist: {
    props: {
      title: 'A skill faz',
      items: [
        {emoji: '🎯', label: 'Seleciona', at: 0.1},
        {emoji: '✂️', label: 'Corta', at: 1.5},
        {emoji: '💬', label: 'Legenda', at: 2.7},
        {emoji: '🚀', label: 'Publica', at: 4.7},
      ],
    },
    dur: 6,
  },
  PromptRiscado: {
    props: {
      titulo: 'Seu prompt',
      linhas: [
        {texto: 'Obedeça à risca', at: 2.9},
        {texto: 'Seja minucioso', at: 4.1},
        {texto: 'Revise várias vezes', at: 5.9},
      ],
      label: 'Apague!',
      labelAt: 6.2,
    },
    dur: 7.2,
  },
  Lampada: {props: {balao: 'Porque…', balaoAt: 0.1, acenderAt: 0.5, label: 'Usa a cabeça', labelAt: 2.7}, dur: 4.4},
  Venda: {props: {label: 'Venda escura', vendarAt: 0.5, labelAt: 1.6}, dur: 4.2},
  Marionete: {props: {label: 'Um comando', fiosAt: 0.5, labelAt: 6.0}, dur: 6.6},
  FogoComFogo: {props: {label: 'Só piora', balde: 'Feitiço', jogarAt: 1.9, labelAt: 3.0}, dur: 4.4},
  TokensZerando: {props: {titulo: 'Tokens', inicio: 200000, drenarAt: 0.2, zerarAt: 2.2, label: 'Zerou!', labelAt: 2.4}, dur: 4.0},
  Blindado: {props: {label: 'Blindado', carimbo: 'Acesso negado', lupaAt: 0.3, bloqueioAt: 1.4, labelAt: 2.2}, dur: 5.0},
  Transmissao: {
    props: {
      titulo: 'Do outro lado',
      pessoas: [
        {emoji: '😔', label: 'Depressão', at: 0},
        {emoji: '👩‍👧', label: 'Mãe aflita', at: 0.3},
        {emoji: '🤒', label: 'Doente', at: 0.6},
      ],
      comigoAt: 2.2,
      destaque: 0,
    },
    dur: 3,
  },
  Geracoes: {
    props: {
      titulo: 'Ele orou por todos',
      inicio: 'Ano 33',
      fim: 'Hoje',
      marcos: ['Séc. V', 'Séc. XII', 'Séc. XVIII'],
      voce: 'Você',
      voceAt: 4.4,
    },
    dur: 6,
  },
  OracaoCorrigida: {
    props: {titulo: 'Espírito Santo', errado: 'Meu pedido', certo: 'O que eu precisava', riscarAt: 0.2, corrigirAt: 4.2},
    dur: 6.2,
  },
  Avestruz: {props: {label: 'Cabeça na areia', enterrarAt: 0.3, sombraAt: 2.0, labelAt: 0.9}, dur: 4.6},
  SimNao: {
    props: {
      title: 'Onde funciona',
      itens: [
        {label: 'Terminal', ok: true, emoji: '💻'},
        {label: 'App do Claude', ok: true, emoji: '📱'},
        {label: 'VS Code', ok: false, emoji: '🧩'},
      ],
    },
    dur: 4,
  },
  Fluxo: {
    props: {
      title: 'Automação',
      etapas: [
        {emoji: '📩', label: 'Lead'},
        {emoji: '🔎', label: 'Pesquisa'},
        {emoji: '🗂️', label: 'CRM'},
        {emoji: '💬', label: 'WhatsApp'},
      ],
      quebraEm: 2,
    },
    dur: 4,
  },
  Medidor: {
    props: {title: 'Modos de permissão', niveis: ['Ask', 'Plan', 'Edits', 'Auto', 'Bypass'], alerta: 'Sem freio'},
    dur: 4,
  },
  Niveis: {
    props: {
      titulo: '',
      niveis: [
        {label: 'Conclusão', sub: 'sempre', emoji: '🎯', at: 0.2},
        {label: 'Sustentação', sub: 'se precisar', emoji: '🧱', at: 1.6},
        {label: 'Detalhes', sub: 'se pedirem', emoji: '🔍', at: 3.0},
      ],
    },
    dur: 4.5,
  },
  Escudo: {props: {label: 'Blindado'}, dur: 3.5},
  Caminho: {
    props: {titulo: '', torto: {rotulo: 'Júnior', texto: 'Todo o caminho'}, reto: {rotulo: 'Executivo', texto: 'Onde chegou'}, retoAt: 2.4},
    dur: 5,
  },
  IdeiaApagando: {
    props: {
      frases: ['Eu acho que talvez…', 'É só minha percepção', 'Posso estar errada'],
      frasesAt: 1.2,
      intervalo: 0.7,
      apagarAt: 3.6,
      label: 'Sem força',
      labelAt: 3.8,
    },
    dur: 5,
  },
  Vinheta: {props: {rotulo: 'Motivo 1', texto: 'Querem demonstrar conhecimento', destaque: ['conhecimento'], intervalo: 0.3}, dur: 3},
  Bateria: {props: {label: 'Seus tokens', de: 100, ate: 0, emoji: '🤖'}, dur: 3.5},
  Clones: {props: {label: 'Tudo igual', n: 9, tipo: 'site'}, dur: 3.5},
  ParedeDeCodigo: {props: {label: 'Zen Mode', linhas: 14, resumo: 'Criando o site…'}, dur: 4},
  PastaApagada: {props: {label: 'Apagou!', nome: 'meu-projeto'}, dur: 3.4},
  FalaSemFim: {
    props: {
      falas: [
        {texto: 'Continua…', at: 0.1},
        {texto: 'E também…', at: 1.2},
        {texto: 'Só complementando…', at: 2.2},
        {texto: 'Mais um ponto…', at: 3.4},
        {texto: 'Tem mais uma coisa…', at: 4.4},
      ],
      relogio: {de: 40, ate: 160},
      label: '',
      labelAt: 5.2,
    },
    dur: 6,
  },
  ReuniaoCansada: {props: {pessoas: 3, cansarAt: 1.2, label: 'Perdeu a atenção', labelAt: 3.6}, dur: 5},
  CaboDeGuerra: {props: {label: 'Quem ganha?', labelAt: 0.2, esquerda: '', direita: '', vencedor: 'O diabo', vencedorAt: 3.0}, dur: 4.2},
  Estomago: {props: {label: 'Mágoa', labelAt: 6.4, caroco: '', dorAt: 1.8}, dur: 8},
  OracaoOuvida: {props: {label: 'Ouvidas!', labelAt: 2.6, subirAt: 1.4, aceitarAt: 2.6}, dur: 6},
  PainelLateral: {
    props: {title: 'Aprenda enquanto cria', dicas: ['React: monta a tela', 'Tailwind: o estilo', 'Vite: roda o site']},
    dur: 4.5,
  },
  TerraAbrindo: {props: {label: 'Abriu a terra', labelAt: 0.3, abrirAt: 1.2, cairAt: 3.5}, dur: 8},
};
