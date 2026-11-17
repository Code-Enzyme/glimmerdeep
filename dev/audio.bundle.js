var GAudio = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/audio.js
  var audio_exports = {};
  __export(audio_exports, {
    SOUND_NAMES: () => SOUND_NAMES,
    audioDebug: () => audioDebug,
    buildSound: () => buildSound,
    createAudioEngine: () => createAudioEngine,
    initAudio: () => initAudio,
    isMuted: () => isMuted,
    play: () => play,
    setAppHidden: () => setAppHidden,
    setMusic: () => setMusic,
    setMuted: () => setMuted
  });
  var SOUND_NAMES = [
    "step",
    "blocked",
    "plant",
    "pickup",
    "wait",
    "moth",
    "settle",
    "whelkMove",
    "whelkHide",
    "whelkEmerge",
    "stumpStep",
    "stumpBump",
    "stumpWake",
    "newtStep",
    "newtTurn",
    "newtDoze",
    "newtWake",
    "gateOpen",
    "gateClose",
    "budOn",
    "budOff",
    "solve",
    "undo",
    "restart",
    "ui",
    "hint"
  ];
  var MASTER_LEVEL = 0.75;
  var MUSIC_LEVEL = 1;
  var ECHO_TIME = 0.13;
  var ECHO_FEEDBACK = 0.3;
  var ECHO_SEND = 0.13;
  var ECHO_TONE = 1600;
  var MAX_VOICES = 6;
  var MAX_SAME = 2;
  var STAGGER_MIN = 0.04;
  var STAGGER_MAX = 0.07;
  var MAX_BACKLOG = 0.36;
  var LOOKAHEAD = 0.45;
  var TICK_MS = 110;
  var LAYER2_AT = 0.3;
  var LAYER3_AT = 0.65;
  var LAYER_FADE = 1;
  var BUD_TOP = 10;
  var LEVELS = {
    step: 0.24,
    blocked: 0.225,
    plant: 0.4,
    pickup: 0.25,
    wait: 0.11,
    moth: 0.1,
    settle: 0.3,
    whelkMove: 0.12,
    whelkHide: 0.15,
    whelkEmerge: 0.18,
    stumpStep: 0.195,
    stumpBump: 0.28,
    stumpWake: 0.1,
    newtStep: 0.27,
    newtTurn: 0.5,
    newtDoze: 0.25,
    newtWake: 0.27,
    gateOpen: 0.13,
    gateClose: 0.133,
    budOn: 0.27,
    budOff: 0.22,
    solve: 0.22,
    undo: 0.155,
    restart: 0.195,
    ui: 0.115,
    hint: 0.185
  };
  var FOLEY = {
    step: 1,
    wait: 1,
    moth: 1,
    whelkMove: 1,
    whelkHide: 1,
    whelkEmerge: 1,
    stumpStep: 1,
    stumpBump: 1,
    stumpWake: 1,
    newtStep: 1,
    newtTurn: 1,
    newtDoze: 1,
    newtWake: 1
  };
  var ACTIONS = { step: 1, blocked: 1, plant: 1, pickup: 1, wait: 1, undo: 1, restart: 1, ui: 1, hint: 1 };
  var LOOSE = { step: 1, moth: 1, whelkMove: 1, stumpStep: 1, newtStep: 1 };
  var PENT = [0, 2, 4, 7, 9];
  var CHAPTERS = [
    null,
    { key: 62, drone: 50, home: [0, 3], colors: [78, 76, 81, 76], beat: 0.66 },
    // D pentatonic over D
    { key: 60, drone: 45, home: [4, 2], colors: [72, 74, 67, 74], beat: 0.72 },
    // C pentatonic over A
    { key: 63, drone: 53, home: [1, 4], colors: [75, 79, 70, 79], beat: 0.6 }
    // E flat pentatonic over F
  ];
  function noop() {
  }
  function makeRng(seed) {
    let s = seed === void 0 || seed === null ? Math.random() * 4294967296 >>> 0 : seed >>> 0;
    return function() {
      s = s + 1831565813 >>> 0;
      let t = s;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function mtof(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
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
  var noiseCache = /* @__PURE__ */ new WeakMap();
  var waveCache = /* @__PURE__ */ new WeakMap();
  function noiseBuffer(ctx) {
    let buf = noiseCache.get(ctx);
    if (!buf) {
      const len = Math.floor(ctx.sampleRate * 0.75);
      buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      const r = makeRng(2654435769);
      for (let i = 0; i < len; i++) data[i] = r() * 2 - 1;
      noiseCache.set(ctx, buf);
    }
    return buf;
  }
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
      try {
        k.nodes[i].disconnect();
      } catch (e) {
      }
    }
    k.nodes.length = 0;
    k.sources.length = 0;
    if (k.onDone) k.onDone(k);
  }
  function stopKit(k, when, fade) {
    if (k.done || when >= k.end) return;
    try {
      if (k.stopAt < 0) {
        const from = Math.max(k.ctx.currentTime, when - (fade || 0.03));
        k.out.gain.setValueAtTime(k.level, from);
        k.out.gain.linearRampToValueAtTime(0, Math.max(when, from + 5e-3));
      } else if (when >= k.stopAt) {
        return;
      }
      k.stopAt = when;
      for (let i = 0; i < k.sources.length; i++) k.sources[i].stop(when);
      k.end = when;
    } catch (e) {
    }
  }
  function track(k, src, stopAt) {
    k.nodes.push(src);
    k.sources.push(src);
    k.live++;
    if (stopAt > k.end) k.end = stopAt;
    src.onended = function() {
      if (--k.live <= 0) releaseKit(k);
    };
  }
  function osc(k, type, freq, t0, t1) {
    const o = k.ctx.createOscillator();
    if (typeof type === "string") o.type = type;
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
    g.gain.value = value === void 0 ? 0 : value;
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
  function pluckEnv(param, t, peak, attack, dur) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(Math.max(peak * 1e-3, 1e-6), t + dur);
    param.linearRampToValueAtTime(0, t + dur + 0.01);
  }
  function swellEnv(param, t, peak, attack, hold, release) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak * 0.7, t + attack * 0.6);
    param.linearRampToValueAtTime(peak, t + attack);
    param.setValueAtTime(peak, t + attack + hold);
    param.exponentialRampToValueAtTime(Math.max(peak * 3e-3, 1e-6), t + attack + hold + release - 0.015);
    param.linearRampToValueAtTime(0, t + attack + hold + release);
  }
  function tone(k, type, freq, t, peak, attack, dur, dest) {
    const o = osc(k, type, freq, t, t + dur + 0.02);
    const g = gain(k);
    pluckEnv(g.gain, t, peak, attack, dur);
    o.connect(g);
    g.connect(dest || k.out);
    return o;
  }
  function hiss(k, type, freq, q, t, peak, attack, dur, dest) {
    const s = noise(k, t, t + dur + 0.02);
    const f = filt(k, type, freq, q);
    const g = gain(k);
    const width = type === "bandpass" ? freq / Math.max(q, 0.3) : freq;
    const scale = clamp(Math.sqrt(9e3 / Math.max(width, 60)), 1, 9);
    pluckEnv(g.gain, t, peak * scale, attack, dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest || k.out);
    return f;
  }
  function kalimba(k, t, freq, vel, dur, full) {
    tone(k, "sine", freq, t, vel, 3e-3, dur);
    tone(k, "sine", Math.min(freq * 6.27, 5400), t, vel * 0.13, 1e-3, 0.07);
    if (full) {
      tone(k, "sine", freq * 2, t, vel * 0.15, 2e-3, dur * 0.4);
      hiss(k, "bandpass", 1500, 1.2, t, vel * 0.05, 1e-3, 0.014);
    }
  }
  function celesta(k, t, freq, vel, dur) {
    tone(k, "sine", freq, t, vel, 6e-3, dur);
    tone(k, "sine", freq * 2, t, vel * 0.3, 4e-3, dur * 0.55);
    tone(k, "sine", Math.min(freq * 4, 6e3), t, vel * 0.09, 3e-3, dur * 0.22);
  }
  function nylon(k, t, freq, vel, dur) {
    const o = osc(k, stringWave(k.ctx), freq, t, t + dur + 0.02);
    const top = Math.min(freq * 7, 6500);
    const lp = filt(k, "lowpass", top, 0);
    lp.frequency.setValueAtTime(top, t);
    lp.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur * 0.55);
    const g = gain(k);
    pluckEnv(g.gain, t, vel, 3e-3, dur);
    o.connect(lp);
    lp.connect(g);
    g.connect(k.out);
  }
  function woodKnock(k, t, freq, amp, ring) {
    tone(k, "sine", freq, t, amp, 2e-3, ring);
    tone(k, "sine", freq * 2.76, t, amp * 0.42, 15e-4, ring * 0.5);
    hiss(k, "bandpass", 1200, 1, t, amp * 0.1, 1e-3, 0.016);
  }
  function creak(k, t, dur, rate, formant, amp) {
    const o = osc(k, "sawtooth", rate(0), t, t + dur + 0.03);
    const b1 = filt(k, "bandpass", formant(0), 5);
    const b2 = filt(k, "bandpass", formant(0) * 2.3, 4);
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
  function glass(k, t, tones, peak, attack, hold, release, breath) {
    const g = gain(k);
    (breath ? breathEnv : swellEnv)(g.gain, t, peak, attack, hold, release);
    const end = t + attack + hold + release + 0.02;
    for (let i = 0; i < tones.length; i++) {
      const o = osc(k, "sine", tones[i][0], t, end);
      const lvl = gain(k, tones[i][1]);
      o.connect(lvl);
      lvl.connect(g);
    }
    g.connect(k.out);
  }
  var SOUNDS = /* @__PURE__ */ Object.create(null);
  SOUNDS.step = function(k, t, p) {
    const v = (1 + (k.r() - 0.5) * 0.2) * (p.alt ? 0.88 : 1);
    const d = 0.15 + k.r() * 0.06;
    hiss(k, "lowpass", 760 * v, 3, t, 0.5, 8e-3, d);
    const heel = tone(k, "sine", 215 * v, t, 0.3, 6e-3, d * 0.7);
    heel.frequency.exponentialRampToValueAtTime(140 * v, t + 0.06);
  };
  SOUNDS.blocked = function(k, t) {
    const lp = filt(k, "lowpass", 640, 0);
    lp.connect(k.out);
    const o = tone(k, "triangle", 262, t, 1, 3e-3, 0.12, lp);
    o.frequency.exponentialRampToValueAtTime(186, t + 0.06);
    hiss(k, "lowpass", 380, 0, t, 0.14, 2e-3, 0.03);
  };
  SOUNDS.plant = function(k, t, p) {
    const root = mtof(p.key);
    const thud = tone(k, "sine", 156, t, 0.5, 4e-3, 0.1);
    thud.frequency.exponentialRampToValueAtTime(94, t + 0.07);
    const c = t + 0.012;
    tone(k, "sine", 2380, c, 0.24, 1e-3, 0.2);
    tone(k, "sine", 3790, c, 0.11, 1e-3, 0.11);
    tone(k, "sine", 5230, c, 0.045, 1e-3, 0.06);
    glass(k, t + 0.03, [[root, 1], [root * 1.5, 0.55], [root * 2.003, 0.3]], 0.34, 0.22, 0.05, 0.6);
  };
  SOUNDS.pickup = function(k, t, p) {
    const root = mtof(p.key);
    tone(k, "sine", 2040, t, 0.3, 1e-3, 0.1);
    tone(k, "sine", 3260, t, 0.1, 1e-3, 0.05);
    tone(k, "sine", 2720, t + 0.075, 0.24, 1e-3, 0.12);
    tone(k, "sine", 4350, t + 0.075, 0.08, 1e-3, 0.05);
    const g = gain(k);
    swellEnv(g.gain, t + 0.02, 0.5, 0.05, 0.02, 0.28);
    const o = osc(k, "triangle", root * 1.5, t + 0.02, t + 0.4);
    o.frequency.setValueAtTime(root * 1.5, t + 0.05);
    o.frequency.exponentialRampToValueAtTime(root, t + 0.3);
    o.connect(g);
    g.connect(k.out);
  };
  SOUNDS.wait = function(k, t) {
    const s = noise(k, t, t + 0.56);
    const bp = filt(k, "bandpass", 760, 0.7);
    bp.frequency.setValueAtTime(760, t);
    bp.frequency.exponentialRampToValueAtTime(430, t + 0.5);
    const lp = filt(k, "lowpass", 1500, 0);
    const g = gain(k);
    swellEnv(g.gain, t, 2.4, 0.16, 0.03, 0.34);
    s.connect(bp);
    bp.connect(lp);
    lp.connect(g);
    g.connect(k.out);
  };
  SOUNDS.moth = function(k, t) {
    const base = 1650 * (1 + (k.r() - 0.5) * 0.36);
    const count = 3 + (k.r() < 0.45 ? 1 : 0);
    const o = osc(k, "sine", base, t, t + count * 0.055 + 0.06);
    const g = gain(k);
    let tt = t;
    for (let i = 0; i < count; i++) {
      const f = base * (1 + i * 0.1 + (k.r() - 0.5) * 0.05);
      const d = 0.026 + k.r() * 0.012;
      o.frequency.setValueAtTime(f, tt);
      o.frequency.exponentialRampToValueAtTime(f * 1.22, tt + d);
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(1 - i * 0.14, tt + 6e-3);
      g.gain.linearRampToValueAtTime(0, tt + d);
      tt += d + 0.012 + k.r() * 0.014;
    }
    o.connect(g);
    g.connect(k.out);
    hiss(k, "bandpass", 3100, 1.4, t, 0.12, 0.02, tt - t + 0.03);
  };
  SOUNDS.settle = function(k, t, p) {
    const thud = tone(k, "sine", 240, t, 0.6, 3e-3, 0.08);
    thud.frequency.exponentialRampToValueAtTime(120, t + 0.05);
    hiss(k, "lowpass", 900, 0, t, 0.12, 2e-3, 0.04);
    const drop = tone(k, "sine", 380, t + 0.028, 0.8, 4e-3, 0.13);
    drop.frequency.exponentialRampToValueAtTime(1020, t + 0.11);
    const drip = tone(k, "sine", 620, t + 0.15, 0.3, 3e-3, 0.07);
    drip.frequency.exponentialRampToValueAtTime(1350, t + 0.2);
    const seq = [4, 7, 4, 7, 9, 12];
    const top = p.key + 24;
    const o = osc(k, "sine", mtof(top + seq[0]), t + 0.3, t + 0.3 + seq.length * 0.062 + 0.2);
    const g = gain(k);
    let tt = t + 0.3;
    for (let i = 0; i < seq.length; i++) {
      const last = i === seq.length - 1;
      o.frequency.setValueAtTime(mtof(top + seq[i]), tt);
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(last ? 0.42 : 0.34, tt + 6e-3);
      if (last) {
        g.gain.exponentialRampToValueAtTime(5e-4, tt + 0.17);
        g.gain.linearRampToValueAtTime(0, tt + 0.18);
      } else {
        g.gain.linearRampToValueAtTime(0, tt + 0.056);
      }
      tt += 0.062;
    }
    o.connect(g);
    g.connect(k.out);
  };
  SOUNDS.whelkMove = function(k, t) {
    const v = 1 + (k.r() - 0.5) * 0.26;
    const d = 0.19 + k.r() * 0.07;
    const s = noise(k, t, t + d + 0.03);
    const bp = filt(k, "bandpass", 380 * v, 7);
    bp.frequency.setValueAtTime(380 * v, t);
    bp.frequency.exponentialRampToValueAtTime(1280 * v, t + d * 0.55);
    bp.frequency.exponentialRampToValueAtTime(640 * v, t + d);
    const g = gain(k);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(6.5, t + d * 0.4);
    g.gain.linearRampToValueAtTime(3, t + d * 0.7);
    g.gain.linearRampToValueAtTime(0, t + d);
    const lp = filt(k, "lowpass", 2300, 0);
    s.connect(bp);
    bp.connect(lp);
    lp.connect(g);
    g.connect(k.out);
    const pop = tone(k, "sine", 520 * v, t + d * 0.72, 0.5, 4e-3, 0.06);
    pop.frequency.exponentialRampToValueAtTime(980 * v, t + d * 0.72 + 0.045);
  };
  SOUNDS.whelkHide = function(k, t) {
    const v = 1 + (k.r() - 0.5) * 0.06;
    hiss(k, "bandpass", 1500, 2, t, 0.06, 0.012, 0.045);
    const c = t + 0.045;
    const a = tone(k, "sine", 690 * v, c, 1, 15e-4, 0.12);
    a.frequency.exponentialRampToValueAtTime(640 * v, c + 0.08);
    tone(k, "sine", 1090 * v, c, 0.4, 15e-4, 0.06);
    hiss(k, "bandpass", 2100, 1.2, c, 0.1, 1e-3, 0.016);
  };
  SOUNDS.whelkEmerge = function(k, t) {
    const v = 1 + (k.r() - 0.5) * 0.08;
    tone(k, "sine", 980 * v, t, 0.3, 2e-3, 0.035);
    const o = osc(k, "sine", 300 * v, t + 0.04, t + 0.3);
    o.frequency.exponentialRampToValueAtTime(640 * v, t + 0.2);
    const g = gain(k);
    g.gain.setValueAtTime(0, t + 0.04);
    g.gain.linearRampToValueAtTime(0.9, t + 0.085);
    g.gain.exponentialRampToValueAtTime(1e-3, t + 0.27);
    g.gain.linearRampToValueAtTime(0, t + 0.28);
    o.connect(g);
    g.connect(k.out);
    hiss(k, "bandpass", 800, 3, t + 0.04, 0.07, 0.03, 0.14);
    const b = tone(k, "sine", 760 * v, t + 0.27, 0.35, 4e-3, 0.08);
    b.frequency.exponentialRampToValueAtTime(900 * v, t + 0.31);
  };
  SOUNDS.stumpStep = function(k, t) {
    const v = 1 + (k.r() - 0.5) * 0.24;
    const d = 0.22 + k.r() * 0.08;
    const o = tone(k, "sine", 128 * v, t, 1, 5e-3, d);
    o.frequency.exponentialRampToValueAtTime(74 * v, t + 0.11);
    tone(k, "triangle", 286 * v, t, 0.6 + k.r() * 0.2, 2e-3, 0.1);
    tone(k, "sine", 790 * v, t, 0.2, 15e-4, 0.045);
    hiss(k, "bandpass", 520 * v, 1.5, t, 0.08, 2e-3, 0.03);
  };
  SOUNDS.stumpBump = function(k, t) {
    const v = 1 + (k.r() - 0.5) * 0.08;
    woodKnock(k, t, 176 * v, 1, 0.15);
    woodKnock(k, t + 0.115, 190 * v, 0.38, 0.1);
  };
  SOUNDS.stumpWake = function(k, t) {
    creak(
      k,
      t,
      0.62,
      function(x) {
        return 30 + 27 * Math.sin(Math.PI * Math.pow(x, 0.8));
      },
      function(x) {
        return 400 + 380 * Math.sin(Math.PI * Math.pow(x, 0.8));
      },
      6
    );
    const o = osc(k, stringWave(k.ctx), 150, t + 0.05, t + 0.84);
    o.frequency.linearRampToValueAtTime(216, t + 0.32);
    o.frequency.linearRampToValueAtTime(126, t + 0.76);
    const lp = filt(k, "lowpass", 520, 4);
    lp.frequency.setValueAtTime(520, t + 0.05);
    lp.frequency.linearRampToValueAtTime(940, t + 0.32);
    lp.frequency.linearRampToValueAtTime(400, t + 0.76);
    const g = gain(k);
    swellEnv(g.gain, t + 0.05, 0.5, 0.2, 0.1, 0.46);
    o.connect(lp);
    lp.connect(g);
    g.connect(k.out);
  };
  SOUNDS.newtStep = function(k, t) {
    const v = 1 + (k.r() - 0.5) * 0.2;
    for (const [dt, a] of [[0, 1], [0.075 + k.r() * 0.02, 0.7]]) {
      hiss(k, "bandpass", 900 * v, 2.5, t + dt, 0.22 * a, 4e-3, 0.06);
      const o = tone(k, "sine", 330 * v, t + dt, 0.45 * a, 3e-3, 0.07);
      o.frequency.exponentialRampToValueAtTime(220 * v, t + dt + 0.05);
    }
  };
  SOUNDS.newtTurn = function(k, t) {
    const v = 1 + (k.r() - 0.5) * 0.1;
    const f = hiss(k, "bandpass", 1400 * v, 4, t, 0.2, 0.01, 0.14);
    f.frequency.setValueAtTime(1400 * v, t);
    f.frequency.exponentialRampToValueAtTime(2600 * v, t + 0.12);
    const c = tone(k, "sine", 1180 * v, t + 0.1, 0.3, 4e-3, 0.08);
    c.frequency.exponentialRampToValueAtTime(1560 * v, t + 0.15);
  };
  SOUNDS.newtDoze = function(k, t) {
    const b = hiss(k, "bandpass", 900, 1.4, t, 0.12, 0.12, 0.6);
    b.frequency.setValueAtTime(900, t);
    b.frequency.exponentialRampToValueAtTime(420, t + 0.55);
    const o = osc(k, "sine", 260, t, t + 0.75);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.65);
    const g = gain(k);
    swellEnv(g.gain, t, 0.5, 0.15, 0.12, 0.42);
    o.connect(g);
    g.connect(k.out);
  };
  SOUNDS.newtWake = function(k, t) {
    const v = 1 + (k.r() - 0.5) * 0.06;
    const a = tone(k, "sine", 640 * v, t, 0.6, 4e-3, 0.09);
    a.frequency.exponentialRampToValueAtTime(900 * v, t + 0.06);
    const b = tone(k, "sine", 860 * v, t + 0.09, 0.55, 4e-3, 0.12);
    b.frequency.exponentialRampToValueAtTime(1280 * v, t + 0.16);
    hiss(k, "bandpass", 2400, 2, t, 0.05, 3e-3, 0.03);
  };
  SOUNDS.gateOpen = function(k, t) {
    creak(
      k,
      t,
      0.5,
      function(x) {
        return 22 + 48 * x * x;
      },
      function(x) {
        return 330 + 500 * x;
      },
      6
    );
    woodKnock(k, t + 0.5, 262, 0.5, 0.12);
  };
  SOUNDS.gateClose = function(k, t) {
    creak(
      k,
      t,
      0.5,
      function(x) {
        return 66 - 44 * Math.sqrt(x);
      },
      function(x) {
        return 800 - 500 * x;
      },
      6
    );
    woodKnock(k, t + 0.5, 150, 0.7, 0.16);
  };
  SOUNDS.budOn = function(k, t, p) {
    kalimba(k, t, mtof(pentMidi(p.key + 12, p.idx)), 1, 1.05, true);
  };
  SOUNDS.budOff = function(k, t, p) {
    const f = mtof(pentMidi(p.key + 12, p.idx));
    const o = tone(k, "sine", f, t, 0.9, 4e-3, 0.34);
    o.frequency.setValueAtTime(f, t + 0.03);
    o.frequency.exponentialRampToValueAtTime(f * 0.75, t + 0.24);
    hiss(k, "lowpass", 700, 0, t, 0.08, 2e-3, 0.03);
  };
  SOUNDS.solve = function(k, t, p) {
    const base = p.key + 12;
    let top = Math.max(5, Math.ceil((p.idx + 2) / 5) * 5);
    let from = Math.max(p.idx, top - 4);
    while (top > 5) {
      top -= 5;
      from -= 5;
    }
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
  SOUNDS.undo = function(k, t, p) {
    const f = mtof(p.key + 4);
    const d = 0.26;
    const o = osc(k, stringWave(k.ctx), f, t, t + d + 0.05);
    const lp = filt(k, "lowpass", f * 1.4, 0);
    lp.frequency.setValueAtTime(f * 1.4, t);
    lp.frequency.exponentialRampToValueAtTime(f * 6, t + d);
    const g = gain(k);
    g.gain.setValueAtTime(2e-3, t);
    g.gain.exponentialRampToValueAtTime(1, t + d);
    g.gain.linearRampToValueAtTime(0, t + d + 0.022);
    o.connect(lp);
    lp.connect(g);
    g.connect(k.out);
    const tink = osc(k, "sine", Math.min(f * 6.27, 5400), t + d - 0.07, t + d + 0.05);
    const tg = gain(k);
    tg.gain.setValueAtTime(5e-4, t + d - 0.07);
    tg.gain.exponentialRampToValueAtTime(0.09, t + d);
    tg.gain.linearRampToValueAtTime(0, t + d + 0.012);
    tink.connect(tg);
    tg.connect(k.out);
  };
  SOUNDS.restart = function(k, t, p) {
    const seq = [4, 3, 2, 1, 0];
    let tt = t;
    for (let i = 0; i < seq.length; i++) {
      const last = i === seq.length - 1;
      nylon(k, tt, mtof(pentMidi(p.key, seq[i])), last ? 1 : 0.6 + i * 0.06, last ? 0.55 : 0.2);
      tt += 0.062;
    }
  };
  SOUNDS.ui = function(k, t) {
    tone(k, "sine", 1180, t, 0.8, 15e-4, 0.04);
    tone(k, "sine", 1770, t, 0.25, 1e-3, 0.02);
    hiss(k, "bandpass", 2600, 1.5, t, 0.06, 1e-3, 0.01);
  };
  SOUNDS.hint = function(k, t, p) {
    const a = mtof(p.key + 7);
    const b = mtof(p.key + 12);
    nylon(k, t, a, 0.8, 0.55);
    tone(k, "sine", a * 2, t, 0.1, 4e-3, 0.3);
    nylon(k, t + 0.19, b, 0.9, 0.7);
    tone(k, "sine", b * 2, t + 0.19, 0.12, 4e-3, 0.4);
  };
  function buildSound(ctx, dest, name, when, params) {
    const fn = SOUNDS[name];
    if (typeof fn !== "function") return null;
    const p = params || {};
    const chapter = CHAPTERS[clamp(Math.round(Number(p.chapter) || 1), 1, 3)];
    const r = p.rng || makeRng(p.seed);
    const level = typeof p.level === "number" ? p.level : LEVELS[name];
    const k = makeKit(ctx, dest, level, r);
    const t = typeof when === "number" ? when : ctx.currentTime;
    fn(k, t, { key: chapter.key, idx: clamp(Math.round(Number(p.idx) || 0), 0, BUD_TOP), alt: !!p.alt });
    return k;
  }
  function softClipCurve() {
    const n = 2049;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1) * 2 - 1;
      const a = Math.abs(x);
      const y = a <= 0.6 ? a : 0.6 + 0.25 * Math.tanh((a - 0.6) / 0.25);
      curve[i] = x < 0 ? -y : y;
    }
    return curve;
  }
  function makeFader(param, value) {
    param.value = value;
    return { param, v0: value, v1: value, t0: 0, t1: 0 };
  }
  function faderValue(f, now) {
    if (now >= f.t1) return f.v1;
    if (now <= f.t0) return f.v0;
    return f.v0 + (f.v1 - f.v0) * (now - f.t0) / (f.t1 - f.t0);
  }
  function fadeTo(f, target, now, seconds) {
    const from = faderValue(f, now);
    try {
      f.param.cancelScheduledValues(now);
    } catch (e) {
    }
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
      const degree = (c % 5 + 5) % 5;
      if (home.indexOf(degree) >= 0) return c;
    }
    return idx;
  }
  function bounce(idx, lo, hi) {
    if (idx < lo) return lo + (lo - idx);
    if (idx > hi) return hi - (idx - hi);
    return idx;
  }
  function createAudioEngine(ctx, options) {
    const opt = options || {};
    const manual = !!opt.manual;
    const r = makeRng(opt.seed);
    const born = ctx.currentTime;
    const master = ctx.createGain();
    const masterFader = makeFader(master.gain, MASTER_LEVEL);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 4e-3;
    comp.release.value = 0.2;
    try {
      comp.release.setValueAtTime(0, born);
      comp.release.setValueAtTime(0.2, born + 0.05);
    } catch (e) {
    }
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
    const send = ctx.createGain();
    send.gain.value = ECHO_SEND;
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = ECHO_TIME;
    const dark = ctx.createBiquadFilter();
    dark.type = "lowpass";
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
      muted: false,
      hidden: false,
      playing: false,
      intensity: 0,
      chapter: 1,
      bud: 0,
      foot: false,
      lastStart: -1,
      lastAsk: -1e9,
      queuedWhileStopped: 0
    };
    let voices = [];
    const log = [];
    const counts = { played: 0, dropped: 0, stolen: 0, pad: 0, kalimba: 0, celesta: 0 };
    const mu = {
      running: false,
      timer: null,
      t0: 0,
      padNext: 0,
      padCount: 0,
      kal: { next: 0, left: 0, idx: 5 },
      cel: { next: 0, idx: 10 },
      on: [false, false, false],
      voices: /* @__PURE__ */ new Set()
    };
    let hideTimer = null;
    let analyser = null;
    function running() {
      return manual || ctx.state === "running";
    }
    function resume() {
      try {
        if (manual || st.hidden || ctx.state === "running" || ctx.state === "closed") return;
        const p = ctx.resume();
        if (p && typeof p.catch === "function") p.catch(noop);
      } catch (e) {
      }
    }
    function frameClock() {
      if (manual || typeof performance === "undefined") return ctx.currentTime * 1e3;
      return performance.now();
    }
    function endEarly(k, when, fade) {
      stopKit(k, when, fade);
      if (!manual && !k.done) {
        setTimeout(function() {
          releaseKit(k);
        }, Math.max(0, when - ctx.currentTime) * 1e3 + 400);
      }
    }
    function note(name, start, action, kit) {
      log.push({ name, at: ctx.currentTime, start, action, kit: kit || null });
      if (log.length > 64) log.shift();
    }
    function play2(name) {
      const fn = SOUNDS[name];
      if (typeof fn !== "function") return;
      const p = { key: CHAPTERS[st.chapter].key, idx: 0, alt: false };
      if (name === "budOn") {
        p.idx = st.bud;
        st.bud = Math.min(st.bud + 1, BUD_TOP);
      } else if (name === "budOff") {
        st.bud = Math.max(st.bud - 1, 0);
        p.idx = st.bud;
      } else if (name === "solve") {
        p.idx = st.bud;
        st.bud = 0;
      } else if (name === "restart") {
        st.bud = 0;
      } else if (name === "step") {
        st.foot = !st.foot;
        p.alt = st.foot;
      }
      if (st.muted || st.hidden) return;
      if (!running()) {
        resume();
        if (st.queuedWhileStopped >= 2) return;
        st.queuedWhileStopped++;
      } else {
        st.queuedWhileStopped = 0;
      }
      const now = ctx.currentTime;
      voices = voices.filter(function(v) {
        return !v.kit.done && v.kit.end > now;
      });
      const foley = FOLEY[name] === 1;
      const clock = frameClock();
      const sameFrame = clock - st.lastAsk < 12;
      st.lastAsk = clock;
      let start = Math.max(now + 5e-3, born + 0.02);
      if (st.lastStart + STAGGER_MAX > now && (sameFrame || ACTIONS[name] !== 1)) {
        start = Math.max(start, st.lastStart + STAGGER_MIN + r() * (STAGGER_MAX - STAGGER_MIN));
      } else if (LOOSE[name] === 1) {
        start += r() * 0.012;
      }
      if (foley && start - now > MAX_BACKLOG) {
        counts.dropped++;
        note(name, start, "drop");
        return;
      }
      const alive = voices.filter(function(v) {
        return v.kit.end > start;
      });
      let same = 0;
      for (let i = 0; i < alive.length; i++) if (alive[i].name === name) same++;
      if (foley && same >= MAX_SAME) {
        counts.dropped++;
        note(name, start, "drop");
        return;
      }
      if (alive.length >= MAX_VOICES) {
        if (foley) {
          counts.dropped++;
          note(name, start, "drop");
          return;
        }
        let victim = null;
        for (let i = 0; i < alive.length && !victim; i++) if (alive[i].foley) victim = alive[i];
        for (let i = 0; i < alive.length && !victim; i++) if (alive[i].name !== "solve") victim = alive[i];
        if (victim) {
          endEarly(victim.kit, start + 0.03, 0.03);
          counts.stolen++;
        }
      }
      const level = LEVELS[name] * Math.pow(0.84, same);
      const k = makeKit(ctx, sfx, level, r);
      fn(k, start, p);
      voices.push({ name, start, kit: k, foley });
      st.lastStart = Math.max(st.lastStart, start);
      counts.played++;
      note(name, start, "play", k);
    }
    function musicKit(layer, level) {
      const k = makeKit(ctx, layers[layer], level, r);
      mu.voices.add(k);
      k.onDone = function(kit) {
        mu.voices.delete(kit);
      };
      return k;
    }
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
        [color, 0.22]
      ], 0.026, first ? 1.6 : 3.2, 3.4, 4.6, true);
      mu.padCount++;
      counts.pad++;
    }
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
        if (mu.padNext < now - 0.5) mu.padNext = now + 0.02;
        while (mu.padNext < horizon) {
          schedulePad(Math.max(mu.padNext, now + 0.01));
          mu.padNext += (mu.padCount === 1 ? 4.8 : 6.4) + r() * 0.8;
        }
        if (mu.on[1]) {
          if (mu.kal.next < now - 0.5) {
            mu.kal.next = nextBeat(now + 0.1, 0);
            mu.kal.left = 0;
          }
          let guard = 0;
          while (mu.kal.next < horizon && guard++ < 16) scheduleKalimba(now);
        }
        if (mu.on[2]) {
          if (mu.cel.next < now - 0.5) mu.cel.next = nextBeat(now + 0.1, 0.5);
          let guard = 0;
          while (mu.cel.next < horizon && guard++ < 16) scheduleCelesta(now);
        }
      } catch (e) {
      }
    }
    function setLayers(now) {
      const want = [true, st.intensity > LAYER2_AT, st.intensity > LAYER3_AT];
      for (let i = 0; i < 3; i++) {
        if (want[i] === mu.on[i]) continue;
        mu.on[i] = want[i];
        fadeTo(layerFaders[i], want[i] ? 1 : 0, now, LAYER_FADE);
        if (want[i] && i === 1) {
          mu.kal.next = nextBeat(now + 0.3, 0);
          mu.kal.left = 0;
        }
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
      mu.on[0] = true;
      fadeTo(layerFaders[0], 1, now, 0.05);
      setLayers(now);
      fadeTo(musicFader, MUSIC_LEVEL, now, 0.6);
      if (!manual && mu.timer === null) mu.timer = setInterval(tick, TICK_MS);
      tick();
    }
    function stopMusicVoices(when, fade) {
      mu.voices.forEach(function(k) {
        endEarly(k, when, fade);
      });
      mu.voices.clear();
    }
    function stopMusic(now) {
      mu.running = false;
      if (mu.timer !== null) {
        clearInterval(mu.timer);
        mu.timer = null;
      }
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
    function setMusic2(o) {
      if (!o || typeof o !== "object") return;
      const before = st.chapter;
      if (typeof o.playing === "boolean") st.playing = o.playing;
      if (typeof o.intensity === "number" && o.intensity === o.intensity) st.intensity = clamp(o.intensity, 0, 1);
      if (typeof o.chapter === "number" && o.chapter === o.chapter) st.chapter = clamp(Math.round(o.chapter), 1, 3);
      if (st.intensity === 0) st.bud = 0;
      if (st.chapter !== before && mu.running) {
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
    function setMuted2(muted) {
      st.muted = !!muted;
      fadeTo(masterFader, st.muted ? 0 : MASTER_LEVEL, ctx.currentTime, st.muted ? 0.06 : 0.09);
      updateMusic();
    }
    function setHidden(hidden) {
      hidden = !!hidden;
      if (hidden === st.hidden) return;
      st.hidden = hidden;
      if (hideTimer !== null) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      updateMusic();
      if (manual) return;
      if (hidden) {
        hideTimer = setTimeout(function() {
          hideTimer = null;
          try {
            if (st.hidden && ctx.state === "running") {
              const p = ctx.suspend();
              if (p && typeof p.catch === "function") p.catch(noop);
            }
          } catch (e) {
          }
        }, 700);
      } else {
        resume();
      }
    }
    function debug(o) {
      const now = ctx.currentTime;
      let nodes = 0;
      voices.forEach(function(v) {
        nodes += v.kit.nodes.length;
      });
      mu.voices.forEach(function(k) {
        nodes += k.nodes.length;
      });
      const info = {
        state: ctx.state,
        time: now,
        sampleRate: ctx.sampleRate,
        muted: st.muted,
        hidden: st.hidden,
        bud: st.bud,
        nodes,
        voices: voices.filter(function(v) {
          return !v.kit.done && v.kit.end > now;
        }).length,
        music: {
          running: mu.running,
          playing: st.playing,
          intensity: st.intensity,
          chapter: st.chapter,
          layers: mu.on.slice(),
          voices: mu.voices.size,
          gains: layerFaders.map(function(f) {
            return faderValue(f, now);
          }),
          bus: faderValue(musicFader, now)
        },
        counts: Object.assign({}, counts),
        log: log.map(function(l) {
          return { name: l.name, at: l.at, start: l.start, action: l.action, end: l.kit ? l.kit.end : l.start };
        })
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
        } catch (e) {
          info.meter = null;
        }
      }
      return info;
    }
    return { ctx, play: play2, setMusic: setMusic2, setMuted: setMuted2, setHidden, resume, tick, debug, inputs: { sfx, layers } };
  }
  var engine = null;
  var failed = false;
  var wanted = { muted: false, music: { playing: false, intensity: 0, chapter: 1 } };
  var appHidden = false;
  function pageHidden() {
    return appHidden || typeof document !== "undefined" && document.visibilityState === "hidden";
  }
  function initAudio() {
    try {
      if (!engine && !failed) {
        if (typeof window === "undefined") return false;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        let ctx;
        try {
          ctx = new AC({ latencyHint: "interactive" });
        } catch (e) {
          ctx = new AC();
        }
        try {
          engine = createAudioEngine(ctx);
        } catch (e) {
          failed = true;
          try {
            ctx.close();
          } catch (e2) {
          }
          return false;
        }
        engine.setMuted(wanted.muted);
        engine.setMusic(wanted.music);
        if (typeof document !== "undefined" && document.addEventListener) {
          const onVisibility = function() {
            try {
              engine.setHidden(pageHidden());
            } catch (e) {
            }
          };
          document.addEventListener("visibilitychange", onVisibility);
          onVisibility();
          const wake = function() {
            try {
              engine.resume();
            } catch (e) {
            }
          };
          window.addEventListener("pointerdown", wake, { passive: true });
          window.addEventListener("keydown", wake, { passive: true });
        }
      }
      if (!engine) return false;
      engine.resume();
      return true;
    } catch (e) {
      return false;
    }
  }
  function setMuted(muted) {
    wanted.muted = !!muted;
    try {
      if (engine) engine.setMuted(wanted.muted);
    } catch (e) {
    }
  }
  function isMuted() {
    return wanted.muted;
  }
  function setAppHidden(hidden) {
    appHidden = !!hidden;
    try {
      if (engine) engine.setHidden(pageHidden());
    } catch (e) {
    }
  }
  function play(name) {
    try {
      if (engine) engine.play(name);
    } catch (e) {
    }
  }
  function setMusic(options) {
    try {
      if (!options || typeof options !== "object") return;
      const m = wanted.music;
      if (typeof options.playing === "boolean") m.playing = options.playing;
      if (typeof options.intensity === "number" && options.intensity === options.intensity) {
        m.intensity = clamp(options.intensity, 0, 1);
      }
      if (typeof options.chapter === "number" && options.chapter === options.chapter) {
        m.chapter = clamp(Math.round(options.chapter), 1, 3);
      }
      if (engine) engine.setMusic(m);
    } catch (e) {
    }
  }
  function audioDebug(options) {
    try {
      return engine ? engine.debug(options) : null;
    } catch (e) {
      return null;
    }
  }
  return __toCommonJS(audio_exports);
})();
