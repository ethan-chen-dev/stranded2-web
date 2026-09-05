import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Weapons, HAND_COOLDOWN_MS } from './weapons';
import { makeTestWorld, testDef, type TestWorld } from './test-world';
import { CLS } from './entities';

let tw: TestWorld;
let w: Weapons;
let now = 0;
let dir = new THREE.Vector3(0, 0, -1);

function setup(): void {
  tw = makeTestWorld({
    objects: new Map([
      [1, testDef({ id: 1, name: 'Palm', behaviour: 'tree', health: 9, finds: [{ typ: 15, ratio: 15, max: 3, min: 1, reqTyp: 0 }, { typ: 24, ratio: 40, max: 1, min: 1, reqTyp: 0 }, { typ: 107, ratio: 150, max: 3, min: 1, reqTyp: 28 }], script: 'on:kill { $kx=getx("self"); create "item",7,getx("self"),getz("self"); } on:hit { $hits=$hits+1; }' })],
      [5, testDef({ id: 5, name: 'Fireplace', behaviour: 'fireplace', health: 100 })],
    ]),
    units: new Map([
      [1, testDef({ id: 1, name: 'Player', damage: 3, attackrange: 45, colxr: 8, colyr: 17, maxweight: 25000 })],
      [2, testDef({ id: 2, name: 'Raptor', colxr: 15, colyr: 30, health: 7, loots: [{ typ: 9, max: 3 }], script: 'on:kill { $rk=1; }' })],
    ]),
    items: new Map([
      [7, testDef({ id: 7, name: 'Log', weight: 100 })],
      [9, testDef({ id: 9, name: 'Meat', weight: 500 })],
      [15, testDef({ id: 15, name: 'Leaf', weight: 10 })],
      [24, testDef({ id: 24, name: 'Branch', weight: 100 })],
      [22, testDef({ id: 22, name: 'Flint', weight: 500, damage: 5, rate: 500, behaviour: 'blade', script: 'on:impact { $ic=impact_class(); $ii=impact_id(); $fp=compare_behaviour($ic,$ii,"fireplace"); } on:attack1 { $a1=$a1+1; }' })],
      [28, testDef({ id: 28, name: 'Axe', weight: 1000, damage: 10, rate: 700, behaviour: 'blade' })],
      [30, testDef({ id: 30, name: 'Torch', weight: 300, damage: 2, behaviour: 'torch', weaponstate: 'fire' })],
      [50, testDef({ id: 50, name: 'Bow', behaviour: 'bow' })],
      [51, testDef({ id: 51, name: 'Flute', behaviour: 'flute' })],
    ]),
  });
  tw.engine.stateTypes.set('fire', 4);
  now = 0;
  dir = new THREE.Vector3(0, 0, -1);
  w = new Weapons({
    registry: tw.registry, engine: tw.engine, world: tw.world, stats: tw.stats, playerId: 1,
    now: () => now, random: (min, max) => (tw.random.length ? tw.random.shift()! : min),
    eye: () => new THREE.Vector3(0, 16, 0), dir: () => dir.clone(),
    terrainY: () => 0,
    message: t => { tw.messages.push(t); }, sound: f => { tw.sounds.push(f); },
    onUnitDied: rec => { tw.dead.push(rec); },
  });
  tw.host.impact = () => w.impact;
  tw.host.playerWeapon = () => w.weaponTyp;
}

/** 在玩家正前方 30 单位放一个带场景对象的实体。 */
function placeAhead(cls: number, typ: number, dist = 30) {
  const rec = tw.world.create(cls, typ, 0, dist)!;
  rec.y = 0;
  rec.object!.position.set(0, 0, -dist);
  const box = new THREE.Mesh(new THREE.BoxGeometry(10, 40, 10));
  box.position.y = 20;
  rec.object!.add(box);
  rec.object!.updateMatrixWorld(true);
  return rec;
}
const g = (n: string) => tw.engine.vars.globals.get(n) ?? '0';

beforeEach(setup);

describe('Weapons', () => {
  it('hand attack damages 3 with 400 ms cooldown and fires hit', () => {
    const palm = placeAhead(CLS.object, 1);
    expect(w.attack1()).toBe('hit');
    tw.engine.update(0);
    expect(palm.health).toBe(6);
    expect(g('hits')).toBe('1');
    expect(w.attack1()).toBe('cooldown');
    now = HAND_COOLDOWN_MS;
    expect(w.attack1()).toBe('hit');
    expect(palm.health).toBe(3);
    expect(tw.stats.hunger).toBeCloseTo(0.3, 6);
  });
  it('misses when nothing is in front', () => {
    expect(w.attack1()).toBe('miss');
    expect(w.impact).toBeNull();
  });
  it('kills an object, runs its kill script before removal, and spawns the log', () => {
    const palm = placeAhead(CLS.object, 1);
    palm.health = 3;
    expect(w.attack1()).toBe('hit');
    expect(tw.registry.get(CLS.object, palm.id)).toBeUndefined();
    expect(g('kx')).toBe('0.0');
    expect(tw.registry.all(CLS.item, 7).length).toBe(1);
    expect(w.impact?.kill).toBe(true);
    expect(tw.sounds).toContain('treefall.wav');
  });
  it('drops finds into the inventory by weapon requirement and ratio', () => {
    placeAhead(CLS.object, 1);
    tw.random = [30, 20, 1];
    w.attack1();
    expect(tw.registry.countStored(CLS.unit, 1, 24)).toBe(1);
    expect(tw.messages.some(m => m.includes('Branch'))).toBe(true);
    now = 1000;
    tw.random = [31];
    w.attack1();
    expect(tw.registry.countStored(CLS.unit, 1, 24)).toBe(1);
  });
  it('axe unlocks reqTyp finds and uses item damage and rate', () => {
    const palm = placeAhead(CLS.object, 1);
    palm.health = 100;
    const axe = tw.registry.make(CLS.item, 28, 0, 0, 0, 1);
    tw.registry.store(axe.id, CLS.unit, 1);
    expect(w.takeInHand(28)).toBe(true);
    tw.random = [1, 200, 2];
    expect(w.attack1()).toBe('hit');
    expect(palm.health).toBe(90);
    expect(tw.registry.countStored(CLS.unit, 1, 107)).toBe(2);
    now = 600;
    expect(w.attack1()).toBe('cooldown');
    now = 700;
    expect(w.attack1()).toBe('hit');
  });
  it('flint impact script sees the fireplace', () => {
    placeAhead(CLS.object, 5);
    const flint = tw.registry.make(CLS.item, 22, 0, 0, 0, 2);
    tw.registry.store(flint.id, CLS.unit, 1);
    w.takeInHand(22);
    tw.random = [100];
    expect(w.attack1()).toBe('hit');
    tw.engine.update(0);
    expect([g('ic'), g('fp'), g('a1')]).toEqual(['1', '1', '1']);
  });
  it('torch attaches its weapon state', () => {
    const palm = placeAhead(CLS.object, 1);
    palm.health = 100;
    const torch = tw.registry.make(CLS.item, 30, 0, 0, 0, 1);
    tw.registry.store(torch.id, CLS.unit, 1);
    w.takeInHand(30);
    tw.random = [100];
    w.attack1();
    expect(tw.engine.states.has(CLS.object, palm.id, 4)).toBe(true);
  });
  it('kills a unit, spawns loot, marks dead', () => {
    const raptor = tw.world.create(CLS.unit, 2, 0, 30)!;
    raptor.y = 0;
    tw.random = [2];
    expect(w.attack1()).toBe('hit');
    expect(w.attack1()).toBe('cooldown');
    now = 500;
    w.attack1();
    now = 1000;
    w.attack1();
    expect(raptor.dead).toBe(true);
    expect(tw.registry.countStored(CLS.unit, raptor.id, 9)).toBe(2);
    expect(g('rk')).toBe('1');
    expect(tw.dead[0]).toBe(raptor);
  });
  it('bow without ammo is blocked, unknown weapon types are unsupported, skipevent blocks', () => {
    const bow = tw.registry.make(CLS.item, 50, 0, 0, 0, 1);
    tw.registry.store(bow.id, CLS.unit, 1);
    w.takeInHand(50);
    expect(w.attack1()).toBe('blocked');
    const flute = tw.registry.make(CLS.item, 51, 0, 0, 0, 1);
    tw.registry.store(flute.id, CLS.unit, 1);
    w.takeInHand(51);
    expect(w.attack1()).toBe('unsupported');
    w.unequip();
    tw.engine.setTypeScript(CLS.unit, 1, 'on:attack1 { skipevent; }', 'units');
    expect(w.attack1()).toBe('blocked');
  });
  it('hits the ground first when looking down', () => {
    dir = new THREE.Vector3(0, -1, 0);
    expect(w.attack1()).toBe('hit');
    expect(w.impact?.ground).toBe(true);
    expect(w.impact?.cls).toBe(0);
  });
});
