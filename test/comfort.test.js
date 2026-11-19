// Comfort settings (SPEC section 22): text size, readable font, motion. Pure rules in src/ui/comfort.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEXT_SIZES, MOTIONS, COMFORT_DEFAULTS, readComfort, reducedMotion, HANDS, SWIPES, SWIPE_PX, CONTROL_DEFAULTS, readControls, swipeNeed, readTalk,
} from '../src/ui/comfort.js';

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

// Controls (SPEC section 27): arrows, a left hand, swipe length.
test('controls: the choices and the defaults', () => {
  assert.deepEqual(HANDS, ['right', 'left']);
  assert.deepEqual(SWIPES, ['short', 'normal', 'long']);
  assert.deepEqual(SWIPE_PX, { short: 16, normal: 24, long: 40 });
  assert.deepEqual(CONTROL_DEFAULTS, { arrows: false, hand: 'right', swipe: 'normal' });
});

test('controls: a save keeps what it may, and anything else falls back to the default', () => {
  assert.deepEqual(readControls(undefined), CONTROL_DEFAULTS);
  assert.deepEqual(readControls('junk'), CONTROL_DEFAULTS);
  assert.deepEqual(readControls({ arrows: true, hand: 'left', swipe: 'short' }), { arrows: true, hand: 'left', swipe: 'short' });
  assert.deepEqual(readControls({ arrows: 1, hand: 'Left', swipe: 'longer' }), CONTROL_DEFAULTS);
});

test('controls: how far a swipe goes before it is a step', () => {
  assert.equal(swipeNeed('short'), 16);
  assert.equal(swipeNeed('normal'), 24);
  assert.equal(swipeNeed('long'), 40);
  assert.equal(swipeNeed('anything'), 24);
  assert.equal(swipeNeed(undefined), 24);
});

test('board talk: on or off, off by default and for anything else (SPEC section 28)', () => {
  assert.equal(readTalk({ talk: true }), true);
  assert.equal(readTalk({ talk: false }), false);
  assert.equal(readTalk({}), false);
  assert.equal(readTalk(undefined), false);
  assert.equal(readTalk({ talk: 'on' }), false);
  assert.equal(readTalk('junk'), false);
});
