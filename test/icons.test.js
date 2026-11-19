// Every icon the page asks for is one the sprites can draw (an unknown name draws only a dot).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICON_NAMES } from '../src/sprites.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('icons: every data-icon in the page and every setIcon name can be drawn', () => {
  const asked = new Set();
  for (const m of read('../src/index.html').matchAll(/data-icon="([^"]+)"/g)) asked.add(m[1]);
  for (const file of ['../src/game.js', '../src/ui/map.js']) {
    for (const m of read(file).matchAll(/setIcon\([^,]+,\s*'([^']+)'/g)) asked.add(m[1]);
  }
  assert.ok(asked.has('share') && asked.has('grid'), 'the Workshop asks for share and grid');
  for (const name of asked) assert.ok(ICON_NAMES.includes(name), `no icon called ${name}`);
});
