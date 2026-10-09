// Builds a single self-contained HTML file from src/ (no dependencies).
//   node scripts/build.mjs            -> dist/index.html (standalone page, for GitHub Pages)
//   node scripts/build.mjs --fragment -> dist/fragment.html (no <html>/<head> skeleton, for hosts that add their own)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');

let html = read('src/template.html');
const parts = { '/*DATA*/': 'data/samples.js', '/*ENGINE*/': 'src/engine.js', '/*CSV*/': 'src/csv.js', '/*UI*/': 'src/ui.js' };
for (const [marker, file] of Object.entries(parts)) {
  const code = read(file);
  if (code.includes('</script')) throw new Error(`${file} contains "</script", which would break inlining`);
  if (!html.includes(marker)) throw new Error(`template is missing ${marker}`);
  html = html.replace(marker, () => code);
}

const fragment = process.argv.includes('--fragment');
const [head, body] = html.split('<!--BODY-->');
const out = fragment ? head + body : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Test whether a trading strategy has an edge or just fits noise: permutation tests, walkforward, CSCV and bootstrap bounds, after Timothy Masters.">
${head}</head>
<body>
${body}</body>
</html>
`;
mkdirSync(join(root, 'dist'), { recursive: true });
const file = join(root, 'dist', fragment ? 'fragment.html' : 'index.html');
writeFileSync(file, out);
console.log(`wrote ${file} (${(out.length / 1024).toFixed(0)} KB)`);
