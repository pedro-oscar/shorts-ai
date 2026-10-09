import {Config} from '@remotion/cli/config';
import dns from 'node:dns';

// WSL sem rota IPv6: sem isto o download do Chrome headless falha com ENETUNREACH.
dns.setDefaultResultOrder('ipv4first');

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setCodec('h264');
Config.setCrf(18);
Config.setPixelFormat('yuv420p');
Config.setOverwriteOutput(true);
// Vídeos longos e muitos frames de SVG: limite a concorrência para não travar a máquina.
Config.setConcurrency(4);
// O node_modules é compartilhado entre os projetos: o cache do webpack cairia nele, e
// projetos empacotando em paralelo disputariam o mesmo cache (ADR 0003).
Config.setCachingEnabled(false);
