import type React from 'react';
import {Avestruz} from './Avestruz';
import {Blindado} from './Blindado';
import {Checklist} from './Checklist';
import {Comparacao} from './Comparacao';
import {Dinheiro} from './Dinheiro';
import {Etapas} from './Etapas';
import {FogoComFogo} from './FogoComFogo';
import {Geracoes} from './Geracoes';
import {Grafico} from './Grafico';
import {Lampada} from './Lampada';
import {Marionete} from './Marionete';
import {OracaoCorrigida} from './OracaoCorrigida';
import {PromptRiscado} from './PromptRiscado';
import {TokensZerando} from './TokensZerando';
import {Transmissao} from './Transmissao';
import {Venda} from './Venda';

/**
 * Registro de cenas usadas em motion.json ({"type": "scene", "name": "<chave>"}).
 * Cena nova = arquivo novo nesta pasta + uma linha em SCENES + um exemplo em EXEMPLOS.
 * Cada cena registrada vira a composição "cena-<Nome>" para pré-visualizar:
 *   ./ae cena <Nome> <segundos> [card|full]
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SCENES: Record<string, React.FC<any>> = {
  Grafico,
  Comparacao,
  Dinheiro,
  Etapas,
  Checklist,
  PromptRiscado,
  Lampada,
  Venda,
  Marionete,
  FogoComFogo,
  TokensZerando,
  Blindado,
  Transmissao,
  Geracoes,
  OracaoCorrigida,
  Avestruz,
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
};
