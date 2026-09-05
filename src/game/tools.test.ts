import { describe, it, expect, beforeEach } from 'vitest';
import { Tools } from './tools';
import { makeTestWorld, testDef, type TestWorld } from './test-world';
import { CLS, STORED_INSIDE } from './entities';

let tw: TestWorld;
let t: Tools;
beforeEach(() => {
  tw = makeTestWorld({ objects: new Map(), units: new Map([[1, testDef({ id: 1, maxweight: 25000 })]]), items: new Map([[23, testDef({ id: 23, name: 'Stone', weight: 500 })], [24, testDef({ id: 24, name: 'Branch', weight: 100 })]]) });
  const area = tw.registry.make(CLS.info, 42, 100, 100, 1, 1, 5);
  for (const typ of [23, 24]) {
    const pool = tw.registry.make(CLS.item, typ, 0, 0, 0, 3);
    pool.parentClass = CLS.info; pool.parentId = area.id; pool.parentMode = STORED_INSIDE;
  }
  t = new Tools({ registry: tw.registry, engine: tw.engine, playerId: 1, infoRadius: id => (id === 5 ? 50 : 0), random: (min) => (tw.random.length ? tw.random.shift()! : min), message: m => { tw.messages.push(m); }, sound: () => undefined, digTimeMs: 2500, fishTimeMs: 5500 });
});

describe('Tools', () => {
  it('starts with original timings', () => {
    expect(t.start('dig')).toEqual({ title: 'digging', ms: 2500 });
    expect(t.start('fish')).toEqual({ title: 'fishing', ms: 5500 });
  });
  it('digs a random item from the area pool', () => {
    tw.random = [1];
    expect(t.finish('dig', 120, 110)).toBe(true);
    expect(tw.registry.countStored(CLS.unit, 1, 24)).toBe(1);
    expect(tw.registry.countStored(CLS.info, 5, 24)).toBe(2);
  });
  it('fails outside the area', () => {
    expect(t.finish('dig', 1000, 1000)).toBe(false);
    expect(tw.messages.at(-1)).toContain('挖不到');
  });
});
