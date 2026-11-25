// tools/make-upload-key.sh (docs/RELEASE.md): one command makes the upload key, adds the four secrets the Release
// workflow needs and starts it. The password is typed once (twice to confirm) and goes to keytool through the
// environment and to gh through stdin, never on a command line or into a file. Run here with a stand-in keytool
// and gh, so nothing reaches GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../tools/make-upload-key.sh');
const PW = 'pw-for-this-test-7781';

// A home folder with stand-ins for keytool and gh that log what they were given.
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-key-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(dir, 'log');
  fs.writeFileSync(path.join(bin, 'keytool'), `#!/usr/bin/env bash
echo "keytool $* | env=\${GD_PW_SEEN_BY_KEYTOOL:-}\${GLIMMERDEEP_KEY_PASSWORD:+set}" >> "${log}"
prev=""
for a in "$@"; do
  if [ "$prev" = "-keystore" ] && [ "$1" = "-genkeypair" ]; then echo fake-keystore > "$a"; fi
  prev="$a"
done
case " $* " in *" -list "*)
  [ "\${GLIMMERDEEP_KEY_PASSWORD:-}" = "wrong-password-0000" ] && { echo "keytool error: password was incorrect" >&2; exit 1; }
  echo "	 SHA256: AA:BB";; esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash
if [ "$1" = "api" ] && [ -n "\${GD_GH_DENY:-}" ]; then echo "HTTP 403: You must have repository read permissions" >&2; exit 1; fi
if [ "$1" = "secret" ]; then echo "gh $* | stdin=$(cat)" >> "${log}"; else echo "gh $*" >> "${log}"; fi
`, { mode: 0o755 });
  return { dir, bin, log };
}

function run(sb, input, args = [], env = {}) {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    input,
    env: { PATH: `${sb.bin}:${process.env.PATH}`, HOME: sb.dir, ...env },
    encoding: 'utf8',
  });
  const log = fs.existsSync(sb.log) ? fs.readFileSync(sb.log, 'utf8').trim().split('\n') : [];
  return { ...r, log };
}

test('upload key: one password makes the key, the four secrets and a release build', () => {
  const sb = sandbox();
  const r = run(sb, `${PW}\n${PW}\n`);
  assert.equal(r.status, 0, r.stderr);
  const key = path.join(sb.dir, 'glimmerdeep-upload.jks');
  assert.ok(fs.existsSync(key), 'the key is in the home folder');
  const make = r.log.find((l) => l.includes('-genkeypair'));
  assert.ok(make, 'keytool made the key');
  assert.match(make, /-storepass:env GLIMMERDEEP_KEY_PASSWORD/);
  assert.match(make, /-alias upload/);
  assert.match(make, /-dname /, 'asks no questions about the certificate');
  assert.match(make, /env=set$/, 'keytool got the password through the environment');
  const secret = (name) => r.log.find((l) => l.startsWith(`gh secret set ${name} `));
  assert.equal(secret('GLIMMERDEEP_UPLOAD_KEYSTORE_BASE64').split('stdin=')[1], Buffer.from('fake-keystore\n').toString('base64'));
  assert.equal(secret('GLIMMERDEEP_UPLOAD_STORE_PASSWORD').split('stdin=')[1], PW);
  assert.equal(secret('GLIMMERDEEP_UPLOAD_KEY_PASSWORD').split('stdin=')[1], PW);
  assert.equal(secret('GLIMMERDEEP_UPLOAD_KEY_ALIAS').split('stdin=')[1], 'upload');
  for (const name of ['KEYSTORE_BASE64', 'STORE_PASSWORD', 'KEY_PASSWORD', 'KEY_ALIAS']) {
    assert.match(secret(`GLIMMERDEEP_UPLOAD_${name}`), /-R Code-Enzyme\/glimmerdeep/);
  }
  assert.ok(r.log.some((l) => /^gh workflow run release\.yml -R Code-Enzyme\/glimmerdeep/.test(l)), 'starts the Release workflow');
  // the password never shows on a command line (only in what gh read from stdin) or in the output
  for (const line of r.log) assert.ok(!line.split(' | ')[0].includes(PW), `password in a command line: ${line}`);
  assert.ok(!r.stdout.includes(PW) && !r.stderr.includes(PW), 'password printed');
  assert.match(r.stdout, /password manager/i, 'says to keep the key and password safe');
});

test('upload key: two different passwords, a short one, or no right to set secrets change nothing', () => {
  for (const input of [`${PW}\nsomething-else\n`, 'short\nshort\n']) {
    const sb = sandbox();
    const r = run(sb, input);
    assert.notEqual(r.status, 0);
    assert.ok(!fs.existsSync(path.join(sb.dir, 'glimmerdeep-upload.jks')));
    assert.deepEqual(r.log.filter((l) => /genkeypair|^gh secret set|^gh workflow run/.test(l)), []);
  }
  // gh signed in as someone who cannot set the repository's secrets: found out before any key is made
  const sb = sandbox();
  const r = run(sb, `${PW}\n${PW}\n`, [], { GD_GH_DENY: '1' });
  assert.notEqual(r.status, 0);
  assert.ok(!fs.existsSync(path.join(sb.dir, 'glimmerdeep-upload.jks')));
  assert.deepEqual(r.log.filter((l) => /genkeypair|^gh secret set|^gh workflow run/.test(l)), []);
  assert.match(r.stderr, /gh auth (login|refresh)/, 'says how to sign gh in with the right account');
});

test('upload key: a key already made is kept and reused when its password opens it', () => {
  const sb = sandbox();
  const key = path.join(sb.dir, 'glimmerdeep-upload.jks');
  fs.writeFileSync(key, 'an old key\n');
  const r = run(sb, `${PW}\n`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(key, 'utf8'), 'an old key\n', 'the key is untouched');
  assert.ok(!r.log.some((l) => l.includes('-genkeypair')), 'no new key');
  const secret = (name) => r.log.find((l) => l.startsWith(`gh secret set ${name} `));
  assert.equal(secret('GLIMMERDEEP_UPLOAD_KEYSTORE_BASE64').split('stdin=')[1], Buffer.from('an old key\n').toString('base64'));
  assert.equal(secret('GLIMMERDEEP_UPLOAD_STORE_PASSWORD').split('stdin=')[1], PW);
  assert.ok(r.log.some((l) => l.startsWith('gh workflow run release.yml')));
  for (const line of r.log) assert.ok(!line.split(' | ')[0].includes(PW), `password in a command line: ${line}`);
  // the wrong password: nothing is set
  const sb2 = sandbox();
  fs.writeFileSync(path.join(sb2.dir, 'glimmerdeep-upload.jks'), 'an old key\n');
  const r2 = run(sb2, 'wrong-password-0000\n');
  assert.notEqual(r2.status, 0);
  assert.deepEqual(r2.log.filter((l) => /genkeypair|^gh secret set|^gh workflow run/.test(l)), []);
  assert.equal(fs.readFileSync(path.join(sb2.dir, 'glimmerdeep-upload.jks'), 'utf8'), 'an old key\n');
});
