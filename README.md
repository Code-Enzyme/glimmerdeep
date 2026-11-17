# Glimmerdeep

A cosy puzzle game about light. Wren carries a lantern through a cave, and the creatures move
themselves: fluffmoths fly toward the light, shellwhelks creep away from it, stumpcaps only walk
while they are lit, dozer newts only wander in the dark, an emberwick kept in the light catches
and follows Wren as a second little light, a gloamling drifts after the lantern and eats the light
around it, and a mirrorbeetle turns the lantern's beam round corners once Wren learns to aim it.
You never push anything; you decide where the light is.

First visits are guided: the opening levels teach the controls by pointing at things, each new
creature is met through its rule card, and a stuck player is nudged toward Hint and Undo. The
Tutorials setting on the map turns all of that off.

Between chapters Wren's journal tells the story: why the Heartroot is dimming, and what the Gloam
really is. The Field Journal on the map keeps every story page and a page for each creature met.

Android first, iOS later. The game is plain JavaScript drawn on a canvas, wrapped as a native app with
[Capacitor](https://capacitorjs.com/).

## Run it

```sh
npm ci
npx playwright install chromium   # once, for the browser checks
npm run build                     # -> dist/glimmerdeep.html, open it in any browser
npm run check                     # everything CI checks in a browser
```

Open `dist/glimmerdeep.html?unlock=1` to play any level, or `?level=2-3` to jump straight to one.

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
| `src/levels/` | The levels, by chapter (36 in seven chapters) |
| `src/chars/glowmark.js` | Character art (faceless Glowmark style) |
| `src/sprites.js` | Tiles, darkness and icons |
| `src/audio.js` | Synthesised sound effects |
| `src/game.js`, `src/ui/` | Screens, input, saving, tutorials (`ui/tutorial.js`), the story and Field Journal (`ui/story.js`), the app-shell bridge (`ui/native.js`) |
| `tools/` | Build, level verifier, icon maker |
| `dev/` | Browser and device checks, plus the level-design search scripts |
| `android/` | The Capacitor Android project |
| `store/` | Store listing assets |

## Working on it

Read `CLAUDE.md` first. CI is described in `docs/CI.md`.
