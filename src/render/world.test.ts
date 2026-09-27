import { describe, it, expect } from 'vitest';
import { applyFreePlacement } from './world';
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
