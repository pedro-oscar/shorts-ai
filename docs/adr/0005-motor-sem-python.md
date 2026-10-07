# Motor sem Python

O motor roda sem Python:

- o núcleo Rust faz a orquestração e toda a lógica (encaixe dos trechos nas palavras, legendas, motions, validação, cache);
- o corte, a correção de cor e o áudio são comandos do ffmpeg chamados pelo núcleo, no lugar do video-use;
- o rosto é detectado com o YuNet (ONNX) dentro do Rust;
- a transcrição usa um motor nativo (whisper.cpp), desde que o spike de transcrição mostre tempos por palavra tão bons quanto os do faster-whisper.

O render continua no Remotion (Node), porque as cenas que o Claude escreve são componentes React. Escolhemos isso porque o Python portátil com as bibliotecas CUDA era a parte mais pesada e frágil de distribuir: Windows nativo e 3–5 GB na primeira execução.

## Considered Options

- As mesmas tecnologias do CLI (Python portátil, faster-whisper, OpenCV, video-use), só com a orquestração em Rust.
- Um motor novo do zero, com o CLI só como referência de comportamento.

## Consequences

- Se o spike de transcrição falhar, o Python fica só na transcrição (faster-whisper como processo separado) e este ADR é revisto.
