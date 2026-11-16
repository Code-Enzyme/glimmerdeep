# CI

`.github/workflows/ci.yml` runs on every push to `main`, on every pull request, and by hand
(Actions → CI → Run workflow).

1. **web:** unit tests, the level verifier, the single-file build, the UI checks and a play-through of
   every level in Chromium. Screenshots and `glimmerdeep.html` are uploaded as artifacts.
2. **android:** builds the game, copies it into the Capacitor project, runs Android lint and builds a
   debug APK. The APK is uploaded as `glimmerdeep-debug-apk`.
3. **device:** after `android` passes, boots an API 34 emulator and runs `dev/device-check.cjs`: installs
   the APK, opens the app, plays the first level and the last level of each chapter through the app's
   own WebView, kills and reopens the app, and checks the save survived. Screenshots of the device are
   uploaded as `device-screenshots`.

Protect `main` in GitHub (Settings → Branches) and require all three jobs before merging.

Releases to the Play Console (a signed app bundle, uploaded to internal testing on a version tag) are
not set up yet. They need an upload key and a Play Console service account first.
