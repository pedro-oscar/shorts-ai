import React from 'react';
import {AbsoluteFill, Easing, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * "Explicou demais e perdeu a sala": mesa de reunião vista de frente com 1–3 ouvintes em busto.
 * Um balão de fala entra pela esquerda (quem fala está fora de quadro) e não para de crescer,
 * ganhando linhas de rabisco. No começo todos olham para o balão e sorriem; a partir de
 * `cansarAt` cada um "desliga": um abaixa o olhar para o celular que acende, outro inclina a
 * cabeça e boceja (boca em O), outro cochila (cabeça cai, dá uma pescada e solta "Z z z").
 * Com 1 pessoa (diretor de gravata): olha de lado → celular → dorme. A barra "ATENÇÃO" no topo
 * esvazia de verde para amarelo e vermelho; em `labelAt` o rótulo entra no lugar dela.
 */

const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const EASE = {...CLAMP, easing: Easing.inOut(Easing.quad)};
const INK = '#111';
const WOOD = '#B07B52';
const WOOD_EDGE = '#8A5A37';
const WOOD_DARK = '#6E4529';
const GREEN = '#40C057';
const BAR_BG = '#2B2F36';
const LINE_GRAY = '#AEB5BE';
const LINE_GRAY_2 = '#C3C9D0';
const DOT_GRAY = '#868E96';
const MOUTH = '#7A1B1B';
const TONGUE = '#E8737A';
const CHEEK = '#F19A8A';
const PHONE = '#212529';
const SCREEN_OFF = '#1F2733';
const SCREEN_ON = '#A5D8FF';

// Geometria (caixa 940×760). Cada ouvinte é desenhado em coordenadas locais: (0, 0) é o meio do
// tronco, escondido atrás da mesa; a cabeça fica em (0, HEAD_Y) com raio 70.
const BASE_Y = 600;
const HEAD_Y = -175;
const TABLE_CLIP_Y = 640;
const TORSO_D = 'M -112 70 C -110 -20 -84 -84 -30 -94 Q 0 -72 30 -94 C 84 -84 110 -20 112 70 Z';
const TIE_D = 'M -9 -86 L 9 -86 L 12 -74 L 5 -68 L 12 -22 L 0 -8 L -12 -22 L -5 -68 L -12 -74 Z';
// Cabelos (relativos ao centro da cabeça).
const HAIR_CAP =
  'M -73 0 C -84 -64 -42 -90 0 -90 C 42 -90 84 -64 73 0 C 66 -28 58 -42 46 -52 ' +
  'C 20 -42 -18 -44 -46 -56 C -60 -42 -68 -26 -73 0 Z';
const HAIR_LONG_BACK =
  'M -80 -8 C -90 -80 -44 -96 0 -96 C 44 -96 90 -80 80 -8 L 88 96 Q 66 110 44 94 ' +
  'L -44 94 Q -66 110 -88 96 Z';
const HAIR_LONG_FRINGE =
  'M -74 -6 C -78 -68 -38 -90 0 -90 C 38 -90 78 -68 74 -6 C 62 -36 40 -52 12 -50 ' +
  'C -10 -58 -46 -50 -74 -6 Z';
const CURLS: ReadonlyArray<readonly [number, number, number]> = [
  [-54, -40, 22],
  [-30, -62, 25],
  [0, -72, 27],
  [30, -62, 25],
  [54, -40, 22],
];

// Balão: canto superior esquerdo, sempre acima das cabeças. O rabicho aponta para fora da caixa.
const BX = 34;
const BY = 100;
const TIP_X = -16;
const PAD_X = 30;
const PAD_T = 26;
const PAD_B = 26;
const LINE_H = 13;
const LINE_GAP = 24;
const WORD_GAP = 9;
const MIN_W = 210;
// "Palavras" de cada linha (frações da linha) e comprimento de cada linha (fração da largura útil).
const WORDS: number[][] = [
  [0.32, 0.22, 0.46],
  [0.18, 0.42, 0.4],
  [0.36, 0.28, 0.36],
  [0.5, 0.5],
  [0.24, 0.34, 0.42],
  [0.4, 0.6],
  [0.55, 0.45],
];
const WORD_STARTS = WORDS.map((ws) => ws.map((_, j) => ws.slice(0, j).reduce((acc, x) => acc + x, 0)));
const LINE_FRAC = [0.84, 0.7, 0.8, 0.6, 0.82, 0.66, 0.5];

const balaoD = (x: number, y: number, w: number, h: number) => {
  const r = 30;
  const b = y + h;
  return [
    `M ${x + r} ${y}`,
    `H ${x + w - r}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `V ${b - r}`,
    `Q ${x + w} ${b} ${x + w - r} ${b}`,
    `H ${x + 112}`,
    `L ${TIP_X} ${b + 46}`,
    `L ${x + 52} ${b}`,
    `H ${x + r}`,
    `Q ${x} ${b} ${x} ${b - r}`,
    `V ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    'Z',
  ].join(' ');
};

type Kind = 'celular' | 'bocejo' | 'sono' | 'diretor';

type Visual = {
  skin: string;
  skinDark: string;
  hair: string;
  shirt: string;
  shirtDark: string;
  style: 0 | 1 | 2;
  tie: boolean;
};

type Slot = {cx: number; s: number; kind: Kind; v: Visual};

type Pose = {
  lookX: number; // -1 esquerda … 1 direita
  lookY: number; // -1 cima … 1 baixo
  open: number; // abertura dos olhos (0 fechados)
  smile: number; // 1 sorriso, 0 boca reta
  mouth: number; // 0 fechada … 1 boca em O (bocejo)
  tilt: number; // inclinação da cabeça (graus)
  drop: number; // queda da cabeça (px)
  brow: number; // 0 sobrancelha erguida, 1 caída
  phone: number; // 0 guardado, 1 na frente do peito
  glow: number; // tela acesa
  zzzAt: number | null; // frame em que começa o "Z z z"
};

const PEDRO: Visual = {
  skin: '#F2C9A0',
  skinDark: '#DCA57C',
  hair: '#3A2A20',
  shirt: '#3B5BDB',
  shirtDark: '#2B47B0',
  style: 0,
  tie: false,
};
const ANA: Visual = {
  skin: '#E0AC7E',
  skinDark: '#C48D60',
  hair: '#7A3E1D',
  shirt: '#12B886',
  shirtDark: '#0C8F68',
  style: 1,
  tie: false,
};
const JOAO: Visual = {
  skin: '#A86F4C',
  skinDark: '#8A5636',
  hair: '#1E1A17',
  shirt: '#F08C00',
  shirtDark: '#C46F00',
  style: 2,
  tie: false,
};
const DIRETOR: Visual = {
  skin: '#F2C9A0',
  skinDark: '#DCA57C',
  hair: '#8D939C',
  shirt: '#343A40',
  shirtDark: '#1F2327',
  style: 0,
  tie: true,
};

const LAYOUTS: Record<1 | 2 | 3, Slot[]> = {
  1: [{cx: 470, s: 1.18, kind: 'diretor', v: DIRETOR}],
  2: [
    {cx: 320, s: 1.06, kind: 'celular', v: PEDRO},
    {cx: 620, s: 1.06, kind: 'sono', v: JOAO},
  ],
  3: [
    {cx: 230, s: 1, kind: 'celular', v: PEDRO},
    {cx: 470, s: 1, kind: 'bocejo', v: ANA},
    {cx: 710, s: 1, kind: 'sono', v: JOAO},
  ],
};

const clampPessoas = (v: number): 1 | 2 | 3 => {
  const r = Number.isFinite(v) ? Math.round(v) : 3;
  return r <= 1 ? 1 : r >= 3 ? 3 : 2;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ramp = (frame: number, start: number, dur: number) =>
  interpolate(frame, [start, start + dur], [0, 1], {...CLAMP, easing: Easing.inOut(Easing.cubic)});

// Todos começam olhando para o balão (em cima, à esquerda) e sorrindo.
const ATENTO: Pose = {
  lookX: -0.7,
  lookY: -0.5,
  open: 1,
  smile: 1,
  mouth: 0,
  tilt: 0,
  drop: 0,
  brow: 0,
  phone: 0,
  glow: 0,
  zzzAt: null,
};

const olharDeLado = (p: Pose, frame: number, s: number): Pose => {
  const k = ramp(frame, s, 9);
  return {
    ...p,
    lookX: lerp(p.lookX, 1, k),
    lookY: lerp(p.lookY, 0.05, k),
    smile: lerp(p.smile, 0, k),
    brow: lerp(p.brow, 0.5, k),
    tilt: lerp(p.tilt, 5, k),
  };
};

const celular = (p: Pose, frame: number, fps: number, s: number): Pose => {
  const k = ramp(frame, s, 10);
  const up = spring({frame: frame - s, fps, config: {damping: 14, stiffness: 150}});
  return {
    ...p,
    lookX: lerp(p.lookX, 0.1, k),
    lookY: lerp(p.lookY, 1, k),
    open: lerp(p.open, 0.7, k),
    smile: lerp(p.smile, 0, k),
    brow: lerp(p.brow, 0.6, k),
    tilt: lerp(p.tilt, 4, k),
    drop: lerp(p.drop, 10, k),
    phone: up,
    glow: ramp(frame, s + 6, 6),
  };
};

const bocejo = (p: Pose, frame: number, s: number): Pose => {
  const seg = [s, s + 10, s + 30, s + 44];
  const k = ramp(frame, s, 18);
  const sway = Math.sin(frame * 0.08) * 2 * ramp(frame, s + 30, 14);
  return {
    ...p,
    mouth: interpolate(frame, seg, [0, 1, 1, 0.22], EASE),
    open: interpolate(frame, [s, s + 8, s + 32, s + 46], [p.open, 0.1, 0.1, 0.42], EASE),
    smile: lerp(p.smile, 0, k),
    brow: lerp(p.brow, 1, k),
    lookX: lerp(p.lookX, 0.2, k),
    lookY: lerp(p.lookY, 0.6, k),
    tilt: lerp(p.tilt, -15, k) + sway,
    drop: p.drop + interpolate(frame, seg, [0, -8, -8, 10], EASE),
  };
};

const sono = (p: Pose, frame: number, s: number): Pose => {
  // Pálpebras pesam, a cabeça cai, dá uma pescada (volta num tranco) e então dorme de vez.
  const seg = [s, s + 12, s + 17, s + 22, s + 38];
  const k = ramp(frame, s, 20);
  const asleep = ramp(frame, s + 36, 10);
  const breath = Math.sin((frame - s) * 0.14) * 3 * asleep;
  return {
    ...p,
    open: interpolate(frame, seg, [p.open, 0.3, 0.3, 0.8, 0], EASE),
    smile: lerp(p.smile, 0, k),
    brow: lerp(p.brow, 1, k),
    lookX: lerp(p.lookX, 0, k),
    lookY: lerp(p.lookY, 0.6, k),
    tilt: p.tilt + interpolate(frame, seg, [0, 9, 9, 2, 15], EASE),
    drop: p.drop + interpolate(frame, seg, [0, 16, 16, 3, 22], EASE) + breath,
    mouth: Math.max(p.mouth, 0.2 * ramp(frame, s + 30, 10)),
    phone: p.phone * (1 - 0.85 * ramp(frame, s + 14, 18)),
    zzzAt: s + 34,
  };
};

const poseFor = (kind: Kind, frame: number, fps: number, s: number, spanF: number): Pose => {
  if (kind === 'celular') return celular(ATENTO, frame, fps, s);
  if (kind === 'bocejo') return bocejo(ATENTO, frame, s);
  if (kind === 'sono') return sono(ATENTO, frame, s);
  const lado = olharDeLado(ATENTO, frame, s);
  const cel = celular(lado, frame, fps, s + Math.round(spanF * 0.3));
  return sono(cel, frame, s + Math.round(spanF * 0.6));
};

const Ouvinte: React.FC<{i: number; slot: Slot; pose: Pose; enter: number; frame: number; accent: string}> = ({
  i,
  slot,
  pose,
  enter,
  frame,
  accent,
}) => {
  const {cx, s, v} = slot;
  const rise = interpolate(enter, [0, 1], [170, 0]);
  const op = interpolate(enter, [0, 0.3], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});
  const bob = Math.sin(frame / 16 + i * 2.1) * 2;

  // Piscadas determinísticas (semente pelo índice).
  const blink = interpolate((frame + 40 + i * 23) % 75, [0, 2, 4], [1, 0.08, 1], CLAMP);
  const open = pose.open * blink;
  const smile = Math.max(-0.3, Math.min(1, pose.smile));
  const mouthD = `M -20 34 Q 0 ${34 + 22 * smile} 20 34`;
  const smileOpen = interpolate(smile, [0.4, 1], [0, 1], CLAMP);
  const by = -32 + 8 * pose.brow;
  const arch = 8 * (1 - pose.brow) + 1;

  const phoneP = Math.max(0, pose.phone);
  const faceLight = 0.9 * pose.glow * Math.min(1, phoneP);
  const screen = interpolateColors(pose.glow, [0, 1], [SCREEN_OFF, SCREEN_ON]);

  const zAt = pose.zzzAt;
  const zIn =
    zAt === null ? 0 : interpolate(frame, [zAt, zAt + 8], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});

  return (
    <g opacity={op} transform={`translate(${cx} ${BASE_Y + rise + bob}) scale(${s})`}>
      {/* pescoço e tronco */}
      <rect x={-20} y={-130} width={40} height={48} rx={10} fill={v.skinDark} stroke={INK} strokeWidth={6} />
      <path d={TORSO_D} fill={v.shirt} stroke={INK} strokeWidth={7} strokeLinejoin="round" />
      <path d="M -76 -30 Q -70 -10 -72 10" fill="none" stroke={v.shirtDark} strokeWidth={6} strokeLinecap="round" />
      <path d="M 76 -30 Q 70 -10 72 10" fill="none" stroke={v.shirtDark} strokeWidth={6} strokeLinecap="round" />
      {v.tie ? (
        <>
          <path d="M -30 -94 Q 0 -80 30 -94 L 0 -24 Z" fill="#fff" stroke={INK} strokeWidth={5} strokeLinejoin="round" />
          <path d={TIE_D} fill={accent} stroke={INK} strokeWidth={5} strokeLinejoin="round" />
          <path d="M -30 -94 L -48 -64 L -30 -58 L -6 -28 Z" fill={v.shirtDark} stroke={INK} strokeWidth={5} strokeLinejoin="round" />
          <path d="M 30 -94 L 48 -64 L 30 -58 L 6 -28 Z" fill={v.shirtDark} stroke={INK} strokeWidth={5} strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path d="M -30 -94 L -14 -64 L 0 -83 Z" fill={v.shirt} stroke={INK} strokeWidth={5} strokeLinejoin="round" />
          <path d="M 30 -94 L 14 -64 L 0 -83 Z" fill={v.shirt} stroke={INK} strokeWidth={5} strokeLinejoin="round" />
        </>
      )}

      {/* cabeça (gira em torno do pescoço) */}
      <g transform={`translate(0 ${HEAD_Y + pose.drop}) rotate(${pose.tilt} 0 62)`}>
        {v.style === 1 ? (
          <path d={HAIR_LONG_BACK} fill={v.hair} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
        ) : (
          [-1, 1].map((d) => (
            <ellipse key={d} cx={d * 70} cy={6} rx={13} ry={19} fill={v.skin} stroke={INK} strokeWidth={6} />
          ))
        )}
        <circle r={70} fill={v.skin} stroke={INK} strokeWidth={7} />
        <circle r={64} fill="url(#rc-luz)" opacity={faceLight} />

        {v.style === 0 ? (
          <path d={HAIR_CAP} fill={v.hair} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
        ) : v.style === 1 ? (
          <path d={HAIR_LONG_FRINGE} fill={v.hair} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
        ) : (
          <g>
            {CURLS.map(([x, y, r], k) => (
              <circle key={`o${k}`} cx={x} cy={y} r={r} fill={v.hair} stroke={INK} strokeWidth={12} />
            ))}
            {CURLS.map(([x, y, r], k) => (
              <circle key={`f${k}`} cx={x} cy={y} r={r} fill={v.hair} />
            ))}
          </g>
        )}

        {/* rosto: desloca de leve na direção do olhar */}
        <g transform={`translate(${pose.lookX * 4} ${pose.lookY * 4})`}>
          <path
            d={`M -39 ${by} Q -25 ${by - arch} -11 ${by}`}
            fill="none"
            stroke={INK}
            strokeWidth={7}
            strokeLinecap="round"
          />
          <path
            d={`M 11 ${by} Q 25 ${by - arch} 39 ${by}`}
            fill="none"
            stroke={INK}
            strokeWidth={7}
            strokeLinecap="round"
          />

          {[-25, 25].map((ex) =>
            open < 0.14 ? (
              <path
                key={ex}
                d={`M ${ex - 14} -2 Q ${ex} 8 ${ex + 14} -2`}
                fill="none"
                stroke={INK}
                strokeWidth={6}
                strokeLinecap="round"
              />
            ) : (
              <g key={ex}>
                <ellipse cx={ex} cy={-4} rx={13} ry={15 * open} fill="#fff" stroke={INK} strokeWidth={5} />
                <ellipse
                  cx={ex + pose.lookX * 5}
                  cy={-4 + pose.lookY * Math.max(0, 15 * open - 7.5)}
                  rx={6.5}
                  ry={Math.min(6.5, 15 * open - 1)}
                  fill={INK}
                />
              </g>
            ),
          )}

          <path
            d="M 3 8 Q -8 20 6 22"
            fill="none"
            stroke={INK}
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <ellipse cx={-42} cy={22} rx={14} ry={8} fill={CHEEK} opacity={0.45 * Math.max(0, smile)} />
          <ellipse cx={42} cy={22} rx={14} ry={8} fill={CHEEK} opacity={0.45 * Math.max(0, smile)} />

          {pose.mouth > 0.06 ? (
            <g>
              <ellipse
                cx={0}
                cy={44}
                rx={9 + 7 * pose.mouth}
                ry={3 + 19 * pose.mouth}
                fill={MOUTH}
                stroke={INK}
                strokeWidth={6}
              />
              {pose.mouth > 0.5 ? (
                <ellipse cx={0} cy={44 + 12 * pose.mouth} rx={8 * pose.mouth} ry={5 * pose.mouth} fill={TONGUE} />
              ) : null}
            </g>
          ) : (
            <>
              <path d={`${mouthD} Z`} fill={MOUTH} opacity={smileOpen} />
              <path d={mouthD} fill="none" stroke={INK} strokeWidth={6} strokeLinecap="round" />
            </>
          )}
        </g>
      </g>

      {/* celular: sobe de trás da mesa e acende */}
      {phoneP > 0.01 ? (
        <g transform={`translate(8 ${-54 + interpolate(phoneP, [0, 1], [140, 0])}) rotate(-6)`}>
          {[-1, 1].map((d) => (
            <g key={d}>
              <path
                d={`M ${d * 74} 130 L ${d * 25} ${d < 0 ? 14 : 18}`}
                fill="none"
                stroke={INK}
                strokeWidth={34}
                strokeLinecap="round"
              />
              <path
                d={`M ${d * 74} 130 L ${d * 25} ${d < 0 ? 14 : 18}`}
                fill="none"
                stroke={v.shirt}
                strokeWidth={22}
                strokeLinecap="round"
              />
            </g>
          ))}
          <circle r={78} fill="url(#rc-halo)" opacity={0.8 * pose.glow} />
          <rect x={-25} y={-40} width={50} height={80} rx={10} fill={PHONE} stroke={INK} strokeWidth={6} />
          <rect x={-19} y={-32} width={38} height={62} rx={5} fill={screen} />
          <g clipPath="url(#rc-tela)">
            {[0, 1, 2].map((k) => {
              const yy = -36 + ((((k * 24 - frame * 1.3) % 72) + 72) % 72);
              return <rect key={k} x={-14} y={yy} width={28} height={16} rx={3} fill="#fff" opacity={0.75 * pose.glow} />;
            })}
          </g>
          {[-1, 1].map((d) => (
            <circle key={d} cx={d * 25} cy={d < 0 ? 14 : 18} r={14} fill={v.skin} stroke={INK} strokeWidth={5} />
          ))}
        </g>
      ) : null}

      {/* Z z z subindo em loop */}
      {zAt !== null && frame >= zAt ? (
        <g transform={`translate(72 ${-248 + pose.drop})`}>
          {['Z', 'z', 'z'].map((ch, j) => {
            const t = frame - zAt - j * 16;
            if (t < 0) return null;
            const ph = (t % 48) / 48;
            const o = interpolate(ph, [0, 0.15, 0.7, 1], [0, 1, 1, 0], CLAMP);
            return (
              <text
                key={j}
                x={ph * 70 + Math.sin(ph * 7 + j) * 8}
                y={-ph * 130}
                fontFamily={FONT}
                fontWeight={900}
                fontSize={26 + 30 * ph + j * 4}
                fill="#fff"
                stroke={INK}
                strokeWidth={8}
                strokeLinejoin="round"
                paintOrder="stroke"
                opacity={o * zIn}
              >
                {ch}
              </text>
            );
          })}
        </g>
      ) : null}
    </g>
  );
};

export const ReuniaoCansada: React.FC<
  SceneProps & {pessoas?: number; cansarAt?: number; label?: string; labelAt?: number}
> = ({pessoas = 3, cansarAt = 1.2, label = 'Perdeu a atenção', labelAt = 3.6, accent, highlight}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const n = clampPessoas(Number(pessoas));
  const slots = LAYOUTS[n];
  const cansar = Number.isFinite(cansarAt) ? Math.max(0, cansarAt) : 1.2;
  const labelT = Number.isFinite(labelAt) ? labelAt : 3.6;
  const cF = Math.round(cansar * fps);
  const lF = Math.round(labelT * fps);
  const spanF = Math.max(Math.round(0.6 * fps), lF - cF);
  const b = Math.round(0.2 * fps);
  const lineEvery = Math.round(0.5 * fps);

  // Mesa
  const tableIn = spring({frame, fps, config: {damping: 14, stiffness: 180}});
  const tableOp = interpolate(tableIn, [0, 0.3], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});
  const tableS = interpolate(tableIn, [0, 1], [0.88, 1]);
  const tableY = interpolate(tableIn, [0, 1], [50, 0]);

  // Balão que não para de crescer
  const bIn = spring({frame: frame - b, fps, config: {damping: 12, stiffness: 170}});
  const lineStart = (i: number) => b + 3 + i * lineEvery;
  const sumG = WORDS.slice(1).reduce(
    (acc, _, k) => acc + spring({frame: frame - lineStart(k + 1), fps, config: {damping: 14, stiffness: 170}}),
    0,
  );
  const maxW = n === 1 ? 326 : 436; // nunca passa do meio dos ouvintes nem desce sobre os rostos
  const bw = MIN_W + (maxW - MIN_W) * interpolate(sumG, [0, 3], [0, 1], CLAMP);
  const bh = PAD_T + LINE_H + LINE_GAP * sumG + PAD_B;
  const tipY = BY + bh + 46;
  const innerW = bw - 2 * PAD_X;
  const wob = 1 + 0.012 * Math.sin(frame * 0.9) * Math.min(1, bIn);
  const bS = interpolate(bIn, [0, 1], [0.4, 1]) * wob;
  const bX = interpolate(bIn, [0, 1], [-240, 0]);
  const bOp = interpolate(bIn, [0, 0.25], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});
  const last = WORDS.length - 1;
  const dotsIn = interpolate(frame, [lineStart(last) + 16, lineStart(last) + 22], [0, 1], {
    ...CLAMP,
    easing: Easing.out(Easing.quad),
  });
  const balloonD = balaoD(BX, BY, bw, bh);

  // Barra de atenção
  const barIn = spring({frame: frame - 8, fps, config: {damping: 13, stiffness: 160}});
  const hide = label ? interpolate(frame, [lF, lF + 8], [0, 1], EASE) : 0;
  const barOp = interpolate(barIn, [0, 0.3], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)}) * (1 - hide);
  const barS = interpolate(barIn, [0, 1], [0.6, 1]);
  const level = interpolate(frame, [cF, cF + spanF], [1, 0.1], {...CLAMP, easing: Easing.inOut(Easing.cubic)});
  const levelColor = interpolateColors(level, [0.1, 0.5, 0.95], [accent, highlight, GREEN]);
  const lowPulse = interpolate(level, [0.1, 0.35], [1, 0], CLAMP);
  const fillOp = 1 - lowPulse * 0.45 * (0.5 + 0.5 * Math.sin(frame * 0.7));

  // Rótulo
  const labelIn = spring({frame: frame - lF, fps, config: {damping: 10, stiffness: 150}});
  const labelSize = Math.floor(Math.min(80, 860 / (0.72 * Math.max(1, label.length))));

  return (
    <AbsoluteFill style={{fontFamily: FONT}}>
      <svg style={{position: 'absolute', inset: 0}} width="100%" height="100%" viewBox="0 0 940 760">
        <defs>
          <radialGradient id="rc-luz" cx="50%" cy="100%" r="85%">
            <stop offset="0%" stopColor={SCREEN_ON} stopOpacity={0.75} />
            <stop offset="100%" stopColor={SCREEN_ON} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="rc-halo">
            <stop offset="0%" stopColor="#D0EBFF" stopOpacity={0.9} />
            <stop offset="100%" stopColor="#D0EBFF" stopOpacity={0} />
          </radialGradient>
          <clipPath id="rc-tela">
            <rect x={-19} y={-32} width={38} height={62} rx={5} />
          </clipPath>
          <clipPath id="rc-mesa">
            <rect x={0} y={0} width={940} height={TABLE_CLIP_Y} />
          </clipPath>
        </defs>

        {/* sombra */}
        <ellipse cx={470} cy={728} rx={Math.max(0, 410 * tableIn)} ry={22} fill="#000" opacity={0.35} />

        {/* ouvintes (sobem de trás da mesa) */}
        <g clipPath="url(#rc-mesa)">
          {slots.map((slot, i) => {
            const enter = spring({frame: frame - 3 - i * 4, fps, config: {damping: 13, stiffness: 200}});
            const start = cF + (slots.length > 1 ? Math.round((i * spanF * 0.55) / (slots.length - 1)) : 0);
            const pose = poseFor(slot.kind, frame, fps, start, spanF);
            return <Ouvinte key={i} i={i} slot={slot} pose={pose} enter={enter} frame={frame} accent={accent} />;
          })}
        </g>

        {/* mesa */}
        <g
          opacity={tableOp}
          transform={`translate(0 ${tableY}) translate(470 640) scale(${tableS}) translate(-470 -640)`}
        >
          <rect x={104} y={636} width={732} height={72} rx={6} fill={WOOD_DARK} stroke={INK} strokeWidth={7} />
          <path d="M 98 580 H 842 L 888 616 H 52 Z" fill={WOOD} stroke={INK} strokeWidth={8} strokeLinejoin="round" />
          <rect x={52} y={616} width={836} height={24} rx={6} fill={WOOD_EDGE} stroke={INK} strokeWidth={8} />
          <path d="M 132 592 H 330" stroke="#fff" strokeWidth={6} strokeLinecap="round" opacity={0.25} />

          {/* papéis */}
          <path d="M 322 584 L 404 580 L 410 602 L 316 606 Z" fill="#E9ECEF" stroke={INK} strokeWidth={5} strokeLinejoin="round" />
          <path d="M 312 590 L 398 588 L 404 610 L 304 612 Z" fill="#F8F9FA" stroke={INK} strokeWidth={5} strokeLinejoin="round" />
          <path d="M 324 597 H 384 M 322 604 H 370" stroke={LINE_GRAY} strokeWidth={3} strokeLinecap="round" />

          {/* caneca de café */}
          {[0, 1].map((k) => (
            <path
              key={k}
              d={`M ${604 + k * 14} 556 q -6 -9 0 -18 q 6 -9 0 -18`}
              fill="none"
              stroke="#fff"
              strokeWidth={4}
              strokeLinecap="round"
              opacity={0.45 + 0.25 * Math.sin(frame * 0.15 + k * 2)}
              transform={`translate(${Math.sin(frame * 0.1 + k) * 2} ${-3 - 3 * Math.sin(frame * 0.12 + k * 1.5)})`}
            />
          ))}
          <path d="M 626 576 Q 644 578 642 590 Q 640 600 626 598" fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" />
          <path d="M 596 566 H 628 V 600 Q 628 608 620 608 H 604 Q 596 608 596 600 Z" fill="#F1F3F5" stroke={INK} strokeWidth={5} strokeLinejoin="round" />
          <ellipse cx={612} cy={567} rx={14} ry={3.5} fill="#6B3E1F" />
          <rect x={596} y={582} width={32} height={8} fill={accent} opacity={0.85} />
        </g>

        {/* balão de fala (quem explica está fora do quadro, à esquerda) */}
        <g
          opacity={bOp}
          transform={`translate(${bX} 0) translate(${TIP_X} ${tipY}) scale(${bS}) translate(${-TIP_X} ${-tipY})`}
        >
          <path d={balloonD} transform="translate(8 10)" fill="#000" opacity={0.28} />
          <path d={balloonD} fill="#fff" stroke={INK} strokeWidth={8} strokeLinejoin="round" />
          {WORDS.map((words, i) => {
            const d = interpolate(frame, [lineStart(i) + 4, lineStart(i) + 16], [0, 1], {
              ...CLAMP,
              easing: Easing.out(Easing.cubic),
            });
            if (d <= 0.001) return null;
            const full = innerW * LINE_FRAC[i];
            const x0 = BX + PAD_X;
            const end = x0 + full * d;
            const y = BY + PAD_T + i * LINE_GAP;
            return (
              <g key={i}>
                {words.map((wf, j) => {
                  const ws = x0 + WORD_STARTS[i][j] * full;
                  const right = Math.min(ws + wf * full - WORD_GAP, end);
                  if (right - ws < 1) return null;
                  return (
                    <rect
                      key={j}
                      x={ws}
                      y={y}
                      width={right - ws}
                      height={LINE_H}
                      rx={LINE_H / 2}
                      fill={i % 2 ? LINE_GRAY_2 : LINE_GRAY}
                    />
                  );
                })}
              </g>
            );
          })}
          {/* "..." de quem ainda não terminou */}
          {dotsIn > 0
            ? [0, 1, 2].map((k) => (
                <circle
                  key={k}
                  cx={BX + PAD_X + innerW * LINE_FRAC[last] + 16 + k * 18}
                  cy={BY + PAD_T + last * LINE_GAP + LINE_H / 2 - 4 * Math.max(0, Math.sin(frame * 0.35 - k * 1.1))}
                  r={6}
                  fill={DOT_GRAY}
                  opacity={dotsIn * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(frame * 0.35 - k * 1.1)))}
                />
              ))
            : null}
        </g>

        {/* barra de atenção */}
        {barOp > 0.001 ? (
          <g
            opacity={barOp}
            transform={`translate(0 ${-30 * hide}) translate(470 52) scale(${barS}) translate(-470 -52)`}
          >
            <text
              x={336}
              y={61}
              textAnchor="end"
              fontFamily={FONT}
              fontWeight={900}
              fontSize={26}
              fill="#fff"
              stroke={INK}
              strokeWidth={7}
              strokeLinejoin="round"
              paintOrder="stroke"
            >
              ATENÇÃO
            </text>
            <rect x={350} y={34} width={404} height={36} rx={18} fill={BAR_BG} stroke={INK} strokeWidth={6} />
            <rect x={357} y={41} width={390 * level} height={22} rx={11} fill={levelColor} opacity={fillOp} />
            <rect
              x={366}
              y={44}
              width={Math.max(0, 390 * level - 20)}
              height={6}
              rx={3}
              fill="#fff"
              opacity={0.35 * fillOp}
            />
          </g>
        ) : null}
      </svg>

      {label ? (
        <div
          style={{
            position: 'absolute',
            top: 24,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            whiteSpace: 'nowrap',
            fontWeight: 900,
            fontSize: labelSize,
            lineHeight: 1,
            color: accent,
            textTransform: 'uppercase',
            transform: `scale(${labelIn})`,
            ...outline(12),
          }}
        >
          {label}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
