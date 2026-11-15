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

// opts: { chapters, levels, records: { [id]: { moves, stars } }, isUnlocked(def), onOpen(def), onLocked(def, node) }
export function renderMap(root, opts) {
  root.textContent = '';
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
    if (levels.length) head.appendChild(el('span', 'tally', `${solved} of ${levels.length} lit`));
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
        const stars = record ? record.stars : 0;
        node.setAttribute('aria-label', open
          ? `Level ${def.id}, ${def.name}` + (record ? `, ${stars} of 3 star moss, best ${record.moves} moves` : ', not solved yet')
          : `Level ${def.id}, locked. Solve the level before it first.`);
        if (!open) node.setAttribute('aria-disabled', 'true');
        const dot = el('span', 'dot', levelNumber(def, i));
        if (!open) dot.appendChild(el('span', 'lock ico'));
        node.appendChild(dot);
        const moss = el('span', 'moss-row');
        moss.innerHTML = mossSvg(stars >= 1) + mossSvg(stars >= 2) + mossSvg(stars >= 3);
        node.appendChild(moss);
        node.addEventListener('click', () => (open ? opts.onOpen(def) : opts.onLocked(def, node)));
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
