// Hints in three steps (SPEC section 18): the key piece, the first move, the whole way. No DOM in here, so
// all of it can be tested in Node. The app pays for a hint and searches for the way; this file says what
// each press of Hint shows.

import { step, key } from '../engine.js';
import { RULE_CARDS } from './cards.js';

const SPECIES = 'MSTDKOR';

// The id of the creature an engine event is about, or null for Wren's own events and the board's.
function creatureOf(event) {
  if (event.type === 'move') return event.who === 'wren' ? null : event.who;
  return typeof event.id === 'string' ? event.id : null;
}

// What to think about next. Walks `moves` from `state` and looks at what happens on the way.
// -> null when there are no moves, else one of
//    { kind: 'creature', id, type, x, y }   where that creature stands in `state`
//    { kind: 'plant', x, y }                 where the lantern is next planted
//    { kind: 'aim', x, y }                   the lantern's tile when it is next aimed
//    { kind: 'bud', x, y }                   the first Glowbud not in bloom
export function keyPiece(state, moves, feature) {
  if (!moves || moves.length === 0) return null;
  const firstBy = {};   // species letter -> id of its first creature to do something
  let firstAny = null;
  let plant = null;
  let aim = null;
  let s = state;
  for (const m of moves) {
    s = step(s, m);
    if (s === null) break;
    for (const e of s.events) {
      const id = creatureOf(e);
      if (id !== null) {
        const c = state.creatures.find((k) => k.id === id);
        if (c) {
          if (!firstBy[c.type]) firstBy[c.type] = id;
          if (!firstAny) firstAny = id;
        }
      } else if (e.type === 'plant' && !plant) {
        plant = { kind: 'plant', x: e.x, y: e.y };
      } else if (e.type === 'aim' && !aim) {
        aim = { kind: 'aim', x: e.x, y: e.y };
      }
    }
  }
  const creature = (id) => {
    const c = state.creatures.find((k) => k.id === id);
    return { kind: 'creature', id: c.id, type: c.type, x: c.x, y: c.y };
  };
  for (const f of String(feature || '')) {
    if (SPECIES.includes(f) && firstBy[f]) return creature(firstBy[f]);
    if (f === 'L' && plant) return plant;
    if (f === 'A' && aim) return aim;
  }
  if (firstAny) return creature(firstAny);
  if (plant) return plant;
  const i = state.bloom.indexOf(0);
  const bud = state.buds[i >= 0 ? i : 0];
  return { kind: 'bud', x: bud.x, y: bud.y };
}

// The status row's words for a key piece.
export function pieceText(piece) {
  if (!piece) return '';
  if (piece.kind === 'creature') return `Hint: think about the ${RULE_CARDS[piece.type].title}.`;
  if (piece.kind === 'plant') return 'Hint: think about where the lantern stands.';
  if (piece.kind === 'aim') return 'Hint: think about which way the lantern shines.';
  return 'Hint: think about the way to the Glowbud.';
}

// One paid hint: the way from where it was asked, and how far up its three steps the player has climbed.
export class HintLadder {
  constructor(start, moves, feature) {
    this.moves = moves.slice();
    this.feature = feature || '';
    this.tier = 0;
    this.states = [start];   // the positions the way passes through, before each of its moves
    for (let i = 0; i < this.moves.length - 1; i++) this.states.push(step(this.states[i], this.moves[i]));
    if (this.moves.length === 0) this.states = [];
    this.keys = this.states.map((s) => key(s));
  }

  get total() {
    return this.moves.length;
  }

  // -> how many moves of the way lie behind this position, or -1 when it is off the way (or solved)
  at(state) {
    if (!state || state.solved) return -1;
    const i = this.states.indexOf(state);
    return i >= 0 ? i : this.keys.indexOf(key(state));
  }

  // A press of Hint at this position. -> null off the way, else what to show:
  //   { tier: 1, index, piece } | { tier: 2, index, move } | { tier: 3, index, move, total, rest }
  climb(state) {
    const index = this.at(state);
    if (index < 0) return null;
    this.tier = Math.min(this.tier + 1, 3);
    if (this.tier === 1) return { tier: 1, index, piece: keyPiece(this.states[index], this.moves.slice(index), this.feature) };
    if (this.tier === 2) return { tier: 2, index, move: this.moves[index] };
    return { tier: 3, ...this.following(state) };
  }

  // The whole way as it stands from this position, once it is up. -> null, or { index, total, move, rest }
  following(state) {
    if (this.tier < 3) return null;
    const index = this.at(state);
    if (index < 0) return null;
    return { index, total: this.total, move: this.moves[index], rest: this.moves.slice(index) };
  }

  // The Hint button's second line here: 'more' (the next step is free), 'shown' (the whole way is up), or null
  // (off the way: the next hint is a new one, at the usual price).
  label(state) {
    if (this.at(state) < 0) return null;
    return this.tier < 3 ? 'more' : 'shown';
  }
}
