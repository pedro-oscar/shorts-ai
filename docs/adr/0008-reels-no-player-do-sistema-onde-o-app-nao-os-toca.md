# Reels no player do sistema onde o app não os toca

No Linux, o WebKitGTK não toca os reels dentro do app. O `<video>` com o protocolo de arquivos do Tauri (`asset://`) falha com erro 4: o GStreamer do WebKitGTK só carrega mídia de http(s) e de blob, embora um `fetch` no mesmo endereço responda 206 dentro do escopo da Biblioteca. O player tenta o protocolo de arquivos e, quando o sistema recusa, a Galeria oferece "Assistir no player do sistema", que entrega o reel publicado ao `xdg-open`. A spec previa todos os reels tocados no app pelo protocolo de arquivos. No Windows (WebView2) ele deve tocar direto, mas isso ainda não foi conferido.

Medido no WebKitGTK 2.50.4 com GStreamer 1.20 (Ubuntu 22.04 no WSL2), com um reel H.264 High que o ffmpeg decodifica sem erro.

## Considered Options

- Blob: o arquivo lido pelo protocolo de arquivos e tocado da memória. Toca com som, mas a imagem sai com blocos e borrões, com os bytes idênticos aos do arquivo.
- Servidor http em 127.0.0.1, com porta e token aleatórios, servindo só a Biblioteca. Toca limpo e com streaming, mas abre uma porta local enquanto o app roda e foge do protocolo de arquivos da spec.
