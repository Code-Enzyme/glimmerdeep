// One attempt at one level: the engine state, the undo stack, Wren's facing and the hint count.
// No DOM in here, so it can be driven from Node as well as from the page.

import { parseLevel, step, canEnter, DIRS } from '../engine.js';

const MOVES = ['N', 'E', 'S', 'W'];

export class Session {
  constructor(def) {
    this.def = def;
    this.start = parseLevel(def);
    this.state = this.start;
    this.history = [];   // { state, facing, hints } before each legal action (and before each restart)
    this.facing = 'S';
    this.hints = 0;
  }

  get moves() {
    return this.state.turn;
  }

  get solved() {
    return this.state.solved;
  }

  // The Hush crept onto Wren (SPEC section 17): nothing moves until the attempt is rewound.
  get caught() {
    return this.state.caught === true;
  }

  get canUndo() {
    return this.history.length > 0;
  }

  // Runs one engine step. -> the new state, or null when the action is illegal (nothing changes then,
  // except that Wren turns to face the way she tried to go).
  act(action) {
    const facingBefore = this.facing;
    if (DIRS[action]) this.facing = action;
    const next = step(this.state, action);
    if (next === null) return null;
    this.history.push({ state: this.state, facing: facingBefore, hints: this.hints });
    this.state = next;
    return next;
  }

  undo() {
    const entry = this.history.pop();
    if (!entry) return false;
    this.state = entry.state;
    this.facing = entry.facing;
    // Stepping back never hands a hint back; undoing a restart brings the earlier attempt's count along.
    this.hints = Math.max(this.hints, entry.hints);
    return true;
  }

  // After a catch: steps back up to n moves, never past the start of this attempt (a restart stays undoable).
  // -> how many moves were taken back
  rewind(n) {
    let back = 0;
    while (back < n && this.state !== this.start && this.history.length > 0) {
      this.undo();
      back++;
    }
    return back;
  }

  // Back to the opening position. The restart itself can be undone. A fresh attempt starts with no hints used.
  restart() {
    if (this.state === this.start && this.history.length === 0) return false;
    this.history.push({ state: this.state, facing: this.facing, hints: this.hints });
    this.state = this.start;
    this.facing = 'S';
    this.hints = 0;
    return true;
  }

  canUseLantern() {
    return step(this.state, 'L') !== null;
  }

  // What the lantern button (and tapping Wren) does now: 'plant' | 'pickup' | 'aim' | 'open', or null when
  // it does nothing. Aiming is only possible in a level with a shutter, from beside the planted lantern.
  lanternAction() {
    const s = this.state;
    const next = step(s, 'L');
    if (next === null) return s.lantern.carried ? 'plant' : null;
    const e = next.events[0];
    if (e.type === 'aim') return e.dir === null ? 'open' : 'aim';
    return e.type;
  }

  bloomCount() {
    let n = 0;
    const bloom = this.state.bloom;
    for (let i = 0; i < bloom.length; i++) if (bloom[i]) n++;
    return n;
  }

  bloomShare() {
    const total = this.state.buds.length;
    return total > 0 ? this.bloomCount() / total : 0;
  }

  // Shortest walk for Wren from her tile to (tx, ty) over tiles she may enter right now.
  // -> array of 'N' | 'E' | 'S' | 'W' (empty when she is already there), or null when there is no way.
  pathTo(tx, ty) {
    const s = this.state;
    const { w, h } = s;
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return null;
    const from = s.wren.y * w + s.wren.x;
    const goal = ty * w + tx;
    if (from === goal) return [];
    if (!canEnter(s, 'wren', tx, ty)) return null;
    const via = new Int8Array(w * h).fill(-1);
    const prev = new Int16Array(w * h).fill(-1);
    const queue = [from];
    via[from] = 9;
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head];
      if (at === goal) break;
      const x = at % w;
      const y = (at - x) / w;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[MOVES[d]][0];
        const ny = y + DIRS[MOVES[d]][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (via[ni] !== -1 || !canEnter(s, 'wren', nx, ny)) continue;
        via[ni] = d;
        prev[ni] = at;
        queue.push(ni);
      }
    }
    if (via[goal] === -1) return null;
    const path = [];
    for (let at = goal; at !== from; at = prev[at]) path.push(MOVES[via[at]]);
    return path.reverse();
  }

  // Star moss for a solved attempt: one for solving, one for par, one for using no hint.
  marks() {
    const par = this.def.par;
    return {
      solved: this.state.solved,
      par: this.state.solved && (typeof par !== 'number' || this.state.turn <= par),
      clean: this.state.solved && this.hints === 0,
    };
  }

  stars() {
    const m = this.marks();
    return (m.solved ? 1 : 0) + (m.par ? 1 : 0) + (m.clean ? 1 : 0);
  }
}
