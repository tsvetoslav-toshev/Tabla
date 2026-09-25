// Inlines the sources into one self-contained file: index.html (what GitHub Pages serves).
import { readFileSync, writeFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const scripts = ['vendor/peerjs.min.js', 'src/engine.js', 'src/fair.js', 'src/sound.js', 'src/net.js', 'src/ui.js'].map(read).join('\n');
const html = read('src/index.html')
  .replace('/*STYLE*/', () => read('src/style.css'))
  .replace('/*SCRIPT*/', () => scripts);

if (/(src|href)=["']https?:/i.test(html)) throw new Error('index.html must not load anything from the network');
writeFileSync(new URL('index.html', import.meta.url), html);
console.log(`index.html: ${(html.length / 1024).toFixed(1)} KB`);
