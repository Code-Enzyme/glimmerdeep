// Glimmerdeep: the app. Owns the DOM, input, animation flow and saving; the rules live in engine.js.
//
//   title screen (Play)  ->  map screen  ->  level screen (top bar, board canvas, thumb bar)  ->  result panel
//   story pages (Wren's journal, between chapters) show on the way, and the map opens the Field Journal.
//   The map's Workshop card opens your own caverns (SPEC section 26): the list, the editor, playing a code.
//
// Every legal action goes through Session.act (one engine.step), then BoardView animates the events.

import { key, DIRS } from './engine.js';
import { solve } from './solver.js';
import { CHAPTERS, LEVELS } from './levels/index.js';
import { DAILY } from './levels/daily.js';
import { NIGHT, GARDEN } from './levels/night.js';
import { initAudio, setMuted, play, setAppHidden } from './audio.js';
import { Session } from './ui/session.js';
import {
  loadSave, writeSave, recordResult, clearProgress, parseSave, adoptInto, setSaveMirror, saveWrites, savedDurably,
} from './ui/store.js';
import { BoardView } from './ui/board.js';
import { applyIcons, setIcon, portraitUrl, sceneUrl, mossSvg, pipSvg, wayMoveSvg, lanternSwatchUrl } from './ui/art.js';
import { setLanternStyle, lanternStyle } from './chars.js';
import { LANTERNS, lanternInUse, isUnlocked as styleUnlocked, starMoss } from './ui/lanterns.js';
import { RULE_CARDS, cardKindAt } from './ui/cards.js';
import { HintLadder, pieceText } from './ui/hints.js';
import { previewOf } from './ui/preview.js';
import { reducedMotion, swipeNeed } from './ui/comfort.js';
import { describeBoard, describeTurn, describeRefusal, describeBack } from './ui/talk.js';
import { levelOpen, lockedWhy, othersOpen } from './ui/paths.js';
import { NEWS, newsDue } from './ui/news.js';
import { brambleShown } from './ui/bramble.js';
import { noteAdd, notesReport, versionLabel } from './ui/notes.js';
import { CRITTERS, critterKind, dailyCritterKind, isFound, markFound, critterJournal } from './ui/critters.js';
import { renderMap, layoutMap } from './ui/map.js';
import {
  onBackButton, exitApp, haptic, onAppState, openStore, mirrorSave, readSaveMirror, speak, appVersion,
} from './ui/native.js';
import { PRODUCTS, CATALOG, FREE_CHAPTER, chapterOpen, hintCost, payHint, hintLabel, minutesWord, settle } from './ui/shop.js';
import { TitleArt } from './ui/title.js';
import { Tutorial, resolvePoint, STUCK_AFTER } from './ui/tutorial.js';
import { NOTES, storyDue, journal, pageById, speciesOf } from './ui/story.js';
import { gardenState, gardenNote, puzzleOpen, levelTitle } from './ui/garden.js';
import { dateKey, dayLabel, dateLabel, dailyLevel, streakOf, weekOf, dayOpen, finishDaily } from './ui/daily.js';
import {
  MAX_CAVERNS, TOOLS, cavernName, newCavern, paint, resize, levelDef, cavernProblems, checkCavern, metInWorkshop,
  workshopOpen, nextSeed, cavernThumb, cavernSummary, canShare, playCode,
} from './ui/workshop.js';
import { encodeCavern, decodeCavern } from './ui/codes.js';
import { EditorView, toolIconUrl } from './ui/editor.js';

const TAP_SLOP = 12;       // px a finger may wander and still be a tap or a hold
const HOLD_MS = 450;       // long-press for a rule card
const QUEUE_MAX = 2;       // inputs remembered while an animation runs
const HINT_BUDGET = 150000;
const STUCK_TEXT = 'Stuck? Hint helps a step at a time, and Undo steps back.';
const OFF_WAY_TEXT = 'Off the way. Undo to get back on it.';
const PEEK_TEXT = 'Something small peeks out of the dark. Tap it to sketch it.';   // SPEC section 23
const WAY_SHOWN = 10;      // moves of the hint's way the status row shows at once (SPEC section 18)
const MOVE_WORD = { N: 'north', E: 'east', S: 'south', W: 'west', L: 'lantern', Z: 'wait' };
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
  c: 'sketch', C: 'sketch',
};

const $ = (id) => document.getElementById(id);
const app = $('app');
// the phone's reduce-motion setting, which the Comfort sheet's As phone follows (SPEC section 22)
const motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
const titleEl = $('screen-title');
const mapEl = $('screen-map');
const levelEl = $('screen-level');
const storyEl = $('screen-story');
const journalEl = $('screen-journal');
const workshopEl = $('screen-workshop');
const editorEl = $('screen-editor');
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
let critterNote = '';      // "Wren sketched a Dewmite for the Journal." until the next move (SPEC section 23)
let spoken = '';           // Board talk: the last words given to the voice, '' once it was stopped
let moved = false;         // the first move of this visit was made (the tip goes away)
let thinking = false;
let hintToken = 0;
let ladder = null;         // the hint paid for this visit (SPEC section 18): its way and the step reached, or null
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
let playFrom = null;       // 'editor' | 'workshop' while a Workshop cavern or a shared code is played (SPEC section 26)
let editing = null;        // the cavern in the editor: { index, tool, undo: [earlier caverns], note }
let stroke = null;         // a finger painting: { id, before, first, last, left, changed }
let checking = 0;          // a check by the solver is running (a cavern's Check, or a code's Play)
let deleteArmed = false;   // Delete was tapped once on the size sheet
let cavernWhy = '';        // why a size change was refused
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
const editorView = new EditorView($('editor-canvas'));

// ---------------------------------------------------------------- small helpers

function chapterOf(def) {
  if (NIGHT.includes(def) || /^N-/.test(String(def && def.id))) return GARDEN;
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
  if (NIGHT.includes(def)) return puzzleOpen(def, save, NIGHT, LEVELS, save.settings.unlockAll);
  if (!LEVELS.includes(def) || save.settings.unlockAll) return true;
  return levelOpen(def, CHAPTERS, save.levels);   // open ahead (SPEC section 29)
}

// The stuck nudge (SPEC section 12) points at the other open caverns when there are some (section 29).
function stuckText() {
  const n = current.adhoc || current.day ? 0 : othersOpen(current.def, LEVELS, isUnlocked, save.levels);
  if (!n) return STUCK_TEXT;
  const count = n === 1 ? 'one other cavern is' : `${['two', 'three', 'four', 'five'][n - 2] || n} other caverns are`;
  return `Stuck? Hint helps a step at a time, and ${count} open on the map.`;
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
  const n = NIGHT.indexOf(def);
  if (n >= 0) return NIGHT[n + 1] || null;   // on through the garden; the last deep puzzle has no next
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
  if (name !== 'level') visitEnd();   // tester notes (SPEC section 33)
  screen = name;
  app.dataset.screen = name;
  titleEl.hidden = name !== 'title';
  mapEl.hidden = name !== 'map';
  levelEl.hidden = name !== 'level';
  storyEl.hidden = name !== 'story';
  journalEl.hidden = name !== 'journal';
  workshopEl.hidden = name !== 'workshop';
  editorEl.hidden = name !== 'editor';
  if (name === 'editor') editorView.resize();
  if (name === 'level') {
    view.resize();
    startLoop();
  } else {
    stopLoop();
    if (spoken) hush();
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
  applyLantern();
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
  playFrom = null;
  showScreen('map');
  drawMap();
}

function drawMap() {
  applyLantern();
  renderMap(chaptersEl, {
    chapters: NIGHT.length ? [...CHAPTERS, GARDEN] : CHAPTERS,
    levels: [...LEVELS, ...NIGHT],
    label: levelTitle,
    why: (def) => lockedWhy(def, CHAPTERS),   // what opens a locked cavern (SPEC section 29)
    // what a closed section waits for: the garden before its first puzzle opens (SPEC section 20)
    note: (chapter) => (chapter === GARDEN && !forceUnlock && !puzzleOpen(NIGHT[0], save, NIGHT, LEVELS, save.settings.unlockAll)
      ? gardenNote(gardenState(save, LEVELS)) : ''),
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
    workshop: {
      open: workshopIsOpen(),
      count: save.workshop.length,
      onOpen: () => {
        play('ui');
        showWorkshop();
      },
      onLocked: (button) => {
        sfx('blocked');
        button.classList.remove('wiggle');
        void button.offsetWidth;   // restart the animation
        button.classList.add('wiggle');
      },
    },
  });
  for (const lock of chaptersEl.querySelectorAll('.lock')) setIcon(lock, 'lock');
  applyIcons($('workshop-card'));
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
  for (const tab of ['creatures', 'critters', 'story']) $('tab-' + tab).setAttribute('aria-selected', journalTab === tab ? 'true' : 'false');
  list.setAttribute('aria-labelledby', 'tab-' + journalTab);
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
  } else if (journalTab === 'critters') {
    // the hidden critters (SPEC section 23)
    const cj = critterJournal(save, [...CHAPTERS, GARDEN]);
    $('journal-count').textContent = `${cj.found} of ${cj.total} found`;
    for (const c of cj.entries) {
      const entry = el('article', 'entry paper critter-entry' + (c.found ? ' met' : ' unmet'));
      const art = el('span', 'entry-art');
      art.setAttribute('aria-hidden', 'true');
      if (c.found) {
        const chapter = [...CHAPTERS, GARDEN].find((ch) => ch.id === c.chapter.id);
        const url = portraitUrl(c.kind, chapter && chapter.accent);
        art.style.backgroundImage = url ? `url(${url})` : 'none';
      }
      entry.appendChild(art);
      const body = el('div', 'entry-body');
      if (c.found) {
        body.appendChild(el('span', 'kicker ink', `Found ${c.found} of ${c.total} in ${c.chapter.name}`));
        body.appendChild(el('h3', '', c.name));
        body.appendChild(el('p', 'note', c.note));
        if (c.lore) body.appendChild(el('p', 'note lore', c.lore));
      } else {
        body.appendChild(el('span', 'kicker ink', typeof c.chapter.id === 'number' ? `Chapter ${c.chapter.id}` : GARDEN.kicker));
        body.appendChild(el('h3', '', 'Not found yet'));
        body.appendChild(el('p', 'rule', `Hiding in the dark corners of ${c.chapter.name}.`));
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
// from: 'editor' | 'workshop' for a Workshop cavern or a shared code (SPEC section 26), where Back goes.
function openLevel(def, adhoc, day, from) {
  const loose = !!adhoc || !(LEVELS.includes(def) || NIGHT.includes(def));
  let fresh;
  try {
    // a chapter or Night Garden critter found on an earlier visit stays found (SPEC section 23)
    fresh = new Session(def, { found: !day && !loose && isFound(save, def) });
  } catch (e) {
    return false;
  }
  tutorial = null;
  closePanel();
  stopHintSearch();
  cancelWalk();
  queue.length = 0;
  session = fresh;
  playFrom = from || null;
  visitEnd();
  current = { def, chapter: day ? DAILY_CHAPTER : chapterOf(def), adhoc: loose, day: day || null, result: null };
  visitStart();
  current.critterKind = (day ? dailyCritterKind(def, CHAPTERS) : critterKind(current.chapter)) || CRITTERS[0];
  // Tutorials and the stuck nudge are for a level's first visits: never solved, and the setting on.
  const guided = save.settings.tutorials && (day ? !save.daily[day] : !current.adhoc && !save.levels[def.id]);
  tutorial = guided && Array.isArray(def.tutorial) && def.tutorial.length ? new Tutorial(def.tutorial) : null;
  stuck = guided && typeof def.par === 'number' ? 0 : -1;
  catches = 0;
  catchNudge = false;
  ladder = null;
  window.clearTimeout(rewindTimer);
  moved = false;
  message = '';
  critterNote = '';
  celebrating = false;
  lastBloom = -1;
  view.highContrast = save.settings.contrast;
  applyLantern();
  const critter = session.critter ? { ...session.critter, kind: current.critterKind.kind, found: session.found } : null;
  view.setBramble(brambleShown(save.levels, save.settings));   // Wren's moth, once 1-1 is lit (SPEC section 31)
  view.setLevel(session.state, { accent: current.chapter.accent, facing: session.facing, critter });
  $('level-id').textContent = day ? `Daily Glimmer, ${dateLabel(day)}` : levelTitle(def);
  $('level-name').textContent = def.name || 'Unnamed cavern';
  $('back').setAttribute('aria-label', backLabel());
  clearHint();
  showScreen('level');
  refreshHud();
  say(`${$('level-id').textContent}: ${$('level-name').textContent}. ${boardWords().join(' ')}`);
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
  labelBoard();

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
  const way = ladder && !session.solved ? ladder.following(session.state) : null;
  if (message) {
    text = message;
  } else if (way) {
    showWayStatus(way);
    return;
  } else if (stuck > 0) {
    text = stuckText();
  } else if (step && typeof step.say === 'string' && step.say) {
    text = step.say;
  } else if (critterNote) {
    text = critterNote;
  } else if (peeking()) {
    text = PEEK_TEXT;
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

// ---------------------------------------------------------------- hidden critters (SPEC section 23)

// The first time ever a critter shows, with tutorials on, the status row says how to sketch it.
function peeking() {
  return save.settings.tutorials && !(save.critters && save.critters.length) && !session.solved
    && !session.found && session.critterShows();
}

// A tap on the critter while it shows (or C). Not a move. -> true when it was sketched just now
function sketchCritter() {
  if (!session || session.solved || !session.sketch()) return false;
  if (!current.adhoc && !current.day) {
    markFound(save, current.def);
    writeSave(save);
  }
  if (view.critter) view.critter.found = true;
  view.addEffect({ type: 'sketch', x: session.critter.x, y: session.critter.y });
  critterNote = `Wren sketched a ${current.critterKind.name} for the Journal.`;
  sfx('spot');
  buzz('tap');
  refreshStatus();
  return true;
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
    say(describeRefusal(prev, action));
    return false;
  }
  clearHint();
  say(describeTurn(next));
  moved = true;
  critterNote = '';
  tutorialAfter(next);
  view.playTurn(prev, next, { facing: session.facing, speed: queue.length ? 1.5 : 1 });
  if (ladder && ladder.tier === 3) {
    if (ladder.following(next)) showWay();
    else if (!next.solved && ladder.at(prev) >= 0) message = OFF_WAY_TEXT;
  }
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
    showWay();
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
  note('undos');
  critterNote = '';
  stopHintSearch();
  dismissStuck();
  clearHint();
  showWay();
  if (panel === 'result' || panel === 'card') closePanel();
  celebrating = false;
  view.endCelebration();
  view.playTween(before, session.state, { facing: session.facing });
  // The bud scale in audio.js steps back once per 'budOff'; it stands in for the undo sound.
  const lost = bloomBefore - session.bloomCount();
  if (lost > 0) for (let i = 0; i < lost; i++) play('budOff');
  else play('undo');
  refreshHud();
  say(describeBack(session.state, 'undo'));
  return true;
}

function restart() {
  if (!session) return false;
  cancelWalk();
  queue.length = 0;
  const before = session.state;
  if (!session.restart()) return false;
  note('restarts');
  critterNote = '';
  stopHintSearch();
  dismissStuck();
  ladder = null;   // a restart is a fresh attempt with no hints used (SPEC section 18)
  if (tutorial) tutorial.restart();
  clearHint();
  if (panel === 'result' || panel === 'card') closePanel();
  celebrating = false;
  view.endCelebration();
  view.playTween(before, session.state, { facing: session.facing });
  play('restart');
  refreshHud();
  say(describeBack(session.state, 'restart'));
  return true;
}

// ---------------------------------------------------------------- tap to walk

function tapTile(tile) {
  if (!session || panel || celebrating || session.solved) return;
  // the hidden critter, while it shows, comes before walking there or tapping Wren (SPEC section 23)
  const c = session.critter;
  if (c && c.x === tile.x && c.y === tile.y && sketchCritter()) return;
  if (session.caught) return;
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
      say(CANT_REACH);
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
// While Wren is on the way of a hint already paid for, it says what that hint does next (SPEC section 18).
function refreshHintLabel() {
  const val = $('hint-val');
  const step = ladder && session ? ladder.label(session.state) : null;
  const cost = hintCost(save.shop, Date.now());
  const text = step || hintLabel(save.shop, Date.now());
  if (val.textContent !== text) val.textContent = text;
  const aria = step === 'more' ? 'Hint, next step free'
    : step === 'shown' ? 'Hint, the way is shown'
      : cost.kind === 'free' ? 'Hint, free'
        : cost.kind === 'glimmer' ? `Hint, ${cost.glimmer} Glimmer left`
          : `Hint, next free hint in ${minutesWord(cost.waitMs)}`;
  if (btn.hint.getAttribute('aria-label') !== aria) btn.hint.setAttribute('aria-label', aria);
}

function requestHint() {
  if (!session || session.solved || session.caught || celebrating || thinking || panel) return;
  // on the way of a hint already paid for, the next of its three steps is free (SPEC section 18)
  if (ladder && ladder.at(session.state) >= 0) {
    cancelWalk();
    queue.length = 0;
    dismissStuck();
    play('hint');
    note('hints');
    showStep(ladder.climb(session.state));
    refreshHintLabel();
    return;
  }
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
  note('hints');
  dismissStuck();
  btn.hint.classList.add('thinking');
  btn.hint.querySelector('.lbl').textContent = 'Thinking';
  play('hint');
  const token = ++hintToken;
  // Let the "thinking" state reach the screen before the search holds the thread.
  const run = () => {
    if (token !== hintToken) return;
    const asked = session ? session.state : null;
    let found = null;
    if (asked) {
      try {
        found = solve(asked, { maxStates: HINT_BUDGET });
      } catch (e) {
        found = null;
      }
    }
    stopHintSearch();
    if (!session || session.state !== asked) return;
    if (found && found.solved && found.moves.length) {
      ladder = new HintLadder(asked, found.moves, current.def.feature);
      showStep(ladder.climb(asked));
    } else {
      showHint(null);
    }
    refreshHintLabel();
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

// One step of a hint (SPEC section 18): 1 the key piece, 2 the first move, 3 the whole way.
function showStep(shown) {
  if (!shown) return;
  if (shown.tier === 1) {
    clearHint();
    view.hint = { at: { x: shown.piece.x, y: shown.piece.y } };
    message = pieceText(shown.piece);
    refreshStatus();
  } else if (shown.tier === 2) {
    showHint(shown.move);
  } else {
    showWay();
  }
}

// The whole way, while Wren is on it: the board points at the next move as step 2 does, and the status row
// shows the moves still to make.
function showWay() {
  const way = ladder && session && !session.solved ? ladder.following(session.state) : null;
  if (!way) return;
  showHint(way.move);
  message = '';
  refreshStatus();
}

function showWayStatus(way) {
  const shown = way.rest.slice(0, WAY_SHOWN);
  const sig = `way|${way.index}|${way.total}|${way.rest.join('')}`;
  if (statusEl.dataset.sig === sig) return;
  statusEl.dataset.sig = sig;
  statusEl.textContent = '';
  const count = document.createElement('span');
  count.className = 'way-count';
  count.textContent = `Move ${way.index + 1} of ${way.total}`;
  statusEl.appendChild(count);
  const row = document.createElement('span');
  row.className = 'way';
  row.setAttribute('aria-hidden', 'true');
  row.innerHTML = shown.map((m, i) => wayMoveSvg(m, i === 0)).join('') + (way.rest.length > WAY_SHOWN ? '<span class="way-more">…</span>' : '');
  statusEl.appendChild(row);
  const words = document.createElement('span');
  words.className = 'sr-only';
  words.textContent = `: ${shown.map((m) => MOVE_WORD[m]).join(', ')}${way.rest.length > WAY_SHOWN ? ', and more' : ''}.`;
  statusEl.appendChild(words);
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
  note('solves');
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
  if (current.day || !current.adhoc) notesDirty = false;   // that write carried the notes
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
    : def.id !== undefined ? `${levelTitle(def)} lit` : 'Cavern lit';
  $('result-name').textContent = def.name || 'Unnamed cavern';
  const hasPar = typeof def.par === 'number';
  $('result-moves').textContent = `${r.moves} move${r.moves === 1 ? '' : 's'}` + (hasPar ? `  ·  par ${def.par}` : '');
  const critterText = !session.critter ? 'No critter in this cavern'
    : r.marks.critter ? `Found the ${current.critterKind.name}` : 'A critter hides in the dark';
  const marks = [
    [r.marks.solved, 'Solved'],
    [r.marks.par, hasPar ? 'At or under par' : 'Par'],
    [r.marks.critter, critterText],
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
  $('result-map').textContent = playFrom ? 'Back' : 'Map';
  $('result-map').setAttribute('aria-label', backLabel());
  openPanel('result');
}

// ---------------------------------------------------------------- panels

// ---------------------------------------------------------------- lantern styles (SPEC section 24)

// The style in use goes to the art: the chosen one while it is unlocked, else Tallow.
function applyLantern() {
  setLanternStyle(lanternInUse(save));
}

function renderLanterns() {
  const moss = starMoss(save);
  const inUse = lanternInUse(save);
  $('lanterns-moss').textContent = `You have ${moss} star moss.`;
  const list = $('lantern-list');
  list.textContent = '';
  for (const style of LANTERNS) {
    const open = styleUnlocked(style, save);
    const using = style === inUse;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'style' + (using ? ' using' : '') + (open ? '' : ' locked');
    b.dataset.style = style.id;
    b.setAttribute('aria-pressed', using ? 'true' : 'false');
    if (!open) b.setAttribute('aria-disabled', 'true');
    const state = using ? 'In use' : open ? 'Use it' : `Needs ${style.moss} star moss`;
    b.setAttribute('aria-label', `${style.name}. ${state}.`);
    const art = document.createElement('span');
    art.className = 'style-art';
    art.setAttribute('aria-hidden', 'true');
    const url = lanternSwatchUrl(style);
    if (url) art.style.backgroundImage = `url(${url})`;
    b.appendChild(art);
    const body = document.createElement('span');
    body.className = 'style-body';
    const name = document.createElement('span');
    name.className = 'style-name';
    name.textContent = style.name;
    const note = document.createElement('span');
    note.className = 'style-note';
    note.textContent = style.note;
    const tag = document.createElement('span');
    tag.className = 'style-state';
    if (!open) {
      const lock = document.createElement('span');
      lock.className = 'ico';
      lock.setAttribute('aria-hidden', 'true');
      setIcon(lock, 'lock', '#24162E');
      tag.appendChild(lock);
    }
    tag.appendChild(document.createTextNode(state));
    body.append(name, note, tag);
    b.appendChild(body);
    onClick(b, () => chooseLantern(style));
    list.appendChild(b);
  }
}

function chooseLantern(style) {
  if (!styleUnlocked(style, save)) {
    sfx('blocked');
    return;
  }
  save.settings.lantern = style.id;
  writeSave(save);
  applyLantern();
  sfx('plant');
  renderLanterns();
  const pressed = $('lantern-list').querySelector('.style.using');
  if (pressed) pressed.focus({ preventScroll: true });
}

// the Workshop's sheets go by short names
const PANEL_EL = { cavern: 'cavern-sheet', share: 'share-sheet', code: 'code-sheet', talk: 'talk-sheet', news: 'news-sheet', about: 'about-sheet' };
const SHEETS = ['shop', 'comfort', 'lanterns', 'cavern', 'share', 'code', 'talk', 'news', 'about'];   // sheets over a screen, on the store's scrim
const panelEl = (name) => $(PANEL_EL[name] || name);

function openPanel(name) {
  panel = name;
  if (SHEETS.includes(name)) {
    shopScrim.hidden = false;
  } else if (name !== 'confirm') {
    scrim.hidden = false;
    scrim.className = name === 'result' ? 'scrim soft' : 'scrim';
  }
  panelEl(name).hidden = false;
  const focus = name === 'result'
    ? ($('result-next').hidden ? $('result-replay') : $('result-next'))
    : name === 'card' ? $('card-close') : name === 'shop' ? $('shop-close') : name === 'comfort' ? $('comfort-close')
      : name === 'lanterns' ? $('lanterns-close') : name === 'cavern' ? $('cavern-close') : name === 'share' ? $('share-copy')
        : name === 'code' ? $('code-input') : name === 'talk' ? $('talk-close') : name === 'news' ? $('news-close')
          : name === 'about' ? $('about-close') : $('confirm-no');
  try {
    focus.focus({ preventScroll: true });
  } catch (e) {
    // focus is a courtesy
  }
}

function closePanel() {
  if (!panel) return false;
  const was = panel;
  panelEl(panel).hidden = true;
  scrim.hidden = true;
  shopScrim.hidden = true;
  panel = null;
  if (was === 'card') view.preview = null;
  if (was === 'talk') hush();
  if (was === 'news') newsSeen();
  // closing a tutorial's meet card finishes that step
  const step = was === 'card' ? coachStep() : null;
  if (step && step.card) {
    tutorial.cardClosed();
    refreshHud();
  }
  return true;
}

// preview: a held creature's next step (src/ui/preview.js), or none
function openCard(kind, preview) {
  const card = RULE_CARDS[kind];
  if (!card) return;
  cancelWalk();
  queue.length = 0;
  $('card-title').textContent = card.title;
  $('card-text').textContent = card.text;
  const line = $('card-preview');
  line.textContent = preview ? preview.text : '';
  line.hidden = !preview;
  view.preview = preview ? { x: preview.x, y: preview.y, to: preview.to } : null;
  const url = portraitUrl(kind, current ? current.chapter.accent : undefined);
  $('card-art').style.backgroundImage = url ? `url(${url})` : 'none';
  armedAt = performance.now() + 400;
  openPanel('card');
  play('ui');
}

// ---------------------------------------------------------------- store (SPEC section 14)

const NEXT_PAID = LEVELS.filter((def) => chapterOf(def).id !== FREE_CHAPTER).length + NIGHT.length;

// reason: 'chapter' (a locked chapter, or Next after chapter 1), 'hint' (nothing left to pay with), 'archive' (a
// locked Daily Glimmer day), or none
function openShop(reason, chapter) {
  if (panel) closePanel();
  cancelWalk();
  queue.length = 0;
  shopNote = '';
  if (reason === 'chapter' && chapter === GARDEN) shopWhy = 'The Night Garden is part of the Full Expedition.';
  else if (reason === 'chapter' && chapter) shopWhy = `Chapter ${chapter.id}, ${chapter.name}, is part of the Full Expedition.`;
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
  const span = (later.length ? `Chapters ${later[0].id} to ${later[later.length - 1].id}` : 'Every chapter')
    + (NIGHT.length ? ' and the Night Garden' : '');
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
  if (!adoptInto(save, other)) return;
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

// ---------------------------------------------------------------- Board talk (SPEC section 28)

const CANT_REACH = "Wren can't get there.";
const TALK_ON = 'Board talk is on.';

// A line for TalkBack (the hidden live region), and for the voice when Board talk is on.
function say(line) {
  if (!line) return;
  const el = $('board-talk');
  // the same words twice in a row would not be read again: a trailing no-break space makes them new
  el.textContent = el.textContent === line ? `${line}\u00A0` : line;
  if (save.settings.talk) talk(line);
}

function talk(words) {
  spoken = words;
  speak(words);
}

function hush() {
  spoken = '';
  speak('');
}

function boardWords() {
  return session ? describeBoard(session.state, { par: current.def.par }) : [];
}

// The board's label is the whole board in words, kept up to date.
function labelBoard() {
  const label = `The cave board. ${boardWords().join(' ')}`;
  if (canvas.getAttribute('aria-label') !== label) canvas.setAttribute('aria-label', label);
}

// Describe: the whole board in a sheet, one sentence a line, and spoken.
function openDescribe() {
  if (!session || celebrating) return;
  cancelWalk();
  queue.length = 0;
  if (panel) closePanel();
  const words = boardWords();
  const list = $('talk-lines');
  list.textContent = '';
  for (const w of words) {
    const li = document.createElement('li');
    li.textContent = w;
    list.appendChild(li);
  }
  openPanel('talk');
  $('talk-sheet').querySelector('.sheet-scroll').scrollTop = 0;
  talk(words.join(' '));
}

function setTalk(on) {
  setComfort({ talk: on });
  if (on) talk(TALK_ON);
  else hush();
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
  // Comfort (SPEC section 22)
  const controlled = s.arrows || s.hand !== 'right' || s.swipe !== 'normal' || s.talk || !s.bramble;   // SPEC sections 27, 28, 31
  set('set-comfort', s.textSize !== 1 || s.readable || s.motion !== 'system' || controlled, `${Math.round(s.textSize * 100)}%`);
  app.style.setProperty('--ts', String(s.textSize));
  app.classList.toggle('readable', s.readable);
  app.classList.toggle('motion-reduced', s.motion === 'reduced');
  app.classList.toggle('motion-full', s.motion === 'full');
  app.classList.toggle('left-hand', s.hand === 'left');
  $('arrows').hidden = !s.arrows;
  $('btn-describe').hidden = !s.talk;
  for (const b of $('comfort').querySelectorAll('.choice')) {
    const d = b.dataset;
    const on = d.size !== undefined ? Number(d.size) === s.textSize
      : d.readable !== undefined ? (d.readable === 'true') === s.readable
        : d.motion !== undefined ? d.motion === s.motion
          : d.arrows !== undefined ? (d.arrows === 'true') === s.arrows
            : d.hand !== undefined ? d.hand === s.hand
              : d.talk !== undefined ? (d.talk === 'true') === s.talk
                : d.bramble !== undefined ? (d.bramble === 'true') === s.bramble
                  : d.swipe === s.swipe;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  syncMotion();
}

// A choice on the Comfort sheet: { textSize } | { readable } | { motion }
function setComfort(change) {
  Object.assign(save.settings, change);
  writeSave(save);
  syncSettings();
  play('ui');
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
        // holding a creature also shows what it does next turn (SPEC section 21)
        const creature = session.state.creatures.find((c) => c.x === tile.x && c.y === tile.y);
        openCard(kind, creature ? previewOf(session.state, creature.id) : null);
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
  const need = g.swipes === 0 ? swipeNeed(save.settings.swipe) : Math.max(44, view.layout ? view.layout.size * 0.9 : 44);   // SPEC section 27
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
  backFromLevel();
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
  if (current) openLevel(current.def, current.adhoc, current.day, playFrom);
});
onClick($('result-map'), () => {
  play('ui');
  leaveResult(backFromLevel);
});

function startPlaying() {
  play('ui');
  openBook(storyDue(save, CHAPTERS, { at: 'play' }), {
    then: () => {
      showMap();
      openNews(newsDue(save.news));   // what changed since the last visit (SPEC section 30)
    },
  });
}
onClick($('btn-play'), startPlaying);

// ---------------------------------------------------------------- What's new (SPEC section 30)

// ---------------------------------------------------------------- tester notes and About (SPEC section 33)

const VISIT_MAX_S = 30 * 60;
let noted = null;          // the visit being counted: { id, since (ms, 0 while paused), counted (s) }
let notesDirty = false;    // counts not yet written
let versionInfo = null;    // { version, build } from the app shell, or null in a browser
appVersion().then((v) => {
  versionInfo = v;
  if (panel === 'about') renderAbout();
}, () => {});

// The id the notes count a cavern under: chapter, Night Garden and Daily Glimmer caverns, not the Workshop's.
function notedId() {
  if (!current) return null;
  return current.day || !current.adhoc ? String(current.def.id) : null;
}

function note(kind) {
  const id = notedId();
  if (!id) return;
  noteAdd(save.notes, id, kind);
  notesDirty = true;
}

function clockStop() {
  if (!noted || !noted.since) return;
  const s = Math.min((Date.now() - noted.since) / 1000, VISIT_MAX_S - noted.counted);
  noted.since = 0;
  if (s >= 1) {
    noteAdd(save.notes, noted.id, 'seconds', s);
    noted.counted += Math.floor(s);
    notesDirty = true;
  }
}

function clockStart() {
  if (noted && !noted.since && screen === 'level') noted.since = Date.now();
}

function visitStart() {
  const id = notedId();
  noted = null;
  if (!id) return;
  noteAdd(save.notes, id, 'visits');
  notesDirty = true;
  noted = { id, since: Date.now(), counted: 0 };
}

// Ends the visit (leaving the cavern) and writes any new counts.
function visitEnd() {
  clockStop();
  noted = null;
  notesSave();
}

function notesSave() {
  if (!notesDirty) return;
  notesDirty = false;
  writeSave(save);
}

const NOTED_LEVELS = () => [...LEVELS, ...NIGHT, ...DAILY];

function aboutReport() {
  return notesReport(save.notes, save.levels, NOTED_LEVELS(), { version: versionInfo, date: today() });
}

function renderAbout() {
  $('about-version').textContent = versionLabel(versionInfo);
  const known = new Set(NOTED_LEVELS().map((d) => String(d.id)));
  const played = Object.keys(save.notes).filter((id) => known.has(id)).length;
  $('about-notes').textContent = played
    ? `${played} ${played === 1 ? 'cavern' : 'caverns'} played.`
    : 'None yet. Play a cavern first.';
  $('about-copy').disabled = !played;
}

function openAbout() {
  if (panel) closePanel();
  renderAbout();
  $('about-status').textContent = '';
  $('about-report').hidden = true;
  $('about-report').textContent = '';
  openPanel('about');
  $('about-sheet').querySelector('.sheet-scroll').scrollTop = 0;
}

onClick($('btn-about'), () => {
  play('ui');
  openAbout();
});
onClick($('about-copy'), () => {
  const text = aboutReport();
  const done = (copied) => {
    $('about-status').textContent = copied ? 'Copied.' : 'Press and hold the notes to copy them.';
    if (!copied) {
      $('about-report').textContent = text;
      $('about-report').hidden = false;
    }
    sfx(copied ? 'ui' : 'blocked');
  };
  try {
    navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
  } catch (e) {
    done(false);
  }
});
onClick($('about-close'), () => {
  play('ui');
  closePanel();
});

const NEWS_SHOWN = 6;   // the title button's sheet: the newest six, seen or not

function openNews(notes) {
  if (!notes.length) return;
  if (panel) closePanel();
  const list = $('news-list');
  list.textContent = '';
  for (const n of notes) {
    const li = document.createElement('li');
    const title = document.createElement('h4');
    title.textContent = n.title;
    const text = document.createElement('p');
    text.textContent = n.text;
    li.append(title, text);
    list.appendChild(li);
  }
  openPanel('news');
  $('news-sheet').querySelector('.sheet-scroll').scrollTop = 0;
}

// Closing the sheet marks every note seen, whichever were shown.
function newsSeen() {
  const unseen = NEWS.filter((n) => !save.news.includes(n.id));
  if (!unseen.length) return;
  for (const n of unseen) save.news.push(n.id);
  writeSave(save);
}

onClick($('btn-news'), () => {
  play('ui');
  openNews(NEWS.slice(0, NEWS_SHOWN));
});
onClick($('news-close'), () => {
  play('ui');
  closePanel();
});

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
  if (SHEETS.includes(panel)) closePanel();
});
onClick($('btn-lanterns'), () => {
  play('ui');
  if (panel) closePanel();
  renderLanterns();
  openPanel('lanterns');
});
onClick($('lanterns-close'), () => {
  play('ui');
  closePanel();
});
onClick($('set-comfort'), () => {
  play('ui');
  if (panel) closePanel();
  openPanel('comfort');
});
onClick($('comfort-close'), () => {
  play('ui');
  closePanel();
});
for (const b of $('comfort').querySelectorAll('.choice')) {
  onClick(b, () => {
    const d = b.dataset;
    if (d.size !== undefined) setComfort({ textSize: Number(d.size) });
    else if (d.readable !== undefined) setComfort({ readable: d.readable === 'true' });
    else if (d.motion !== undefined) setComfort({ motion: d.motion });
    else if (d.arrows !== undefined) setComfort({ arrows: d.arrows === 'true' });   // the controls (SPEC section 27)
    else if (d.hand !== undefined) setComfort({ hand: d.hand });
    else if (d.talk !== undefined) setTalk(d.talk === 'true');   // Board talk (SPEC section 28)
    else if (d.bramble !== undefined) setComfort({ bramble: d.bramble === 'true' });   // Bramble (SPEC section 31)
    else setComfort({ swipe: d.swipe });
  });
}
onClick($('btn-describe'), () => {
  play('ui');
  openDescribe();
});
onClick($('talk-close'), () => {
  play('ui');
  closePanel();
});
// the arrows step Wren exactly as a swipe that way (SPEC section 27)
for (const b of $('arrows').querySelectorAll('.arrow')) onClick(b, () => userAction(b.dataset.dir));
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
onClick($('tab-critters'), () => {
  play('ui');
  journalTab = 'critters';
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

// ---------------------------------------------------------------- the Workshop (SPEC section 26)

const TURNS = ['stumpcap', 'newt', 'beetle'];

function workshopIsOpen() {
  return forceUnlock || workshopOpen(save, save.settings.unlockAll);
}

// The tools and options met so far: in a lit chapter, Night Garden or daily level.
function metTools() {
  const lit = { ...save.levels };
  for (const day of Object.keys(save.daily || {})) {
    const def = dailyLevel(DAILY, day);
    if (def) lit[def.id] = save.daily[day];
  }
  return metInWorkshop({ levels: lit }, [...LEVELS, ...NIGHT, ...DAILY], forceUnlock || save.settings.unlockAll);
}

function cavernNow() {
  return editing ? save.workshop[editing.index] : null;
}

// Where Back goes from a level, and what it is called.
function backLabel() {
  return playFrom === 'editor' ? 'Back to the editor' : playFrom === 'workshop' ? 'Back to the Workshop' : 'Back to map';
}

function backFromLevel() {
  if (playFrom === 'editor' && editing && cavernNow()) openEditor(editing.index);
  else if (playFrom) showWorkshop();
  else showMap();
}

function showWorkshop() {
  leaveLevel();
  playFrom = null;
  editing = null;
  showScreen('workshop');
  renderWorkshop();
}

function renderWorkshop() {
  const list = $('caverns');
  list.textContent = '';
  save.workshop.forEach((cavern, i) => {
    const s = cavernSummary(cavern);
    const item = document.createElement('div');
    item.setAttribute('role', 'listitem');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'cavern' + (cavern.check === 'lit' ? ' lit' : '');
    row.setAttribute('aria-label', `${s.name}, ${s.size}, ${s.check}`);
    const pic = document.createElement('span');
    pic.className = 'cavern-pic';
    pic.innerHTML = cavernThumb(cavern.map);   // built from the map's own symbols only
    const body = document.createElement('span');
    body.className = 'cavern-body';
    const name = document.createElement('span');
    name.className = 'cavern-name';
    name.textContent = s.name;
    const meta = document.createElement('span');
    meta.className = 'cavern-meta';
    meta.textContent = `${s.size}  ·  ${s.check}`;
    body.append(name, meta);
    row.append(pic, body);
    onClick(row, () => {
      play('ui');
      openEditor(i);
    });
    item.appendChild(row);
    list.appendChild(item);
  });
  const n = save.workshop.length;
  $('workshop-count').textContent = `${n} of ${MAX_CAVERNS}`;
  $('workshop-full').hidden = n < MAX_CAVERNS;
  setDisabled($('workshop-new'), n >= MAX_CAVERNS);
}

function openEditor(index) {
  leaveLevel();
  playFrom = null;
  if (!editing || editing.index !== index) editing = { index, tool: 'wall', undo: [], note: '' };
  renderTools();
  showScreen('editor');
  refreshEditor();
}

function renderTools() {
  const met = metTools().tools;
  if (!met.includes(editing.tool)) editing.tool = 'wall';
  const bar = $('editor-tools');
  bar.textContent = '';
  for (const tool of TOOLS) {
    if (!met.includes(tool.id)) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'paint-tool';
    b.dataset.tool = tool.id;
    b.setAttribute('aria-label', tool.name);
    b.setAttribute('aria-pressed', tool.id === editing.tool ? 'true' : 'false');
    const art = document.createElement('span');
    art.className = 'tool-art';
    const url = toolIconUrl(tool.id);
    if (url) art.style.backgroundImage = `url(${url})`;
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = tool.short || tool.name;
    b.append(art, lbl);
    onClick(b, () => {
      play('ui');
      editing.tool = tool.id;
      editing.note = '';
      for (const other of bar.querySelectorAll('.paint-tool')) other.setAttribute('aria-pressed', other === b ? 'true' : 'false');
      refreshEditor();
    });
    bar.appendChild(b);
  }
}

function toolHint(id) {
  const tool = TOOLS.find((t) => t.id === id);
  if (id === 'wren') return 'Wren: tap where Wren starts.';
  if (id === 'lantern') return 'Lantern: tap where it starts, planted.';
  if (id === 'root' || id === 'gate') return `${tool.name}: tap one again for the next colour.`;
  if (TURNS.includes(id)) return `${tool.name}: tap one again to turn it.`;
  return `${tool.name}: tap or drag to paint.`;
}

function refreshEditor() {
  const c = cavernNow();
  if (!c) return;
  editorView.setMap(c.map);
  $('editor-name').textContent = cavernName(c.seed);
  $('editor-size').textContent = `${c.map[0].length} by ${c.map.length}`;
  $('editor-status').textContent = checking ? 'Checking every way…' : editing.note || toolHint(editing.tool);
  setDisabled($('editor-share'), !canShare(c));
  setDisabled($('editor-undo'), false);
}

// A new version of the cavern in the editor (not yet saved: a stroke saves once, at its end).
function setCavern(next) {
  save.workshop[editing.index] = next;
  editing.note = '';
  refreshEditor();
}

// One change that Undo takes back as a whole, saved now.
function commitCavern(before, next) {
  editing.undo.push(before);
  if (editing.undo.length > 200) editing.undo.shift();
  setCavern(next);
  writeSave(save);
}

function paintAt(tile, turn) {
  const next = paint(cavernNow(), editing.tool, tile.x, tile.y, { turn });
  if (!next) return false;
  setCavern(next);
  stroke.changed = true;
  play('step');
  return true;
}

const editorCanvas = $('editor-canvas');
editorCanvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (stroke) return;   // a second finger changes nothing
  e.preventDefault();
  if (!editing || panel || checking) return;
  const tile = editorView.tileAt(e.clientX, e.clientY);
  stroke = { id: e.pointerId, before: cavernNow(), first: tile, last: tile, left: false, changed: false };
  try {
    editorCanvas.setPointerCapture(e.pointerId);
  } catch (err) {
    // capture is a nicety
  }
  if (tile) paintAt(tile, false);   // a thing of the tool's own kind turns on a tap, at the lift
});
editorCanvas.addEventListener('pointermove', (e) => {
  if (!stroke || e.pointerId !== stroke.id) return;
  const tile = editorView.tileAt(e.clientX, e.clientY);
  if (!tile || (stroke.last && tile.x === stroke.last.x && tile.y === stroke.last.y)) return;
  stroke.last = tile;
  stroke.left = true;
  paintAt(tile, false);
});
function endStroke(e, lifted) {
  if (!stroke || e.pointerId !== stroke.id) return;
  const s = stroke;
  if (lifted && !s.left && !s.changed && s.first) paintAt(s.first, true);
  stroke = null;
  if (s.changed) {
    editing.undo.push(s.before);
    if (editing.undo.length > 200) editing.undo.shift();
    writeSave(save);
  } else if (lifted && s.first) {
    sfx('blocked');
  }
}
editorCanvas.addEventListener('pointerup', (e) => endStroke(e, true));
editorCanvas.addEventListener('pointercancel', (e) => endStroke(e, false));

onClick($('editor-undo'), () => {
  if (!editing || checking) return;
  if (!editing.undo.length) {
    sfx('blocked');
    return;
  }
  save.workshop[editing.index] = editing.undo.pop();
  writeSave(save);
  editing.note = '';
  sfx('undo');
  refreshEditor();
});

onClick($('editor-check'), () => {
  const c = cavernNow();
  if (!c || checking) return;
  const problems = cavernProblems(c);
  if (problems.length) {
    editing.note = problems[0];
    sfx('blocked');
    refreshEditor();
    return;
  }
  checking++;
  play('hint');
  refreshEditor();
  const run = () => {
    const r = checkCavern(c);
    checking--;
    if (!editing || cavernNow() !== c) return;   // changed meanwhile: the answer is for another cavern
    save.workshop[editing.index] = { ...c, check: r.check === 'problem' ? null : r.check, par: r.par };
    writeSave(save);
    editing.note = r.text;
    sfx(r.check === 'lit' ? 'budOn' : 'blocked');
    refreshEditor();
  };
  window.setTimeout(run, 30);   // let "Checking" reach the screen before the search holds the thread
});

onClick($('editor-play'), () => {
  const c = cavernNow();
  if (!c || checking) return;
  const problems = cavernProblems(c);
  if (problems.length) {
    editing.note = problems[0];
    sfx('blocked');
    refreshEditor();
    return;
  }
  play('ui');
  openLevel(levelDef(c), true, undefined, 'editor');
});

onClick($('editor-share'), () => {
  const c = cavernNow();
  if (!c || checking) return;
  if (!canShare(c)) {
    editing.note = 'Check it first: a code carries its par.';
    sfx('blocked');
    refreshEditor();
    return;
  }
  play('ui');
  $('share-name').textContent = cavernName(c.seed);
  $('share-code').textContent = encodeCavern(c);
  $('share-note').textContent = 'Anyone with Glimmerdeep can play it from their Workshop.';
  openPanel('share');
});

onClick($('share-copy'), () => {
  const code = $('share-code').textContent;
  const done = (copied) => {
    $('share-note').textContent = copied ? 'Copied.' : 'Press and hold the code to copy it.';
    sfx(copied ? 'ui' : 'blocked');
  };
  try {
    navigator.clipboard.writeText(code).then(() => done(true), () => done(false));
  } catch (e) {
    done(false);
  }
});
onClick($('share-close'), () => {
  play('ui');
  closePanel();
});

// ---- the size and options sheet

function renderCavernSheet() {
  const c = cavernNow();
  const met = metTools();
  const w = c.map[0].length;
  const h = c.map.length;
  $('cavern-kicker').textContent = cavernName(c.seed);
  $('width-val').textContent = String(w);
  $('height-val').textContent = String(h);
  setDisabled($('width-less'), w <= 3);
  setDisabled($('width-more'), w >= 9);
  setDisabled($('height-less'), h <= 3);
  setDisabled($('height-more'), h >= 11);
  $('opt-gloam-box').hidden = !met.gloam && !c.gloam;
  $('opt-shutter-box').hidden = !met.shutter && !c.shutter;
  for (const b of $('cavern-sheet').querySelectorAll('.choice[data-gloam]')) b.setAttribute('aria-pressed', String((b.dataset.gloam === 'true') === !!c.gloam));
  for (const b of $('cavern-sheet').querySelectorAll('.choice[data-shutter]')) b.setAttribute('aria-pressed', String((b.dataset.shutter === 'true') === !!c.shutter));
  const del = $('cavern-delete');
  del.textContent = deleteArmed ? 'Delete for good?' : 'Delete';
  del.classList.toggle('warn', deleteArmed);
  del.setAttribute('aria-label', deleteArmed ? 'Delete this cavern for good' : 'Delete this cavern');
  $('cavern-why').textContent = cavernWhy;
  $('cavern-why').hidden = !cavernWhy;
}

onClick($('editor-options'), () => {
  if (!cavernNow() || checking) return;
  play('ui');
  deleteArmed = false;
  cavernWhy = '';
  renderCavernSheet();
  openPanel('cavern');
});

function resizeBy(dw, dh) {
  const c = cavernNow();
  const next = resize(c, dw, dh);
  deleteArmed = false;
  if (!next) {
    const w = c.map[0].length + dw;
    const h = c.map.length + dh;
    cavernWhy = w < 3 || w > 9 || h < 3 || h > 11 ? 'Caverns are 3 to 9 tiles wide and 3 to 11 tall.'
      : `Wren, a Glowbud or the lantern is in the last ${dw ? 'column' : 'row'}. Move it first.`;
    sfx('blocked');
  } else {
    cavernWhy = '';
    play('ui');
    commitCavern(c, next);
  }
  renderCavernSheet();
}
onClick($('width-less'), () => resizeBy(-1, 0));
onClick($('width-more'), () => resizeBy(1, 0));
onClick($('height-less'), () => resizeBy(0, -1));
onClick($('height-more'), () => resizeBy(0, 1));

for (const b of $('cavern-sheet').querySelectorAll('.choice[data-gloam], .choice[data-shutter]')) {
  onClick(b, () => {
    const c = cavernNow();
    const change = b.dataset.gloam !== undefined ? { gloam: b.dataset.gloam === 'true' } : { shutter: b.dataset.shutter === 'true' };
    deleteArmed = false;
    cavernWhy = '';
    play('ui');
    if (Object.keys(change).some((k) => !!c[k] !== change[k])) commitCavern(c, { ...c, ...change, par: null, check: null });
    renderCavernSheet();
  });
}

onClick($('cavern-delete'), () => {
  if (!deleteArmed) {
    deleteArmed = true;
    cavernWhy = '';
    sfx('ui');
    renderCavernSheet();
    return;
  }
  deleteArmed = false;
  save.workshop.splice(editing.index, 1);
  writeSave(save);
  closePanel();
  play('restart');
  showWorkshop();
});
onClick($('cavern-close'), () => {
  play('ui');
  closePanel();
});

// ---- the list: a new cavern, play a code

onClick($('workshop-back'), () => {
  play('ui');
  showMap();
});
onClick($('editor-back'), () => {
  play('ui');
  showWorkshop();
});

onClick($('workshop-new'), () => {
  if (save.workshop.length >= MAX_CAVERNS) {
    sfx('blocked');
    return;
  }
  save.workshop.push(newCavern(nextSeed(save.workshop, Math.random())));
  writeSave(save);
  play('ui');
  editing = null;
  openEditor(save.workshop.length - 1);
});

onClick($('workshop-code'), () => {
  play('ui');
  $('code-input').value = '';
  $('code-why').hidden = true;
  openPanel('code');
});

function playTypedCode() {
  if (checking) return;
  const why = (text) => {
    $('code-why').textContent = text;
    $('code-why').hidden = false;
    sfx('blocked');
  };
  const typed = $('code-input').value;
  const read = decodeCavern(typed);
  if (!read.ok) {
    why(read.why);
    return;
  }
  checking++;
  const button = $('code-play');
  button.textContent = 'Checking…';
  $('code-why').hidden = true;
  window.setTimeout(() => {
    const r = playCode(typed);
    checking--;
    button.textContent = 'Play';
    if (panel !== 'code') return;
    if (!r.ok) {
      why(r.why);
      return;
    }
    closePanel();
    play('ui');
    openLevel(r.def, true, undefined, 'workshop');
  }, 30);
}
onClick($('code-play'), playTypedCode);
$('code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    playTypedCode();
  }
});
onClick($('code-close'), () => {
  play('ui');
  closePanel();
});


// ---------------------------------------------------------------- input: Android back button

onBackButton(() => {
  if (screen === 'story') closeBook();
  else if (screen === 'journal') {
    play('ui');
    showMap();
  } else if (panel === 'result') leaveResult(backFromLevel);
  else if (panel) closePanel();
  else if (screen === 'level') {
    play('ui');
    backFromLevel();
  } else if (screen === 'editor') {
    play('ui');
    showWorkshop();
  } else if (screen === 'workshop') {
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
    else if (panel === 'result') leaveResult(backFromLevel);
    else if (panel) closePanel();
    else if (screen === 'editor') showWorkshop();
    else if (screen === 'workshop') showMap();
    else if (screen === 'map') showTitle();
    return;
  }
  if (screen === 'title') {
    const onButton = e.target && e.target.closest && e.target.closest('button');
    if (!panel && !onButton && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) {   // not under a sheet
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
    if (panel === 'result') openLevel(current.def, current.adhoc, current.day, playFrom);
    else restart();
  } else if (panel) return;
  else if (what === 'hint') requestHint();
  else if (what === 'sketch') sketchCritter();
  else userAction(what);
});

// ---------------------------------------------------------------- page behaviour

window.addEventListener('pointerdown', wake, true);
window.addEventListener('keydown', wake, true);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopLoop();
    titleArt.stop();
    clockStop();   // tester notes: the clock stops while the app is away, and the counts are written
    notesSave();
  } else {
    clockStart();
    startLoop();
    if (screen === 'title') titleArt.start();
  }
});
// In the app, going to the background also pauses drawing and puts sound to sleep.
onAppState((active) => {
  setAppHidden(!active);
  if (active) {
    clockStart();
    startLoop();
    if (screen === 'title') titleArt.start();
    if (screen === 'map') drawMap();   // the Daily Glimmer may be a new day
  } else {
    stopLoop();
    titleArt.stop();
    clockStop();
    notesSave();
  }
});

function onResize() {
  if (screen === 'level') view.resize();
  else if (screen === 'title') titleArt.start();
  else if (screen === 'editor') editorView.resize();
  else layoutMap(chaptersEl);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => window.setTimeout(onResize, 80));
if (typeof ResizeObserver === 'function') {
  new ResizeObserver(onResize).observe($('stage'));
  new ResizeObserver(onResize).observe(chaptersEl);
  new ResizeObserver(onResize).observe($('title-stage'));
  new ResizeObserver(onResize).observe($('editor-stage'));
}

// No callouts, no selection, no pinch or double-tap zoom, no rubber-band scroll during play.
// A share code and the code field are the exception: their text can be selected and copied.
const selectable = (e) => {
  const el = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);
  return !!(el && el.closest && el.closest('input, .share-code'));
};
document.addEventListener('contextmenu', (e) => {
  if (!selectable(e)) e.preventDefault();
});
document.addEventListener('selectstart', (e) => {
  if (!selectable(e)) e.preventDefault();
});
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => {
  if (!e.cancelable) return;
  const scroller = e.target && e.target.closest
    && (screen === 'map' && e.target.closest('.chapters')
      || screen === 'journal' && e.target.closest('.journal-list')
      || screen === 'story' && e.target.closest('.story-scroll')
      || screen === 'workshop' && e.target.closest('.cavern-list')
      || screen === 'editor' && e.target.closest('.editor-tools')
      || panel && e.target.closest('.sheet'));
  if (!scroller || e.touches.length > 1) e.preventDefault();
}, { passive: false });

function syncMotion() {
  view.reduced = reducedMotion(save.settings.motion, !!(motion && motion.matches));
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
  spoken: () => spoken,                         // Board talk (SPEC section 28)
  boardTalk: () => $('board-talk').textContent,
  boardLabel: () => canvas.getAttribute('aria-label'),
  // Bramble (SPEC section 31): whether it is on, where it is drawn (tiles, null when not drawn), where it is
  // going, and its reaction
  bramble: () => {
    const b = view.bramble;
    return { on: b.on, at: b.at && { ...b.at }, spot: b.spot && { ...b.spot }, reaction: b.reaction ? b.reaction.kind : null, hidden: b.hidden };
  },
  // What's new (SPEC section 30): the sheet's note titles while it is open, and the notes seen
  about: () => ({ open: panel === 'about', report: aboutReport() }),
  news: () => ({
    open: panel === 'news',
    titles: [...$('news-list').querySelectorAll('h4')].map((t) => t.textContent),
    seen: save.news.slice(),
  }),
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
    const def = [...LEVELS, ...NIGHT].find((level) => String(level.id) === String(id));
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
  hint: () => (view.hint ? (view.hint.dir || (view.hint.at ? 'key' : 'ring')) : null),
  hintAt: () => (view.hint && view.hint.at ? { ...view.hint.at } : null),
  preview: () => (view.preview ? JSON.parse(JSON.stringify(view.preview)) : null),
  reduced: () => view.reduced,
  // the hidden critter (SPEC section 23): where it is, whether it shows and whether it is found, or null
  critter: () => (session && session.critter
    ? { ...session.critter, shows: session.critterShows(), found: session.found, kind: current.critterKind.kind, name: current.critterKind.name }
    : null),
  sketch: () => sketchCritter(),
  // the lantern style the drawing uses now (SPEC section 24)
  lantern: () => lanternStyle().id,
  hintStep: () => (ladder ? ladder.tier : 0),
  way: () => {
    const way = ladder && session && !session.solved ? ladder.following(session.state) : null;
    return way ? { index: way.index, total: way.total } : null;
  },
  layout: () => (view.layout ? { ...view.layout, left: view.rect.left, top: view.rect.top, dpr: view.dpr, frames: view.frames } : null),
  save: () => JSON.parse(JSON.stringify(save)),
  contrast: () => view.highContrast,
  frames: () => view.frames,
  coach: () => (session ? coachPoint() : null),
  story: () => (book ? { id: book.ids[book.index], index: book.index, count: book.ids.length, reading: book.reading } : null),
  tutorial: () => (tutorial ? { index: tutorial.index, done: tutorial.done } : null),
  heard: () => heard.slice(),
  shop: () => ({ ...JSON.parse(JSON.stringify(save.shop)), kind: store ? store.kind : null, prices: { ...prices } }),
  // the Workshop (SPEC section 26): the cavern in the editor, where its tiles are, and whether a check is running
  editor: () => (editing && cavernNow()
    ? JSON.parse(JSON.stringify({ ...cavernNow(), index: editing.index, tool: editing.tool, undo: editing.undo.length, note: editing.note }))
    : null),
  editorLayout: () => (editorView.layout ? { ...editorView.layout, left: editorView.rect.left, top: editorView.rect.top } : null),
  checking: () => checking > 0,
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
