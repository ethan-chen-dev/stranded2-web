/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  publicDir: resolve(import.meta.dirname, 'reference/game/mods/Stranded II'),
  test: { include: ['src/**/*.test.ts'] },
});
