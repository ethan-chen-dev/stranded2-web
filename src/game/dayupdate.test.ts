import { describe, it, expect } from 'vitest';
import { DayUpdate, growth, STORED_OUTSIDE } from './dayupdate';
import { makeTestWorld, testDef, flatMap } from './test-world';
import { CLS } from './entities';
import type { MapInfo } from '../formats/s2map';

function setup(infos: MapInfo[] = []) {
  const tw = makeTestWorld({
    objects: new Map([
      [1, testDef({ id: 1, name: 'Grain', growtime: 3, health: 30 })],
      [2, testDef({ id: 2, name: 'Bush', spawn: { item: 7, rate: 2, xzr: 20, yr: 0, yo: 5, limit: 2, count: 1 } })],
    ]),
    units: new Map([[1, testDef({ id: 1, name: 'Player' })], [5, testDef({ id: 5, name: 'Turtle' })]]),
    items: new Map([[7, testDef({ id: 7, name: 'Berries' })], [9, testDef({ id: 9, name: 'Meat', health: 100, healthchange: -60 })]]),
  }, flatMap());
  const day = new DayUpdate({
    registry: tw.registry, engine: tw.engine, world: tw.world, terrainY: () => 0,
    random: min => min, killObject: rec => tw.world.remove(rec),
  }, infos);
  return { tw, day };
}

describe('DayUpdate', () => {
  it('grows planted objects one day at a time', () => {
    const { tw, day } = setup();
    const grain = tw.world.create(CLS.object, 1, 0, 0)!;
    grain.daytimer = -2;
    expect(growth(grain)).toBeCloseTo(1 / 3);
    day.changeDay();
    expect(grain.daytimer).toBe(-1);
    expect(grain.look?.scale?.[0]).toBeCloseTo(2 / 3);
    expect(grain.healthMax).toBe(20);
    day.changeDay();
    expect(growth(grain)).toBe(1);
  });
  it('spawns items around an object every rate days up to the limit', () => {
    const { tw, day } = setup();
    const bush = tw.world.create(CLS.object, 2, 0, 0)!;
    const berries = () => tw.registry.all(CLS.item, 7).filter(r => r.parentId === bush.id && r.parentMode === STORED_OUTSIDE);
    for (let i = 0; i < 2; i++) day.changeDay();
    expect(berries().length).toBe(1);
    for (let i = 0; i < 6; i++) day.changeDay();
    expect(berries().length).toBe(2);
  });
  it('rots loose food, clears corpses of map units and runs changeday', () => {
    const { tw, day } = setup();
    tw.engine.setMapScript('on:changeday { $days++; }');
    const meat = tw.world.create(CLS.item, 9, 10, 10)!;
    meat.health = 100;
    const corpse = tw.registry.make(CLS.unit, 5, 0, 0, 0, 1, 120);
    corpse.dead = true;
    const special = tw.registry.make(CLS.unit, 5, 0, 0, 0, 1, 50);
    special.dead = true;
    day.changeDay();
    tw.engine.update(0);
    expect(tw.registry.get(CLS.item, meat.id)).toBeDefined();
    expect(tw.registry.get(CLS.unit, 120)).toBeUndefined();
    expect(tw.registry.get(CLS.unit, 50)).toBeDefined();
    day.changeDay();
    tw.engine.update(0);
    expect(tw.registry.get(CLS.item, meat.id)).toBeUndefined();
    expect(tw.engine.vars.globals.get('days')).toBe('2');
  });
  it('spawn controls refill their area every few days, a part at a time', () => {
    const info: MapInfo = { id: 40, typ: 45, x: 0, y: 0, z: 0, pitch: 0, yaw: 0, vars: '', ints: [CLS.unit, 5, 3], floats: [500, 1, 0], strings: ['2', '1', ''] } as MapInfo;
    const { tw, day } = setup([info]);
    tw.registry.make(CLS.info, 45, 0, 0, 0, 1, 40);
    day.changeDay();
    expect(tw.registry.all(CLS.unit, 5).length).toBe(2);
    day.changeDay();
    expect(tw.registry.all(CLS.unit, 5).length).toBe(3);
    day.changeDay();
    expect(tw.registry.all(CLS.unit, 5).length).toBe(3);
  });
});
