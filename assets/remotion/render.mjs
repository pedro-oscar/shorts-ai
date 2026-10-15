// Empacota o Remotion do projeto e renderiza um reel do pacote. Roda dentro de `remotion/`,
// chamado pelo núcleo (a Produção): `node render.mjs pacote <pasta>` e
// `node render.mjs render <pacote> <chave> <dados> <saída> <escala>`.
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';

const [modo, ...args] = process.argv.slice(2);

if (modo === 'pacote') {
  const [pasta] = args;
  await bundle({
    entryPoint: path.resolve('src/index.ts'),
    outDir: path.resolve(pasta),
    enableCaching: false,
  });
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
