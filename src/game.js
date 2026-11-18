// Glimmerdeep: the app. Owns the DOM, input, animation flow and saving; the rules live in engine.js.
//
//   title screen (Play)  ->  map screen  ->  level screen (top bar, board canvas, thumb bar)  ->  result panel
//   story pages (Wren's journal, between chapters) show on the way, and the map opens the Field Journal.
//
// Every legal action goes through Session.act (one engine.step), then BoardView animates the events.

import { key, DIRS } from './engine.js';
import { nextMove } from './solver.js';
import { CHAPTERS, LEVELS } from './levels/index.js';
import { DAILY } from './levels/daily.js';
import { initAudio, setMuted, play, setAppHidden } from './audio.js';
import { Session } from './ui/session.js';
import {
  loadSave, writeSave, recordResult, clearProgress, parseSave, newerSave, setSaveMirror, saveWrites, savedDurably,
} from './ui/store.js';
import { BoardView } from './ui/board.js';
import { applyIcons, setIcon, portraitUrl, sceneUrl, mossSvg, pipSvg } from './ui/art.js';
import { RULE_CARDS, cardKindAt } from './ui/cards.js';
import { renderMap, layoutMap } from './ui/map.js';
import {
  onBackButton, exitApp, haptic, onAppState, openStore, mirrorSave, readSaveMirror,
} from './ui/native.js';
import { PRODUCTS, CATALOG, FREE_CHAPTER, chapterOpen, hintCost, payHint, hintLabel, minutesWord, settle } from './ui/shop.js';
import { TitleArt } from './ui/title.js';
import { Tutorial, resolvePoint, STUCK_AFTER } from './ui/tutorial.js';
import { NOTES, storyDue, journal, pageById, speciesOf } from './ui/story.js';
import { dateKey, dayLabel, dateLabel, dailyLevel, streakOf, weekOf, dayOpen, finishDaily } from './ui/daily.js';

const SWIPE = 24;          // px a finger travels before it counts as a swipe
const TAP_SLOP = 12;       // px a finger may wander and still be a tap or a hold
const HOLD_MS = 450;       // long-press for a rule card
const QUEUE_MAX = 2;       // inputs remembered while an animation runs
const HINT_BUDGET = 150000;
const STUCK_TEXT = 'Stuck? Hint shows the next move, and Undo steps back.';
const STUCK_FOR = 4;       // moves the stuck nudge stays up
const CAUGHT_TEXT = 'The Hush caught you. Three steps back.';
const CATCH_BACK = 3;      // moves a catch takes back (SPEC section 17)
const CATCH_PAUSE = 450;   // ms the catch stays on screen before the steps back
const DIR_WORD = { N: 'north', E: 'east', S: 'south', W: 'west' };
// The lantern button: [label, screen-reader label] and the hint for each thing it can do (session.lanternAction()).
const LANTERN_LABEL = {
  plant: ['Plant', 'Plant the lantern'],
  pickup: ['Pick up', 'Pick up the lantern'],
  aim: ['Aim', 'Aim the lantern'],
  open: ['Open', 'Open the lantern'],
};
const LANTERN_HINT = {
  plant: 'Hint: set the lantern down here.',
  pickup: 'Hint: pick the lantern up.',
  aim: 'Hint: aim the lantern from here.',
  open: 'Hint: open the lantern again.',
};
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
const storyEl = $('screen-story');
const journalEl = $('screen-journal');
const chaptersEl = $('chapters');
const canvas = $('board');
const statusEl = $('status');
const counterEl = $('counter');
const scrim = $('scrim');
const shopScrim = $('shop-scrim');
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
setSaveMirror(mirrorSave);   // every write also goes to the app's own file (SPEC section 16)
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
let catches = 0;           // times the Hush caught Wren this visit (SPEC section 17)
let catchNudge = false;    // after the second catch the Hint button pulses until a hint, an undo or a restart
let rewindTimer = 0;
let book = null;           // story pages showing (SPEC section 13): { ids, index, reading, then }
let journalTab = 'creatures';
const queue = [];
// the store (SPEC section 14): null until src/ui/native.js says which store sells
let store = null;
let prices = {};
let buying = false;
let shopNote = '';
let shopWhy = '';

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

// A chapter that is part of the Full Expedition and not bought yet. ?unlock=1 (a developer link) skips it.
function chapterLocked(chapter) {
  return !forceUnlock && !chapterOpen(save.shop, chapter.id);
}

function isUnlocked(def) {
  if (forceUnlock) return true;
  if (chapterLocked(chapterOf(def))) return false;   // Unlock all skips the level order, never the purchase
  const i = LEVELS.indexOf(def);
  if (i <= 0 || save.settings.unlockAll) return true;
  return !!save.levels[def.id] || !!save.levels[LEVELS[i - 1].id];
}

// ---------------------------------------------------------------- the Daily Glimmer (SPEC section 15)

const DAILY_CHAPTER = { id: 0, name: 'Daily Glimmer', accent: '#F2C46D', levels: [] };
let todayOverride = null;   // __gd.setToday stands in for the clock in checks

function today() {
  return todayOverride || dateKey(new Date());
}

// ?unlock=1 (a developer link) opens the archive as it opens the chapters
function dailyOpen(day) {
  return dayOpen(forceUnlock ? { ...save.shop, full: true } : save.shop, day, today());
}

// What the map's card shows (src/ui/map.js dailyCard), or null with no pool.
function dailyView() {
  const t = today();
  const def = dailyLevel(DAILY, t);
  if (!def) return null;
  return {
    dateLabel: dayLabel(t),
    name: def.name,
    streak: streakOf(save.daily, t),
    todayStars: save.daily[t] ? save.daily[t].stars : 0,
    week: weekOf(save.daily, t).map((d) => ({ ...d, open: dailyOpen(d.key) })),
    onPlay: () => {
      play('ui');
      openDaily(t);
    },
    onDay: (day) => {
      play('ui');
      openDaily(day);
    },
    onLocked: () => {
      play('ui');
      openShop('archive');
    },
  };
}

function openDaily(day) {
  const def = dailyLevel(DAILY, day);
  return def && dailyOpen(day) ? openLevel(def, true, day) : false;
}

// A daily cavern not lit yet opens the rule card of the first creature in it not met in the chapters.
function openDailyCard() {
  if (!current.day || save.daily[current.day] || panel || screen !== 'level') return;
  const met = new Set(journal(save, CHAPTERS).creatures.filter((c) => c.met).map((c) => c.kind));
  const kind = speciesOf(current.def).find((k) => !met.has(k) && RULE_CARDS[k]);
  if (kind) openCard(kind);
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

// A sound the app plays itself (not the board), remembered for checks like the board's cues.
function sfx(name) {
  heard.push(name);
  if (heard.length > 40) heard.shift();
  play(name);
}

// ---------------------------------------------------------------- screens

function showScreen(name) {
  screen = name;
  app.dataset.screen = name;
  titleEl.hidden = name !== 'title';
  mapEl.hidden = name !== 'map';
  levelEl.hidden = name !== 'level';
  storyEl.hidden = name !== 'story';
  journalEl.hidden = name !== 'journal';
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
  titleProgress();
  showScreen('title');
}

function titleProgress() {
  const lit = LEVELS.filter((def) => save.levels[def.id]).length;
  const progress = $('title-progress');
  progress.textContent = lit ? `${lit} of ${LEVELS.length} caverns lit` : '';
  progress.hidden = !lit;
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
    chapterLocked,
    onShop: (chapter) => {
      play('ui');
      openShop('chapter', chapter);
    },
    daily: dailyView(),
  });
  for (const lock of chaptersEl.querySelectorAll('.lock')) setIcon(lock, 'lock');
  const j = journal(save, CHAPTERS);
  $('btn-journal').querySelector('.val').textContent = `${j.met} of ${j.total} met`;
  syncSettings();
}

// ---------------------------------------------------------------- story pages and the Field Journal

// Shows story pages as one little book, then calls `then`. reading: a page opened again from the Journal.
function openBook(ids, opts = {}) {
  if (!ids.length) {
    if (opts.then) opts.then();
    return;
  }
  book = { ids, index: 0, reading: !!opts.reading, then: opts.then || showMap };
  showScreen('story');
  showPage();
}

function showPage() {
  const page = pageById(book.ids[book.index]);
  if (!page) return;
  const chapter = CHAPTERS.find((c) => c.id === page.chapter);
  $('story-kicker').textContent = chapter ? `Chapter ${chapter.id}: ${chapter.name}` : 'Prologue';
  $('story-title').textContent = page.title;
  const lines = $('story-lines');
  lines.textContent = '';
  for (const line of page.lines) {
    const p = document.createElement('p');
    p.textContent = line;
    lines.appendChild(p);
  }
  const url = sceneUrl(page.scene, chapter ? chapter.accent : undefined);
  $('story-art').style.backgroundImage = url ? `url(${url})` : 'none';
  const count = $('story-count');
  count.hidden = book.ids.length < 2;
  count.textContent = `Page ${book.index + 1} of ${book.ids.length}`;
  const next = $('story-next');
  next.textContent = book.reading ? 'Back to journal' : book.index < book.ids.length - 1 ? 'Next page' : 'Continue';
  next.setAttribute('aria-label', next.textContent);
  $('story-scroll').scrollTop = 0;
  if (!book.reading && !save.seen.includes(page.id)) {
    save.seen.push(page.id);
    writeSave(save);
  }
  sfx('page');
  try {
    next.focus({ preventScroll: true });
  } catch (e) {
    // focus is a courtesy
  }
}

function nextPage() {
  if (!book) return;
  if (book.index < book.ids.length - 1) {
    book.index++;
    showPage();
  } else {
    closeBook();
  }
}

// Closes the book at once; pages it did not reach count as seen too (they stay in the Journal).
function closeBook() {
  if (!book) return;
  const done = book;
  book = null;
  if (!done.reading) {
    for (const id of done.ids) if (!save.seen.includes(id)) save.seen.push(id);
    writeSave(save);
  }
  done.then();
}

// Leaves a result panel toward `go`, with any story pages that are due on the way.
function leaveResult(go) {
  const due = storyDue(save, CHAPTERS, { at: 'result' });
  if (!due.length) {
    go();
    return;
  }
  leaveLevel();
  openBook(due, { then: go });
}

function showJournal(tab) {
  leaveLevel();
  if (tab) journalTab = tab;
  showScreen('journal');
  renderJournal();
}

function renderJournal() {
  const j = journal(save, CHAPTERS);
  const list = $('journal-list');
  list.textContent = '';
  const creatures = journalTab === 'creatures';
  $('tab-creatures').setAttribute('aria-selected', creatures ? 'true' : 'false');
  $('tab-story').setAttribute('aria-selected', creatures ? 'false' : 'true');
  list.setAttribute('aria-labelledby', creatures ? 'tab-creatures' : 'tab-story');
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  if (creatures) {
    $('journal-count').textContent = `${j.met} of ${j.total} met`;
    for (const c of j.creatures) {
      const entry = el('article', 'entry paper' + (c.met ? ' met' : ' unmet'));
      const art = el('span', 'entry-art');
      art.setAttribute('aria-hidden', 'true');
      const chapter = CHAPTERS.find((ch) => ch.id === c.chapter.id);
      if (c.met) {
        const url = portraitUrl(c.kind, chapter && chapter.accent);
        art.style.backgroundImage = url ? `url(${url})` : 'none';
      }
      entry.appendChild(art);
      const body = el('div', 'entry-body');
      if (c.met) {
        body.appendChild(el('span', 'kicker ink', `Met in ${c.chapter.name}`));
        body.appendChild(el('h3', '', c.name));
        body.appendChild(el('p', 'rule', RULE_CARDS[c.kind].text));
        body.appendChild(el('p', 'note', NOTES[c.kind]));
      } else {
        body.appendChild(el('span', 'kicker ink', `Chapter ${c.chapter.id}`));
        body.appendChild(el('h3', '', 'Not met yet'));
        body.appendChild(el('p', 'rule', `Somewhere in ${c.chapter.name}.`));
      }
      entry.appendChild(body);
      list.appendChild(entry);
    }
  } else {
    const read = j.pages.filter((p) => p.unlocked).length;
    $('journal-count').textContent = `${read} of ${j.pages.length} pages`;
    for (const p of j.pages) {
      const entry = el('article', 'entry paper page-entry' + (p.unlocked ? ' open' : ' dark'));
      if (p.unlocked) {
        const open = el('button', 'entry-open');
        open.type = 'button';
        open.setAttribute('aria-label', `Read: ${p.title}`);
        open.appendChild(el('span', 'kicker ink', p.kicker));
        open.appendChild(el('h3', '', p.title));
        const page = pageById(p.id);
        open.appendChild(el('p', 'preview', page.lines[0]));
        open.addEventListener('click', () => {
          play('ui');
          openBook([p.id], { reading: true, then: () => showJournal('story') });
        });
        entry.appendChild(open);
      } else {
        entry.appendChild(el('span', 'kicker ink', p.kicker));
        entry.appendChild(el('h3', '', 'Still dark'));
        entry.appendChild(el('p', 'preview', `Light the last cavern of ${p.chapter.name} to read it.`));
      }
      list.appendChild(entry);
    }
  }
  list.scrollTop = 0;
}

// Starts a level. -> false when the definition does not parse.
// day: the date of a Daily Glimmer cavern ('YYYY-MM-DD'); its levels are ad hoc for the chapters' records.
function openLevel(def, adhoc, day) {
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
  current = { def, chapter: day ? DAILY_CHAPTER : chapterOf(def), adhoc: !!adhoc || !LEVELS.includes(def), day: day || null, result: null };
  // Tutorials and the stuck nudge are for a level's first visits: never solved, and the setting on.
  const guided = save.settings.tutorials && (day ? !save.daily[day] : !current.adhoc && !save.levels[def.id]);
  tutorial = guided && Array.isArray(def.tutorial) && def.tutorial.length ? new Tutorial(def.tutorial) : null;
  stuck = guided && typeof def.par === 'number' ? 0 : -1;
  catches = 0;
  catchNudge = false;
  window.clearTimeout(rewindTimer);
  moved = false;
  message = '';
  celebrating = false;
  lastBloom = -1;
  view.highContrast = save.settings.contrast;
  view.setLevel(session.state, { accent: current.chapter.accent, facing: session.facing });
  $('level-id').textContent = day ? `Daily Glimmer, ${dateLabel(day)}` : def.id !== undefined ? `Level ${def.id}` : 'Test cavern';
  $('level-name').textContent = def.name || 'Unnamed cavern';
  clearHint();
  showScreen('level');
  refreshHud();
  openTutorialCard();
  openDailyCard();
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

  const over = session.solved || session.caught;
  setDisabled(btn.undo, !session.canUndo);
  setDisabled(btn.restart, !session.canUndo && session.state === session.start);
  setDisabled(btn.wait, over);
  setDisabled(btn.hint, over);
  refreshHintLabel();
  const action = session.lanternAction() || 'pickup';
  setDisabled(btn.lantern, over || !session.canUseLantern());
  const label = LANTERN_LABEL[action];
  const lbl = btn.lantern.querySelector('.lbl');
  if (lbl.textContent !== label[0]) {
    lbl.textContent = label[0];
    btn.lantern.setAttribute('aria-label', label[1]);
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
  pulse(btn.hint, stuck > 0 || catchNudge);
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

// An undo, a restart or a hint sends the nudge away for the rest of the visit (and the nudge after catches).
function dismissStuck() {
  if (stuck > 0) stuck = -1;
  catchNudge = false;
}

// ---------------------------------------------------------------- actions

// One engine step, animated. -> true when the action was legal.
function doAction(action) {
  if (!session || session.solved || session.caught) return false;
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
  if (next.caught) caughtNow();
  refreshHud();
  openTutorialCard();
  return true;
}

// The Hush crept onto Wren (SPEC section 17). The board plays the catch; once it settles, three moves go back.
function caughtNow() {
  queue.length = 0;
  cancelWalk();
  catches++;
  if (catches >= 2) catchNudge = true;
  message = CAUGHT_TEXT;
  buzz('tap');
}

function rewindAfterCatch() {
  const s = session;
  window.clearTimeout(rewindTimer);
  rewindTimer = window.setTimeout(() => {
    if (session !== s || !s.caught) return;
    const before = s.state;
    s.rewind(CATCH_BACK);
    view.playTween(before, s.state, { facing: s.facing });
    refreshHud();
  }, CATCH_PAUSE);
}

// An action asked for by the player. Waits its turn if the board is still moving.
function userAction(action) {
  cancelWalk();
  if (!session || panel || celebrating || session.solved || session.caught) return;
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
  if (session.caught) {
    rewindAfterCatch();
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
  if (!session || panel || celebrating || session.solved || session.caught) return;
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

// The Hint button's second line says what the next hint costs (SPEC section 14).
function refreshHintLabel() {
  const val = $('hint-val');
  const text = hintLabel(save.shop, Date.now());
  if (val.textContent !== text) val.textContent = text;
  const cost = hintCost(save.shop, Date.now());
  const aria = cost.kind === 'free' ? 'Hint, free'
    : cost.kind === 'glimmer' ? `Hint, ${cost.glimmer} Glimmer left`
      : `Hint, next free hint in ${minutesWord(cost.waitMs)}`;
  if (btn.hint.getAttribute('aria-label') !== aria) btn.hint.setAttribute('aria-label', aria);
}

function requestHint() {
  if (!session || session.solved || session.caught || celebrating || thinking || panel) return;
  // paid for when asked, whatever it finds; with nothing to pay with, the store says when the next free one comes
  if (!payHint(save.shop, Date.now())) {
    play('ui');
    openShop('hint');
    return;
  }
  writeSave(save);
  refreshHintLabel();
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
    message = LANTERN_HINT[session.lanternAction()] || 'Hint: pick the lantern up.';
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
  const result = { marks, stars, moves, best: null, firstTime: false, improved: false, glimmer: 0 };
  if (current.day) {
    const old = save.daily[current.day];
    const daily = finishDaily(save.daily, save.shop, current.day, today(), moves, stars);
    result.firstTime = !old;
    result.improved = !!old && moves < old.moves;
    result.best = daily.record;
    result.glimmer = daily.glimmer;
    writeSave(save);
  } else if (!current.adhoc) {
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
  $('result-id').textContent = current.day ? `Daily Glimmer, ${dateLabel(current.day)}`
    : def.id !== undefined ? `Level ${def.id} lit` : 'Cavern lit';
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
  const lines = [];
  if (r.best && !r.firstTime) {
    lines.push(r.improved
      ? `A new best: ${r.best.moves} moves.`
      : `Your best: ${r.best.moves} move${r.best.moves === 1 ? '' : 's'}, ${r.best.stars} of 3 star moss.`);
  }
  if (r.glimmer) lines.push(`+${r.glimmer} Glimmer for lighting today's cavern.`);
  best.textContent = lines.join(' ');
  best.hidden = !lines.length;
  const next = nextLevelAfter(def);
  $('result-next').hidden = !next || current.adhoc;
  openPanel('result');
}

// ---------------------------------------------------------------- panels

function openPanel(name) {
  panel = name;
  if (name === 'shop') {
    shopScrim.hidden = false;
  } else if (name !== 'confirm') {
    scrim.hidden = false;
    scrim.className = name === 'result' ? 'scrim soft' : 'scrim';
  }
  const el = $(name);
  el.hidden = false;
  const focus = name === 'result'
    ? ($('result-next').hidden ? $('result-replay') : $('result-next'))
    : name === 'card' ? $('card-close') : name === 'shop' ? $('shop-close') : $('confirm-no');
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
  shopScrim.hidden = true;
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

// ---------------------------------------------------------------- store (SPEC section 14)

const NEXT_PAID = LEVELS.filter((def) => chapterOf(def).id !== FREE_CHAPTER).length;

// reason: 'chapter' (a locked chapter, or Next after chapter 1), 'hint' (nothing left to pay with), 'archive' (a
// locked Daily Glimmer day), or none
function openShop(reason, chapter) {
  if (panel) closePanel();
  cancelWalk();
  queue.length = 0;
  shopNote = '';
  if (reason === 'chapter' && chapter) shopWhy = `Chapter ${chapter.id}, ${chapter.name}, is part of the Full Expedition.`;
  else if (reason === 'archive') shopWhy = 'The Daily Glimmer archive is part of the Full Expedition.';
  else if (reason === 'hint') shopWhy = `No Glimmer left. The next free hint comes in ${minutesWord(hintCost(save.shop, Date.now()).waitMs)}.`;
  else shopWhy = '';
  renderShop();
  openPanel('shop');
}

function renderShop() {
  const why = $('shop-why');
  why.textContent = shopWhy;
  why.hidden = !shopWhy;
  const later = CHAPTERS.filter((c) => c.id !== FREE_CHAPTER);
  const span = later.length ? `Chapters ${later[0].id} to ${later[later.length - 1].id}` : 'Every chapter';
  $('shop-full-text').textContent = `${span}: ${NEXT_PAID} more caverns and the rest of Wren's story. One payment, no ads.`;
  const cost = hintCost(save.shop, Date.now());
  const jar = CATALOG.find((p) => p.id === PRODUCTS.jar);
  $('shop-jar-text').textContent = `${jar.glimmer} instant hints. You have ${save.shop.glimmer} Glimmer, and `
    + (cost.kind === 'free' ? 'a free hint is ready now.' : `the next free hint comes in ${minutesWord(cost.waitMs)}.`);
  const full = $('shop-full');
  const owned = !!save.shop.full;
  full.textContent = owned ? 'Owned' : (prices[PRODUCTS.full] || '…');
  full.setAttribute('aria-label', owned ? 'Full Expedition owned' : `Buy the Full Expedition, ${prices[PRODUCTS.full] || 'price loading'}`);
  setDisabled(full, owned || !store || buying);
  const buyJar = $('shop-jar');
  buyJar.textContent = prices[PRODUCTS.jar] || '…';
  buyJar.setAttribute('aria-label', `Buy a Glimmer jar, ${prices[PRODUCTS.jar] || 'price loading'}`);
  setDisabled(buyJar, !store || buying);
  setDisabled($('shop-restore'), !store || buying);
  $('shop-note').textContent = buying ? 'Waiting for the store…' : shopNote;
  $('shop-test').hidden = !store || store.kind !== 'test';
}

// Grants what the store reports, saves, confirms with the store once the save is on disk (SPEC section 16), and
// redraws. -> the product ids granted
function applyPurchases(purchases) {
  const out = settle(save.shop, purchases);
  if (out.granted.length) writeSave(save);
  const s = store;
  if (s && out.confirm.length) savedDurably().then(() => s.confirm(out.confirm));
  if (out.granted.length) {
    sfx('solve');
    if (screen === 'map') drawMap();
    if (session) refreshHud();
    if (panel === 'shop') renderShop();
  }
  return out.granted;
}

function thanks(granted) {
  if (granted.includes(PRODUCTS.full)) return 'Thank you! Every chapter is open now.';
  const jar = CATALOG.find((p) => p.id === PRODUCTS.jar);
  const n = granted.filter((id) => id === PRODUCTS.jar).length * jar.glimmer;
  return `Thank you! ${n} Glimmer added.`;
}

async function buy(id) {
  if (!store || buying) return;
  play('ui');
  buying = true;
  shopNote = '';
  renderShop();
  let r;
  try {
    r = await store.buy(id);
  } catch (e) {
    r = { status: 'error', message: '', purchases: [] };
  }
  buying = false;
  const granted = applyPurchases(r.purchases || []);
  if (granted.length) shopNote = thanks(granted);
  else if (r.status === 'pending') shopNote = 'Payment pending. You will get it as soon as it clears.';
  else if (r.status === 'unready') shopNote = 'The store is not ready yet. Check your connection and try again.';
  else if (r.status === 'error') shopNote = 'The purchase did not go through.' + (r.message ? ` (${r.message})` : '');
  else shopNote = '';
  renderShop();
}

async function restorePurchases() {
  if (!store || buying) return;
  play('ui');
  buying = true;
  renderShop();
  let note;
  try {
    const granted = applyPurchases(await store.owned());
    note = granted.length ? 'Purchases restored.' : 'Nothing new to restore.';
  } catch (e) {
    note = 'Could not reach the store. Try again later.';
  }
  buying = false;
  shopNote = note;
  renderShop();
}

// The second copy of the save was written more often (the app was killed before localStorage reached the disk):
// take it, write it back, and redraw what shows the save. SPEC section 16.
function adoptSave(other) {
  if (newerSave(save, other) === save) return;
  for (const k of ['levels', 'seen', 'shop', 'daily', 'settings', 'rev']) save[k] = other[k];
  writeSave(save);
  syncSettings();
  if (screen === 'title') titleProgress();
  if (screen === 'map') drawMap();
  if (session) refreshHud();
}

// Reads the second copy, then opens the store, so a purchase is always settled on the right save. A copy that
// does not answer in 3 s is left alone.
function startSave() {
  const writesAtStart = saveWrites();
  const wait = new Promise((resolve) => { window.setTimeout(() => resolve(null), 3000); });
  Promise.race([readSaveMirror(), wait])
    .then((raw) => {
      if (raw && saveWrites() === writesAtStart) adoptSave(parseSave(raw));
    })
    .catch(() => {})
    .then(startStore);
}

function startStore() {
  openStore(CATALOG).then(async (s) => {
    store = s;
    store.onPurchases((list) => applyPurchases(list));
    if (panel === 'shop') renderShop();
    try {
      prices = await store.prices();
    } catch (e) {
      prices = {};
    }
    if (panel === 'shop') renderShop();
    try {
      applyPurchases(await store.owned());
    } catch (e) {
      // offline: Restore, or the next start, finds them
    }
  }).catch(() => {});
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
  if (next && !isUnlocked(next) && chapterLocked(chapterOf(next))) {
    // the end of the free chapter: its story page, then the map with the store open
    const chapter = chapterOf(next);
    leaveResult(() => {
      showMap();
      openShop('chapter', chapter);
    });
    return;
  }
  leaveResult(next ? () => openLevel(next) : showMap);
});
onClick($('result-replay'), () => {
  play('ui');
  if (current) openLevel(current.def, current.adhoc, current.day);
});
onClick($('result-map'), () => {
  play('ui');
  leaveResult(showMap);
});

function startPlaying() {
  play('ui');
  openBook(storyDue(save, CHAPTERS, { at: 'play' }), { then: showMap });
}
onClick($('btn-play'), startPlaying);

onClick($('story-next'), () => nextPage());
onClick($('btn-shop'), () => {
  play('ui');
  openShop();
});
onClick($('shop-full'), () => {
  if (!isDisabled($('shop-full'))) buy(PRODUCTS.full);
});
onClick($('shop-jar'), () => {
  if (!isDisabled($('shop-jar'))) buy(PRODUCTS.jar);
});
onClick($('shop-restore'), () => {
  if (!isDisabled($('shop-restore'))) restorePurchases();
});
onClick($('shop-close'), () => {
  play('ui');
  closePanel();
});
shopScrim.addEventListener('click', () => {
  if (panel === 'shop') closePanel();
});
onClick($('btn-journal'), () => {
  play('ui');
  showJournal('creatures');
});
onClick($('journal-back'), () => {
  play('ui');
  showMap();
});
onClick($('tab-creatures'), () => {
  play('ui');
  journalTab = 'creatures';
  renderJournal();
});
onClick($('tab-story'), () => {
  play('ui');
  journalTab = 'story';
  renderJournal();
});

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
  if (screen === 'story') closeBook();
  else if (screen === 'journal') {
    play('ui');
    showMap();
  } else if (panel === 'result') leaveResult(showMap);
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
    if (screen === 'story') closeBook();
    else if (screen === 'journal') showMap();
    else if (panel === 'result') leaveResult(showMap);
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
  if (panel === 'shop') return;   // the store keeps the board still; Escape closes it
  if (what === 'undo') undo();
  else if (what === 'restart') {
    if (panel === 'result') openLevel(current.def, current.adhoc, current.day);
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
    if (screen === 'map') drawMap();   // the Daily Glimmer may be a new day
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
  const scroller = e.target && e.target.closest
    && (screen === 'map' && e.target.closest('.chapters')
      || screen === 'journal' && e.target.closest('.journal-list')
      || screen === 'story' && e.target.closest('.story-scroll'));
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
  caught: () => (session ? session.caught : false),
  catches: () => catches,
  panel: () => panel,
  busy: () => view.busy || celebrating && panel !== 'result',
  hint: () => (view.hint ? (view.hint.dir || 'ring') : null),
  layout: () => (view.layout ? { ...view.layout, left: view.rect.left, top: view.rect.top, dpr: view.dpr, frames: view.frames } : null),
  save: () => JSON.parse(JSON.stringify(save)),
  contrast: () => view.highContrast,
  frames: () => view.frames,
  coach: () => (session ? coachPoint() : null),
  story: () => (book ? { id: book.ids[book.index], index: book.index, count: book.ids.length, reading: book.reading } : null),
  tutorial: () => (tutorial ? { index: tutorial.index, done: tutorial.done } : null),
  heard: () => heard.slice(),
  shop: () => ({ ...JSON.parse(JSON.stringify(save.shop)), kind: store ? store.kind : null, prices: { ...prices } }),
  // resolves true once every save so far is on disk (SPEC section 16)
  saved: () => savedDurably().then(() => true),
  // the Daily Glimmer's date, in place of the clock ('YYYY-MM-DD', or null for the clock again)
  setToday: (day) => {
    todayOverride = day || null;
    if (screen === 'map') drawMap();
    return today();
  },
};

// ---------------------------------------------------------------- start

applyIcons(document);
syncMotion();
syncSettings();
showTitle();
startSave();
// the Hint button's "in 7 min" counts down
window.setInterval(() => {
  if (screen === 'level' && session) refreshHintLabel();
}, 15000);
const direct = params.get('level');
if (direct) window.__gd.loadLevel(direct);
