// Tutorials (SPEC section 12): a level's guided steps for a player's first visit. No DOM in here; the
// game asks which step to show and feeds every turn's events in, and BoardView draws the pointer.

const SPECIES = ['M', 'S', 'T', 'D', 'K', 'O', 'R'];
// the species, 'A' for the Shutter, 'H' for the Gloam's Hush (an encounter) and '*' for crystal walls
const CARDS = [...SPECIES, 'A', 'H', '*'];
const BUTTONS = ['plant', 'wait', 'undo', 'hint'];
const PLACES = ['wren', 'lantern', 'bud', 'root', 'gate'];
const GESTURES = ['swipe-N', 'swipe-E', 'swipe-S', 'swipe-W', 'tap', 'hold'];
const UNTIL = ['move', 'step', 'arrive', 'plant', 'pickup', 'wait', 'settle', 'hide', 'wake', 'sleep', 'turn', 'ignite',
  'aim', 'glint', 'gate', 'bud', 'creep', 'card', 'solved'];
const WHEN = ['planted', 'carried'];
const SAY_MAX = 120;   // two lines of the status row on a small phone

// Moves past par before the "Stuck?" nudge.
export const STUCK_AFTER = 6;

const isTile = (p) => Array.isArray(p) && p.length === 2 && Number.isInteger(p[0]) && Number.isInteger(p[1]);

// Did this turn's events (and the state after it) finish the step?
function finishes(stepDef, events, state) {
  switch (stepDef.until) {
    case 'move':
      return true;
    case 'step':
      return events.some((e) => e.type === 'move' && e.who === 'wren');
    case 'arrive':
      return isTile(stepDef.point) && state.wren.x === stepDef.point[0] && state.wren.y === stepDef.point[1];
    case 'gate':
      return events.some((e) => e.type === 'gate' && e.open);
    case 'card':
      return false;
    default:
      return events.some((e) => e.type === stepDef.until);
  }
}

export class Tutorial {
  constructor(steps) {
    this.steps = Array.isArray(steps) ? steps : [];
    this.index = 0;
  }

  get done() {
    return this.index >= this.steps.length;
  }

  // The step to show now, or null when the tutorial is over or the step waits for its `when`.
  current(state) {
    if (this.done) return null;
    const s = this.steps[this.index];
    if (s.when === 'planted' && (!state || state.lantern.carried)) return null;
    if (s.when === 'carried' && (!state || !state.lantern.carried)) return null;
    return s;
  }

  // After every legal action. Finishes at most one step. -> true when a step was finished.
  advance(events, state) {
    if (this.done) return false;
    const s = this.steps[this.index];
    if (s.card) return false;
    if (s.when && !this.current(state)) {
      // a hidden step can still be finished by what just happened (planting and picking up in one go)
      if (!finishes(s, events, state)) return false;
    } else if (!finishes(s, events, state)) {
      return false;
    }
    this.index++;
    return true;
  }

  cardClosed() {
    if (!this.done && this.steps[this.index].card) this.index++;
  }

  // Restart: back to the first step that is not a card. An ended tutorial stays ended.
  restart() {
    if (this.done) return;
    let i = 0;
    while (i < this.steps.length && this.steps[i].card) i++;
    this.index = Math.min(this.index, i);
  }

  end() {
    this.index = this.steps.length;
  }
}

function firstTerrain(state, chars) {
  for (let y = 0; y < state.h; y++) {
    for (let x = 0; x < state.w; x++) if (chars.includes(state.tiles[y][x])) return { kind: 'tile', x, y };
  }
  return null;
}

// What a step points at in this state.
// -> { kind: 'wren', x, y } | { kind: 'creature', id, x, y } | { kind: 'tile', x, y } | { kind: 'button', name } | null
export function resolvePoint(point, state) {
  if (point === undefined || point === null) return null;
  if (isTile(point)) return { kind: 'tile', x: point[0], y: point[1] };
  if (point === 'wren') return { kind: 'wren', x: state.wren.x, y: state.wren.y };
  if (BUTTONS.includes(point)) return { kind: 'button', name: point };
  if (SPECIES.includes(point)) {
    let best = null;
    for (const c of state.creatures) {
      if (c.type !== point) continue;
      if (!best || c.y < best.y || (c.y === best.y && c.x < best.x)) best = c;
    }
    return best ? { kind: 'creature', id: best.id, x: best.x, y: best.y } : null;
  }
  if (point === 'lantern') {
    return state.lantern.carried ? null : { kind: 'tile', x: state.lantern.x, y: state.lantern.y };
  }
  if (point === 'bud') {
    for (let i = 0; i < state.buds.length; i++) {
      if (state.bloom[i] !== 1) return { kind: 'tile', x: state.buds[i].x, y: state.buds[i].y };
    }
    return null;
  }
  if (point === 'root') return firstTerrain(state, 'abc');
  if (point === 'gate') return firstTerrain(state, 'ABC');
  return null;
}

// -> a list of problems with a level's tutorial (empty when it is fine or there is none)
export function checkTutorial(def) {
  const steps = def.tutorial;
  if (steps === undefined) return [];
  if (!Array.isArray(steps) || steps.length === 0) return ['tutorial must be a non-empty array of steps'];
  const map = def.map || [];
  const h = map.length;
  const w = h ? map[0].length : 0;
  const text = map.join('');
  const has = {
    M: /M/.test(text), S: /S/.test(text), T: /[\^>v<]/.test(text), D: /[nesw]/.test(text), K: /K/.test(text), O: /O/.test(text),
    R: /[/\\]/.test(text), A: def.shutter === true, H: def.gloam === true, '*': text.includes('*'),
  };
  const problems = [];
  steps.forEach((s, i) => {
    const at = `step ${i + 1}`;
    if (!s || typeof s !== 'object') {
      problems.push(`${at}: not an object`);
      return;
    }
    if (!UNTIL.includes(s.until)) problems.push(`${at}: unknown until '${s.until}'`);
    if (s.card !== undefined) {
      if (!CARDS.includes(s.card)) problems.push(`${at}: unknown card '${s.card}'`);
      else if (!has[s.card]) {
        if (s.card === 'A') problems.push(`${at}: the Shutter card but the level has no shutter`);
        else if (s.card === 'H') problems.push(`${at}: the Gloam's Hush card but the level is not a Gloam encounter`);
        else if (s.card === '*') problems.push(`${at}: the Crystal card but the level has no crystal walls`);
        else problems.push(`${at}: card '${s.card}' but the level has no such creature`);
      }
      if (s.until !== 'card') problems.push(`${at}: a card step must end with 'card'`);
    } else {
      if (s.until === 'card') problems.push(`${at}: 'card' without a card`);
      if (typeof s.say !== 'string' || !s.say.trim()) problems.push(`${at}: says nothing`);
    }
    if (typeof s.say === 'string' && s.say.length > SAY_MAX) problems.push(`${at}: say is longer than ${SAY_MAX} characters`);
    if (s.point !== undefined) {
      if (isTile(s.point)) {
        const [x, y] = s.point;
        if (x < 0 || y < 0 || x >= w || y >= h) problems.push(`${at}: point [${x}, ${y}] is off the map`);
      } else if (SPECIES.includes(s.point)) {
        if (!has[s.point]) problems.push(`${at}: points at '${s.point}' but the level has no such creature`);
      } else if (!PLACES.includes(s.point) && !BUTTONS.includes(s.point)) {
        problems.push(`${at}: unknown point '${s.point}'`);
      }
    }
    if (s.until === 'arrive' && !isTile(s.point)) problems.push(`${at}: 'arrive' needs an [x, y] point`);
    if (s.gesture !== undefined && !GESTURES.includes(s.gesture)) problems.push(`${at}: unknown gesture '${s.gesture}'`);
    if (s.when !== undefined && !WHEN.includes(s.when)) problems.push(`${at}: unknown when '${s.when}'`);
  });
  return problems;
}
