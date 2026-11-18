// The map screen: one journal page per chapter, its levels as round nodes on a winding trail.
// Built from CHAPTERS at runtime; a chapter with no levels yet shows a note instead of a trail.

import { mossSvg } from './art.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE = 56;        // node circle, CSS px
const ROW = 98;         // distance between trail rows
const TOP = 34;         // centre of the first row

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The number shown on a node: the part of the id after the dash, else its place in the chapter.
export function levelNumber(def, indexInChapter) {
  const m = /^\d+-(\d+)$/.exec(String(def.id));
  return m ? m[1] : String(indexInChapter + 1);
}

// The Daily Glimmer card (SPEC section 15). d: { dateLabel, name, streak: { current, best }, todayStars,
//   week: [{ key, label, letter, today, stars, open }], onPlay(), onDay(key), onLocked() }
function dailyCard(d) {
  const card = el('section', 'daily paper');
  card.id = 'daily';
  card.setAttribute('aria-label', 'Daily Glimmer');
  const head = el('div', 'daily-head');
  head.appendChild(el('span', 'kicker ink', 'Daily Glimmer'));
  const date = el('span', 'daily-date', d.dateLabel);
  date.id = 'daily-date';
  head.appendChild(date);
  card.appendChild(head);

  const main = el('div', 'daily-main');
  const words = el('div', 'daily-words');
  const name = el('h2', '', d.name);
  name.id = 'daily-name';
  words.appendChild(name);
  const { current, best } = d.streak;
  const streak = el('p', 'daily-streak', current
    ? `${current}-day streak, best ${best}`
    : `Light today's cavern to start a streak.${best ? ` Best ${best}.` : ''}`);
  streak.id = 'daily-streak';
  words.appendChild(streak);
  main.appendChild(words);
  const play = el('button', 'btn primary daily-play');
  play.id = 'daily-play';
  play.type = 'button';
  play.setAttribute('aria-label', `Play today's Daily Glimmer, ${d.name}`);
  play.appendChild(el('span', 'lbl', 'Play'));
  const moss = el('span', 'moss-row');
  moss.innerHTML = mossSvg(d.todayStars >= 1) + mossSvg(d.todayStars >= 2) + mossSvg(d.todayStars >= 3);
  play.appendChild(moss);
  play.addEventListener('click', () => d.onPlay());
  main.appendChild(play);
  card.appendChild(main);

  const week = el('div', 'daily-week');
  week.id = 'daily-week';
  week.setAttribute('role', 'group');
  week.setAttribute('aria-label', 'The last seven days');
  for (const day of d.week) {
    const b = el('button', 'day' + (day.today ? ' today' : '') + (day.stars ? ' lit' : '') + (day.open ? '' : ' locked'));
    b.type = 'button';
    b.dataset.date = day.key;
    const state = day.stars ? `lit, ${day.stars} of 3 star moss` : day.today ? 'not lit yet' : 'not lit';
    b.setAttribute('aria-label', `${day.label}, ${day.today ? 'today, ' : ''}${state}${day.open ? '' : '. Part of the Full Expedition.'}`);
    b.appendChild(el('span', 'letter', day.letter));
    b.appendChild(el('span', 'num', String(Number(day.key.slice(8)))));
    if (!day.open) b.appendChild(el('span', 'lock ico'));
    b.addEventListener('click', () => {
      if (day.today) d.onPlay();
      else if (day.open) d.onDay(day.key);
      else d.onLocked();
    });
    week.appendChild(b);
  }
  card.appendChild(week);
  return card;
}

// opts: { chapters, levels, records: { [id]: { moves, stars } }, isUnlocked(def), onOpen(def), onLocked(def, node),
//         chapterLocked(chapter) (part of the Full Expedition, not bought), onShop(chapter), daily (see dailyCard) }
export function renderMap(root, opts) {
  root.textContent = '';
  if (opts.daily) root.appendChild(dailyCard(opts.daily));
  const firstOpen = opts.levels.find((def) => !opts.records[def.id] && opts.isUnlocked(def));
  for (const chapter of opts.chapters) {
    const levels = chapter.levels || [];
    const section = el('section', 'chapter paper');
    section.style.setProperty('--accent', chapter.accent || '#5FBFA8');
    section.setAttribute('aria-label', `Chapter ${chapter.id}: ${chapter.name}`);

    const head = el('div', 'chapter-head');
    head.appendChild(el('span', 'blot'));
    const names = el('div', 'chapter-names');
    names.appendChild(el('span', 'kicker ink', `Chapter ${chapter.id}`));
    names.appendChild(el('h2', '', chapter.name));
    head.appendChild(names);
    const solved = levels.filter((def) => opts.records[def.id]).length;
    const paid = !!(opts.chapterLocked && opts.chapterLocked(chapter));
    if (paid) {
      section.classList.add('paid');
      const unlock = el('button', 'btn chapter-unlock', 'Unlock');
      unlock.type = 'button';
      unlock.setAttribute('aria-label', `Unlock chapter ${chapter.id} with the Full Expedition`);
      unlock.addEventListener('click', () => opts.onShop(chapter));
      head.appendChild(unlock);
    } else if (levels.length) {
      head.appendChild(el('span', 'tally', `${solved} of ${levels.length} lit`));
    }
    section.appendChild(head);

    if (!levels.length) {
      section.appendChild(el('p', 'empty', 'Still dark down here. These caverns are being charted.'));
    } else {
      const trail = el('div', 'trail');
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('aria-hidden', 'true');
      svg.appendChild(document.createElementNS(SVG_NS, 'path'));
      trail.appendChild(svg);
      levels.forEach((def, i) => {
        const record = opts.records[def.id];
        const open = opts.isUnlocked(def);
        const node = el('button', 'node');
        node.type = 'button';
        node.dataset.level = def.id;
        if (record) node.classList.add('solved');
        if (!open) node.classList.add('locked');
        if (def === firstOpen) node.classList.add('next');
        if (def.gloam) node.classList.add('gloam');   // a Gloam encounter (SPEC section 17): ringed with Hush
        const stars = record ? record.stars : 0;
        const what = def.gloam ? ', Gloam encounter' : '';
        node.setAttribute('aria-label', open
          ? `Level ${def.id}, ${def.name}${what}` + (record ? `, ${stars} of 3 star moss, best ${record.moves} moves` : ', not solved yet')
          : paid ? `Level ${def.id}${what}, locked. Part of the Full Expedition.` : `Level ${def.id}${what}, locked. Solve the level before it first.`);
        if (!open && !paid) node.setAttribute('aria-disabled', 'true');   // a paid level still acts: it opens the store
        const dot = el('span', 'dot', levelNumber(def, i));
        if (!open) dot.appendChild(el('span', 'lock ico'));
        node.appendChild(dot);
        const moss = el('span', 'moss-row');
        moss.innerHTML = mossSvg(stars >= 1) + mossSvg(stars >= 2) + mossSvg(stars >= 3);
        node.appendChild(moss);
        node.addEventListener('click', () => {
          if (open) opts.onOpen(def);
          else if (paid) opts.onShop(chapter);
          else opts.onLocked(def, node);
        });
        trail.appendChild(node);
      });
      section.appendChild(trail);
    }
    root.appendChild(section);
  }
  layoutMap(root);
}

// Places the nodes of every trail and draws the dotted path through them. Call again after a resize.
export function layoutMap(root) {
  const trails = root.querySelectorAll('.trail');
  trails.forEach((trail, t) => {
    const width = trail.clientWidth;
    if (!width) return;
    const nodes = trail.querySelectorAll('.node');
    const n = nodes.length;
    const cols = Math.max(3, Math.min(6, Math.floor(width / 76)));
    const rows = Math.ceil(n / cols);
    const points = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols);
      const k = i % cols;
      const col = row % 2 === 0 ? k : cols - 1 - k;   // the trail snakes back on every other row
      const x = ((col + 0.5) * width) / cols;
      const y = TOP + row * ROW + Math.sin(i * 1.9 + t * 1.3) * 7;
      points.push([x, y]);
      nodes[i].style.left = `${x.toFixed(1)}px`;
      nodes[i].style.top = `${(y - NODE / 2).toFixed(1)}px`;
    }
    const height = TOP + (rows - 1) * ROW + NODE / 2 + 30;
    trail.style.height = `${height}px`;
    const svg = trail.querySelector('svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    // a short lead-in from the page edge, then a soft curve through every node
    let d = '';
    if (points.length) {
      const [x0, y0] = points[0];
      d = `M${(x0 - 44).toFixed(1)} ${(y0 + 9).toFixed(1)} Q${(x0 - 22).toFixed(1)} ${(y0 - 8).toFixed(1)} ${x0.toFixed(1)} ${y0.toFixed(1)}`;
      for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1];
        const [bx, by] = points[i];
        if (Math.abs(by - ay) > ROW / 2) {
          // the turn at the end of a row bulges outward
          const out = ax > width / 2 ? 34 : -34;
          d += ` C${(ax + out).toFixed(1)} ${(ay + 14).toFixed(1)} ${(bx + out).toFixed(1)} ${(by - 14).toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
        } else {
          const mx = (ax + bx) / 2;
          const sag = i % 2 === 0 ? -9 : 9;
          d += ` C${mx.toFixed(1)} ${(ay + sag).toFixed(1)} ${mx.toFixed(1)} ${(by + sag).toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
        }
      }
    }
    svg.firstChild.setAttribute('d', d);
  });
}
