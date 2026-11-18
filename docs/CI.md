# CI

`.github/workflows/ci.yml` runs on every push to `main`, on every pull request, and by hand
(Actions → CI → Run workflow).

1. **web:** unit tests, the level verifier, the single-file build, the UI checks and a play-through of
   every level in Chromium. Screenshots and `glimmerdeep.html` are uploaded as artifacts.
2. **android:** builds the game, copies it into the Capacitor project, runs Android lint and builds a
   debug APK, then checks it is signed with the shared debug key (`tools/check-apk-key.sh`). The APK is
   uploaded as `glimmerdeep-debug-apk`.
3. **device:** after `android` passes, boots an API 34 emulator and runs `dev/device-check.cjs`: installs
   the APK, opens the app, plays the first level and the last level of each chapter through the app's
   own WebView, checks the Billing plugin answers and the debug build uses the free test store, buys the
   Full Expedition there, kills and reopens the app, and checks the save and the purchase survived.
   Screenshots of the device are
   uploaded as `device-screenshots`.

Protect `main` in GitHub (Settings → Branches) and require all three jobs before merging.

Debug builds are signed with `android/app/debug.keystore`, committed on purpose (debug keys are not
secret). Because every build carries the same key, a new APK installs over an older one with
`adb install -r` and keeps the save. Release builds will use their own upload key, kept out of the repo.

Releases to the Play Console (a signed app bundle, uploaded to internal testing on a version tag) are
not set up yet. They need an upload key and a Play Console service account first.
