// Share codes for Workshop caverns (SPEC section 26): a whole cavern packed into a short code and back.
// No DOM, so it can be tested in Node.
//
// The bits, first to last: a 10-bit checksum (CRC-10) of everything after it, the number of characters in
// the code (8), the version (3), width minus 3 (3), height minus 3 (4), gloam (1), shutter (1), seed (10),
// par (8), then the map row by row as runs: a 5-bit index into SYMBOLS and a length (0 for one tile, else 1
// and 4 bits for 2 to 17), then zero bits up to a whole character. Written in Crockford base 32, in groups
// of four joined by dashes.

export const CODE_VERSION = 1;
export const SYMBOLS = '#.~GHabcABC*WMS^>v<neswKO/\\L';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LOOKALIKE = { I: '1', L: '1', O: '0' };
const MAX_W = 9;
const MAX_H = 11;
const MIN_SIZE = 3;

export const WHY = {
  short: 'That code is not complete.',
  typo: 'That code has a typo in it.',
  newer: 'That code is from a newer Glimmerdeep.',
};

// CRC-10 (polynomial x^10 + x^9 + x^5 + x^4 + x + 1) over a list of bits
function crc10(bits) {
  let r = 0;
  for (const b of bits) {
    const top = ((r >> 9) & 1) ^ b;
    r = (r << 1) & 0x3ff;
    if (top) r ^= 0x233;
  }
  return r;
}

function push(bits, value, n) {
  for (let i = n - 1; i >= 0; i--) bits.push((value >> i) & 1);
}

function runsOf(map) {
  const tiles = map.join('');
  const runs = [];
  for (let i = 0; i < tiles.length;) {
    let n = 1;
    while (i + n < tiles.length && tiles[i + n] === tiles[i] && n < 17) n++;
    runs.push([SYMBOLS.indexOf(tiles[i]), n]);
    i += n;
  }
  return runs;
}

// A cavern -> its code. Throws when the cavern cannot be written (no par, a size or seed out of range, an
// unknown map character). opts.version is for tests of what an older game makes of a newer code.
export function encodeCavern(cavern, { version = CODE_VERSION } = {}) {
  const { map, seed, par } = cavern;
  if (!Number.isInteger(par) || par < 0 || par > 255) throw new Error(`par must be 0 to 255, not ${par}`);
  if (!Number.isInteger(seed) || seed < 0 || seed > 1023) throw new Error(`seed must be 0 to 1023, not ${seed}`);
  const h = Array.isArray(map) ? map.length : 0;
  const w = h ? map[0].length : 0;
  if (w < MIN_SIZE || w > MAX_W || h < MIN_SIZE || h > MAX_H) throw new Error(`size ${w} by ${h} is out of range`);
  if (map.some((row) => row.length !== w)) throw new Error('all rows must be the same length');
  for (const ch of map.join('')) if (!SYMBOLS.includes(ch)) throw new Error(`unknown map character ${ch}`);

  const body = [];
  push(body, version, 3);
  push(body, w - MIN_SIZE, 3);
  push(body, h - MIN_SIZE, 4);
  push(body, cavern.gloam ? 1 : 0, 1);
  push(body, cavern.shutter ? 1 : 0, 1);
  push(body, seed, 10);
  push(body, par, 8);
  for (const [sym, n] of runsOf(map)) {
    push(body, sym, 5);
    if (n === 1) push(body, 0, 1);
    else {
      push(body, 1, 1);
      push(body, n - 2, 4);
    }
  }
  // the length field is part of what the checksum covers, so pad first, then count
  const total = 10 + 8 + body.length;
  const chars = Math.ceil(total / 5);
  const rest = [];
  push(rest, chars, 8);
  rest.push(...body);
  while (10 + rest.length < chars * 5) rest.push(0);
  const bits = [];
  push(bits, crc10(rest), 10);
  bits.push(...rest);
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    let v = 0;
    for (let k = 0; k < 5; k++) v = (v << 1) | bits[i + k];
    out += ALPHABET[v];
  }
  return out.match(/.{1,4}/g).join('-');
}

// A code -> { ok: true, cavern: { seed, map, gloam, shutter, par } } or { ok: false, why }
export function decodeCavern(code) {
  const chars = [];
  for (const raw of String(code || '').toUpperCase()) {
    if (!/[0-9A-Z]/.test(raw)) continue;   // spaces, dashes and the like
    const ch = LOOKALIKE[raw] || raw;
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return { ok: false, why: WHY.typo };
    chars.push(v);
  }
  if (chars.length < 4) return { ok: false, why: WHY.short };
  const bits = [];
  for (const v of chars) push(bits, v, 5);
  let at = 0;
  const read = (n) => {
    if (at + n > bits.length) return null;
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | bits[at + i];
    at += n;
    return v;
  };
  const sum = read(10);
  const count = read(8);
  if (chars.length < count) return { ok: false, why: WHY.short };
  if (chars.length > count) return { ok: false, why: WHY.typo };
  if (crc10(bits.slice(10)) !== sum) return { ok: false, why: WHY.typo };
  const version = read(3);
  if (version === null || version === 0) return { ok: false, why: WHY.typo };
  if (version > CODE_VERSION) return { ok: false, why: WHY.newer };

  const w = read(3);
  const h = read(4);
  const gloam = read(1);
  const shutter = read(1);
  const seed = read(10);
  const par = read(8);
  if (par === null) return { ok: false, why: WHY.short };
  const width = w + MIN_SIZE;
  const height = h + MIN_SIZE;
  if (width > MAX_W || height > MAX_H) return { ok: false, why: WHY.typo };
  let tiles = '';
  while (tiles.length < width * height) {
    const sym = read(5);
    const more = read(1);
    if (sym === null || more === null) return { ok: false, why: WHY.short };
    if (sym >= SYMBOLS.length) return { ok: false, why: WHY.typo };
    let n = 1;
    if (more) {
      const len = read(4);
      if (len === null) return { ok: false, why: WHY.short };
      n = len + 2;
    }
    tiles += SYMBOLS[sym].repeat(n);
  }
  if (tiles.length !== width * height) return { ok: false, why: WHY.typo };
  if (bits.length - at >= 5 || bits.slice(at).some((b) => b)) return { ok: false, why: WHY.typo };
  const map = [];
  for (let y = 0; y < height; y++) map.push(tiles.slice(y * width, (y + 1) * width));
  return { ok: true, cavern: { seed, map, gloam: !!gloam, shutter: !!shutter, par } };
}
