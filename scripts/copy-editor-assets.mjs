import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'node_modules/vditor/dist');
const target = resolve(root, 'public/vendor/vditor/dist');
// Only ship the engines used by the editor. In particular, no remote PlantUML renderer.
const paths = [
  'js/lute/lute.min.js',
  'js/i18n/zh_CN.js',
  'js/icons/ant.js',
  'js/katex',
  'js/mermaid/mermaid.min.js',
  'js/highlight.js/highlight.min.js',
  'js/highlight.js/third-languages.js',
  'js/highlight.js/styles/github.min.css',
  'js/highlight.js/LICENSE',
  'css/content-theme/light.css',
  'images/emoji',
];
await rm(target, { recursive: true, force: true });
for (const path of paths) {
  await mkdir(dirname(resolve(target, path)), { recursive: true });
  await cp(resolve(source, path), resolve(target, path), { recursive: true });
}
await cp(resolve(root, 'node_modules/vditor/LICENSE'), resolve(target, 'LICENSE'));
console.log('Offline editor assets copied.');
