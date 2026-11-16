# Working on Glimmerdeep

- Test first, always: write a failing test, make it pass, then refactor. Rules go in `test/*.test.js`
  (node:test); anything you can only see in a browser goes in `dev/ui-check.cjs`; anything that needs the
  real app goes in `dev/device-check.cjs`.
- Never skip, disable or delete a test or a check to get green.
- `SPEC.md` is the rules contract. If code and SPEC disagree, SPEC wins; change SPEC first, on purpose.
- Game rules live in `src/engine.js` and the solver in `src/solver.js`: pure, no DOM, no timers, no randomness.
  Drawing, sound and input live under `src/ui/`, `src/chars/` and `src/audio.js`.
- Only `src/ui/native.js` talks to the app shell (Capacitor). Everything there must fall back quietly in a browser.
- Every level must solve at exactly its par, and its featured element must be necessary (`npm run verify`).
- Characters have no faces (SPEC section 10). The game has sound effects only, no music.
- Before pushing, run `npm run check` (unit tests, level check, build, UI checks, every level played in a
  browser). CI runs the same, then builds the Android app and plays levels on an emulator (`docs/CI.md`).
- After changing the game, `npm run android:sync` copies it into the Android project. After changing
  Wren's art, `node tools/make-icons.cjs` redraws the app icon and splash.
