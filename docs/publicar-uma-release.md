# Publicar uma release

O build dos instaladores roda no GitHub Actions (`.github/workflows/release.yml`, ADR 0010); quem
publica é o autor. Os passos com `gh` pedem o GitHub CLI logado na conta `pedro-oscar`.

## Uma vez só

1. **A chave do atualizador.** No seu terminal, com uma senha:

   ```
   npm run tauri signer generate -- -w ~/.tauri/shorts-ai.key
   ```

   Guarde a chave (`~/.tauri/shorts-ai.key`) e a senha no gerenciador de senhas e numa cópia
   offline. Sem as duas, quem já instalou o app nunca mais recebe atualização. A chave pública
   (`shorts-ai.key.pub`) já está em `plugins.updater.pubkey`, no `src-tauri/tauri.conf.json`.

2. **O e-mail dos commits.** Em GitHub → Settings → Emails, ligue "Keep my email addresses
   private" e "Block command line pushes that expose my email". Este clone já commita com o
   `335721071+pedro-oscar@users.noreply.github.com`.

3. **O repositório.** Ele é público: as Releases de um repositório privado não baixam sem login.

   ```
   gh repo create pedro-oscar/shorts-ai --public --source . --push \
     --description "Cortes verticais de vídeos longos, prontos para Reels, Shorts e TikTok"
   ```

   A `.scratch/` (tickets e spec) e o `~/shorts-ai-referencia` não vão: são locais. Em Settings →
   General → Releases, deixe desligadas as "immutable releases"; ligadas, o workflow da tabela
   de preços não consegue trocar o arquivo de uma Release publicada.

4. **Os secrets do Actions.**

   ```
   gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/shorts-ai.key
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
   ```

5. **O ensaio.** Monta os quatro instaladores sem a chave e sem Release:

   ```
   gh workflow run release.yml --ref main
   gh run watch
   gh run download "$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --dir ensaio
   ```

   Confira o AppImage: `./Shorts*.AppImage --appimage-extract`, rode cada sidecar de
   `squashfs-root/usr/bin/` com `--version` (o `whisper-cli` com `--help`) e veja com `ldd` que o
   `libvulkan.so.1` do `whisper-cli` vem do sistema.

6. **O clone do host Windows.** O de antes da reescrita do histórico não serve mais: clone de
   novo do GitHub, e copie para lá o `~/shorts-ai-referencia` se for rodar os testes.

7. **Cópia de segurança** da `.scratch/` (um repositório git local) e do
   `~/shorts-ai-referencia`, que não estão em remoto nenhum.

## A cada versão

1. Suba a versão em `[workspace.package]` do `Cargo.toml` (o app, o instalador e a tag usam
   essa) e rode `cargo check` para o `Cargo.lock` acompanhar. Commit, e `npm run check` verde.
2. Crie a tag e envie:

   ```
   git tag v0.1.0
   git push origin main v0.1.0
   gh run watch
   ```

   O job `rascunho` recusa uma tag que não seja a versão do `Cargo.toml`.

3. Confira o rascunho em <https://github.com/pedro-oscar/shorts-ai/releases>: o `-setup.exe`, o
   `.msi`, o `.AppImage`, o `.deb`, os `.sig`, o `latest.json`, o `precos.json` e os dois
   `-fonte`. O job `conferir` já exige isso; se ele falhou porque o `latest.json` perdeu um dos
   sistemas, rode de novo o job do `build` desse sistema e depois o `conferir`.
4. Instale o `-setup.exe` no Windows e o `.deb` ou o AppImage no Linux. No Sobre, a versão é a
   nova e o link do código-fonte abre a página desta Release.
5. Publique o rascunho (Edit → Publish release). Só agora o atualizador vê a versão:

   ```
   curl -sL https://github.com/pedro-oscar/shorts-ai/releases/latest/download/latest.json
   curl -sL https://github.com/pedro-oscar/shorts-ai/releases/latest/download/precos.json
   ```

Na primeira release, teste o atualizador antes de chamar quem vai testar: publique também uma
0.1.1. A 0.1.0 instalada tem de mostrar "Versão 0.1.1 pronta" no topo e se atualizar no
"Reiniciar e atualizar", no Windows e no Linux.

## Trocar a tabela de preços sem versão nova

1. Mude `crates/nucleo/assets/precos.json` **e a data dele**: o app só usa a tabela baixada se
   ela for mais nova que a embutida. Commit e push no `main`.
2. `gh workflow run precos.yml && gh run watch`: o `precos.json` da última Release publicada é
   trocado, e o app o baixa na próxima vez que abrir. A próxima versão já leva a tabela embutida.

## Se a chave se perder

Não há como assinar uma atualização que os apps instalados aceitem. Gere uma chave nova, troque
a `pubkey` no `tauri.conf.json` e os secrets, e publique uma versão: quem já tem o app instalado
precisa baixar o instalador dela à mão, uma vez.
