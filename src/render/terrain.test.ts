import { describe, it, expect } from 'vitest';
import { readRefBytes } from '../test/reference';
import { parseS2Map } from '../formats/s2map';
import { worldHeight, CELL, HEIGHT } from './terrain';

describe('worldHeight', () => {
  const map = parseS2Map(readRefBytes('maps/adventure/map02.s2'));
  const n = map.terrainSize;
  it('matches grid points exactly', () => {
    const x = 3, z = 5;
    const expected = map.heights[x * (n + 1) + z] * HEIGHT - HEIGHT / 2;
    expect(worldHeight(map, -n / 2 * CELL + x * CELL, -n / 2 * CELL + z * CELL)).toBeCloseTo(expected, 3);
  });
  it('interpolates between grid points', () => {
    const a = map.heights[10 * (n + 1) + 10] * HEIGHT - HEIGHT / 2;
    const b = map.heights[11 * (n + 1) + 10] * HEIGHT - HEIGHT / 2;
    const mid = worldHeight(map, -n / 2 * CELL + 10.5 * CELL, -n / 2 * CELL + 10 * CELL);
    expect(mid).toBeCloseTo((a + b) / 2, 3);
  });
  it('clamps outside', () => {
    expect(() => worldHeight(map, -1e6, 1e6)).not.toThrow();
    expect(worldHeight(map, -1e6, -1e6)).toBeCloseTo(map.heights[0] * HEIGHT - HEIGHT / 2, 3);
  });
});
