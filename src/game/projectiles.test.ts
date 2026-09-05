import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Weapons } from './weapons';
import { Projectiles, TIMEOUT_MS } from './projectiles';
import { makeTestWorld, testDef, type TestWorld } from './test-world';
import { CLS, STORED_INSIDE, type EntityRecord } from './entities';

let tw: TestWorld;
let w: Weapons;
let pr: Projectiles;
let now = 0;
let ground = 0;

function setup(): void {
  tw = makeTestWorld({
    objects: new Map(),
    units: new Map([
      [1, testDef({ id: 1, name: 'Player', damage: 3, colxr: 8, colyr: 17, maxweight: 25000 })],
      [2, testDef({ id: 2, name: 'Raptor', behaviour: 'raptor', colxr: 15, colyr: 30, health: 100, script: 'on:hit { $rhit=$rhit+1; }' })],
    ]),
    items: new Map([
      [9, testDef({ id: 9, name: 'Meat', behaviour: 'throw', speed: 5, drag: 1, damage: 1, rate: 500, weight: 10, script: 'on:drop { $dropped=$dropped+1; }' })],
      [50, testDef({ id: 50, name: 'Bow', behaviour: 'bow', speed: 10, drag: 0.5, damage: 2, rate: 500, weight: 10, script: 'on:impact { $bi=$bi+1; $bg=impact_ground(); } on:noammo { $na=1; }' })],
      [53, testDef({ id: 53, name: 'Arrow', behaviour: 'ammo:50', drag: 0.2, damage: 3, weight: 5, script: 'on:impact { $ai=$ai+1; }' })],
      [52, testDef({ id: 52, name: 'Spear', behaviour: 'spear', speed: 13, drag: 1, damage: 2, rate: 1500, weight: 500 })],
      [58, testDef({ id: 58, name: 'Pistol', behaviour: 'pistol', speed: 300, damage: 4, rate: 500, weight: 10 })],
      [57, testDef({ id: 57, name: 'Bullet', behaviour: 'ammo:58 ammo:110', damage: 2, weight: 1 })],
    ]),
  });
  now = 0;
  ground = 0;
  w = new Weapons({
    registry: tw.registry, engine: tw.engine, world: tw.world, stats: tw.stats, playerId: 1,
    now: () => now, random: (min) => min,
    eye: () => new THREE.Vector3(0, 16, 0), dir: () => new THREE.Vector3(0, 0, -1),
    terrainY: () => ground,
    message: t => { tw.messages.push(t); }, sound: f => { tw.sounds.push(f); },
  });
  pr = new Projectiles({
    registry: tw.registry, world: tw.world, engine: tw.engine, weapons: w, playerId: 1,
    terrainY: () => ground, now: () => now,
  });
  w.launcher = pr;
  tw.host.impact = () => w.impact;
  tw.host.playerWeapon = () => w.weaponTyp;
}

function give(typ: number, count = 1): EntityRecord {
  const item = tw.registry.make(CLS.item, typ, 0, 0, 0, count);
  tw.registry.store(item.id, CLS.unit, 1);
  return item;
}

function bag(typ: number): number {
  return tw.registry.storedIn(CLS.unit, 1, typ).reduce((s, r) => s + r.count, 0);
}

function placeAhead(typ: number, dist: number): EntityRecord {
  return tw.registry.make(CLS.unit, typ, 0, 30, dist, 1);
}

function fly(ms: number, step = 50): void {
  for (let t = 0; t < ms; t += step) {
    now += step;
    pr.update(step);
    tw.engine.update(step);
  }
}

const g = (n: string) => tw.engine.vars.globals.get(n) ?? '0';

beforeEach(setup);

describe('Projectiles', () => {
  it('bow consumes one arrow and launches a projectile toward the view direction', () => {
    give(50);
    give(53, 2);
    expect(w.takeInHand(50)).toBe(true);
    expect(w.attack1()).toBe('fired');
    expect(bag(53)).toBe(1);
    expect(pr.list).toHaveLength(1);
    const p = pr.list[0];
    expect(p.typ).toBe(53);
    expect(p.damage).toBe(6);
    expect(p.drag).toBeCloseTo(0.7, 6);
    expect(p.yaw).toBeCloseTo(0, 6);
    expect(p.pitch).toBeCloseTo(0, 6);
    ground = -10000;
    fly(1000);
    expect(p.z).toBeGreaterThan(300);
    expect(p.z).toBeLessThan(500);
    expect(p.pitch).toBeCloseTo(35, 3);
    expect(p.y).toBeLessThan(16);
    expect(p.x).toBeCloseTo(0, 6);
  });

  it('arrow hits a unit ahead: bow x arrow damage, hit and impact events', () => {
    give(50);
    give(53, 2);
    const raptor = placeAhead(2, 100);
    w.takeInHand(50);
    w.attack1();
    fly(500);
    expect(raptor.health).toBe(94);
    expect(g('rhit')).toBe('1');
    expect(g('bi')).toBe('1');
    expect(g('bg')).toBe('0');
    expect(g('ai')).toBe('1');
    expect(w.impact?.cls).toBe(CLS.unit);
    expect(w.impact?.id).toBe(raptor.id);
    expect(pr.list).toHaveLength(0);
  });

  it('without ammo the shot is blocked and noammo fires', () => {
    give(50);
    w.takeInHand(50);
    expect(w.attack1()).toBe('blocked');
    tw.engine.update(0);
    expect(g('na')).toBe('1');
    expect(tw.messages.some(m => m.includes('弹药'))).toBe(true);
    expect(pr.list).toHaveLength(0);
  });

  it('thrown meat lands, becomes an item again and fires drop', () => {
    give(9, 2);
    w.takeInHand(9);
    expect(w.attack1()).toBe('fired');
    expect(bag(9)).toBe(1);
    expect(w.weaponTyp).toBe(9);
    fly(5000);
    expect(pr.list).toHaveLength(0);
    const loose = tw.registry.all(CLS.item).filter(r => r.typ === 9 && r.parentMode !== STORED_INSIDE);
    expect(loose).toHaveLength(1);
    expect(loose[0].z).toBeGreaterThan(0);
    expect(g('dropped')).toBe('1');
    expect(w.impact?.ground).toBe(true);
  });

  it('throwing the last item empties the hand and a spear does not respawn', () => {
    give(52);
    w.takeInHand(52);
    expect(w.attack1()).toBe('fired');
    expect(w.weaponTyp).toBe(0);
    fly(5000);
    expect(pr.list).toHaveLength(0);
    expect(tw.registry.all(CLS.item).filter(r => r.typ === 52)).toHaveLength(0);
  });

  it('projectiles time out after 15 seconds', () => {
    give(50);
    give(53);
    w.takeInHand(50);
    w.attack1();
    ground = -100000;
    fly(TIMEOUT_MS - 100);
    expect(pr.list).toHaveLength(1);
    fly(200);
    expect(pr.list).toHaveLength(0);
  });

  it('pistol hits instantly within its speed range and consumes a bullet', () => {
    give(58);
    give(57, 3);
    const raptor = placeAhead(2, 200);
    raptor.object = new THREE.Object3D();
    w.takeInHand(58);
    expect(w.attack1()).toBe('hit');
    expect(bag(57)).toBe(2);
    expect(raptor.health).toBe(92);
    expect(pr.list).toHaveLength(0);
  });
});
