// Comfort settings (SPEC section 22): text size, readable font, motion. Pure rules in src/ui/comfort.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEXT_SIZES, MOTIONS, COMFORT_DEFAULTS, readComfort, reducedMotion } from '../src/ui/comfort.js';

test('comfort: three text sizes, three motion choices, and the defaults', () => {
  assert.deepEqual(TEXT_SIZES, [1, 1.5, 2]);
  assert.deepEqual(MOTIONS, ['system', 'reduced', 'full']);
  assert.deepEqual(COMFORT_DEFAULTS, { textSize: 1, readable: false, motion: 'system' });
});

test('comfort: a save keeps what it may, and anything else falls back to the default', () => {
  assert.deepEqual(readComfort(undefined), COMFORT_DEFAULTS);
  assert.deepEqual(readComfort({}), COMFORT_DEFAULTS);
  assert.deepEqual(readComfort({ textSize: 2, readable: true, motion: 'full' }), { textSize: 2, readable: true, motion: 'full' });
  assert.deepEqual(readComfort({ textSize: 1.5, readable: false, motion: 'reduced' }), { textSize: 1.5, readable: false, motion: 'reduced' });
  assert.deepEqual(readComfort({ textSize: 3, readable: 'yes', motion: 'fast' }), COMFORT_DEFAULTS);
  assert.deepEqual(readComfort({ textSize: '2', readable: 1, motion: null }), COMFORT_DEFAULTS);
  assert.deepEqual(readComfort('junk'), COMFORT_DEFAULTS);
});

test('comfort: motion follows the phone unless the player chose', () => {
  assert.equal(reducedMotion('system', true), true);
  assert.equal(reducedMotion('system', false), false);
  assert.equal(reducedMotion('reduced', false), true);
  assert.equal(reducedMotion('reduced', true), true);
  assert.equal(reducedMotion('full', true), false);
  assert.equal(reducedMotion('full', false), false);
  assert.equal(reducedMotion('nonsense', true), true, 'an unknown choice follows the phone');
});
