// Colour vision (SPEC section 25): wherever colour tells two things apart, the two stay apart for protanopia,
// deuteranopia and tritanopia, measured with the Machado (2009) simulation. src/ui/vision.js has no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE } from '../src/sprites.js';
import {
  VISIONS, simulate, colourDistance, COLOUR_PAIRS, MIN_DISTANCE, checkColourPairs,
} from '../src/ui/vision.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} is not within ${tol} of ${b}`);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

test('vision: normal vision and the three types of colourblindness', () => {
  assert.deepEqual(VISIONS, ['normal', 'protanopia', 'deuteranopia', 'tritanopia']);
});

test('vision: the simulation keeps greys grey and normal vision unchanged', () => {
  for (const v of VISIONS) {
    for (const grey of ['#000000', '#808080', '#FFFFFF']) {
      const out = rgb(simulate(grey, v));
      for (const c of out) near(c, rgb(grey)[0], 2, `${grey} for ${v}`);
    }
  }
  assert.equal(simulate('#C97A8A', 'normal'), '#C97A8A');
  assert.throws(() => simulate('#FFFFFF', 'catvision'), /vision/);
});

test('vision: red looks dark with protanopia, and red and green meet with deuteranopia', () => {
  // relative luminance (linear light)
  const lin = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const lum = (hex) => rgb(hex).reduce((s, c, i) => s + lin(c) * [0.2126, 0.7152, 0.0722][i], 0);
  assert.ok(lum(simulate('#FF0000', 'protanopia')) < lum('#FF0000') * 0.6, 'protanopia dims red');
  assert.ok(colourDistance('#D04040', '#5A9A3A', 'deuteranopia') < colourDistance('#D04040', '#5A9A3A', 'normal') / 2);
  assert.ok(colourDistance('#3060E0', '#40B060', 'tritanopia') < colourDistance('#3060E0', '#40B060', 'normal'));
});

test('vision: distance is delta E 1976 in CIE Lab', () => {
  assert.equal(colourDistance('#5FBFA8', '#5FBFA8', 'normal'), 0);
  near(colourDistance('#000000', '#FFFFFF', 'normal'), 100, 0.1, 'black to white');
  near(colourDistance('#FF0000', '#00FF00', 'normal'), 170.6, 0.5, 'red to green');
});

test('vision: the pairs are the gate channels and the hint against the tutorial pointer', () => {
  assert.deepEqual(COLOUR_PAIRS.map((p) => p.name), ['gate A and B', 'gate A and C', 'gate B and C', 'hint and tutorial pointer']);
  const byName = Object.fromEntries(COLOUR_PAIRS.map((p) => [p.name, [p.a, p.b]]));
  const ch = PALETTE.channels;
  assert.deepEqual(byName['gate A and B'], [ch.A, ch.B]);
  assert.deepEqual(byName['gate A and C'], [ch.A, ch.C]);
  assert.deepEqual(byName['gate B and C'], [ch.B, ch.C]);
  assert.deepEqual(byName['hint and tutorial pointer'], [PALETTE.hint, PALETTE.coach]);
  assert.equal(MIN_DISTANCE, 30);
});

test('vision: every colour-coded pair stays apart for every type of colour vision', () => {
  assert.deepEqual(checkColourPairs(), []);
  assert.equal(PALETTE.channels.C, '#9877D9', 'gate C is lilac');
  assert.equal(PALETTE.channels.A, PALETTE.amber);
  assert.equal(PALETTE.channels.B, PALETTE.teal);
});

test('vision: the old rose gate is caught', () => {
  const problems = checkColourPairs([{ name: 'gate B and rose', a: PALETTE.teal, b: PALETTE.rose }]);
  assert.ok(problems.some((p) => /gate B and rose/.test(p) && /deuteranopia/.test(p) && /11/.test(p)), problems.join('; '));
  assert.ok(problems.some((p) => /protanopia/.test(p)), problems.join('; '));
  assert.ok(!problems.some((p) => /normal/.test(p)), 'fine with normal vision');
  const tri = checkColourPairs([{ name: 'gate A and rose', a: PALETTE.amber, b: PALETTE.rose }]);
  assert.deepEqual(tri.map((p) => /tritanopia/.test(p)), [true], tri.join('; '));
});
