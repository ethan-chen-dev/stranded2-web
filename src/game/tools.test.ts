import { describe, it, expect, beforeEach } from 'vitest';
import { Tools, type ToolView } from './tools';
import { makeTestWorld, testDef, type TestWorld } from './test-world';
import { CLS, STORED_INSIDE } from './entities';

let tw: TestWorld;
let t: Tools;
/** 地形：x < -500 为海。 */
const terrainY = (x: number) => (x < -500 ? -50 : 10);
const at = (x: number, z: number, dirX = 1, dirZ = 0): ToolView => ({ x, y: 30, z, dirX, dirZ });
beforeEach(() => {
  tw = makeTestWorld({ objects: new Map(), units: new Map([[1, testDef({ id: 1, maxweight: 25000 })]]), items: new Map([[23, testDef({ id: 23, name: 'Stone', weight: 500 })], [24, testDef({ id: 24, name: 'Branch', weight: 100 })]]) });
  const area = tw.registry.make(CLS.info, 42, 100, 10, 100, 1, 5);
  for (const typ of [23, 24]) {
    const pool = tw.registry.make(CLS.item, typ, 0, 0, 0, 3);
    pool.parentClass = CLS.info; pool.parentId = area.id; pool.parentMode = STORED_INSIDE;
  }
  t = new Tools({ registry: tw.registry, engine: tw.engine, playerId: 1, infoRadius: id => (id === 5 ? 50 : 0), terrainY, random: (min) => (tw.random.length ? tw.random.shift()! : min), message: m => { tw.messages.push(m); }, sound: () => undefined, digTimeMs: 2500, fishTimeMs: 5500 });
  tw.engine.setMapScript('on:dig_failure { $digfail=1; } on:fish_success { $fishok=1; } on:fish_failure { $fishfail=1; }', 'test');
});
const g = (n: string) => tw.engine.vars.globals.get(n) ?? '0';

describe('Tools', () => {
  it('starts with original timings', () => {
    expect(t.start('dig')).toEqual({ title: 'digging', ms: 2500 });
    expect(t.start('fish')).toEqual({ title: 'fishing', ms: 5500 });
  });
  it('digs a random item from the area pool', () => {
    tw.random = [1];
    expect(t.finish('dig', at(120, 110))).toBe(true);
    expect(tw.registry.countStored(CLS.unit, 1, 24)).toBe(1);
    expect(tw.registry.countStored(CLS.info, 5, 24)).toBe(2);
    tw.engine.update(0);
    expect(g('digfail')).toBe('0');
  });
  it('only the first responder gets the dig event, and nothing else raises dig_failure', () => {
    tw.registry.make(CLS.info, 36, 1000, 10, 1000, 1, 7);
    tw.registry.make(CLS.info, 36, 1010, 10, 1000, 1, 8);
    tw.engine.addInstanceScript(CLS.info, 7, 'on:dig { $a=1; }');
    tw.engine.addInstanceScript(CLS.info, 8, 'on:dig { $b=1; }');
    expect(t.finish('dig', at(1005, 1000))).toBe(true);
    tw.engine.update(0);
    expect([g('a'), g('b'), g('digfail')]).toEqual(['1', '0', '0']);
    expect(t.finish('dig', at(3000, 3000))).toBe(false);
    tw.engine.update(0);
    expect(g('digfail')).toBe('1');
  });
  it('fishing outside an area succeeds only when water is ahead', () => {
    expect(t.finish('fish', at(-450, 0, -1, 0))).toBe(false);
    tw.engine.update(0);
    expect([g('fishok'), g('fishfail')]).toEqual(['1', '0']);
    expect(t.finish('fish', at(2000, 0, 1, 0))).toBe(false);
    tw.engine.update(0);
    expect(g('fishfail')).toBe('1');
  });
});
