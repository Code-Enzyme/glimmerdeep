// The Play store kit (SPEC section 33): listing text inside Play's limits and true to the game, a privacy
// policy that says what the About sheet says, and images at the sizes Play takes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CHAPTERS, LEVELS } from '../src/levels/index.js';
import { NIGHT } from '../src/levels/night.js';
import { DAILY } from '../src/levels/daily.js';

const at = (p) => new URL(`../${p}`, import.meta.url);
const text = (p) => fs.readFileSync(at(p), 'utf8').trim();
const LISTING = 'store/listing/en-US';
const PRIVACY = /<p id="about-privacy"[^>]*>([^<]+)<\/p>/.exec(text('src/index.html'))[1];
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

// Width and height of a JPEG, from its first frame header; null when the file is not a JPEG.
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    }
    i += 2 + len;
  }
  return null;
}

test('store kit: the listing text fits Play', () => {
  const title = text(`${LISTING}/title.txt`);
  const short = text(`${LISTING}/short_description.txt`);
  const full = text(`${LISTING}/full_description.txt`);
  assert.ok(title.length >= 2 && title.length <= 30, `title is ${title.length} characters`);
  assert.ok(title.startsWith('Glimmerdeep'), 'the title names the game first');
  assert.ok(short.length >= 20 && short.length <= 80, `short description is ${short.length} characters`);
  assert.ok(full.length <= 4000, `full description is ${full.length} characters`);
  assert.ok(!short.includes('\n'), 'the short description is one line');
  // Play's metadata rules: no rank or price words, no emoji, no shouting in the title or short description
  for (const [name, s] of [['title', title], ['short description', short]]) {
    assert.ok(!/\b(free|best|top|#1|number one|new|sale|discount)\b/i.test(s), `${name} has a word Play refuses: ${s}`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(s), `${name} has an emoji`);
    assert.ok(!/\b[A-Z]{4,}\b/.test(s), `${name} shouts`);
  }
  assert.ok(!/\p{Extended_Pictographic}/u.test(full), 'the full description has no emoji');
});

test('store kit: the full description is true to the game', () => {
  const full = text(`${LISTING}/full_description.txt`);
  assert.ok(full.includes(`${LEVELS.length} caverns`), `says ${LEVELS.length} caverns`);
  assert.ok(full.includes(`${WORDS[CHAPTERS.length]} chapters`), `says ${WORDS[CHAPTERS.length]} chapters`);
  assert.ok(full.includes(`${NIGHT.length} deep puzzles`), `says ${NIGHT.length} deep puzzles`);
  assert.ok(full.includes(`${DAILY.length} in all`), `says the Daily Glimmer has ${DAILY.length}`);
  assert.ok(full.includes('Chapter 1 is free'), 'says what is free');
  assert.ok(full.includes(`opens chapters 2 to ${CHAPTERS.length} and the Night Garden`), 'says what the Full Expedition opens');
  assert.ok(/no ads/i.test(full), 'says there are no ads');
  assert.ok(full.includes(PRIVACY.replace('this phone', 'your phone')), 'carries the privacy line');
  // no promises the game does not keep
  assert.ok(!/\b(online|multiplayer|leaderboard|cloud save|account)\b/i.test(full), 'promises nothing the game lacks');
});

test('store kit: the privacy policy says what the game says', () => {
  const policy = text('store/privacy-policy.md');
  const lines = policy.split('\n').filter((l) => l.trim() && !l.startsWith('#') && !/^Last updated/.test(l));
  assert.equal(lines[0], PRIVACY.replace('this phone', 'your phone'), 'opens with the privacy line');
  assert.match(policy, /^# Glimmerdeep privacy policy/m);
  assert.match(policy, /Last updated: \d{1,2} [A-Z][a-z]+ 20\d\d/);
  assert.match(policy, /Google Play/);
  assert.match(policy, /https:\/\/policies\.google\.com\/privacy/);
  assert.match(policy, /[Cc]hildren/);
  assert.ok(!/\[[^\]]*\]\(?/.test(policy.replace(/\[[^\]]+\]\(https?:[^)]+\)/g, '')), 'no placeholders left in brackets');
  assert.ok(!/@/.test(policy), 'no email address: Play shows the developer contact');
});

test('store kit: the images are the sizes Play takes', () => {
  const png = fs.readFileSync(at('store/icon-512.png'));
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);
  const feature = jpegSize(fs.readFileSync(at(`${LISTING}/images/featureGraphic.jpg`)));
  assert.deepEqual(feature, { w: 1024, h: 500 }, 'feature graphic');
  const dir = `${LISTING}/images/phoneScreenshots`;
  const shots = fs.readdirSync(at(dir)).filter((f) => !f.startsWith('.')).sort();
  assert.ok(shots.length >= 4 && shots.length <= 8, `${shots.length} phone screenshots`);
  for (const f of shots) {
    assert.match(f, /^\d-[a-z-]+\.jpg$/, f);
    assert.deepEqual(jpegSize(fs.readFileSync(at(`${dir}/${f}`))), { w: 1080, h: 1920 }, f);
    assert.ok(fs.statSync(at(`${dir}/${f}`)).size < 8 * 1024 * 1024, `${f} is under 8 MB`);
  }
});
