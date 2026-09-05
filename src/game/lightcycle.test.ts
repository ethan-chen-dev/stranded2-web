import { describe, it, expect } from 'vitest';
import { readRefText } from '../test/reference';
import { parseLightcycle, lightColor, ambientColor, fogColor } from './lightcycle';

describe('lightcycle', () => {
  const cyc = parseLightcycle(readRefText('sys/lightcycle.inf'));
  it('parses 24 hours', () => {
    expect(cyc.length).toBe(24);
    expect(cyc[8]).toEqual([255, 255, 255]);
    expect(cyc[7]).toEqual([255, 100, 50]);
    expect(cyc[0]).toEqual([23, 23, 55]);
  });
  it('interpolates 7:30', () => {
    const c = lightColor(cyc, 7, 30);
    expect(c[0]).toBeCloseTo(255, 0);
    expect(c[1]).toBeCloseTo(100 + 155 * 30 / 59, 0);
  });
  it('wraps 23 to 0', () => {
    const c = lightColor(cyc, 23, 59);
    expect(c[0]).toBeCloseTo(23, 0);
  });
  it('fills missing hours with white', () => {
    expect(parseLightcycle('3=1,2,3\r\n')[4]).toEqual([255, 255, 255]);
  });
  it('ambient and fog formulas', () => {
    expect(ambientColor([40, 40, 70])).toEqual([0, 0, 15]);
    expect(fogColor([255, 255, 255], [200, 200, 255])).toEqual([200, 200, 255]);
    expect(fogColor([23, 23, 55], [200, 200, 255])).toEqual([0, 0, 55]);
  });
});
