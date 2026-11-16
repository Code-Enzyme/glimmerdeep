// Bundles src/game.js (and everything it imports) into one self-contained HTML file.
// src/index.html must contain the markers /*__CSS__*/ and /*__JS__*/.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist/glimmerdeep.html');

const result = await build({
  entryPoints: [resolve(root, 'src/game.js')],
  bundle: true,
  format: 'iife',
  target: 'es2019',
  minify: process.argv.includes('--minify'),
  write: false,
  logLevel: 'warning',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const cssPath = resolve(root, 'src/style.css');
const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : '';
let html = readFileSync(resolve(root, 'src/index.html'), 'utf8');
for (const marker of ['/*__CSS__*/', '/*__JS__*/']) {
  if (!html.includes(marker)) throw new Error(`src/index.html is missing the marker ${marker}`);
}
html = html.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`built ${out} (${(html.length / 1024).toFixed(1)} KB)`);

// The app shell (Capacitor) serves www/index.html; it is the same single file.
const www = resolve(root, 'www');
mkdirSync(www, { recursive: true });
writeFileSync(resolve(www, 'index.html'), html);
