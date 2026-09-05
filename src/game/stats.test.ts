import { describe, it, expect } from 'vitest';
import { SurvivalStats } from './stats';

describe('SurvivalStats', () => {
  it('rises while moving on land', () => {
    const s = new SurvivalStats();
    s.update(100, true, false);
    expect([s.hunger, s.thirst, s.exhaustion]).toEqual([0.02, 0.02, 0.016]);
  });
  it('rises faster while swimming', () => {
    const s = new SurvivalStats();
    s.update(100, true, true);
    expect([s.hunger, s.thirst, s.exhaustion]).toEqual([0.06, 0.05, 0.06]);
  });
  it('does not rise while idle', () => {
    const s = new SurvivalStats();
    s.update(1000, false, false);
    expect(s.hunger).toBe(0);
  });
  it('accumulates fractional intervals', () => {
    const s = new SurvivalStats();
    for (let i = 0; i < 10; i++) s.update(16, true, false);
    expect(s.hunger).toBeCloseTo(0.02, 6);
  });
  it('caps at store', () => {
    const s = new SurvivalStats();
    for (let i = 0; i < 10000; i++) s.update(100, true, false);
    expect(s.hunger).toBe(100);
  });
  it('damages 5 per full stat every 5 seconds', () => {
    const s = new SurvivalStats();
    s.hunger = 100; s.thirst = 100; s.exhaustion = 100;
    expect(s.update(4999, false, false)).toBe(0);
    expect(s.update(1, false, false)).toBe(15);
    expect(s.health).toBe(85);
    s.thirst = 0; s.exhaustion = 0;
    expect(s.update(5000, false, false)).toBe(5);
  });
  it('dies at zero health', () => {
    const s = new SurvivalStats();
    s.hunger = 100; s.thirst = 100; s.exhaustion = 100;
    for (let i = 0; i < 10; i++) s.update(5000, false, false);
    expect(s.health).toBe(0);
    expect(s.dead).toBe(true);
  });
  it('jump exhausts once per 100 ms', () => {
    const s = new SurvivalStats();
    s.jump(1000);
    s.jump(1050);
    expect(s.hunger).toBe(0.8);
    s.jump(1200);
    expect(s.hunger).toBe(1.6);
  });
});
