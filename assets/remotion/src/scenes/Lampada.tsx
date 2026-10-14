import React from 'react';
import {AbsoluteFill, Easing, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT, outline} from '../theme';
import type {SceneProps} from './types';

/**
 * "Quando você explica o porquê, a pessoa (ou a IA) ganha liberdade para usar a própria cabeça":
 * um balão "Porque…" chega da esquerda (alguém fora de quadro explicando); a pessoa, pensativa
 * (boca reta, sobrancelha torta, "?"), recebe a explicação e a lâmpada acima da cabeça acende:
 * bulbo amarelo com pop, halo, raios que saltam e giram devagar, brilhinhos piscando; o rosto
 * se abre num sorriso de quem entendeu.
 */

const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const INK = '#111';
const SKIN = '#F2C9A0';
const SKIN_DARK = '#DCA57C';
const HAIR = '#3A2A20';
const SHIRT = '#3B5BDB';
const SHIRT_DARK = '#2B47B0';
const BULB_OFF = '#D5DCE4';
const METAL = '#A3ABB5';
const METAL_DARK = '#636C77';
const LIGHT_CORE = '#FFFBE0';
const FILAMENT_OFF = '#7B8491';
const FILAMENT_ON = '#F76707';

// Geometria (caixa 940×760). A lâmpada é desenhada em coordenadas locais com o centro do bulbo em (0, 0).
const LAMP = {x: 610, y: 190};
const HEAD = {x: 610, y: 475, r: 94};
const RAYS = 10;
const BULB_D = 'M -34 78 C -36 54 -66 36 -66 -2 A 66 66 0 1 1 66 -2 C 66 36 36 54 34 78 Z';
const HAIR_D =
  'M 514 470 C 502 392 548 366 610 366 C 672 366 718 392 706 470 ' +
  'C 700 440 690 418 676 404 C 640 412 584 410 548 398 C 532 416 520 442 514 470 Z';
const SHIRT_D = 'M 410 720 C 414 652 482 614 560 604 Q 610 640 660 604 C 738 614 806 652 810 720 Z';

// Balão de fala vindo da esquerda: o rabicho aponta para fora da caixa (quem fala está fora de quadro).
const BALLOON_D =
  'M 88 330 H 372 Q 420 330 420 378 V 452 Q 420 500 372 500 H 196 L -12 588 L 124 500 H 88 ' +
  'Q 40 500 40 452 V 378 Q 40 330 88 330 Z';
const TAIL_TIP = {x: -12, y: 588};

const SPARKLE = 'M 0 -22 Q 4 -4 22 0 Q 4 4 0 22 Q -4 4 -22 0 Q -4 -4 0 -22 Z';
// Brilhinhos em volta do bulbo (relativos ao centro da lâmpada).
const SPARKLES = [
  {x: -150, y: -98, s: 1},
  {x: 158, y: -124, s: 0.85},
  {x: 178, y: 62, s: 0.95},
  {x: -172, y: 58, s: 0.75},
];

const balaoSize = (s: string) => (s.length <= 9 ? 64 : s.length <= 14 ? 54 : s.length <= 24 ? 46 : 40);

export const Lampada: React.FC<
  SceneProps & {balao?: string; balaoAt?: number; acenderAt?: number; label?: string; labelAt?: number}
> = ({balao = '', balaoAt = 0.1, acenderAt = 0.6, label = 'Usa a cabeça', labelAt = 2.0, accent, highlight}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const a = Math.round(acenderAt * fps);
  const b = Math.round(balaoAt * fps);
  const l = Math.round(labelAt * fps);

  // Entrada escalonada: pessoa (0–8) → lâmpada (+5) → "?" → balão (balaoAt).
  const personIn = spring({frame, fps, config: {damping: 15, stiffness: 200}});
  const lampIn = spring({frame: frame - 5, fps, config: {damping: 12, stiffness: 190}});
  const qIn = spring({frame: frame - 9, fps, config: {damping: 10, stiffness: 160}});
  const balloonIn = spring({frame: frame - b, fps, config: {damping: 12, stiffness: 170}});
  const balloonTextIn = spring({frame: frame - b - 3, fps, config: {damping: 11, stiffness: 180}});
  const labelIn = spring({frame: frame - l, fps, config: {damping: 10, stiffness: 150}});

  // Acender: cor rápida, pop do bulbo, halo, raios que saltam e giram, rosto que se abre.
  const isLit = frame >= a;
  const lit = spring({frame: frame - a, fps, config: {damping: 20, stiffness: 320}});
  const litC = Math.min(1, Math.max(0, lit));
  const pop =
    1 + 0.15 * interpolate(frame, [a, a + 4, a + 13], [0, 1, 0], {...CLAMP, easing: Easing.inOut(Easing.quad)});
  const haloP = spring({frame: frame - a, fps, config: {damping: 15, stiffness: 130}});
  const haloOp = interpolate(haloP, [0, 0.4], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});
  const rayP = spring({frame: frame - a - 1, fps, config: {damping: 9, stiffness: 220}});
  const rayOp = interpolate(rayP, [0, 0.25], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});
  const rayRot = Math.max(0, frame - a) * 0.6;
  const faceP = interpolate(frame, [a + 2, a + 11], [0, 1], {...CLAMP, easing: Easing.out(Easing.cubic)});
  const jump = interpolate(frame, [a, a + 5, a + 14], [0, 1, 0], {...CLAMP, easing: Easing.inOut(Easing.quad)});
  const qOut = interpolate(frame, [a, a + 6], [0, 1], {...CLAMP, easing: Easing.in(Easing.quad)});

  // Pessoa
  const personS = interpolate(personIn, [0, 1], [0.8, 1]);
  const personY = interpolate(personIn, [0, 1], [70, 0]) + Math.sin(frame / 14) * 2 - 10 * jump;
  const personOp = interpolate(personIn, [0, 0.4], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});

  // Lâmpada
  const lampY = LAMP.y + interpolate(lampIn, [0, 1], [-90, 0]) + Math.sin(frame / 11) * 4;
  const lampS = interpolate(lampIn, [0, 1], [0.5, 1]) * pop;
  const lampOp = interpolate(lampIn, [0, 0.35], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});
  const bulbFill = interpolateColors(litC, [0, 1], [BULB_OFF, highlight]);
  const filament = interpolateColors(litC, [0, 1], [FILAMENT_OFF, FILAMENT_ON]);

  // Rosto: pensativo → iluminado (paths interpolados).
  const mix = (from: number, to: number) => from + (to - from) * faceP;
  const browL = `M ${mix(552, 550)} ${mix(452, 438)} Q 573 ${mix(446, 420)} ${mix(594, 596)} ${mix(450, 436)}`;
  const browR = `M ${mix(626, 624)} ${mix(452, 436)} Q 647 ${mix(452, 420)} ${mix(668, 670)} ${mix(444, 438)}`;
  const eyeY = mix(487, 480);
  const eyeR = mix(9, 11);
  const mouthD =
    `M ${mix(592, 578)} ${mix(533, 520)} ` + `Q 610 ${mix(531, 558)} ${mix(628, 642)} ${mix(529, 520)}`;

  // Balão
  const balloonS = interpolate(balloonIn, [0, 1], [0.3, 1]);
  const balloonX = interpolate(balloonIn, [0, 1], [-140, 0]);
  const balloonOp = interpolate(balloonIn, [0, 0.25], [0, 1], {...CLAMP, easing: Easing.out(Easing.quad)});

  const labelSize = Math.max(48, Math.min(90, Math.floor(1150 / Math.max(1, label.length))));

  return (
    <AbsoluteFill style={{fontFamily: FONT}}>
      <svg style={{position: 'absolute', inset: 0}} width="100%" height="100%" viewBox="0 0 940 760">
        <defs>
          <radialGradient id="lmp-halo">
            <stop offset="0%" stopColor={highlight} stopOpacity={0.85} />
            <stop offset="45%" stopColor={highlight} stopOpacity={0.32} />
            <stop offset="100%" stopColor={highlight} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="lmp-face" cx="50%" cy="0%" r="90%">
            <stop offset="0%" stopColor={highlight} stopOpacity={0.45} />
            <stop offset="100%" stopColor={highlight} stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* sombra */}
        <ellipse cx={HEAD.x} cy={726} rx={230 * personIn} ry={22} fill="#000" opacity={0.35} />

        {/* halo e raios (atrás de tudo) */}
        {isLit ? (
          <g transform={`translate(${LAMP.x} ${lampY})`}>
            <circle
              r={250 * haloP * (1 + 0.035 * Math.sin((frame - a) * 0.3))}
              fill="url(#lmp-halo)"
              opacity={haloOp}
            />
            {Array.from({length: RAYS}).map((_, i) => {
              const ang = -90 + i * (360 / RAYS) + rayRot;
              // raios que apontam para baixo (rosca e cabeça) somem
              const down = Math.abs(((((ang - 90) % 360) + 540) % 360) - 180);
              const keep = interpolate(down, [28, 62], [0, 1], {...CLAMP, easing: Easing.inOut(Easing.quad)});
              if (keep <= 0.001) return null;
              const ri = interpolate(rayP, [0, 1], [70, 100]);
              const ro = interpolate(rayP, [0, 1], [74, i % 2 === 0 ? 156 : 132]);
              return (
                <g key={i} transform={`rotate(${ang})`} opacity={keep * rayOp}>
                  <line x1={ri} y1={0} x2={ro} y2={0} stroke={INK} strokeWidth={24} strokeLinecap="round" />
                  <line x1={ri} y1={0} x2={ro} y2={0} stroke={highlight} strokeWidth={13} strokeLinecap="round" />
                </g>
              );
            })}
          </g>
        ) : null}

        {/* busto */}
        <g
          opacity={personOp}
          transform={`translate(0 ${personY}) translate(${HEAD.x} 720) scale(${personS}) translate(${-HEAD.x} -720)`}
        >
          <rect x={586} y={548} width={48} height={82} rx={10} fill={SKIN_DARK} stroke={INK} strokeWidth={6} />
          <path d={SHIRT_D} fill={SHIRT} stroke={INK} strokeWidth={7} strokeLinejoin="round" />
          <path d="M 476 662 Q 484 690 482 718" fill="none" stroke={SHIRT_DARK} strokeWidth={6} strokeLinecap="round" />
          <path d="M 744 662 Q 736 690 738 718" fill="none" stroke={SHIRT_DARK} strokeWidth={6} strokeLinecap="round" />

          <ellipse cx={518} cy={490} rx={15} ry={24} fill={SKIN} stroke={INK} strokeWidth={6} />
          <ellipse cx={702} cy={490} rx={15} ry={24} fill={SKIN} stroke={INK} strokeWidth={6} />
          <circle cx={HEAD.x} cy={HEAD.y} r={HEAD.r} fill={SKIN} stroke={INK} strokeWidth={7} />
          <circle cx={HEAD.x} cy={HEAD.y} r={HEAD.r - 4} fill="url(#lmp-face)" opacity={litC} />
          <path d={HAIR_D} fill={HAIR} stroke={INK} strokeWidth={6} strokeLinejoin="round" />

          {/* sobrancelhas */}
          <path d={browL} fill="none" stroke={INK} strokeWidth={9} strokeLinecap="round" />
          <path d={browR} fill="none" stroke={INK} strokeWidth={9} strokeLinecap="round" />

          {/* olhos de ponto (olham para a lâmpada ao acender) */}
          {[574, 646].map((cx) => (
            <g key={cx}>
              <circle cx={cx} cy={eyeY} r={eyeR} fill={INK} />
              <circle cx={cx + 3} cy={eyeY - 3} r={3} fill="#fff" opacity={faceP} />
            </g>
          ))}

          {/* nariz */}
          <path
            d="M 612 494 Q 600 510 614 514"
            fill="none"
            stroke={INK}
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* bochechas */}
          <ellipse cx={558} cy={514} rx={20} ry={10} fill="#F19A8A" opacity={0.5 * faceP} />
          <ellipse cx={662} cy={514} rx={20} ry={10} fill="#F19A8A" opacity={0.5 * faceP} />

          {/* boca: reta → sorriso aberto */}
          <path d={`${mouthD} Z`} fill="#8B1E1E" opacity={faceP} />
          <path d={mouthD} fill="none" stroke={INK} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {/* lâmpada */}
        <g opacity={lampOp} transform={`translate(${LAMP.x} ${lampY}) scale(${lampS})`}>
          <path d={BULB_D} fill={bulbFill} fillOpacity={0.55 + 0.45 * litC} stroke={INK} strokeWidth={6} />
          <circle cx={0} cy={-8} r={40} fill={LIGHT_CORE} opacity={0.75 * litC} />
          <path d="M -12 78 L -10 24" fill="none" stroke={filament} strokeWidth={4} strokeLinecap="round" />
          <path d="M 12 78 L 10 24" fill="none" stroke={filament} strokeWidth={4} strokeLinecap="round" />
          <path
            d="M -10 24 Q -5 6 0 24 Q 5 6 10 24"
            fill="none"
            stroke={filament}
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M -44 -18 Q -42 -46 -16 -54"
            fill="none"
            stroke="#fff"
            strokeWidth={9}
            strokeLinecap="round"
            opacity={0.75}
          />
          {/* rosca */}
          <rect x={-38} y={74} width={76} height={50} rx={10} fill={METAL} stroke={INK} strokeWidth={6} />
          {[88, 100, 112].map((y) => (
            <path
              key={y}
              d={`M -32 ${y - 3} L 32 ${y + 3}`}
              stroke={METAL_DARK}
              strokeWidth={5}
              strokeLinecap="round"
            />
          ))}
          <rect x={-26} y={80} width={8} height={38} rx={4} fill="#fff" opacity={0.35} />
          <path d="M -22 124 L 22 124 L 14 140 L -14 140 Z" fill="#3D434B" stroke={INK} strokeWidth={6} strokeLinejoin="round" />
        </g>

        {/* brilhinhos piscando */}
        {isLit ? (
          <g transform={`translate(${LAMP.x} ${lampY})`}>
            {SPARKLES.map((s, i) => {
              const appear = spring({frame: frame - a - 6 - i * 3, fps, config: {damping: 10, stiffness: 200}});
              const tw = 0.5 + 0.5 * Math.sin((frame - a) * 0.45 + i * 1.9);
              const sc = appear * s.s * (0.55 + 0.6 * tw);
              if (sc <= 0.01) return null;
              return (
                <path
                  key={i}
                  d={SPARKLE}
                  transform={`translate(${s.x} ${s.y}) rotate(${frame * 2 + i * 25}) scale(${sc})`}
                  fill={highlight}
                  stroke={INK}
                  strokeWidth={3}
                  opacity={Math.min(1, appear) * (0.45 + 0.55 * tw)}
                />
              );
            })}
          </g>
        ) : null}

        {/* "?" pensativo (some quando acende) */}
        {qOut < 1 ? (
          <g
            opacity={(1 - qOut) * Math.min(1, qIn)}
            transform={`translate(752 432) rotate(${12 + Math.sin(frame * 0.2) * 6}) scale(${qIn * (1 - 0.5 * qOut)})`}
          >
            <text
              x={0}
              y={0}
              textAnchor="middle"
              fontFamily={FONT}
              fontWeight={900}
              fontSize={72}
              fill="#fff"
              stroke={INK}
              strokeWidth={10}
              strokeLinejoin="round"
              paintOrder="stroke"
            >
              ?
            </text>
          </g>
        ) : null}
      </svg>

      {/* balão de fala */}
      {balao ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: balloonOp,
            transform: `translateX(${balloonX}px) scale(${balloonS})`,
            transformOrigin: `${TAIL_TIP.x}px ${TAIL_TIP.y}px`,
          }}
        >
          <svg style={{position: 'absolute', inset: 0}} width="100%" height="100%" viewBox="0 0 940 760">
            <path d={BALLOON_D} transform="translate(8 10)" fill="#000" opacity={0.3} />
            <path d={BALLOON_D} fill="#fff" stroke={INK} strokeWidth={9} strokeLinejoin="round" />
          </svg>
          <div
            style={{
              position: 'absolute',
              left: 40,
              top: 330,
              width: 380,
              height: 170,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              fontWeight: 900,
              fontSize: balaoSize(balao),
              lineHeight: 1.05,
              color: INK,
              transform: `scale(${interpolate(balloonTextIn, [0, 1], [0.6, 1])})`,
            }}
          >
            <span
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                padding: '0 22px',
              }}
            >
              {balao}
            </span>
          </div>
        </div>
      ) : null}

      {label ? (
        <div
          style={{
            position: 'absolute',
            left: 20,
            right: 20,
            bottom: 24,
            fontWeight: 900,
            fontSize: labelSize,
            lineHeight: 1,
            color: accent,
            textTransform: 'uppercase',
            textAlign: 'center',
            transform: `translateY(${interpolate(labelIn, [0, 1], [40, 0])}px) scale(${labelIn})`,
            ...outline(12),
          }}
        >
          {label}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
