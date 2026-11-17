# Glimmerdeep prototype: rules and module contracts

This file is the single source of truth for the prototype. If code and this file disagree, this file wins.
Design background lives in `docs/glimmerdeep-design.md` (read section 3 and 5 for flavour; where the two
differ on rules, THIS file wins, because the prototype simplifies a few things).

Goal of the prototype: a single self-contained HTML file, playable with one thumb on a phone browser,
that proves the core idea: **you never push anything; you decide where the light is, and the cave's
creatures move themselves.** Three species, about 15 levels, unlimited undo.

## 0. Ground rules

Working rules (test first, which checks to run, how the app is built) live in `CLAUDE.md`. The rules
that shape the code:

- Source files are ES modules, plain JavaScript, no frameworks, no network requests, no external fonts
  or images. Everything is drawn and synthesised in code.
- `src/engine.js` and `src/solver.js` are pure: no DOM, no `window`, no timers, no randomness.
- The only runtime dependencies are the Capacitor app shell and its App and Haptics plugins, and only
  `src/ui/native.js` imports them. In a browser every call there falls back or does nothing, so the
  single-file web build keeps working.
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
| `L` | Plant the lantern on Wren's tile, pick it up, or aim it | plant: carrying, and Wren's terrain is floor, bridge or root. Pick up: lantern is planted on Wren's tile. Aim: the level has a shutter and the lantern is planted on a tile next to Wren (below) |
| `Z` | Wait | always |

**Aiming (levels with `shutter: true`, chapter 7, decided 17 Nov 2026).** `L` while Wren stands on a tile
orthogonally next to the planted lantern closes its shutter, so it shines a beam (section 4) pointing away
from Wren: from the lantern's west side it aims east, and so on. If it already aims that way, `L` opens it
back to round light; from another side it turns the beam to the new direction. Picking the lantern up opens
it again: a carried lantern is always round. In a level without a shutter, `L` next to the lantern is illegal.

An illegal action returns `null` and spends no turn. A legal action runs these phases in order:

1. **Player.** Apply the action. A carried lantern moves with Wren.
2. **Light A.** Compute the light map (section 4) with the new Wren and lantern positions.
3. **Creatures.** Every creature acts once, in reading order of its position at the start of this phase
   (top row first, left to right). Each uses Light A, but sees the up-to-date positions of creatures that
   already moved this turn. Rules in section 3.
4. **Light B.** Recompute the light map with the new creature positions. This is the light stored in the state.
5. **Roots and gates.** A root is pressed if a Stumpcap or a Dozer newt stands on it, or a Shellwhelk that
   is lit in Light B stands on it. Wren, moths, Emberwicks, Gloamlings, Mirrorbeetles and the lantern never press roots. A channel's gates are open iff the
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

"The lantern position" `P` below means the lantern's tile (Wren's tile when carried). Aiming the lantern
does not change `P`.
The lantern is **smothered** when Wren carries it on a Hush tile: then the lantern lights nothing (a glowing
Emberwick still does), and no creature reacts to the lantern (moths, whelks, Gloamlings and Mirrorbeetles stay put). Creatures that go by light alone act as in any darkness:
Stumpcaps sleep and Dozer newts wander.

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

### Dozer newt (chapter 4)
- Has a facing (N, E, S or W) that it changes itself.
- If its tile is lit in Light A: it dozes and does not move or turn.
- If not lit (including when the lantern is smothered): it wanders. It walks one tile forward if possible;
  if blocked, it stays and turns a quarter turn clockwise (N to E to S to W to N). It tries the new facing
  on its next turn, so at a corner it pauses for one turn. Anything that blocks a Stumpcap blocks a newt,
  Wren included, so Wren can turn a newt by standing in its way.
- Always heavy (presses roots whether dozing or wandering). Cannot enter puddles, walks over bridges.

### Emberwick `K` (chapter 5, decided 17 Nov 2026)
- Has a heat of 0 (cold), 1 (warm) or 2 (glowing). It starts cold.
- Not yet glowing: if its tile is lit in Light A it warms by one, else it goes back to cold. So it takes two
  lit turns in a row to catch. It does not move while it is not glowing, and on the turn it catches.
- Glowing: it stays glowing for the rest of the level, it is a light (section 4), and it follows Wren:
  `hx = sign(Wren.x - x)`, `vy = sign(Wren.y - y)`, greedy step. Next to Wren it stays put. It follows Wren,
  not the lantern, even when the lantern is planted or smothered.
- Never heavy (it does not press roots). Cannot enter puddles, walks over bridges.

### Gloamling `O` (chapter 6, decided 17 Nov 2026)
- Drifts toward the lantern: `hx = sign(P.x - x)`, `vy = sign(P.y - y)`, greedy step, like a moth. It stays
  put while the lantern is smothered. It never settles: it cannot enter puddles and walks over bridges.
- It eats light: its own tile and its four neighbours are **shadowed** (section 4), so nothing there is lit,
  whatever the source. Next to Wren it shadows the carried lantern itself, so Wren's light goes out until
  Wren gets away from it. The board plays `'gloamSnuff'` when the lantern's own tile goes dark that way.
- Never heavy.

### Mirrorbeetle `R` (chapter 7, decided 17 Nov 2026)
- Its shell is a mirror, slanted `/` or `\` (its map character). The slant never changes.
- If its tile is lit in Light A, it basks and does not move. If not, it crawls toward the lantern:
  `hx = sign(P.x - x)`, `vy = sign(P.y - y)`, greedy step. It stays put while the lantern is smothered.
- A beam that reaches it turns a quarter turn on its shell (section 4). Round light does not turn: a beetle
  at the edge of round light is lit and casts a shadow like any creature.
- Never heavy. Cannot enter puddles, walks over bridges.

No creature can be pushed, pulled or hurt.

## 4. Light

Light sources: the lantern at `P`, radius `r` **1 while carried, 2 while planted**, or a beam while it is
aimed (below), and every glowing Emberwick, radius 1 from its own tile. A smothered lantern lights nothing. The light map is the union of
what every source lights; each source floods as below, with itself as `P`.

Every Gloamling shadows its own tile and its four neighbours. A shadowed tile is never lit and never passes
light on, and a source whose own tile is shadowed lights nothing.

Light floods outward from `P`, one tile per step, up to `r` steps (4-neighbour steps):

- `P` itself is lit.
- A lit tile at distance `d < r` passes light on to its four neighbours **only if it is `P` or it is
  transparent**. A tile is transparent if its terrain lets light through (table in section 1) and no
  creature stands on it. Wren never blocks light.
- A neighbour that receives light is lit even if it is not transparent itself (walls and creatures at the
  edge of the light are lit; they just do not pass it on). Exception: Hush tiles are never lit.

So with radius 2, light bends around a corner if either of the two in-between tiles is transparent, and a
creature next to a planted lantern casts a one-tile shadow behind itself.

**Beam (chapter 7).** An aimed lantern lights its own tile `P` and a beam, and nothing round about it. The
beam leaves `P` in the aimed direction and travels straight, one tile at a time, **up to 4 tiles**:

- Each tile the beam reaches is lit, and the beam goes on only from a transparent tile.
- A Hush tile or a shadowed tile stops the beam, and is not lit.
- A Mirrorbeetle's tile is lit and the beam turns there: a `/` shell turns east-going light north, north to
  east, west to south and south to west; a `\` shell turns east to south, south to east, west to north and
  north to west. From the beetle the beam travels up to 4 more tiles, by the same rules.
- If the beam reaches a beetle from a direction it already came from on this beam, it stops there (it would
  only go round in a loop).

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
  tutorial: [ ... ],      // optional: guided steps for a player's first visit (section 12)
  shutter: true,          // optional: the lantern can be aimed (section 2)
}
```

Map characters: the terrain chars from section 1, plus things that stand on floor (or on `under` terrain):
`W` Wren carrying the lantern (exactly one), `M` Fluffmoth, `S` Shellwhelk, Stumpcaps by facing
`^` north, `>` east, `v` south, `<` west, Dozer newts by starting facing `n` north, `e` east, `s` south,
`w` west (lower case), `K` an Emberwick (cold), `O` a Gloamling, Mirrorbeetles by shell `/` and `\` (written `'\\'`
in a JavaScript string), and optionally `L` a lantern that starts planted (then Wren starts without it; at most one
`L`). A planted lantern always starts round.

`feature` is a string of one or more of: `M`, `S`, `T`, `D`, `K`, `O`, `R` (the species), `L` (planting the
lantern), `A` (aiming it). Necessity check, run for each listed character: for a species, the level with every
creature of that species removed must be unsolvable; for `L`, the level must be unsolvable without the `L`
action; for `A`, the level with `shutter: false` must be unsolvable.

Optional `shutter: true` lets the lantern be aimed (section 2). Only levels that teach or use aiming have it.

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
export function canEnter(state, who, x, y)  // who: 'wren' | 'M' | 'S' | 'T' | 'D' | 'K' | 'O' | 'R'. Terrain and occupancy check used by the rules.
export function isGateOpen(state, channel)  // channel: 'A' | 'B' | 'C'
export function isHidden(state, creature)   // true for a Shellwhelk whose tile is lit
export function isAwake(state, creature)    // true for a Stumpcap whose tile is lit, and for a Dozer newt whose tile is dark
export function beamPath(state)             // -> null, or the beam's corners for drawing: [{x, y}, ...] from P, through each
                                            //    beetle it turns on, to the last tile it lights (P alone if nothing beyond is lit)
```

State (plain JSON-safe data; treat as immutable):

```js
{
  w, h,
  tiles: ['#########', ...],   // terrain only: creatures, Wren and L replaced by floor or the `under` terrain; never changes
  wren: { x, y },
  lantern: { x, y, carried },  // when carried, x and y equal Wren's; an aimed lantern also has beam: 'N'|'E'|'S'|'W'
  creatures: [ { id, type: 'M' | 'S' | 'T' | 'D' | 'K' | 'O' | 'R', x, y, dir } ],   // id is stable for the whole level; dir is 'N'|'E'|'S'|'W' for T and D,
                               // '/' or '\\' (the shell) for R, null otherwise
                               // an Emberwick also has `heat`: 0 cold, 1 warm, 2 glowing
  bridges: [ 'x,y', ... ],     // puddles that became bridges, sorted
  lit: [0, 1, ...],            // length w*h, index y*w+x, Light B
  gates: { A: false, ... },    // only channels present in the level
  buds: [ { x, y } ],          // Glowbud positions (static, reading order)
  bloom: [0, 1, ...],          // parallel to buds: 1 once that bud has been lit; never goes back to 0
  shutter: false,              // from the level: whether the lantern can be aimed
  turn: 0,
  solved: false,
  events: [ ... ],             // what happened in the step that produced this state, in order (empty at turn 0)
}
```

Events (the UI animates and plays sounds from these; emit them in the order things happen):

```js
{ type: 'move', who: 'wren' | <creature id>, from: {x, y}, to: {x, y} }
{ type: 'plant', x, y }            { type: 'pickup', x, y }      { type: 'wait' }
{ type: 'aim', x, y, dir }         // the planted lantern at x,y now beams toward dir, or is open again (dir null)
{ type: 'settle', id, x, y }       // moth became a bridge (after its 'move')
{ type: 'bump', id }               // lit Stumpcap could not walk
{ type: 'hide', id }  { type: 'emerge', id }    // Shellwhelk lit state changed between the previous stored light and Light B
{ type: 'wake', id }  { type: 'sleep', id }     // Stumpcap or newt changed state, same comparison: a Stumpcap wakes when it
                                                //   becomes lit; a newt dozes off ('sleep') when it becomes lit and wakes when dark
{ type: 'turn', id, dir }          // a newt was blocked and turned clockwise; dir is its new facing
{ type: 'warm', id }  { type: 'cool', id }  { type: 'ignite', id }   // an Emberwick's heat went 0 to 1, 1 to 0, 1 to 2
{ type: 'glint', id }              // a Mirrorbeetle became lit, same comparison as hide
{ type: 'gate', channel, open }    // a channel's gates changed
{ type: 'bud', x, y, lit: true }   // a Glowbud came into bloom (emitted once per bud)
{ type: 'solved' }
```

`key(state)` must include Wren, the lantern (position, carried and beam), every creature (type, position, facing or shell, heat;
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
export function drawLantern(ctx, px, py, size, { t, out, beam })      // planted lantern; out: in a Gloamling's shadow;
                                                                      //   beam: 'N'|'E'|'S'|'W' when aimed (hooded, open on that side)
export function drawCreature(ctx, type, px, py, size, { t, dir, lit, hidden, awake, heat })   // type 'M' | 'S' | 'T' | 'D' | 'K' | 'O' | 'R'
export function drawDarkness(ctx, { ox, oy, size, w, h, lit, source, t, highContrast })
//   Paints the darkness over an already-drawn board whose top-left is (ox, oy). `lit` is the engine's array.
//   `source` is { x, y, radius } in tile units (fractional allowed while animating) or null when the lantern lights nothing (smothered, or in a Gloamling's shadow).
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
//          'stumpStep' 'stumpBump' 'stumpWake' 'newtStep' 'newtTurn' 'newtDoze' 'newtWake'
//          'emberWarm' 'emberCool' 'emberIgnite' 'emberStep' 'gloamDrift' 'gloamSnuff' 'aim' 'beetleCrawl' 'beetleGlint'
//          'gateOpen' 'gateClose' 'budOn' 'budOff' 'solve' 'undo' 'restart' 'ui' 'hint' 'page'
export function setMusic({ playing, intensity, chapter })   // adaptive bed: intensity 0..1 = share of Glowbuds lit; chapter 1..3
```

### `src/game.js`, `src/index.html`, `src/style.css` (the app)

Imports engine, solver, levels, sprites and audio. Owns the DOM, input, animation, saving. The build
inlines `src/style.css` at `/*__CSS__*/` and the bundle at `/*__JS__*/` inside `src/index.html`.

## 8. Rule cards (player-facing text, use as written)

- **Wren:** "Swipe to walk. Tap Wren to set the lantern down or pick it up. A planted lantern shines further."
- **Fluffmoth:** "Flies toward your lantern, sideways first. Loves puddles: it lands in one and becomes a bridge."
- **Shellwhelk:** "Creeps away from your lantern. Catch it in the light and it hides in its shell; a hiding whelk is heavy. A planted lantern reaches further."
- **Stumpcap:** "Sleeps in the dark. In the light it marches straight ahead until something stands in its way. Always heavy."
- **Dozer newt:** "Wanders in the dark and turns right whenever something blocks it. Light makes it doze off where it stands. Always heavy."
- **Emberwick:** "Keep it in the light for two turns in a row and it catches. Then it glows like a little lantern and follows Wren everywhere. Never heavy."
- **Gloamling:** "Drifts toward your lantern and eats light: the tiles around it stay dark, your lantern's too. It waits while the lantern is smothered. Never heavy."
- **Mirrorbeetle:** "Crawls toward your lantern in the dark and stops in the light. Its mirror shell turns a beam around a corner. Never heavy."
- **Shutter:** "Stand beside the planted lantern and tap Wren to aim its light, away from you, as a beam four tiles long. Tap again from the same side to open it."
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
  `bump`, `turn`, `warm`, `cool`, `ignite`; then `hide` / `emerge` / `wake` / `sleep` / `glint`; then `gate`, `bud`, `solved`. A Stumpcap can `move`
  without a `wake` (lit in Light A, walked out of the light). `bump` repeats on every lit, blocked turn.
- `parseLevel` throws on maps over 9 by 11, on `under` entries where nothing stands, and on start positions
  the terrain table forbids.
- `solve().explored` counts distinct positions reached, including the start. `checkLevel` also returns
  `searched` (positions over all its searches).
- Light passes through gates, so a gate protects access, not light: keep buds more than 2 flood steps from
  anywhere the lantern can stand without opening the gate. A gate only needs to be open on the turn Wren
  steps into it.
- Moths chase the lantern from anywhere and cannot be walked through. Planting the lantern parks them.

## 10. Characters and sound (decided 16 Nov 2026)

- No character has a face: no eyes, mouths or face-like marks anywhere, at any size.
- Character art lives in `src/chars.js`, which dispatches to the game's style, `src/chars/glowmark.js`.
  A style exports `drawWren`, `drawLantern`, `drawCreature` (section 7 signatures), and optionally
  `drawBridgeMoth(ctx, px, py, size, { t })` and `drawGlow(ctx, who, px, py, size, opts)`. The board calls
  drawGlow after drawDarkness, so glowing markings show on unlit tiles. Tiles still come from sprites.js.
- `src/chars/felt.js` and `src/chars/glyph.js` are the two faceless styles not chosen. They are kept for
  `dev/style-preview.js` only and are not in the game bundle.
- No music. `audio.js` still contains the music bed, but the game never starts it; only sound effects play.

## 11. Screens (decided 17 Nov 2026)

- The app opens on the **title screen**: Wren holding the lit lantern (animated, still under reduced
  motion), the name, and one big **Play** button in thumb reach. Once any cavern is lit, a line under
  Play counts them ("3 of 16 caverns lit").
- **Play** opens the **map** (choose a cavern, settings), after any story pages that are due (section 13).
  A cavern opens the **level** screen. The map's **Journal** button opens the **Field Journal**.
- Back (Android back button, or Escape): result panel or any open panel first, then level → map →
  title → leave the app; the Journal goes back to the map, and a story page closes its book (section 13).
  Enter or Space on the title plays.
- `?level=<id>` skips straight to that level; anything else in the URL still opens on the title.

## 12. Tutorials (decided 17 Nov 2026)

Teaching levels carry a `tutorial`: a short list of guided steps that run on a player's first visit.
They teach the controls and each new creature by pointing at things, never by playing for the player,
and never ask for a move the solution does not need.

- **When:** a level's tutorial runs when the level has never been solved (it is not in the save) and the
  **Tutorials** setting is on (the default). Solving a level, or switching the setting off, ends it.
- **Steps** run in order and only move forward. A step:
  ```js
  { say: 'Swipe to walk.',     // the line shown in the status row while the step is up (instead of the tip)
    point: 'wren',             // optional: what it points at, see below
    gesture: 'swipe-E',        // optional: 'swipe-N' | 'swipe-E' | 'swipe-S' | 'swipe-W' | 'tap' | 'hold', drawn at the point
    when: 'planted',           // optional: the step only shows while this holds: 'planted' | 'carried'
    card: 'S',                 // optional: opens that creature's rule card when the step comes up ("meet" card);
                               //   'A' opens the Shutter card, in a level with a shutter
    until: 'step' }            // what finishes the step, see below
  ```
- **point:** `'wren'`; `'lantern'` (the planted lantern); a species letter `M` `S` `T` `D` `K` `O` `R` (the first such
  creature in reading order, followed as it moves); `'bud'` (the first Glowbud not in bloom); `'root'`;
  `'gate'`; `[x, y]` (a tile); or a thumb-bar button `'plant'` (the lantern button), `'wait'`, `'undo'`,
  `'hint'`. A board point is a soft ring with the gesture drawn on it; a button point makes it pulse.
- **until:** `'move'` (any legal action), `'step'` (Wren walks), `'arrive'` (Wren stands on the `[x, y]`
  point), `'plant'`, `'pickup'`, `'wait'`, `'settle'` (a moth became a bridge), `'hide'`, `'wake'`,
  `'sleep'`, `'turn'`, `'ignite'` (an Emberwick catches), `'aim'` (the lantern is aimed or opened), `'glint'` (a Mirrorbeetle
  becomes lit), `'gate'` (a gate opens), `'bud'` (a Glowbud comes into bloom), `'card'` (the
  step's card was closed), `'solved'`. The events are the engine's (section 7).
- **Undo** never takes a step back. **Restart** goes back to the first step that is not a card step.
- **Stuck nudge:** on a level that has never been solved, with Tutorials on, once per visit: when the move
  count reaches par + 6 and the level is not solved, the Hint button pulses and the status row says
  "Stuck? Hint shows the next move, and Undo steps back." It goes away after a hint, an undo, a restart
  or four more moves.
- The **Tutorials** setting sits with the other settings on the map. Resetting progress brings every
  tutorial back, because the levels are no longer solved.
- `src/ui/tutorial.js` holds the step logic (no DOM), so it can be tested in Node. `checkTutorial(def)`
  lists what is wrong with a level's tutorial (unknown point, gesture or event; a species point or card the
  level does not have, or the Shutter card in a level without a shutter; `'arrive'` without an `[x, y]` point; a card step not finished by `'card'`).

## 13. Story and Field Journal (decided 17 Nov 2026)

The story is told in Wren's journal: short margin notes, first person, never full dialogue. Story pages
come between chapters, and the Field Journal keeps every page and a sketch of every creature met.

- **Story pages** live in `src/ui/story.js` (no DOM, tested in Node): a prologue, then one page for each
  chapter in `CHAPTERS`, in chapter order. A page is
  ```js
  { id: 'ch1',            // 'prologue', or 'ch' + the chapter id
    chapter: 1,           // 0 for the prologue
    title: 'The shadow at Mossmouth',   // at most 40 characters
    lines: ['...'],       // 1 to 4 margin notes, each at most 160 characters
    scene: { cast: ['wren', 'M'], gloam: 'near', root: null } }
  ```
  `scene.cast` lists who stands in the picture, left to right: `'wren'` (carrying the lit lantern) and
  species letters. `scene.gloam` is `null`, `'small'` (a young Gloamling, in a memory) or `'near'` (the
  Gloam, huge, at the right edge). `scene.root` is `null`, `'dim'`, `'bright'` (painfully flaring) or
  `'gentle'`: the Heartroot glowing behind them. Pictures are painted once into an image, like portraits,
  and have no faces either.
- **When a page unlocks:** the prologue at once; a chapter's page when the last level of that chapter is
  solved (in the save).
- **When pages show:** a page is **due** when it is unlocked and not yet seen. Due pages show, in order,
  as one little book, at two moments only: when Play is tapped on the title (before the map), and when a
  result panel is left by Next level, Map or Back (before going on). The prologue waits for Play, so a
  level opened straight from a link never starts with it. Replay never shows them. A page
  counts as seen as soon as it shows. The book's button reads "Next page" while more pages follow, then
  "Continue", which goes where the player was heading. Back or Escape closes the book at once: its
  remaining pages count as seen too, and stay readable in the Journal. A book of more than one page says
  "Page 2 of 3".
- **Field Journal** (from the map's Journal button): two tabs, **Creatures** and **Story**.
  - Creatures: one entry per species, in the order the chapters bring them in. A species is **met** once
    any level containing it is solved. A met entry shows its portrait, its name, "Met in <chapter name>",
    its rule card text (section 8) and Wren's own note about it from `src/ui/story.js`. An entry not met
    yet shows a dark blot and "Not met yet", with "Somewhere in <chapter name>." The heading counts
    "4 of 7 met".
  - Story: one entry per story page. An unlocked page shows its title and kicker ("Prologue", or
    "Chapter 1: Mossmouth") and opens the page to read again (its button reads "Back to journal").
    A locked page reads "Still dark" with "Light the last cavern of <chapter name> to read it."
- **Save:** the save gains `seen`, the ids of the story pages already shown. Reset progress clears it
  along with the levels, so the story starts over; settings are kept.
- **Text rules** (`checkStory(chapters)` lists what is wrong): every chapter has exactly one page and
  every species found in the levels has a note; ids are unique; titles and lines keep to their lengths;
  cast members are known; no story text or note uses he, she, him, her, his, hers, himself or herself.
- Turning to a story page plays `'page'`, a soft paper sound.
