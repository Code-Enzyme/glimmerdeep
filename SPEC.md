# Glimmerdeep prototype: rules and module contracts

This file is the single source of truth for the prototype. If code and this file disagree, this file wins.
Design background lives in `docs/glimmerdeep-design.md` (read section 3 and 5 for flavour; where the two
differ on rules, THIS file wins, because the prototype simplifies a few things).

Goal of the prototype: a single self-contained HTML file, playable with one thumb on a phone browser,
that proves the core idea: **you never push anything; you decide where the light is, and the cave's
creatures move themselves.** Three species, about 15 levels, unlimited undo.

## 0. Ground rules for everyone working in this folder

- Project root: `/home/user/glimmerdeep`. Work only here. Do not touch `/mnt/project-files`.
- Each task owns specific files (listed in your brief). Do not edit files you do not own. If you need a
  change in someone else's file or in this spec, say so in your final report instead.
- Source files are ES modules (`"type": "module"`), plain JavaScript, no frameworks, no runtime
  dependencies, no network requests, no external fonts or images. Everything is drawn and synthesised in code.
- `src/engine.js` and `src/solver.js` are pure: no DOM, no `window`, no timers, no randomness.
- Test-first for rules: write the failing test, then the code. Never delete or skip a test to get green.
- Tests: `npm test` (node:test, files in `test/*.test.js`). Level check: `npm run verify`. Build: `npm run build`
  (bundles `src/game.js` into `dist/glimmerdeep.html`).
- Playwright and Chromium are pre-installed. Use them from a `.cjs` script with `require('playwright')`
  and `chromium.launch()` with no options. Do NOT run `playwright install` or `npm install playwright`.
- Do not `npm install` anything. esbuild is already installed and is the only dependency.
- Originality: every name, shape, sound and layout must be our own. Do not imitate any existing game's
  characters, art, music or levels.

## 1. The board

A level is a grid, at most 9 columns wide and 11 rows tall, origin top-left, `x` to the right, `y` down.

Terrain (static, one per tile):

| Char | Terrain | Wren may enter | Creatures may enter | Light passes through |
| --- | --- | --- | --- | --- |
| `#` | Wall | no | no | no |
| `.` | Floor | yes | yes | yes |
| `~` | Puddle | no | Fluffmoth only (it settles, see 3) | yes |
| (bridge) | Puddle with a settled moth | yes | yes | yes |
| `G` | Glowbud (the goal) | no | no | yes |
| `H` | Hush (living darkness) | only while carrying the lantern | no | no, and it is never lit |
| `a` `b` `c` | Pressure root, channel A, B, C | yes | yes | yes |
| `A` `B` `C` | Gate, channel A, B, C | only if open | only if open | yes (it is a lattice) |

Things on the board: Wren (the player), the lantern (carried by Wren, or planted on a tile), creatures.
At most one creature per tile. A creature can never share a tile with Wren or with a planted lantern.
Wren may stand on the planted lantern's tile (that is how it is picked up).

## 2. A turn

`step(state, action)` runs one turn. Actions:

| Action | Meaning | Legal when |
| --- | --- | --- |
| `N` `E` `S` `W` | Wren steps one tile (N is y-1, E is x+1) | target is in bounds, terrain allows Wren, no creature there |
| `L` | Plant the lantern on Wren's tile, or pick it up | plant: carrying, and Wren's terrain is floor, bridge or root. Pick up: lantern is planted on Wren's tile |
| `Z` | Wait | always |

An illegal action returns `null` and spends no turn. A legal action runs these phases in order:

1. **Player.** Apply the action. A carried lantern moves with Wren.
2. **Light A.** Compute the light map (section 4) with the new Wren and lantern positions.
3. **Creatures.** Every creature acts once, in reading order of its position at the start of this phase
   (top row first, left to right). Each uses Light A, but sees the up-to-date positions of creatures that
   already moved this turn. Rules in section 3.
4. **Light B.** Recompute the light map with the new creature positions. This is the light stored in the state.
5. **Roots and gates.** A root is pressed if a Stumpcap stands on it, or a Shellwhelk that is lit in
   Light B stands on it. Wren, moths and the lantern never press roots. A channel's gates are open iff the
   channel has at least one root and all of its roots are pressed. Gate state is stored and used for
   movement during the NEXT turn. Closing a gate never hurts anything: whoever stands in a gate tile stays
   and may step out later.
6. **Goal.** Every Glowbud whose tile is lit in Light B comes into bloom, and it stays in bloom for the
   rest of the level even after the light leaves. The level is solved iff there is at least one Glowbud and
   every Glowbud is in bloom. (Changed from the design doc's "all lit at once": with one lantern that rule
   forces all buds into one cluster.)
7. `turn` increases by 1.

The initial state (from `parseLevel`) runs phases 4 to 6 once, with `turn = 0` (so a bud lit at the start
is already in bloom). A level must not start solved.
After a level is solved, `step` returns `null` for every action.

## 3. Creatures

"The lantern position" `P` below means the lantern's tile (Wren's tile when carried).
The lantern is **smothered** when Wren carries it on a Hush tile: then nothing is lit and no creature reacts.

Two creatures use the same greedy step, taken from classic chase puzzles. Given a wanted horizontal
direction `hx` (-1, 0 or 1) and vertical direction `vy`:
**try the horizontal step first if `hx != 0`; if that is impossible (or `hx == 0`), try the vertical step if
`vy != 0`; otherwise stay.** A step is possible if the destination is in bounds, its terrain allows that
creature, no other creature is there, Wren is not there, and a planted lantern is not there.

### Fluffmoth `M` (chapter 1)
- Always flies toward the lantern: `hx = sign(P.x - x)`, `vy = sign(P.y - y)`, greedy step.
- Stays put if the lantern is smothered.
- If its step lands on a Puddle that has no bridge, it settles there for good: it leaves the creature list
  and that tile becomes a bridge.

### Shellwhelk `S` (chapter 2)
- If its tile is lit in Light A: it hides in its shell and does not move. A lit whelk is heavy (presses roots).
- If its tile is not lit: it creeps away from the lantern: `hx = sign(x - P.x)`, `vy = sign(y - P.y)`, greedy step.
  (When it is exactly in line with the lantern, `hx` or `vy` is 0 and it only backs straight away.)
- Stays put if the lantern is smothered. Cannot enter puddles.

### Stumpcap `T` (chapter 3)
- Has a fixed facing (N, E, S or W) that never changes.
- If its tile is lit in Light A: it wakes and walks one tile forward if possible; if blocked it stays (a "bump").
- If not lit: it sleeps and does not move.
- Always heavy (presses roots whether asleep or awake). Cannot enter puddles.

No creature can be pushed, pulled or hurt.

## 4. Light

There is exactly one light source: the lantern, at `P`. Radius `r` is **1 while carried, 2 while planted**.
If smothered, nothing is lit.

Light floods outward from `P`, one tile per step, up to `r` steps (4-neighbour steps):

- `P` itself is lit.
- A lit tile at distance `d < r` passes light on to its four neighbours **only if it is `P` or it is
  transparent**. A tile is transparent if its terrain lets light through (table in section 1) and no
  creature stands on it. Wren never blocks light.
- A neighbour that receives light is lit even if it is not transparent itself (walls and creatures at the
  edge of the light are lit; they just do not pass it on). Exception: Hush tiles are never lit.

So with radius 2, light bends around a corner if either of the two in-between tiles is transparent, and a
creature next to a planted lantern casts a one-tile shadow behind itself.

## 5. Worked example (level 1-1, par 5)

```
#########
#W..~..G#
####M####
#########
```

Wren starts at (1,1) carrying the lantern. Action `E`: Wren is at (2,1). The moth at (4,2) wants
`hx = -1, vy = -1`; (3,2) is a wall, so it tries the vertical step to (4,1), a puddle: it settles and the
puddle becomes a bridge. Then `E`, `E` (onto the bridge), `E`, `E`: Wren stands at (6,1), the Glowbud at
(7,1) is within radius 1 and lit. Solved in 5 turns. Without the moth the level is unsolvable.

Level size limit: keep the reachable space small. An exhaustive search of any level (and of each of its
feature-removed variants) must stay under 150,000 positions, so that hints are instant on a phone and
`npm test` stays fast. Use walls to tighten open rooms.

## 6. Level format

`src/levels/chN.js` default-exports an array of level definitions:

```js
{
  id: '1-1',            // 'chapter-number'
  name: 'First Light',  // short, original
  feature: 'M',         // which elements this level is about; each listed one must be NECESSARY (see below)
  par: 5,               // the exact length of the shortest solution, found by the solver
  map: [ '#########', '#W..~..G#', '####M####', '#########' ],   // all rows the same length
  under: { '3,4': 'a' },  // optional: the terrain under whatever the map shows at x,y (default is floor)
  note: 'One sentence: what the player learns or the trick.',   // for designers; never shown to players
  tip: 'Swipe to walk.',  // optional: one short player-facing line shown when the level opens (no spoilers)
}
```

Map characters: the terrain chars from section 1, plus things that stand on floor (or on `under` terrain):
`W` Wren carrying the lantern (exactly one), `M` Fluffmoth, `S` Shellwhelk, Stumpcaps by facing
`^` north, `>` east, `v` south, `<` west, and optionally `L` a lantern that starts planted (then Wren
starts without it; at most one `L`).

`feature` is a string of one or more of: `M`, `S`, `T` (the species), `L` (planting the lantern).
Necessity check, run for each listed character: for a species, the level with every creature of that
species removed must be unsolvable; for `L`, the level must be unsolvable without the `L` action.

## 7. Module contracts

### `src/engine.js` (pure)

```js
export const ACTIONS = ['N', 'E', 'S', 'W', 'L', 'Z'];
export const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

export function parseLevel(levelDef)        // -> state (turn 0, light, gates and solved computed). Throws on a malformed map.
export function step(state, action)         // -> NEW state, or null if illegal. Never mutates its input.
export function key(state)                  // -> string that identifies the position (for the solver's visited set)
export function isLit(state, x, y)          // -> boolean, from the stored light map
export function terrainAt(state, x, y)      // -> one of '#', '.', '~', 'bridge', 'G', 'H', 'a'..'c', 'A'..'C'; '#' when out of bounds
export function creatureAt(state, x, y)     // -> creature object or null
export function canEnter(state, who, x, y)  // who: 'wren' | 'M' | 'S' | 'T'. Terrain and occupancy check used by the rules.
export function isGateOpen(state, channel)  // channel: 'A' | 'B' | 'C'
export function isHidden(state, creature)   // true for a Shellwhelk whose tile is lit
export function isAwake(state, creature)    // true for a Stumpcap whose tile is lit
```

State (plain JSON-safe data; treat as immutable):

```js
{
  w, h,
  tiles: ['#########', ...],   // terrain only: creatures, Wren and L replaced by floor or the `under` terrain; never changes
  wren: { x, y },
  lantern: { x, y, carried },  // when carried, x and y equal Wren's
  creatures: [ { id, type: 'M' | 'S' | 'T', x, y, dir } ],   // id is stable for the whole level; dir is 'N'|'E'|'S'|'W' for T, null otherwise
  bridges: [ 'x,y', ... ],     // puddles that became bridges, sorted
  lit: [0, 1, ...],            // length w*h, index y*w+x, Light B
  gates: { A: false, ... },    // only channels present in the level
  buds: [ { x, y } ],          // Glowbud positions (static, reading order)
  bloom: [0, 1, ...],          // parallel to buds: 1 once that bud has been lit; never goes back to 0
  turn: 0,
  solved: false,
  events: [ ... ],             // what happened in the step that produced this state, in order (empty at turn 0)
}
```

Events (the UI animates and plays sounds from these; emit them in the order things happen):

```js
{ type: 'move', who: 'wren' | <creature id>, from: {x, y}, to: {x, y} }
{ type: 'plant', x, y }            { type: 'pickup', x, y }      { type: 'wait' }
{ type: 'settle', id, x, y }       // moth became a bridge (after its 'move')
{ type: 'bump', id }               // lit Stumpcap could not walk
{ type: 'hide', id }  { type: 'emerge', id }    // Shellwhelk lit state changed between the previous stored light and Light B
{ type: 'wake', id }  { type: 'sleep', id }     // Stumpcap lit state changed, same comparison
{ type: 'gate', channel, open }    // a channel's gates changed
{ type: 'bud', x, y, lit: true }   // a Glowbud came into bloom (emitted once per bud)
{ type: 'solved' }
```

`key(state)` must include Wren, the lantern (position and carried), every creature (type, position, facing;
order-independent), the bridges and the bloom flags. It must not depend on `turn`, `events` or creature ids.

### `src/solver.js` (pure)

```js
// Breadth-first search over engine.step. Returns the shortest solution.
export function solve(state, { maxStates = 300000, actions = ACTIONS } = {})
// -> { solved: boolean, moves: string[], explored: number, exhausted: boolean }
//    exhausted is true when the whole reachable space was searched (so solved:false means truly unsolvable).

export function nextMove(state, opts)   // -> the first action of a shortest solution from this state, or null

export function checkLevel(levelDef, opts)
// -> { id, ok, par: declared, shortest: number | null, explored, featureOk: { M: true, ... }, problems: string[] }
//    ok means: solvable, shortest === par, the search was exhaustive where it must be, and every feature is necessary.
```

`tools/verify-levels.js` prints one line per level from `src/levels/index.js` and exits non-zero if any
level is not ok. `test/levels.test.js` asserts the same for every level.

### `src/sprites.js` (canvas art, no game logic)

All draw functions paint a tile-sized picture with its top-left at `(px, py)` and side `size` (CSS pixels),
fully lit. They must look right from `size` 36 to 96. `t` is seconds (for idle animation).

```js
export const PALETTE
export function drawTile(ctx, kind, px, py, size, opts)
//   kind: 'floor' | 'wall' | 'puddle' | 'bridge' | 'bud' | 'hush' | 'root' | 'gate'
//   opts: { t, seed, lit, open, pressed, channel, accent, neighbors: {n, e, s, w} (true where the same kind adjoins) }
export function drawWren(ctx, px, py, size, { t, dir, carrying })
export function drawLantern(ctx, px, py, size, { t })                 // planted lantern
export function drawCreature(ctx, type, px, py, size, { t, dir, lit, hidden, awake })   // type 'M' | 'S' | 'T'
export function drawDarkness(ctx, { ox, oy, size, w, h, lit, source, t, highContrast })
//   Paints the darkness over an already-drawn board whose top-left is (ox, oy). `lit` is the engine's array.
//   `source` is { x, y, radius } in tile units (fractional allowed while animating) or null when smothered.
//   Unlit tiles must stay readable (shapes visible, colour drained); lit tiles get a warm glow with soft edges.
export function drawBackdrop(ctx, width, height, { t, accent })       // behind the board
export function drawIcon(ctx, name, px, py, size)                     // 'undo' | 'restart' | 'wait' | 'hint' | 'lantern' | 'map' | 'sound' | 'mute' | 'star' | 'lock' | 'contrast'
```

### `src/audio.js` (WebAudio, everything synthesised)

```js
export function initAudio()              // call from the first user gesture; idempotent; must never throw
export function setMuted(muted)          export function isMuted()
export function play(name)               // one-shot sound; unknown names are ignored
//   names: 'step' 'blocked' 'plant' 'pickup' 'wait' 'moth' 'settle' 'whelkMove' 'whelkHide' 'whelkEmerge'
//          'stumpStep' 'stumpBump' 'stumpWake' 'gateOpen' 'gateClose' 'budOn' 'budOff' 'solve' 'undo' 'restart' 'ui' 'hint'
export function setMusic({ playing, intensity, chapter })   // adaptive bed: intensity 0..1 = share of Glowbuds lit; chapter 1..3
```

### `src/game.js`, `src/index.html`, `src/style.css` (the app)

Imports engine, solver, levels, sprites and audio. Owns the DOM, input, animation, saving. The build
inlines `src/style.css` at `/*__CSS__*/` and the bundle at `/*__JS__*/` inside `src/index.html`.

## 8. Rule cards (player-facing text, use as written)

- **Wren:** "Swipe to walk. Tap Wren to set the lantern down or pick it up. A planted lantern shines further."
- **Fluffmoth:** "Flies toward your lantern. Loves puddles: it lands in one and becomes a bridge."
- **Shellwhelk:** "Creeps away from your lantern. Catch it in the light and it hides in its shell; a hiding whelk is heavy. A planted lantern reaches further."
- **Stumpcap:** "Sleeps in the dark. In the light it marches straight ahead. Always heavy."
- **Glowbud:** "Light every Glowbud. Once lit, it stays in bloom."
- **Pressure root and gate:** "A gate opens while something heavy rests on its root."
- **Puddle:** "Too deep for Wren. A Fluffmoth can bridge it."
- **Hush:** "Darkness that eats light. Wren can only cross it with the lantern in hand, and the lantern goes dark inside."

## 9. Details settled during implementation

- Creature ids are strings numbered per species in reading order: `M1`, `S1`, `T1`.
- `state.lit` arrays are frozen and shared between states. Never write to them.
- `state.gates` lists every channel that has a gate or a root. A channel with no root never opens.
- A moth that settles makes the bridge at once: creatures acting later in the same turn may step onto it.
- Event order within a step: the player's event; then for each creature in acting order `move`, `settle`,
  `bump`; then `hide` / `emerge` / `wake` / `sleep`; then `gate`, `bud`, `solved`. A Stumpcap can `move`
  without a `wake` (lit in Light A, walked out of the light). `bump` repeats on every lit, blocked turn.
- `parseLevel` throws on maps over 9 by 11, on `under` entries where nothing stands, and on start positions
  the terrain table forbids.
- `solve().explored` counts distinct positions reached, including the start. `checkLevel` also returns
  `searched` (positions over all its searches).
- Light passes through gates, so a gate protects access, not light: keep buds more than 2 flood steps from
  anywhere the lantern can stand without opening the gate. A gate only needs to be open on the turn Wren
  steps into it.
- Moths chase the lantern from anywhere and cannot be walked through. Planting the lantern parks them.
