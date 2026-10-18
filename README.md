# Shorts AI

App desktop que transforma vídeos longos (podcast, live, entrevista, aula) em reels verticais
9:16, com legenda palavra por palavra, motions e cenas. O Claude escolhe os cortes e escreve o
roteiro pela sua própria conta do Claude Code; o vídeo e o áudio ficam no seu computador, onde
roda todo o processamento.

## Instalar

Baixe o instalador da [última Release](https://github.com/pedro-oscar/shorts-ai/releases/latest).
O app se atualiza sozinho pelas Releases.

- **Windows 10/11 (x64):** o `-setup.exe` instala só para a sua conta; o `.msi`, para o
  computador todo. O instalador não tem assinatura de código, então o SmartScreen avisa "Editor
  desconhecido": clique em "Mais informações" e depois em "Executar assim mesmo".
- **Linux (Ubuntu 22.04 ou mais novo, x64):** o `.deb` (`sudo apt install ./arquivo.deb`) ou o
  `.AppImage` (dê permissão de execução com `chmod +x` e abra).

Na primeira vez, o app baixa o que falta (Node portátil, o Remotion e o modelo de transcrição) e
pede o Claude Code: instala, faz o login e confere o plano.

## Privacidade

Não há telemetria. Vão para o Claude o texto da transcrição, o roteiro e imagens de alguns
quadros dos reels, pelo Claude Code da sua conta. Ao abrir, o app consulta as Releases deste
repositório para baixar versões novas e a tabela de preços, sem enviar nada sobre você ou sobre
os vídeos.

## Licença

[PolyForm Noncommercial 1.0.0](LICENSE): uso não comercial. Os componentes de terceiros que vão
junto, como o ffmpeg (GPL), estão em [`licencas/TERCEIROS.md`](licencas/TERCEIROS.md).

## Desenvolvimento

Rust (workspace com o núcleo em `crates/nucleo`, a casca Tauri em `src-tauri`), React em
`interface/` e o template Remotion em `assets/remotion`. Depois de clonar, `npm ci`; o portão de
pronto é `npm run check`. O que cada máquina precisa, o vocabulário e as decisões estão em
[`AGENTS.md`](AGENTS.md), [`GLOSSARY.md`](GLOSSARY.md) e [`docs/adr/`](docs/adr). Os tickets e o
material de referência dos testes ficam fora do repositório; a publicação de uma versão está em
[`docs/publicar-uma-release.md`](docs/publicar-uma-release.md).
