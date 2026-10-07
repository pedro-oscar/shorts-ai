# ffmpeg GPL como processo separado

As builds distribuídas levam um ffmpeg GPL, com libx264 para recodificar os cortes e zimg para converter vídeos HDR. Ele roda como processo separado (sidecar) e o app só fala com ele por linha de comando, então o código do app não fica sujeito à GPL. A obrigação é distribuir a licença e o link do código-fonte da build exata, citados em "Sobre". A spec previa uma build LGPL, mas sem libx264 os intermediários teriam de ir em outro codec, como ProRes, que ocupa muito disco.

## Considered Options

- ffmpeg LGPL com intermediários em ProRes.
- ffmpeg LGPL só para análise, com os cortes feitos dentro do Remotion numa única codificação. Ainda não testado; fica como ideia para depois.
