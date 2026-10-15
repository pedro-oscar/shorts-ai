# Interface como Linha de produção

A interface deixa de ser um assistente de cinco passos (Conta, Vídeos, Padrões, Gerando, Reels) e vira uma Linha de produção: a tela principal é o lote atual num quadro com uma coluna por etapa (Fila, Importação, Transcrição, Roteiro, Produção, Revisão e Pronto), em que cada projeto é um cartão que anda pelas colunas. Os vídeos e os Padrões de um lote entram por uma folha que abre sobre o quadro; os reels se assistem numa Sala de revisão, com a tira de reels à esquerda, o escolhido no centro e o roteiro ao lado. A Conta só abre sozinha quando falta algo nela; o Kit de marca sai dos Padrões para uma tela própria, nas Configurações. O visual é um tema escuro de estúdio, com Barlow e Barlow Condensed empacotadas (o CSP só aceita fontes do próprio app) e um único acento âmbar.

O assistente escondia em que passo a pessoa estava, pedia a Conta a cada abertura, punha o Kit de marca inteiro dentro dos Padrões, mostrava até oito botões por projeto no Gerando e deixava os reels numa tela longe da fila, numa coluna de 44rem no meio da janela. A revisão de UI/UX comparou três propostas (Mesa de edição, Linha de produção e Assistente em 4 passos); a pessoa dona do produto escolheu a Linha de produção.

## Considered Options

- Mesa de edição: barra lateral com os lotes, Vídeos e Padrões numa tela, Gerando como tabela com a trilha de etapas e Reels como galeria com painel de detalhe. Mais próxima do que havia, mas a tabela não mostra a fila como fila.
- Assistente em 4 passos: o fluxo atual com um stepper no topo, uma decisão por tela e um botão primário. Menor esforço, mas mantém a troca de tela a cada passo e a fila longe dos reels.
- Linha de produção (escolhida): o quadro mostra de relance onde cada projeto está e quem usa cada vaga; a folha de Vídeos e a Sala de revisão ficam a um clique do quadro.

## Consequences

- As telas Gerando e Reels viram Linha de produção e Sala de revisão; o glossário ganha Linha de produção, Cartão, Folha de Vídeos, Ajustes, Sala de revisão e Tela no lugar de Passo.
- Um cartão muda de coluna quando a etapa muda: o elemento é remontado, e o estado local dele (menu aberto, Detalhes) recomeça. Os testes reencontram o cartão pelo nome depois de cada etapa.
- Arrastar na Fila vira passos de Subir e Descer para o núcleo, um por vez; o núcleo não ganhou comando novo.
- O tema é só escuro: o app não segue mais o esquema de cores do sistema.
- A Conta pronta ao abrir não aparece; com `contaConferida` no estado, ela abre sozinha só quando falta instalar, entrar, responder ao teste ou confirmar o plano.
