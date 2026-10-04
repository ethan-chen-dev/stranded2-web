import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ObjectBehaviour } from './objectbehaviour';
import { makeTestWorld, testDef } from './test-world';
import { CLS } from './entities';
import { P } from '../render/particles';

function setup(visible = true) {
  const tw = makeTestWorld({
    objects: new Map([
      [1, testDef({ id: 1, name: 'Palm', swayspeed: 1, swaypower: 2 })],
      [2, testDef({ id: 2, name: 'Bang Mushroom', behaviour: 'closekill' })],
      [3, testDef({ id: 3, name: 'Poison Flower', behaviour: 'closetrigger' })],
      [4, testDef({ id: 4, name: 'Spring', behaviour: 'fountain' })],
    ]),
    units: new Map(), items: new Map(),
  });
  const log = { killed: [] as number[], triggered: [] as number[], particles: [] as number[], loops: [] as string[] };
  const ob = new ObjectBehaviour({
    registry: tw.registry, visible: () => visible,
    player: () => ({ x: 0, y: 0, z: 0 }), camera: () => ({ x: 0, y: 0, z: 0 }),
    particle: (_x, _y, _z, typ) => { log.particles.push(typ); return null; },
    channel: (key, f) => { log.loops.push(`${key}=${f}`); },
    kill: rec => { log.killed.push(rec.id); }, trigger: rec => { log.triggered.push(rec.id); },
    windsway: () => true,
  });
  return { tw, ob, log };
}

describe('ObjectBehaviour', () => {
  it('sways trees by sin(angle)*swaypower in roll', () => {
    const { tw, ob } = setup();
    const palm = tw.world.create(CLS.object, 1, 500, 500)!;
    palm.object = new THREE.Object3D();
    let max = 0;
    for (let t = 0; t < 8000; t += 20) { ob.update(20, t); max = Math.max(max, Math.abs(palm.object.rotation.z)); }
    expect(max).toBeGreaterThan(1.9 * Math.PI / 180);
    expect(max).toBeLessThanOrEqual(2 * Math.PI / 180 + 1e-9);
  });
  it('blows up a bang mushroom and triggers a poison flower when the player comes close', () => {
    const { tw, ob, log } = setup();
    const near = tw.world.create(CLS.object, 2, 20, 0)!;
    tw.world.create(CLS.object, 2, 200, 0);
    const flower = tw.world.create(CLS.object, 3, 0, 30)!;
    for (const r of tw.registry.all(CLS.object)) r.object = new THREE.Object3D();
    for (let t = 20; t <= 1000; t += 20) ob.update(20, t);
    expect(log.killed.every(id => id === near.id)).toBe(true);
    expect(log.killed.length).toBeGreaterThan(0);
    expect(log.triggered).toEqual([flower.id, flower.id]);
  });
  it('splashes a fountain and plays its loop only nearby, and does nothing out of view', () => {
    const { tw, ob, log } = setup();
    tw.world.create(CLS.object, 4, 50, 0)!.object = new THREE.Object3D();
    for (let t = 20; t <= 200; t += 20) ob.update(20, t);
    expect(log.particles.filter(p => p === P.splash).length).toBe(4);
    expect(log.loops.length).toBeGreaterThan(0);
    const hidden = setup(false);
    hidden.tw.world.create(CLS.object, 2, 0, 0)!.object = new THREE.Object3D();
    for (let t = 20; t <= 1000; t += 20) hidden.ob.update(20, t);
    expect(hidden.log.killed).toEqual([]);
  });
});
