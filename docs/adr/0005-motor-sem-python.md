# Motor sem Python

O motor roda sem Python:

- o núcleo Rust faz a orquestração e toda a lógica (encaixe dos trechos nas palavras, legendas, motions, validação, cache);
- o corte, a correção de cor e o áudio são comandos do ffmpeg chamados pelo núcleo, no lugar do video-use;
- o rosto é detectado com o YuNet (ONNX) dentro do Rust;
- a transcrição usa o whisper.cpp (ver "Transcrição" abaixo).

O render continua no Remotion (Node), porque as cenas que o Claude escreve são componentes React. Escolhemos isso porque o Python portátil com as bibliotecas CUDA era a parte mais pesada e frágil de distribuir: Windows nativo e 3–5 GB na primeira execução.

## Transcrição

Decidida depois do spike de 08/10/2026 (relatório na `.scratch` local do autor, `shorts-ai-mvp/spike-transcricao/`):

- **Motor:** whisper.cpp v1.9.5, com a versão fixada.
- **Integração:** executável separado, o whisper-cli oficial, levado como sidecar.
- **Modelo:** large-v3 q5_0, baixado do Hugging Face na primeira execução.
- **Tempo por palavra:** pelo DTW. O núcleo devolve os tempos dos tokens ao áudio original pela regra do whisper.cpp e depois aplica o pós-processamento de palavras do faster-whisper.
- **VAD:** o do próprio whisper.cpp, com os parâmetros do faster-whisper.
- **Backend:** Vulkan, com a CPU como reserva. Sem CUDA, porque o Vulkan não foi bem mais lento.

Pelos critérios da spec, o spike não passou de forma estável:

- **O que passou:** as bordas das palavras, as hesitações e o tempo batem com o faster-whisper ou sobram.
- **O que não passou:** os cortes do CLI, encaixados na transcrição nova, começam e terminam nas mesmas palavras em 5 dos 6 com este modelo (6 de 6 numa outra combinação). Só 22 a 24 dos 38 trechos ficam inteiros no lugar.
- **Onde estão as diferenças:** no início das palavras depois de uma pausa. Ali a referência também erra contra o áudio: os trechos do CLI começam, em mediana, meio segundo antes da fala.

Aceitamos o whisper.cpp assim.

## Considered Options

- As mesmas tecnologias do CLI (Python portátil, faster-whisper, OpenCV, video-use), só com a orquestração em Rust.
- Um motor novo do zero, com o CLI só como referência de comportamento.
- Para a transcrição:
  - **faster-whisper num processo Python separado:** a saída prevista se o spike falhasse;
  - **whisper.cpp num crate:** o `whisper-rs` está atrasado, e um crate próprio teria de compilar o whisper.cpp com Vulkan no `cargo build` de cada sistema;
  - **large-v3-turbo:** 3 vezes mais rápido, mas o DTW dele atrasa as palavras em 80 ms;
  - **modo de tokens no lugar do DTW:** bordas a 300 ms em mediana.

## Consequences

- **O contrato com o whisper.cpp:** o `-ojf` e a tabela do VAD que ele escreve no log. O log não é API: trocar de versão pede a suíte lenta com o motor real.
  - O `-ojf` grava o tempo dos tokens no áudio cortado pelo VAD.
  - O tempo do DTW não tem conversão nem na API.
- **No Windows, o whisper-cli lê os argumentos na página de código do sistema;** o prompt com acentos vai num arquivo de resposta, em UTF-8. Os caminhos ele confere na página de código, então os arquivos de trabalho vão por nome relativo à pasta em que ele roda (o projeto leva o título do vídeo). Os modelos só funcionam num caminho ASCII: a biblioteca os abre em UTF-8, e o cli os confere na página de código.
- **No WSL, o Vulkan só enxerga a CPU (llvmpipe),** e a reserva de CPU com o large-v3 é muitas vezes mais lenta que o tempo real. O teste de referência no Linux precisa de outro caminho para a GPU.
