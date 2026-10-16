import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * "Nas disputas políticas deste mundo, quem ganha é o diabo": cabo de guerra entre dois grupos
 * (azul × verde) que puxam para lá e para cá, suando. No `vencedorAt` a corda arrebenta no meio,
 * os dois grupos caem sentados para trás e um diabinho surge no centro erguendo o troféu, com a
 * faixa `vencedor` embaixo. Rótulos opcionais sobre os grupos e no topo.
 */

const INK = '#111';
const SKIN = '#f2c08f';
const SKIN_DARK = '#d99a64';
const HAIR = '#3b2a20';
const PANTS = '#334155';
const PANTS_DARK = '#1f2937';
const BLUE = '#2563eb';
const BLUE_DARK = '#1e3a8a';
const GREEN = '#16a34a';
const GREEN_DARK = '#14532d';
const ROPE = '#d6b98c';
const ROPE_DARK = '#6b4f2a';
const ROPE_TWIST = '#b08a58';
const SWEAT = '#7dd3fc';
const DUST = '#ece6da';
const HORN = '#7a0a0a';
const MOUTH = '#4a0808';
const GOLD_DARK = '#c08a00';
const GOLD_LIGHT = '#fff3a3';
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// Topo 0–120 fica livre para o rótulo; faixa do vencedor embaixo do chão.
const CX = 470;
const GROUND = 652;
const RIBBON_Y = 706;
const PILL_Y = 404;
const S = 0.85; // escala dos bonequinhos
const FRONT_GAP = 140; // centro → quadril do bonequinho da frente
const SPACING = 92;
const RECOIL = 18;
const LEG = 88;
const TORSO = 84;
const HEAD_D = 128;
const HEAD_R = 34;
const DEVIL_S = 1.2;
const OMEGA = (2 * Math.PI) / 22; // período do puxa-puxa ≈ 0,73 s
const DROP_LIFE = 14;
const DROPS = 10;

type Pt = {x: number; y: number};
/** legA: graus a partir da vertical para baixo (+ = para a frente); bodyA: a partir da vertical para cima (− = para trás). */
type Pose = {legA: number; bodyA: number; hipH: number; hand: Pt};
type Body = {legA: number; bodyA: number; foot: Pt; shoulder: Pt; head: Pt; hand: Pt};
type Fig = {key: string; d: number; j: number; x: number; y: number; body: Body; hand: Pt; head: Pt; shirt: string; dark: string};

const PULL: Pose = {legA: 30, bodyA: -26, hipH: 76, hand: {x: 36, y: -62}};
const FALL: Pose = {legA: 112, bodyA: -56, hipH: 24, hand: {x: -6, y: -84}};
const ROPE_Y = GROUND + S * (PULL.hand.y - PULL.hipH);

const DROP_PATH = 'M 0 -13 C 6 -5 10 1 10 6 A 10 10 0 0 1 -10 6 C -10 1 -6 -5 0 -13 Z';
const HANDLE_L = 'M -40 -88 C -64 -88 -62 -56 -34 -52';
const HANDLE_R = 'M 40 -88 C 64 -88 62 -56 34 -52';
const SPARKS: Array<[number, number, number]> = [
  [-66, -118, 15],
  [64, -128, 18],
  [60, -36, 13],
];
const PUFFS: Array<[number, number, number]> = [
  [-24, 4, 17],
  [0, -8, 24],
  [24, 4, 16],
];

const rad = (deg: number) => (deg * Math.PI) / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t)});
const P = (p: Pt) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
/** Pseudoaleatório determinístico em [0, 1). */
const rand = (seed: number) => {
  const v = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
};

const sparkle = (r: number) => {
  const k = r * 0.18;
  return `M 0 ${-r} Q ${k} ${-k} ${r} 0 Q ${k} ${k} 0 ${r} Q ${-k} ${k} ${-r} 0 Q ${-k} ${-k} 0 ${-r} Z`;
};

const starPath = (cx: number, cy: number, r: number, ri: number) =>
  Array.from({length: 10})
    .map((_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? ri : r;
      return `${i ? 'L' : 'M'} ${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`;
    })
    .join(' ') + ' Z';

/** Geometria do bonequinho com o quadril na origem, olhando para +x. */
const bodyOf = (legA: number, bodyA: number, hand: Pt): Body => ({
  legA,
  bodyA,
  foot: {x: Math.sin(rad(legA)) * LEG, y: Math.cos(rad(legA)) * LEG},
  shoulder: {x: Math.sin(rad(bodyA)) * TORSO, y: -Math.cos(rad(bodyA)) * TORSO},
  head: {x: Math.sin(rad(bodyA)) * HEAD_D, y: -Math.cos(rad(bodyA)) * HEAD_D},
  hand,
});

/** Traço grosso com contorno (membros, tronco). */
const Stroke: React.FC<{pts: Pt[]; w: number; color: string}> = ({pts, w, color}) => {
  const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${P(p)}`).join(' ');
  return (
    <g>
      <path d={d} fill="none" stroke={INK} strokeWidth={w + 14} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
};

const Rope: React.FC<{d: string}> = ({d}) => (
  <g>
    <path d={d} fill="none" stroke={ROPE_DARK} strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" />
    <path d={d} fill="none" stroke={ROPE} strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" />
    <path d={d} fill="none" stroke={ROPE_TWIST} strokeWidth={12} strokeDasharray="5 9" opacity={0.75} />
  </g>
);

/** Cabeça olhando para +x: cara de esforço (puxando) ou de susto (caindo). */
const Face: React.FC<{scared: boolean}> = ({scared}) => (
  <g>
    <circle r={HEAD_R} fill={SKIN} stroke={INK} strokeWidth={7} />
    <path
      d="M -33 4 C -38 -26 -16 -40 8 -36 C -6 -28 -20 -16 -24 6 Z"
      fill={HAIR}
      stroke={INK}
      strokeWidth={5}
      strokeLinejoin="round"
    />
    {scared ? (
      <g>
        <circle cx={4} cy={-8} r={8} fill="#fff" stroke={INK} strokeWidth={4} />
        <circle cx={22} cy={-8} r={8} fill="#fff" stroke={INK} strokeWidth={4} />
        <circle cx={6} cy={-8} r={3} fill={INK} />
        <circle cx={24} cy={-8} r={3} fill={INK} />
        <ellipse cx={14} cy={14} rx={7} ry={9} fill={INK} />
      </g>
    ) : (
      <g>
        <path
          d="M -2 -14 L 9 -7 L -2 -1 M 28 -14 L 18 -7 L 28 -1"
          fill="none"
          stroke={INK}
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x={0} y={7} width={24} height={13} rx={4} fill="#fff" stroke={INK} strokeWidth={4} />
        <path d="M 0 13.5 L 24 13.5 M 8 7 L 8 20 M 16 7 L 16 20" stroke={INK} strokeWidth={2.5} />
        <ellipse cx={-12} cy={8} rx={7} ry={5} fill="#f87171" opacity={0.55} />
      </g>
    )}
  </g>
);

/** Bonequinho com o quadril na origem, olhando para +x (o time da direita é espelhado). */
const Puller: React.FC<{b: Body; shirt: string; dark: string; scared: boolean}> = ({b, shirt, dark, scared}) => {
  const farHand = {x: b.hand.x - 18, y: b.hand.y + 2};
  const farFoot = {x: b.foot.x - 14, y: b.foot.y};
  const shoeRot = (30 - b.legA).toFixed(1);
  return (
    <g>
      {/* braço e perna de trás */}
      <Stroke pts={[{x: b.shoulder.x - 4, y: b.shoulder.y + 4}, farHand]} w={16} color={dark} />
      <circle cx={farHand.x} cy={farHand.y} r={12} fill={SKIN_DARK} stroke={INK} strokeWidth={6} />
      <Stroke pts={[{x: -6, y: 0}, farFoot]} w={20} color={PANTS_DARK} />
      <g transform={`translate(${P(farFoot)}) rotate(${shoeRot})`}>
        <ellipse cx={9} cy={-1} rx={19} ry={10} fill={INK} />
      </g>
      {/* tronco */}
      <Stroke pts={[{x: 0, y: 0}, b.shoulder]} w={50} color={shirt} />
      {/* perna da frente */}
      <Stroke pts={[{x: 6, y: 0}, b.foot]} w={22} color={PANTS} />
      <g transform={`translate(${P(b.foot)}) rotate(${shoeRot})`}>
        <ellipse cx={9} cy={-1} rx={19} ry={10} fill={INK} />
      </g>
      {/* cabeça */}
      <g transform={`translate(${P(b.head)}) rotate(${(b.bodyA * 0.5).toFixed(1)})`}>
        <Face scared={scared} />
      </g>
      {/* braço da frente */}
      <Stroke pts={[b.shoulder, b.hand]} w={18} color={shirt} />
      <circle cx={b.hand.x} cy={b.hand.y} r={13} fill={SKIN} stroke={INK} strokeWidth={6} />
    </g>
  );
};

/** Troféu com a origem no ponto da haste onde a mão segura. */
const Trofeu: React.FC<{highlight: string; shine: number}> = ({highlight, shine}) => (
  <g>
    <path d={HANDLE_L} fill="none" stroke={INK} strokeWidth={17} strokeLinecap="round" />
    <path d={HANDLE_L} fill="none" stroke={highlight} strokeWidth={7} strokeLinecap="round" />
    <path d={HANDLE_R} fill="none" stroke={INK} strokeWidth={17} strokeLinecap="round" />
    <path d={HANDLE_R} fill="none" stroke={highlight} strokeWidth={7} strokeLinecap="round" />
    <rect x={-8} y={-34} width={16} height={38} fill={highlight} stroke={INK} strokeWidth={6} />
    <rect x={-22} y={2} width={44} height={14} rx={3} fill={highlight} stroke={INK} strokeWidth={6} />
    <rect x={-32} y={14} width={64} height={16} rx={4} fill={GOLD_DARK} stroke={INK} strokeWidth={6} />
    <path
      d="M -42 -100 L 42 -100 C 42 -60 26 -32 0 -30 C -26 -32 -42 -60 -42 -100 Z"
      fill={highlight}
      stroke={INK}
      strokeWidth={7}
      strokeLinejoin="round"
    />
    <ellipse cx={0} cy={-100} rx={42} ry={8} fill={GOLD_LIGHT} stroke={INK} strokeWidth={6} />
    <path d={starPath(0, -68, 15, 6.5)} fill="#fff" stroke={INK} strokeWidth={4} strokeLinejoin="round" />
    <path
      d="M -29 -88 C -29 -68 -23 -54 -13 -44"
      fill="none"
      stroke="#fff"
      strokeWidth={6}
      strokeLinecap="round"
      opacity={shine}
    />
  </g>
);

/** Diabinho vermelho com chifres, rabo e sorrisão, erguendo o troféu; pés em (0,0). */
const Diabinho: React.FC<{accent: string; highlight: string; t: number; laugh: number; pump: number}> = ({
  accent,
  highlight,
  t,
  laugh,
  pump,
}) => {
  const wag = Math.sin(t * 0.3) * 10;
  const tip = {x: -98 + wag, y: -98};
  const tail = `M -30 -30 C -78 -18 ${(-106 + wag * 0.5).toFixed(1)} -52 ${P(tip)}`;
  const hand = {x: 88, y: -196 + pump};
  const elbow = {x: 66, y: -140 + pump * 0.5};
  const open = 13 + 12 * laugh;
  const shine = 0.55 + 0.45 * Math.sin(t * 0.5);
  const glow = 0.55 + 0.3 * Math.sin(t * 0.4);
  return (
    <g>
      {/* brilho do troféu (atrás de tudo) */}
      <circle cx={hand.x} cy={hand.y - 66} r={96} fill="url(#cdg-trophy)" opacity={glow} />
      {/* rabo com ponta de flecha */}
      <path d={tail} fill="none" stroke={INK} strokeWidth={22} strokeLinecap="round" />
      <path d={tail} fill="none" stroke={accent} strokeWidth={9} strokeLinecap="round" />
      <path
        d={`M ${tip.x.toFixed(1)} ${tip.y - 26} L ${(tip.x + 18).toFixed(1)} ${tip.y + 6} Q ${tip.x.toFixed(1)} ${tip.y - 2} ${(tip.x - 18).toFixed(1)} ${tip.y + 6} Z`}
        fill={accent}
        stroke={INK}
        strokeWidth={6}
        strokeLinejoin="round"
      />
      {/* pezinhos */}
      <ellipse cx={-24} cy={-8} rx={22} ry={11} fill={INK} />
      <ellipse cx={24} cy={-8} rx={22} ry={11} fill={INK} />
      {/* corpo */}
      <path
        d="M -46 -18 C -54 -52 -44 -94 -22 -108 Q 0 -116 22 -108 C 44 -94 54 -52 46 -18 Q 0 -6 -46 -18 Z"
        fill={accent}
        stroke={INK}
        strokeWidth={7}
        strokeLinejoin="round"
      />
      <ellipse cx={0} cy={-56} rx={24} ry={28} fill="#fff" opacity={0.2} />
      {/* braço na cintura */}
      <Stroke pts={[{x: -36, y: -88}, {x: -70, y: -68}, {x: -44, y: -44}]} w={16} color={accent} />
      <circle cx={-44} cy={-44} r={11} fill={accent} stroke={INK} strokeWidth={6} />
      {/* orelhas e chifres */}
      <path d="M -40 -152 L -72 -166 L -46 -126 Z" fill={accent} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
      <path d="M 40 -152 L 72 -166 L 46 -126 Z" fill={accent} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
      <path
        d="M -26 -178 C -44 -188 -54 -212 -44 -234 C -34 -214 -20 -204 -6 -186 Z"
        fill={HORN}
        stroke={INK}
        strokeWidth={6}
        strokeLinejoin="round"
      />
      <path
        d="M 26 -178 C 44 -188 54 -212 44 -234 C 34 -214 20 -204 6 -186 Z"
        fill={HORN}
        stroke={INK}
        strokeWidth={6}
        strokeLinejoin="round"
      />
      {/* cabeça */}
      <circle cx={0} cy={-142} r={46} fill={accent} stroke={INK} strokeWidth={7} />
      <path d="M -34 -174 L -8 -161 M 34 -174 L 8 -161" stroke={INK} strokeWidth={7} strokeLinecap="round" />
      <ellipse cx={-17} cy={-148} rx={11} ry={12} fill="#fff" stroke={INK} strokeWidth={5} />
      <ellipse cx={17} cy={-148} rx={11} ry={12} fill="#fff" stroke={INK} strokeWidth={5} />
      <circle cx={-14} cy={-146} r={5.5} fill={INK} />
      <circle cx={20} cy={-146} r={5.5} fill={INK} />
      {/* sorrisão (abre e fecha rindo) */}
      <path
        d={`M -28 -126 Q 0 ${(-126 + open * 2).toFixed(1)} 28 -126 Q 0 -120 -28 -126 Z`}
        fill={MOUTH}
        stroke={INK}
        strokeWidth={5}
        strokeLinejoin="round"
      />
      <path d="M -19 -124 L -11 -124 L -15 -117 Z M 19 -124 L 11 -124 L 15 -117 Z" fill="#fff" />
      <path d="M -9 -100 L 0 -80 L 9 -100 Z" fill={INK} />
      {/* braço erguido com o troféu */}
      <Stroke pts={[{x: 34, y: -90}, elbow, hand]} w={16} color={accent} />
      <g transform={`translate(${P(hand)}) rotate(${(Math.sin(t * 0.3) * 6).toFixed(2)})`}>
        <Trofeu highlight={highlight} shine={shine} />
        {SPARKS.map(([sx, sy, r], k) => {
          const tw = Math.max(0, Math.sin(t * 0.35 + k * 2.1));
          return tw > 0.02 ? (
            <path
              key={k}
              d={sparkle(r)}
              transform={`translate(${sx} ${sy}) scale(${tw.toFixed(3)})`}
              fill="#fff"
              stroke={INK}
              strokeWidth={3}
              strokeLinejoin="round"
            />
          ) : null;
        })}
      </g>
      <circle cx={hand.x} cy={hand.y} r={12} fill={accent} stroke={INK} strokeWidth={6} />
    </g>
  );
};

export const CaboDeGuerra: React.FC<
  SceneProps & {
    esquerda?: string;
    direita?: string;
    label?: string;
    labelAt?: number;
    vencedor?: string;
    vencedorAt?: number;
  }
> = ({esquerda = '', direita = '', label = '', labelAt = 0.2, vencedor = 'O diabo', vencedorAt = 2.9, accent, highlight}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const breakF = Math.round(vencedorAt * fps);
  const pullStartF = Math.round(0.45 * fps);
  const pullEndF = Math.max(breakF, pullStartF + 1);
  const tB = frame - breakF;
  const broken = tB >= 0;

  // Entrada: chão e corda que se estica (começa frouxa).
  const groundIn = spring({frame, fps, config: {damping: 14}});
  const ropeIn = spring({frame: frame - 9, fps, config: {damping: 11, stiffness: 150}});
  const ropeOp = interpolate(ropeIn, [0, 0.25], [0, 1], CLAMP);

  // Puxa-puxa: oscilação com amplitude crescente, ancorada para zerar no estouro.
  const ramp = interpolate(frame, [pullStartF - 8, pullStartF], [0, 1], {...CLAMP, easing: Easing.inOut(Easing.quad)});
  const amp = interpolate(frame, [pullStartF, pullEndF], [4, 28], {...CLAMP, easing: Easing.in(Easing.quad)}) * ramp;
  const ph = (breakF - frame) * OMEGA;
  const sway = broken ? 0 : (amp * (Math.sin(ph) + 0.3 * Math.sin(ph * 2.6))) / 1.3;

  // Estouro: as pontas recuam e os grupos caem sentados para trás.
  const snap = spring({frame: tB, fps, config: {damping: 10, stiffness: 220}});
  const fall = spring({frame: tB, fps, config: {damping: 11, stiffness: 150}});
  const effort = ramp * Math.max(0, 1 - fall);
  const scared = fall > 0.35;
  const legA = lerp(PULL.legA, FALL.legA, fall);
  const hipH = lerp(PULL.hipH, FALL.hipH, fall);
  const hand = lerpPt(PULL.hand, FALL.hand, fall);

  const makeTeam = (d: number, ti: number, shirt: string, dark: string): Fig[] =>
    [0, 1, 2].map((j) => {
      const enter = spring({frame: frame - j * 3 - ti * 2, fps, config: {damping: 14, stiffness: 160}});
      const jitter = Math.sin(frame * 0.55 + j * 1.9 + ti * 1.3) * 3.5 * effort;
      const body = bodyOf(legA, lerp(PULL.bodyA, FALL.bodyA, fall) + jitter, hand);
      const x = CX - d * (FRONT_GAP + j * SPACING + (1 - enter) * 560 + RECOIL * fall) + sway;
      const y = GROUND - hipH * S;
      const toWorld = (p: Pt): Pt => ({x: x + d * S * p.x, y: y + S * p.y});
      return {key: `${ti}-${j}`, d, j, x, y, body, hand: toWorld(body.hand), head: toWorld(body.head), shirt, dark};
    });
  const left = makeTeam(1, 0, BLUE, BLUE_DARK);
  const right = makeTeam(-1, 1, GREEN, GREEN_DARK);
  const all = [...left, ...right];
  const drawOrder = [left[2], left[1], left[0], right[2], right[1], right[0]];

  // Corda inteira: rabicho → mãos de um time → meio (com folga na entrada) → mãos do outro → rabicho.
  const tailOf = (back: Pt, d: number) => ({
    end: {x: back.x - d * 62, y: back.y + 38},
    ctrl: {x: back.x - d * 44, y: back.y},
  });
  const tL = tailOf(left[2].hand, 1);
  const tR = tailOf(right[2].hand, -1);
  const fl = left[0].hand;
  const fr = right[0].hand;
  const sag = (1 - ropeIn) * 80;
  const mid = {x: (fl.x + fr.x) / 2, y: (fl.y + fr.y) / 2};
  const fullRope = `M ${P(tL.end)} Q ${P(tL.ctrl)} ${P(left[2].hand)} L ${P(fl)} Q ${P({x: mid.x, y: mid.y + sag * 2})} ${P(fr)} L ${P(right[2].hand)} Q ${P(tR.ctrl)} ${P(tR.end)}`;

  // Metades depois do estouro: a ponta solta recua do centro e despenca na frente de cada time.
  const frayIn = interpolate(tB, [0, 4], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});
  const halves = [left, right].map((team) => {
    const d = team[0].d;
    const front = team[0].hand;
    const tail = tailOf(team[2].hand, d);
    const start = {x: CX - d * 4, y: ROPE_Y};
    const free = lerpPt(start, {x: front.x + d * 62, y: front.y + 58}, snap);
    const ctrl = lerpPt(lerpPt(front, start, 0.5), {x: front.x + d * 46, y: front.y + 4}, snap);
    return {
      key: team[0].key,
      path: `M ${P(tail.end)} Q ${P(tail.ctrl)} ${P(team[2].hand)} L ${P(front)} Q ${P(ctrl)} ${P(free)}`,
      free,
      ang: Math.atan2(free.y - ctrl.y, free.x - ctrl.x),
    };
  });

  // Lenço do meio: balança na corda; no estouro despenca e some.
  const kPos = broken
    ? {x: CX, y: ROPE_Y + interpolate(tB, [0, 12], [0, 110], {...CLAMP, easing: Easing.in(Easing.quad)})}
    : {x: mid.x, y: mid.y + sag};
  const kRot = broken
    ? interpolate(tB, [0, 12], [0, 100], {...CLAMP, easing: Easing.in(Easing.quad)})
    : Math.sin(frame * 0.35) * 8 - sway * 0.5;
  const kOp = (broken ? interpolate(tB, [5, 12], [1, 0], CLAMP) : 1) * ropeOp;

  // Estalo + clarão.
  const burst = interpolate(tB, [0, 8], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
  const burstOp = interpolate(tB, [0, 9], [1, 0], {...CLAMP, easing: Easing.in(Easing.quad)});
  const flashR =
    interpolate(tB, [0, 8], [30, 230], {...CLAMP, easing: Easing.out(Easing.cubic)}) * (1 + 0.04 * Math.sin(frame * 0.3));
  const flashOp = interpolate(tB, [0, 3, 14, 24], [0, 1, 0.6, 0.45], CLAMP);

  // Diabinho: sobe com spring de escala, depois balança e ri.
  const rise = spring({frame: tB - 2, fps, config: {damping: 9, stiffness: 130}});
  const settle = interpolate(tB, [10, 18], [0, 1], {...CLAMP, easing: Easing.inOut(Easing.quad)});
  const dSway = Math.sin(tB * 0.25) * 5 * settle;
  const bounce = -Math.abs(Math.sin(tB * 0.42)) * 9 * settle;
  const laugh = 0.5 - 0.5 * Math.cos(tB * 0.84);

  // Faixa do vencedor.
  const vIn = spring({frame: tB - 6, fps, config: {damping: 10, stiffness: 170}});
  const vTxt = vencedor.toUpperCase();
  const vFont = Math.max(30, Math.min(54, Math.floor(600 / Math.max(1, vTxt.length * 0.68))));
  const vW = Math.min(720, vTxt.length * vFont * 0.68 + 64);
  const vH = vFont + 18;
  const ribbonTail = (sx: number) => {
    const a = vW / 2 - 16;
    const b = vW / 2 + 46;
    const c = vW / 2 + 28;
    return `M ${sx * a} ${-vH / 2 + 10} L ${sx * b} ${-vH / 2 + 10} L ${sx * c} 10 L ${sx * b} ${vH / 2 + 10} L ${sx * a} ${vH / 2 + 10} Z`;
  };

  const labelIn = spring({frame: frame - Math.round(labelAt * fps), fps, config: {damping: 10}});
  const labelFont = Math.max(48, Math.min(80, Math.floor(1220 / Math.max(1, label.length))));

  return (
    <AbsoluteFill style={{fontFamily: FONT, alignItems: 'center'}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        <defs>
          <radialGradient id="cdg-flash">
            <stop offset="0%" stopColor={highlight} stopOpacity={0.95} />
            <stop offset="45%" stopColor={accent} stopOpacity={0.45} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="cdg-trophy">
            <stop offset="0%" stopColor={highlight} stopOpacity={0.85} />
            <stop offset="100%" stopColor={highlight} stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* chão */}
        <ellipse cx={CX} cy={GROUND + 8} rx={430 * groundIn} ry={30} fill="#000" opacity={0.3} />

        {/* clarão atrás do diabinho */}
        {broken ? (
          <circle cx={CX} cy={GROUND - 160 * DEVIL_S} r={flashR} fill="url(#cdg-flash)" opacity={flashOp} />
        ) : null}

        {/* corda */}
        {!broken ? (
          <g opacity={ropeOp}>
            <Rope d={fullRope} />
          </g>
        ) : (
          halves.map((h) => (
            <g key={h.key}>
              <Rope d={h.path} />
              {[-0.55, 0, 0.55].map((da, k) => {
                const a = h.ang + da;
                const e = {x: h.free.x + Math.cos(a) * 16 * frayIn, y: h.free.y + Math.sin(a) * 16 * frayIn};
                return (
                  <path key={k} d={`M ${P(h.free)} L ${P(e)}`} stroke={ROPE_DARK} strokeWidth={5} strokeLinecap="round" />
                );
              })}
            </g>
          ))
        )}

        {/* bonequinhos */}
        {drawOrder.map((f) => (
          <g key={f.key} transform={`translate(${P({x: f.x, y: f.y})}) scale(${f.d * S} ${S})`}>
            <Puller b={f.body} shirt={f.shirt} dark={f.dark} scared={scared} />
          </g>
        ))}

        {/* lenço do meio da corda */}
        {kOp > 0.01 ? (
          <g
            transform={`translate(${P(kPos)}) rotate(${kRot.toFixed(1)}) scale(${Math.max(0, ropeIn).toFixed(3)})`}
            opacity={kOp}
          >
            <path d="M -22 -2 L 22 -2 L 0 52 Z" fill={highlight} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
            <circle r={9} fill={highlight} stroke={INK} strokeWidth={5} />
          </g>
        ) : null}

        {/* estalo da corda */}
        {broken && tB <= 9 ? (
          <g transform={`translate(${CX} ${ROPE_Y.toFixed(1)})`} opacity={burstOp}>
            {Array.from({length: 8}).map((_, i) => {
              const a = (i * Math.PI) / 4 + 0.39;
              const r0 = 18 + 30 * burst;
              const r1 = 44 + 62 * burst;
              const d = `M ${(Math.cos(a) * r0).toFixed(1)} ${(Math.sin(a) * r0).toFixed(1)} L ${(Math.cos(a) * r1).toFixed(1)} ${(Math.sin(a) * r1).toFixed(1)}`;
              return (
                <g key={i}>
                  <path d={d} stroke={INK} strokeWidth={15} strokeLinecap="round" />
                  <path d={d} stroke={highlight} strokeWidth={7} strokeLinecap="round" />
                </g>
              );
            })}
          </g>
        ) : null}

        {/* poeira da queda */}
        {broken
          ? all.map((f) => {
              const pt = tB - 4 - f.j * 2;
              if (pt < 0 || pt > 20) return null;
              const grow = spring({frame: pt, fps, config: {damping: 15, stiffness: 180}});
              const op = interpolate(pt, [0, 3, 20], [0, 0.95, 0], CLAMP);
              const drift = interpolate(pt, [0, 20], [0, 34], {...CLAMP, easing: Easing.out(Easing.quad)});
              const px = f.x - f.d * (12 + drift);
              const py = GROUND - 14 - drift * 0.4;
              const sc = grow * (0.7 + f.j * 0.12);
              return (
                <g key={`p${f.key}`} transform={`translate(${P({x: px, y: py})}) scale(${sc.toFixed(3)})`} opacity={op}>
                  {PUFFS.map(([x, y, r], k) => (
                    <circle key={`o${k}`} cx={x} cy={y} r={r + 5} fill={INK} />
                  ))}
                  {PUFFS.map(([x, y, r], k) => (
                    <circle key={`i${k}`} cx={x} cy={y} r={r} fill={DUST} />
                  ))}
                </g>
              );
            })
          : null}

        {/* diabinho com o troféu */}
        {tB >= 2 ? (
          <g>
            <ellipse
              cx={CX}
              cy={GROUND + 4}
              rx={96 * Math.min(1, Math.max(0, rise)) * (1 + bounce / 90)}
              ry={15}
              fill="#000"
              opacity={0.35}
            />
            <g
              transform={`translate(${CX} ${(GROUND + (1 - rise) * 70 + bounce).toFixed(1)}) rotate(${dSway.toFixed(2)}) scale(${(DEVIL_S * Math.max(0, rise)).toFixed(3)})`}
            >
              <Diabinho accent={accent} highlight={highlight} t={tB} laugh={laugh} pump={bounce * 0.8} />
            </g>
          </g>
        ) : null}

        {/* gotinhas de suor */}
        {!broken
          ? Array.from({length: DROPS}).map((_, i) => {
              const span = Math.max(1, pullEndF - pullStartF - DROP_LIFE);
              const start = pullStartF + 2 + Math.floor((i * span) / DROPS + rand(i + 1) * 4);
              const t = frame - start;
              if (t < 0 || t > DROP_LIFE) return null;
              const team = i % 2 === 0 ? left : right;
              const f = team[Math.floor(rand(i * 7.3 + 2) * 3)];
              const q = t / DROP_LIFE;
              const qx = Easing.out(Easing.quad)(q);
              const spread = 0.6 + rand(i * 3.7 + 5) * 0.8;
              const x = f.head.x - f.d * (12 + 40 * qx * spread);
              const y = f.head.y - 30 - 90 * q + 100 * q * q;
              const pop = interpolate(t, [0, 3], [0.3, 1], {...CLAMP, easing: Easing.out(Easing.back(2))});
              const op = interpolate(t, [0, 2, DROP_LIFE - 4, DROP_LIFE], [0, 1, 1, 0], CLAMP);
              return (
                <g
                  key={`s${i}`}
                  transform={`translate(${P({x, y})}) rotate(${-f.d * 25}) scale(${pop.toFixed(3)})`}
                  opacity={op}
                >
                  <path d={DROP_PATH} fill={SWEAT} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
                </g>
              );
            })
          : null}

        {/* rótulos dos grupos */}
        {[
          {txt: esquerda, team: left, delay: 12},
          {txt: direita, team: right, delay: 15},
        ].map(({txt, team, delay}, i) => {
          if (!txt) return null;
          const pin = spring({frame: frame - delay, fps, config: {damping: 11, stiffness: 170}});
          const cxT = (team[0].x + team[1].x + team[2].x) / 3;
          const T = txt.toUpperCase();
          const fs = Math.max(24, Math.min(36, Math.floor(300 / Math.max(1, T.length * 0.66))));
          const w = Math.min(380, T.length * fs * 0.68 + 44);
          const h = fs + 22;
          return (
            <g key={i} transform={`translate(${cxT.toFixed(1)} ${PILL_Y}) scale(${pin.toFixed(3)})`}>
              <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} fill={INK} stroke={team[0].shirt} strokeWidth={5} />
              <text x={0} y={fs * 0.36} textAnchor="middle" fontFamily={FONT} fontWeight={900} fontSize={fs} fill="#fff">
                {T}
              </text>
            </g>
          );
        })}

        {/* faixa do vencedor */}
        {vTxt && tB >= 6 ? (
          <g transform={`translate(${CX} ${RIBBON_Y}) rotate(-2) scale(${vIn.toFixed(3)})`}>
            {[-1, 1].map((sx) => (
              <g key={sx}>
                <path d={ribbonTail(sx)} fill={accent} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
                <path d={ribbonTail(sx)} fill="#000" opacity={0.3} />
              </g>
            ))}
            <rect x={-vW / 2} y={-vH / 2} width={vW} height={vH} rx={10} fill={accent} stroke={INK} strokeWidth={7} />
            <text
              x={0}
              y={vFont * 0.35}
              textAnchor="middle"
              fontFamily={FONT}
              fontWeight={900}
              fontSize={vFont}
              fill="#fff"
              stroke={INK}
              strokeWidth={6}
              strokeLinejoin="round"
              paintOrder="stroke"
            >
              {vTxt}
            </text>
          </g>
        ) : null}
      </svg>
      {label ? (
        <div
          style={{
            position: 'absolute',
            top: 30,
            padding: '0 30px',
            fontWeight: 900,
            fontSize: labelFont,
            lineHeight: 1,
            color: accent,
            textTransform: 'uppercase',
            textAlign: 'center',
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
