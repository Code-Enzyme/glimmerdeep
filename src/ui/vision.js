// Colour vision (SPEC section 25): wherever colour tells two things apart, the two must stay apart for players
// with protanopia, deuteranopia or tritanopia. The simulation, the distance and the pairs live here. No DOM,
// so it can be tested in Node.
import { PALETTE } from '../sprites.js';

export const VISIONS = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'];
export const MIN_DISTANCE = 30;

// Machado, Oliveira and Fernandes (2009), full severity, for linear RGB.
const MATRIX = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};

const toLinear = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (l) => {
  const c = Math.min(1, Math.max(0, l));
  return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
};

function parse(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}

function matrixFor(vision) {
  const m = MATRIX[vision];
  if (!m) throw new Error(`unknown vision: ${vision}`);
  return m;
}

// '#RRGGBB' -> linear RGB as seen with the given vision
function seen(hex, vision) {
  const m = matrixFor(vision);
  const l = parse(hex).map(toLinear);
  return m.map((row) => row[0] * l[0] + row[1] * l[1] + row[2] * l[2]);
}

// A colour as someone with the given vision sees it. -> '#RRGGBB'
export function simulate(hex, vision) {
  if (vision === 'normal') {
    parse(hex);
    return hex;
  }
  return '#' + seen(hex, vision).map((l) => toSrgb(l).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// linear RGB (sRGB primaries, D65) -> CIE Lab
function lab([r, g, b]) {
  const c = (v) => Math.min(1, Math.max(0, v));
  const [R, G, B] = [c(r), c(g), c(b)];
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
  const Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883;
  const f = (t) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

// How far apart two colours look with the given vision: delta E 1976 in CIE Lab.
export function colourDistance(a, b, vision = 'normal') {
  const p = lab(seen(a, vision));
  const q = lab(seen(b, vision));
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// The places where colour tells two things apart.
const ch = PALETTE.channels;
export const COLOUR_PAIRS = [
  { name: 'gate A and B', a: ch.A, b: ch.B },
  { name: 'gate A and C', a: ch.A, b: ch.C },
  { name: 'gate B and C', a: ch.B, b: ch.C },
  { name: 'hint and tutorial pointer', a: PALETTE.hint, b: PALETTE.coach },
];

// Lists every pair closer than the minimum for some vision. -> [] when all is well.
export function checkColourPairs(pairs = COLOUR_PAIRS, min = MIN_DISTANCE) {
  const problems = [];
  for (const p of pairs) {
    for (const v of VISIONS) {
      const d = colourDistance(p.a, p.b, v);
      if (d < min) problems.push(`${p.name}: ${Math.round(d)} apart for ${v} (at least ${min})`);
    }
  }
  return problems;
}
