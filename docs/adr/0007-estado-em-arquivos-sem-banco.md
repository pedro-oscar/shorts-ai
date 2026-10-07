# Estado em arquivos, sem banco de dados

A fonte da verdade são os arquivos na Biblioteca: `<projeto>/projeto.json` (opções, exceções, estado de cada etapa, direito de uso), `<projeto>/edit/custos.json` e `.lotes/<lote>.json`. Os dados do app guardam só preferências, kits e um índice que se reconstrói lendo a Biblioteca. Assim um projeto é uma pasta autossuficiente, que a pessoa pode mover, copiar ou apagar pelo gerenciador de arquivos sem dessincronizar um banco. Um projeto cuja pasta sumiu aparece como "não encontrado", e o app oferece tirá-lo do histórico.

## Considered Options

- SQLite nos dados do app como fonte da verdade, com as pastas só para os arquivos de vídeo. Rejeitado: consultas mais fáceis, mas o banco e as pastas sairiam de sincronia sempre que a pessoa mexesse nas pastas.
