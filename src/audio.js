// Glimmerdeep audio: a music box in a cave.
//
// Everything is synthesised with the Web Audio API: sine "tines", soft plucks, short filtered noise
// bursts and slow envelopes. No audio files, no dependencies.
//
// Layout of this file
//   1. small helpers (random numbers, pitch, envelopes, node "kits" that clean up after themselves)
//   2. instrument voices (kalimba, celesta, nylon pluck, wooden knock, creak, bowed-glass pad)
//   3. SOUNDS: one builder per one-shot sound. Each takes a kit (audio context + destination) and a
//      start time, so the same code runs in a live AudioContext and in an OfflineAudioContext.
//   4. createAudioEngine(ctx): master chain, voice management (stagger, voice cap), bud scale walk,
//      and the generative music bed with its lookahead scheduler.
//   5. the public API from SPEC section 7. Safe to import in Node, and every call is a silent no-op
//      until initAudio() has run in a browser that has Web Audio.

export const SOUND_NAMES = [
  'step', 'blocked', 'plant', 'pickup', 'wait', 'moth', 'settle', 'whelkMove', 'whelkHide',
  'whelkEmerge', 'stumpStep', 'stumpBump', 'stumpWake', 'gateOpen', 'gateClose', 'budOn', 'budOff',
  'solve', 'undo', 'restart', 'ui', 'hint',
];

// ---------------------------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------------------------

const MASTER_LEVEL = 0.75; // before the compressor (which adds about 3 dB of make-up gain)
const MUSIC_LEVEL = 1; // the bed is kept quiet by its note levels
const ECHO_TIME = 0.13; // one short feedback delay stands in for the cave
const ECHO_FEEDBACK = 0.3;
const ECHO_SEND = 0.13;
const ECHO_TONE = 1600;

const MAX_VOICES = 6; // one-shot sounds alive at once
const MAX_SAME = 2; // overlapping copies of one foley sound
const STAGGER_MIN = 0.04; // same-frame sounds are spread out by 40 to 70 ms each
const STAGGER_MAX = 0.07;
const MAX_BACKLOG = 0.36; // foley that would start later than this is dropped (about six per frame)

const LOOKAHEAD = 0.45; // seconds of music scheduled ahead of the clock
const TICK_MS = 110; // how often the scheduler looks
const LAYER2_AT = 0.3; // kalimba joins above this intensity
const LAYER3_AT = 0.65; // celesta joins above this (so 2 of 3 Glowbuds already counts)
const LAYER_FADE = 1; // seconds for a layer to fade in or out
const BUD_TOP = 10; // highest step of the Glowbud scale walk (two octaves)

// Final level of each one-shot, set from the measurements in dev/audio-check.cjs (run it with
// --levels after changing a sound). Foley peaks around 0.1 to 0.3, the Glowbud note at 0.3 and
// the solve phrase at 0.4, before the master chain.
const LEVELS = {
  step: 0.24, blocked: 0.225, plant: 0.4, pickup: 0.25, wait: 0.11, moth: 0.1, settle: 0.3,
  whelkMove: 0.12, whelkHide: 0.15, whelkEmerge: 0.18, stumpStep: 0.195, stumpBump: 0.28,
  stumpWake: 0.1, gateOpen: 0.13, gateClose: 0.133, budOn: 0.27, budOff: 0.22, solve: 0.22,
  undo: 0.155, restart: 0.195, ui: 0.115, hint: 0.185,
};

// Sounds that are only colour. They are dropped first when a turn gets busy.
const FOLEY = {
  step: 1, wait: 1, moth: 1, whelkMove: 1, whelkHide: 1, whelkEmerge: 1, stumpStep: 1,
  stumpBump: 1, stumpWake: 1,
};

// What the player's own finger did. These answer at once, even while the creatures of the
// previous turn are still sounding off.
const ACTIONS = { step: 1, blocked: 1, plant: 1, pickup: 1, wait: 1, undo: 1, restart: 1, ui: 1, hint: 1 };

// Repeated foley that gets a few milliseconds of loose timing when it is not already staggered.
const LOOSE = { step: 1, moth: 1, whelkMove: 1, stumpStep: 1 };

// Major pentatonic. Each chapter keeps the same five-note shape and moves the drone under it,
// which changes the mode: 1 is plain major, 2 is the relative minor, 3 hangs suspended.
const PENT = [0, 2, 4, 7, 9];
const CHAPTERS = [
  null,
  { key: 62, drone: 50, home: [0, 3], colors: [78, 76, 81, 76], beat: 0.66 }, // D pentatonic over D
  { key: 60, drone: 45, home: [4, 2], colors: [72, 74, 67, 74], beat: 0.72 }, // C pentatonic over A
  { key: 63, drone: 53, home: [1, 4], colors: [75, 79, 70, 79], beat: 0.6 }, // E flat pentatonic over F
];

// ---------------------------------------------------------------------------------------------
// 1. Helpers
// ---------------------------------------------------------------------------------------------

function noop() {}

function makeRng(seed) {
  let s = seed === undefined || seed === null ? (Math.random() * 4294967296) >>> 0 : seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mtof(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Step `idx` of the pentatonic scale that starts on MIDI note `root` (idx may be negative).
function pentMidi(root, idx) {
  const octave = Math.floor(idx / 5);
  return root + 12 * octave + PENT[idx - octave * 5];
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function pick(r, list) {
  return list[Math.floor(r() * list.length) % list.length];
}

// One short noise buffer and one string-like waveform per audio context.
const noiseCache = new WeakMap();
const waveCache = new WeakMap();

function noiseBuffer(ctx) {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    const len = Math.floor(ctx.sampleRate * 0.75);
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    const r = makeRng(0x9e3779b9);
    for (let i = 0; i < len; i++) data[i] = r() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

// The spectrum of a string plucked about a fifth of the way along: soft, with no buzz.
function stringWave(ctx) {
  let wave = waveCache.get(ctx);
  if (!wave) {
    const n = 12;
    const real = new Float32Array(n + 1);
    const imag = new Float32Array(n + 1);
    for (let h = 1; h <= n; h++) imag[h] = Math.abs(Math.sin(h * Math.PI * 0.21)) / Math.pow(h, 1.7);
    wave = ctx.createPeriodicWave(real, imag);
    waveCache.set(ctx, wave);
  }
  return wave;
}

// A kit is the set of nodes that make up one sound. Sources are scheduled to stop, and when the
// last one has ended every node is disconnected.
function makeKit(ctx, dest, level, r) {
  const out = ctx.createGain();
  out.gain.value = level;
  out.connect(dest);
  return { ctx, out, level, r, nodes: [out], sources: [], live: 0, end: 0, done: false, onDone: null, stopAt: -1 };
}

function releaseKit(k) {
  if (k.done) return;
  k.done = true;
  for (let i = 0; i < k.nodes.length; i++) {
    try { k.nodes[i].disconnect(); } catch (e) { /* already gone */ }
  }
  k.nodes.length = 0;
  k.sources.length = 0;
  if (k.onDone) k.onDone(k);
}

// Fade a kit out and stop it early (voice stealing, music pause, chapter change). A kit that is
// already on its way out can only be stopped sooner, and keeps the fade it has.
function stopKit(k, when, fade) {
  if (k.done || when >= k.end) return;
  try {
    if (k.stopAt < 0) {
      const from = Math.max(k.ctx.currentTime, when - (fade || 0.03));
      k.out.gain.setValueAtTime(k.level, from);
      k.out.gain.linearRampToValueAtTime(0, Math.max(when, from + 0.005));
    } else if (when >= k.stopAt) {
      return;
    }
    k.stopAt = when;
    for (let i = 0; i < k.sources.length; i++) k.sources[i].stop(when);
    k.end = when;
  } catch (e) { /* a source that already ended */ }
}

function track(k, src, stopAt) {
  k.nodes.push(src);
  k.sources.push(src);
  k.live++;
  if (stopAt > k.end) k.end = stopAt;
  src.onended = function () {
    if (--k.live <= 0) releaseKit(k);
  };
}

function osc(k, type, freq, t0, t1) {
  const o = k.ctx.createOscillator();
  if (typeof type === 'string') o.type = type;
  else o.setPeriodicWave(type);
  o.frequency.value = freq;
  o.frequency.setValueAtTime(freq, t0);
  o.start(t0);
  o.stop(t1);
  track(k, o, t1);
  return o;
}

function noise(k, t0, t1) {
  const s = k.ctx.createBufferSource();
  s.buffer = noiseBuffer(k.ctx);
  s.loop = true;
  s.start(t0, k.r() * 0.5);
  s.stop(t1);
  track(k, s, t1);
  return s;
}

function gain(k, value) {
  const g = k.ctx.createGain();
  g.gain.value = value === undefined ? 0 : value;
  k.nodes.push(g);
  return g;
}

function filt(k, type, freq, q) {
  const f = k.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  k.nodes.push(f);
  return f;
}

// Struck or plucked: quick rise, then an exponential fall that reaches silence at t + dur.
function pluckEnv(param, t, peak, attack, dur) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(Math.max(peak * 0.001, 1e-6), t + dur);
  param.linearRampToValueAtTime(0, t + dur + 0.01);
}

// Bowed or breathed: slow rise, hold, soft fall. Ends at t + attack + hold + release.
function swellEnv(param, t, peak, attack, hold, release) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak * 0.7, t + attack * 0.6);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setValueAtTime(peak, t + attack + hold);
  param.exponentialRampToValueAtTime(Math.max(peak * 0.003, 1e-6), t + attack + hold + release - 0.015);
  param.linearRampToValueAtTime(0, t + attack + hold + release);
}

// A tone with a pluck envelope. Returns the oscillator so the caller can bend its pitch.
function tone(k, type, freq, t, peak, attack, dur, dest) {
  const o = osc(k, type, freq, t, t + dur + 0.02);
  const g = gain(k);
  pluckEnv(g.gain, t, peak, attack, dur);
  o.connect(g);
  g.connect(dest || k.out);
  return o;
}

// A burst of filtered noise with a pluck envelope. The gain is scaled by the filter's bandwidth so
// that `peak` means roughly the same loudness for any filter. Returns the filter.
function hiss(k, type, freq, q, t, peak, attack, dur, dest) {
  const s = noise(k, t, t + dur + 0.02);
  const f = filt(k, type, freq, q);
  const g = gain(k);
  const width = type === 'bandpass' ? freq / Math.max(q, 0.3) : freq;
  const scale = clamp(Math.sqrt(9000 / Math.max(width, 60)), 1, 9);
  pluckEnv(g.gain, t, peak * scale, attack, dur);
  s.connect(f);
  f.connect(g);
  g.connect(dest || k.out);
  return f;
}

// ---------------------------------------------------------------------------------------------
// 2. Instrument voices
// ---------------------------------------------------------------------------------------------

// Kalimba: a pure tine with a tiny inharmonic "tink" on the attack. `full` adds a little body and
// the thumbnail, for notes that are heard on their own.
function kalimba(k, t, freq, vel, dur, full) {
  tone(k, 'sine', freq, t, vel, 0.003, dur);
  tone(k, 'sine', Math.min(freq * 6.27, 5400), t, vel * 0.13, 0.001, 0.07);
  if (full) {
    tone(k, 'sine', freq * 2, t, vel * 0.15, 0.002, dur * 0.4);
    hiss(k, 'bandpass', 1500, 1.2, t, vel * 0.05, 0.001, 0.014);
  }
}

// Celesta: felt hammer on a metal bar. Softer attack, harmonic partials, long ring.
function celesta(k, t, freq, vel, dur) {
  tone(k, 'sine', freq, t, vel, 0.006, dur);
  tone(k, 'sine', freq * 2, t, vel * 0.3, 0.004, dur * 0.55);
  tone(k, 'sine', Math.min(freq * 4, 6000), t, vel * 0.09, 0.003, dur * 0.22);
}

// Nylon string: a soft string spectrum whose brightness dies away faster than its level.
function nylon(k, t, freq, vel, dur) {
  const o = osc(k, stringWave(k.ctx), freq, t, t + dur + 0.02);
  const top = Math.min(freq * 7, 6500);
  const lp = filt(k, 'lowpass', top, 0);
  lp.frequency.setValueAtTime(top, t);
  lp.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur * 0.55);
  const g = gain(k);
  pluckEnv(g.gain, t, vel, 0.003, dur);
  o.connect(lp);
  lp.connect(g);
  g.connect(k.out);
}

// A knock on wood: two bar partials and the click of the contact.
function woodKnock(k, t, freq, amp, ring) {
  tone(k, 'sine', freq, t, amp, 0.002, ring);
  tone(k, 'sine', freq * 2.76, t, amp * 0.42, 0.0015, ring * 0.5);
  hiss(k, 'bandpass', 1200, 1, t, amp * 0.1, 0.001, 0.016);
}

// A creak: slow, uneven stick-slip pulses ringing two wooden resonances. `rate` and `formant` are
// functions of progress 0..1, so a creak can rise, fall, or open and close like a yawn.
function creak(k, t, dur, rate, formant, amp) {
  const o = osc(k, 'sawtooth', rate(0), t, t + dur + 0.03);
  const b1 = filt(k, 'bandpass', formant(0), 5);
  const b2 = filt(k, 'bandpass', formant(0) * 2.3, 4);
  const g2 = gain(k, 0.4);
  const g = gain(k);
  const steps = Math.max(8, Math.round(dur / 0.028));
  b1.frequency.setValueAtTime(formant(0), t);
  b2.frequency.setValueAtTime(formant(0) * 2.3, t);
  g.gain.setValueAtTime(0, t);
  for (let i = 1; i <= steps; i++) {
    const x = i / steps;
    const tt = t + x * dur;
    o.frequency.linearRampToValueAtTime(rate(x) * (1 + (k.r() - 0.5) * 0.34), tt);
    b1.frequency.linearRampToValueAtTime(formant(x), tt);
    b2.frequency.linearRampToValueAtTime(formant(x) * 2.3, tt);
    const shape = Math.pow(Math.sin(Math.PI * x), 0.6);
    g.gain.linearRampToValueAtTime(i === steps ? 0 : amp * shape * (0.55 + 0.45 * k.r()), tt);
  }
  o.connect(b1);
  b1.connect(g);
  o.connect(b2);
  b2.connect(g2);
  g2.connect(g);
  g.connect(k.out);
}

// A long, even breath for the pad: eases in, holds, and lets go slowly enough that the next
// breath has arrived before this one is gone.
function breathEnv(param, t, peak, attack, hold, release) {
  const up = [[0.25, 0.1], [0.6, 0.55], [0.85, 0.9], [1, 1]];
  const down = [[0.3, 0.72], [0.6, 0.4], [0.85, 0.12], [1, 0]];
  param.setValueAtTime(0, t);
  for (let i = 0; i < up.length; i++) param.linearRampToValueAtTime(peak * up[i][1], t + attack * up[i][0]);
  param.setValueAtTime(peak, t + attack + hold);
  for (let i = 0; i < down.length; i++) {
    param.linearRampToValueAtTime(peak * down[i][1], t + attack + hold + release * down[i][0]);
  }
}

// Bowed glass: pure tones that swell in and out, with one slightly detuned pair for a slow shimmer.
// `tones` is a list of [frequency, level]. `breath` picks the long pad envelope.
function glass(k, t, tones, peak, attack, hold, release, breath) {
  const g = gain(k);
  (breath ? breathEnv : swellEnv)(g.gain, t, peak, attack, hold, release);
  const end = t + attack + hold + release + 0.02;
  for (let i = 0; i < tones.length; i++) {
    const o = osc(k, 'sine', tones[i][0], t, end);
    const lvl = gain(k, tones[i][1]);
    o.connect(lvl);
    lvl.connect(g);
  }
  g.connect(k.out);
}

// ---------------------------------------------------------------------------------------------
// 3. One-shot sounds. fn(kit, startTime, params); params = { key, idx, alt }.
// ---------------------------------------------------------------------------------------------

const SOUNDS = Object.create(null);

// Wren's soft footfall: a light pat of sole on stone with a small heel. Feet alternate.
SOUNDS.step = function (k, t, p) {
  const v = (1 + (k.r() - 0.5) * 0.2) * (p.alt ? 0.88 : 1);
  const d = 0.15 + k.r() * 0.06;
  hiss(k, 'lowpass', 760 * v, 3, t, 0.5, 0.008, d);
  const heel = tone(k, 'sine', 215 * v, t, 0.3, 0.006, d * 0.7);
  heel.frequency.exponentialRampToValueAtTime(140 * v, t + 0.06);
};

// Walking into something: one dull, muffled tap with no ring.
SOUNDS.blocked = function (k, t) {
  const lp = filt(k, 'lowpass', 640, 0);
  lp.connect(k.out);
  const o = tone(k, 'triangle', 262, t, 1, 0.003, 0.12, lp);
  o.frequency.exponentialRampToValueAtTime(186, t + 0.06);
  hiss(k, 'lowpass', 380, 0, t, 0.14, 0.002, 0.03);
};

// Lantern set down: a soft thud, a small glassy clink, then the light swelling out.
SOUNDS.plant = function (k, t, p) {
  const root = mtof(p.key);
  const thud = tone(k, 'sine', 156, t, 0.5, 0.004, 0.1);
  thud.frequency.exponentialRampToValueAtTime(94, t + 0.07);
  const c = t + 0.012;
  tone(k, 'sine', 2380, c, 0.24, 0.001, 0.2);
  tone(k, 'sine', 3790, c, 0.11, 0.001, 0.11);
  tone(k, 'sine', 5230, c, 0.045, 0.001, 0.06);
  glass(k, t + 0.03, [[root, 1], [root * 1.5, 0.55], [root * 2.003, 0.3]], 0.34, 0.22, 0.05, 0.6);
};

// Lantern picked up: the handle clinks twice and the light folds back in.
SOUNDS.pickup = function (k, t, p) {
  const root = mtof(p.key);
  tone(k, 'sine', 2040, t, 0.3, 0.001, 0.1);
  tone(k, 'sine', 3260, t, 0.1, 0.001, 0.05);
  tone(k, 'sine', 2720, t + 0.075, 0.24, 0.001, 0.12);
  tone(k, 'sine', 4350, t + 0.075, 0.08, 0.001, 0.05);
  const g = gain(k);
  swellEnv(g.gain, t + 0.02, 0.5, 0.05, 0.02, 0.28);
  const o = osc(k, 'triangle', root * 1.5, t + 0.02, t + 0.4);
  o.frequency.setValueAtTime(root * 1.5, t + 0.05);
  o.frequency.exponentialRampToValueAtTime(root, t + 0.3);
  o.connect(g);
  g.connect(k.out);
};

// Waiting a turn: one soft breath out.
SOUNDS.wait = function (k, t) {
  const s = noise(k, t, t + 0.56);
  const bp = filt(k, 'bandpass', 760, 0.7);
  bp.frequency.setValueAtTime(760, t);
  bp.frequency.exponentialRampToValueAtTime(430, t + 0.5);
  const lp = filt(k, 'lowpass', 1500, 0);
  const g = gain(k);
  swellEnv(g.gain, t, 2.4, 0.16, 0.03, 0.34);
  s.connect(bp);
  bp.connect(lp);
  lp.connect(g);
  g.connect(k.out);
};

// Fluffmoth: three or four tiny rising pips over a papery wing rustle.
SOUNDS.moth = function (k, t) {
  const base = 1650 * (1 + (k.r() - 0.5) * 0.36);
  const count = 3 + (k.r() < 0.45 ? 1 : 0);
  const o = osc(k, 'sine', base, t, t + count * 0.055 + 0.06);
  const g = gain(k);
  let tt = t;
  for (let i = 0; i < count; i++) {
    const f = base * (1 + i * 0.1 + (k.r() - 0.5) * 0.05);
    const d = 0.026 + k.r() * 0.012;
    o.frequency.setValueAtTime(f, tt);
    o.frequency.exponentialRampToValueAtTime(f * 1.22, tt + d);
    g.gain.setValueAtTime(0, tt);
    g.gain.linearRampToValueAtTime(1 - i * 0.14, tt + 0.006);
    g.gain.linearRampToValueAtTime(0, tt + d);
    tt += d + 0.012 + k.r() * 0.014;
  }
  o.connect(g);
  g.connect(k.out);
  hiss(k, 'bandpass', 3100, 1.4, t, 0.12, 0.02, tt - t + 0.03);
};

// A moth settles into a puddle: plop, then a happy little trill on the scale.
SOUNDS.settle = function (k, t, p) {
  const thud = tone(k, 'sine', 240, t, 0.6, 0.003, 0.08);
  thud.frequency.exponentialRampToValueAtTime(120, t + 0.05);
  hiss(k, 'lowpass', 900, 0, t, 0.12, 0.002, 0.04);
  const drop = tone(k, 'sine', 380, t + 0.028, 0.8, 0.004, 0.13);
  drop.frequency.exponentialRampToValueAtTime(1020, t + 0.11);
  const drip = tone(k, 'sine', 620, t + 0.15, 0.3, 0.003, 0.07);
  drip.frequency.exponentialRampToValueAtTime(1350, t + 0.2);

  const seq = [4, 7, 4, 7, 9, 12];
  const top = p.key + 24;
  const o = osc(k, 'sine', mtof(top + seq[0]), t + 0.3, t + 0.3 + seq.length * 0.062 + 0.2);
  const g = gain(k);
  let tt = t + 0.3;
  for (let i = 0; i < seq.length; i++) {
    const last = i === seq.length - 1;
    o.frequency.setValueAtTime(mtof(top + seq[i]), tt);
    g.gain.setValueAtTime(0, tt);
    g.gain.linearRampToValueAtTime(last ? 0.42 : 0.34, tt + 0.006);
    if (last) {
      g.gain.exponentialRampToValueAtTime(0.0005, tt + 0.17);
      g.gain.linearRampToValueAtTime(0, tt + 0.18);
    } else {
      g.gain.linearRampToValueAtTime(0, tt + 0.056);
    }
    tt += 0.062;
  }
  o.connect(g);
  g.connect(k.out);
};

// Shellwhelk creeping: a wet little slide with a pop at the end.
SOUNDS.whelkMove = function (k, t) {
  const v = 1 + (k.r() - 0.5) * 0.26;
  const d = 0.19 + k.r() * 0.07;
  const s = noise(k, t, t + d + 0.03);
  const bp = filt(k, 'bandpass', 380 * v, 7);
  bp.frequency.setValueAtTime(380 * v, t);
  bp.frequency.exponentialRampToValueAtTime(1280 * v, t + d * 0.55);
  bp.frequency.exponentialRampToValueAtTime(640 * v, t + d);
  const g = gain(k);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(6.5, t + d * 0.4);
  g.gain.linearRampToValueAtTime(3, t + d * 0.7);
  g.gain.linearRampToValueAtTime(0, t + d);
  const lp = filt(k, 'lowpass', 2300, 0);
  s.connect(bp);
  bp.connect(lp);
  lp.connect(g);
  g.connect(k.out);
  const pop = tone(k, 'sine', 520 * v, t + d * 0.72, 0.5, 0.004, 0.06);
  pop.frequency.exponentialRampToValueAtTime(980 * v, t + d * 0.72 + 0.045);
};

// Shellwhelk hides: a quick scrape in, then a hollow knock on the shell.
SOUNDS.whelkHide = function (k, t) {
  const v = 1 + (k.r() - 0.5) * 0.06;
  hiss(k, 'bandpass', 1500, 2, t, 0.06, 0.012, 0.045);
  const c = t + 0.045;
  const a = tone(k, 'sine', 690 * v, c, 1, 0.0015, 0.12);
  a.frequency.exponentialRampToValueAtTime(640 * v, c + 0.08);
  tone(k, 'sine', 1090 * v, c, 0.4, 0.0015, 0.06);
  hiss(k, 'bandpass', 2100, 1.2, c, 0.1, 0.001, 0.016);
};

// Shellwhelk peeks back out: a shell tick, a rising wet "boo-ip".
SOUNDS.whelkEmerge = function (k, t) {
  const v = 1 + (k.r() - 0.5) * 0.08;
  tone(k, 'sine', 980 * v, t, 0.3, 0.002, 0.035);
  const o = osc(k, 'sine', 300 * v, t + 0.04, t + 0.3);
  o.frequency.exponentialRampToValueAtTime(640 * v, t + 0.2);
  const g = gain(k);
  g.gain.setValueAtTime(0, t + 0.04);
  g.gain.linearRampToValueAtTime(0.9, t + 0.085);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.27);
  g.gain.linearRampToValueAtTime(0, t + 0.28);
  o.connect(g);
  g.connect(k.out);
  hiss(k, 'bandpass', 800, 3, t + 0.04, 0.07, 0.03, 0.14);
  const b = tone(k, 'sine', 760 * v, t + 0.27, 0.35, 0.004, 0.08);
  b.frequency.exponentialRampToValueAtTime(900 * v, t + 0.31);
};

// Stumpcap marching: a heavy woody thump, slower and deeper than Wren's step.
SOUNDS.stumpStep = function (k, t) {
  const v = 1 + (k.r() - 0.5) * 0.24;
  const d = 0.22 + k.r() * 0.08;
  const o = tone(k, 'sine', 128 * v, t, 1, 0.005, d);
  o.frequency.exponentialRampToValueAtTime(74 * v, t + 0.11);
  tone(k, 'triangle', 286 * v, t, 0.6 + k.r() * 0.2, 0.002, 0.1);
  tone(k, 'sine', 790 * v, t, 0.2, 0.0015, 0.045);
  hiss(k, 'bandpass', 520 * v, 1.5, t, 0.08, 0.002, 0.03);
};

// Stumpcap walks into something: a low wooden knock and its small rebound.
SOUNDS.stumpBump = function (k, t) {
  const v = 1 + (k.r() - 0.5) * 0.08;
  woodKnock(k, t, 176 * v, 1, 0.15);
  woodKnock(k, t + 0.115, 190 * v, 0.38, 0.1);
};

// Stumpcap wakes: a creak that opens and closes like a yawn, with a sleepy voice under it.
SOUNDS.stumpWake = function (k, t) {
  creak(k, t, 0.62,
    function (x) { return 30 + 27 * Math.sin(Math.PI * Math.pow(x, 0.8)); },
    function (x) { return 400 + 380 * Math.sin(Math.PI * Math.pow(x, 0.8)); },
    6);
  const o = osc(k, stringWave(k.ctx), 150, t + 0.05, t + 0.84);
  o.frequency.linearRampToValueAtTime(216, t + 0.32);
  o.frequency.linearRampToValueAtTime(126, t + 0.76);
  const lp = filt(k, 'lowpass', 520, 4);
  lp.frequency.setValueAtTime(520, t + 0.05);
  lp.frequency.linearRampToValueAtTime(940, t + 0.32);
  lp.frequency.linearRampToValueAtTime(400, t + 0.76);
  const g = gain(k);
  swellEnv(g.gain, t + 0.05, 0.5, 0.2, 0.1, 0.46);
  o.connect(lp);
  lp.connect(g);
  g.connect(k.out);
};

// Root gate opens: the creak rises, then the lattice knocks into place.
SOUNDS.gateOpen = function (k, t) {
  creak(k, t, 0.5,
    function (x) { return 22 + 48 * x * x; },
    function (x) { return 330 + 500 * x; },
    6);
  woodKnock(k, t + 0.5, 262, 0.5, 0.12);
};

// Root gate closes: the creak falls and ends on a lower thud.
SOUNDS.gateClose = function (k, t) {
  creak(k, t, 0.5,
    function (x) { return 66 - 44 * Math.sqrt(x); },
    function (x) { return 800 - 500 * x; },
    6);
  woodKnock(k, t + 0.5, 150, 0.7, 0.16);
};

// A Glowbud lights: the next kalimba note of the scale walk.
SOUNDS.budOn = function (k, t, p) {
  kalimba(k, t, mtof(pentMidi(p.key + 12, p.idx)), 1, 1.05, true);
};

// A Glowbud goes dark: the same note, damped by a fingertip and sagging in pitch.
SOUNDS.budOff = function (k, t, p) {
  const f = mtof(pentMidi(p.key + 12, p.idx));
  const o = tone(k, 'sine', f, t, 0.9, 0.004, 0.34);
  o.frequency.setValueAtTime(f, t + 0.03);
  o.frequency.exponentialRampToValueAtTime(f * 0.75, t + 0.24);
  hiss(k, 'lowpass', 700, 0, t, 0.08, 0.002, 0.03);
};

// Level solved: carry the scale walk on up from wherever it stands and land on a rolled tonic chord.
SOUNDS.solve = function (k, t, p) {
  const base = p.key + 12;
  let top = Math.max(5, Math.ceil((p.idx + 2) / 5) * 5);
  let from = Math.max(p.idx, top - 4);
  while (top > 5) { top -= 5; from -= 5; } // always resolve in the same sweet register
  let tt = t;
  for (let i = from; i < top; i++) {
    const j = i - from;
    kalimba(k, tt, mtof(pentMidi(base, i)), 0.5 + 0.09 * j, 0.7, false);
    tt += 0.105 + j * 0.012;
  }
  tt += 0.03;
  const tonic = pentMidi(base, top);
  const chord = [tonic - 12, tonic - 8, tonic - 5, tonic];
  for (let i = 0; i < chord.length; i++) {
    const lead = i === chord.length - 1;
    celesta(k, tt + i * 0.042, mtof(chord[i]), lead ? 0.6 : 0.32, lead ? 2.2 : 1.8);
  }
  kalimba(k, tt + 0.126, mtof(tonic), 0.5, 1.5, false);
  const low = mtof(tonic - 24);
  glass(k, tt, [[low, 1], [low * 2.004, 0.8], [low * 3, 0.45]], 0.3, 0.4, 0.25, 1.6);
  celesta(k, tt + 0.46, mtof(tonic + 7), 0.2, 1.3);
};

// Undo: a soft pluck played backwards. It swells, brightens, and stops.
SOUNDS.undo = function (k, t, p) {
  const f = mtof(p.key + 4);
  const d = 0.26;
  const o = osc(k, stringWave(k.ctx), f, t, t + d + 0.05);
  const lp = filt(k, 'lowpass', f * 1.4, 0);
  lp.frequency.setValueAtTime(f * 1.4, t);
  lp.frequency.exponentialRampToValueAtTime(f * 6, t + d);
  const g = gain(k);
  g.gain.setValueAtTime(0.002, t);
  g.gain.exponentialRampToValueAtTime(1, t + d);
  g.gain.linearRampToValueAtTime(0, t + d + 0.022);
  o.connect(lp);
  lp.connect(g);
  g.connect(k.out);
  const tink = osc(k, 'sine', Math.min(f * 6.27, 5400), t + d - 0.07, t + d + 0.05);
  const tg = gain(k);
  tg.gain.setValueAtTime(0.0005, t + d - 0.07);
  tg.gain.exponentialRampToValueAtTime(0.09, t + d);
  tg.gain.linearRampToValueAtTime(0, t + d + 0.012);
  tink.connect(tg);
  tg.connect(k.out);
};

// Restart: a quick tumble back down the scale to the bottom note.
SOUNDS.restart = function (k, t, p) {
  const seq = [4, 3, 2, 1, 0];
  let tt = t;
  for (let i = 0; i < seq.length; i++) {
    const last = i === seq.length - 1;
    nylon(k, tt, mtof(pentMidi(p.key, seq[i])), last ? 1 : 0.6 + i * 0.06, last ? 0.55 : 0.2);
    tt += 0.062;
  }
};

// Button tick: a fingernail on the music box lid.
SOUNDS.ui = function (k, t) {
  tone(k, 'sine', 1180, t, 0.8, 0.0015, 0.04);
  tone(k, 'sine', 1770, t, 0.25, 0.001, 0.02);
  hiss(k, 'bandpass', 2600, 1.5, t, 0.06, 0.001, 0.01);
};

// Hint: two gentle notes, a fifth leaning up to the tonic.
SOUNDS.hint = function (k, t, p) {
  const a = mtof(p.key + 7);
  const b = mtof(p.key + 12);
  nylon(k, t, a, 0.8, 0.55);
  tone(k, 'sine', a * 2, t, 0.1, 0.004, 0.3);
  nylon(k, t + 0.19, b, 0.9, 0.7);
  tone(k, 'sine', b * 2, t + 0.19, 0.12, 0.004, 0.4);
};

/**
 * Build one one-shot sound on any audio context (live or offline).
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} dest where the sound is connected
 * @param {string} name one of SOUND_NAMES
 * @param {number} [when] start time on the context clock (default: now)
 * @param {object} [params] { chapter 1..3, idx (Glowbud scale step), alt (other foot), seed, rng, level }
 * @returns {object|null} the kit ({ end, done, ... }), or null for an unknown name
 */
export function buildSound(ctx, dest, name, when, params) {
  const fn = SOUNDS[name];
  if (typeof fn !== 'function') return null;
  const p = params || {};
  const chapter = CHAPTERS[clamp(Math.round(Number(p.chapter) || 1), 1, 3)];
  const r = p.rng || makeRng(p.seed);
  const level = typeof p.level === 'number' ? p.level : LEVELS[name];
  const k = makeKit(ctx, dest, level, r);
  const t = typeof when === 'number' ? when : ctx.currentTime;
  fn(k, t, { key: chapter.key, idx: clamp(Math.round(Number(p.idx) || 0), 0, BUD_TOP), alt: !!p.alt });
  return k;
}

// ---------------------------------------------------------------------------------------------
// 4. The engine
// ---------------------------------------------------------------------------------------------

function softClipCurve() {
  // Straight up to 0.6, then bends over to a ceiling of about 0.83. Untouched audio stays untouched.
  const n = 2049;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= 0.6 ? a : 0.6 + 0.25 * Math.tanh((a - 0.6) / 0.25);
    curve[i] = x < 0 ? -y : y;
  }
  return curve;
}

// A gain that is only ever moved by straight ramps, and remembers them. Knowing the ramp means a
// new fade can start from the true current value in every browser, and (unlike setTargetAtTime in
// Chromium) the ramp keeps time even while nothing is playing through the node.
function makeFader(param, value) {
  param.value = value;
  return { param, v0: value, v1: value, t0: 0, t1: 0 };
}

function faderValue(f, now) {
  if (now >= f.t1) return f.v1;
  if (now <= f.t0) return f.v0;
  return f.v0 + ((f.v1 - f.v0) * (now - f.t0)) / (f.t1 - f.t0);
}

function fadeTo(f, target, now, seconds) {
  const from = faderValue(f, now);
  try { f.param.cancelScheduledValues(now); } catch (e) { /* nothing scheduled */ }
  f.param.setValueAtTime(from, now);
  f.param.linearRampToValueAtTime(target, now + seconds);
  f.v0 = from;
  f.v1 = target;
  f.t0 = now;
  f.t1 = now + seconds;
}

function nearestHome(idx, home, lo, hi) {
  const offsets = [0, 1, -1, 2, -2, 3, -3];
  for (let i = 0; i < offsets.length; i++) {
    const c = idx + offsets[i];
    if (c < lo || c > hi) continue;
    const degree = ((c % 5) + 5) % 5;
    if (home.indexOf(degree) >= 0) return c;
  }
  return idx;
}

function bounce(idx, lo, hi) {
  if (idx < lo) return lo + (lo - idx);
  if (idx > hi) return hi - (idx - hi);
  return idx;
}

/**
 * The whole audio graph on one context. The exported API below owns a single live engine; the
 * check script builds engines on OfflineAudioContexts with { manual: true } and drives tick() itself.
 * @param {BaseAudioContext} ctx
 * @param {object} [options] { seed, manual }
 */
export function createAudioEngine(ctx, options) {
  const opt = options || {};
  const manual = !!opt.manual;
  const r = makeRng(opt.seed);

  const born = ctx.currentTime;

  // master -> compressor -> soft clip -> speakers
  const master = ctx.createGain();
  const masterFader = makeFader(master.gain, MASTER_LEVEL);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  try {
    // Chromium's compressor starts closed and opens at its release rate, which would swallow the
    // very first sound. A zero release for the first moments opens it at once.
    comp.release.setValueAtTime(0, born);
    comp.release.setValueAtTime(0.2, born + 0.05);
  } catch (e) { /* the plain value above stands */ }
  const clip = ctx.createWaveShaper();
  clip.curve = softClipCurve();
  master.connect(comp);
  comp.connect(clip);
  clip.connect(ctx.destination);

  const sfx = ctx.createGain();
  sfx.connect(master);
  const music = ctx.createGain();
  const musicFader = makeFader(music.gain, 0);
  music.connect(master);
  const layers = [];
  const layerFaders = [];
  for (let i = 0; i < 3; i++) {
    const g = ctx.createGain();
    layerFaders.push(makeFader(g.gain, 0));
    g.connect(music);
    layers.push(g);
  }

  // the cave: one short, dark feedback delay shared by everything
  const send = ctx.createGain();
  send.gain.value = ECHO_SEND;
  const delay = ctx.createDelay(0.5);
  delay.delayTime.value = ECHO_TIME;
  const dark = ctx.createBiquadFilter();
  dark.type = 'lowpass';
  dark.frequency.value = ECHO_TONE;
  dark.Q.value = 0;
  const feedback = ctx.createGain();
  feedback.gain.value = ECHO_FEEDBACK;
  sfx.connect(send);
  music.connect(send);
  send.connect(delay);
  delay.connect(dark);
  dark.connect(feedback);
  feedback.connect(delay);
  dark.connect(master);

  const st = {
    muted: false, hidden: false, playing: false, intensity: 0, chapter: 1,
    bud: 0, foot: false, lastStart: -1, lastAsk: -1e9, queuedWhileStopped: 0,
  };
  let voices = []; // one-shots: { name, start, kit, foley }
  const log = []; // recent play() decisions, for the check script
  const counts = { played: 0, dropped: 0, stolen: 0, pad: 0, kalimba: 0, celesta: 0 };

  const mu = {
    running: false, timer: null, t0: 0, padNext: 0, padCount: 0,
    kal: { next: 0, left: 0, idx: 5 },
    cel: { next: 0, idx: 10 },
    on: [false, false, false],
    voices: new Set(),
  };
  let hideTimer = null;
  let analyser = null;

  function running() {
    return manual || ctx.state === 'running';
  }

  function resume() {
    try {
      if (manual || st.hidden || ctx.state === 'running' || ctx.state === 'closed') return;
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(noop);
    } catch (e) { /* not allowed yet: the next gesture tries again */ }
  }

  // "Now" for telling one frame of requests from the next, in milliseconds.
  function frameClock() {
    if (manual || typeof performance === 'undefined') return ctx.currentTime * 1000;
    return performance.now();
  }

  // Stop a kit before its time. Browsers fire `ended` for sources that were stopped before they
  // started; the timer is a safety net for any that do not, so the nodes are always let go.
  function endEarly(k, when, fade) {
    stopKit(k, when, fade);
    if (!manual && !k.done) {
      setTimeout(function () { releaseKit(k); }, Math.max(0, when - ctx.currentTime) * 1000 + 400);
    }
  }

  function note(name, start, action, kit) {
    log.push({ name, at: ctx.currentTime, start, action, kit: kit || null });
    if (log.length > 64) log.shift();
  }

  // --- one-shots ---------------------------------------------------------------------------

  function play(name) {
    const fn = SOUNDS[name];
    if (typeof fn !== 'function') return;
    const p = { key: CHAPTERS[st.chapter].key, idx: 0, alt: false };
    // The scale walk keeps its place even while nothing can be heard.
    if (name === 'budOn') {
      p.idx = st.bud;
      st.bud = Math.min(st.bud + 1, BUD_TOP);
    } else if (name === 'budOff') {
      st.bud = Math.max(st.bud - 1, 0);
      p.idx = st.bud;
    } else if (name === 'solve') {
      p.idx = st.bud;
      st.bud = 0;
    } else if (name === 'restart') {
      st.bud = 0;
    } else if (name === 'step') {
      st.foot = !st.foot;
      p.alt = st.foot;
    }
    if (st.muted || st.hidden) return;

    // A context that is not running yet (first tap, or back from an interruption) keeps at most
    // two sounds waiting, so nothing piles up and bursts out later.
    if (!running()) {
      resume();
      if (st.queuedWhileStopped >= 2) return;
      st.queuedWhileStopped++;
    } else {
      st.queuedWhileStopped = 0;
    }

    const now = ctx.currentTime;
    voices = voices.filter(function (v) { return !v.kit.done && v.kit.end > now; });
    const foley = FOLEY[name] === 1;

    // Sounds asked for in the same frame are spread out, 40 to 70 ms apart, in the order asked.
    // A player action in a new frame does not queue behind the last turn's creatures.
    const clock = frameClock();
    const sameFrame = clock - st.lastAsk < 12;
    st.lastAsk = clock;
    let start = Math.max(now + 0.005, born + 0.02);
    if (st.lastStart + STAGGER_MAX > now && (sameFrame || ACTIONS[name] !== 1)) {
      start = Math.max(start, st.lastStart + STAGGER_MIN + r() * (STAGGER_MAX - STAGGER_MIN));
    } else if (LOOSE[name] === 1) {
      start += r() * 0.012;
    }
    if (foley && start - now > MAX_BACKLOG) {
      counts.dropped++;
      note(name, start, 'drop');
      return;
    }

    // Voices that will still be sounding when this one starts.
    const alive = voices.filter(function (v) { return v.kit.end > start; });
    let same = 0;
    for (let i = 0; i < alive.length; i++) if (alive[i].name === name) same++;
    if (foley && same >= MAX_SAME) {
      counts.dropped++;
      note(name, start, 'drop');
      return;
    }

    if (alive.length >= MAX_VOICES) {
      if (foley) {
        counts.dropped++;
        note(name, start, 'drop');
        return;
      }
      // Make room for a sound that matters: the oldest foley goes first, never the solve phrase.
      let victim = null;
      for (let i = 0; i < alive.length && !victim; i++) if (alive[i].foley) victim = alive[i];
      for (let i = 0; i < alive.length && !victim; i++) if (alive[i].name !== 'solve') victim = alive[i];
      if (victim) {
        endEarly(victim.kit, start + 0.03, 0.03);
        counts.stolen++;
      }
    }

    // Repeats inside one burst get a little quieter each time.
    const level = LEVELS[name] * Math.pow(0.84, same);
    const k = makeKit(ctx, sfx, level, r);
    fn(k, start, p);
    voices.push({ name, start, kit: k, foley });
    st.lastStart = Math.max(st.lastStart, start);
    counts.played++;
    note(name, start, 'play', k);
  }

  // --- music -------------------------------------------------------------------------------

  function musicKit(layer, level) {
    const k = makeKit(ctx, layers[layer], level, r);
    mu.voices.add(k);
    k.onDone = function (kit) { mu.voices.delete(kit); };
    return k;
  }

  // Layer 1: a slow breath of bowed glass on the drone. Breaths overlap, so it never stops.
  function schedulePad(t) {
    const C = CHAPTERS[st.chapter];
    const low = mtof(C.drone);
    const mid = mtof(C.drone + 12);
    const color = mtof(C.colors[mu.padCount % C.colors.length]);
    const k = musicKit(0, 1);
    const first = mu.padCount === 0;
    glass(k, t, [
      [low, 0.5],
      [mid, 1],
      [mid * 1.0032, 0.8],
      [mid * 1.4983 * 0.9988, 0.55],
      [color, 0.22],
    ], 0.026, first ? 1.6 : 3.2, 3.4, 4.6, true);
    mu.padCount++;
    counts.pad++;
  }

  // Layer 2: sparse kalimba. Short phrases that wander the scale and come to rest on a home note.
  function scheduleKalimba(now) {
    const C = CHAPTERS[st.chapter];
    const kal = mu.kal;
    if (kal.left <= 0) kal.left = 2 + Math.floor(r() * 3);
    let idx = bounce(kal.idx + pick(r, [-2, -1, -1, 1, 1, 2]), 2, 9);
    const last = kal.left === 1;
    if (last) idx = nearestHome(idx, C.home, 2, 9);
    kal.idx = idx;
    const t = kal.next + r() * 0.014;
    if (t >= now) {
      const k = musicKit(1, 1);
      kalimba(k, t, mtof(pentMidi(C.key, idx)), 0.052 + r() * 0.03, 1.5, false);
      counts.kalimba++;
    }
    kal.left--;
    if (kal.left > 0) {
      kal.next += C.beat * pick(r, [1, 1, 0.5, 1.5]);
    } else {
      const lit = clamp((st.intensity - LAYER2_AT) / (1 - LAYER2_AT), 0, 1);
      kal.next += C.beat * (2 + Math.round((1 - lit) * 3) + Math.floor(r() * 3));
    }
  }

  // Layer 3: a soft celesta counter-line, an octave up, on the off-beats, in long notes.
  function scheduleCelesta(now) {
    const C = CHAPTERS[st.chapter];
    const cel = mu.cel;
    let idx = bounce(cel.idx + pick(r, [-2, -1, -1, 1, 1, 2]), 7, 12);
    if (r() < 0.4) idx = nearestHome(idx, C.home, 7, 12);
    cel.idx = idx;
    const t = cel.next + r() * 0.014;
    if (t >= now) {
      const k = musicKit(2, 1);
      celesta(k, t, mtof(pentMidi(C.key, idx)), 0.032 + r() * 0.018, 2.2);
      counts.celesta++;
    }
    cel.next += C.beat * (pick(r, [2, 2, 3, 4]) + (r() < 0.2 ? 2 : 0));
  }

  function nextBeat(after, offsetBeats) {
    const beat = CHAPTERS[st.chapter].beat;
    const n = Math.ceil((after - mu.t0) / beat - offsetBeats);
    return mu.t0 + (Math.max(0, n) + offsetBeats) * beat;
  }

  function tick() {
    if (!mu.running) return;
    try {
      const now = ctx.currentTime;
      const horizon = now + LOOKAHEAD;
      if (mu.padNext < now - 0.5) mu.padNext = now + 0.02; // the clock ran on without us
      while (mu.padNext < horizon) {
        schedulePad(Math.max(mu.padNext, now + 0.01));
        mu.padNext += (mu.padCount === 1 ? 4.8 : 6.4) + r() * 0.8;
      }
      if (mu.on[1]) {
        if (mu.kal.next < now - 0.5) { mu.kal.next = nextBeat(now + 0.1, 0); mu.kal.left = 0; }
        let guard = 0;
        while (mu.kal.next < horizon && guard++ < 16) scheduleKalimba(now);
      }
      if (mu.on[2]) {
        if (mu.cel.next < now - 0.5) mu.cel.next = nextBeat(now + 0.1, 0.5);
        let guard = 0;
        while (mu.cel.next < horizon && guard++ < 16) scheduleCelesta(now);
      }
    } catch (e) { /* a missed tick is only a moment of quiet */ }
  }

  function setLayers(now) {
    const want = [true, st.intensity > LAYER2_AT, st.intensity > LAYER3_AT];
    for (let i = 0; i < 3; i++) {
      if (want[i] === mu.on[i]) continue;
      mu.on[i] = want[i];
      fadeTo(layerFaders[i], want[i] ? 1 : 0, now, LAYER_FADE);
      // A layer that just joined speaks soon, on the beat, so progress is heard at once.
      if (want[i] && i === 1) { mu.kal.next = nextBeat(now + 0.3, 0); mu.kal.left = 0; }
      if (want[i] && i === 2) mu.cel.next = nextBeat(now + 0.5, 0.5);
    }
  }

  function startMusic(now) {
    mu.running = true;
    mu.t0 = now + 0.06;
    mu.padNext = mu.t0;
    mu.padCount = 0;
    mu.kal.next = mu.t0 + CHAPTERS[st.chapter].beat * 2;
    mu.kal.left = 0;
    mu.cel.next = mu.t0 + CHAPTERS[st.chapter].beat * 4.5;
    mu.on = [false, false, false];
    for (let i = 0; i < 3; i++) fadeTo(layerFaders[i], 0, now, 0.01);
    // the pad is the bed itself: it comes up with the bus, not a second later
    mu.on[0] = true;
    fadeTo(layerFaders[0], 1, now, 0.05);
    setLayers(now);
    fadeTo(musicFader, MUSIC_LEVEL, now, 0.6);
    if (!manual && mu.timer === null) mu.timer = setInterval(tick, TICK_MS);
    tick();
  }

  function stopMusicVoices(when, fade) {
    mu.voices.forEach(function (k) { endEarly(k, when, fade); });
    mu.voices.clear();
  }

  function stopMusic(now) {
    mu.running = false;
    if (mu.timer !== null) { clearInterval(mu.timer); mu.timer = null; }
    fadeTo(musicFader, 0, now, 0.45);
    stopMusicVoices(now + 0.6, 0.1);
  }

  function updateMusic() {
    const now = ctx.currentTime;
    const want = st.playing && !st.muted && !st.hidden;
    if (want && !mu.running) startMusic(now);
    else if (!want && mu.running) stopMusic(now);
    else if (mu.running) setLayers(now);
  }

  function setMusic(o) {
    if (!o || typeof o !== 'object') return;
    const before = st.chapter;
    if (typeof o.playing === 'boolean') st.playing = o.playing;
    if (typeof o.intensity === 'number' && o.intensity === o.intensity) st.intensity = clamp(o.intensity, 0, 1);
    if (typeof o.chapter === 'number' && o.chapter === o.chapter) st.chapter = clamp(Math.round(o.chapter), 1, 3);
    // No Glowbud lit means the scale walk is back at the bottom, however we got here (undo, say).
    if (st.intensity === 0) st.bud = 0;
    if (st.chapter !== before && mu.running) {
      // New chapter, new key: let the old harmony go and start the next breath soon.
      const now = ctx.currentTime;
      stopMusicVoices(now + 1.1, 0.5);
      mu.padNext = now + 0.5;
      mu.padCount = 0;
      mu.t0 = now + 0.5;
      mu.kal.next = mu.t0 + CHAPTERS[st.chapter].beat * 2;
      mu.kal.left = 0;
      mu.cel.next = mu.t0 + CHAPTERS[st.chapter].beat * 3.5;
    }
    updateMusic();
    if (mu.running) tick();
  }

  function setMuted(muted) {
    st.muted = !!muted;
    fadeTo(masterFader, st.muted ? 0 : MASTER_LEVEL, ctx.currentTime, st.muted ? 0.06 : 0.09);
    updateMusic();
  }

  // Page hidden: the bed fades out, then the whole context sleeps. Visible again: wake up.
  function setHidden(hidden) {
    hidden = !!hidden;
    if (hidden === st.hidden) return;
    st.hidden = hidden;
    if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null; }
    updateMusic();
    if (manual) return;
    if (hidden) {
      hideTimer = setTimeout(function () {
        hideTimer = null;
        try {
          if (st.hidden && ctx.state === 'running') {
            const p = ctx.suspend();
            if (p && typeof p.catch === 'function') p.catch(noop);
          }
        } catch (e) { /* nothing to do */ }
      }, 700);
    } else {
      resume();
    }
  }

  // For the check script and the audition page.
  function debug(o) {
    const now = ctx.currentTime;
    let nodes = 0;
    voices.forEach(function (v) { nodes += v.kit.nodes.length; });
    mu.voices.forEach(function (k) { nodes += k.nodes.length; });
    const info = {
      state: ctx.state, time: now, sampleRate: ctx.sampleRate,
      muted: st.muted, hidden: st.hidden, bud: st.bud, nodes,
      voices: voices.filter(function (v) { return !v.kit.done && v.kit.end > now; }).length,
      music: {
        running: mu.running, playing: st.playing, intensity: st.intensity, chapter: st.chapter,
        layers: mu.on.slice(), voices: mu.voices.size,
        gains: layerFaders.map(function (f) { return faderValue(f, now); }),
        bus: faderValue(musicFader, now),
      },
      counts: Object.assign({}, counts),
      log: log.map(function (l) {
        return { name: l.name, at: l.at, start: l.start, action: l.action, end: l.kit ? l.kit.end : l.start };
      }),
    };
    if (o && o.meter) {
      try {
        if (!analyser) {
          analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          clip.connect(analyser);
        }
        const buf = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buf);
        let peak = 0;
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const a = Math.abs(buf[i]);
          if (a > peak) peak = a;
          sum += buf[i] * buf[i];
        }
        info.meter = { peak, rms: Math.sqrt(sum / buf.length) };
      } catch (e) { info.meter = null; }
    }
    return info;
  }

  // `inputs` is for the check script, which feeds probe tones through the layer gains.
  return { ctx, play, setMusic, setMuted, setHidden, resume, tick, debug, inputs: { sfx, layers } };
}

// ---------------------------------------------------------------------------------------------
// 5. Public API (SPEC section 7)
// ---------------------------------------------------------------------------------------------

let engine = null;
let failed = false;
const wanted = { muted: false, music: { playing: false, intensity: 0, chapter: 1 } };
// The app shell reports when the whole app goes to the background; a browser tab uses visibilitychange.
let appHidden = false;
function pageHidden() {
  return appHidden || (typeof document !== 'undefined' && document.visibilityState === 'hidden');
}

/** Call from the first user gesture. Safe to call again; later calls wake a suspended context. */
export function initAudio() {
  try {
    if (!engine && !failed) {
      if (typeof window === 'undefined') return false;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      let ctx;
      try {
        ctx = new AC({ latencyHint: 'interactive' });
      } catch (e) {
        ctx = new AC();
      }
      try {
        engine = createAudioEngine(ctx);
      } catch (e) {
        failed = true;
        try { ctx.close(); } catch (e2) { /* nothing */ }
        return false;
      }
      engine.setMuted(wanted.muted);
      engine.setMusic(wanted.music);
      if (typeof document !== 'undefined' && document.addEventListener) {
        const onVisibility = function () {
          try { engine.setHidden(pageHidden()); } catch (e) { /* never throw */ }
        };
        document.addEventListener('visibilitychange', onVisibility);
        onVisibility();
        // Any later touch or key press wakes a context the browser put to sleep.
        const wake = function () {
          try { engine.resume(); } catch (e) { /* never throw */ }
        };
        window.addEventListener('pointerdown', wake, { passive: true });
        window.addEventListener('keydown', wake, { passive: true });
      }
    }
    if (!engine) return false;
    engine.resume();
    return true;
  } catch (e) {
    return false;
  }
}

/** Mute or unmute everything. Remembered even before initAudio. Ramps, so it never clicks. */
export function setMuted(muted) {
  wanted.muted = !!muted;
  try {
    if (engine) engine.setMuted(wanted.muted);
  } catch (e) { /* never throw */ }
}

export function isMuted() {
  return wanted.muted;
}

/** The app went to the background (true) or came back (false). Sound sleeps while it is away. */
export function setAppHidden(hidden) {
  appHidden = !!hidden;
  try {
    if (engine) engine.setHidden(pageHidden());
  } catch (e) { /* never throw */ }
}

/** Play a one-shot sound by name. Unknown names are ignored. */
export function play(name) {
  try {
    if (engine) engine.play(name);
  } catch (e) { /* never throw */ }
}

/** The adaptive bed. Any of the three fields may be left out to keep its current value. */
export function setMusic(options) {
  try {
    if (!options || typeof options !== 'object') return;
    const m = wanted.music;
    if (typeof options.playing === 'boolean') m.playing = options.playing;
    if (typeof options.intensity === 'number' && options.intensity === options.intensity) {
      m.intensity = clamp(options.intensity, 0, 1);
    }
    if (typeof options.chapter === 'number' && options.chapter === options.chapter) {
      m.chapter = clamp(Math.round(options.chapter), 1, 3);
    }
    if (engine) engine.setMusic(m);
  } catch (e) { /* never throw */ }
}

/** Test hook: a snapshot of the live engine (null before initAudio). { meter: true } adds output levels. */
export function audioDebug(options) {
  try {
    return engine ? engine.debug(options) : null;
  } catch (e) {
    return null;
  }
}
