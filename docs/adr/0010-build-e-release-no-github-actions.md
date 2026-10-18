# Build e release no GitHub Actions do repositório público

Os instaladores saem do GitHub Actions do repositório público `pedro-oscar/shorts-ai`, que tem o código e as Releases: Windows (NSIS e MSI) num runner Windows e Linux (AppImage e .deb) num Ubuntu 22.04, o mais antigo que o app aceita. Uma tag `v*` monta a Release em rascunho, com os instaladores, o `latest.json` do atualizador, a tabela de preços e o código-fonte de cada ffmpeg; o autor confere os instaladores e publica, e só então o atualizador e a tabela de preços enxergam a versão. A spec previa build local no host Windows e listava CI como não-objetivo; com o build na nuvem, a release não depende da máquina de quem publica, e os dois sistemas saem iguais a cada vez.

O repositório é público porque as Releases de um repositório privado só baixam com login, e o atualizador e a tabela de preços não teriam de onde baixar. Antes do primeiro envio, o histórico foi reescrito: o e-mail dos commits virou o noreply do GitHub, e saíram a `.scratch/` (tickets, spec, spikes: o processo de desenvolvimento) e o material do vídeo de referência, que é de terceiros. A `.scratch/` ficou como um repositório git próprio, local e privado, que este ignora; a referência ficou em `~/shorts-ai-referencia`, de onde os testes do núcleo a leem.

## Considered Options

- Build local no host Windows, como na fatia 2: depende da máquina do autor e não monta o Linux.
- Código num repositório privado e Releases num público, com um token só para o público: o link do código-fonte não apontaria para código público, e o token vence.
- Um repositório público, com o código e as Releases (escolhida).

## Consequences

- A chave privada do atualizador fica com o autor (original e cópia de segurança) e, com a senha, nos secrets do Actions; sem ela, quem já instalou não recebe atualizações. O `createUpdaterArtifacts` fica no `tauri.release.conf.json`, que só o build da tag usa: o ensaio e o build local não pedem a chave.
- O Actions grava o `latest.json` uma vez por sistema; o job `conferir` falha se um apagou o do outro.
- Os tickets mudam de status por commit na `.scratch/`, separado do commit do código, e a fábrica AFK monta a `.scratch/` e a referência no sandbox.
- Um clone de antes da reescrita (como o do host Windows) tem de ser refeito.
- O app passa a consultar o GitHub ao abrir (a versão nova e a tabela de preços), sem enviar dado nenhum; o Aviso de uso diz isso.
