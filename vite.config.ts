/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

const MOD_ROOT = resolve(import.meta.dirname, 'reference/game/mods/Stranded II');

/** 开发服务器上列出 mod 目录下的文件（相对路径），供页面枚举定义文件与地图；构建时把全量索引写成 filelist.json。 */
function modDirList(): Plugin {
  const walk = (dir: string, rel = ''): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(f =>
      f.isDirectory() ? walk(resolve(dir, f.name), `${rel}${f.name}/`) : [`${rel}${f.name}`]);
  return {
    name: 'mod-dir-list',
    generateBundle() {
      const files = walk(MOD_ROOT).filter(f => !f.startsWith('saves/'));
      this.emitFile({ type: 'asset', fileName: 'filelist.json', source: JSON.stringify(files) });
      // 已压缩的图片与音频存储时不再压缩；其余（b3d、bmp、inf、地图）压缩。
      const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
      for (const f of files) {
        const stored = /\.(jpg|jpeg|png|mp3|ogg)$/i.test(f);
        entries[f] = [new Uint8Array(readFileSync(resolve(MOD_ROOT, f))), { level: stored ? 0 : 6 }];
      }
      const zip = zipSync(entries);
      const hash = createHash('sha1').update(zip).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'assets.zip', source: zip });
      this.emitFile({ type: 'asset', fileName: 'assets.json', source: JSON.stringify({ hash, size: zip.length, files: files.length }) });
    },
    configureServer(server) {
      server.middlewares.use('/__list', (req, res) => {
        const dir = new URL(req.url ?? '/', 'http://x').searchParams.get('dir') ?? '';
        if (dir.includes('..')) { res.statusCode = 400; res.end(); return; }
        try {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(walk(resolve(MOD_ROOT, dir))));
        } catch {
          res.statusCode = 404;
          res.end('[]');
        }
      });
    },
  };
}

export default defineConfig({
  /** 部署到 GitHub Pages 子路径时由 CI 传入，例如 /stranded2-web/。 */
  base: process.env.BASE_PATH ?? '/',
  publicDir: MOD_ROOT,
  plugins: [modDirList()],
  test: { include: ['src/**/*.test.ts'] },
});
