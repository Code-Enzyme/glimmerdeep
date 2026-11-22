// Tester notes (SPEC section 33): how each cavern went, counted on the phone and never sent. A tester copies
// the report into their feedback. Pure: no DOM.

export const NOTE_KINDS = ['visits', 'solves', 'undos', 'restarts', 'hints', 'seconds'];
const VISIT_MAX_S = 30 * 60;   // a visit counts at most 30 minutes, so a phone left on the board does not skew it

const blank = () => Object.fromEntries(NOTE_KINDS.map((k) => [k, 0]));
const count = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

// Adds n (default 1) to one count of one cavern's note. Anything that is not a real count changes nothing.
export function noteAdd(notes, id, kind, n = 1) {
  if (!notes || typeof notes !== 'object' || typeof id !== 'string' || !id || !NOTE_KINDS.includes(kind)) return;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return;
  const add = Math.floor(kind === 'seconds' ? Math.min(n, VISIT_MAX_S) : n);
  if (add <= 0) return;
  const note = notes[id] || (notes[id] = blank());
  note[kind] += add;
}

// The saved notes: each id's counts as whole numbers from 0; anything else is dropped.
export function readNotes(value) {
  const notes = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return notes;
  for (const [id, note] of Object.entries(value)) {
    if (!id || !note || typeof note !== 'object' || Array.isArray(note)) continue;
    notes[id] = Object.fromEntries(NOTE_KINDS.map((k) => [k, count(Number(note[k]))]));
  }
  return notes;
}

const some = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "Version 1.0, build 12", or "Web build" without the app shell's version.
export function versionLabel(version) {
  if (!version || !version.version) return 'Web build';
  return `Version ${version.version}${version.build ? `, build ${version.build}` : ''}`;
}

// The report a tester copies: a header, then one line per cavern played, in the order of `levels` (map order).
// records: the save's bests by level id; version: { version, build } or null; date: 'YYYY-MM-DD'.
export function notesReport(notes, records, levels, { version, date }) {
  const lines = ['Glimmerdeep tester notes', versionLabel(version), date];
  for (const def of levels) {
    const n = notes && notes[def.id];
    if (!n) continue;
    const best = records && records[def.id];
    const parts = [
      some(n.visits, 'visit'),
      n.solves ? `lit ${some(n.solves, 'time')}` : 'not lit',
      ...(best ? [`best ${best.moves} (par ${def.par})`] : []),
      some(n.undos, 'undo'),
      some(n.restarts, 'restart'),
      some(n.hints, 'hint'),
      n.seconds < 60 ? 'under 1 min' : `${Math.round(n.seconds / 60)} min`,
    ];
    lines.push(`${def.id} ${def.name}: ${parts.join(', ')}`);
  }
  return lines.join('\n');
}
