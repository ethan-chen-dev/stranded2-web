import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const MOD_ROOT = resolve(__dirname, '../../reference/game/mods/Stranded II');
export const refPath = (rel: string) => resolve(MOD_ROOT, rel);
export const readRefBytes = (rel: string) => new Uint8Array(readFileSync(refPath(rel)));
export const readRefText = (rel: string) => readFileSync(refPath(rel), 'latin1');
