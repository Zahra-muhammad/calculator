// Builds ONE self-contained HTML file (all CSS and JS inlined) at single/finapt-calculator.html.
// The team can open it offline by double-clicking, or email it. Run: npm run build:single
import react from '@vitejs/plugin-react';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(root, '.single-tmp');
const outDir = join(root, 'single');
const outFile = join(outDir, 'finapt-calculator.html');

rmSync(tmp, { recursive: true, force: true });
await build({
  root,
  configFile: false,
  base: './',
  logLevel: 'warn',
  plugins: [react()],
  build: {
    outDir: tmp,
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    chunkSizeWarningLimit: 10_000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});

let html = readFileSync(join(tmp, 'index.html'), 'utf8');
let inlined = 0;

html = html.replace(/<link\s+rel="stylesheet"[^>]*?href="\.?\/?(assets\/[^"]+\.css)"[^>]*>/g, (_m, p) => {
  inlined++;
  return `<style>\n${readFileSync(join(tmp, p), 'utf8')}\n</style>`;
});

html = html.replace(/<script\s+type="module"[^>]*?src="\.?\/?(assets\/[^"]+\.js)"[^>]*><\/script>/g, (_m, p) => {
  inlined++;
  // "</script" inside the code would end the tag early; "<\/script" means the same in JS strings and regexes.
  // "<!--" can switch the HTML parser into an escaped mode; "<\x21--" means the same inside JS strings and regexes.
  const js = readFileSync(join(tmp, p), 'utf8')
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\x21--');
  return `<script type="module">\n${js}\n</script>`;
});

if (/(src|href)="\.?\/?assets\//.test(html)) throw new Error('Some assets were not inlined.');
if (inlined < 2) throw new Error(`Expected to inline CSS and JS, inlined ${inlined} file(s).`);

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, html);
rmSync(tmp, { recursive: true, force: true });
const kb = Math.round(statSync(outFile).size / 1024);
console.log(`Single file: ${outFile} (${kb} KB)`);
