#!/usr/bin/env bash
# tools/make-upload-key.sh [file]  -> makes the upload key for Google Play (docs/RELEASE.md), asking you for its
# password, and prints how to add it to the repository's secrets for the Release workflow.
#
# Run it once, on your own computer. Keep the .jks file and its password somewhere safe (a password manager):
# Google Play needs every update signed with the same upload key. Never commit it (.gitignore refuses *.jks).
set -euo pipefail
FILE=${1:-"$HOME/glimmerdeep-upload.jks"}
ALIAS=upload
if [ -e "$FILE" ]; then
  echo "$FILE already exists; not touching it." >&2
  exit 1
fi
command -v keytool >/dev/null || { echo "keytool not found: install a JDK (17 or later) first." >&2; exit 1; }
echo "Making the Glimmerdeep upload key at $FILE (alias '$ALIAS')."
echo "keytool asks for a password (use one password for the store and the key) and a name for the certificate."
keytool -genkeypair -v -keystore "$FILE" -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10000 -storetype PKCS12
echo
echo "Done. Its fingerprint:"
keytool -list -v -keystore "$FILE" -alias "$ALIAS" 2>/dev/null | grep -E "SHA256:" || true
cat <<NEXT

Next, add four secrets to the GitHub repository (Settings -> Secrets and variables -> Actions), or with gh:

  base64 < "$FILE" | gh secret set GLIMMERDEEP_UPLOAD_KEYSTORE_BASE64 -R Code-Enzyme/glimmerdeep
  gh secret set GLIMMERDEEP_UPLOAD_STORE_PASSWORD -R Code-Enzyme/glimmerdeep    (paste the password)
  gh secret set GLIMMERDEEP_UPLOAD_KEY_PASSWORD -R Code-Enzyme/glimmerdeep      (the same password)
  gh secret set GLIMMERDEEP_UPLOAD_KEY_ALIAS -R Code-Enzyme/glimmerdeep --body $ALIAS

Then run the Release workflow (Actions -> Release -> Run workflow) and download glimmerdeep-release-aab.
NEXT
