import { describe, it, expect } from 'vitest';
import { GameClock } from './clock';

describe('GameClock', () => {
  it('advances a minute every 500 ms', () => {
    const c = new GameClock(1, 8, 0);
    expect(c.advance(499)).toBe(0);
    expect(c.advance(1)).toBe(1);
    expect(c.minute).toBe(1);
  });
  it('carries hour and day', () => {
    const c = new GameClock(1, 23, 59);
    c.advance(500);
    expect([c.day, c.hour, c.minute]).toEqual([2, 0, 0]);
  });
  it('stays frozen', () => {
    const c = new GameClock(1, 8, 0, true);
    c.advance(5000);
    expect(c.minute).toBe(0);
  });
  it('accumulates fractional time', () => {
    const c = new GameClock(1, 8, 0);
    for (let i = 0; i < 10; i++) c.advance(100);
    expect(c.minute).toBe(2);
  });
  it('reports day fraction', () => {
    expect(new GameClock(1, 12, 0).dayFraction).toBeCloseTo(0.5);
  });
});
