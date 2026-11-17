// The title screen's picture: Wren holding the lit lantern in a small pool of light, with a few motes
// drifting up through the glow. Drawn on its own canvas, animated only while the title is showing.
import { drawWren } from '../chars.js';

const TAU = Math.PI * 2;
const MOTES = 14;

// fixed pseudo-random numbers, so the motes are the same on every launch
function rand(i, k) {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class TitleArt {
  // canvas covers the whole title screen; stage is the empty box Wren is drawn in
  constructor(canvas, stage) {
    this.canvas = canvas;
    this.stage = stage;
    this.box = { x: 0, y: 0, w: 1, h: 1 };
    this.ctx = canvas.getContext('2d');
    this.raf = 0;
    this.frames = 0;
    this.still = false;   // reduced motion: one frame, no loop
    this.cssW = 0;
    this.cssH = 0;
    this.dpr = 1;
    this.t0 = 0;
    this.tick = (now) => {
      this.raf = 0;
      this.draw((now - this.t0) / 1000);
      if (!this.still) this.raf = window.requestAnimationFrame(this.tick);
    };
  }

  setStill(still) {
    this.still = !!still;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const sr = this.stage ? this.stage.getBoundingClientRect() : r;
    this.box = { x: sr.left - r.left, y: sr.top - r.top, w: Math.max(1, sr.width), h: Math.max(1, sr.height) };
    if (w === this.cssW && h === this.cssH && dpr === this.dpr) return;
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  start() {
    this.resize();
    if (!this.t0) this.t0 = window.performance ? window.performance.now() : Date.now();
    if (this.still) {
      this.stop();
      this.draw(0.6);
      return;
    }
    if (!this.raf) this.raf = window.requestAnimationFrame(this.tick);
  }

  stop() {
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  draw(t) {
    const { ctx, cssW: w, cssH: h, dpr } = this;
    this.frames++;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const b = this.box;
    const size = Math.min(b.w * 0.86, b.h * 0.86, 460);
    const cx = b.x + b.w / 2 - size * 0.06;   // the lantern hangs to the right, so Wren sits a touch left
    const top = b.y + b.h * 0.52 - size * 0.55;
    const flick = 0.85 + 0.1 * Math.sin(t * 7.3) + 0.05 * Math.sin(t * 13.1);
    const lx = cx + size * 0.3;        // the lantern, roughly
    const ly = top + size * 0.78;

    // the pool of light on the cave floor, and the glow around the lantern
    ctx.save();
    ctx.translate(lx, top + size * 0.9);
    ctx.scale(1, 0.32);
    let g = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.85);
    g.addColorStop(0, `rgba(242,176,76,${0.42 * flick})`);
    g.addColorStop(0.5, `rgba(242,176,76,${0.12 * flick})`);
    g.addColorStop(1, 'rgba(242,176,76,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.85, 0, TAU);
    ctx.fill();
    ctx.restore();
    g = ctx.createRadialGradient(lx, ly, 0, lx, ly, size * 0.75);
    g.addColorStop(0, `rgba(242,176,76,${0.3 * flick})`);
    g.addColorStop(0.45, `rgba(242,176,76,${0.09 * flick})`);
    g.addColorStop(1, 'rgba(242,176,76,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // motes rising through the light
    for (let i = 0; i < MOTES; i++) {
      const speed = 0.04 + 0.05 * rand(i, 1);
      const p = (rand(i, 2) + t * speed) % 1;                   // 0 at the floor, 1 at the top
      const x = lx + (rand(i, 3) - 0.5) * size * 1.3 + Math.sin(t * 0.9 + i) * size * 0.04;
      const y = ly + size * 0.15 - p * size * 1.1;
      const a = Math.sin(p * Math.PI) * (0.35 + 0.5 * rand(i, 4));
      const r = size * (0.006 + 0.008 * rand(i, 5));
      ctx.fillStyle = i % 4 === 0 ? `rgba(95,191,168,${a})` : `rgba(255,224,138,${a})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }

    drawWren(ctx, cx - size / 2, top, size, { dir: 'S', carrying: true, t });
  }
}
