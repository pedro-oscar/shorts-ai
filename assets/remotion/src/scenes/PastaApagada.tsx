import React, {useId} from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * "A IA pode apagar uma pasta do seu computador": a pasta amarela (com `nome` na etiqueta) treme, a
 * lixeira abre a tampa como uma boca virada para ela, a pasta é arremessada em arco para dentro com
 * folhas soltas atrás, a tampa fecha com um baque (squash + poeira + ✗) e o `label` carimba no topo.
 * No lugar da pasta fica só o contorno tracejado.
 */

const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// Geometria na caixa 940×760
const CHAO = 676;
const FX = 250; // centro da pasta
const FY = CHAO - 115; // centro da pasta apoiada no chão (a base fica em +115)
const TX = 690; // centro da lixeira
const BORDA = 360; // topo do aro da lixeira (onde a tampa apoia)
const TAMPA_W = 316;
const PIVO_X = TX + TAMPA_W / 2; // dobradiça na ponta direita: a boca abre para o lado da pasta
const ALVO_Y = 530; // onde pasta e folhas somem, dentro da lixeira
const PLACA_W = 290;
const TEXTO_W = PLACA_W - 30;

// Linha do tempo (30 fps)
const TREME = 14;
const VOO = 30;
const POUSO = 48;
const FECHA = 52;
const ABERTURA = 35; // graus
const TAMPA_SPRING = {stiffness: 220, damping: 12};

const AMARELO = '#facc15';
const AMARELO_ESC = '#eab308';
const CINZA = '#94a3b8';
const CINZA_CLARO = '#cbd5e1';
const CINZA_ESC = '#64748b';

const RAIOS = [-168, -145, -122, -58, -35, -12];
const POEIRA = [
  [-1, 0],
  [-1, 1],
  [-1, 2],
  [1, 0],
  [1, 1],
  [1, 2],
] as const;

/** Fundo da pasta com a aba, centrado em (0,0): 340 de largura, base em y=+115. */
const PASTA_FUNDO =
  'M -170 97 L -170 -117 Q -170 -135 -152 -135 L -78 -135 Q -66 -135 -60 -125 L -51 -110 ' +
  'L 152 -110 Q 170 -110 170 -92 L 170 97 Q 170 115 152 115 L -152 115 Q -170 115 -170 97 Z';
const PASTA_FRENTE =
  'M -160 -62 L 160 -62 Q 176 -62 174 -46 L 170 97 Q 170 115 152 115 L -152 115 Q -170 115 -170 97 ' +
  'L -174 -46 Q -176 -62 -160 -62 Z';
const ALCA = 'M -196 -26 L -196 -46 Q -196 -58 -184 -58 L -132 -58 Q -120 -58 -120 -46 L -120 -26';

const Pasta: React.FC<{nome: string}> = ({nome}) => {
  const n = Math.max(1, nome.length);
  const tam = Math.floor(Math.max(24, Math.min(42, TEXTO_W / (n * 0.6))));
  const apertado = n * 0.6 * tam > TEXTO_W;
  return (
    <g>
      <path d={PASTA_FUNDO} fill={AMARELO_ESC} stroke="#000" strokeWidth={8} strokeLinejoin="round" />
      <rect x={-20} y={-142} width={170} height={150} rx={8} fill="#e2e8f0" stroke="#000" strokeWidth={6} transform="rotate(7 65 -67)" />
      <g transform="rotate(-4 40 -65)">
        <rect x={-60} y={-152} width={200} height={170} rx={8} fill="#fff" stroke="#000" strokeWidth={6} />
        {[-126, -104, -82].map((y, i) => (
          <line key={y} x1={-36} x2={i === 2 ? 50 : 112} y1={y} y2={y} stroke={CINZA_CLARO} strokeWidth={9} strokeLinecap="round" />
        ))}
      </g>
      <path d={PASTA_FRENTE} fill={AMARELO} stroke="#000" strokeWidth={8} strokeLinejoin="round" />
      <line x1={-148} x2={148} y1={-44} y2={-44} stroke="#fef08a" strokeWidth={8} strokeLinecap="round" />
      {nome ? (
        <>
          <rect x={-PLACA_W / 2} y={8} width={PLACA_W} height={68} rx={14} fill="#fff" stroke="#000" strokeWidth={6} />
          <text
            x={0}
            y={43}
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={FONT}
            fontWeight={800}
            fontSize={tam}
            fill="#111"
            textLength={apertado ? TEXTO_W : undefined}
            lengthAdjust={apertado ? 'spacingAndGlyphs' : undefined}
          >
            {nome}
          </text>
        </>
      ) : null}
    </g>
  );
};

const Folha: React.FC = () => (
  <g>
    <rect x={-55} y={-70} width={110} height={140} rx={8} fill="#fff" stroke="#000" strokeWidth={6} />
    {[-40, -18, 4, 26].map((y, i) => (
      <line key={y} x1={-34} x2={i === 3 ? 6 : 34} y1={y} y2={y} stroke={CINZA_CLARO} strokeWidth={8} strokeLinecap="round" />
    ))}
  </g>
);

/** Tampa com alça; gira em torno da dobradiça direita (ângulo positivo levanta a ponta esquerda). */
const Tampa: React.FC<{angulo: number}> = ({angulo}) => (
  <g transform={`translate(${PIVO_X} ${BORDA}) rotate(${angulo})`}>
    <path d={ALCA} fill="none" stroke="#000" strokeWidth={24} strokeLinejoin="round" />
    <path d={ALCA} fill="none" stroke={CINZA_CLARO} strokeWidth={9} strokeLinejoin="round" />
    <rect x={-TAMPA_W} y={-30} width={TAMPA_W} height={30} rx={13} fill={CINZA_CLARO} stroke="#000" strokeWidth={8} />
    <line x1={-TAMPA_W + 22} x2={-24} y1={-20} y2={-20} stroke="#fff" strokeWidth={6} strokeLinecap="round" opacity={0.6} />
  </g>
);

const Corpo: React.FC = () => (
  <g>
    <path
      d={
        `M ${TX - 132} ${BORDA + 22} L ${TX + 132} ${BORDA + 22} L ${TX + 108} ${CHAO - 14} ` +
        `Q ${TX + 106} ${CHAO} ${TX + 92} ${CHAO} L ${TX - 92} ${CHAO} Q ${TX - 106} ${CHAO} ${TX - 108} ${CHAO - 14} Z`
      }
      fill={CINZA}
      stroke="#000"
      strokeWidth={8}
      strokeLinejoin="round"
    />
    {[-2, -1, 0, 1, 2].map((k) => (
      <line
        key={k}
        x1={TX + k * 46}
        y1={BORDA + 62}
        x2={TX + k * 37}
        y2={CHAO - 30}
        stroke={CINZA_ESC}
        strokeWidth={13}
        strokeLinecap="round"
      />
    ))}
    <rect x={TX - 148} y={BORDA} width={296} height={30} rx={12} fill={CINZA_CLARO} stroke="#000" strokeWidth={8} />
  </g>
);

export const PastaApagada: React.FC<SceneProps & {label?: string; nome?: string}> = ({
  label = 'Apagou!',
  nome = 'meu-projeto',
  accent,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const uid = `pasta-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  // Entradas: pasta em f0, lixeira 5 frames depois (escala a partir da base).
  const entra = spring({frame, fps, config: {damping: 11, stiffness: 150}});
  const entraLix = spring({frame: frame - 5, fps, config: {damping: 11, stiffness: 150}});

  // Tampa: abre f14–22 (com overshoot), "morde" de leve enquanto espera e fecha com spring em f52.
  const abre = interpolate(frame, [TREME, TREME + 8], [0, 1], {...CLAMP, easing: Easing.out(Easing.back(2))});
  const morde =
    Math.sin(frame * 0.7) * 3 * interpolate(frame, [TREME + 8, TREME + 12, POUSO - 4, POUSO + 2], [0, 1, 1, 0], CLAMP);
  const fecha = spring({frame: frame - FECHA, fps, config: TAMPA_SPRING});
  const angulo = frame < FECHA ? ABERTURA * abre + morde : ABERTURA * Math.abs(1 - fecha);

  // Frame do baque = primeiro frame em que a tampa encosta no aro.
  let impacto = FECHA + 5;
  for (let f = FECHA; f <= FECHA + 20; f++) {
    if (spring({frame: f - FECHA, fps, config: TAMPA_SPRING}) >= 1) {
      impacto = f;
      break;
    }
  }

  // Baque: squash 1,08 → 1 e balanço que morre aos poucos.
  const baque = interpolate(frame, [impacto - 1, impacto, impacto + 3, impacto + 6, impacto + 10], [0, 1, -0.3, 0.1, 0], {
    ...CLAMP,
    easing: Easing.inOut(Easing.quad),
  });
  const resto = interpolate(frame, [impacto, impacto + 36], [1, 0], {...CLAMP, easing: Easing.out(Easing.quad)});
  const balanco = frame >= impacto ? Math.sin((frame - impacto) * 0.5) * 2.2 * resto : 0;
  const lixT =
    `translate(${TX} ${CHAO}) rotate(${balanco}) ` +
    `scale(${entraLix * (1 + 0.08 * baque)} ${entraLix * (1 - 0.07 * baque)}) translate(${-TX} ${-CHAO})`;

  // Pasta: treme f14–30 (amplitude decrescente), agacha antes do arremesso e voa em arco f30–48.
  const treme = interpolate(frame, [TREME, TREME + 3, VOO], [0, 1, 0], {...CLAMP, easing: Easing.out(Easing.quad)});
  const tremX = treme * Math.sin(frame * 2.3) * 12;
  const tremR = treme * Math.sin(frame * 1.9 + 1) * 6;
  const prepara = interpolate(frame, [VOO - 7, VOO - 1, VOO + 2], [0, 1, 0], {...CLAMP, easing: Easing.inOut(Easing.quad)});
  const u = interpolate(frame, [VOO, POUSO], [0, 1], {...CLAMP, easing: Easing.in(Easing.quad)});
  const encolhe = interpolate(u, [0, 1], [1, 0.3]);
  const base = entra * (1 - 0.1 * prepara);
  const pastaX = interpolate(u, [0, 1], [FX, TX]) + tremX;
  const pastaY = interpolate(u, [0, 1], [FY, ALVO_Y]) - 310 * 4 * u * (1 - u) + 115 * (1 - base);
  const pastaRot = interpolate(entra, [0, 1], [-14, 0]) + tremR + interpolate(u, [0, 1], [0, 330]);
  const pastaSx = entra * encolhe * (1 + 0.06 * prepara);
  const pastaSy = base * encolhe;
  const sombraPasta = interpolate(u, [0, 0.5], [1, 0], {...CLAMP, easing: Easing.out(Easing.quad)});
  const fantasma = interpolate(frame, [POUSO - 6, POUSO + 8], [0, 0.4], {...CLAMP, easing: Easing.out(Easing.quad)});

  // Efeitos do baque
  const imp = interpolate(frame, [impacto, impacto + 12], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
  const po = interpolate(frame, [impacto, impacto + 16], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
  const xIn = spring({frame: frame - impacto - 1, fps, config: {damping: 9, stiffness: 180}});

  // Rótulo: carimba no baque e depois balança de leve.
  const labelIn = spring({frame: frame - impacto, fps, config: {damping: 9, stiffness: 170}});
  const assenta = interpolate(frame, [impacto + 10, impacto + 22], [0, 1], {...CLAMP, easing: Easing.inOut(Easing.quad)});
  const labelRot = -4 + Math.sin((frame - impacto) / 9) * 1.5 * assenta;
  const tamLabel = Math.round(Math.max(44, Math.min(84, 860 / (Math.max(1, label.length) * 0.8))));

  const tampa = <Tampa angulo={angulo} />;

  return (
    <AbsoluteFill style={{fontFamily: FONT}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        <defs>
          {/* Tudo que voa some ao passar do aro para dentro da lixeira. */}
          <clipPath id={`${uid}-fora`}>
            <rect x={0} y={0} width={940} height={BORDA + 14} />
            <rect x={0} y={0} width={TX - 160} height={760} />
          </clipPath>
        </defs>

        {/* sombras */}
        <ellipse
          cx={TX}
          cy={CHAO + 14}
          rx={Math.max(0, 160 * entraLix * (1 + 0.08 * baque))}
          ry={20}
          fill="#000"
          opacity={0.35}
        />
        {sombraPasta > 0 ? (
          <ellipse
            cx={pastaX}
            cy={CHAO + 14}
            rx={Math.max(0, 180 * entra * (1 + 0.06 * prepara))}
            ry={20}
            fill="#000"
            opacity={0.35 * sombraPasta}
          />
        ) : null}

        {/* contorno de onde a pasta estava */}
        {fantasma > 0 ? (
          <path
            d={PASTA_FUNDO}
            transform={`translate(${FX} ${FY})`}
            fill="none"
            stroke="#fff"
            strokeWidth={6}
            strokeDasharray="20 16"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={fantasma}
          />
        ) : null}

        {/* boca da lixeira e tampa aberta (atrás do que voa) */}
        <g transform={lixT}>
          <ellipse cx={TX} cy={BORDA + 8} rx={130} ry={30} fill="#0f172a" stroke="#000" strokeWidth={6} />
          {frame < FECHA ? tampa : null}
        </g>

        {/* folhas soltas e a pasta voando */}
        <g clipPath={`url(#${uid}-fora)`}>
          {[0, 1, 2].map((i) => {
            const ini = VOO + 2 + i * 3;
            const t = interpolate(frame, [ini, ini + 13], [0, 1], {...CLAMP, easing: Easing.in(Easing.quad)});
            if (frame <= ini || t >= 1) return null;
            const x = interpolate(t, [0, 1], [FX - 40 + i * 40, TX - 40 + i * 40]);
            const y = interpolate(t, [0, 1], [FY - 120, ALVO_Y]) - (270 + i * 25) * 4 * t * (1 - t);
            const giro = (i % 2 ? 1 : -1) * interpolate(t, [0, 1], [12, 260]) + Math.sin(frame * 0.8 + i * 2) * 10;
            const esc = interpolate(t, [0, 0.15, 1], [0.4, 0.9, 0.45]);
            const op = interpolate(t, [0, 0.08], [0, 1], CLAMP);
            return (
              <g key={i} transform={`translate(${x} ${y}) rotate(${giro}) scale(${esc})`} opacity={op}>
                <Folha />
              </g>
            );
          })}
          {frame <= POUSO ? (
            <g transform={`translate(${pastaX} ${pastaY}) rotate(${pastaRot}) scale(${pastaSx} ${pastaSy})`}>
              <Pasta nome={nome} />
            </g>
          ) : null}
        </g>

        {/* corpo da lixeira, ✗ e tampa fechada (na frente) */}
        <g transform={lixT}>
          <Corpo />
          {frame > impacto ? (
            <g transform={`translate(${TX} ${BORDA + 160}) rotate(${interpolate(xIn, [0, 1], [-40, -8])}) scale(${xIn})`}>
              <circle r={50} fill={accent} stroke="#000" strokeWidth={7} />
              <path d="M -20 -20 L 20 20 M 20 -20 L -20 20" stroke="#fff" strokeWidth={13} strokeLinecap="round" />
            </g>
          ) : null}
          {frame >= FECHA ? tampa : null}
        </g>

        {/* linhas de impacto em volta da tampa */}
        {frame >= impacto && frame <= impacto + 12
          ? RAIOS.map((g) => {
              const a = (g * Math.PI) / 180;
              const c = Math.cos(a);
              const s = Math.sin(a);
              const k1 = 1 + 0.15 * imp;
              const k2 = k1 + 0.22 * (1 - imp) + 0.05;
              return (
                <line
                  key={g}
                  x1={TX + c * 170 * k1}
                  y1={BORDA - 15 + s * 62 * k1}
                  x2={TX + c * 170 * k2}
                  y2={BORDA - 15 + s * 62 * k2}
                  stroke="#fff"
                  strokeWidth={9}
                  strokeLinecap="round"
                  opacity={1 - imp}
                />
              );
            })
          : null}

        {/* poeira na base */}
        {frame >= impacto && frame <= impacto + 16
          ? POEIRA.map(([lado, j]) => (
              <circle
                key={`${lado}${j}`}
                cx={TX + lado * (108 + j * 22 + 40 * po)}
                cy={CHAO - 8 - j * 10 - 14 * po}
                r={16 - j * 3 + 14 * po}
                fill={CINZA_CLARO}
                opacity={(1 - po) * 0.7}
              />
            ))
          : null}
      </svg>

      {label ? (
        <div
          style={{
            position: 'absolute',
            top: 44,
            left: 30,
            right: 30,
            textAlign: 'center',
            fontWeight: 900,
            fontSize: tamLabel,
            lineHeight: 1.05,
            color: accent,
            textTransform: 'uppercase',
            opacity: Math.min(1, labelIn * 2),
            transform: `scale(${labelIn}) rotate(${labelRot}deg)`,
            ...outline(12),
          }}
        >
          {label}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
