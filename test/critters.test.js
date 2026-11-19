// Hidden Journal critters (SPEC section 23): the kinds and their text, where each level hides its critter,
// finding one (the third star moss) and the Journal's Critters tab. src/ui/critters.js has no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel, isLit } from '../src/engine.js';
import { lightRoute } from '../src/solver.js';
import { CHAPTERS, LEVELS } from '../src/levels/index.js';
import { NIGHT, GARDEN } from '../src/levels/night.js';
import { DAILY } from '../src/levels/daily.js';
import {
  CRITTERS, critterKind, dailyCritterKind, isFound, markFound, critterJournal, checkCritters,
} from '../src/ui/critters.js';
import { Session } from '../src/ui/session.js';

const ALL = [...LEVELS, ...NIGHT, ...DAILY];
const chapter = (n) => CHAPTERS.find((c) => c.id === n);
const freshSave = () => ({ levels: {}, seen: [], critters: [], daily: {}, settings: {} });

test('critters: one kind per chapter and one for the Night Garden, in order', () => {
  assert.deepEqual(CRITTERS.map((c) => c.kind),
    ['dewmite', 'pebblecrab', 'sporeling', 'skimmer', 'cinderfly', 'rootworm', 'cogmite', 'glasswing']);
  assert.deepEqual(CRITTERS.map((c) => c.name),
    ['Dewmite', 'Pebble crab', 'Sporeling', 'Lake skimmer', 'Cinderfly', 'Rootworm', 'Cogmite', 'Glasswing']);
  for (const ch of CHAPTERS) assert.equal(critterKind(ch), CRITTERS[ch.id - 1], `chapter ${ch.id}`);
  assert.equal(critterKind(GARDEN).kind, 'glasswing');
  assert.equal(critterKind(null), null);
});

test('critters: the shipped notes and lore break no text rule', () => {
  assert.deepEqual(checkCritters(), []);
  const bad = [
    { ...CRITTERS[0], note: 'x'.repeat(161) },
    { ...CRITTERS[1], lore: 'When she came down the tunnel.' },
    { ...CRITTERS[1], kind: 'dewmite', note: '' },
  ];
  const problems = checkCritters(bad);
  assert.ok(problems.some((p) => /dewmite note/.test(p) && /160/.test(p)), problems.join('; '));
  assert.ok(problems.some((p) => /"she"/.test(p)), problems.join('; '));
  assert.ok(problems.some((p) => /twice/.test(p)), problems.join('; '));
  assert.ok(problems.some((p) => /no note/.test(p)), problems.join('; '));
});

test('critters: a daily cavern hides the kind of the chapter that brings in its first species', () => {
  assert.equal(dailyCritterKind({ feature: 'ML' }, CHAPTERS).kind, 'dewmite');
  assert.equal(dailyCritterKind({ feature: 'LS' }, CHAPTERS).kind, 'pebblecrab');
  assert.equal(dailyCritterKind({ feature: 'KO' }, CHAPTERS).kind, 'cinderfly');
  assert.equal(dailyCritterKind({ feature: 'L' }, CHAPTERS).kind, 'dewmite', 'no species: chapter 1');
  for (const def of DAILY) assert.ok(dailyCritterKind(def, CHAPTERS), def.id);
});

test('critters: every chapter, Night Garden and daily level hides one on a dark plain floor tile', () => {
  for (const def of ALL) {
    assert.ok(Array.isArray(def.critter) && def.critter.length === 2, `${def.id} has a critter`);
    const [x, y] = def.critter;
    assert.ok(Number.isInteger(x) && Number.isInteger(y), def.id);
    assert.equal(def.map[y] && def.map[y][x], '.', `${def.id}: the critter is on a tile written '.'`);
    assert.ok(!def.under || def.under[`${x},${y}`] === undefined, `${def.id}: nothing under it`);
    assert.equal(isLit(parseLevel(def), x, y), false, `${def.id}: its nook is dark at the start`);
  }
});

test('critters: some play lights every critter\'s nook', () => {
  for (const def of ALL) {
    const route = lightRoute(parseLevel(def), def.critter[0], def.critter[1]);
    assert.ok(Array.isArray(route) && route.length > 0, `${def.id}: its critter can be found`);
  }
});

test('critters: lightRoute finds the shortest way to light a tile', () => {
  // Wren at x 1 carries the lantern (radius 1): x 4 is lit after two steps east.
  const corridor = { id: 't', name: 'T', par: 1, feature: '', map: ['########', '#W....G#', '########'] };
  const s = parseLevel(corridor);
  assert.deepEqual(lightRoute(s, 2, 1), []);
  assert.deepEqual(lightRoute(s, 4, 1), ['E', 'E']);
  assert.deepEqual(lightRoute(s, 1, 0), [], 'a wall at the edge of the light is lit');
  assert.equal(lightRoute(s, 0, 0), null, 'a corner beyond the walls never is');
  // behind a wall it can never be lit
  const walled = { ...corridor, map: ['########', '#W.#..G#', '########'] };
  assert.equal(lightRoute(parseLevel(walled), 5, 1), null);
});

test('critters: a session sketches the critter only while its nook is lit, and keeps it through undo and restart', () => {
  const def = { id: 't', name: 'T', par: 5, feature: '', critter: [6, 1], map: ['#########', '#W.....G#', '#########'] };
  const s = new Session(def);
  assert.equal(s.found, false);
  assert.equal(s.critterShows(), false);
  s.act('E');
  s.act('E');
  s.act('E');
  assert.equal(s.critterShows(), false);
  assert.equal(s.sketch(), false, 'dark: nothing to sketch');
  s.act('E');
  assert.equal(s.critterShows(), true, 'Wren beside it lights it');
  assert.equal(s.found, false, 'lighting it is not finding it');
  const turn = s.moves;
  const history = s.history.length;
  assert.equal(s.sketch(), true);
  assert.equal(s.found, true);
  assert.equal(s.sketch(), false, 'only once');
  assert.equal(s.moves, turn, 'sketching is not a move');
  assert.equal(s.history.length, history, 'nothing to undo');
  s.undo();
  s.restart();
  assert.equal(s.found, true);
  assert.deepEqual(s.marks(), { solved: false, par: false, critter: false });
  while (!s.solved) assert.notEqual(s.act('E'), null);
  assert.equal(s.moves, 5);
  assert.deepEqual(s.marks(), { solved: true, par: true, critter: true });
  assert.equal(s.stars(), 3);
});

test('critters: hints no longer cost star moss; a critter found before counts', () => {
  const def = { id: 't', name: 'T', par: 5, feature: '', critter: [6, 1], map: ['#########', '#W.....G#', '#########'] };
  const s = new Session(def);
  s.hints = 2;
  while (!s.solved) assert.notEqual(s.act('E'), null);
  assert.equal(s.critterShows(), true);
  assert.deepEqual(s.marks(), { solved: true, par: true, critter: false }, 'seen but never tapped');
  assert.equal(s.stars(), 2);
  const again = new Session(def, { found: true });
  while (!again.solved) again.act('E');
  assert.equal(again.stars(), 3);
  const none = new Session({ ...def, critter: undefined }, { found: true });
  assert.equal(none.found, false, 'no critter, nothing to find');
  assert.equal(none.critterShows(), false);
  assert.equal(none.sketch(), false);
});

test('critters: marking one found saves it and tops up a lit level\'s record', () => {
  const save = freshSave();
  const def = chapter(1).levels[2];
  assert.equal(isFound(save, def), false);
  assert.equal(markFound(save, def), true);
  assert.equal(isFound(save, def), true);
  assert.deepEqual(save.critters, [def.id]);
  assert.equal(markFound(save, def), false, 'only once');
  assert.deepEqual(save.levels, {}, 'an unlit level gets no record');

  const lit = chapter(1).levels[3];
  save.levels[lit.id] = { moves: lit.par, stars: 2 };
  markFound(save, lit);
  assert.deepEqual(save.levels[lit.id], { moves: lit.par, stars: 3 });
  const slow = chapter(1).levels[4];
  save.levels[slow.id] = { moves: slow.par + 4, stars: 1 };
  markFound(save, slow);
  assert.deepEqual(save.levels[slow.id], { moves: slow.par + 4, stars: 2 }, 'one for lighting, one for the critter');
  const old = chapter(1).levels[5];
  save.levels[old.id] = { moves: old.par + 4, stars: 3 };
  markFound(save, old);
  assert.equal(save.levels[old.id].stars, 3, 'moss already earned is kept');
  const noSave = { levels: {} };
  assert.equal(markFound(noSave, def), true);
  assert.deepEqual(noSave.critters, [def.id], 'an old save gains the list');
});

test('critters: the Journal tab counts what is found, chapter by chapter, and tells the lore once all are', () => {
  const save = freshSave();
  const chapters = [...CHAPTERS, GARDEN];
  let j = critterJournal(save, chapters);
  assert.equal(j.entries.length, 8);
  assert.equal(j.total, LEVELS.length + NIGHT.length);
  assert.equal(j.found, 0);
  assert.deepEqual(j.entries[0], {
    kind: 'dewmite', name: 'Dewmite', chapter: { id: 1, name: 'Mossmouth' }, found: 0, total: chapter(1).levels.length,
    note: null, lore: null,
  });
  assert.equal(j.entries[7].chapter.name, 'The Night Garden');

  markFound(save, chapter(2).levels[0]);
  j = critterJournal(save, chapters);
  assert.equal(j.found, 1);
  assert.equal(j.entries[1].found, 1);
  assert.equal(j.entries[1].note, CRITTERS[1].note);
  assert.equal(j.entries[1].lore, null);

  for (const def of chapter(2).levels) markFound(save, def);
  j = critterJournal(save, chapters);
  assert.equal(j.entries[1].lore, CRITTERS[1].lore);
  assert.equal(j.found, chapter(2).levels.length);
  // a daily id or an unknown id in the list counts for nothing
  save.critters.push('D-01', 'zz');
  assert.equal(critterJournal(save, chapters).found, chapter(2).levels.length);
});
