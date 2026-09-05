import { describe, it, expect, beforeEach } from 'vitest';
import { Combine } from './combine';
import { makeTestWorld, testDef, type TestWorld } from './test-world';
import { parseCombinations, assignGroups } from '../formats/combinations';
import { CLS } from './entities';

let tw: TestWorld;
let c: Combine;
const combis = parseCombinations(`### Bendable Branch
combi=start
id=bendablebranch
req=24
req=38
gen=25
script=start
	process "making bendable",1500;
script=end
combi=end
### Flour
combi=start
id=flour
req=42,9
req=23,1,stay
gen=43
combi=end
### Cancelled
combi=start
id=cancel
req=24
req=23
gen=25
script=start
	skipevent;
script=end
combi=end
`, 'test');
assignGroups(combis);

beforeEach(() => {
  tw = makeTestWorld({
    objects: new Map(), units: new Map([[1, testDef({ id: 1, maxweight: 25000 })]]),
    items: new Map([[24, testDef({ id: 24, name: 'Branch', weight: 100 })], [38, testDef({ id: 38, name: 'Water', weight: 100 })], [25, testDef({ id: 25, name: 'Bendable Branch', weight: 100 })],
      [42, testDef({ id: 42, name: 'Grain', weight: 10 })], [23, testDef({ id: 23, name: 'Stone', weight: 500 })], [43, testDef({ id: 43, name: 'Flour', weight: 100 })]]),
  });
  c = new Combine({ registry: tw.registry, engine: tw.engine, world: tw.world, locks: tw.host.locks, playerId: 1, combinations: combis, message: m => { tw.messages.push(m); }, sound: f => { tw.sounds.push(f); } });
});

function give(typ: number, count: number) {
  const rec = tw.registry.make(CLS.item, typ, 0, 0, 0, count);
  tw.registry.store(rec.id, CLS.unit, 1);
  return tw.registry.storedIn(CLS.unit, 1, typ)[0];
}

describe('Combine', () => {
  it('branch and water make a bendable branch and run the script', () => {
    const sel = [give(24, 2), give(38, 1)];
    const cands = c.candidates(sel);
    expect(cands.map(x => x.combi.key)).toEqual(['bendablebranch']);
    expect(c.execute(cands[0].combi, sel)).toBe(true);
    expect(tw.registry.countStored(CLS.unit, 1, 24)).toBe(1);
    expect(tw.registry.countStored(CLS.unit, 1, 38)).toBe(0);
    expect(tw.registry.countStored(CLS.unit, 1, 25)).toBe(1);
    expect(tw.processes[0].title).toBe('making bendable');
  });
  it('flour keeps the stone and needs nine grains', () => {
    const sel = [give(42, 5), give(23, 1)];
    expect(c.candidates(sel)[0].feasible).toBe(false);
    expect(c.execute(combis[1], sel)).toBe(false);
    tw.registry.storedIn(CLS.unit, 1, 42)[0].count = 9;
    expect(c.execute(combis[1], sel)).toBe(true);
    expect(tw.registry.countStored(CLS.unit, 1, 42)).toBe(0);
    expect(tw.registry.countStored(CLS.unit, 1, 23)).toBe(1);
    expect(tw.registry.countStored(CLS.unit, 1, 43)).toBe(1);
  });
  it('locked combinations are not feasible', () => {
    const sel = [give(24, 1), give(38, 1)];
    tw.host.locks.add('combi:bendablebranch');
    expect(c.candidates(sel)[0].locked).toBe(true);
    expect(c.execute(combis[0], sel)).toBe(false);
  });
  it('script skipevent cancels consumption', () => {
    const sel = [give(24, 1), give(23, 1)];
    expect(c.execute(combis[2], sel)).toBe(true);
    expect(tw.registry.countStored(CLS.unit, 1, 24)).toBe(1);
    expect(tw.registry.countStored(CLS.unit, 1, 25)).toBe(0);
  });
  it('no candidates for wrong selection', () => {
    expect(c.candidates([give(24, 1)])).toEqual([]);
  });
});
