import { describe, it, expect, beforeEach } from 'vitest';
import { Build, STATE_BUILDPLACE, SITE_LAND } from './build';
import { makeTestWorld, testDef, type TestWorld } from './test-world';
import { parseBuildings } from '../formats/buildings';
import { CLS } from './entities';

const buildings = parseBuildings(`### Tent
id=1
group=building
objectid=184
req=97
script=start
	unlockbuilding 3;
script=end
### Shelter
id=2
objectid=165
req=24,2
req=15,3
### Fire
id=3
objectid=170
req=24
### Raft
id=101
unitid=30
buildspace=water
req=7,2
### Treehouse
id=8
objectid=190
buildspace=at object
atobject=1
req=24
`);

let tw: TestWorld;
let b: Build;
beforeEach(() => {
  tw = makeTestWorld({
    objects: new Map([[150, testDef({ id: 150, name: 'Site' })], [151, testDef({ id: 151, name: 'Site' })], [184, testDef({ id: 184, name: 'Tent' })], [165, testDef({ id: 165, name: 'Shelter', script: 'on:build_finish { $bf=1; }' })], [170, testDef({ id: 170 })], [190, testDef({ id: 190 })], [1, testDef({ id: 1, name: 'Palm' })]]),
    units: new Map([[1, testDef({ id: 1, maxweight: 25000 })], [30, testDef({ id: 30, name: 'Raft' })]]),
    items: new Map([[97, testDef({ id: 97, name: 'Cloth', weight: 100 })], [24, testDef({ id: 24, name: 'Branch', weight: 100 })], [15, testDef({ id: 15, name: 'Leaf', weight: 10 })], [7, testDef({ id: 7, name: 'Log', weight: 1000 })]]),
  });
  tw.host.catalog.buildings = buildings.map(x => x.id);
  b = new Build({ registry: tw.registry, engine: tw.engine, world: tw.world, locks: tw.host.locks, playerId: 1, buildings, terrainY: () => 0, message: m => { tw.messages.push(m); }, sound: f => { tw.sounds.push(f); } });
});
const give = (typ: number, n: number) => { const r = tw.registry.make(CLS.item, typ, 0, 0, 0, n); tw.registry.store(r.id, CLS.unit, 1); };

describe('Build', () => {
  it('locks and unlocks through scripts', () => {
    tw.engine.runText('lockbuildings; unlockbuilding 1; unlockbuilding 2;', { cls: -1, id: 0, event: 'start', info: '' }, 't');
    expect(b.available().map(x => x.id)).toEqual([1, 2]);
    tw.engine.runText('$l=locked("3"); $u=locked("1");', { cls: -1, id: 0, event: 'start', info: '' }, 't');
    expect([tw.engine.vars.globals.get('l'), tw.engine.vars.globals.get('u')]).toEqual(['1', '0']);
  });
  it('checks placement constraints', () => {
    const mk = (y: number) => new Build({ registry: tw.registry, engine: tw.engine, world: tw.world, locks: tw.host.locks, playerId: 1, buildings, terrainY: () => y, message: () => undefined, sound: () => undefined });
    const land = mk(5);
    const water = mk(-20);
    expect(land.checkSpace(buildings[0], 0, 0)).toBeNull();
    expect(water.checkSpace(buildings[0], 0, 0)).not.toBeNull();
    expect(water.checkSpace(buildings[3], 0, 0)).toBeNull();
    expect(mk(0).checkSpace(buildings[3], 0, 0)).toBeNull();
    expect(land.checkSpace(buildings[3], 0, 0)).not.toBeNull();
    expect(land.checkSpace(buildings[4], 0, 0)).not.toBeNull();
    tw.world.create(CLS.object, 1, 10, 10);
    expect(land.checkSpace(buildings[4], 0, 0)).toBeNull();
  });
  it('places a site with the buildplace state', () => {
    const site = b.place(buildings[1], 100, 200, 45)!;
    expect(site.typ).toBe(SITE_LAND);
    expect(tw.engine.states.find(CLS.object, site.id, STATE_BUILDPLACE)?.value).toBe('2');
    expect(b.builtAt(site.id)).toBe(2);
    expect(b.lastSite).toBe(site.id);
  });
  it('build_start skipevent cancels placement', () => {
    tw.engine.setMapScript('on:build_start { skipevent; }');
    expect(b.place(buildings[1], 0, 0, 0)).toBeNull();
  });
  it('hammer feeds materials one by one and finishes with scripts', () => {
    const site = b.place(buildings[1], 0, 0, 90)!;
    expect(b.hammer(0, 0)).toBe('missing');
    give(24, 2); give(15, 3);
    expect(b.hammer(0, 0)).toBe('added');
    expect(tw.registry.countStored(CLS.object, site.id, 24)).toBe(1);
    expect(tw.registry.countStored(CLS.unit, 1, 24)).toBe(1);
    for (let i = 0; i < 4; i++) expect(b.hammer(0, 0)).toBe('added');
    expect(b.hammer(0, 0)).toBe('finished');
    expect(tw.registry.all(CLS.object, SITE_LAND).length).toBe(0);
    const shelter = tw.registry.all(CLS.object, 165)[0];
    expect(shelter.yaw).toBe(90);
    expect(tw.engine.vars.globals.get('bf')).toBe('1');
    expect(b.hammer(500, 500)).toBe('none');
  });
  it('building script runs with the new entity and unlocks', () => {
    tw.host.locks.add('building:3');
    b.place(buildings[0], 0, 0, 0);
    give(97, 1);
    expect(b.hammer(0, 0)).toBe('added');
    expect(b.hammer(0, 0)).toBe('finished');
    expect(tw.host.locks.has('building:3')).toBe(false);
  });
  it('builds units on water', () => {
    const water = new Build({ registry: tw.registry, engine: tw.engine, world: tw.world, locks: tw.host.locks, playerId: 1, buildings, terrainY: () => -20, message: () => undefined, sound: () => undefined });
    const site = water.place(buildings[3], 0, 0, 0)!;
    expect(site.typ).toBe(151);
    give(7, 2);
    expect(water.hammer(0, 0)).toBe('added');
    expect(water.hammer(0, 0)).toBe('added');
    expect(water.hammer(0, 0)).toBe('finished');
    expect(tw.registry.all(CLS.unit, 30).length).toBe(1);
  });
});
