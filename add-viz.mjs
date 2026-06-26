#!/usr/bin/env node
// 可視化HTMLをハブに追加する。
// 使い方:
//   node add-viz.mjs <html-source> --project <name> --title "..." [--desc "..."] [--type panel|chart|report|dashboard] [--slug xxx]
// 効果: <project>/<slug>.html にコピーし、manifest.json に追記（file重複は上書き更新）。
// 公開URLを表示。commit/push は別途（このスクリプトはファイル操作のみ）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
if (!a.length || a[0].startsWith('--')) { console.error('source HTML path required'); process.exit(1); }
const src = a[0];
const opt = {};
for (let i = 1; i < a.length; i++) { if (a[i].startsWith('--')) opt[a[i].slice(2)] = a[++i]; }
const project = opt.project; const title = opt.title;
if (!project || !title) { console.error('--project and --title required'); process.exit(1); }
const type = opt.type || 'panel';
const slug = (opt.slug || path.basename(src).replace(/\.html?$/i, '')).replace(/[^a-zA-Z0-9_-]/g, '-');
const rel = `${project}/${slug}.html`;
const dest = path.join(ROOT, rel);

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);

const mfPath = path.join(ROOT, 'manifest.json');
const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
mf.items = mf.items || [];
const today = opt.date || new Date().toISOString().slice(0, 10); // 呼び出し側で--dateを渡すと確実
const entry = { project, title, file: rel, type, added: today, desc: opt.desc || '' };
const i = mf.items.findIndex(x => x.file === rel);
if (i >= 0) mf.items[i] = { ...mf.items[i], ...entry }; else mf.items.push(entry);
fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2) + '\n');

console.log(`added: ${rel}`);
console.log(`URL  : https://yukikanedomi.github.io/viz-panels/${rel}`);
console.log(`hub  : https://yukikanedomi.github.io/viz-panels/  (#検索で${project}）`);
console.log(`next : git add -A && git commit && git push  で公開`);
