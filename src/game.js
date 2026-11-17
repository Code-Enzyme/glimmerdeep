// Glimmerdeep: the app. Owns the DOM, input, animation flow and saving; the rules live in engine.js.
//
//   title screen (Play)  ->  map screen  ->  level screen (top bar, board canvas, thumb bar)  ->  result panel
//
// Every legal action goes through Session.act (one engine.step), then BoardView animates the events.

import { key, DIRS } from './engine.js';
import { nextMove } from './solver.js';
import { CHAPTERS, LEVELS } from './levels/index.js';
import { initAudio, setMuted, play, setAppHidden } from './audio.js';
import { Session } from './ui/session.js';
import { loadSave, writeSave, recordResult, clearProgress } from './ui/store.js';
import { BoardView } from './ui/board.js';
import { applyIcons, setIcon, portraitUrl, mossSvg, pipSvg } from './ui/art.js';
import { RULE_CARDS, cardKindAt } from './ui/cards.js';
import { renderMap, layoutMap } from './ui/map.js';
import { onBackButton, exitApp, haptic, onAppState } from './ui/native.js';
import { TitleArt } from './ui/title.js';
import { Tutorial, resolvePoint, STUCK_AFTER } from './ui/tutorial.js';

const SWIPE = 24;          // px a finger travels before it counts as a swipe
const TAP_SLOP = 12;       // px a finger may wander and still be a tap or a hold
const HOLD_MS = 450;       // long-press for a rule card
const QUEUE_MAX = 2;       // inputs remembered while an animation runs
const HINT_BUDGET = 150000;
const STUCK_TEXT = 'Stuck? Hint shows the next move, and Undo steps back.';
const STUCK_FOR = 4;       // moves the stuck nudge stays up
const DIR_WORD = { N: 'north', E: 'east', S: 'south', W: 'west' };
const KEYS = {
  ArrowUp: 'N', w: 'N', W: 'N',
  ArrowRight: 'E', d: 'E', D: 'E',
  ArrowDown: 'S', s: 'S', S: 'S',
  ArrowLeft: 'W', a: 'W', A: 'W',
  ' ': 'L', Spacebar: 'L', l: 'L', L: 'L',
  '.': 'Z',
  z: 'undo', Z: 'undo', u: 'undo', U: 'undo', Backspace: 'undo',
  r: 'restart', R: 'restart',
  h: 'hint', H: 'hint',
};

const $ = (id) => document.getElementById(id);
const app = $('app');
const titleEl = $('screen-title');
const mapEl = $('screen-map');
const levelEl = $('screen-level');
const chaptersEl = $('chapters');
const canvas = $('board');
const statusEl = $('status');
const counterEl = $('counter');
const scrim = $('scrim');
const btn = {
  undo: $('btn-undo'),
  restart: $('btn-restart'),
  wait: $('btn-wait'),
  lantern: $('btn-lantern'),
  hint: $('btn-hint'),
};
// The thumb-bar buttons a tutorial step can point at (SPEC section 12).
const COACH_BUTTON = { plant: btn.lantern, wait: btn.wait, undo: btn.undo, hint: btn.hint };

const save = loadSave();
let params;
try {
  params = new URLSearchParams(window.location.search);
} catch (e) {
  params = { get: () => null };
}
const forceUnlock = params.get('unlock') === '1';

let screen = 'title';
let session = null;        // the attempt in progress
let current = null;        // { def, chapter, adhoc, result }
let panel = null;          // 'card' | 'result' | 'confirm' | null
let walk = null;           // { path, tiles, i } while Wren follows a tapped path
let message = '';          // passing line for the status row (hints)
let moved = false;         // the first move of this visit was made (the tip goes away)
let thinking = false;
let hintToken = 0;
let celebrating = false;
let lastBloom = -1;
let raf = 0;
let woke = false;
let gesture = null;
let armedAt = 0;           // a rule card ignores taps until the finger that opened it has lifted
let tutorial = null;       // this visit's guided steps (SPEC section 12), or null
let stuck = -1;            // the stuck nudge: 0 armed, above 0 showing until that move count, -1 used up or off
const queue = [];

const titleArt = new TitleArt($('title-art'), $('title-stage'));

const heard = [];          // the last sounds the board asked for (for checks)
const view = new BoardView(canvas, {
  onCue: (name) => {
    heard.push(name);
    if (heard.length > 40) heard.shift();
    play(name);
  },
  onSettled,
  onCelebrated,
});

// ---------------------------------------------------------------- small helpers

function chapterOf(def) {
  for (const chapter of CHAPTERS) if (chapter.levels && chapter.levels.includes(def)) return chapter;
  const m = /^(\d+)-/.exec(String(def && def.id));
  if (m) {
    const chapter = CHAPTERS.find((c) => String(c.id) === m[1]);
    if (chapter) return chapter;
  }
  return CHAPTERS[0] || { id: 1, name: '', accent: '#5FBFA8', levels: [] };
}

function isUnlocked(def) {
  const i = LEVELS.indexOf(def);
  if (i <= 0 || forceUnlock || save.settings.unlockAll) return true;
  return !!save.levels[def.id] || !!save.levels[LEVELS[i - 1].id];
}

function nextLevelAfter(def) {
  const i = LEVELS.indexOf(def);
  return i >= 0 && i + 1 < LEVELS.length ? LEVELS[i + 1] : null;
}

function buzz(kind) {
  if (!woke) return;   // browsers refuse vibration before a gesture, and say so in the console
  haptic(kind);
}

function wake() {
  if (woke) return;
  woke = true;
  initAudio();
}


function setDisabled(button, disabled) {
  const value = disabled ? 'true' : 'false';
  if (button.getAttribute('aria-disabled') !== value) button.setAttribute('aria-disabled', value);
}

function isDisabled(button) {
  return button.getAttribute('aria-disabled') === 'true';
}

function pulse(button, on) {
  button.classList.toggle('pulse', !!on);
}

// ---------------------------------------------------------------- screens

function showScreen(name) {
  screen = name;
  app.dataset.screen = name;
  titleEl.hidden = name !== 'title';
  mapEl.hidden = name !== 'map';
  levelEl.hidden = name !== 'level';
  if (name === 'level') {
    view.resize();
    startLoop();
  } else {
    stopLoop();
  }
  if (name === 'title' && !document.hidden) titleArt.start();
  else titleArt.stop();
}

function leaveLevel() {
  closePanel();
  stopHintSearch();
  cancelWalk();
  queue.length = 0;
  session = null;
  current = null;
  celebrating = false;
}

function showTitle() {
  leaveLevel();
  const lit = LEVELS.filter((def) => save.levels[def.id]).length;
  const progress = $('title-progress');
  progress.textContent = lit ? `${lit} of ${LEVELS.length} caverns lit` : '';
  progress.hidden = !lit;
  showScreen('title');
}

function showMap() {
  leaveLevel();
  showScreen('map');
  drawMap();
}

function drawMap() {
  renderMap(chaptersEl, {
    chapters: CHAPTERS,
    levels: LEVELS,
    records: save.levels,
    isUnlocked,
    onOpen: (def) => {
      play('ui');
      openLevel(def);
    },
    onLocked: (def, node) => {
      play('blocked');
      node.classList.remove('wiggle');
      void node.offsetWidth;   // restart the animation
      node.classList.add('wiggle');
    },
  });
  for (const lock of chaptersEl.querySelectorAll('.lock')) setIcon(lock, 'lock');
  syncSettings();
}

// Starts a level. -> false when the definition does not parse.
function openLevel(def, adhoc) {
  let fresh;
  try {
    fresh = new Session(def);
  } catch (e) {
    return false;
  }
  tutorial = null;
  closePanel();
  stopHintSearch();
  cancelWalk();
  queue.length = 0;
  session = fresh;
  current = { def, chapter: chapterOf(def), adhoc: !!adhoc || !LEVELS.includes(def), result: null };
  // Tutorials and the stuck nudge are for a level's first visits: never solved, and the setting on.
  const guided = save.settings.tutorials && !current.adhoc && !save.levels[def.id];
  tutorial = guided && Array.isArray(def.tutorial) && def.tutorial.length ? new Tutorial(def.tutorial) : null;
  stuck = guided && typeof def.par === 'number' ? 0 : -1;
  moved = false;
  message = '';
  celebrating = false;
  lastBloom = -1;
  view.highContrast = save.settings.contrast;
  view.setLevel(session.state, { accent: current.chapter.accent, facing: session.facing });
  $('level-id').textContent = def.id !== undefined ? `Level ${def.id}` : 'Test cavern';
  $('level-name').textContent = def.name || 'Unnamed cavern';
  clearHint();
  showScreen('level');
  refreshHud();
  openTutorialCard();
  return true;
}

// ---------------------------------------------------------------- the frame loop

function frame(now) {
  raf = 0;
  if (screen !== 'level' || document.hidden) return;
  view.draw(now);
  raf = window.requestAnimationFrame(frame);
}

function startLoop() {
  if (!raf && screen === 'level' && !document.hidden) raf = window.requestAnimationFrame(frame);
}

function stopLoop() {
  if (raf) window.cancelAnimationFrame(raf);
  raf = 0;
}

// ---------------------------------------------------------------- HUD

function refreshHud() {
  if (!session) return;
  const def = current.def;
  const moves = session.moves;
  const hasPar = typeof def.par === 'number';
  const counterText = hasPar ? `${moves} / par ${def.par}` : `${moves} moves`;
  if (counterEl.dataset.text !== counterText) {
    counterEl.dataset.text = counterText;
    counterEl.textContent = '';
    const n = document.createElement('b');
    n.textContent = String(moves);
    counterEl.appendChild(n);
    counterEl.appendChild(document.createTextNode(hasPar ? ` / par ${def.par}` : ' moves'));
    counterEl.setAttribute('aria-label', hasPar ? `Moves: ${moves}. Par: ${def.par}.` : `Moves: ${moves}.`);
  }

  const over = session.solved;
  setDisabled(btn.undo, !session.canUndo);
  setDisabled(btn.restart, !session.canUndo && session.state === session.start);
  setDisabled(btn.wait, over);
  setDisabled(btn.hint, over);
  const carried = session.state.lantern.carried;
  setDisabled(btn.lantern, over || !session.canUseLantern());
  const label = carried ? 'Plant' : 'Pick up';
  const lbl = btn.lantern.querySelector('.lbl');
  if (lbl.textContent !== label) {
    lbl.textContent = label;
    btn.lantern.setAttribute('aria-label', carried ? 'Plant the lantern' : 'Pick up the lantern');
  }

  refreshCoach();
  refreshStatus();

  const bloom = session.bloomCount();
  if (bloom !== lastBloom) {
    lastBloom = bloom;
  }
}

// The line under the top bar: a hint message, the stuck nudge, the tutorial step, the level's tip until
// the first move, else the bloom count.
function refreshStatus() {
  if (!session) return;
  const def = current.def;
  const step = coachStep();
  let text;
  let pips = '';
  if (message) {
    text = message;
  } else if (stuck > 0) {
    text = STUCK_TEXT;
  } else if (step && typeof step.say === 'string' && step.say) {
    text = step.say;
  } else if (!moved && typeof def.tip === 'string' && def.tip) {
    text = def.tip;
  } else {
    const total = session.state.buds.length;
    const bloom = session.bloomCount();
    for (let i = 0; i < total; i++) pips += pipSvg(session.state.bloom[i] === 1);
    text = `${bloom} of ${total} Glowbud${total === 1 ? '' : 's'} in bloom`;
  }
  const sig = pips + '|' + text;
  if (statusEl.dataset.sig === sig) return;
  statusEl.dataset.sig = sig;
  statusEl.textContent = '';
  if (pips) {
    const span = document.createElement('span');
    span.className = 'pips';
    span.innerHTML = pips;
    statusEl.appendChild(span);
  }
  statusEl.appendChild(document.createTextNode(text));
}

// ---------------------------------------------------------------- tutorials (SPEC section 12)

// The tutorial step on show now, or null.
function coachStep() {
  if (!tutorial || !session || session.solved) return null;
  return tutorial.current(session.state);
}

// What the step on show points at, with its gesture. -> resolvePoint's answer plus { gesture }, or null
function coachPoint() {
  const step = coachStep();
  if (!step || step.card) return null;
  const point = resolvePoint(step.point, session.state);
  return point ? { ...point, gesture: step.gesture || null } : null;
}

// Hands the pointer to the board, or makes the button it names pulse; the stuck nudge pulses Hint.
function refreshCoach() {
  const point = coachPoint();
  view.coach = point && point.kind !== 'button' ? point : null;
  for (const name of Object.keys(COACH_BUTTON)) {
    COACH_BUTTON[name].classList.toggle('coach', !!point && point.kind === 'button' && point.name === name);
  }
  pulse(btn.hint, stuck > 0);
}

// A step that meets a new creature opens its rule card as soon as it comes up.
function openTutorialCard() {
  const step = coachStep();
  if (step && step.card && !panel && screen === 'level') openCard(step.card);
}

// After every legal action: the tutorial may move on, and the stuck nudge may come or go.
function tutorialAfter(next) {
  const def = current.def;
  if (tutorial) {
    if (next.solved) tutorial.end();
    else tutorial.advance(next.events, next);
  }
  if (next.solved) stuck = -1;
  else if (stuck === 0 && session.moves >= def.par + STUCK_AFTER) stuck = session.moves + STUCK_FOR;
  else if (stuck > 0 && session.moves >= stuck) stuck = -1;
}

// An undo, a restart or a hint sends the nudge away for the rest of the visit.
function dismissStuck() {
  if (stuck > 0) stuck = -1;
}

// ---------------------------------------------------------------- actions

// One engine step, animated. -> true when the action was legal.
function doAction(action) {
  if (!session || session.solved) return false;
  const prev = session.state;
  const next = session.act(action);
  if (next === null) {
    view.facing = session.facing;
    view.nudge(DIRS[action] ? action : null);
    play('blocked');
    return false;
  }
  clearHint();
  moved = true;
  tutorialAfter(next);
  view.playTurn(prev, next, { facing: session.facing, speed: queue.length ? 1.5 : 1 });
  buzz('tick');
  refreshHud();
  openTutorialCard();
  return true;
}

// An action asked for by the player. Waits its turn if the board is still moving.
function userAction(action) {
  cancelWalk();
  if (!session || panel || celebrating || session.solved) return;
  if (view.busy) {
    if (queue.length < QUEUE_MAX) queue.push(action);
    return;
  }
  doAction(action);
}

function onSettled() {
  if (!session) return;
  if (session.solved) {
    if (!celebrating) beginCelebration();
    return;
  }
  pump();
}

// Whatever is waiting: queued inputs first, then the next step of a tapped walk.
function pump() {
  while (queue.length) {
    if (doAction(queue.shift())) return;
  }
  if (walk) stepWalk();
}

function undo() {
  if (!session) return false;
  cancelWalk();
  queue.length = 0;
  const before = session.state;
  const bloomBefore = session.bloomCount();
  if (!session.undo()) return false;
  stopHintSearch();
  dismissStuck();
  clearHint();
  if (panel === 'result' || panel === 'card') closePanel();
  celebrating = false;
  view.endCelebration();
  view.playTween(before, session.state, { facing: session.facing });
  // The bud scale in audio.js steps back once per 'budOff'; it stands in for the undo sound.
  const lost = bloomBefore - session.bloomCount();
  if (lost > 0) for (let i = 0; i < lost; i++) play('budOff');
  else play('undo');
  refreshHud();
  return true;
}

function restart() {
  if (!session) return false;
  cancelWalk();
  queue.length = 0;
  const before = session.state;
  if (!session.restart()) return false;
  stopHintSearch();
  dismissStuck();
  if (tutorial) tutorial.restart();
  clearHint();
  if (panel === 'result' || panel === 'card') closePanel();
  celebrating = false;
  view.endCelebration();
  view.playTween(before, session.state, { facing: session.facing });
  play('restart');
  refreshHud();
  return true;
}

// ---------------------------------------------------------------- tap to walk

function tapTile(tile) {
  if (!session || panel || celebrating || session.solved) return;
  const s = session.state;
  if (tile.x === s.wren.x && tile.y === s.wren.y) {
    userAction('L');
    return;
  }
  queue.length = 0;
  const path = session.pathTo(tile.x, tile.y);
  if (!path) {
    const dx = tile.x - s.wren.x;
    const dy = tile.y - s.wren.y;
    if (Math.abs(dx) + Math.abs(dy) === 1) {
      userAction(dx === 1 ? 'E' : dx === -1 ? 'W' : dy === 1 ? 'S' : 'N');   // bumps, with the usual shake
    } else {
      view.addEffect({ type: 'cross', x: tile.x, y: tile.y });
      play('blocked');
    }
    return;
  }
  const tiles = [];
  let x = s.wren.x;
  let y = s.wren.y;
  for (const action of path) {
    x += DIRS[action][0];
    y += DIRS[action][1];
    tiles.push({ x, y });
  }
  walk = { path, tiles, i: 0 };
  view.path = tiles;
  if (!view.busy) stepWalk();
}

// One step of the walk. Each step is a full engine turn, so the path is re-checked as the cave reacts.
function stepWalk() {
  const w = walk;
  if (!w) return;
  if (w.i >= w.path.length) {
    cancelWalk();
    return;
  }
  const action = w.path[w.i++];
  view.path = w.tiles.slice(w.i);
  if (!doAction(action) || w.i >= w.path.length) {
    walk = null;
    view.path = null;
  }
}

function cancelWalk() {
  walk = null;
  view.path = null;
}

// ---------------------------------------------------------------- hint

function requestHint() {
  if (!session || session.solved || celebrating || thinking || panel) return;
  cancelWalk();
  queue.length = 0;
  thinking = true;
  session.hints++;
  dismissStuck();
  btn.hint.classList.add('thinking');
  btn.hint.querySelector('.lbl').textContent = 'Thinking';
  play('hint');
  const token = ++hintToken;
  // Let the "thinking" state reach the screen before the search holds the thread.
  const run = () => {
    if (token !== hintToken) return;
    const asked = session ? session.state : null;
    let move = null;
    if (asked) {
      try {
        move = nextMove(asked, { maxStates: HINT_BUDGET });
      } catch (e) {
        move = null;
      }
    }
    stopHintSearch();
    if (!session || session.state !== asked) return;
    showHint(move);
  };
  window.requestAnimationFrame(() => window.setTimeout(run, 0));
}

function stopHintSearch() {
  hintToken++;
  if (!thinking) return;
  thinking = false;
  btn.hint.classList.remove('thinking');
  btn.hint.querySelector('.lbl').textContent = 'Hint';
}

function showHint(move) {
  clearHint();
  if (move === null) {
    if (session.canUndo) {
      message = 'No way forward from here. Step back a move or two.';
      pulse(btn.undo, true);
    } else {
      message = 'No way forward that I can find from here.';
    }
  } else if (DIRS[move]) {
    view.hint = { dir: move };
    message = `Hint: step ${DIR_WORD[move]}.`;
  } else if (move === 'L') {
    view.hint = { ring: true };
    message = session.state.lantern.carried ? 'Hint: set the lantern down here.' : 'Hint: pick the lantern up.';
    pulse(btn.lantern, true);
  } else {
    view.hint = { ring: true };
    message = 'Hint: wait a turn.';
    pulse(btn.wait, true);
  }
  refreshStatus();
}

function clearHint() {
  view.hint = null;
  message = '';
  pulse(btn.undo, false);
  pulse(btn.lantern, false);
  pulse(btn.wait, false);
  refreshStatus();
}

// ---------------------------------------------------------------- solved

function beginCelebration() {
  celebrating = true;
  cancelWalk();
  queue.length = 0;
  const def = current.def;
  const marks = session.marks();
  const stars = session.stars();
  const moves = session.moves;
  const result = { marks, stars, moves, best: null, firstTime: false, improved: false };
  if (!current.adhoc) {
    const old = save.levels[def.id];
    result.firstTime = !old;
    result.improved = !!old && moves < old.moves;
    result.best = recordResult(save, def.id, moves, stars);
    writeSave(save);
  }
  current.result = result;
  view.startCelebration();
  play('solve');
  buzz('success');
  refreshHud();
}

function onCelebrated() {
  if (!session || !session.solved || !celebrating || !current.result) return;
  showResult();
}

function showResult() {
  const def = current.def;
  const r = current.result;
  $('result-id').textContent = def.id !== undefined ? `Level ${def.id} lit` : 'Cavern lit';
  $('result-name').textContent = def.name || 'Unnamed cavern';
  const hasPar = typeof def.par === 'number';
  $('result-moves').textContent = `${r.moves} move${r.moves === 1 ? '' : 's'}` + (hasPar ? `  ·  par ${def.par}` : '');
  const marks = [
    [r.marks.solved, 'Solved'],
    [r.marks.par, hasPar ? 'At or under par' : 'Par'],
    [r.marks.clean, 'No hints'],
  ];
  const list = $('result-marks');
  list.textContent = '';
  for (const [earned, caption] of marks) {
    const li = document.createElement('li');
    li.className = earned ? 'earned' : 'missed';
    li.innerHTML = mossSvg(earned, 40);
    const text = document.createElement('span');
    text.textContent = caption;
    li.appendChild(text);
    const sr = document.createElement('span');
    sr.className = 'sr';
    sr.textContent = earned ? ' (earned)' : ' (not earned)';
    li.appendChild(sr);
    list.appendChild(li);
  }
  list.setAttribute('aria-label', `${r.stars} of 3 star moss`);
  const best = $('result-best');
  if (r.best && !r.firstTime) {
    best.textContent = r.improved
      ? `A new best: ${r.best.moves} moves.`
      : `Your best: ${r.best.moves} move${r.best.moves === 1 ? '' : 's'}, ${r.best.stars} of 3 star moss.`;
    best.hidden = false;
  } else {
    best.hidden = true;
  }
  const next = nextLevelAfter(def);
  $('result-next').hidden = !next || current.adhoc;
  openPanel('result');
}

// ---------------------------------------------------------------- panels

function openPanel(name) {
  panel = name;
  if (name !== 'confirm') {
    scrim.hidden = false;
    scrim.className = name === 'result' ? 'scrim soft' : 'scrim';
  }
  const el = $(name);
  el.hidden = false;
  const focus = name === 'result'
    ? ($('result-next').hidden ? $('result-replay') : $('result-next'))
    : name === 'card' ? $('card-close') : $('confirm-no');
  try {
    focus.focus({ preventScroll: true });
  } catch (e) {
    // focus is a courtesy
  }
}

function closePanel() {
  if (!panel) return false;
  const was = panel;
  $(panel).hidden = true;
  scrim.hidden = true;
  panel = null;
  // closing a tutorial's meet card finishes that step
  const step = was === 'card' ? coachStep() : null;
  if (step && step.card) {
    tutorial.cardClosed();
    refreshHud();
  }
  return true;
}

function openCard(kind) {
  const card = RULE_CARDS[kind];
  if (!card) return;
  cancelWalk();
  queue.length = 0;
  $('card-title').textContent = card.title;
  $('card-text').textContent = card.text;
  const url = portraitUrl(kind, current ? current.chapter.accent : undefined);
  $('card-art').style.backgroundImage = url ? `url(${url})` : 'none';
  armedAt = performance.now() + 400;
  openPanel('card');
  play('ui');
}

// ---------------------------------------------------------------- settings

function syncSettings() {
  const s = save.settings;
  const set = (id, on, word) => {
    const b = $(id);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.querySelector('.val').textContent = word || (on ? 'on' : 'off');
  };
  set('set-sound', s.sound);
  setIcon($('set-sound').querySelector('.ico'), s.sound ? 'sound' : 'mute');
  set('set-contrast', s.contrast);
  set('set-tutorials', s.tutorials);
  set('set-unlock', s.unlockAll || forceUnlock);
  app.classList.toggle('hc', s.contrast);
  view.highContrast = s.contrast;
  setMuted(!s.sound);
}

function toggleSetting(name) {
  save.settings[name] = !save.settings[name];
  writeSave(save);
  syncSettings();
  play('ui');
  if (name === 'unlockAll') drawMap();
}

// ---------------------------------------------------------------- input: board gestures

function endGesture() {
  if (!gesture) return;
  window.clearTimeout(gesture.timer);
  view.press = null;
  gesture = null;
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (gesture) return;   // a second finger changes nothing
  e.preventDefault();
  if (!session || panel) return;
  const walking = walk !== null;
  cancelWalk();          // any touch stops a walk in progress
  const tile = view.tileAt(e.clientX, e.clientY);
  gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, tile, swipes: 0, held: false, wandered: false, stopOnly: walking, timer: 0 };
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch (err) {
    // capture is a nicety
  }
  if (tile && !walking) {
    const kind = cardKindAt(session.state, tile.x, tile.y);
    if (kind) {
      view.press = { x: tile.x, y: tile.y, t0: performance.now(), dur: HOLD_MS };
      const g = gesture;
      gesture.timer = window.setTimeout(() => {
        if (gesture !== g || g.wandered || g.swipes) return;
        g.held = true;
        view.press = null;
        buzz('tap');
        openCard(kind);
      }, HOLD_MS);
    }
  }
});

canvas.addEventListener('pointermove', (e) => {
  const g = gesture;
  if (!g || e.pointerId !== g.id) return;
  const dx = e.clientX - g.x;
  const dy = e.clientY - g.y;
  const dist = Math.hypot(dx, dy);
  if (!g.wandered && dist > TAP_SLOP) {
    g.wandered = true;
    window.clearTimeout(g.timer);
    view.press = null;
  }
  if (g.held || g.stopOnly) return;
  // The first step needs a short swipe; keep dragging and Wren keeps walking, about a tile per step.
  const need = g.swipes === 0 ? SWIPE : Math.max(44, view.layout ? view.layout.size * 0.9 : 44);
  if (dist >= need) {
    g.swipes++;
    g.x = e.clientX;
    g.y = e.clientY;
    userAction(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N'));
  }
});

canvas.addEventListener('pointerup', (e) => {
  const g = gesture;
  if (!g || e.pointerId !== g.id) return;
  endGesture();
  if (g.held) armedAt = performance.now() + 300;   // the lift may still arrive as a click on the card
  if (g.swipes || g.held || g.stopOnly || g.wandered || !g.tile) return;
  tapTile(g.tile);
});

canvas.addEventListener('pointercancel', (e) => {
  if (gesture && e.pointerId === gesture.id) endGesture();
});

// ---------------------------------------------------------------- input: buttons

function onClick(el, handler) {
  el.addEventListener('click', (e) => {
    handler(e);
    if (e.detail > 0 && el.blur) el.blur();   // a pointer click must not leave Space bound to this button
  });
}

onClick(btn.undo, () => {
  if (!undo()) play('blocked');
});
onClick(btn.restart, () => {
  if (!restart()) play('blocked');
});
onClick(btn.wait, () => userAction('Z'));
onClick(btn.lantern, () => userAction('L'));
onClick(btn.hint, () => requestHint());
onClick($('back'), () => {
  play('ui');
  showMap();
});

onClick($('card-close'), (e) => {
  if (e.detail > 0 && performance.now() < armedAt) return;
  closePanel();
});
scrim.addEventListener('click', () => {
  if (panel === 'card' && performance.now() >= armedAt) closePanel();
});
onClick($('result-next'), () => {
  const next = current && nextLevelAfter(current.def);
  play('ui');
  if (next) openLevel(next);
  else showMap();
});
onClick($('result-replay'), () => {
  play('ui');
  if (current) openLevel(current.def, current.adhoc);
});
onClick($('result-map'), () => {
  play('ui');
  showMap();
});

function startPlaying() {
  play('ui');
  showMap();
}
onClick($('btn-play'), startPlaying);

onClick($('set-sound'), () => toggleSetting('sound'));
onClick($('set-contrast'), () => toggleSetting('contrast'));
onClick($('set-tutorials'), () => toggleSetting('tutorials'));
onClick($('set-unlock'), () => toggleSetting('unlockAll'));
onClick($('set-reset'), () => {
  play('ui');
  if (panel === 'confirm') closePanel();
  else openPanel('confirm');
});
onClick($('confirm-yes'), () => {
  clearProgress(save);
  writeSave(save);
  closePanel();
  play('restart');
  drawMap();
});
onClick($('confirm-no'), () => {
  play('ui');
  closePanel();
});

// ---------------------------------------------------------------- input: Android back button

onBackButton(() => {
  if (panel === 'result') showMap();
  else if (panel) closePanel();
  else if (screen === 'level') {
    play('ui');
    showMap();
  } else if (screen === 'map') {
    play('ui');
    showTitle();
  } else exitApp();
});

// ---------------------------------------------------------------- input: keyboard

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape') {
    if (panel === 'result') showMap();
    else if (panel) closePanel();
    else if (screen === 'map') showTitle();
    return;
  }
  if (screen === 'title') {
    const onButton = e.target && e.target.closest && e.target.closest('button');
    if (!onButton && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) {
      e.preventDefault();
      startPlaying();
    }
    return;
  }
  if (screen !== 'level' || !session) return;
  const onButton = e.target && e.target.closest && e.target.closest('button');
  if (onButton && (e.key === ' ' || e.key === 'Enter' || e.key === 'Spacebar')) return;   // the button's own click
  const what = KEYS[e.key];
  if (!what) return;
  e.preventDefault();
  if (panel === 'card') {
    closePanel();
    return;
  }
  if (what === 'undo') undo();
  else if (what === 'restart') {
    if (panel === 'result') openLevel(current.def, current.adhoc);
    else restart();
  } else if (panel) return;
  else if (what === 'hint') requestHint();
  else userAction(what);
});

// ---------------------------------------------------------------- page behaviour

window.addEventListener('pointerdown', wake, true);
window.addEventListener('keydown', wake, true);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopLoop();
    titleArt.stop();
  } else {
    startLoop();
    if (screen === 'title') titleArt.start();
  }
});
// In the app, going to the background also pauses drawing and puts sound to sleep.
onAppState((active) => {
  setAppHidden(!active);
  if (active) {
    startLoop();
    if (screen === 'title') titleArt.start();
  } else {
    stopLoop();
    titleArt.stop();
  }
});

function onResize() {
  if (screen === 'level') view.resize();
  else if (screen === 'title') titleArt.start();
  else layoutMap(chaptersEl);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => window.setTimeout(onResize, 80));
if (typeof ResizeObserver === 'function') {
  new ResizeObserver(onResize).observe($('stage'));
  new ResizeObserver(onResize).observe(chaptersEl);
  new ResizeObserver(onResize).observe($('title-stage'));
}

// No callouts, no selection, no pinch or double-tap zoom, no rubber-band scroll during play.
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('selectstart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => {
  if (!e.cancelable) return;
  const scroller = screen === 'map' && e.target && e.target.closest && e.target.closest('.chapters');
  if (!scroller || e.touches.length > 1) e.preventDefault();
}, { passive: false });

const motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
function syncMotion() {
  view.reduced = !!(motion && motion.matches);
  titleArt.setStill(view.reduced);
  if (screen === 'title') titleArt.start();
}
if (motion) {
  if (motion.addEventListener) motion.addEventListener('change', syncMotion);
  else if (motion.addListener) motion.addListener(syncMotion);
}

// ---------------------------------------------------------------- test hooks

// Finish whatever is animating so a hook call acts on a still board.
function settleNow() {
  cancelWalk();
  queue.length = 0;
  view.finish();
}

window.__gd = {
  state: () => (session ? session.state : null),
  act: (action) => {
    if (!session) return false;
    settleNow();
    return doAction(action);
  },
  undo: () => {
    if (!session) return false;
    settleNow();
    return undo();
  },
  restart: () => {
    if (!session) return false;
    settleNow();
    restart();
    return session.state === session.start;
  },
  loadLevel: (id) => {
    const def = LEVELS.find((level) => String(level.id) === String(id));
    return def ? openLevel(def) : false;
  },
  loadLevelDef: (def) => openLevel(def, true),
  screen: () => screen,
  titleFrames: () => titleArt.frames,
  // extras, handy for checks
  key: () => (session ? key(session.state) : null),
  moves: () => (session ? session.moves : 0),
  hints: () => (session ? session.hints : 0),
  panel: () => panel,
  busy: () => view.busy || celebrating && panel !== 'result',
  hint: () => (view.hint ? (view.hint.dir || 'ring') : null),
  layout: () => (view.layout ? { ...view.layout, left: view.rect.left, top: view.rect.top, dpr: view.dpr, frames: view.frames } : null),
  save: () => JSON.parse(JSON.stringify(save)),
  contrast: () => view.highContrast,
  frames: () => view.frames,
  coach: () => (session ? coachPoint() : null),
  tutorial: () => (tutorial ? { index: tutorial.index, done: tutorial.done } : null),
  heard: () => heard.slice(),
};

// ---------------------------------------------------------------- start

applyIcons(document);
syncMotion();
syncSettings();
showTitle();
const direct = params.get('level');
if (direct) window.__gd.loadLevel(direct);
