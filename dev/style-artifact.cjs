// Builds the character-style chooser page (one self-contained HTML file) from dev/style-preview.js.
// node dev/style-artifact.cjs <out.html>
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
(async () => {
  const root = path.resolve(__dirname, '..');
  const out = path.resolve(process.argv[2] || path.join(root, 'dist/character-styles.html'));
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules/esbuild/lib/main.js')).href);
  const res = await build({ entryPoints: [path.join(root, 'dev/style-preview.js')], bundle: true, minify: true, format: 'iife', target: 'es2019', write: false, logLevel: 'error' });
  const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = `<title>Glimmerdeep Character Styles</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* Layout: one narrow column like a phone screen, one section per style, each with its cast sheet and a dark scene. */
:root {
  --bg: #221830;
  --panel: #2B1E3A;
  --ink: #F4EAD5;
  --muted: #CBBFAF;
  --amber: #F2B04C;
  --line: #45345A;
  --display: Georgia, 'Iowan Old Style', 'Palatino Linotype', serif;
  --body: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color-scheme: dark;
}
body { background: var(--bg); color: var(--ink); font-family: var(--body); font-size: 15px; line-height: 1.5; }
.wrap { max-width: 440px; margin: 0 auto; padding-block: 20px 40px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.eyebrow { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--amber); margin: 0; }
h1 { font-family: var(--display); font-size: 30px; line-height: 1.15; margin: 4px 0 8px; text-wrap: balance; }
.intro { color: var(--muted); margin: 0 0 14px; }
nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 8px; }
nav a { color: var(--ink); text-decoration: none; border: 1.5px solid var(--line); border-radius: 999px; padding: 6px 12px; font-size: 14px; background: var(--panel); }
nav a:hover, nav a:focus-visible { border-color: var(--amber); outline: none; }
#preview { min-width: 0; }
.style { border-top: 1px solid var(--line); margin-top: 18px; padding-top: 4px; scroll-margin-top: 12px; }
.style h2 { font-family: var(--display); font-size: 24px; margin: 12px 0 2px; }
.style[data-key="faces"] h2 { color: var(--muted); }
.style p { margin: 0 0 10px; color: var(--muted); }
.style .scene-label { margin: 12px 0 6px; font-style: italic; font-size: 13px; }
canvas { display: block; max-width: 100%; border-radius: 10px; }
.note { border-top: 1px solid var(--line); margin-top: 22px; padding-top: 12px; color: var(--muted); font-size: 14px; }
</style>
<div class="wrap">
  <p class="eyebrow">Glimmerdeep</p>
  <h1>Characters without faces</h1>
  <p class="intro">Three new looks for Wren and the cave creatures, none of them with faces, followed by today's art for comparison. Each style shows every character state, then a real level in the dark at phone size. Pick one in the thread and the game switches to it.</p>
  <nav aria-label="Styles">
    <a href="#style-glowmark">Glowmark</a>
    <a href="#style-felt">Felt and stitch</a>
    <a href="#style-glyph">Lantern glyphs</a>
    <a href="#style-faces">Current</a>
  </nav>
  <div id="preview" data-order="glowmark,felt,glyph,faces"></div>
  <p class="note">The game now plays sound effects only. The music is switched off.</p>
</div>
<script>${js}</script>
`;
  fs.writeFileSync(out, html);
  console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
})();
