import { describe, it, expect, beforeEach } from 'vitest';
import { Skills } from './skills';
import { UnitPaths } from './unitpath';
import { Triggers, TRIGGER_INTERVAL_MS } from './triggers';
import { makeTestWorld, testDef, type TestWorld } from './test-world';
import { CLS, type EntityRecord } from './entities';
import type { MapInfo } from '../formats/s2map';

describe('Skills', () => {
  it('increments, reads, renames, frees and serializes', () => {
    const s = new Skills();
    expect(s.inc('wood', 1, 'Lumbering')).toBe(false);
    expect(s.inc('wood', 2)).toBe(true);
    expect(s.value('wood')).toBe(3);
    expect(s.value('fish')).toBe(0);
    expect(s.has('wood')).toBe(true);
    expect(s.setName('wood', 'Chopping')).toBe(true);
    expect(s.entries()).toEqual([{ name: 'wood', value: 3, caption: 'Chopping' }]);
    const t = new Skills();
    t.load(JSON.parse(JSON.stringify(s.entries())));
    expect(t.value('wood')).toBe(3);
    expect(t.free('wood')).toBe(true);
    expect(t.value('wood')).toBe(0);
  });
});

let tw: TestWorld;
const g = (n: string) => tw.engine.vars.globals.get(n) ?? '0';

function world(): TestWorld {
  return makeTestWorld({
    objects: new Map([[1, testDef({ id: 1, name: 'Palm' })]]),
    units: new Map([
      [1, testDef({ id: 1, name: 'Player', maxweight: 25000 })],
      [2, testDef({ id: 2, name: 'Walker', speed: 2, script: 'on:node0007 { $n7=1; } on:node0008 { $n8=1; }' })],
      [3, testDef({ id: 3, name: 'Yacht', behaviour: 'watercraft', speed: 5 })],
    ]),
    items: new Map([[7, testDef({ id: 7, name: 'Log', weight: 10 })]]),
    infos: new Map([[40, testDef({ id: 40, name: 'Camera' })], [10, testDef({ id: 10, name: 'Trigger', script: 'on:trigger { $t=$t+1; }' })]]),
  });
}

function info(id: number, typ: number, x: number, z: number, ints: [number, number, number] = [0, 0, 0], floats: [number, number, number] = [0, 0, 0]): MapInfo {
  return { id, typ, x, y: 0, z, pitch: 0, yaw: 0, vars: '', ints, floats, strings: ['', '', ''] };
}

describe('UnitPaths', () => {
  let ground = 0;
  let paths: UnitPaths;
  beforeEach(() => {
    tw = world();
    ground = 0;
    tw.registry.make(CLS.info, 40, 0, 0, 300, 1, 7);
    tw.registry.make(CLS.info, 40, 300, 0, 300, 1, 8);
    tw.engine.setTypeScript(CLS.info, 40, 'on:reach { $reach=$reach+1; }', 'infos');
    paths = new UnitPaths({ registry: tw.registry, engine: tw.engine, terrainY: () => ground, sync: () => undefined });
  });
  const run = (ms: number) => { for (let t = 0; t < ms; t += 20) { paths.update(20); tw.engine.update(20); } };

  it('walks node by node, fires node/reach events and releases the unit at the end', () => {
    const u: EntityRecord = tw.registry.make(CLS.unit, 2, 0, 0, 0, 1, 50);
    paths.set(50, [7, 8]);
    expect(paths.controlled(50)).toBe(true);
    run(1000);
    expect(u.z).toBeGreaterThan(90);
    expect(u.x).toBeCloseTo(0, 3);
    run(3000);
    expect(g('n7')).toBe('1');
    expect(g('reach')).not.toBe('0');
    run(4000);
    expect(g('n8')).toBe('1');
    expect(Math.hypot(u.x - 300, u.z - 300)).toBeLessThan(100);
    expect(paths.controlled(50)).toBe(false);
  });

  it('watercraft stops at the shore and free removes the controller', () => {
    const y = tw.registry.make(CLS.unit, 3, 0, 0, 0, 1, 60);
    ground = -50;
    paths.set(60, [7]);
    run(400);
    const z1 = y.z;
    expect(z1).toBeGreaterThan(50);
    ground = 5;
    run(400);
    expect(y.z).toBe(z1);
    paths.free(60);
    expect(paths.controlled(60)).toBe(false);
  });
});

describe('Triggers', () => {
  let trig: Triggers;
  let player = { x: 5000, y: 0, z: 5000 };
  let clock = { day: 1, hour: 8, minute: 0 };
  const signals: string[] = [];
  beforeEach(() => {
    tw = world();
    player = { x: 5000, y: 0, z: 5000 };
    clock = { day: 1, hour: 8, minute: 0 };
    signals.length = 0;
    tw.registry.make(CLS.info, 10, 0, 0, 0, 1, 1);
    tw.registry.make(CLS.info, 10, 0, 0, 0, 1, 2);
    tw.registry.make(CLS.info, 10, 0, 0, 0, 1, 3);
    tw.registry.make(CLS.info, 10, 0, 0, 0, 1, 4);
    trig = new Triggers({
      registry: tw.registry, engine: tw.engine, playerId: 1,
      player: () => player, clock: () => clock, aiSignal: (k, id, r) => { signals.push(`${k}:${id}:${r}`); },
    });
    trig.load([
      info(1, 10, 0, 0, [0, 0, 1], [100, 1, 0]),
      info(2, 11, 0, 0, [0, 3, 0], [0, 1, 0]),
      info(3, 12, 0, 0, [0, 0, 7], [2, 1, 3]),
      info(4, 46, 0, 0, [1, 0, 0], [250, 0, 0]),
    ]);
  });
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { trig.update(TRIGGER_INTERVAL_MS); tw.engine.update(0); } };

  it('area trigger fires while the player is inside and stops when disabled', () => {
    trig.stop(2);
    trig.stop(3);
    tick();
    expect(g('t')).toBe('0');
    player = { x: 30, y: 0, z: 40 };
    tick();
    expect(g('t')).toBe('1');
    trig.stop(1);
    tick();
    expect(g('t')).toBe('1');
    trig.start(1);
    tick();
    expect(g('t')).toBe('2');
    expect(signals).toEqual(['distract:4:250', 'distract:4:250', 'distract:4:250', 'distract:4:250']);
  });

  it('time trigger fires every N seconds and item trigger on count', () => {
    trig.stop(1);
    tick(2);
    expect(g('t')).toBe('0');
    tick();
    expect(g('t')).toBe('1');
    const log = tw.registry.make(CLS.item, 7, 0, 0, 0, 3);
    tw.registry.store(log.id, CLS.unit, 1);
    trig.stop(2);
    tick();
    expect(g('t')).toBe('2');
    trig.stopAll();
    tick();
    expect(g('t')).toBe('2');
    trig.start(2);
    tw.registry.remove(CLS.info, 2);
    tick(3);
    expect(g('t')).toBe('2');
    expect(trig.states().map(x => x[0])).toEqual([1, 3, 4]);
  });
});
