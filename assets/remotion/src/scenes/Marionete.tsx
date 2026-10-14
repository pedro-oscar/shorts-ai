import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * "Estava como se fosse um robô... só um boneco ali": homem-marionete. Entra de pé, a cruzeta de
 * madeira desce, os fios se esticam até cabeça, mãos e joelhos, o olhar fica vazio e ele passa a
 * mudar de pose aos trancos, como quem só obedece a um comando.
 */

const SKIN = '#e8b384';
const SKIN_DARK = '#c98f5e';
const INK = '#1d130d';
const WOOD = '#5c3b22';
const WOOD_LIGHT = '#7d5434';
const PANTS = '#3b2a20';
const EYE = '#e4ecf1';
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const CX = 470;
const GROUND = 712;
const NECK = {x: CX, y: 368};
const SHOULDER_L = {x: 404, y: 392};
const SHOULDER_R = {x: 536, y: 392};
const HIP_L = {x: 446, y: 520};
const HIP_R = {x: 494, y: 520};
const UPPER = 82;
const FORE = 76;
const THIGH = 88;
const SHIN = 86;

type Pt = {x: number; y: number};

/** Ângulos em graus a partir da vertical para baixo (positivo = para a direita da tela). */
type Pose = {
  lu: number;
  lf: number;
  ru: number;
  rf: number;
  lt: number;
  ls: number;
  rt: number;
  rs: number;
  head: number;
  rock: number;
  lift: number;
};

const REST: Pose = {lu: -12, lf: -6, ru: 12, rf: 6, lt: -3, ls: -1, rt: 3, rs: 1, head: 0, rock: 0, lift: 0};
// braço esquerdo em "L" para cima, joelho esquerdo puxado
const POSE_A: Pose = {lu: -100, lf: -175, ru: 18, rf: 32, lt: -40, ls: -6, rt: 4, rs: 2, head: -9, rock: 7, lift: -12};
// espelho do A
const POSE_B: Pose = {lu: -18, lf: -32, ru: 100, rf: 175, lt: -4, ls: -2, rt: 40, rs: 6, head: 9, rock: -7, lift: -12};
// "espantalho": braços abertos, antebraços caídos, pernas duras
const POSE_C: Pose = {lu: -88, lf: -8, ru: 88, rf: 8, lt: -6, ls: -2, rt: 6, rs: 2, head: 0, rock: 0, lift: -18};
const SEQ: Pose[] = [POSE_A, POSE_B, POSE_A, POSE_C];

const lerpPose = (a: Pose, b: Pose, t: number): Pose => {
  const out = {...a};
  (Object.keys(a) as (keyof Pose)[]).forEach((k) => {
    out[k] = a[k] + (b[k] - a[k]) * t;
  });
  return out;
};

const seg = (p: Pt, len: number, deg: number): Pt => {
  const r = (deg * Math.PI) / 180;
  return {x: p.x + Math.sin(r) * len, y: p.y + Math.cos(r) * len};
};

/** Rotação no sentido do `rotate()` do SVG (horário na tela). */
const rotAround = (p: Pt, c: Pt, deg: number): Pt => {
  const r = (deg * Math.PI) / 180;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return {x: c.x + dx * Math.cos(r) - dy * Math.sin(r), y: c.y + dx * Math.sin(r) + dy * Math.cos(r)};
};

const Limb: React.FC<{a: Pt; b: Pt; w: number; color: string}> = ({a, b, w, color}) => (
  <g>
    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={INK} strokeWidth={w + 16} strokeLinecap="round" />
    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={w} strokeLinecap="round" />
  </g>
);

const Pin: React.FC<{p: Pt}> = ({p}) => <circle cx={p.x} cy={p.y} r={6} fill={SKIN_DARK} stroke={INK} strokeWidth={3} />;

const Head: React.FC<{empty: number; accent: string}> = ({empty, accent}) => {
  const eyeR = 15 + 3 * empty;
  const pupilR = Math.max(0, 9 * (1 - empty));
  const flat = empty > 0.5;
  return (
    <g>
      <circle cx={-60} cy={6} r={14} fill={SKIN} stroke={INK} strokeWidth={7} />
      <circle cx={60} cy={6} r={14} fill={SKIN} stroke={INK} strokeWidth={7} />
      <circle r={60} fill={SKIN} stroke={INK} strokeWidth={9} />
      <path
        d="M -58 -10 C -64 -52 -34 -72 0 -72 C 34 -72 64 -52 58 -10 C 42 -30 22 -36 0 -34 C -22 -36 -42 -30 -58 -10 Z"
        fill={WOOD}
        stroke={INK}
        strokeWidth={7}
        strokeLinejoin="round"
      />
      <path d="M -34 -20 L -12 -18 M 12 -18 L 34 -20" stroke={INK} strokeWidth={7} strokeLinecap="round" />
      {[-22, 22].map((x) => (
        <g key={x} transform={`translate(${x} 4)`}>
          <circle r={eyeR} fill={EYE} stroke={INK} strokeWidth={6} />
          {pupilR > 0.2 ? <circle cx={x > 0 ? -2 : 2} cy={2} r={pupilR} fill={INK} /> : null}
          <circle cx={-5} cy={-6} r={4.5} fill="#fff" />
        </g>
      ))}
      <ellipse cx={-38} cy={26} rx={11} ry={7} fill={accent} opacity={0.35} />
      <ellipse cx={38} cy={26} rx={11} ry={7} fill={accent} opacity={0.35} />
      <circle cx={0} cy={18} r={6} fill={SKIN_DARK} />
      {flat ? (
        <path d="M -16 34 L 16 34" stroke={INK} strokeWidth={7} strokeLinecap="round" />
      ) : (
        <path d="M -16 30 Q 0 42 16 30" fill="none" stroke={INK} strokeWidth={7} strokeLinecap="round" />
      )}
      {/* linhas de "queixo de boneco" */}
      <path
        d="M -16 34 L -16 52 M 16 34 L 16 52"
        stroke={INK}
        strokeWidth={4}
        strokeLinecap="round"
        opacity={Math.min(1, Math.max(0, empty)) * 0.8}
      />
    </g>
  );
};

export const Marionete: React.FC<SceneProps & {label?: string; fiosAt?: number; labelAt?: number}> = ({
  label = 'Só um comando',
  fiosAt = 0.6,
  labelAt = 2.2,
  accent,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fiosF = Math.round(fiosAt * fps);

  // Entrada escalonada: sombra → corpo → cabeça.
  const shadowIn = spring({frame, fps, config: {damping: 14}});
  const enter = spring({frame: frame - 2, fps, config: {damping: 12, stiffness: 150}});
  const headIn = spring({frame: frame - 5, fps, config: {damping: 9, stiffness: 180}});
  const labelIn = spring({frame: frame - labelAt * fps, fps, config: {damping: 10}});

  // Cruzeta desce, fios esticam, olhar esvazia.
  const cruzIn = spring({frame: frame - fiosF, fps, config: {damping: 13, stiffness: 160}});
  const cruzY = interpolate(cruzIn, [0, 1], [-140, 152]);
  const empty = spring({frame: frame - (fiosF + 14), fps, config: {damping: 14, stiffness: 200}});

  // Movimento robótico: troca de pose a cada 0,5 s, com spring rápido e duro (sem balanço contínuo).
  const stepStart = fiosF + Math.round(0.55 * fps);
  const stepF = Math.round(0.5 * fps);
  const k = frame >= stepStart ? Math.floor((frame - stepStart) / stepF) : -1;
  const tStep = k >= 0 ? frame - (stepStart + k * stepF) : -1;
  const snap = k >= 0 ? spring({frame: tStep, fps, config: {stiffness: 520, damping: 24, mass: 0.6}}) : 0;
  const from = k <= 0 ? REST : SEQ[(k - 1) % SEQ.length];
  const to = k < 0 ? REST : SEQ[k % SEQ.length];
  const pose = lerpPose(from, to, snap);
  const jerkOp = k >= 0 ? interpolate(tStep, [0, 1, 7], [0, 1, 0], CLAMP) : 0;

  // Esqueleto (coordenadas locais do corpo).
  const elbowL = seg(SHOULDER_L, UPPER, pose.lu);
  const handL = seg(elbowL, FORE, pose.lf);
  const elbowR = seg(SHOULDER_R, UPPER, pose.ru);
  const handR = seg(elbowR, FORE, pose.rf);
  const kneeL = seg(HIP_L, THIGH, pose.lt);
  const footL = seg(kneeL, SHIN, pose.ls);
  const kneeR = seg(HIP_R, THIGH, pose.rt);
  const footR = seg(kneeR, SHIN, pose.rs);

  // Local do corpo → mundo (escala de entrada a partir dos pés + elevação pelos fios).
  const toWorld = (p: Pt): Pt => ({
    x: CX + (p.x - CX) * enter,
    y: GROUND + (p.y + pose.lift - GROUND) * enter,
  });
  const cruzPt = (lx: number, ly: number): Pt => {
    const p = rotAround({x: lx, y: ly}, {x: 0, y: 0}, pose.rock);
    return {x: CX + p.x, y: cruzY + p.y};
  };
  const headTop = toWorld(rotAround({x: CX, y: NECK.y - 132 * headIn}, NECK, pose.head));

  const strings = [
    {a: cruzPt(0, 34), b: headTop},
    {a: cruzPt(-172, 13), b: toWorld(handL)},
    {a: cruzPt(172, 13), b: toWorld(handR)},
    {a: cruzPt(-75, 36), b: toWorld(kneeL)},
    {a: cruzPt(75, 36), b: toWorld(kneeR)},
  ];

  const shadowRx = 190 * shadowIn * (1 + pose.lift / 120);

  return (
    <AbsoluteFill style={{fontFamily: FONT, alignItems: 'center'}}>
      <svg width="100%" height="100%" viewBox="0 0 940 760">
        <ellipse cx={CX} cy={GROUND} rx={Math.max(0, shadowRx)} ry={26} fill="#000" opacity={0.35} />

        {/* boneco */}
        <g transform={`translate(${CX} ${GROUND}) scale(${enter}) translate(${-CX} ${-GROUND}) translate(0 ${pose.lift})`}>
          {/* pernas */}
          <Limb a={HIP_L} b={kneeL} w={40} color={PANTS} />
          <Limb a={kneeL} b={footL} w={34} color={PANTS} />
          <Limb a={HIP_R} b={kneeR} w={40} color={PANTS} />
          <Limb a={kneeR} b={footR} w={34} color={PANTS} />
          <ellipse cx={footL.x - 8} cy={footL.y + 6} rx={28} ry={13} fill={INK} />
          <ellipse cx={footR.x + 8} cy={footR.y + 6} rx={28} ry={13} fill={INK} />
          <Pin p={kneeL} />
          <Pin p={kneeR} />

          {/* quadril + tronco */}
          <path d="M 414 500 L 526 500 L 530 528 Q 470 538 410 528 Z" fill={PANTS} stroke={INK} strokeWidth={8} strokeLinejoin="round" />
          <rect x={452} y={346} width={36} height={36} fill={SKIN_DARK} stroke={INK} strokeWidth={8} />
          <path
            d="M 404 378 Q 470 362 536 378 L 528 512 Q 470 522 412 512 Z"
            fill={accent}
            stroke={INK}
            strokeWidth={9}
            strokeLinejoin="round"
          />
          <path d="M 446 371 L 470 400 L 494 371 Z" fill={SKIN} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
          <circle cx={470} cy={432} r={5} fill={INK} />
          <circle cx={470} cy={466} r={5} fill={INK} />

          {/* braços em segmentos */}
          <Limb a={SHOULDER_L} b={elbowL} w={34} color={accent} />
          <Limb a={elbowL} b={handL} w={26} color={SKIN} />
          <Limb a={SHOULDER_R} b={elbowR} w={34} color={accent} />
          <Limb a={elbowR} b={handR} w={26} color={SKIN} />
          <circle cx={handL.x} cy={handL.y} r={19} fill={SKIN} stroke={INK} strokeWidth={7} />
          <circle cx={handR.x} cy={handR.y} r={19} fill={SKIN} stroke={INK} strokeWidth={7} />
          <Pin p={elbowL} />
          <Pin p={elbowR} />

          {/* cabeça */}
          <g transform={`rotate(${pose.head} ${NECK.x} ${NECK.y}) translate(${NECK.x} ${NECK.y}) scale(${headIn}) translate(0 -60)`}>
            <Head empty={empty} accent={accent} />
          </g>
        </g>

        {/* fios */}
        {strings.map((s, i) => {
          const st = Math.min(1, spring({frame: frame - fiosF - 10 - i * 2, fps, config: {damping: 20, stiffness: 200}}));
          if (st <= 0.001) return null;
          const end = {x: s.a.x + (s.b.x - s.a.x) * st, y: s.a.y + (s.b.y - s.a.y) * st};
          return (
            <g key={i}>
              <line x1={s.a.x} y1={s.a.y} x2={end.x} y2={end.y} stroke={INK} strokeWidth={7} strokeLinecap="round" opacity={0.3} />
              <line x1={s.a.x} y1={s.a.y} x2={end.x} y2={end.y} stroke="#fff" strokeWidth={3.5} strokeLinecap="round" />
              {st > 0.95 ? <circle cx={end.x} cy={end.y} r={5} fill="#fff" stroke={INK} strokeWidth={2} /> : null}
            </g>
          );
        })}

        {/* cruzeta de controle */}
        <g transform={`translate(${CX} ${cruzY}) rotate(${pose.rock})`}>
          <g opacity={jerkOp}>
            {[-1, 1].map((sd) => {
              const d = `M ${sd * 200} -22 L ${sd * 226} -38 M ${sd * 206} 0 L ${sd * 238} 0 M ${sd * 200} 22 L ${sd * 226} 38`;
              return (
                <g key={sd}>
                  <path d={d} stroke={INK} strokeWidth={13} strokeLinecap="round" />
                  <path d={d} stroke={highlight} strokeWidth={7} strokeLinecap="round" />
                </g>
              );
            })}
          </g>
          <rect x={-12} y={-34} width={24} height={68} rx={8} fill={WOOD} stroke={INK} strokeWidth={7} />
          <rect x={-185} y={-13} width={370} height={26} rx={10} fill={WOOD} stroke={INK} strokeWidth={7} />
          <rect x={-88} y={20} width={176} height={20} rx={9} fill={WOOD} stroke={INK} strokeWidth={7} />
          <path d="M -165 -3 L -30 -3 M 30 -3 L 165 -3 M -70 28 L 70 28" stroke={WOOD_LIGHT} strokeWidth={4} strokeLinecap="round" />
        </g>
      </svg>
      {label ? (
        <div
          style={{
            position: 'absolute',
            top: 30,
            fontWeight: 900,
            fontSize: 80,
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
