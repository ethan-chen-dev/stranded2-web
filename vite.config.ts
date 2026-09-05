/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';

const MOD_ROOT = resolve(import.meta.dirname, 'reference/game/mods/Stranded II');

/** 开发服务器上列出 mod 目录下的文件（相对路径），供页面枚举定义文件与地图。 */
function modDirList(): Plugin {
  const walk = (dir: string, rel = ''): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(f =>
      f.isDirectory() ? walk(resolve(dir, f.name), `${rel}${f.name}/`) : [`${rel}${f.name}`]);
  return {
    name: 'mod-dir-list',
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
  publicDir: MOD_ROOT,
  plugins: [modDirList()],
  test: { include: ['src/**/*.test.ts'] },
});
