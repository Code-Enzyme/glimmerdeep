#!/usr/bin/env bash
# tools/make-upload-key.sh [file]  -> makes the upload key for Google Play (docs/RELEASE.md), adds the four secrets
# the Release workflow needs to the GitHub repository, and starts a release build.
#
# Run it once, on your own computer, in a terminal: it asks you for the key's password (twice). The password goes
# to keytool through the environment and to GitHub's encrypted secrets through gh's input, never on a command line
# or into a file. Keep the .jks file and the password in a password manager: Google Play needs every update signed
# with the same upload key. Never commit the key (.gitignore refuses *.jks).
set -euo pipefail
FILE=${1:-"$HOME/glimmerdeep-upload.jks"}
REPO=${GLIMMERDEEP_REPO:-Code-Enzyme/glimmerdeep}
ALIAS=upload

if [ -e "$FILE" ]; then
  echo "$FILE already exists; not touching it." >&2
  exit 1
fi
command -v keytool >/dev/null || { echo "keytool not found: install a JDK (17 or later) first." >&2; exit 1; }
command -v gh >/dev/null || { echo "gh not found: install the GitHub CLI (brew install gh) and run gh auth login." >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh is not signed in: run gh auth login first." >&2; exit 1; }

echo "Making the Glimmerdeep upload key at $FILE."
echo "Choose a password for it (at least 8 characters) and save it in your password manager now."
read -r -s -p "Password: " GLIMMERDEEP_KEY_PASSWORD; echo
read -r -s -p "The same password again: " again; echo
if [ "$GLIMMERDEEP_KEY_PASSWORD" != "$again" ]; then
  echo "The two passwords differ; nothing was made." >&2
  exit 1
fi
unset again
if [ ${#GLIMMERDEEP_KEY_PASSWORD} -lt 8 ]; then
  echo "The password is shorter than 8 characters; nothing was made." >&2
  exit 1
fi
export GLIMMERDEEP_KEY_PASSWORD

keytool -genkeypair -keystore "$FILE" -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10000 \
  -storetype PKCS12 -storepass:env GLIMMERDEEP_KEY_PASSWORD -keypass:env GLIMMERDEEP_KEY_PASSWORD \
  -dname "CN=Glimmerdeep, O=Code Enzyme" >/dev/null 2>&1
echo "Made the key. Its fingerprint:"
keytool -list -v -keystore "$FILE" -alias "$ALIAS" -storepass:env GLIMMERDEEP_KEY_PASSWORD 2>/dev/null | grep -E "SHA256:" || true

echo "Adding the four secrets to $REPO..."
base64 < "$FILE" | tr -d '\n' | gh secret set GLIMMERDEEP_UPLOAD_KEYSTORE_BASE64 -R "$REPO"
printf '%s' "$GLIMMERDEEP_KEY_PASSWORD" | gh secret set GLIMMERDEEP_UPLOAD_STORE_PASSWORD -R "$REPO"
printf '%s' "$GLIMMERDEEP_KEY_PASSWORD" | gh secret set GLIMMERDEEP_UPLOAD_KEY_PASSWORD -R "$REPO"
printf '%s' "$ALIAS" | gh secret set GLIMMERDEEP_UPLOAD_KEY_ALIAS -R "$REPO"
unset GLIMMERDEEP_KEY_PASSWORD

echo "Starting the Release workflow..."
gh workflow run release.yml -R "$REPO"
cat <<DONE

Done. The signed app bundle will be the artifact glimmerdeep-release-aab of the Release run (Actions -> Release).
Keep $FILE and its password in your password manager: every update to Google Play must be signed with this key.
DONE
