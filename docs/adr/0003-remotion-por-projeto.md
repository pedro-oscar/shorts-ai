# Remotion por projeto, com `node_modules` compartilhado

Cada projeto tem a própria pasta `remotion/`, com `src/` e `public/` copiados do template ao criar o projeto. As dependências do Node (`node_modules`, 300–600 MB) ficam numa cópia única nos dados do app, ligada por symlink no Linux e no macOS e por junction no Windows, que não exige administrador. Uma cena criada pelo Claude só existe no projeto que a criou. Assim ela não invalida o cache de render dos outros projetos, e vários vídeos podem renderizar em paralelo sem trava no Remotion.

## Consequences

- Cenas não são reaproveitadas entre projetos.
- Confirmado no Linux (Node 22, Remotion 4.0.533, ticket 08): com o `node_modules` ligado por symlink, `tsc` e `remotion still` empacotam e renderizam o template. O webpack segue o caminho real e a pasta precisa se chamar literalmente `node_modules`. Confirmado também no Windows 11 (Node 24, ticket 19): com o `node_modules` ligado por junction, `tsc`, `remotion still` e as cenas do `shorts-cli` empacotam e renderizam o template.
- O cache do webpack (`node_modules/.cache/webpack`) e o Chrome do Remotion (`node_modules/.remotion`) caem na pasta compartilhada; com projetos empacotando em paralelo, o cache precisa ser desligado ou separado por projeto. O template desliga o cache (`Config.setCachingEnabled(false)`): com ele desligado, nada cai em `node_modules/.cache`. O Chrome do Remotion continua em `node_modules/.remotion`, único e só de leitura depois do primeiro download.
- O empacotamento (`bundle()`) roda uma vez por projeto, depois de o Claude mexer nas cenas, e cada reel é renderizado desse pacote com `renderMedia()`, em vez de um `npx remotion render` por reel, que empacota de novo a cada vez.
