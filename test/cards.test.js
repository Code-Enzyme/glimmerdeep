// Rule cards (src/ui/cards.js): the texts are SPEC.md word for word, and a long-press finds the right one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel } from '../src/engine.js';
import { RULE_CARDS, cardKindAt } from '../src/ui/cards.js';

const spec = fs.readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');

test('cards: every card text is in SPEC.md word for word', () => {
  for (const [kind, card] of Object.entries(RULE_CARDS)) assert.ok(spec.includes(card.text), `${kind}: ${card.text}`);
});

test("cards: in a Gloam encounter a Hush tile opens the Gloam's card, elsewhere the Hush card (SPEC section 17)", () => {
  const map = ['#######', '#H.W..#', '#G#####'];
  assert.equal(cardKindAt(parseLevel({ id: 't', map }), 1, 1), 'hush');
  assert.equal(cardKindAt(parseLevel({ id: 't', map, gloam: true }), 1, 1), 'H');
  assert.equal(RULE_CARDS.H.title, "The Gloam's Hush");
  assert.equal(RULE_CARDS.H.text, "The Gloam's Hush creeps onto every dark floor tile beside it, one step each turn. Light holds it back. If it reaches Wren, you step back three turns.");
});
