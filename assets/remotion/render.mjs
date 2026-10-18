// Empacota o Remotion do projeto e renderiza um reel do pacote. Roda dentro de `remotion/`,
// chamado pelo núcleo (a Produção): `node render.mjs pacote <pasta>` e
// `node render.mjs render <pacote> <chave> <dados> <saída> <escala>`.
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [modo, ...args] = process.argv.slice(2);

if (modo === 'pacote') {
  const [pasta] = args;
  // O webpack recusa caminho com `!`, a sintaxe dos loaders, e a pasta do projeto leva o título
  // do vídeo: o pacote sai de uma cópia do código numa pasta temporária.
  const copia = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shorts-ai-'));
  const dependencias = path.join(copia, 'node_modules');
  try {
    for (const nome of ['src', 'public', 'package.json', 'remotion.config.ts', 'tsconfig.json']) {
      await fs.promises.cp(nome, path.join(copia, nome), {recursive: true});
    }
    // O `node_modules` compartilhado, por symlink; o tipo `junction` só vale no Windows.
    await fs.promises.symlink(await fs.promises.realpath('node_modules'), dependencias, 'junction');
    await bundle({
      entryPoint: path.join(copia, 'src/index.ts'),
      outDir: path.join(copia, 'pacote'),
      enableCaching: false,
    });
    await fs.promises.cp(path.join(copia, 'pacote'), path.resolve(pasta), {recursive: true});
  } finally {
    // O link sai antes, para o `rm` não descer no `node_modules` compartilhado.
    await fs.promises.unlink(dependencias).catch(() => {});
    await fs.promises.rm(copia, {recursive: true, force: true});
  }
} else if (modo === 'render') {
  const [pacote, chave, dados, saida, escala] = args;
  // Não o fs.cpSync: no Windows, o recursivo derruba o Node 22 (0xc0000409, sem mensagem)
  // quando o caminho tem acento, e a pasta do projeto leva o título do vídeo.
  await fs.promises.cp(dados, path.join(pacote, 'public', 'clips', chave), {recursive: true});
  const inputProps = {clipId: chave};
  const composition = await selectComposition({serveUrl: pacote, id: 'reel', inputProps});
  let ultimo = -1;
  await renderMedia({
    composition,
    serveUrl: pacote,
    codec: 'h264',
    crf: 18,
    pixelFormat: 'yuv420p',
    imageFormat: 'jpeg',
    jpegQuality: 92,
    concurrency: 4,
    scale: Number(escala),
    outputLocation: saida,
    overwrite: true,
    inputProps,
    onProgress: ({progress}) => {
      const feito = Math.floor(progress * 100);
      if (feito !== ultimo) {
        ultimo = feito;
        console.log(`progresso ${(feito / 100).toFixed(2)}`);
      }
    },
  });
} else {
  console.error('uso: node render.mjs pacote <pasta> | render <pacote> <chave> <dados> <saída> <escala>');
  process.exit(2);
}
