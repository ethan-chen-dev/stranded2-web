import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { readRefBytes, MOD_ROOT } from '../test/reference';
import { parseS2Map } from './s2map';

describe('parseS2Map', () => {
  it('parses map02 (first island)', () => {
    const m = parseS2Map(readRefBytes('maps/adventure/map02.s2'));
    expect(m.terrainSize).toBe(64);
    expect(m.colormapSize).toBe(128);
    expect(m.heights.length).toBe((m.terrainSize + 1) ** 2);
    expect(m.colormap.length).toBe(m.colormapSize ** 2 * 3);
    expect(m.grass.length).toBe((m.colormapSize + 1) ** 2);
    expect(m.objects.length).toBe(811);
    expect(m.units.length).toBe(73);
    expect(m.items.length).toBe(101);
    expect(m.infos.length).toBe(50);
    expect(m.header.hour).toBe(8);
    expect(m.header.skybox).toBe('sky');
    expect(m.header.quickslots.length).toBe(10);
    for (const h of m.heights) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
  });
  it('parses states and extensions', () => {
    const m = parseS2Map(readRefBytes('maps/adventure/map02.s2'));
    expect(Array.isArray(m.states)).toBe(true);
    const scripts = m.extensions.filter(e => e.mode === 0 && e.value.includes('on:'));
    expect(scripts.length).toBeGreaterThan(0);
    expect(m.header.mode).toBe('map');
  });
  it('parses the intro map with no objects', () => {
    const m = parseS2Map(readRefBytes('maps/adventure/map01.s2'));
    expect(m.objects.length).toBe(0);
    expect(m.units.length).toBe(1);
    expect(m.header.hour).toBe(21);
  });
  it('rejects a non-map', () => {
    expect(() => parseS2Map(new TextEncoder().encode('hello\n'))).toThrow(/Invalid Map/);
  });
  it('parses every shipped map', () => {
    const maps: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(`${MOD_ROOT}/${dir}`, { withFileTypes: true })) {
        if (f.isDirectory()) walk(`${dir}/${f.name}`);
        else if (f.name.endsWith('.s2')) maps.push(`${dir}/${f.name}`);
      }
    };
    walk('maps');
    expect(maps.length).toBeGreaterThanOrEqual(10);
    for (const p of maps) expect(() => parseS2Map(readRefBytes(p)), p).not.toThrow();
  });
});
