# Remotion por projeto, com `node_modules` compartilhado

Cada projeto tem a própria pasta `remotion/`, com `src/` e `public/` copiados do template ao criar o projeto. As dependências do Node (`node_modules`, 300–600 MB) ficam numa cópia única nos dados do app, ligada por symlink no Linux e no macOS e por junction no Windows, que não exige administrador. Uma cena criada pelo Claude só existe no projeto que a criou. Assim ela não invalida o cache de render dos outros projetos, e vários vídeos podem renderizar em paralelo sem trava no Remotion.

## Consequences

- Cenas não são reaproveitadas entre projetos.
- Falta confirmar, no esqueleto, que o bundler do Remotion funciona com `node_modules` ligado por symlink e por junction. O webpack segue o caminho real (`resolve.symlinks`) e exclui `/node_modules/` do loader, então a pasta compartilhada precisa se chamar literalmente `node_modules`.
- O cache do webpack (`node_modules/.cache/webpack`) e o Chrome do Remotion (`node_modules/.remotion`) caem na pasta compartilhada; com projetos empacotando em paralelo, o cache precisa ser desligado ou separado por projeto.
- O empacotamento (`bundle()`) roda uma vez por projeto, depois de o Claude mexer nas cenas, e cada reel é renderizado desse pacote com `renderMedia()`, em vez de um `npx remotion render` por reel, que empacota de novo a cada vez.
