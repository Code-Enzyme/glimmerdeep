// Comfort settings (SPEC section 22): text size, a readable font, and motion. No DOM in here, so it can be
// tested in Node; game.js applies them to the page and the board.

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
