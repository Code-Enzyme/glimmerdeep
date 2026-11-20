// What's new (SPEC section 30): short notes after an update.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NEWS, NEWS_IDS, newsDue, readNews } from '../src/ui/news.js';

test('news: every note has a unique id, a short title and one or two short sentences', () => {
  assert.ok(NEWS.length >= 6, 'enough notes for the title screen');
  assert.deepEqual(NEWS_IDS, NEWS.map((n) => n.id));
  assert.equal(new Set(NEWS_IDS).size, NEWS.length);
  for (const n of NEWS) {
    assert.match(n.id, /^[a-z][a-z0-9-]*$/, n.id);
    assert.ok(n.title && n.title.split(' ').length <= 5, `${n.id}: a title of a few words`);
    const sentences = n.text.split(/(?<=[.!?])\s+/);
    assert.ok(sentences.length >= 1 && sentences.length <= 2 && n.text.length <= 160, `${n.id}: ${n.text}`);
    assert.ok(!/\b(he|she|him|her|his|hers)\b/i.test(`${n.title} ${n.text}`), `${n.id}: no gendered pronouns`);
  }
});

test('news: the newest notes not seen, at most three', () => {
  assert.deepEqual(newsDue([]).map((n) => n.id), NEWS_IDS.slice(0, 3));
  assert.deepEqual(newsDue(NEWS_IDS), []);
  assert.deepEqual(newsDue([NEWS_IDS[0]]).map((n) => n.id), NEWS_IDS.slice(1, 4));
  assert.deepEqual(newsDue(NEWS_IDS.slice(1)).map((n) => n.id), [NEWS_IDS[0]]);
});

test('news: the saved list is a list of strings, else none seen', () => {
  assert.deepEqual(readNews(['a', 'b']), ['a', 'b']);
  assert.deepEqual(readNews(['a', 3, null, 'b']), ['a', 'b']);
  assert.deepEqual(readNews(undefined), []);
  assert.deepEqual(readNews('a'), []);
  assert.deepEqual(readNews({ a: 1 }), []);
});
