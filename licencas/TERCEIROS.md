# Componentes de terceiros

O Shorts AI é distribuído sob a PolyForm Noncommercial 1.0.0. Junto com ele vão os componentes
abaixo, cada um sob a própria licença; os textos completos estão nesta pasta. A página da Release
de cada versão (o link do Sobre) traz o código do app na tag dela e o código-fonte de cada
ffmpeg empacotado.

## ffmpeg e ffprobe: GNU GPL versão 3 (`GPL-3.0.txt`)

Rodam como processos separados, sem ligação com o código do app (ADR 0006).

- **Windows:** ffmpeg 9.0.2, build "essentials" de Gyan Doshi
  (<https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2>). Código-fonte: o
  `ffmpeg-9.0.2-fonte.tar.xz` anexo à Release, igual ao
  <https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz>.
- **Linux:** ffmpeg n9.0.2-17-g2a571b6068, build `linux64-gpl-9.0` do BtbN
  (<https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-30-13-08>). Código-fonte:
  o `ffmpeg-n9.0.2-17-g2a571b6068-fonte.tar.gz` anexo à Release, o commit `2a571b6068` do FFmpeg;
  as receitas e as versões das bibliotecas da build (x264, zimg e as outras) estão no
  repositório do BtbN.

## yt-dlp: The Unlicense

yt-dlp 2026.08.19, em domínio público (<https://github.com/yt-dlp/yt-dlp>).

## whisper.cpp: MIT (`MIT-whisper.cpp.txt`)

`whisper-cli` 1.9.5, em duas builds (Vulkan e só CPU) (<https://github.com/ggml-org/whisper.cpp>).
Copyright (c) 2023-2026 The ggml authors.

## YuNet: MIT (`MIT-YuNet.txt`)

O detector de rosto `face_detection_yunet_2026may.onnx`, do OpenCV Zoo
(<https://github.com/opencv/opencv_zoo>), embutido no app. Copyright (c) 2020 Shiqi Yu.

## Fontes: SIL Open Font License 1.1 (`OFL-1.1.txt`)

Pelo pacote Fontsource de cada uma:

- Montserrat: Copyright 2011 The Montserrat Project Authors (<https://github.com/JulietaUla/Montserrat>)
- Anton: Copyright 2020 The Anton Project Authors (<https://github.com/googlefonts/AntonFont.git>)
- Bebas Neue: Copyright 2019 The Bebas Neue Project Authors (<https://github.com/dharmatype/Bebas-Neue>)
- Archivo Black: Copyright 2017 The Archivo Black Project Authors (<https://github.com/Omnibus-Type/ArchivoBlack>)
- Bangers: Copyright 2010 The Bangers Project Authors (<https://github.com/googlefonts/bangers>)
- Oswald: Copyright 2016 The Oswald Project Authors (<https://github.com/googlefonts/OswaldFont>)
- Poppins: Copyright 2020 The Poppins Project Authors (<https://github.com/itfoundry/Poppins>)
- Inter: Copyright 2016 The Inter Project Authors (<https://github.com/rsms/inter>)
- Barlow e Barlow Condensed: Copyright 2017 The Barlow Project Authors (<https://github.com/jpt/barlow>)

## Remotion: Remotion License

O render dos reels usa o Remotion 4, baixado na primeira execução, e não vai no instalador. É
gratuito para pessoas físicas, organizações sem fins lucrativos e empresas de até 3
funcionários; empresas maiores precisam de uma licença própria (<https://remotion.dev/license>).
