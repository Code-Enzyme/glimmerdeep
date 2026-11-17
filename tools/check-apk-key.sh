#!/usr/bin/env bash
# tools/check-apk-key.sh [apk]  -> fails unless the APK is signed with the project's committed debug key
# (android/app/debug.keystore). Every build, in CI or on a laptop, must carry the same key, or Android
# refuses to update a phone that has another build installed.
set -euo pipefail
cd "$(dirname "$0")/.."
APK=${1:-android/app/build/outputs/apk/debug/app-debug.apk}
KS=android/app/debug.keystore
SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
APKSIGNER=$( (ls "$SDK"/build-tools/*/apksigner 2>/dev/null || true) | sort -V | tail -1)
[ -n "$APKSIGNER" ] || { echo "apksigner not found under \$ANDROID_HOME/build-tools"; exit 1; }
[ -f "$KS" ] || { echo "missing $KS"; exit 1; }
want=$(keytool -list -v -keystore "$KS" -storepass android -alias androiddebugkey 2>/dev/null \
  | sed -n 's/.*SHA256: *//p' | tr -d ':' | tr 'A-F' 'a-f')
got=$("$APKSIGNER" verify --print-certs "$APK" | sed -n 's/.*certificate SHA-256 digest: *//p' | head -1)
echo "keystore: $want"
echo "apk:      $got"
[ -n "$want" ] && [ "$want" = "$got" ] || { echo "FAIL: the APK is not signed with $KS"; exit 1; }
echo "APK is signed with the project debug key"
