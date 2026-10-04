import { describe, it, expect } from 'vitest';
import { Vehicles } from './vehicles';
import { makeTestWorld, testDef } from './test-world';
import { CLS, type EntityRecord } from './entities';

const vehicle = { acceleration: 0.08, friction: 0.04, steering: 1, maxdepth: 35, flyspeed: 3 };

function setup(ground: (x: number, z: number) => number, behaviourCode: number) {
  const tw = makeTestWorld({
    objects: new Map(), items: new Map(),
    units: new Map([[30, testDef({ id: 30, name: 'Raft', speed: 2.2, turnspeed: 1, colyr: 20, vehicle })]]),
  });
  const killed: number[] = [];
  const waves: number[] = [];
  const v = new Vehicles({
    registry: tw.registry, terrainY: ground, code: () => behaviourCode, sync: () => undefined,
    wave: x => { waves.push(x); }, moveSound: () => undefined, kill: rec => { killed.push(rec.id); },
  });
  const rec = tw.registry.make(CLS.unit, 30, 0, 21, 0, 1, 40) as EntityRecord;
  rec.healthMax = 100;
  return { v, rec, killed, waves };
}

const idle = { forward: false, backward: false, left: false, right: false };

describe('Vehicles', () => {
  it('accelerates to top speed, steers only while moving with steering 1, and coasts to a stop', () => {
    const { v, rec } = setup(() => -50, 501);
    v.ride(40);
    v.update(20, { ...idle, left: true }, false);
    expect(rec.yaw).toBe(0);
    for (let i = 0; i < 60; i++) v.update(20, { ...idle, forward: true }, false);
    expect(v.speed).toBeCloseTo(2.2);
    expect(rec.z).toBeGreaterThan(50);
    v.update(20, { ...idle, forward: true, left: true }, false);
    expect(rec.yaw).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) v.update(20, idle, false);
    expect(v.speed).toBe(0);
  });
  it('stops a boat at the shore and leaves waves on the water', () => {
    const { v, rec, waves } = setup((_x, z) => (z > 30 ? 5 : -50), 501);
    v.ride(40);
    for (let i = 0; i < 100; i++) v.update(20, { ...idle, forward: true }, false);
    expect(rec.z).toBeLessThanOrEqual(31);
    expect(waves.length).toBeGreaterThan(0);
  });
  it('lifts a plane above half speed and caps it at 900', () => {
    const { v, rec } = setup(() => 0, 502);
    v.ride(40);
    for (let i = 0; i < 4000; i++) v.update(20, { ...idle, forward: true }, false);
    expect(rec.y).toBe(900);
  });
  it('destroys a vehicle that sinks below maxdepth and stops driving', () => {
    const { v, rec, killed } = setup(() => -100, 500);
    v.ride(40);
    rec.y = -20;
    v.update(20, idle, false);
    expect(killed).toEqual([40]);
    expect(v.driving).toBe(0);
  });
});
