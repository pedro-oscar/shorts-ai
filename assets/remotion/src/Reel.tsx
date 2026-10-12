import React, {useEffect, useMemo, useState} from 'react';
import {AbsoluteFill, cancelRender, continueRender, delayRender, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {Captions} from './components/Captions';
import {FaceCropVideo} from './components/FaceCropVideo';
import {Grain} from './components/Grain';
import {planejarLayout} from './motions/layout';
import {MotionLayer} from './motions/MotionLayer';
import {carregarFonte} from './fonts';
import {resolveStyle} from './theme';
import type {ReelProps} from './types';

/**
 * Camadas, de baixo para cima:
 * 1. vídeo recortado no rosto (zoom/shake aplicados aqui)
 * 2. cenas em tela cheia (b-roll ilustrado)
 * 3. granulado
 * 4. legenda
 * 5. títulos, palavras-chave, contadores, cards e flashes, sempre fora da cabeça em foco
 * 6. saída suave: escurece no fim (o áudio baixa junto, no FaceCropVideo)
 */
export const Reel: React.FC<ReelProps> = ({clipId, data}) => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const style = resolveStyle(data?.plan.style);
  const motions = data?.plan.motions ?? [];
  // O layout mede o texto com a fonte real, então só começa depois de ela carregar neste navegador.
  const [fontesProntas, setFontesProntas] = useState(false);
  const [espera] = useState(() => delayRender('fontes do kit'));
  useEffect(() => {
    Promise.all([carregarFonte(style.fonteLegenda), carregarFonte(style.fonteTitulos)])
      .then(() => {
        setFontesProntas(true);
        continueRender(espera);
      })
      .catch((erro: unknown) => cancelRender(erro));
  }, [espera, style.fonteLegenda, style.fonteTitulos]);
  const placements = useMemo(
    () => (data && fontesProntas ? planejarLayout(motions, data.clip, data.face, style, fps, width, height) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, fontesProntas, fps, width, height],
  );
  if (!data || !fontesProntas) return null; // calculateMetadata sempre preenche os dados

  const fimF = Math.round(style.fadeOut * fps);
  const escurecer =
    fimF > 0
      ? interpolate(frame, [durationInFrames - fimF, durationInFrames - 1], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 0;

  return (
    <AbsoluteFill style={{backgroundColor: '#000', fontSynthesis: 'none'}}>
      <FaceCropVideo clipId={clipId} clip={data.clip} face={data.face} motions={motions} fadeOut={style.fadeOut} />
      <MotionLayer motions={motions} placements={placements} style={style} fullScenesOnly />
      {style.grain ? <Grain /> : null}
      <Captions captions={data.captions} style={style} emphasis={data.plan.emphasis ?? []} />
      <MotionLayer motions={motions} placements={placements} style={style} fullScenesOnly={false} />
      {escurecer > 0 ? <AbsoluteFill style={{backgroundColor: '#000', opacity: escurecer}} /> : null}
    </AbsoluteFill>
  );
};
