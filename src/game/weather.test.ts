import { describe, it, expect } from 'vitest';
import { Weather, WEATHER } from './weather';

function setup(climate: number, opts: { rolls?: number[]; saved?: number; diving?: boolean } = {}) {
  const rolls = [...(opts.rolls ?? [])];
  const log = { fireCleared: 0, sounds: [] as string[], loops: [] as (string | null)[], flashes: 0, drops: { rain: 0, snow: 0 } };
  const w = new Weather({
    random: (min, max) => rolls.length ? rolls.shift()! : min === 1 && max === 100 ? 100 : max,
    rnd: (min) => min,
    clearFire: () => { log.fireCleared++; },
    sound: f => { log.sounds.push(f); },
    loop: f => { log.loops.push(f); },
    flash: () => { log.flashes++; },
    precipitation: kind => { log.drops[kind]++; },
    diving: () => opts.diving ?? false,
  }, climate, { rain: 10, snow: 30 }, opts.saved);
  return { w, log };
}

describe('Weather', () => {
  it('starts with the fixed weather of the climate or the weather saved in the map', () => {
    expect(setup(3).w.current).toBe(WEATHER.rain);
    expect(setup(2, { saved: 1 }).w.current).toBe(WEATHER.sun);
    expect(setup(0, { saved: 1 }).w.current).toBe(WEATHER.rain);
    expect(setup(0).w.current).toBe(WEATHER.sun);
  });
  it('rolls rain against the rain ratio each day and puts out fires', () => {
    const { w, log } = setup(0, { rolls: [10, 11] });
    w.changeDay();
    expect(w.current).toBe(WEATHER.rain);
    expect(log.fireCleared).toBe(1);
    w.changeDay();
    expect(w.current).toBe(WEATHER.sun);
    expect(log.fireCleared).toBe(1);
  });
  it('rolls snow in arctic climate', () => {
    const { w } = setup(1, { rolls: [30] });
    w.changeDay();
    expect(w.current).toBe(WEATHER.snow);
    expect(w.blocksFire).toBe(true);
  });
  it('fades the grey box in and out at the original rate', () => {
    const { w } = setup(0);
    w.set(WEATHER.rain);
    w.update(1000, false);
    expect(w.grey).toBeCloseTo(0.1);
    for (let i = 0; i < 20; i++) w.update(1000, false);
    expect(w.grey).toBe(0.75);
    w.set(WEATHER.sun);
    w.update(1000, false);
    expect(w.grey).toBeCloseTo(0.65);
  });
  it('rains around the camera with a looping rain sound and stops under water', () => {
    const { w, log } = setup(3);
    w.update(20, false);
    expect(log.loops).toEqual(['rain.wav']);
    expect(log.drops.rain).toBe(3);
    const under = setup(3, { diving: true });
    under.w.update(20, false);
    expect(under.log.loops).toEqual([]);
    expect(under.log.drops.rain).toBe(0);
  });
  it('accepts climate and weather names from scripts', () => {
    const { w } = setup(0);
    expect(w.setWeather('snow')).toBe(true);
    expect(w.current).toBe(WEATHER.snow);
    expect(w.setClimate('thunder')).toBe(true);
    expect(w.current).toBe(WEATHER.thunder);
    expect(w.setWeather('hail')).toBe(false);
  });
});
