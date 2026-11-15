# Glimmerdeep (working title): Game Design Document

Nov 15, 2026 · @Umer

Glimmerdeep is a turn-based, touch-first light-and-creature puzzle game for Android (iOS later): you never push a block, you light the dark, and the cave's shy creatures move themselves in response. It borrows only genre conventions from the reference game and changes the verb, the world, the cast, the look and the business model.

## 1. Reference analysis

[The Electrifying Incident: A Monster Mini-Expedition](https://store.steampowered.com/app/3352300/The_Electrifying_Incident_A_Monster_MiniExpedition/) (Draknek and Friends, Apr 15 2025, $4.99, PC/Mac) is a short, isometric, cute sci-fi Sokoban. You explore a failing reactor facility and use one tool, a remote grabber arm, to lift and move boxes around live electricity and locked doors, under a meltdown framing. It runs 30 to 90 minutes and sits at 93% positive on Steam.

What its success tells us about the market: short, elegant, single-mechanic puzzle games with a cute monster cast sell, and players reward escalating complexity built from very few rules.

| Area | Reference game | Glimmerdeep |
| --- | --- | --- |
| Core verb | Grab and relocate boxes with a remote arm | Place and carry light; creatures react on their own |
| Objects | Inert boxes | Living creatures with simple, readable behaviours |
| Hazard | Live electricity, reactor meltdown pressure | Creeping darkness (the Hush) that eats light; no timer |
| Setting | Sci-fi industrial facility | Hand-painted fungal cave ecosystem under a mountain |
| Camera | Isometric 3D | Top-down 3/4 2D with dynamic 2D lighting |
| Length and platform | 30 to 90 min, PC/Mac premium | 6 to 10 hours, Android-first, free first chapter then one-time unlock |

We take only genre-level ideas, which are not protectable: grid-based turn puzzles, unlimited undo, a hub map, cute creatures. We take nothing specific: no grabber arm, no electricity or reactor, no facility, no isometric box look, no monster designs, no names, no music, no level layouts.

As of this date the Steam page was read directly; nothing on it was copied beyond the short quoted tagline for reference.

## 2. High-level concept

**Pitch:** "Light the way, and the cave moves for you." Wren, an apprentice lamplighter, descends into Glimmerdeep to rekindle the dying Heartroot. Every puzzle is solved by deciding where light falls, because each cave creature reacts to light in its own way.

**Unique selling points**

1. **Indirect control.** You never shove objects. You place, carry and shade light, and creatures follow, flee, freeze or wake. Puzzles feel like herding a tiny ecosystem, not moving furniture.
2. **Creatures are the puzzle pieces.** Seven species, each with one rule a child can read from its face. Combining two species creates the late-game depth.
3. **Light as geometry.** Light spreads in a fixed radius and is blocked by walls and by creatures, so shadows are part of the board.
4. **Kind conflict.** No combat. The antagonist is a frightened creature you learn to understand, which suits a broad audience and app-store age ratings.
5. **Built for a phone.** Levels take 1 to 5 minutes, play in portrait with one thumb, and resume instantly.

**Core loop**

1. Enter a cavern on the map and read the board (2 to 10 seconds).
2. Move Wren and set the lantern down or pick it up; each move is one turn and every creature responds.
3. Undo freely, or restart, until every Glowbud is lit (the level goal).
4. Earn the cavern's star moss (solved, under par, secret creature found) and fill in a Field Journal page.
5. Unlock the next tunnel, a new species or tool, and return to step 1.

**Meta loop:** chapters (caves) each introduce one species and end with a set-piece "Gloam" encounter. Optional Deep Puzzles reward mastery; the Journal and Wren's lantern cosmetics reward completion.

**Target audience**

| Segment | Profile | What they want |
| --- | --- | --- |
| Primary | Adults 22 to 45 who play premium-style puzzlers on phone (Monument Valley, Baba Is You, Mini Metro players) | Clever rules, no timers, no pay-to-win |
| Secondary | Cozy players 16 to 35 drawn by cute creatures | Calm mood, collection, short sessions |
| Tertiary | Families, kids 8+ with a parent | Safe, readable, no ads in play |

**Tone:** warm, curious and quietly funny, with a hint of melancholy at the edges of the dark. Think a bedtime story told by a naturalist.

**Genre positioning:** a mid-length premium logic puzzler with cozy presentation. It sits between bite-sized PC Sokobans like the reference and big hybrid casual games. Against the reference it is longer, mobile-native, creature-driven instead of box-driven, and organic instead of industrial.

## 3. Mechanics breakdown

The whole game runs on one deterministic rule: after every player move, light is recalculated, then each creature takes exactly one step according to its species rule. Everything else is content built on that.

**Turn order (fixed, so every puzzle is predictable)**

1. Wren moves one tile, or places or picks up the lantern (one action).
2. Light recalculates: each light source lights tiles within its radius by line of sight; walls and creatures cast shadow.
3. Creatures act in reading order (top-left to bottom-right), each one step.
4. Goal check: all Glowbuds lit means the level is solved. Wren in a Hush tile with no light means a soft fail (undo one step).

### Movement

- Square grid, 5 to 9 columns wide so it fits portrait without scrolling; larger caverns pan.
- Wren moves orthogonally one tile per turn. Swipe to step, or tap a tile to auto-walk the shortest safe path (each tile still counts as a turn).
- Wren cannot push anything. Creatures block Wren unless a species rule says otherwise.

### Light (the core system)

| Source | Radius | Unlocked | Notes |
| --- | --- | --- | --- |
| Wren's lantern (carried) | 1 | Chapter 1 | Light moves with Wren |
| Lantern (planted) | 2 | Chapter 1 | Planting trades mobility for reach; only one lantern |
| Shutter | 0 to 2 | Chapter 3 | Tap to aim a one-direction beam of 4 tiles |
| Spark seed | 1 | Chapter 4 | Consumable on a level, burns for 6 turns |
| Glowing creature | 1 | Chapter 5 | A lit Emberwick glows and becomes a moving light |

### Creatures (the puzzle pieces)

| Species | Rule | Puzzle role |
| --- | --- | --- |
| Fluffmoth | Steps one tile toward the nearest light | Lure, bridge over gaps when it settles into a Puddle |
| Shellwhelk | Lit: hides in shell and becomes solid. Dark: steps away from the last light | Temporary wall or stepping stone |
| Stumpcap | Sleeps in dark; lit: walks straight in its facing until blocked | Heavy, presses pressure roots, opens gates |
| Dozer newt | Lit: falls asleep and blocks; dark: wanders clockwise | Patrol you pause with light |
| Mirrorbeetle | Reflects any beam that hits its shell 90 degrees | Light routing |
| Emberwick | Dark: still. Lit for 2 turns: ignites and glows radius 1, follows Wren | Portable second light |
| Gloamling | Eats light: tiles next to it are always dark | Moving shadow, the Hush made flesh |

No creature can be hurt. A creature that ends in a Hush pool simply curls up and blocks until lit again.

### Combat replacement: Gloam encounters

There is no combat. Each chapter ends with a larger Gloam encounter, a multi-room puzzle where the Gloam's shadow advances one tile per turn. You calm it by lighting the Glowbuds around it in an order that reveals its memory (a story beat). Rationale: keeps the game nonviolent, family-rated and on-theme, and gives a climax without reflex demands, which play poorly on touch.

### Puzzle elements

- **Glowbuds:** the goal, buds that must all be lit at once.
- **Pressure roots:** gates open while something heavy (a Stumpcap or a hiding Shellwhelk) stands on them.
- **Puddles:** a Fluffmoth that lands on one floats and becomes a bridge.
- **Hush pools:** permanent darkness; light cannot enter; Wren may cross only with the lantern in hand.
- **Crystal walls:** let light through but block bodies.

### Progression

- 6 chapters, 20 to 24 caverns each (about 130 levels), plus 30 Deep Puzzles. New species every chapter; old species recombine.
- Star moss (3 per level: solve, at or under par, find the hidden Journal critter) unlocks Deep Puzzles and lantern skins. It never gates the main path.
- Field Journal: a sketch page for each species and each Gloam memory, the long-term collection hook.
- Unlimited undo and restart, plus a 3-tier hint (highlight the key creature, show the first move, show the full solution). Hints are free on a cooldown and instant with Glimmer (see monetization).

### Why these choices

- Indirect control is the clearest break from Sokoban box-moving and from the reference's grabber arm, and it is rare in mobile puzzlers.
- Creatures with one rule each keep the rules learnable in a single screen, which matters on small screens and short sessions.
- Fixed turn order and unlimited undo keep the game fair and make every level machine-solvable, so we can verify par automatically (as Squirm already does with its solver tests).
- Swipe plus tap-to-path suits one-thumb portrait play better than precise drags.

## 4. Narrative and worldbuilding

**Setting:** Glimmerdeep is a living cave system under the mountain town of Wickmoor. Everything down there glows: moss, mushrooms, beetles. The light all comes from the Heartroot, a vast luminous tree root at the bottom of the world. Wickmoor's lamplighters have tended it for generations by carrying its light upward. This season the Heartroot is dimming, and a creeping darkness the townsfolk call the Hush is rising tunnel by tunnel.

**Protagonist: Wren Tallowby**, 12, the youngest apprentice lamplighter. Curious, a little clumsy, keeps a sketch journal (the Field Journal is literally hers). Wren is drawn round and small with an oversized lantern, a woollen hood and boots, so the silhouette reads at 48 px. Wren never speaks in full dialogue; thoughts appear as sketch-margin notes, which keeps localization cheap.

**Companion: Bramble**, a Fluffmoth who imprints on Wren's lantern in level 1. Bramble flutters around the lantern, reacts to good and bad moves, and acts as the in-game hint giver.

**Antagonist: the Gloam**, a huge shadow creature living near the Heartroot, believed by Wickmoor to be devouring the light. The twist across the chapters: the Gloam is a very old Gloamling, born in the dark, who is hurt by bright light. Over-harvesting by the lamplighters drove the Heartroot to flare painfully, so the Gloam has been smothering it to survive. It is a frightened creature, not a villain.

**Secondary antagonist: Warden Sootley**, head of the Lamplighters' Guild, who wants to drag the Heartroot's last light up to town. Sootley is not evil, just certain. Sootley appears only in Journal notes and short cutscenes, and is the human mirror of the theme.

**Themes:** fear of the dark versus understanding it; taking only what you need; light as care, not conquest. The resolution is balance: Wren finds a way for town and cave to share light, which gives the ending its warmth.

**Episode flow**

| Chapter | Cave | New species or tool | Story beat | Gloam encounter |
| --- | --- | --- | --- | --- |
| 1 | Mossmouth | Fluffmoth, lantern planting | Wren descends, meets Bramble, sees the Hush for the first time | The Gloam's shadow chases Wren out of a cavern |
| 2 | Whelk Grottos | Shellwhelk, pressure roots | Finds old lamplighter tools and Sootley's warnings | First memory: the Gloam as a small Gloamling |
| 3 | Stumpwood | Stumpcap, shutter beams | Mushroom forest; the Hush is retreating where light is balanced | The Gloam flinches from Wren's beam |
| 4 | Newt Flats | Dozer newt, spark seeds | Underground lake village of newts who live in the dark | Memory: the Heartroot's painful flare |
| 5 | Beetle Vaults | Mirrorbeetle, Emberwick | Old Guild machinery that over-harvested light | Sootley arrives; conflict over the root |
| 6 | The Heartroot | Gloamlings, all combined | Wren must light the root gently, not brightly | The Gloam and Wren calm the root together |

**Hooks**

- Every chapter ends on a reveal in the Gloam's memory, so each chapter clear makes players want the next.
- Hidden Journal critters (one per level) add a second layer of discovery, and their notes hint at lore.
- The free first chapter ends with the Gloam's first memory beat, which is the natural paywall cliffhanger.
- Post-game: the Night Garden, a bonus area where Deep Puzzles live and the Gloam visits.

## 5. Art and audio direction

**Art style: "lantern-lit gouache."** Hand-painted 2D tiles and sprites on a top-down 3/4 view, with soft paper grain and visible brush edges. The darkness is real: the board is painted fully lit, then a dynamic 2D lighting pass (normal-mapped sprites, radial light masks) reveals it. Light is the mechanic, so the renderer makes light the star. This is deliberately far from the reference's clean isometric 3D sci-fi geometry.

**Palette**

| Role | Colour | Hex | Use |
| --- | --- | --- | --- |
| Lit warm | Lantern amber | #F2B04C | Wren's light, UI accents |
| Lit cool | Moss teal | #5FBFA8 | Bioluminescent flora, Glowbuds |
| Midtone | Mushroom rose | #C97A8A | Creatures, highlights |
| Shadow | Deep plum | #2B1E3A | Unlit floor, background |
| Hush | Ink violet-black | #120C1C | The Hush and Gloamlings, always with a faint shimmer outline |
| Paper | Journal cream | #F4EAD5 | Menus, Journal |

Each chapter shifts the cool accent (teal, coral, lime, aqua, gold, white-gold) so caves feel distinct at a glance.

**Character and creature design principles**

1. One shape, one rule: each species has a silhouette that hints at its behaviour (Shellwhelk is a spiral, Stumpcap is a rectangle, Fluffmoth is a soft circle with wings).
2. Readable at 48 dp, with two-frame idle animation and a clear facing indicator where facing matters.
3. State must be visible without colour: a hiding Shellwhelk closes its shell, a sleeping newt shows "z" bubbles, an ignited Emberwick has a flame shape.
4. Faces express reaction to light (squint, delight, fear), which teaches the rules without text.
5. Inspired by real cave fauna and fungi (glowworms, cave salamanders, foxfire), not by any existing game's monsters.

**UI:** sketch-journal style, with hand-lettered headings, cream paper panels, thumb-zone buttons at the bottom (undo, restart, hint), and nothing interactive in the top 15% of the screen.

**Audio approach**

- **Music:** an adaptive chamber score of kalimba, celesta, nylon guitar, bowed glass and soft cello. Each chapter has one theme built from stems; stems add as more Glowbuds are lit, so the music "lights up" with progress. No electronic or synth-industrial textures (which belong to the reference's sci-fi setting).
- **Creature voices:** small, wordless foley (wood clicks, wet chirps, shell taps), recorded from real objects and processed, one signature sound per species, played on its move so players can hear the turn resolve.
- **The Hush:** low granular drone with breath-like swells; it gets quieter, never louder, as you push it back.
- **Feedback:** each lit Glowbud plays the next note of a pentatonic phrase; solving completes the phrase. Undo plays a soft reversed version.
- **Haptics (Android vibration API):** light tick on step, double tick on a Glowbud, longer soft pulse on solve. All optional.
- All music and SFX are commissioned as work-for-hire with full buyout, or from royalty-free libraries with commercial licences on file.

## 6. Level and encounter design

Every level teaches, tests or twists exactly one idea, and every shipped level is verified by an automated solver to solve at its par.

Legend for the layouts below: `W` Wren (carrying the lantern), `G` Glowbud, `M` Fluffmoth, `S` Shellwhelk, `T` Stumpcap (arrow shows facing), `~` Puddle, `R` pressure root, `|` gate, `#` wall, `.` floor.

### Sample 1: "First Light" (1-1, teach the lure)

```
# # # # # # # # #
# W . . ~ . . G #
# # # # M # # # #
# # # # # # # # #
```

Wren cannot cross the Puddle. Stepping right lights the Puddle, the Fluffmoth flutters toward the light, lands in the Puddle and becomes a bridge. Wren crosses and lights the Glowbud. Par 5 moves. Lesson: creatures react to light; you never touch them. No text needed beyond a swipe hint.

### Sample 2: "Shell Game" (2-6, test planting)

```
# # # # # # # # #
# W . . . . . . #
# . # # R # # . #
# . # S . # # | #
# . . . . . # G #
# # # # # # # # #
```

The gate opens only while something heavy stands on the root. The Shellwhelk retreats from light, so walking straight at it pushes it the wrong way. The intended solution: plant the lantern on the far side so the Shellwhelk backs onto the root, then walk around while it is dark, which keeps it there; the moment Wren's carried light reaches it again, it hides and stays put as a weight. Lesson: planted versus carried light, and creatures that flee.

### Sample 3: "Stop the Stump" (3-14, twist two species)

A Stumpcap faces east in a long corridor with a root halfway along. Lit, it walks until blocked, overshooting the root. A Shellwhelk sits in a side alcove. The player must first lure the Shellwhelk into the corridor just past the root (by darkness), then light both at once with a shutter beam: the Shellwhelk hides and becomes a wall, the Stumpcap walks and stops exactly on the root. Lesson: one creature as the tool for another.

### Sample encounter: "The Gloam Wakes" (1-24)

Three connected rooms. The Gloam's Hush advances one column per turn from the west, but cannot enter lit tiles. Wren must plant the lantern to hold a choke point, run ahead in the dark to set up a Fluffmoth bridge, then return for the lantern before the Hush passes the room. Lighting the final three Glowbuds in order plays the Gloam's first memory. There is no fail state beyond being caught (rewind 3 turns), and the encounter auto-offers a hint after two catches.

Samples 2 and 3 and the encounter are illustrative of intent; their exact layouts and pars get fixed by the solver during prototyping.

### Pacing within a chapter (22 levels)

1. Introduce (levels 1 to 3): new element alone, near-zero failure.
2. Develop (4 to 11): new element against the existing toolset.
3. Twist (12 to 17): a surprising consequence of the rule (Shellwhelks as a timer, moths blocking light).
4. Master (18 to 21): longer puzzles, one optional "aha" each.
5. Encounter (22): story set piece, moderate difficulty, high spectacle.

A "breather" level follows every hard level. Target median solve time rises from about 40 seconds in chapter 1 to about 4 minutes in chapter 6; Deep Puzzles run 5 to 15 minutes.

### Difficulty curve controls

- Analytics on solve rate, hint use and undo count per level from the first closed test. Any level under 70% completion (main path) gets reworked or moved later.
- Solver metrics (minimum moves, branching factor, number of distinct solutions) give a difficulty score so levels can be sorted before playtest.
- Optional paths: from chapter 2 the map branches, so a stuck player always has two or three other caverns open.

### Replayability

- Three star moss per level: solve, at or under par, find the hidden Journal critter.
- Deep Puzzles (30) in the Night Garden for experts.
- Daily Glimmer: one curated puzzle a day from a pool of 365 designer-reviewed levels (generated, solver-verified, then hand-picked), with a streak counter and no penalty for missing days.
- Later: a level editor with share codes (see roadmap), giving a long tail of community levels.

## 7. Technical specs

**Recommendation: Godot 4 (stable LTS-style release at production start), 2D renderer, GDScript for presentation and a pure, headless rules engine with its own unit tests.** It exports to Android and iOS from one project, has no royalties or runtime fees, has a strong built-in 2D lighting system (the core of our look), and keeps builds small.

| Option | For | Against | Verdict |
| --- | --- | --- | --- |
| Godot 4 | Free, MIT licence, great 2D lights and shaders, small exports, Android and iOS export | Smaller mobile plugin ecosystem (billing and ads need community or first-party plugins) | Recommended |
| Unity 6 | Mature mobile tooling, ads and IAP SDKs built in | Licence cost at revenue thresholds, heavier builds, past pricing volatility | Strong fallback |
| Kotlin + Compose Multiplatform | Reuses the Squirm stack, tests and CI already in this project | Custom lighting and particles are hand-built; iOS Compose is less proven for games | Only if we want to share Squirm code |

**Architecture:** the rules engine (grid, light, creature rules, undo stack, solver) is plain code with no engine dependencies, mirroring how Squirm keeps rules in `engine/`. It is test-first: every level has an automated test that it solves at par and that its featured creature is necessary. The Godot layer only draws state and forwards input.

**Platforms and targets**

| Item | Target |
| --- | --- |
| Android launch | minSdk 24 (Android 7.0), targetSdk at Google Play's current required level (API 36 in 2026) |
| iOS (phase 2) | iOS 16+, iPhone and iPad; needs a Mac build machine and Apple Developer Program |
| Orientation | Portrait first; tablets get landscape with side panels |
| Frame rate | 60 fps on mid-range (Snapdragon 6-series class), 30 fps floor on low-end (2 GB RAM, Adreno 610 or Mali-G52 class) |
| Renderer | Godot Compatibility renderer (OpenGL ES 3.0) for widest reach; Mobile (Vulkan) as an opt-in later |
| Download size | Base AAB under 150 MB (Play limit 200 MB); later chapters via Play Asset Delivery if needed |
| Memory | Under 350 MB resident |
| Cold start | Under 3 seconds to the map on mid-range |
| Battery | Low-processor mode between turns, so an idle board draws near zero frames |
| Offline | Fully playable offline; cloud save via Play Games Services (Android) and iCloud or Game Center (iOS) |

**Control scheme (touch)**

- Swipe anywhere: Wren steps one tile in that direction.
- Tap a tile: auto-walk the shortest path; a ghost path previews before committing on long walks.
- Tap Wren: plant or pick up the lantern. Tap a shutter: rotate its beam.
- Bottom bar in the thumb zone: Undo (also two-finger tap or swipe-back gesture), Restart (hold to confirm), Hint.
- Hold on any creature: shows its rule card and a one-turn preview of what it will do.
- Optional on-screen D-pad, and full gamepad and keyboard support for Chromebooks and tablets.

**Accessibility**

- No timers anywhere; encounters rewind instead of failing.
- Colourblind-safe by design: every state is shown by shape and animation, plus three colour presets (deuteranopia, protanopia, tritanopia) tested with simulators.
- High-contrast mode that brightens dark tiles and outlines all creatures, so the darkness never hides information.
- Text size up to 200%, dyslexia-friendly font option, all text in short margin notes.
- Reduce motion, screen-shake off, flashing off (Hush shimmer becomes static).
- Left-handed UI mirror; one-hand mode; adjustable swipe sensitivity.
- TalkBack and VoiceOver support for menus, plus an optional spoken board description in levels ("Fluffmoth two tiles north").
- Haptics and sound cues are always paired with a visual cue, and vice versa.

## 8. Monetization and launch

**Model: free to download, Chapter 1 free, one-time "Full Expedition" unlock at $4.99** (regional pricing via Play's price templates, roughly $1.99 to $2.99 in lower-income markets). This is the same premium-unlock shape already planned for Squirm, so the billing code, store listing patterns and test setup can be reused. No energy, no lives, no interstitial or banner ads.

| Product | Type | Price (USD) | Contents |
| --- | --- | --- | --- |
| Full Expedition | Non-consumable | 4.99 | Chapters 2 to 6, Deep Puzzles, Daily Glimmer archive |
| Glimmer jar (small) | Consumable | 0.99 | 10 instant hints (hints are also free on a 10-minute cooldown) |
| Lantern styles | Non-consumable | 1.99 each or 4.99 bundle | Cosmetic lantern and light colours |
| Supporter pack | Non-consumable | 9.99 | Full Expedition, all lantern styles, digital art book and soundtrack |
| Rewarded video | Opt-in ad | Free | One instant hint, max 5 a day; never in the first 10 levels |

**Why this model:** premium puzzle players resent ads and energy; a free chapter removes the download barrier that a paid app has on Android; the unlock lands at a story cliffhanger (Section 4); and a clean model qualifies the game for Google Play Pass and Apple Arcade style curation, featuring and family audiences. Expected conversion for this shape is roughly 2 to 5% of installs (an assumption to validate in closed testing).

**DLC and expansion roadmap**

| When | Release | Price | Notes |
| --- | --- | --- | --- |
| Launch + 3 months | "The Night Garden" free update | Free | 30 more Deep Puzzles, new Journal pages; retention and review bump |
| Launch + 6 months | iOS launch | Same model | Universal purchase across iPhone and iPad |
| Launch + 8 months | "Frostvein" expansion | 2.99 | Ice caves, 2 new species (frost refraction), 40 levels |
| Launch + 12 months | Level editor and share codes | Free | Community levels, curated weekly picks |
| Launch + 15 months | "The Sky Wells" expansion | 2.99 | Light from above through shafts; day and night cycle |
| Later | PC (Steam) and Switch port | 9.99 to 12.99 | Only after mobile proves the IP |

**Marketing hooks**

- The 6-second GIF: a dark board, one lantern placed, five creatures waking and shuffling into a solution. Light-reveal moments are perfect short-form video.
- "A puzzle game where you never push anything" as the headline.
- The kind antagonist and the "take only what you need" theme for press and family-gaming outlets.
- Accessibility as a feature: no timers, colourblind-safe, high-contrast darkness.
- Creature collectibles: stickers, plushies and wallpapers later.

**Launch plan**

1. Months -6 to -3: store page with pre-registration on Google Play; devlog on TikTok, YouTube Shorts and Reddit (r/AndroidGaming, r/puzzlevideogames, r/IndieGaming); Discord opens.
2. Months -3 to -1: closed test (also satisfies Play's 12-testers-for-14-days rule for personal developer accounts); press kit; submit to Google Indie Games Accelerator or Festival if the timing fits; pitch Play Pass and editors.
3. Launch week: pre-registration rewards (a free lantern style), soft launch first in 2 to 3 English-speaking test markets for 4 weeks, then global.
4. Post-launch: monthly Daily Glimmer themes, a puzzle-of-the-week on social, update every 6 to 8 weeks for the first 6 months.

**Community engagement**

- Discord with a #solutions-spoiler channel, a weekly community-made puzzle (from the editor once it ships) and dev Q&A.
- Players name a hidden Journal critter in each expansion.
- Public roadmap and short patch notes in game.
- Creator kit for YouTubers and streamers: early builds, clip-friendly levels, a no-claim music licence.
- Respond to every Play review in the first 3 months; track sentiment weekly.

## 9. Legal and IP safeguards

Game mechanics and genres are generally not protected by copyright, but names, characters, art, music, text, level layouts and trade dress are. The checklist below keeps Glimmerdeep clearly on the safe side. It is a design-level checklist, not legal advice; budget a short review by a games IP lawyer before launch.

**Differentiation**

- [ ] Core verb is light placement, never grabbing, pushing or remote-moving boxes.
- [ ] No electricity, reactor, meltdown, facility, sci-fi or alien themes anywhere.
- [ ] No isometric box-world look; art is top-down hand-painted 2D.
- [ ] Every creature designed from real-world cave fauna references, with a mood board on file showing sources.
- [ ] No reference-game screenshots, sprites or audio in our repos, mood boards or pitch deck (link the store page only in the analysis section).
- [ ] Level designers do not play the reference game while authoring levels; every level is designed from our own rules and verified by our solver.
- [ ] Store copy never names or compares to the reference game or its studio.

**Names and trademarks**

- [ ] Clearance search for "Glimmerdeep" and any final title on USPTO (TESS), EUIPO, WIPO Global Brand Database, Google Play, App Store and Steam, in classes 9 and 41.
- [ ] Avoid "Expedition", "Monster" and "Incident" in the title to stay away from the reference's naming.
- [ ] Check domain and social handles, then file a trademark in core markets once the name is final.
- [ ] Also check the name and species names against existing games in this project's own portfolio (Squirm uses "Full Burrow"; we use "Full Expedition" only as a store product name, which can change).

**Ownership of assets and code**

- [ ] Work-for-hire or IP assignment contracts with every contractor (art, music, SFX, writing, localization) before work starts.
- [ ] Music commissioned with full buyout, including streaming and video-platform rights; register the soundtrack with a content ID service only after confirming it will not flag creators.
- [ ] Fonts licensed for app embedding; asset-library licences saved in the repo.
- [ ] Third-party code limited to permissive licences (MIT, BSD, Apache 2.0); a licence notices screen in the app.
- [ ] No AI-generated final art or audio unless the tool's terms grant commercial rights and the store's disclosure rules are met.

**Platform and privacy compliance**

- [ ] Google Play Families policy review if targeting under-13s; otherwise rate 13+ or "Everyone" via IARC and keep ads out of child audiences.
- [ ] Privacy policy, Data Safety form (Play) and privacy nutrition labels (App Store) matching the analytics and ad SDKs actually used.
- [ ] GDPR and CCPA consent flow for analytics and rewarded ads; UMP or equivalent consent SDK.
- [ ] Loot boxes: none. All purchases show exactly what you get.
- [ ] EULA and terms for the in-game editor's user-generated content, with a report button and moderation plan before share codes launch.

## 10. Deliverables and timeline

Android launch is planned 12 months from kickoff, with iOS about 4 months after. Each phase ends at a go or no-go gate, so money is only committed once the previous risk is retired.

### Phased roadmap

| Phase | Weeks | Deliverable | Gate to pass |
| --- | --- | --- | --- |
| 0. Paper and greybox | 1 to 4 | Rules engine with tests, solver, 15 greybox levels, tap and swipe controls on a phone | 8 of 10 testers say lighting creatures is fun and understood without text |
| 1. Vertical slice | 5 to 14 | Chapter 1 at final quality (22 levels plus encounter), art and audio targets, Bramble hints, analytics | 60% of closed testers finish Chapter 1; pitch deck and trailer ready for partners |
| 2. Alpha (content-complete) | 15 to 32 | All 6 chapters greyboxed and solver-verified, monetization and cloud save, accessibility options | Every level passes the par test; median session 8+ minutes |
| 3. Beta | 33 to 44 | Final art and audio, localization, closed test (12+ testers for 14 days), soft launch in 2 to 3 markets | Day-1 retention 40%+, day-7 15%+, crash-free sessions 99.5%+, conversion 2%+ |
| 4. Android launch | 45 to 52 | Global release, launch marketing, first patch | Store rating 4.5+ |
| 5. iOS port | 53 to 68 | iOS build, App Store listing, universal purchase | App Review pass, parity with Android |

### GDD outline (living document)

1. Vision and pillars
2. Rules spec (turn order, light model, every species rule with edge cases)
3. Level catalogue (id, featured idea, par, difficulty score, status)
4. Narrative bible (characters, chapter beats, all text strings)
5. Art bible (palette, shape language, lighting rules, UI kit)
6. Audio bible (stems, species sounds, mix rules)
7. Technical design (architecture, save format, platform services, performance budgets)
8. Monetization and analytics spec (products, events, funnels)
9. Accessibility spec
10. Live ops and roadmap

### Asset list (launch scope)

| Category | Count | Notes |
| --- | --- | --- |
| Levels | about 132 main + 30 Deep + 365 Daily | Daily pool can be partly generated, then curated |
| Tile sets | 6 (one per chapter), about 40 tiles each | Hand-painted with normal maps |
| Creatures | 7 species x 5 to 8 animation states | Idle, move, react-to-light, special state, sleep, Journal pose |
| Characters | Wren (12 states), Bramble (8), the Gloam (6 set pieces), Sootley (3 portraits) |  |
| Cutscenes | 7 short storyboard-style scenes | Animated stills with parallax, 20 to 40 s each |
| UI | About 25 screens | Map, level, pause, shop, Journal, settings, accessibility |
| Journal pages | About 20 species and memory pages + 130 hidden critter sketches | Small spot illustrations |
| Music | 6 chapter themes with 4 stems each, map theme, title, credits | About 35 minutes total |
| SFX | About 120 | 7 species signatures, UI, ambience per cave |
| Text | About 6,000 words | Mostly short margin notes |
| Store assets | Icon, feature graphic, 8 screenshots, 30 s trailer, 3 short-form clips | Per platform sizes |

### QA plan

- **Automated:** unit tests on every rule; every level must solve at exactly its par and its featured element must be necessary (solver tests, as in Squirm); save and load round-trip tests; CI runs them on every push.
- **Device matrix:** about 12 Android devices (low, mid and high tier, Samsung, Xiaomi, Oppo, Pixel, a tablet, a foldable, a Chromebook) via Firebase Test Lab plus physical devices.
- **Performance:** frame time, memory and cold-start budgets checked on the low-end device every milestone.
- **Playtests:** weekly 5-person blind tests during phases 0 to 2, recorded; analytics funnels during closed test.
- **Compliance:** Play pre-launch report, billing test purchases with licence testers, accessibility audit with TalkBack.
- **Localization QA:** in-context screenshots reviewed by native speakers, text overflow checks at 200% text size.

### Localization

With about 6,000 words and a mostly wordless story, localization is cheap: about $600 to $900 per language at professional rates. Launch languages (10): English, Spanish (LatAm), Portuguese (Brazil), French, German, Japanese, Korean, Simplified Chinese, Indonesian, Turkish. Add Russian, Italian, Arabic (right-to-left UI), Hindi and Urdu in a post-launch update. Strings live in one CSV from day one; no text is baked into art.

### Team roles and budget

Two scenarios for 12 months to Android launch. The lean scenario assumes a small team at South Asian rates with contractors; the Western scenario assumes typical US and EU indie rates. Both are rough estimates for planning, not quotes.

| Role | Allocation | Lean (USD) | Western (USD) |
| --- | --- | --- | --- |
| Creative director and lead designer (producer) | 1.0 for 12 months | 24,000 | 110,000 |
| Gameplay and engine programmer | 1.0 for 12 months | 24,000 | 120,000 |
| 2D artist (tiles, creatures, UI) | 1.0 for 10 months | 15,000 | 75,000 |
| Animator (contract) | 0.5 for 8 months | 5,000 | 25,000 |
| Level designer | 0.5 for 8 months | 6,000 | 30,000 |
| Composer and sound designer (contract, buyout) | Fixed fee | 6,000 | 25,000 |
| QA (contract and device lab) | 4 months part time | 4,000 | 15,000 |
| Localization (10 languages) | Fixed | 8,000 | 8,000 |
| Marketing (trailer, UA test, PR, creators) | Fixed | 10,000 | 40,000 |
| Legal, trademark, accounts, tools | Fixed | 4,000 | 12,000 |
| Contingency 15% |  | 15,900 | 69,000 |
| **Total** |  | **about 122,000** | **about 529,000** |

The iOS port adds about 3 to 4 months of one programmer plus QA and a Mac: roughly $12,000 lean or $50,000 Western.

## 11. Recommendations and next steps

The biggest risk is whether indirect control through light feels clever or frustrating on a phone, so the first four weeks should answer only that.

**Top risks and mitigations**

| Risk | Mitigation |
| --- | --- |
| Creature behaviour feels random | Fixed turn order, hold-to-preview a creature's next step, rule cards |
| Darkness hides information on small screens | High-contrast mode on by default for the first chapter's tutorials; outlines on all creatures |
| Too few players convert after Chapter 1 | Cliffhanger at the paywall, tune the free chapter's length in soft launch |
| Scope creep in species | Hard cap of 7 species at launch; new species only in paid expansions |
| Name conflict | Trademark search before any public posting |

**Immediate steps (next two weeks)**

- [ ] Lock the working title after a quick trademark and store search.
- [ ] Build a single-file HTML prototype of the rules (matching this project's other POCs) with 10 levels, to test the core feel on a phone browser in days, not weeks.
- [ ] Write the rules spec and solver test-first, so levels are verified from the start.
- [ ] Commission 3 creature concept sheets and one painted mock screenshot for the pitch.
- [ ] Run a 5-person blind playtest of the HTML prototype and decide the Phase 0 gate.
- [ ] Choose Godot (recommended) or the Squirm Kotlin stack before Phase 1.
