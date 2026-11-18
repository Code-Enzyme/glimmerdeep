// Hold to preview a creature (SPEC section 21): what it does on the next turn if Wren waits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel, step } from '../src/engine.js';
import { previewOf } from '../src/ui/preview.js';

const board = (map, extra = {}) => parseLevel({ id: 'preview', map, ...extra });
const idAt = (state, x, y) => state.creatures.find((c) => c.x === x && c.y === y).id;
const at = (state, x, y) => previewOf(state, idAt(state, x, y));

test('preview: a moth flies toward the lantern, and the preview says where', () => {
  const s = board(['########', '#W..M.G#', '########']);
  assert.deepEqual(at(s, 4, 1), { id: 'M1', type: 'M', x: 4, y: 1, to: { x: 3, y: 1 }, text: 'If Wren waits, it flies west.' });
});

test('preview: the preview is what the engine does on a wait', () => {
  const s = board(['#########', '#.......#', '#W.....M#', '#......G#', '#########']);
  const p = previewOf(s, 'M1');
  const after = step(s, 'Z').creatures.find((c) => c.id === 'M1');
  assert.deepEqual(p.to, { x: after.x, y: after.y });
});

test('preview: a moth that lands in a puddle settles there as a bridge', () => {
  const s = board(['########', '#W.~M.G#', '########']);
  const p = at(s, 4, 1);
  assert.deepEqual(p.to, { x: 3, y: 1 });
  assert.equal(p.text, 'If Wren waits, it flies west and settles in the puddle as a bridge.');
});

test('preview: a whelk creeps away in the dark and stays hidden in the light', () => {
  const dark = board(['#########', '#W..S..G#', '#########']);
  assert.deepEqual([at(dark, 4, 1).to, at(dark, 4, 1).text], [{ x: 5, y: 1 }, 'If Wren waits, it creeps east.']);
  const lit = board(['#######', '#WS..G#', '#######']);
  assert.deepEqual([at(lit, 2, 1).to, at(lit, 2, 1).text], [null, 'If Wren waits, it stays hidden in its shell.']);
});

test('preview: a Stumpcap sleeps in the dark, marches in the light, and says when it is stuck', () => {
  const asleep = board(['########', '#W..>.G#', '########']);
  assert.deepEqual([at(asleep, 4, 1).to, at(asleep, 4, 1).text], [null, 'If Wren waits, it sleeps.']);
  const awake = board(['#######', '#W>..G#', '#######']);
  assert.deepEqual([at(awake, 2, 1).to, at(awake, 2, 1).text], [{ x: 3, y: 1 }, 'If Wren waits, it marches east.']);
  const stuck = board(['#######', '#W^..G#', '#######']);
  assert.deepEqual([at(stuck, 2, 1).to, at(stuck, 2, 1).text], [null, 'If Wren waits, it wakes but cannot step forward.']);
});

test('preview: a newt wanders in the dark, turns when blocked, and dozes in the light', () => {
  const wander = board(['#########', '#W...e.G#', '#########']);
  assert.deepEqual([at(wander, 5, 1).to, at(wander, 5, 1).text], [{ x: 6, y: 1 }, 'If Wren waits, it wanders east.']);
  const blocked = board(['#########', '#W...n.G#', '#########']);
  assert.deepEqual([at(blocked, 5, 1).to, at(blocked, 5, 1).text], [null, 'If Wren waits, it is blocked and turns to face east.']);
  const dozing = board(['#######', '#We..G#', '#######']);
  assert.deepEqual([at(dozing, 2, 1).to, at(dozing, 2, 1).text], [null, 'If Wren waits, it dozes.']);
});

test('preview: an Emberwick warms, catches, cools, stays cold, and follows Wren once it glows', () => {
  const warm = board(['#######', '#WK..G#', '#######']);
  assert.equal(at(warm, 2, 1).text, 'If Wren waits, it warms up. One more lit turn and it catches.');
  const catching = step(warm, 'Z');
  assert.equal(at(catching, 2, 1).text, 'If Wren waits, it catches and starts to glow.');
  const glowing = step(catching, 'Z');
  assert.equal(at(glowing, 2, 1).text, 'If Wren waits, it stays beside Wren.');
  // a glowing Emberwick two tiles from Wren steps after Wren, sideways first
  const far = board(['#######', '#W....#', '#..K.G#', '#######']);
  const glow = { ...far, creatures: far.creatures.map((c) => ({ ...c, heat: 2 })) };
  assert.deepEqual([previewOf(glow, 'K1').to, previewOf(glow, 'K1').text], [{ x: 2, y: 2 }, 'If Wren waits, it follows Wren west.']);
  const cold = board(['#########', '#W...K.G#', '#########']);
  assert.equal(previewOf(cold, 'K1').text, 'If Wren waits, it stays cold.');
  // warmed once, now out of the light: it cools
  const warmed = { ...cold, creatures: cold.creatures.map((c) => ({ ...c, heat: 1 })) };
  assert.equal(previewOf(warmed, 'K1').text, 'If Wren waits, it cools off.');
});

test('preview: a Gloamling drifts and a beetle crawls toward the lantern; a lit beetle basks', () => {
  const drift = board(['#########', '#W....O.#', '#......G#', '#########']);
  assert.deepEqual([previewOf(drift, 'O1').to, previewOf(drift, 'O1').text], [{ x: 5, y: 1 }, 'If Wren waits, it drifts west.']);
  const crawl = board(['#########', '#W....\\G#', '#########']);
  assert.deepEqual([previewOf(crawl, 'R1').to, previewOf(crawl, 'R1').text], [{ x: 5, y: 1 }, 'If Wren waits, it crawls west.']);
  const bask = board(['#######', '#W/..G#', '#######']);
  assert.deepEqual([previewOf(bask, 'R1').to, previewOf(bask, 'R1').text], [null, 'If Wren waits, it basks in the light.']);
});

test('preview: a creature that cannot move stays where it is, and one waits while the lantern is smothered', () => {
  const walled = board(['#######', '#W#M.G#', '#######']);
  assert.deepEqual([previewOf(walled, 'M1').to, previewOf(walled, 'M1').text], [null, 'If Wren waits, it stays where it is.']);
  const hush = board(['########', '#.H..M.#', '#.W...G#', '########']);
  const inHush = step(hush, 'N');
  assert.ok(inHush, 'Wren can walk into the Hush with the lantern in hand');
  assert.equal(previewOf(inHush, 'M1').text, 'If Wren waits, it waits while the lantern is smothered.');
});

test('preview: none for anything but a creature, nor once the level is solved', () => {
  const s = board(['########', '#W..M.G#', '########']);
  assert.equal(previewOf(s, 'nobody'), null);
  assert.equal(previewOf({ ...s, solved: true }, 'M1'), null);
  assert.equal(previewOf({ ...s, caught: true }, 'M1'), null);
});

test('preview: every creature at the start of every level has a preview, and steps at most one tile', async () => {
  const { LEVELS } = await import('../src/levels/index.js');
  const { NIGHT } = await import('../src/levels/night.js');
  const { DAILY } = await import('../src/levels/daily.js');
  let seen = 0;
  for (const def of [...LEVELS, ...NIGHT, ...DAILY]) {
    const s = parseLevel(def);
    for (const c of s.creatures) {
      const p = previewOf(s, c.id);
      assert.ok(p, `${def.id} ${c.id}`);
      assert.match(p.text, /^If Wren waits, it [A-Za-z ,.]+\.$/, `${def.id} ${c.id}: ${p.text}`);
      if (p.to) assert.equal(Math.abs(p.to.x - c.x) + Math.abs(p.to.y - c.y), 1, `${def.id} ${c.id}`);
      seen++;
    }
  }
  assert.ok(seen > 100, `only ${seen} creatures`);
});
