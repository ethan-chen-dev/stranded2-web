import { describe, it, expect } from 'vitest';
import { ItemPhysics } from './itemphysics';
import { makeTestWorld, testDef, flatMap } from './test-world';
import { CLS } from './entities';

function setup(opts: { ground?: number; floor?: number | null } = {}) {
  const tw = makeTestWorld({
    objects: new Map(),
    units: new Map(),
    items: new Map([
      [1, testDef({ id: 1, name: 'Stone', mat: 'stone', autofade: 500 })],
      [2, testDef({ id: 2, name: 'Log', mat: 'wood', autofade: 500 })],
    ]),
  }, flatMap());
  let floor = opts.floor ?? null;
  const phys = new ItemPhysics({
    registry: tw.registry, sync: () => undefined,
    terrainY: () => opts.ground ?? 0,
    floorBelow: (_x, top, bottom) => (floor !== null && top >= floor && bottom <= floor ? floor : null),
  });
  const run = (ms: number, start = 0) => { for (let t = start; t < start + ms; t += 50) phys.update(50, t, { x: 0, y: 0, z: 0 }); };
  return { tw, phys, run, setFloor: (v: number | null) => { floor = v; } };
}

describe('ItemPhysics', () => {
  it('drops a loose item onto the ground', () => {
    const { tw, run } = setup();
    const stone = tw.world.create(CLS.item, 1, 0, 0)!;
    stone.y = 80;
    run(3000);
    expect(stone.y).toBe(1);
  });
  it('leaves items hanging on a parent where they are', () => {
    const { tw, run } = setup();
    const fruit = tw.world.create(CLS.item, 1, 0, 0)!;
    fruit.y = 40;
    fruit.parentClass = CLS.object;
    fruit.parentId = 3;
    run(3000);
    expect(fruit.y).toBe(40);
  });
  it('rests on an object and falls again once objects change', () => {
    const { tw, phys, run, setFloor } = setup({ floor: 30 });
    const stone = tw.world.create(CLS.item, 1, 0, 0)!;
    stone.y = 80;
    run(3000);
    expect(stone.y).toBe(30);
    setFloor(null);
    run(1000, 3000);
    expect(stone.y).toBe(30);
    phys.reset();
    run(3000, 4000);
    expect(stone.y).toBe(1);
  });
  it('floats wood up to the surface over deep water and sinks stone', () => {
    const { tw, run } = setup({ ground: -80 });
    const log = tw.world.create(CLS.item, 2, 0, 0)!;
    const stone = tw.world.create(CLS.item, 1, 10, 0)!;
    log.y = -80;
    stone.y = -1;
    run(10000);
    expect(log.y).toBe(-1);
    expect(stone.y).toBe(-79);
  });
  it('does not simulate items beyond their fade distance', () => {
    const { tw, run } = setup();
    const stone = tw.world.create(CLS.item, 1, 2000, 0)!;
    stone.y = 80;
    run(3000);
    expect(stone.y).toBe(80);
  });
});
