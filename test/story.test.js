// Story pages and the Field Journal (SPEC section 13): src/ui/story.js has no DOM, so when a page is due,
// what the Journal shows and the text rules are pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS } from '../src/levels/index.js';
import { STORY, NOTES, storyDue, journal, checkStory, speciesOf } from '../src/ui/story.js';

const saveWith = (ids, seen) => {
  const save = { levels: {}, settings: {} };
  for (const id of ids) save.levels[id] = { moves: 1, stars: 1 };
  if (seen) save.seen = seen;
  return save;
};
const chapter = (n) => CHAPTERS.find((c) => c.id === n);
const lastOf = (n) => chapter(n).levels[chapter(n).levels.length - 1].id;
const firstOf = (n) => chapter(n).levels[0].id;
const allOf = (...ns) => ns.flatMap((n) => chapter(n).levels.map((d) => d.id));

test('story: a prologue, then one page per chapter, in chapter order', () => {
  assert.deepEqual(STORY.map((p) => p.id), ['prologue', ...CHAPTERS.map((c) => `ch${c.id}`)]);
  assert.deepEqual(STORY.map((p) => p.chapter), [0, ...CHAPTERS.map((c) => c.id)]);
  for (const page of STORY) {
    assert.ok(page.title && page.lines.length >= 1, page.id);
    assert.ok(Array.isArray(page.scene.cast) && page.scene.cast.length >= 1, page.id);
  }
});

test('story: the shipped story and notes break no text rule', () => {
  assert.deepEqual(checkStory(CHAPTERS), []);
});

test('story: checkStory names what is wrong', () => {
  const page = (over) => ({ id: 'prologue', chapter: 0, title: 'Fine', lines: ['A line.'], scene: { cast: ['wren'], gloam: null, root: null }, ...over });
  const two = [{ id: 1, name: 'One', levels: [{ id: '1-1', map: ['#####', '#WMG#', '#####'] }] }];
  const notes = { M: 'Soft.' };
  const ok = [page(), page({ id: 'ch1', chapter: 1 })];
  assert.deepEqual(checkStory(two, ok, notes), []);

  const has = (story, n, re) => {
    const problems = checkStory(two, story, n || notes);
    assert.ok(problems.some((p) => re.test(p)), `expected ${re} in ${JSON.stringify(problems)}`);
  };
  has([page()], null, /chapter 1 has no story page/);
  has([...ok, page({ id: 'ch1', chapter: 1 })], null, /ch1.*more than once|duplicate/);
  has([page(), page({ id: 'ch1', chapter: 1, title: 'x'.repeat(41) })], null, /ch1.*title/);
  has([page(), page({ id: 'ch1', chapter: 1, lines: [] })], null, /ch1.*1 to 4 lines/);
  has([page(), page({ id: 'ch1', chapter: 1, lines: ['a', 'b', 'c', 'd', 'e'] })], null, /ch1.*1 to 4 lines/);
  has([page(), page({ id: 'ch1', chapter: 1, lines: ['y'.repeat(161)] })], null, /ch1.*line 1.*160/);
  has([page(), page({ id: 'ch1', chapter: 1, scene: { cast: ['wren', 'Q'], gloam: null, root: null } })], null, /ch1.*cast.*Q/);
  has([page(), page({ id: 'ch1', chapter: 1, scene: { cast: ['wren'], gloam: 'huge', root: null } })], null, /ch1.*gloam/);
  has([page(), page({ id: 'ch1', chapter: 1, scene: { cast: ['wren'], gloam: null, root: 'hot' } })], null, /ch1.*root/);
  has([page(), page({ id: 'ch1', chapter: 1, lines: ['Wren lifted her lantern.'] })], null, /ch1.*"her"/);
  has([page({ title: 'His way down' }), page({ id: 'ch1', chapter: 1 })], null, /prologue.*"His"/);
  has(ok, {}, /Fluffmoth.*no note|M.*no note/);
  has(ok, { M: 'She hums.' }, /note for M.*"She"/);
});

test('story: speciesOf lists the species standing in a level', () => {
  assert.deepEqual(speciesOf({ map: ['#######', '#WM>/G#', '#######'] }), ['M', 'T', 'R']);
  assert.deepEqual(speciesOf({ map: ['#####', '#WnG#', '#####'] }), ['D']);
  assert.deepEqual(speciesOf({ map: ['####', '#WG#', '####'] }), []);
});

test('storyDue: a fresh save is due the prologue, and only the prologue', () => {
  assert.deepEqual(storyDue(saveWith([]), CHAPTERS), ['prologue']);
  assert.deepEqual(storyDue({ levels: {}, settings: {} }, CHAPTERS), ['prologue']);   // an old save has no seen
});

test('storyDue: the prologue waits for Play; chapter pages show at Play and after a result', () => {
  const ch1 = chapter(1).levels.map((d) => d.id);
  assert.deepEqual(storyDue(saveWith([]), CHAPTERS, { at: 'play' }), ['prologue']);
  assert.deepEqual(storyDue(saveWith([]), CHAPTERS, { at: 'result' }), []);
  assert.deepEqual(storyDue(saveWith(ch1), CHAPTERS, { at: 'result' }), ['ch1']);
  assert.deepEqual(storyDue(saveWith(ch1), CHAPTERS, { at: 'play' }), ['prologue', 'ch1']);
});

test('storyDue: a chapter page waits for the last level of its chapter', () => {
  const ch1 = chapter(1).levels.map((d) => d.id);
  assert.deepEqual(storyDue(saveWith(ch1.slice(0, -1), ['prologue']), CHAPTERS), []);
  assert.deepEqual(storyDue(saveWith([firstOf(2)], ['prologue']), CHAPTERS), []);
  assert.deepEqual(storyDue(saveWith(ch1, ['prologue']), CHAPTERS), ['ch1']);
  // the last level alone is enough (Unlock all lets players skip ahead)
  assert.deepEqual(storyDue(saveWith([lastOf(3)], ['prologue']), CHAPTERS), ['ch3']);
});

test('storyDue: seen pages are never due again, and several due pages come in order', () => {
  const save = saveWith(allOf(1, 2, 3, 4, 5, 6), []);
  assert.deepEqual(storyDue(save, CHAPTERS), ['prologue', 'ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6']);
  save.seen = ['prologue', 'ch1', 'ch2'];
  assert.deepEqual(storyDue(save, CHAPTERS), ['ch3', 'ch4', 'ch5', 'ch6']);
  save.seen = STORY.map((p) => p.id);
  assert.deepEqual(storyDue(save, CHAPTERS), []);
});

test('journal: creatures come in the order the chapters bring them in, met once a level with them is solved', () => {
  const fresh = journal(saveWith([]), CHAPTERS);
  assert.deepEqual(fresh.creatures.map((c) => c.kind), ['M', 'S', 'T', 'D', 'K', 'O', 'R']);
  assert.deepEqual(fresh.creatures.map((c) => c.chapter.id), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(fresh.creatures[0].chapter.name, 'Mossmouth');
  assert.ok(fresh.creatures.every((c) => !c.met));
  assert.equal(fresh.met, 0);
  assert.equal(fresh.total, 7);

  const level = chapter(1).levels.find((d) => speciesOf(d).includes('M'));
  const one = journal(saveWith([level.id]), CHAPTERS);
  assert.deepEqual(one.creatures.filter((c) => c.met).map((c) => c.kind), ['M']);
  assert.equal(one.met, 1);

  const most = journal(saveWith(allOf(1, 2, 3, 4, 5, 6, 7)), CHAPTERS);
  assert.equal(most.met, 7);
});

test('journal: story entries are unlocked like their pages, with a kicker naming the chapter', () => {
  const j = journal(saveWith(chapter(1).levels.map((d) => d.id), ['prologue']), CHAPTERS);
  assert.deepEqual(j.pages.map((p) => p.id), STORY.map((p) => p.id));
  assert.deepEqual(j.pages.map((p) => p.unlocked), [true, true, false, false, false, false, false, false]);
  assert.deepEqual(j.pages.map((p) => p.seen), [true, false, false, false, false, false, false, false]);
  assert.equal(j.pages[0].kicker, 'Prologue');
  assert.equal(j.pages[1].kicker, 'Chapter 1: Mossmouth');
  assert.equal(j.pages[1].title, STORY[1].title);
  assert.equal(j.pages[2].chapter.name, chapter(2).name);
});

test('notes: every species has Wren\'s note', () => {
  for (const kind of ['M', 'S', 'T', 'D', 'K', 'O', 'R']) assert.ok(typeof NOTES[kind] === 'string' && NOTES[kind].length > 20, kind);
});
