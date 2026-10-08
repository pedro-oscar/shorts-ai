// Os textos da interface. O inglês (en.ts) tem as mesmas chaves, conferidas pelo tipo.
export const ptBR = {
  app: {
    nome: "Shorts AI",
  },
  // O conteúdo do Aviso de uso. Mudou o que ele diz (não a forma)? Suba VERSAO_DO_AVISO
  // em crates/nucleo/src/lib.rs, para quem já aceitou ler o Aviso novo e aceitar de novo.
  aviso: {
    titulo: "Aviso de uso",
    introducao:
      "Antes de começar, leia como o Shorts AI funciona e o que você precisa respeitar.",
    itens: {
      pessoal:
        "O Shorts AI é para uso pessoal e não comercial, nos termos da licença PolyForm Noncommercial 1.0.0.",
      conta:
        "Ele usa a sua própria conta Claude, pelo Claude Code oficial em que você entra. O app nunca vê a sua senha, o seu token nem a sua chave.",
      cota: "As sessões do Claude usam a cota do seu plano, junto com o resto do seu uso; com uma conta do Console, são cobradas pelos preços da API da Anthropic.",
      direito: "Processe só vídeos que você tem direito de usar.",
      remotion:
        "Os reels são renderizados com o Remotion, gratuito para pessoas físicas, organizações sem fins lucrativos e empresas de até 3 funcionários. Empresas maiores precisam de uma licença própria do Remotion.",
    },
    privacidadeTitulo: "O que sai do seu computador",
    privacidade:
      "O vídeo e o áudio ficam no seu computador; vão para o Claude o texto da transcrição, o roteiro e imagens de alguns quadros dos reels, usadas na revisão.",
    concordo: "Li e concordo",
    continuar: "Continuar",
    sair: "Sair",
  },
  sobre: {
    abrir: "Sobre",
    titulo: "Sobre o Shorts AI",
    versao: "Versão {{versao}}",
    aceitoEm: "Você aceitou o Aviso de uso em {{data}}.",
    naoAceito: "Você ainda não aceitou o Aviso de uso.",
    licencaTitulo: "Licença",
    licenca:
      "O Shorts AI é distribuído sob a licença PolyForm Noncommercial 1.0.0.",
    terceirosTitulo: "Licenças de terceiros",
    remotion:
      "Remotion: licença própria, gratuita para pessoas físicas, organizações sem fins lucrativos e empresas de até 3 funcionários.",
    montserrat: "Fonte Montserrat: SIL Open Font License 1.1.",
    voltar: "Voltar",
  },
  conta: {
    titulo: "Conta",
  },
  preferencias: {
    corrompidas:
      "O arquivo de preferências estava corrompido e foi guardado em {{backup}}. As preferências voltaram ao padrão, por isso o Aviso de uso aparece de novo.",
  },
  erros: {
    preferenciasIlegiveis:
      "Não foi possível ler as preferências em {{caminho}}. Corrija ou apague o arquivo e abra o app de novo.",
    preferenciasNaoGravadas:
      "Não foi possível gravar as preferências em {{caminho}}. Confira se há espaço e permissão nessa pasta e tente de novo.",
    detalhe: "Detalhe técnico (do sistema): {{detalhe}}",
  },
};
