// Tester notes (SPEC section 33): per-cavern counts that stay on the phone until a tester copies them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTE_KINDS, readNotes, noteAdd, notesReport } from '../src/ui/notes.js';

const levels = [
  { id: '1-1', name: 'First Light', par: 5 },
  { id: '1-4', name: 'Two Pools', par: 15 },
  { id: 'N-1', name: 'Glass in the Dark', par: 16 },
  { id: 'D-01', name: 'Moth Hollow', par: 12 },
];

test('notes: the kinds, and a note starts at nothing', () => {
  assert.deepEqual(NOTE_KINDS, ['visits', 'solves', 'undos', 'restarts', 'hints', 'seconds']);
  const notes = {};
  noteAdd(notes, '1-4', 'undos');
  assert.deepEqual(notes, { '1-4': { visits: 0, solves: 0, undos: 1, restarts: 0, hints: 0, seconds: 0 } });
  noteAdd(notes, '1-4', 'undos', 2);
  noteAdd(notes, '1-4', 'seconds', 12.7);
  assert.equal(notes['1-4'].undos, 3);
  assert.equal(notes['1-4'].seconds, 12, 'whole seconds');
});

test('notes: a junk kind, id or amount changes nothing', () => {
  const notes = {};
  noteAdd(notes, '1-4', 'jumps');
  noteAdd(notes, '', 'undos');
  noteAdd(notes, null, 'undos');
  noteAdd(notes, '1-4', 'undos', -3);
  noteAdd(notes, '1-4', 'undos', Number.NaN);
  noteAdd(notes, '1-4', 'undos', 'many');
  assert.deepEqual(notes, {});
  assert.doesNotThrow(() => noteAdd(null, '1-4', 'undos'));
});

test('notes: a visit lasts at most 30 minutes', () => {
  const notes = {};
  noteAdd(notes, '1-1', 'seconds', 4 * 3600);
  assert.equal(notes['1-1'].seconds, 1800);
});

test('notes: reading keeps whole counts from 0, and drops the rest', () => {
  assert.deepEqual(readNotes(undefined), {});
  assert.deepEqual(readNotes([1, 2]), {});
  assert.deepEqual(readNotes('x'), {});
  assert.deepEqual(readNotes({
    '1-4': { visits: 3, solves: 2.9, undos: -1, restarts: 'x', hints: 1, seconds: 360, extra: 5 },
    '': { visits: 1 },
    'N-1': 'junk',
    'D-01': { visits: 1 },
  }), {
    '1-4': { visits: 3, solves: 2, undos: 0, restarts: 0, hints: 1, seconds: 360 },
    'D-01': { visits: 1, solves: 0, undos: 0, restarts: 0, hints: 0, seconds: 0 },
  });
});

test('notes: the report, in map order, one line a cavern played', () => {
  const notes = readNotes({
    'D-01': { visits: 1, solves: 1, undos: 0, restarts: 0, hints: 0, seconds: 45 },
    '1-4': { visits: 3, solves: 2, undos: 12, restarts: 2, hints: 1, seconds: 370 },
    '1-1': { visits: 1, solves: 1, undos: 1, restarts: 1, hints: 2, seconds: 90 },
    'N-1': { visits: 2, solves: 0, undos: 5, restarts: 0, hints: 0, seconds: 600 },
    'gone': { visits: 1 },
  });
  const records = { '1-4': { moves: 17, stars: 2 }, '1-1': { moves: 5, stars: 3 } };
  const text = notesReport(notes, records, levels, { version: { version: '1.0', build: '12' }, date: '2026-11-23' });
  assert.equal(text, [
    'Glimmerdeep tester notes',
    'Version 1.0, build 12',
    '2026-11-23',
    '1-1 First Light: 1 visit, lit 1 time, best 5 (par 5), 1 undo, 1 restart, 2 hints, 2 min',
    '1-4 Two Pools: 3 visits, lit 2 times, best 17 (par 15), 12 undos, 2 restarts, 1 hint, 6 min',
    'N-1 Glass in the Dark: 2 visits, not lit, 5 undos, 0 restarts, 0 hints, 10 min',
    'D-01 Moth Hollow: 1 visit, lit 1 time, 0 undos, 0 restarts, 0 hints, under 1 min',
  ].join('\n'));
  assert.ok(notesReport({}, {}, levels, { version: null, date: '2026-11-23' }).startsWith('Glimmerdeep tester notes\nWeb build\n2026-11-23'));
});
