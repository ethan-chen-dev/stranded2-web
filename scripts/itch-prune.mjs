// 从 dist 里删掉没有被任何定义文件、地图、脚本、模型贴图或本项目源码引用的资源，
// 并同步重写 filelist.json。itch.io 的 HTML5 上传限制单个 zip 最多 1000 个文件，
// 而原版素材目录超出这个数。
// 用法：node scripts/itch-prune.mjs <dist 目录>
import { readdirSync, readFileSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve(process.argv[2] ?? 'dist');
const SRC = resolve('src');
/** 只在这些目录里裁剪；sys 下的定义文件、maps 与代码产物一律保留。 */
const ASSET_DIRS = ['gfx', 'sfx', 'sprites', 'sys/gfx'];
/** 存档目录由浏览器本地存储代替，打包时不需要。 */
const DEAD_DIRS = ['saves'];

const walk = (base, rel = '') => {
  let out = [];
  for (const f of readdirSync(resolve(base, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${f.name}` : f.name;
    if (f.isDirectory()) out = out.concat(walk(base, p));
    else out.push(p);
  }
  return out;
};
const exists = p => { try { return statSync(p).isDirectory() || statSync(p).isFile(); } catch { return false; } };

const assets = new Set();
for (const d of ASSET_DIRS) if (exists(resolve(dist, d))) for (const f of walk(dist, d)) assets.add(f.toLowerCase());

/** b3d 的 TEXS 块：每条是以 NUL 结尾的文件名加 28 字节的标志与变换。 */
function b3dTextures(file) {
  const buf = readFileSync(file);
  const out = [];
  for (let i = 0; i + 8 < buf.length; i++) {
    if (buf.toString('latin1', i, i + 4) !== 'TEXS') continue;
    const size = buf.readInt32LE(i + 4);
    let p = i + 8;
    const end = Math.min(p + size, buf.length);
    while (p < end) {
      const nul = buf.indexOf(0, p);
      if (nul < 0 || nul >= end) break;
      out.push(buf.toString('latin1', p, nul));
      p = nul + 1 + 28;
    }
    break;
  }
  return out;
}

const texts = [];
const readAll = (base, dir, exts) => {
  if (!exists(resolve(base, dir))) return;
  for (const f of walk(base, dir)) {
    if (exts.some(e => f.toLowerCase().endsWith(e))) texts.push(readFileSync(resolve(base, f), 'latin1'));
  }
};
readAll(dist, 'sys', ['.inf', '.s2s', '.cfg']);
readAll(dist, 'maps', ['.s2', '.s2s', '.inf']);
readAll(SRC, '', ['.ts', '.css']);
const blob = texts.join('\n').replace(/\\/g, '/').toLowerCase();

const referenced = new Set();
for (const m of blob.matchAll(/(?:gfx|sfx|sprites|sys\/gfx)\/[\w\- .]+?\.(?:b3d|bmp|jpg|png|wav|ogg|mp3|rfl|ktfl)/g)) referenced.add(m[0]);
// 声音在数据里只写文件名或 sfx 下的相对路径，例如 music="music_onsea.mp3"、
// seqsound "speech/intro_a.ogg"，播放时才补上 sfx/ 前缀。
for (const m of blob.matchAll(/[\w][\w\-/ ]*\.(?:wav|ogg|mp3)/g)) {
  const rel = m[0].replace(/^sfx\//, '');
  if (assets.has(`sfx/${rel}`)) referenced.add(`sfx/${rel}`);
}
// 代码里按模板拼出的音效名，例如 mat_flesh1.wav 与 human_hit3.wav 只有前缀出现在源码中
for (const prefix of ['mat_', 'human_hit', 'swing_', 'collect', 'fail', 'treefall', 'bow', 'throw', 'shot', 'amb_']) {
  if (!blob.includes(prefix)) continue;
  for (const f of assets) if (f.startsWith(`sfx/${prefix}`)) referenced.add(f);
}

for (const p of [...referenced].filter(f => f.endsWith('.b3d'))) {
  const file = resolve(dist, p);
  if (!exists(file)) continue;
  const dir = p.slice(0, p.lastIndexOf('/'));
  for (const t of b3dTextures(file)) {
    let rel = t.replace(/\\/g, '/').toLowerCase().replace(/^\.\//, '');
    if (/^[a-z]:\//.test(rel)) rel = rel.slice(rel.lastIndexOf('/') + 1);
    const base = rel.slice(rel.lastIndexOf('/') + 1);
    for (const cand of [`${dir}/${rel}`, `gfx/${base}`]) if (assets.has(cand)) referenced.add(cand);
  }
}

const drop = new Set([...assets].filter(f => !referenced.has(f)));
for (const d of DEAD_DIRS) if (exists(resolve(dist, d))) for (const f of walk(dist, d)) drop.add(f.toLowerCase());

/** dist 下的真实路径大小写与索引一致，这里按小写比对后按真实名删除。 */
const removed = [];
for (const d of [...ASSET_DIRS, ...DEAD_DIRS]) {
  if (!exists(resolve(dist, d))) continue;
  for (const f of walk(dist, d)) {
    if (!drop.has(f.toLowerCase())) continue;
    rmSync(resolve(dist, f), { force: true });
    removed.push(f);
  }
}

const indexPath = resolve(dist, 'filelist.json');
if (exists(indexPath)) {
  const gone = new Set(removed.map(f => f.toLowerCase()));
  const kept = JSON.parse(readFileSync(indexPath, 'utf8')).filter(f => !gone.has(f.toLowerCase()));
  writeFileSync(indexPath, JSON.stringify(kept));
  console.log(`pruned ${removed.length} files, filelist.json now lists ${kept.length}`);
} else {
  console.log(`pruned ${removed.length} files`);
}
