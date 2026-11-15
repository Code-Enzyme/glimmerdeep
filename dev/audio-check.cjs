#!/usr/bin/env node
// Measures every Glimmerdeep sound, because nobody here can listen.
//
//   node dev/audio-check.cjs            run every check, print the tables, exit 1 on any failure
//   node dev/audio-check.cjs --levels   also print the level each sound would need to hit its target peak
//
// What it does
//   1. imports src/audio.js in Node and calls every export (must be silent no-ops, never throw)
//   2. bundles src/audio.js to dev/audio.bundle.js (used by dev/audio.html, the audition page)
//   3. serves the project folder on a random local port and opens it in headless Chromium
//   4. renders every one-shot through an OfflineAudioContext and measures it
//   5. drives whole engines offline: Glowbud scale walk, a busy turn, the music bed, mute, page hidden
//   6. runs the real thing in a live AudioContext and watches for console errors

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const PEAK_LIMIT = 0.9;
const ORDINARY_LIMIT = 1.2;
const SOLVE_LIMIT = 3.5;
const API = ['initAudio', 'setMuted', 'isMuted', 'play', 'setMusic'];

let failures = 0;
function check(ok, label, detail) {
  if (!ok) failures++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + label + (detail ? '  [' + detail + ']' : ''));
}
function head(title) {
  console.log('\n' + title);
}
function pad(s, n, right) {
  s = String(s);
  return right ? s.padEnd(n) : s.padStart(n);
}
function table(cols, rows) {
  console.log(cols.map((c) => pad(c.title, c.width, c.left)).join(' '));
  console.log(cols.map((c) => '-'.repeat(c.width)).join(' '));
  for (const r of rows) console.log(cols.map((c) => pad(c.get(r), c.width, c.left)).join(' '));
}

// ---------------------------------------------------------------------------------------------
// Code that runs inside the page. It is stringified and injected, so it must be self-contained.
// ---------------------------------------------------------------------------------------------

function pageLib() {
  const SR = 44100;
  const SILENCE = 1e-3; // -60 dBFS
  const G = window.GAudio;

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const tr = re[i]; re[i] = re[j]; re[j] = tr;
        const ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang);
      const wi = Math.sin(ang);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1;
        let ci = 0;
        for (let j = 0; j < half; j++) {
          const a = i + j;
          const b = a + half;
          const vr = re[b] * cr - im[b] * ci;
          const vi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - vr; im[b] = im[a] - vi;
          re[a] += vr; im[a] += vi;
          const t = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = t;
        }
      }
    }
  }

  // Averaged power spectrum of x[a, b). Sum of the bins in a band = mean square of that band.
  function spectrum(x, a, b, N) {
    const P = new Float64Array(N / 2);
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    const w = new Float64Array(N);
    for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    let frames = 0;
    for (let s = a; s < b; s += N / 2) {
      re.fill(0); im.fill(0);
      for (let i = 0; i < N && s + i < b; i++) re[i] = x[s + i] * w[i];
      fft(re, im);
      for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
      frames++;
      if (s + N >= b) break;
    }
    const norm = 2 / (N * N * 0.375 * Math.max(frames, 1));
    for (let k = 0; k < N / 2; k++) P[k] *= norm;
    return P;
  }

  function centroidOf(P, N) {
    let num = 0;
    let den = 0;
    for (let k = Math.ceil((30 * N) / SR); k < P.length; k++) {
      const m = Math.sqrt(P[k]);
      num += ((k * SR) / N) * m;
      den += m;
    }
    return den > 0 ? num / den : 0;
  }

  function dominantOf(P, N) {
    let best = Math.ceil((40 * N) / SR);
    for (let k = best; k < P.length - 1; k++) if (P[k] > P[best]) best = k;
    let shift = 0;
    if (best > 0 && best < P.length - 1 && P[best] > 0 && P[best - 1] > 0 && P[best + 1] > 0) {
      const l = Math.log(P[best - 1]);
      const c = Math.log(P[best]);
      const r = Math.log(P[best + 1]);
      const d = l - 2 * c + r;
      if (d !== 0) shift = (0.5 * (l - r)) / d;
    }
    return ((best + shift) * SR) / N;
  }

  function bandRms(P, N, lo, hi) {
    let sum = 0;
    for (let k = Math.ceil((lo * N) / SR); k < P.length && (k * SR) / N < hi; k++) sum += P[k];
    return Math.sqrt(sum);
  }

  // Amplitude of one frequency in x[a, b) (a single-bin Fourier sum with a Hann window).
  function probeLevel(x, a, b, freq) {
    a = Math.floor(a); b = Math.floor(b);
    let re = 0;
    let im = 0;
    let norm = 0;
    for (let i = a; i < b; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - a)) / (b - a));
      const ph = (2 * Math.PI * freq * i) / SR;
      re += x[i] * w * Math.cos(ph);
      im += x[i] * w * Math.sin(ph);
      norm += w;
    }
    return (2 * Math.sqrt(re * re + im * im)) / norm;
  }

  function rmsOf(x, a, b) {
    let sum = 0;
    for (let i = a; i < b; i++) sum += x[i] * x[i];
    return Math.sqrt(sum / Math.max(1, b - a));
  }

  function peakOf(x, a, b) {
    let peak = 0;
    for (let i = a; i < b; i++) { const v = Math.abs(x[i]); if (v > peak) peak = v; }
    return peak;
  }

  // Everything we want to know about x[a, b), times relative to a.
  function describe(x, a, b, N) {
    a = Math.max(0, Math.floor(a === undefined ? 0 : a));
    b = Math.min(x.length, Math.floor(b === undefined ? x.length : b));
    N = N || 4096;
    let peak = 0;
    let first = -1;
    let last = -1;
    for (let i = a; i < b; i++) {
      const v = Math.abs(x[i]);
      if (v > peak) peak = v;
      if (v > SILENCE) { if (first < 0) first = i; last = i; }
    }
    if (first < 0) return { silent: true, peak, rms: rmsOf(x, a, b), dur: 0, centroid: 0, dominant: 0, tilt: 0, attack: 0 };
    const P = spectrum(x, first, last + 1, N);
    const mid = (first + last + 1) >> 1;
    const c1 = centroidOf(spectrum(x, first, mid, N), N);
    const c2 = centroidOf(spectrum(x, mid, last + 1, N), N);
    const bands = [];
    for (let i = 0; i < 24; i++) {
      const lo = 60 * Math.pow(10000 / 60, i / 24);
      const hi = 60 * Math.pow(10000 / 60, (i + 1) / 24);
      bands.push(bandRms(P, N, lo, hi));
    }
    const env = [];
    const frame = Math.round(SR * 0.01);
    let top = 0;
    for (let s = a; s < b; s += frame) {
      env.push(rmsOf(x, s, Math.min(b, s + frame)));
      if (env[env.length - 1] > env[top]) top = env.length - 1;
    }
    return {
      silent: false,
      peak,
      rms: rmsOf(x, first, last + 1),
      start: (first - a) / SR,
      dur: (last + 1 - a) / SR,
      centroid: centroidOf(P, N),
      dominant: dominantOf(P, N),
      tilt: c1 > 0 && c2 > 0 ? Math.log2(c2 / c1) : 0,
      attack: Math.max(0, ((a + top * frame + frame / 2) - first) / SR),
      low: bandRms(P, N, 30, 700),
      high: bandRms(P, N, 700, 20000),
      bands,
      env,
    };
  }

  // How many separate pitches stand out of the long-term spectrum (a rough count of "voices").
  function countTones(x, a, b) {
    const N = 16384;
    const P = spectrum(x, Math.floor(a), Math.floor(b), N);
    let max = 0;
    for (let k = 0; k < P.length; k++) if (P[k] > max) max = P[k];
    const floor = max * Math.pow(10, -4.6);
    let n = 0;
    for (let k = 12; k < P.length - 8; k++) {
      if (P[k] < floor) continue;
      let top = true;
      for (let j = 1; j <= 3 && top; j++) if (P[k - j] > P[k] || P[k + j] >= P[k]) top = false;
      if (top && P[k] > 4 * P[k - 7] && P[k] > 4 * P[k + 7]) n++;
    }
    return n;
  }

  function cosine(u, v) {
    const n = Math.max(u.length, v.length);
    let uv = 0;
    let uu = 0;
    let vv = 0;
    for (let i = 0; i < n; i++) {
      const p = u[i] || 0;
      const q = v[i] || 0;
      uv += p * q; uu += p * p; vv += q * q;
    }
    return uu > 0 && vv > 0 ? uv / Math.sqrt(uu * vv) : 0;
  }

  function slim(d) {
    const o = {};
    for (const key in d) if (key !== 'bands' && key !== 'env') o[key] = d[key];
    return o;
  }

  // One sound, dry, straight from its builder.
  async function renderDry(name, params, seconds) {
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * (seconds || 4.5)), SR);
    const kit = G.buildSound(ctx, ctx.destination, name, 0, params);
    const buf = await ctx.startRendering();
    return { x: buf.getChannelData(0), end: kit.end };
  }

  // A whole engine, rendered offline. `events` is a list of [time, fn(engine)]. tick() runs every
  // 100 ms of audio time, as the live timer would.
  async function runEngine(seconds, events, seed) {
    const length = Math.ceil(SR * seconds);
    const ctx = new OfflineAudioContext(1, length, SR);
    const eng = G.createAudioEngine(ctx, { seed: seed === undefined ? 7 : seed, manual: true });
    const slots = new Map();
    const add = function (time, fn) {
      const frame = Math.ceil((time * SR) / 128) * 128;
      if (frame >= length) return;
      if (!slots.has(frame)) slots.set(frame, []);
      slots.get(frame).push(fn);
    };
    for (const ev of events) add(ev[0], ev[1]);
    for (let t = 0.1; t < seconds; t += 0.1) add(t, function (e) { e.tick(); });
    const errors = [];
    slots.forEach(function (fns, frame) {
      if (frame === 0) return;
      ctx.suspend(frame / SR).then(function () {
        for (const fn of fns) {
          try { fn(eng); } catch (err) { errors.push(String(err && err.stack ? err.stack : err)); }
        }
        ctx.resume();
      });
    });
    for (const fn of slots.get(0) || []) fn(eng);
    eng.tick();
    const buf = await ctx.startRendering();
    return { x: buf.getChannelData(0), eng, errors };
  }

  // --- scenarios -----------------------------------------------------------------------------

  async function sounds() {
    const rows = [];
    const full = {};
    for (const name of G.SOUND_NAMES) {
      const dry = await renderDry(name, { seed: 1, chapter: 1, idx: 0 });
      const d = describe(dry.x);
      full[name] = d;
      const wet = await runEngine(5, [[0.3, function (e) { e.play(name); }]]);
      const w = describe(wet.x, 0.3 * SR);
      // the same sound in every key and at every place in the scale walk
      let worstDur = d.dur;
      let worstPeak = d.peak;
      let worstEnd = dry.end;
      for (const chapter of [1, 2, 3]) {
        for (const idx of [0, 3, 4, 7, 10]) {
          for (const seed of [2, 3]) {
            const r = await renderDry(name, { seed, chapter, idx, alt: seed === 3 });
            const m = describe(r.x);
            worstDur = Math.max(worstDur, m.dur);
            worstPeak = Math.max(worstPeak, m.peak);
            worstEnd = Math.max(worstEnd, r.end);
          }
        }
      }
      const tail = peakOf(dry.x, dry.x.length - 2205, dry.x.length);
      rows.push(Object.assign(slim(d), {
        name, end: dry.end, worstDur, worstPeak, worstEnd, tail,
        wetPeak: w.peak, wetDur: w.dur, wetRms: w.rms, errors: wet.errors,
      }));
    }
    const pairs = [];
    const names = G.SOUND_NAMES;
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = full[names[i]];
        const b = full[names[j]];
        pairs.push({
          a: names[i], b: names[j],
          spec: cosine(a.bands, b.bands),
          env: cosine(a.env, b.env),
          tilt: Math.abs(a.tilt - b.tilt),
          dur: Math.abs(Math.log2(a.dur / b.dur)),
        });
      }
    }
    pairs.sort(function (p, q) { return q.spec * q.env - p.spec * p.env; });
    return { rows, pairs: pairs.slice(0, 12) };
  }

  async function variation() {
    const out = [];
    for (const name of ['step', 'moth', 'whelkMove', 'stumpStep']) {
      const list = [];
      for (let seed = 1; seed <= 6; seed++) {
        const r = await renderDry(name, { seed, alt: seed % 2 === 0 }, 1.5);
        list.push(slim(describe(r.x)));
      }
      const spread = function (key) {
        const v = list.map(function (m) { return m[key]; });
        const mean = v.reduce(function (s, q) { return s + q; }, 0) / v.length;
        return (Math.max.apply(null, v) - Math.min.apply(null, v)) / mean;
      };
      const again = slim(describe((await renderDry(name, { seed: 1, alt: false }, 1.5)).x));
      out.push({
        name,
        centroids: list.map(function (m) { return Math.round(m.centroid); }),
        pitches: list.map(function (m) { return Math.round(m.dominant); }),
        durs: list.map(function (m) { return Math.round(m.dur * 1000); }),
        centroidSpread: spread('centroid'),
        pitchSpread: spread('dominant'),
        durSpread: spread('dur'),
        repeatable: Math.abs(again.centroid - list[0].centroid) < 0.01 && Math.abs(again.dur - list[0].dur) < 1e-4,
      });
    }
    return out;
  }

  async function budWalk() {
    const plan = [
      [0.1, 'budOn'], [0.8, 'budOn'], [1.5, 'budOn'], [2.2, 'budOn'], [2.9, 'budOn'],
      [3.6, 'budOff'], [4.3, 'budOff'], [5.0, 'budOn'],
      [5.7, 'restart'], [6.9, 'budOn'],
      [7.6, 'budOn'], [8.3, 'solve'], [12.2, 'budOn'],
    ];
    const res = await runEngine(13.2, plan.map(function (p) {
      return [p[0], function (e) { e.play(p[1]); }];
    }));
    const out = [];
    for (const p of plan) {
      const a = (p[0] + 0.012) * SR;
      const early = describe(res.x, a, a + 0.06 * SR, 8192);
      const whole = describe(res.x, a, a + 0.5 * SR, 8192);
      const late = describe(res.x, a + 0.14 * SR, a + 0.24 * SR, 8192);
      out.push({ at: p[0], name: p[1], pitch: whole.dominant, early: early.dominant, late: late.dominant, peak: whole.peak });
    }
    const solve = describe(res.x, 8.3 * SR, 12.2 * SR);
    // the fall of 'budOff', measured dry so the echo of its own attack does not hide it
    const dry = await renderDry('budOff', { seed: 1, chapter: 1, idx: 4 }, 1);
    const fall = {
      head: describe(dry.x, 0, 0.04 * SR, 8192).dominant,
      mid: describe(dry.x, 0.06 * SR, 0.11 * SR, 8192).dominant,
      tail: describe(dry.x, 0.12 * SR, 0.2 * SR, 8192).dominant,
      midLevel: peakOf(dry.x, 0.06 * SR, 0.11 * SR) / peakOf(dry.x, 0, dry.x.length),
    };
    return { notes: out, fall, solveDur: solve.dur, solvePeak: solve.peak, errors: res.errors, bud: res.eng.debug().bud };
  }

  async function burst() {
    const names = ['step', 'moth', 'moth', 'moth', 'moth', 'moth', 'whelkMove', 'whelkMove', 'stumpStep',
      'stumpBump', 'whelkHide', 'gateOpen', 'budOn', 'solve'];
    let log = null;
    const res = await runEngine(5.5, [
      [0.5, function (e) { names.forEach(function (n) { e.play(n); }); log = e.debug().log; }],
    ]);
    const played = log.filter(function (l) { return l.action === 'play'; });
    const gaps = [];
    for (let i = 1; i < played.length; i++) gaps.push(played[i].start - played[i - 1].start);
    // how many one-shots overlap at the worst moment
    let most = 0;
    for (const p of played) {
      let n = 0;
      for (const q of played) if (q.start <= p.start && q.end > p.start) n++;
      most = Math.max(most, n);
    }
    const d = describe(res.x);
    // and the flood: every sound four times in one frame
    const flood = await runEngine(6, [
      [0.2, function (e) { for (let i = 0; i < 4; i++) G.SOUND_NAMES.forEach(function (n) { e.play(n); }); }],
    ]);
    const f = describe(flood.x);
    const counts = flood.eng.debug().counts;
    return {
      asked: names.length,
      played: played.map(function (p) { return p.name + '@' + Math.round((p.start - 0.5) * 1000); }),
      dropped: log.filter(function (l) { return l.action === 'drop'; }).map(function (l) { return l.name; }),
      gaps, most, peak: d.peak, rms: d.rms,
      floodPeak: f.peak, floodPlayed: counts.played, floodDropped: counts.dropped, floodStolen: counts.stolen,
      errors: res.errors.concat(flood.errors),
    };
  }

  async function music() {
    const out = { levels: [], chapters: [] };
    for (const intensity of [0, 0.5, 1]) {
      const res = await runEngine(10, [
        [0, function (e) { e.setMusic({ playing: true, intensity, chapter: 1 }); }],
      ]);
      const d = describe(res.x);
      const dbg = res.eng.debug();
      out.levels.push(Object.assign(slim(d), {
        tones: countTones(res.x, 0, res.x.length),
        intensity, counts: dbg.counts, layers: dbg.music.layers, voices: dbg.music.voices,
        nodes: dbg.nodes, errors: res.errors,
      }));
    }
    for (const chapter of [1, 2, 3]) {
      const res = await runEngine(10, [
        [0, function (e) { e.setMusic({ playing: true, intensity: 1, chapter }); }],
      ]);
      const d = describe(res.x, 2 * SR, 10 * SR, 8192);
      out.chapters.push({ chapter, dominant: d.dominant, centroid: d.centroid, rms: d.rms, peak: d.peak });
    }
    // Layers fading: all on, then intensity drops to 0 at 8 s, back to 0.5 at 12 s. A steady probe
    // tone is fed through each layer's gain, so the fade is measured on the output itself.
    const probes = [9000, 10500, 12000];
    const events = [
      [0, function (e) {
        probes.forEach(function (freq, i) {
          const o = e.ctx.createOscillator();
          o.frequency.value = freq;
          const g = e.ctx.createGain();
          g.gain.value = 0.004;
          o.connect(g);
          g.connect(e.inputs.layers[i]);
          o.start(0);
        });
        e.setMusic({ playing: true, intensity: 1, chapter: 1 });
      }],
      [8, function (e) { e.setMusic({ intensity: 0 }); }],
      [12, function (e) { e.setMusic({ intensity: 0.5 }); }],
    ];
    const fade = await runEngine(15, events);
    const ref = probes.map(function (freq) { return probeLevel(fade.x, 7.5 * SR, 7.9 * SR, freq); });
    const gains = [];
    for (const t of [7.9, 8.15, 8.3, 8.6, 8.9, 9.2, 11.9, 12.15, 12.3, 12.6, 12.9, 13.3, 14.5]) {
      gains.push({
        t,
        g: probes.map(function (freq, i) { return probeLevel(fade.x, (t - 0.04) * SR, (t + 0.04) * SR, freq) / ref[i]; }),
      });
    }
    out.fade = {
      gains, errors: fade.errors,
      highBefore: describe(fade.x, 5 * SR, 8 * SR).high,
      highAfter: describe(fade.x, 10 * SR, 12 * SR).high,
      highBack: describe(fade.x, 12.3 * SR, 15 * SR).high,
    };
    // chapter change in the middle of the bed
    const change = await runEngine(12, [
      [0, function (e) { e.setMusic({ playing: true, intensity: 0, chapter: 1 }); }],
      [5, function (e) { e.setMusic({ chapter: 2 }); }],
    ]);
    out.change = {
      before: describe(change.x, 2 * SR, 5 * SR, 8192).dominant,
      after: describe(change.x, 8 * SR, 12 * SR, 8192).dominant,
      peak: peakOf(change.x, 0, change.x.length),
      errors: change.errors,
    };
    return out;
  }

  async function muteAndHide() {
    // loud material, muted at 3.0 s, unmuted at 5.0 s
    const res = await runEngine(8, [
      [0, function (e) { e.setMusic({ playing: true, intensity: 1, chapter: 1 }); }],
      [2.6, function (e) { e.play('solve'); }],
      [3.0, function (e) { e.setMuted(true); }],
      [4.0, function (e) { e.play('budOn'); }],
      [5.0, function (e) { e.setMuted(false); }],
    ]);
    const jump = function (a, b) {
      let m = 0;
      for (let i = Math.floor(a * SR) + 1; i < b * SR; i++) m = Math.max(m, Math.abs(res.x[i] - res.x[i - 1]));
      return m;
    };
    const out = {
      mute: {
        levelBefore: peakOf(res.x, 2.9 * SR, 3.0 * SR),
        jumpBefore: jump(2.8, 3.0),
        jumpAt: jump(3.0, 3.25),
        silent: peakOf(res.x, 3.4 * SR, 5.0 * SR),
        jumpBack: jump(5.0, 5.3),
        back: rmsOf(res.x, 6.5 * SR, 8 * SR),
        errors: res.errors,
      },
    };
    // page hidden at 5 s, visible again at 8 s
    const hid = await runEngine(12, [
      [0, function (e) { e.setMusic({ playing: true, intensity: 1, chapter: 1 }); }],
      [5.0, function (e) { e.setHidden(true); }],
      [6.5, function (e) { e.play('budOn'); }],
      [8.0, function (e) { e.setHidden(false); }],
    ]);
    out.hidden = {
      before: rmsOf(hid.x, 3 * SR, 5 * SR),
      during: peakOf(hid.x, 6 * SR, 8 * SR),
      after: rmsOf(hid.x, 9.5 * SR, 12 * SR),
      errors: hid.errors,
    };
    // music switched off
    const off = await runEngine(9, [
      [0, function (e) { e.setMusic({ playing: true, intensity: 1, chapter: 3 }); }],
      [5.0, function (e) { e.setMusic({ playing: false }); }],
    ]);
    out.off = { before: rmsOf(off.x, 3 * SR, 5 * SR), after: peakOf(off.x, 6 * SR, 9 * SR), errors: off.errors };
    return out;
  }

  window.Lab = { sounds, variation, budWalk, burst, music, muteAndHide };
}

// ---------------------------------------------------------------------------------------------
// Node side
// ---------------------------------------------------------------------------------------------

function startServer() {
  const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };
  const modulePage = '<!doctype html><meta charset="utf-8"><title>audio module</title><button id="go">go</button>' +
    '<script type="module">import * as A from "/src/audio.js"; window.GAudio = A; window.ready = true;</script>';
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/__module.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(modulePage);
      return;
    }
    const file = path.join(ROOT, url);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port }));
  });
}

function watch(page, bag) {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') bag.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => bag.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => bag.push('requestfailed: ' + r.url()));
}

const f1 = (v) => v.toFixed(1);
const f2 = (v) => v.toFixed(2);
const f3 = (v) => v.toFixed(3);

async function nodeImport() {
  head('1. Import in Node (no window, no document, no AudioContext)');
  let mod = null;
  let error = null;
  try {
    mod = await import(pathToFileURL(path.join(ROOT, 'src/audio.js')).href);
  } catch (e) {
    error = e;
  }
  check(!!mod, 'src/audio.js imports cleanly', error ? String(error) : '');
  if (!mod) return;
  check(API.every((n) => typeof mod[n] === 'function'), 'exports ' + API.join(', '));
  console.log('        all exports: ' + Object.keys(mod).join(', '));
  let threw = null;
  try {
    mod.initAudio();
    mod.initAudio();
    for (const n of mod.SOUND_NAMES) mod.play(n);
    mod.play('nope');
    mod.play();
    mod.setMusic({ playing: true, intensity: 0.5, chapter: 2 });
    mod.setMusic();
    mod.setMusic(null);
    mod.setMuted(true);
  } catch (e) {
    threw = e;
  }
  check(!threw, 'every export is a silent no-op without Web Audio', threw ? String(threw) : '');
  check(mod.isMuted() === true, 'setMuted is remembered before initAudio (isMuted() === true)');
  mod.setMuted(false);
  check(mod.isMuted() === false && mod.audioDebug() === null, 'isMuted() false again, audioDebug() null before init');
}

function bundle() {
  head('2. Bundle for the audition page');
  const esbuild = require('esbuild');
  const out = path.join(ROOT, 'dev/audio.bundle.js');
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src/audio.js')],
    bundle: true,
    format: 'iife',
    globalName: 'GAudio',
    target: 'es2019',
    outfile: out,
    logLevel: 'warning',
  });
  const size = fs.statSync(out).size;
  check(size > 1000, 'dev/audio.bundle.js written', (size / 1024).toFixed(1) + ' KB');
  const src = fs.readFileSync(path.join(ROOT, 'src/audio.js'), 'utf8');
  check(!/\bfetch\(|XMLHttpRequest|new Audio\(|\.mp3|\.ogg|\.wav|ConvolverNode|createConvolver/.test(src),
    'no audio files, no network, no convolution reverb in src/audio.js');
}

async function offline(page) {
  head('3. Every one-shot, rendered offline (dry = straight from its builder, chain = through the whole engine)');
  const s = await page.evaluate(() => window.Lab.sounds());
  table([
    { title: 'sound', width: 12, left: true, get: (r) => r.name },
    { title: 'dur s', width: 6, get: (r) => f2(r.dur) },
    { title: 'peak', width: 6, get: (r) => f3(r.peak) },
    { title: 'rms', width: 6, get: (r) => f3(r.rms) },
    { title: 'centroid Hz', width: 11, get: (r) => Math.round(r.centroid) },
    { title: 'dominant Hz', width: 11, get: (r) => Math.round(r.dominant) },
    { title: 'tilt oct', width: 8, get: (r) => (r.tilt >= 0 ? '+' : '') + f2(r.tilt) },
    { title: 'attack ms', width: 9, get: (r) => Math.round(r.attack * 1000) },
    { title: 'chain peak', width: 10, get: (r) => f3(r.wetPeak) },
    { title: 'chain dur', width: 9, get: (r) => f2(r.wetDur) },
  ], s.rows);
  console.log('  dur = time until the signal stays under -60 dBFS; tilt = spectral centroid of the second half against the first, in octaves');
  for (const r of s.rows) {
    const limit = r.name === 'solve' ? SOLVE_LIMIT : ORDINARY_LIMIT;
    const ok = !r.silent && r.peak > 0.02 && r.rms > 0.004 && r.worstPeak < PEAK_LIMIT && r.wetPeak < PEAK_LIMIT &&
      r.worstDur <= limit && r.worstEnd <= limit && r.wetDur <= limit && r.tail === 0 && r.errors.length === 0;
    if (!ok) {
      check(false, r.name + ' is audible, under the peak limit and ends in time',
        'worst dur ' + f2(r.worstDur) + ' nodes stop ' + f2(r.worstEnd) + ' chain dur ' + f2(r.wetDur) +
        ' worst peak ' + f3(r.worstPeak) + ' chain peak ' + f3(r.wetPeak) + ' ' + r.errors.join(' | '));
    }
  }
  check(s.rows.length === 22, 'all 22 SPEC names render', s.rows.length + ' sounds');
  check(s.rows.every((r) => !r.silent && r.peak > 0.02 && r.rms > 0.004), 'every sound is non-silent');
  check(s.rows.every((r) => r.worstPeak < PEAK_LIMIT && r.wetPeak < PEAK_LIMIT), 'no peak above ' + PEAK_LIMIT,
    'loudest dry ' + f3(Math.max(...s.rows.map((r) => r.worstPeak))) + ', loudest through the chain ' + f3(Math.max(...s.rows.map((r) => r.wetPeak))));
  const ordinary = s.rows.filter((r) => r.name !== 'solve');
  const solve = s.rows.find((r) => r.name === 'solve');
  check(ordinary.every((r) => r.worstDur <= ORDINARY_LIMIT && r.worstEnd <= ORDINARY_LIMIT && r.wetDur <= ORDINARY_LIMIT),
    'ordinary sounds end within ' + ORDINARY_LIMIT + ' s in every chapter, echo included',
    'longest dry ' + f2(Math.max(...ordinary.map((r) => r.worstDur))) + ' s, longest through the chain ' + f2(Math.max(...ordinary.map((r) => r.wetDur))) + ' s');
  check(solve.worstDur <= SOLVE_LIMIT && solve.worstEnd <= SOLVE_LIMIT && solve.wetDur <= SOLVE_LIMIT, "'solve' ends within " + SOLVE_LIMIT + ' s',
    'dry ' + f2(solve.worstDur) + ' s, chain ' + f2(solve.wetDur) + ' s');

  head('   Most alike pairs (1.00 = identical band spectrum / identical envelope)');
  table([
    { title: 'pair', width: 26, left: true, get: (p) => p.a + ' / ' + p.b },
    { title: 'spectrum', width: 8, get: (p) => f2(p.spec) },
    { title: 'envelope', width: 8, get: (p) => f2(p.env) },
    { title: 'tilt diff', width: 9, get: (p) => f2(p.tilt) },
  ], s.pairs);
  const twins = s.pairs.filter((p) => p.spec > 0.9 && p.env > 0.9 && p.tilt < 0.25);
  check(twins.length === 0, 'no two sounds share both spectrum and envelope',
    twins.map((p) => p.a + '/' + p.b).join(', '));

  head('   Foley variation over six plays');
  const v = await page.evaluate(() => window.Lab.variation());
  for (const r of v) {
    check((r.centroidSpread > 0.03 || r.pitchSpread > 0.03) && r.durSpread > 0.03 && r.repeatable, r.name + ' varies in pitch and length from play to play',
      'centroid ' + r.centroids.join(' ') + ' Hz, strongest ' + r.pitches.join(' ') + ' Hz, length ' + r.durs.join(' ') + ' ms');
  }

  head('4. Glowbud scale walk (through the engine, chapter 1: D E F# A B)');
  const w = await page.evaluate(() => window.Lab.budWalk());
  table([
    { title: 'at s', width: 5, get: (n) => f1(n.at) },
    { title: 'call', width: 8, left: true, get: (n) => n.name },
    { title: 'pitch Hz', width: 9, get: (n) => f1(n.pitch) },
    { title: 'first 60 ms', width: 11, get: (n) => f1(n.early) },
    { title: '140-240 ms', width: 10, get: (n) => f1(n.late) },
  ], w.notes);
  const on = w.notes.slice(0, 5).map((n) => n.pitch);
  const want = [587.33, 659.26, 739.99, 880.0, 987.77];
  check(on.every((p, i) => i === 0 || p > on[i - 1] * 1.05), "'budOn' five times gives rising pitches", on.map(f1).join(' < '));
  check(on.every((p, i) => Math.abs(p / want[i] - 1) < 0.01), 'and they are the major pentatonic', want.map(f1).join(' '));
  const off1 = w.notes[5];
  const off2 = w.notes[6];
  check(Math.abs(off1.early / want[4] - 1) < 0.05 && Math.abs(off2.early / want[3] - 1) < 0.05 && Math.abs(w.fall.head / want[4] - 1) < 0.02,
    "'budOff' steps back down, starting on the note it undoes", f1(off1.early) + ', ' + f1(off2.early) + ' (first 40 ms dry: ' + f1(w.fall.head) + ')');
  check(w.fall.mid < w.fall.head * 0.95 && w.fall.tail < w.fall.mid * 0.95 && w.fall.midLevel > 0.1, "'budOff' falls in pitch while it can still be heard",
    f1(w.fall.head) + ' -> ' + f1(w.fall.mid) + ' -> ' + f1(w.fall.tail) + ' Hz, at ' + Math.round(w.fall.midLevel * 100) + '% level mid-way');
  check(Math.abs(w.notes[7].pitch / want[3] - 1) < 0.01, "'budOn' after two 'budOff' continues from the right step", f1(w.notes[7].pitch));
  check(Math.abs(w.notes[9].pitch / want[0] - 1) < 0.01, "'restart' resets the walk", f1(w.notes[9].pitch));
  check(Math.abs(w.notes[12].pitch / want[0] - 1) < 0.01 && w.bud === 1, "'solve' resets the walk", f1(w.notes[12].pitch));
  check(w.solveDur <= SOLVE_LIMIT && w.solvePeak < PEAK_LIMIT, "'solve' mid-walk, through the chain", f2(w.solveDur) + ' s, peak ' + f3(w.solvePeak));
  check(w.errors.length === 0, 'no exceptions', w.errors.join(' | '));

  head('5. A busy turn: 14 sounds asked for in one frame');
  const b = await page.evaluate(() => window.Lab.burst());
  console.log('        played (ms after the frame): ' + b.played.join('  '));
  console.log('        dropped: ' + (b.dropped.join(' ') || 'none'));
  check(b.gaps.every((g) => g >= 0.04 - 1e-9 && g <= 0.07 + 1e-9), 'same-frame sounds are staggered 40 to 70 ms apart',
    b.gaps.map((g) => Math.round(g * 1000)).join(' ') + ' ms');
  check(b.most <= 6, 'never more than 6 one-shots at once', 'most at once: ' + b.most);
  check(b.played.some((p) => p.startsWith('solve@')) && b.played.some((p) => p.startsWith('budOn@')), "'budOn' and 'solve' are never dropped");
  check(b.peak < PEAK_LIMIT, 'busy turn stays under the peak limit', 'peak ' + f3(b.peak) + ', rms ' + f3(b.rms));
  check(b.floodPeak < PEAK_LIMIT, 'flood (all 22 sounds, four times, one frame) stays under the peak limit',
    'peak ' + f3(b.floodPeak) + ', played ' + b.floodPlayed + ', dropped ' + b.floodDropped + ', replaced ' + b.floodStolen);
  check(b.errors.length === 0, 'no exceptions', b.errors.join(' | '));

  head('6. Music bed: 10 s at each intensity (chapter 1)');
  const m = await page.evaluate(() => window.Lab.music());
  table([
    { title: 'intensity', width: 9, get: (r) => f1(r.intensity) },
    { title: 'peak', width: 6, get: (r) => f3(r.peak) },
    { title: 'rms', width: 7, get: (r) => r.rms.toFixed(4) },
    { title: 'centroid Hz', width: 11, get: (r) => Math.round(r.centroid) },
    { title: 'rms >700 Hz', width: 11, get: (r) => r.high.toFixed(4) },
    { title: 'pitches', width: 7, get: (r) => r.tones },
    { title: 'pad', width: 4, get: (r) => r.counts.pad },
    { title: 'kalimba', width: 7, get: (r) => r.counts.kalimba },
    { title: 'celesta', width: 7, get: (r) => r.counts.celesta },
    { title: 'nodes', width: 5, get: (r) => r.nodes },
  ], m.levels);
  const [l0, l5, l1] = m.levels;
  check(m.levels.every((r) => !r.silent && r.rms > 0.003), 'non-silent at every intensity');
  check(m.levels.every((r) => r.peak < PEAK_LIMIT), 'under the peak limit', 'loudest ' + f3(Math.max(...m.levels.map((r) => r.peak))));
  check(m.levels.every((r) => r.peak < 0.25), 'and quiet: a bed, not a lead');
  check(l0.rms < l5.rms && l5.rms < l1.rms, 'louder as intensity rises');
  check(l0.centroid < l5.centroid && l5.centroid < l1.centroid, 'brighter as intensity rises');
  check(l0.tones < l5.tones && l5.tones < l1.tones, 'more separate pitches as intensity rises', [l0.tones, l5.tones, l1.tones].join(' < '));
  check(l0.high < l5.high && l5.high * 1.5 < l1.high, 'more going on above 700 Hz as intensity rises');
  check(l0.counts.kalimba === 0 && l0.counts.celesta === 0 && l5.counts.kalimba > 0 && l5.counts.celesta === 0 &&
    l1.counts.kalimba > 0 && l1.counts.celesta > 0, 'layers: pad only, then kalimba, then celesta');
  check(m.levels.every((r) => r.errors.length === 0), 'no exceptions');

  head('   Chapters (intensity 1)');
  table([
    { title: 'chapter', width: 7, get: (r) => r.chapter },
    { title: 'drone Hz', width: 8, get: (r) => f1(r.dominant) },
    { title: 'centroid Hz', width: 11, get: (r) => Math.round(r.centroid) },
    { title: 'rms', width: 7, get: (r) => r.rms.toFixed(4) },
    { title: 'peak', width: 6, get: (r) => f3(r.peak) },
  ], m.chapters);
  const dr = m.chapters.map((c) => c.dominant);
  check(Math.abs(dr[0] / 293.66 - 1) < 0.02 && Math.abs(dr[1] / 220 - 1) < 0.02 && Math.abs(dr[2] / 349.23 - 1) < 0.02,
    'each chapter has its own root (D, A, F)');
  check(Math.abs(m.change.before / 293.66 - 1) < 0.02 && Math.abs(m.change.after / 220 - 1) < 0.02 && m.change.errors.length === 0,
    'changing chapter mid-bed moves the drone', f1(m.change.before) + ' -> ' + f1(m.change.after) + ' Hz');

  head('   Layer fades (intensity 1 -> 0 at 8 s, -> 0.5 at 12 s), measured with a probe tone through each layer');
  console.log('        time        pad kalimba celesta   (1.000 = level before the change)');
  for (const g of m.fade.gains) console.log('        t=' + pad(f2(g.t), 5) + '  ' + g.g.map((v) => pad(f3(v), 7)).join(' '));
  const at = (t) => m.fade.gains.find((g) => g.t === t).g;
  check(at(7.9)[1] > 0.95 && at(7.9)[2] > 0.95, 'both upper layers fully in before the change');
  check(at(8.3)[1] > 0.5 && at(8.3)[1] < 0.9 && at(8.3)[2] > 0.5 && at(8.3)[2] < 0.9 && at(8.6)[1] > 0.2 && at(8.6)[1] < 0.6,
    'they fade, not snap (0.3 and 0.6 s after the change)');
  check(at(9.2)[1] < 0.02 && at(9.2)[2] < 0.02, 'and are gone after about a second');
  check(at(12.3)[1] > 0.15 && at(12.3)[1] < 0.5 && at(12.6)[1] > 0.45 && at(12.6)[1] < 0.8 && at(13.3)[1] > 0.95 && at(14.5)[2] < 0.02,
    'kalimba fades back in alone at intensity 0.5, also over about a second');
  check(at(8.6)[0] > 0.9 && at(9.2)[0] > 0.9 && at(12.3)[0] > 0.9, 'the pad never leaves');
  check(m.fade.highAfter < m.fade.highBefore * 0.35 && m.fade.highBack > m.fade.highAfter * 2 && m.fade.errors.length === 0, 'the sound follows the gains',
    'rms above 700 Hz ' + m.fade.highBefore.toFixed(4) + ' -> ' + m.fade.highAfter.toFixed(4) + ' -> ' + m.fade.highBack.toFixed(4));

  head('7. Mute, page hidden, music off');
  const q = await page.evaluate(() => window.Lab.muteAndHide());
  check(q.mute.levelBefore > 0.05, 'there is something loud to mute', 'peak ' + f3(q.mute.levelBefore));
  check(q.mute.jumpAt <= q.mute.jumpBefore * 1.05, 'setMuted(true) ramps: no jump bigger than the audio itself',
    'largest sample step before ' + q.mute.jumpBefore.toFixed(4) + ', during ' + q.mute.jumpAt.toFixed(4));
  check(q.mute.silent < 1e-4, 'muted means silent, and play() while muted stays silent', 'peak ' + q.mute.silent.toExponential(1));
  check(q.mute.back > 0.003 && q.mute.jumpBack < 0.02, 'setMuted(false) brings the bed back without a click',
    'rms ' + q.mute.back.toFixed(4) + ', largest step ' + q.mute.jumpBack.toFixed(4));
  check(q.hidden.before > 0.003 && q.hidden.during < 1e-4 && q.hidden.after > 0.003, 'music pauses while the page is hidden and comes back',
    'rms ' + q.hidden.before.toFixed(4) + ' -> peak ' + q.hidden.during.toExponential(1) + ' -> rms ' + q.hidden.after.toFixed(4));
  check(q.off.before > 0.003 && q.off.after < 1e-4, 'setMusic({ playing: false }) fades the bed out', 'peak after ' + q.off.after.toExponential(1));
  check(q.mute.errors.length + q.hidden.errors.length + q.off.errors.length === 0, 'no exceptions');

  return s.rows;
}

async function live(browser, base) {
  head('8. The real thing: live AudioContext, audition page (bundle)');
  const errors = [];
  const page = await browser.newPage();
  watch(page, errors);
  await page.goto(base + '/dev/audio.html');
  const before = await page.evaluate(() => {
    const G = window.GAudio;
    G.play('step'); G.setMusic({ playing: false }); G.setMuted(false);
    return { muted: G.isMuted(), debug: G.audioDebug() };
  });
  check(before.muted === false && before.debug === null, 'before the first gesture: calls are no-ops');
  await page.click('#start');
  await page.waitForFunction(() => { const d = window.GAudio.audioDebug(); return d && d.state === 'running'; }, null, { timeout: 5000 });
  check(true, 'initAudio() from a click starts the context');
  await page.evaluate(() => {
    window.__peak = 0;
    window.__mostNodes = 0;
    window.__sampler = setInterval(() => {
      const d = window.GAudio.audioDebug({ meter: true });
      if (!d) return;
      if (d.meter && d.meter.peak > window.__peak) window.__peak = d.meter.peak;
      if (d.nodes > window.__mostNodes) window.__mostNodes = d.nodes;
    }, 15);
  });
  const names = await page.evaluate(() => window.GAudio.SOUND_NAMES);
  for (const n of names) {
    await page.click('button[data-sound="' + n + '"]');
    await page.waitForTimeout(120);
  }
  const afterAll = await page.evaluate(() => window.GAudio.audioDebug());
  check(afterAll.counts.played >= 20, 'play() of every name through real buttons', afterAll.counts.played + ' played, ' + afterAll.counts.dropped + ' dropped');
  await page.click('#burst');
  await page.waitForTimeout(900);
  const sfxPeak = await page.evaluate(() => window.__peak);
  check(sfxPeak > 0.02 && sfxPeak < PEAK_LIMIT, 'the live output is audible and under the peak limit', 'peak seen ' + f3(sfxPeak));

  // music, intensity, chapters
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__peak = 0; });
  await page.click('#music');
  const setIntensity = (v) => page.evaluate((val) => {
    const el = document.getElementById('intensity');
    el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  await page.waitForTimeout(2500);
  const m0 = await page.evaluate(() => window.GAudio.audioDebug());
  await setIntensity(0.5);
  await page.waitForTimeout(2500);
  const m5 = await page.evaluate(() => window.GAudio.audioDebug());
  await setIntensity(1);
  await page.waitForTimeout(4000);
  const m1 = await page.evaluate(() => window.GAudio.audioDebug());
  const musicPeak = await page.evaluate(() => window.__peak);
  check(m0.music.running && m0.counts.pad >= 1 && m0.counts.kalimba === 0, 'setMusic: the pad plays alone at intensity 0');
  check(m5.music.layers.join() === 'true,true,false' && m5.counts.kalimba >= 1 && m5.counts.celesta === 0, 'kalimba joins at 0.5', m5.counts.kalimba + ' notes');
  check(m1.music.layers.join() === 'true,true,true' && m1.counts.celesta >= 1, 'celesta joins at 1', m1.counts.celesta + ' notes');
  check(musicPeak > 0.004 && musicPeak < 0.3, 'the live bed is audible and quiet', 'peak seen ' + f3(musicPeak));
  for (const c of ['2', '3']) {
    await page.selectOption('#chapter', c);
    await page.waitForTimeout(1300);
  }
  const ch = await page.evaluate(() => window.GAudio.audioDebug());
  check(ch.music.chapter === 3 && ch.music.running, 'chapter changes while playing');

  // mute and unmute
  await page.click('#mute');
  await page.waitForTimeout(500);
  const muted = await page.evaluate(() => {
    const G = window.GAudio;
    G.play('budOn');
    const d = G.audioDebug({ meter: true });
    return { is: G.isMuted(), running: d.music.running, peak: d.meter.peak };
  });
  check(muted.is && !muted.running && muted.peak < 1e-4, 'setMuted(true): silent, bed parked', 'peak ' + muted.peak.toExponential(1));
  await page.click('#mute');
  await page.waitForTimeout(600);
  const unmuted = await page.evaluate(() => { const d = window.GAudio.audioDebug(); return { is: window.GAudio.isMuted(), running: d.music.running }; });
  check(!unmuted.is && unmuted.running, 'setMuted(false): bed returns');

  // page hidden and visible again (visibilitychange with a faked state)
  const setVisibility = (state) => page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
    Object.defineProperty(document, 'hidden', { value: s === 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
  await setVisibility('hidden');
  await page.waitForTimeout(1300);
  const hid = await page.evaluate(() => { window.GAudio.play('step'); return window.GAudio.audioDebug(); });
  check(hid.hidden && !hid.music.running && hid.state === 'suspended', 'visibilitychange to hidden pauses the music and sleeps the context', 'state ' + hid.state);
  await setVisibility('visible');
  await page.waitForFunction(() => window.GAudio.audioDebug().state === 'running', null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  const vis = await page.evaluate(() => window.GAudio.audioDebug());
  check(!vis.hidden && vis.music.running && vis.state === 'running', 'visible again: context and music resume', 'state ' + vis.state);

  // idempotent init, odd arguments
  const odd = await page.evaluate(() => {
    const G = window.GAudio;
    const t0 = G.audioDebug().time;
    const played = G.audioDebug().counts.played;
    let threw = null;
    try {
      G.initAudio(); G.initAudio();
      G.play('nope'); G.play(); G.play(null); G.play({}); G.play(42); G.play('__proto__'); G.play('constructor');
      G.setMusic(); G.setMusic(null); G.setMusic('x'); G.setMusic({ intensity: NaN, chapter: 99 }); G.setMusic({ intensity: 7 });
      G.setMusic({ chapter: -3 }); G.setMuted(); G.setMuted(0);
    } catch (e) { threw = String(e); }
    const d = G.audioDebug();
    return { threw, sameClock: d.time >= t0, played: d.counts.played - played, chapter: d.music.chapter, intensity: d.music.intensity };
  });
  check(!odd.threw && odd.sameClock && odd.played === 0, 'initAudio is idempotent; unknown names and odd arguments are ignored', odd.threw || '');
  check(odd.chapter === 1 && odd.intensity === 1, 'out-of-range music values are clamped', 'chapter ' + odd.chapter + ', intensity ' + odd.intensity);

  // switch everything off and make sure the nodes go away
  await page.click('#music');
  await page.waitForTimeout(2600);
  const end = await page.evaluate(() => { clearInterval(window.__sampler); return { d: window.GAudio.audioDebug(), most: window.__mostNodes }; });
  check(end.d.music.voices === 0 && end.d.voices === 0 && end.d.nodes === 0, 'after the music stops every sound node is released',
    'nodes alive ' + end.d.nodes + ', most at once during the run ' + end.most);
  check(errors.length === 0, 'no console errors, warnings or exceptions on the audition page', errors.join(' | '));
  await page.close();
  return { most: end.most };
}

async function liveModule(browser, base) {
  head('9. The ES module itself in a page, and pages with broken or missing Web Audio');
  const errors = [];
  const page = await browser.newPage();
  watch(page, errors);
  await page.goto(base + '/__module.html');
  await page.waitForFunction(() => window.ready === true);
  const keys = await page.evaluate(() => Object.keys(window.GAudio).sort());
  check(API.every((n) => keys.includes(n)), 'module exports the SPEC API', keys.join(', '));
  await page.evaluate(() => document.getElementById('go').addEventListener('click', () => {
    const G = window.GAudio;
    G.initAudio();
    G.SOUND_NAMES.forEach((n) => G.play(n));
    G.setMusic({ playing: true, intensity: 1, chapter: 2 });
  }));
  await page.click('#go');
  await page.waitForTimeout(1500);
  const d = await page.evaluate(() => { window.GAudio.setMuted(true); window.GAudio.setMuted(false); return window.GAudio.audioDebug(); });
  check(d && d.state === 'running' && d.music.running && d.counts.played > 0, 'init, play, setMusic, setMuted from one click', d ? d.counts.played + ' played, ' + d.counts.dropped + ' dropped in one frame' : 'no engine');
  check(errors.length === 0, 'no console errors, warnings or exceptions', errors.join(' | '));
  await page.close();

  const broken = [
    ['no AudioContext at all', () => { delete window.AudioContext; delete window.webkitAudioContext; window.AudioContext = undefined; window.webkitAudioContext = undefined; }],
    ['AudioContext constructor throws', () => { window.AudioContext = function () { throw new Error('refused'); }; window.webkitAudioContext = undefined; }],
    ['context that never leaves "suspended"', () => {
      const Real = window.AudioContext;
      window.AudioContext = function (o) {
        const c = new Real(o);
        c.suspend();
        c.resume = function () { return Promise.reject(new Error('not allowed')); };
        return c;
      };
    }],
    ['graph construction fails', () => {
      const Real = window.AudioContext;
      window.AudioContext = function (o) {
        const c = new Real(o);
        c.createDynamicsCompressor = function () { throw new Error('no compressor here'); };
        return c;
      };
    }],
  ];
  for (const [label, init] of broken) {
    const errs = [];
    const p = await browser.newPage();
    watch(p, errs);
    await p.addInitScript(init);
    await p.goto(base + '/__module.html');
    await p.waitForFunction(() => window.ready === true);
    await p.evaluate(() => document.getElementById('go').addEventListener('click', () => {
      const G = window.GAudio;
      window.result = { threw: null };
      try {
        window.result.init = G.initAudio();
        G.initAudio();
        for (let i = 0; i < 3; i++) G.SOUND_NAMES.forEach((n) => G.play(n));
        G.setMusic({ playing: true, intensity: 1, chapter: 3 });
        G.setMuted(true);
        window.result.muted = G.isMuted();
        G.setMuted(false);
      } catch (e) { window.result.threw = String(e); }
    }));
    await p.click('#go');
    await p.waitForTimeout(700);
    const r = await p.evaluate(() => window.result);
    check(r && !r.threw && r.muted === true && errs.length === 0, label + ': silent, nothing thrown',
      (r && r.threw) || errs.join(' | ') || 'initAudio() returned ' + r.init);
    await p.close();
  }
}

(async () => {
  await nodeImport();
  bundle();
  const { chromium } = require('playwright');
  const { server, base } = await startServer();
  const browser = await chromium.launch();
  let rows = [];
  try {
    const errors = [];
    const page = await browser.newPage();
    watch(page, errors);
    await page.goto(base + '/__module.html');
    await page.waitForFunction(() => window.ready === true);
    await page.addScriptTag({ content: '(' + pageLib.toString() + ')();' });
    rows = await offline(page);
    check(errors.length === 0, 'no console errors during the offline renders', errors.join(' | '));
    await page.close();
    await live(browser, base);
    await liveModule(browser, base);
  } finally {
    await browser.close();
    server.close();
  }
  if (process.argv.includes('--levels')) {
    head('Level each sound would need for a given dry peak (current level x target / measured peak)');
    for (const r of rows) console.log('  ' + pad(r.name, 12, true) + ' peak ' + f3(r.peak) + '  rms ' + f3(r.rms));
  }
  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
