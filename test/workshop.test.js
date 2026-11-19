// The Workshop (SPEC section 26): making a cavern, painting it, its size, what you have met, checking it
// and keeping caverns in the save. src/ui/workshop.js has no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CAVERNS, cavernName, newCavern, TOOLS, paint, resize, cavernProblems, levelDef, checkCavern,
  metInWorkshop, workshopOpen, readWorkshop, nextSeed, cavernPicture, cavernThumb, cavernSummary, canShare, playCode,
} from '../src/ui/workshop.js';
import { encodeCavern, decodeCavern } from '../src/ui/codes.js';

const at = (c, x, y) => c.map[y][x];
const checked = () => ({ ...newCavern(7), par: 3, check: 'lit' });

test('workshop: a cavern is named from its seed by two fixed word lists', () => {
  assert.equal(cavernName(0), 'Mossy Hollow');
  assert.equal(cavernName(1023), 'Twinkling Archway');
  const names = new Set();
  for (let s = 0; s < 1024; s++) {
    const n = cavernName(s);
    assert.match(n, /^[A-Z][a-z]+ [A-Z][a-z]+$/, n);
    names.add(n);
  }
  assert.equal(names.size, 1024);
  assert.equal(MAX_CAVERNS, 12);
});

test('workshop: a new cavern is 7 by 7, walled, with Wren on the left and a Glowbud on the right', () => {
  assert.deepEqual(newCavern(345), {
    seed: 345,
    map: ['#######', '#.....#', '#.....#', '#W...G#', '#.....#', '#.....#', '#######'],
    gloam: false, shutter: false, par: null, check: null,
  });
});

test('workshop: the tools, in palette order', () => {
  assert.deepEqual(TOOLS.map((t) => t.id), ['floor', 'wall', 'puddle', 'bud', 'wren', 'lantern', 'hush', 'root', 'gate',
    'crystal', 'moth', 'whelk', 'stumpcap', 'newt', 'ember', 'gloamling', 'beetle']);
  for (const t of TOOLS) assert.ok(t.name && t.chars, t.id);
});

test('workshop: painting changes one tile and clears the check', () => {
  const c = checked();
  const d = paint(c, 'wall', 2, 2);
  assert.equal(at(d, 2, 2), '#');
  assert.equal(at(c, 2, 2), '.', 'the old cavern is left alone');
  assert.equal(d.par, null);
  assert.equal(d.check, null);
  assert.equal(paint(d, 'wall', 2, 2), null, 'no change');
  assert.equal(paint(d, 'wall', 7, 2), null, 'outside');
  assert.equal(paint(d, 'wall', -1, 0), null, 'outside');
  assert.equal(paint(d, 'nonsense', 2, 3), null);
});

test('workshop: Wren and the lantern move, and are never painted over', () => {
  let c = newCavern(1);
  c = paint(c, 'wren', 2, 1);
  assert.equal(at(c, 2, 1), 'W');
  assert.equal(at(c, 1, 3), '.', 'Wren left the old tile');
  assert.equal(paint(c, 'wren', 2, 1), null);
  assert.equal(paint(c, 'wall', 2, 1), null, 'not over Wren');
  assert.equal(paint(c, 'floor', 2, 1), null);
  c = paint(c, 'lantern', 3, 3);
  c = paint(c, 'lantern', 4, 4);
  assert.equal(at(c, 3, 3), '.');
  assert.equal(at(c, 4, 4), 'L', 'at most one planted lantern');
  assert.equal(paint(c, 'moth', 4, 4), null, 'not over the lantern');
  assert.equal(paint(c, 'wren', 4, 4), null);
});

test('workshop: things stand on floor, terrain clears a creature, and painting a kind again turns it', () => {
  let c = newCavern(1);
  c = paint(c, 'puddle', 3, 2);
  c = paint(c, 'moth', 3, 2);
  assert.equal(at(c, 3, 2), 'M', 'the puddle under it is gone');
  c = paint(c, 'wall', 3, 2);
  assert.equal(at(c, 3, 2), '#');
  const cycle = (tool, want) => {
    let d = newCavern(1);
    const seen = [];
    for (let i = 0; i < want.length; i++) {
      d = paint(d, tool, 3, 4);
      seen.push(at(d, 3, 4));
    }
    assert.deepEqual(seen.join(''), want, tool);
  };
  cycle('stumpcap', '^>v<^');
  cycle('newt', 'neswn');
  cycle('beetle', '/\\/');
  cycle('root', 'abca');
  cycle('gate', 'ABCA');
  assert.equal(paint(paint(newCavern(1), 'moth', 3, 4), 'moth', 3, 4), null, 'a moth has no turns');
  const once = paint(newCavern(1), 'stumpcap', 3, 4);
  assert.equal(paint(once, 'stumpcap', 3, 4, { turn: false }), null, 'a drag passes over without turning it');
  assert.equal(at(paint(once, 'newt', 3, 4, { turn: false }), 3, 4), 'n', 'another kind still paints');
});

test('workshop: sizes from 3 to 9 wide and 3 to 11 tall; growing adds wall, shrinking takes the last line', () => {
  const c = checked();
  const wide = resize(c, 1, 0);
  assert.deepEqual(wide.map, c.map.map((r) => r + '#'));
  assert.equal(wide.check, null);
  const tall = resize(c, 0, 1);
  assert.deepEqual(tall.map, [...c.map, '########'.slice(0, 7)]);
  const narrow = resize(c, -1, 0);
  assert.deepEqual(narrow.map, c.map.map((r) => r.slice(0, 6)));
  assert.equal(resize(narrow, -1, 0), null, 'the Glowbud is in the last column');
  let big = c;
  while (resize(big, 1, 0)) big = resize(big, 1, 0);
  while (resize(big, 0, 1)) big = resize(big, 0, 1);
  assert.deepEqual([big.map[0].length, big.map.length], [9, 11]);
  const small = { ...newCavern(1), map: ['###', '#WG', '###'] };
  assert.equal(resize(small, 0, -1), null, 'three is the least');
  assert.equal(resize(small, -1, 0), null);
});

test('workshop: a cavern\'s problems, in plain words', () => {
  const c = newCavern(1);
  assert.deepEqual(cavernProblems(c), []);
  assert.deepEqual(cavernProblems(paint(c, 'wall', 5, 3)), ['Add a Glowbud.']);
  assert.deepEqual(cavernProblems({ ...c, map: c.map.map((r) => r.replace('W', '.')) }), ['Put Wren in the cavern.']);
  assert.deepEqual(cavernProblems({ ...c, gloam: true }), ['A Gloam encounter needs some Hush.']);
  assert.deepEqual(cavernProblems(paint(paint(c, 'wall', 5, 3), 'bud', 2, 3)), ['It starts lit already.']);
});

test('workshop: a cavern plays as a level with its name and par', () => {
  const c = checked();
  assert.deepEqual(levelDef(c), { id: 'workshop', name: cavernName(7), par: 3, map: c.map, gloam: false, shutter: false, feature: '' });
  assert.equal(levelDef(newCavern(7)).par, undefined, 'no par before a check');
});

test('workshop: checking finds the par, a cavern that cannot be lit, or one too big to check', () => {
  const lit = checkCavern(newCavern(1));
  assert.deepEqual(lit, { check: 'lit', par: 3, text: 'Lights in 3 moves. That is its par.' });
  let shut = newCavern(1);
  for (const [x, y] of [[4, 2], [4, 3], [4, 4], [5, 2], [5, 4]]) shut = paint(shut, 'wall', x, y);
  assert.deepEqual(checkCavern(shut), { check: 'unlit', par: null, text: 'Can\'t be lit: every way was tried.' });
  assert.deepEqual(checkCavern(newCavern(1), { maxStates: 3 }),
    { check: 'big', par: null, text: 'Too big to check: try fewer creatures or a smaller cavern.' });
  assert.deepEqual(checkCavern(paint(newCavern(1), 'wall', 5, 3)), { check: 'problem', par: null, text: 'Add a Glowbud.' });
});

test('workshop: a checked cavern makes a code that comes back the same', () => {
  const c = { ...newCavern(77), ...checkCavern(newCavern(77)) };
  delete c.text;
  const back = decodeCavern(encodeCavern(c));
  assert.equal(back.ok, true);
  assert.deepEqual(back.cavern.map, c.map);
  assert.equal(back.cavern.par, 3);
  assert.equal(cavernName(back.cavern.seed), cavernName(77));
});

test('workshop: the tools and options you have met', () => {
  const levels = [
    { id: 'x1', map: ['#WMG#'] },
    { id: 'x2', map: ['#WS~aAG#'], gloam: true },
    { id: 'x3', map: ['#W.HG#', '#^O/*#'], under: { '1,1': 'b' }, shutter: true },
  ];
  const base = ['floor', 'wall', 'puddle', 'bud', 'wren', 'lantern'];
  assert.deepEqual(metInWorkshop({ levels: {} }, levels, false), { tools: base, gloam: false, shutter: false });
  assert.deepEqual(metInWorkshop({ levels: { x1: { moves: 3, stars: 1 } } }, levels, false),
    { tools: [...base, 'moth'], gloam: false, shutter: false });
  assert.deepEqual(metInWorkshop({ levels: { x2: { moves: 3, stars: 1 } } }, levels, false),
    { tools: [...base, 'hush', 'root', 'gate', 'whelk'], gloam: true, shutter: false });
  assert.deepEqual(metInWorkshop({ levels: { x3: { moves: 3, stars: 1 } } }, levels, false),
    { tools: [...base, 'hush', 'root', 'crystal', 'stumpcap', 'gloamling', 'beetle'], gloam: false, shutter: true });
  assert.deepEqual(metInWorkshop({ levels: {} }, levels, true), { tools: TOOLS.map((t) => t.id), gloam: true, shutter: true });
});

test('workshop: it opens once 1-11 is lit, or with Unlock all', () => {
  assert.equal(workshopOpen({ levels: {} }, false), false);
  assert.equal(workshopOpen({ levels: { '1-10': { moves: 1, stars: 1 } } }, false), false);
  assert.equal(workshopOpen({ levels: { '1-11': { moves: 1, stars: 1 } } }, false), true);
  assert.equal(workshopOpen({ levels: {} }, true), true);
});

test('workshop: the save keeps good caverns and drops the rest', () => {
  const good = checked();
  const list = [
    good,
    { ...good, seed: 2000 },
    { ...good, map: ['#W?G#', '#####', '#####'] },
    { ...good, map: ['##', '##'] },
    { ...good, map: ['####', '#WG', '####'] },
    'nonsense',
    { ...good, seed: 9, par: 'many', check: 'maybe', gloam: 'yes' },
  ];
  assert.deepEqual(readWorkshop(list), [good, { ...good, seed: 9, par: null, check: null, gloam: false }]);
  assert.deepEqual(readWorkshop(undefined), []);
  assert.equal(readWorkshop(Array.from({ length: 20 }, (_, i) => ({ ...good, seed: i }))).length, 12);
});

test('workshop: a new seed is the chosen one unless a cavern has it', () => {
  assert.equal(nextSeed([], 0.5), 512);
  assert.equal(nextSeed([{ seed: 512 }, { seed: 513 }], 0.5), 514);
  assert.equal(nextSeed([{ seed: 1023 }], 0.9999), 0);
});

test('workshop: what the editor draws, terrain under everything and the things on top', () => {
  const pic = cavernPicture(['#####', '#W>a#', '#L/A#', '#####']);
  assert.equal(pic.w, 5);
  assert.equal(pic.h, 4);
  assert.equal(pic.tiles.length, 20);
  const tile = (x, y) => pic.tiles[y * 5 + x];
  assert.equal(tile(1, 1).kind, 'floor', 'Wren stands on floor');
  assert.equal(tile(2, 1).kind, 'floor');
  assert.deepEqual(tile(3, 1), { x: 3, y: 1, kind: 'root', channel: 'a' });
  assert.deepEqual(tile(3, 2), { x: 3, y: 2, kind: 'gate', channel: 'A' });
  assert.deepEqual(tile(0, 0).neighbors, { n: true, e: true, s: true, w: true }, 'outside counts as wall, as on the board');
  assert.deepEqual(tile(4, 1).neighbors, { n: true, e: true, s: true, w: false });
  assert.equal(tile(1, 1).neighbors, undefined, 'floor joins nothing');
  assert.deepEqual(pic.things, [
    { x: 1, y: 1, who: 'wren' },
    { x: 2, y: 1, who: 'creature', type: 'T', dir: 'E' },
    { x: 1, y: 2, who: 'lantern' },
    { x: 2, y: 2, who: 'creature', type: 'R', dir: '/' },
  ]);
  const all = cavernPicture(['MSKO', 'nesw', '^>v<', '\\...']).things.map((t) => t.type + (t.dir || ''));
  assert.deepEqual(all, ['M', 'S', 'K', 'O', 'DN', 'DE', 'DS', 'DW', 'TN', 'TE', 'TS', 'TW', 'R\\']);
});

test('workshop: a cavern\'s little picture for the list', () => {
  const svg = cavernThumb(['###', '#WG', '###']);
  assert.match(svg, /^<svg [^>]*viewBox="0 0 3 3"/);
  assert.equal((svg.match(/<rect /g) || []).length, 9, 'a square for every tile');
  assert.equal((svg.match(/<circle /g) || []).length, 1, 'a dot for Wren');
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(!/[<>"&]/.test(svg.replace(/<\/?[a-z][^>]*>/g, '')), 'nothing but markup');
});

test('workshop: a cavern row says its name, size and check', () => {
  assert.deepEqual(cavernSummary(newCavern(0)), { name: 'Mossy Hollow', size: '7 by 7', check: 'Not checked' });
  assert.equal(cavernSummary({ ...newCavern(0), check: 'lit', par: 14 }).check, 'Lights in 14 moves');
  assert.equal(cavernSummary({ ...newCavern(0), check: 'lit', par: 1 }).check, 'Lights in 1 move');
  assert.equal(cavernSummary({ ...newCavern(0), check: 'unlit' }).check, 'Can\'t be lit');
  assert.equal(cavernSummary({ ...newCavern(0), check: 'big' }).check, 'Too big to check');
  assert.equal(cavernSummary({ ...newCavern(0), map: ['###', '#WG', '###'] }).size, '3 by 3');
  assert.equal(canShare(newCavern(0)), false);
  assert.equal(canShare({ ...newCavern(0), check: 'lit', par: 3 }), true);
  assert.equal(canShare({ ...newCavern(0), check: 'unlit' }), false);
});

test('workshop: a code plays only when it lights at exactly its par', () => {
  const made = { ...newCavern(77), ...checkCavern(newCavern(77)) };
  const ok = playCode(encodeCavern(made));
  assert.equal(ok.ok, true, ok.why);
  assert.deepEqual(ok.def, { id: 'shared', name: cavernName(77), map: made.map, gloam: false, shutter: false, feature: '', par: 3 });
  const tooFew = playCode(encodeCavern({ ...made, par: 2 }));
  assert.deepEqual(tooFew, { ok: false, why: 'That cavern can\'t be lit at its par.' });
  const tooMany = playCode(encodeCavern({ ...made, par: 9 }));
  assert.deepEqual(tooMany, { ok: false, why: 'That cavern can\'t be lit at its par.' });
  const noWren = playCode(encodeCavern({ ...made, map: made.map.map((r) => r.replace('W', '.')) }));
  assert.deepEqual(noWren, { ok: false, why: 'That cavern can\'t be lit at its par.' });
  const plain = encodeCavern(made).replace(/-/g, '');
  const typo = plain.slice(0, 9) + (plain[9] === '7' ? '8' : '7') + plain.slice(10);
  assert.deepEqual(playCode(typo), { ok: false, why: 'That code has a typo in it.' });
  assert.deepEqual(playCode(''), { ok: false, why: 'That code is not complete.' });
});
