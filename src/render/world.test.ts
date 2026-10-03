import { describe, it, expect } from 'vitest';
import { applyFreePlacement, objectHeight, groundPitch } from './world';
import { worldHeight, SEA_LEVEL } from './terrain';
import { flatMap, makeTestWorld, testDef } from '../game/test-world';
import { CLS } from '../game/entities';

describe('applyFreePlacement', () => {
  it('sets object height and tilt, and only the height for units', () => {
    const t = makeTestWorld({ objects: new Map([[1, testDef({ id: 1 })]]), units: new Map([[2, testDef({ id: 2 })]]), items: new Map() });
    const crate = t.registry.make(CLS.object, 1, 0, 30, 0, 1, 354);
    const unit = t.registry.make(CLS.unit, 2, 0, 30, 0, 1, 5);
    const map = flatMap();
    map.extensions = [
      { typ: 0, parentClass: 1, parentId: 354, mode: 6, key: 'f', value: '23.5578,-17.15,-12.45', stuff: '' },
      { typ: 0, parentClass: 2, parentId: 5, mode: 6, key: 'f', value: '-66,10,20', stuff: '' },
      { typ: 0, parentClass: 1, parentId: 999, mode: 6, key: 'f', value: '1,2,3', stuff: '' },
      { typ: 0, parentClass: 0, parentId: 0, mode: 6, key: 'lasttime', value: '', stuff: '' },
    ];
    const applied: number[] = [];
    applyFreePlacement(map, t.registry, rec => applied.push(rec.id));
    expect([crate.y, crate.pitch, crate.roll]).toEqual([23.5578, -17.15, -12.45]);
    expect([unit.y, unit.pitch, unit.roll]).toEqual([-66, 0, 0]);
    expect(applied).toEqual([354, 5]);
  });
});

describe('object placement', () => {
  it('lifts water-aligned objects to the surface and leaves the rest on the seabed', () => {
    const map = flatMap(16, 0.1);
    const seabed = worldHeight(map, 0, 0);
    expect(seabed).toBeLessThan(0);
    expect(objectHeight(map, testDef({ id: 1, align: 1 }), 0, 0)).toBe(SEA_LEVEL);
    expect(objectHeight(map, testDef({ id: 2 }), 0, 0)).toBe(seabed);
  });
  it('tilts a ground-aligned object nose up when the ground rises ahead', () => {
    const map = flatMap(16, 0.5);
    const n1 = 17;
    for (let gx = 0; gx < n1; gx++) for (let gz = 0; gz < n1; gz++) map.heights[gx * n1 + gz] = 0.3 + gz * 0.02;
    const t = makeTestWorld({ objects: new Map([[1, testDef({ id: 1, align: 2 })]]), units: new Map(), items: new Map() });
    const pipe = t.registry.make(CLS.object, 1, 0, worldHeight(map, 0, 0), 0, 1, 1);
    expect(groundPitch(map, pipe)).toBeLessThan(0);
    pipe.yaw = 180;
    expect(groundPitch(map, pipe)).toBeGreaterThan(0);
    expect(groundPitch(flatMap(), { ...pipe, y: worldHeight(flatMap(), 0, 0) })).toBeCloseTo(0);
  });
});
