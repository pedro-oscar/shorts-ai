# Shorts AI

App desktop que transforma vídeos longos em reels verticais 9:16: o Claude escolhe os cortes e escreve o roteiro, e todo o processamento de vídeo roda no computador da pessoa.

## Linguagem

### Vídeo e cortes

**Vídeo original**:
O vídeo longo de entrada, vindo de um link do YouTube ou de um arquivo do computador, do qual os reels são tirados.
_Evitar_: fonte, vídeo de origem, bruto

**Idioma do vídeo**:
O idioma falado no vídeo original; define o idioma da transcrição e dos textos dos reels, independente do idioma da interface.
_Evitar_: idioma (sozinho), língua

**Faixa**:
A parte do vídeo original, entre um início e um fim, a que a pessoa limita a análise do Claude.
_Evitar_: trecho (neste sentido), intervalo, recorte

**Roteiro**:
O documento escrito pelo Claude que define os cortes de um vídeo original e como cada um deve ser produzido.
_Evitar_: script, plano

**Corte**:
Um item do roteiro: uma história curta do vídeo original escolhida pelo Claude, com nota, gancho, payoff e porquê.
_Evitar_: clipe, short

**Reserva**:
Um corte que o Claude listou no roteiro mas não mandou produzir; pode ser promovido depois.
_Evitar_: descartado, corte extra

**Trecho**:
Um intervalo do vídeo original que entra na montagem de um corte; um corte tem um ou mais trechos.
_Evitar_: segmento, take, pedaço

**Reel**:
O vídeo vertical 9:16 renderizado de um corte.
_Evitar_: clipe, short, vídeo final

**Prévia**:
Um reel renderizado em meia resolução, para conferir antes da versão final; refazê-lo não chama o Claude.
_Evitar_: rascunho, versão rápida

**Versão final**:
Um reel renderizado em resolução cheia (1080×1920), pronto para publicar.
_Evitar_: export, master

### Organização do trabalho

**Projeto**:
Um vídeo original com tudo o que se produz a partir dele: pasta, roteiro, cortes, reels e custos. Adicionar o mesmo vídeo de novo cria outro projeto.
_Evitar_: item, job

**Lote**:
Os projetos criados juntos com os mesmos padrões; um vídeo sozinho é um lote de um.
_Evitar_: batch, fila

**Padrões**:
As opções de um lote que valem para todos os seus projetos.
_Evitar_: ajustes do lote, configurações do lote

**Exceção**:
Uma opção que um projeto define para si, no lugar do padrão do lote.
_Evitar_: ajuste próprio, override

**Fila**:
A ordem única do app em que o trabalho dos projetos espera e pega vagas.
_Evitar_: lote, esteira

**Vaga**:
Uma permissão limitada de usar um recurso disputado: a GPU na transcrição, o render ou uma sessão do Claude.
_Evitar_: slot, semáforo

**Vídeos ao mesmo tempo**:
Quantos projetos da Fila andam juntos, cada um em uma etapa, disputando as vagas.
_Evitar_: paralelismo, simultâneos, workers

**Pausa**:
A parada de um projeto ao fim da etapa em andamento, que libera a vaga.
_Evitar_: cancelamento

**Cancelamento**:
A interrupção imediata de um projeto, que descarta a etapa em andamento; não é final, o projeto pode ser retomado.
_Evitar_: pausa, exclusão

**Retomada**:
A volta de um projeto pausado, cancelado ou que falhou ao fim da fila, recomeçando da última etapa concluída.
_Evitar_: reinício

**Remoção**:
Tirar do lote um projeto que ainda não começou.
_Evitar_: exclusão, cancelamento

**Exclusão**:
Apagar a pasta de um projeto e tudo o que foi produzido nele.
_Evitar_: remoção

### Etapas

**Etapa**:
Uma das fases automáticas por que passa cada vídeo original: Importação, Transcrição, Roteiro, Produção e Revisão.
_Evitar_: fase, stage

**Importação**:
A etapa que traz o vídeo original para o projeto, baixando o link ou copiando o arquivo.
_Evitar_: Fonte, download

**Revisão**:
A etapa automática em que o Claude confere as folhas de revisão de cada reel e corrige o roteiro.
_Evitar_: ajuste

**Folha de revisão**:
A imagem com quadros de um reel que o Claude analisa na Revisão.
_Evitar_: contact sheet, miniaturas

**Ajuste**:
Um pedido em texto da pessoa para mudar reels prontos, que o Claude aplica no roteiro antes de refazê-los.
_Evitar_: revisão, revisar, correção

### Interface

**Linha de produção**:
A tela principal do app: o lote atual num quadro com uma coluna por etapa (a Fila, as cinco etapas e Pronto), em que cada projeto é um cartão que anda pelas colunas.
_Evitar_: Gerando, kanban, quadro (sozinho), passo

**Cartão**:
Um projeto na Linha de produção, com o estado, o progresso, o que o Claude faz e a ação principal do momento; o resto fica no menu ⋯.
_Evitar_: linha, item

**Folha de Vídeos**:
O painel que abre sobre a Linha de produção para escolher os vídeos e os Padrões de um lote novo, ou acrescentar vídeos ao lote que roda.
_Evitar_: passo Vídeos, modal, wizard

**Ajustes**:
A janela de um vídeo da folha, ou de um projeto que espera a vez, com a Faixa e as Exceções dele.
_Evitar_: opções do vídeo, configurações do vídeo

**Sala de revisão**:
A tela em que os reels do lote se assistem e se escolhem: a tira de reels e reservas à esquerda, o reel escolhido no centro, o roteiro e a descrição ao lado.
_Evitar_: Reels (como tela), galeria

**Tela**:
Uma das telas do app: Aviso, Preparação, Conta, Linha de produção, Folha de Vídeos, Sala de revisão, Lotes, Configurações, Kits de marca e Sobre.
_Evitar_: passo, etapa (essa é do pipeline)

**Amostra**:
O quadro de exemplo que mostra como o kit vai ficar num reel antes de gerar.
_Evitar_: prévia, preview

**Legenda**:
O texto falado, palavra por palavra, gravado dentro do reel.
_Evitar_: descrição, caption (no sentido de texto do post)

**Descrição**:
O texto que o Claude escreve para cada corte, para a pessoa colar no post junto com o reel.
_Evitar_: legenda, caption

**Aviso de uso**:
As regras do app e o que sai do computador, que a pessoa aceita na primeira execução antes de usá-lo.
_Evitar_: termos de uso, disclaimer

**Aceite**:
O registro, com data e versão do Aviso, de que a pessoa aceitou o Aviso de uso; o aceite de uma versão anterior não vale.
_Evitar_: consentimento, concordância

**Idioma da interface**:
O idioma dos textos do app, pt-BR ou inglês; segue o do sistema e independe do idioma do vídeo.
_Evitar_: idioma (sozinho), locale

### Visual

**Kit de marca**:
O conjunto reutilizável de cores, fontes, logo e capa aplicado aos reels; ao criar um projeto, o kit escolhido é copiado para dentro dele.
_Evitar_: tema, estilo, preset

**Fonte**:
Uma família tipográfica usada na legenda ou nos títulos dos reels; nunca o vídeo de entrada.
_Evitar_: font, tipo de letra

### Claude e custo

**Sessão**:
Uma execução do Claude Code para um roteiro, uma revisão ou um ajuste.
_Evitar_: chamada, conversa

**Aprendizado**:
Uma regra que o Claude anota a partir do uso da pessoa e que vale para todos os projetos dela.
_Evitar_: memória, preferência

**Cota**:
O limite de uso do plano Claude da pessoa, que as sessões do app consomem junto com o resto do uso dela.
_Evitar_: crédito, limite de gasto

**Preço de API**:
Quanto as sessões custariam pela tabela de preços da API da Anthropic; é a cobrança real quando a pessoa usa a conta do Console.
_Evitar_: equivalente em API, custo de API

**Custo efetivo**:
A parte da mensalidade do plano que um vídeo usou: o preço de API dividido pelo multiplicador do plano.
_Evitar_: custo real, custo no plano

**Multiplicador**:
Quantas vezes o plano rende em preço de API o que custa por mês.
_Evitar_: fator, rendimento
