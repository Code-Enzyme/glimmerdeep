# Glimmerdeep

A cosy puzzle game about light. Wren carries a lantern through a cave, and the creatures move
themselves: fluffmoths fly toward the light, shellwhelks creep away from it, stumpcaps only walk
while they are lit, dozer newts only wander in the dark, an emberwick kept in the light catches
and follows Wren as a second little light, a gloamling drifts after the lantern and eats the light
around it, and a mirrorbeetle turns the lantern's beam round corners once Wren learns to aim it.
You never push anything; you decide where the light is.

First visits are guided: the opening levels teach the controls by pointing at things, each new
creature is met through its rule card, and a stuck player is nudged toward Hint and Undo. The
Tutorials setting on the map turns all of that off. Holding anything on the board opens its field note,
and holding a creature also shows what it will do next turn if Wren waits (SPEC section 21).
The Comfort setting makes the reading text up to twice as big, swaps in a plain readable font, and
lets motion follow the phone, stay still, or stay on (SPEC section 22).
Every state shows by shape, brightness or motion, and where colour does tell two things apart (the gate
channels, the hint against a tutorial's pointer) a test checks it stays clear for protanopia,
deuteranopia and tritanopia (SPEC section 25).

A hint helps a step at a time: the first press names the key creature, the next shows the first move,
and the third lays out the whole way from where Wren stands, following along as it is played. One hint
pays for all three (SPEC section 18).

Between chapters Wren's journal tells the story: why the Heartroot is dimming, and what the Gloam
really is. The Field Journal on the map keeps every story page and a page for each creature met.

Chapter 1 is free. One payment, the Full Expedition, opens chapters 2 to 7 and the Night Garden, and Glimmer jars buy
instant hints; a free hint comes every ten minutes anyway. No ads, no energy, no lives. Release builds
sell through Google Play Billing (`android/.../BillingPlugin.java`); debug builds and browsers use a
free test store, so every purchase can be tried without a Play account (SPEC section 14).

Mossmouth, the first chapter, is played in order. From chapter 2 on, every lit cavern opens the three after
it, so a player stuck on one always has two others to try; a chapter still opens only once the chapter
before is finished (SPEC section 29, `src/ui/paths.js`).

The Daily Glimmer, the map's first card, is one cavern a day, the same for everyone on the same date:
light it to keep a streak going, and earn a Glimmer the first time each day. There are 365 caverns, so a cavern
comes back once a year; `dev/daily-grow.mjs` chose them from the level generator's finds. The Full Expedition opens
the last six days too, so a missed day can be mended (SPEC section 15).

Each chapter ends with a Gloam encounter: the Gloam's Hush creeps a tile a turn over every dark floor tile
beside it, and only light holds it back. If it reaches Wren, three moves go back (SPEC section 17).

After the story comes the Night Garden: thirty deep puzzles that mix every creature, all built round crystal
walls, which let light through but nothing that walks. It is part of the Full Expedition and opens once
the last chapter is lit and the chapters have earned 100 star moss (SPEC sections 19 and 20).

Every cavern earns up to three star moss: one for lighting it, one for doing it at or under par, and one
for its hidden Journal critter, a small faceless creature tucked into a dark nook. It peeks out while its
nook is lit; tap it (or press C) and Wren sketches it into the Field Journal's Critters tab. Where each
critter hides is chosen by `node tools/place-critters.mjs` (SPEC section 23).

Star moss also earns Wren's lantern new colours: Mossglow, Ember rose, Moonglass, Heartroot and
Gloamlight, chosen from the map's Lantern button. They only change how the light looks, never where it
reaches (SPEC section 24).

Once Mossmouth is lit, the map's Workshop opens: paint your own caverns tile by tile with the creatures
you have met, check them with the solver (which finds each cavern's par), play them, and share them as a
short code that anyone can type into Play a code. The code holds the whole cavern, so there is no server
and nothing anyone types is ever shown to anyone else; a cavern's name comes from two fixed word lists.
A code plays only when the solver lights it at exactly its par (SPEC section 26).

The Comfort sheet also holds the controls: four arrow buttons under the board for anyone who would rather
not swipe, a left-handed layout that mirrors a level's buttons, and a short, normal or long swipe
(SPEC section 27).

The board can be had in words. TalkBack reads the board's label, which is the whole board in words, and
hears each move as it happens ("Wren steps east. Fluffmoth flies, now one tile north. Wall to the north
and south, open to the east and west."). Board talk, on the Comfort sheet, speaks the same lines in the
phone's own voice (`android/.../SpeechPlugin.java`) and adds Describe to every cavern, which shows and says
the whole board. The words come from `src/ui/talk.js` (SPEC section 28).

Bramble, the Fluffmoth that follows Wren's lantern from the first cavern on, flutters beside the light on
every board once 1-1 is lit. It is never a piece: it hops when a turn makes a bridge or blooms a bud, loops
when a cavern is lit, shivers at a bumped wall, hides in Wren's hood when the Hush comes, and flies to each
hint. Comfort can keep Bramble home (SPEC section 31, `src/ui/bramble.js`).

After an update, Play shows the map and then What's new: the newest notes a player has not seen, at most
three, in a sheet that closes with Done. A new player sees none. The title's What's new button shows the
newest six any time. The notes live in `src/ui/news.js`, newest first (SPEC section 30).

The save lives in `localStorage`. In the Android app every save is also written to a file
(`android/.../SaveFilePlugin.java`), on disk before a purchase is confirmed, so an app swiped away right
after a purchase still has it when it opens again (SPEC section 16).

Android first, iOS later. The game is plain JavaScript drawn on a canvas, wrapped as a native app with
[Capacitor](https://capacitorjs.com/).

## Run it

```sh
npm ci
npx playwright install chromium   # once, for the browser checks
npm run build                     # -> dist/glimmerdeep.html, open it in any browser
npm run check                     # everything CI checks in a browser
```

Open `dist/glimmerdeep.html?unlock=1` to play any level without buying anything, or `?level=2-3` to jump
straight to one.

## The Android app

```sh
npm run android:sync              # build the game and copy it into android/
npx cap open android              # open in Android Studio, or:
cd android && ./gradlew assembleDebug
```

Needs JDK 21 and the Android SDK. CI builds a debug APK on every push; download it from the run's
artifacts (`glimmerdeep-debug-apk`) and install it with `adb install -r app-debug.apk`. All debug builds
share one key (`android/app/debug.keystore`), so a new build updates the old one and keeps the save.

## Where things are

| Path | What |
| --- | --- |
| `SPEC.md` | The rules contract: board, turn order, creatures, light, level format, module contracts |
| `docs/glimmerdeep-design.md` | The full game design document |
| `src/engine.js`, `src/solver.js` | Rules and the shortest-solution solver (pure) |
| `src/levels/` | The levels, by chapter (133 in seven chapters of 19, each ending with its Gloam encounter), and the Daily Glimmer's 365 caverns (`daily.js`) |
| `src/chars/glowmark.js` | Character art (faceless Glowmark style) |
| `src/sprites.js` | Tiles, darkness and icons |
| `src/audio.js` | Synthesised sound effects |
| `src/game.js`, `src/ui/` | Screens, input, saving, tutorials (`ui/tutorial.js`), the story and Field Journal (`ui/story.js`), the store's rules (`ui/shop.js`), the Daily Glimmer's date rules (`ui/daily.js`), the Workshop's rules and share codes (`ui/workshop.js`, `ui/codes.js`), the board in words (`ui/talk.js`), the order caverns open in (`ui/paths.js`), What's new (`ui/news.js`), Bramble's flight (`ui/bramble.js`), the app-shell bridge (`ui/native.js`) |
| `tools/` | Build, level verifier, icon maker |
| `dev/` | Browser and device checks, plus the level-design search scripts |
| `android/` | The Capacitor Android project |
| `store/` | Store listing assets |

## Working on it

Read `CLAUDE.md` first. CI is described in `docs/CI.md`.
