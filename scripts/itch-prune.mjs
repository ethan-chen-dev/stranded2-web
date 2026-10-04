// itch.io 的 HTML5 上传限制单个 zip 最多 1000 个文件，原版素材目录超出这个数。
// 构建产物里的 assets.zip 已包含整个 mod 目录：模型、声音、定义文件与地图都先从素材包读取，
// 只有图片会被 CSS 和界面元素（图标、状态条、剧情图片）按地址直接引用。
// 所以打 itch 包时删掉零散的非图片原版文件，图片全部保留；filelist.json 索引不变。
// 用法：node scripts/itch-prune.mjs <dist 目录>
import { readFileSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve(process.argv[2] ?? 'dist');
const exists = p => { try { statSync(p); return true; } catch { return false; } };
const IMAGE = /\.(bmp|jpg|jpeg|png|gif)$/i;

if (!exists(resolve(dist, 'assets.zip')) || !exists(resolve(dist, 'filelist.json'))) {
  console.error('dist has no assets.zip or filelist.json; build first');
  process.exit(1);
}
const files = JSON.parse(readFileSync(resolve(dist, 'filelist.json'), 'utf8'));
let removed = 0;
for (const f of files) {
  if (IMAGE.test(f)) continue;
  const p = resolve(dist, f);
  if (exists(p)) { rmSync(p, { force: true }); removed++; }
}
rmSync(resolve(dist, 'saves'), { recursive: true, force: true });
console.log(`removed ${removed} non-image mod files; assets.zip serves them`);
