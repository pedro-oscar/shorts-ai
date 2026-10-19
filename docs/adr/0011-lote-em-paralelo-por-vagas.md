# Lote em paralelo por vagas

A fila roda vários projetos ao mesmo tempo, até o número de vídeos ao mesmo tempo (no automático, as vagas do Claude mais duas). Cada trabalho anda numa thread própria, e cada etapa pega a vaga do recurso que disputa antes de usá-lo: a GPU na Transcrição (uma), uma sessão do Claude no Roteiro e na Revisão (duas nos planos Max, Team Premium, Enterprise e Console; uma no Pro e no Team Padrão) e o render na Produção, na Revisão e na Versão final (uma). Um projeto nunca segura duas vagas, e quem entrou antes na fila pega a vaga que abre. Dentro da Produção, o corte e o rosto do reel seguinte rodam enquanto o atual renderiza.

Medido num lote real, o Claude levava 42% do tempo de cada projeto quase sem usar a máquina, e o render, 50% com a CPU cheia; a fila de um trabalhador só nunca os juntava. O Marco 5 da spec já previa as vagas maiores que um.

## Considered Options

- Pools por etapa ligados por canais (um grupo de trabalhadores para cada etapa, como o Tdarr faz por recurso): cada etapa fica sempre ocupada, mas a Pausa, o Cancelamento, a Retomada e a ordem da fila teriam de atravessar os canais. Rejeitado: a thread por projeto mantém o laço das etapas como era, e as vagas dão o mesmo limite por recurso.
- tokio com `Semaphore` por recurso: o núcleo é síncrono (os processos rodam por `std::process` com leitura em threads), e um runtime assíncrono só para esperar vagas traria `spawn_blocking` em toda chamada. Ficou `std::thread` com `Mutex` e `Condvar`.
- Dois renders do Remotion ao mesmo tempo: o próprio Remotion desaconselha; um render com mais abas do Chrome rende mais. O render fica com uma vaga, e o `concurrency` do Remotion sobe de 4 para a metade das threads da máquina (medido em 16 threads: 4 abas, 68 s; 8 abas, 55 s; 12 e 16, sem ganho). O Remotion por projeto (ADR 0003) continua deixando subir essa vaga, se uma máquina renderizar melhor com dois.
- Um semáforo de CPU com pesos (cada processo pega as threads que usa): os processos pesados que rodam juntos são poucos e conhecidos, e cada um recebe a sua parte fixa (o render metade das threads, o corte um quarto, o whisper quatro na GPU).

## Consequences

- Sem plano confirmado, a fila roda um vídeo de cada vez, como antes; com vídeos ao mesmo tempo igual a 1, também.
- A Pausa de quem espera uma vaga vale na hora, e a etapa continua Pendente. Na Revisão, esperar uma vaga só para com o Cancelar, porque pausar entre as rodadas jogaria fora uma rodada já paga.
- A cota que acaba numa sessão fecha a vaga do Claude até ela liberar, ainda com a vaga na mão: quem esperava vai para Aguardando cota sem abrir sessão, com um aviso só. "Retomar agora" reabre a vaga.
- As Exceções, a Remoção e a reordenação só valem para quem espera a vez, agora a partir do vídeo seguinte ao último que roda. Antes de criar o lote, os Ajustes da folha de Vídeos cobrem isso.
- Duas sessões do Claude dividem a mesma pasta de configuração (ADR 0002) e o mesmo `aprendizados.md`.
- Cada projeto grava em `edit/tempos.jsonl` quanto levou cada passo e quanto esperou por vaga: é ali que se mede o efeito desta decisão e se ajustam as vagas.
- A estimativa do lote conta o primeiro vídeo inteiro e, dos outros, só o recurso mais disputado.
