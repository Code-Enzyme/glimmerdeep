// Comfort settings (SPEC section 22): text size, a readable font, and motion; and the controls (section 27).
// No DOM in here, so it can be tested in Node; game.js applies them to the page and the board.

export const TEXT_SIZES = [1, 1.5, 2];
export const MOTIONS = ['system', 'reduced', 'full'];
export const COMFORT_DEFAULTS = { textSize: 1, readable: false, motion: 'system' };

// The three comfort settings out of a save's settings, each one valid or its default.
export function readComfort(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  return {
    textSize: TEXT_SIZES.includes(s.textSize) ? s.textSize : COMFORT_DEFAULTS.textSize,
    readable: typeof s.readable === 'boolean' ? s.readable : COMFORT_DEFAULTS.readable,
    motion: MOTIONS.includes(s.motion) ? s.motion : COMFORT_DEFAULTS.motion,
  };
}

// Whether animations hold still: the player's choice, else the phone's reduce-motion setting.
export function reducedMotion(motion, phoneReduces) {
  if (motion === 'reduced') return true;
  if (motion === 'full') return false;
  return !!phoneReduces;
}

// ---------------------------------------------------------------- controls (SPEC section 27)

export const HANDS = ['right', 'left'];
export const SWIPES = ['short', 'normal', 'long'];
export const SWIPE_PX = { short: 16, normal: 24, long: 40 };
export const CONTROL_DEFAULTS = { arrows: false, hand: 'right', swipe: 'normal' };

// The three control settings out of a save's settings, each one valid or its default.
export function readControls(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  return {
    arrows: typeof s.arrows === 'boolean' ? s.arrows : CONTROL_DEFAULTS.arrows,
    hand: HANDS.includes(s.hand) ? s.hand : CONTROL_DEFAULTS.hand,
    swipe: SWIPES.includes(s.swipe) ? s.swipe : CONTROL_DEFAULTS.swipe,
  };
}

// How far, in CSS pixels, a finger travels on the board before it counts as a step.
export function swipeNeed(swipe) {
  return SWIPE_PX[swipe] || SWIPE_PX.normal;
}

// ---------------------------------------------------------------- Board talk (SPEC section 28)

// Board talk out of a save's settings: true only when it was turned on.
export function readTalk(settings) {
  return !!(settings && typeof settings === 'object' && settings.talk === true);
}
