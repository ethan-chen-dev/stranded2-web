import { describe, it, expect, beforeEach } from 'vitest';
import { EntityRegistry, CLS } from './entities';
import type { EntityDef } from '../formats/inf';

function def(over: Partial<EntityDef>): EntityDef {
  return {
    id: 0, name: '', model: '', icon: '', scale: [1, 1, 1], color: [255, 255, 255], alpha: 1, fx: 0, autofade: 0,
    aligntowater: false, anims: new Map(), weight: 0, col: 1, eyes: 0, colxr: 1, colyr: 1, speed: 0, store: 100,
    maxweight: 0, group: '', behaviour: '', mat: '', health: 100, vars: [],
    damage: 0, rate: 500, attackrange: 45, weaponstate: '', findratio: 30, finds: [], loots: [], ...over,
  };
}

let reg: EntityRegistry;
beforeEach(() => {
  reg = new EntityRegistry({
    objects: new Map(),
    units: new Map([[1, def({ id: 1, name: 'Player', maxweight: 25000 })]]),
    items: new Map([[9, def({ id: 9, name: 'Meat', weight: 500 })], [24, def({ id: 24, name: 'Branch', weight: 100 })]]),
  });
  reg.make(CLS.unit, 1, 0, 17, 0, 1, 1);
});

describe('EntityRegistry', () => {
  it('stores within capacity and merges', () => {
    const a = reg.make(CLS.item, 9, 0, 0, 0, 40);
    expect(reg.store(a.id, CLS.unit, 1)).toBe(40);
    expect(reg.countStored(CLS.unit, 1, 9)).toBe(40);
    const b = reg.make(CLS.item, 9, 0, 0, 0, 20);
    expect(reg.store(b.id, CLS.unit, 1)).toBe(10);
    expect(reg.get(CLS.item, b.id)!.count).toBe(10);
    expect(reg.countStored(CLS.unit, 1, 9)).toBe(50);
    expect(reg.storedIn(CLS.unit, 1, 9).length).toBe(1);
    expect(reg.capacity(CLS.unit, 1)).toBe(0);
    const c = reg.make(CLS.item, 24, 0, 0, 0, 1);
    expect(reg.store(c.id, CLS.unit, 1)).toBe(0);
  });
  it('unstores whole or split', () => {
    const a = reg.make(CLS.item, 24, 0, 0, 0, 5);
    reg.store(a.id, CLS.unit, 1);
    const part = reg.unstore(a.id, 2, 7, 8, 9)!;
    expect(part.id).not.toBe(a.id);
    expect([part.count, part.x, reg.get(CLS.item, a.id)!.count]).toEqual([2, 7, 3]);
    const whole = reg.unstore(a.id, 3, 1, 2, 3)!;
    expect(whole.id).toBe(a.id);
    expect([whole.parentMode, whole.count, whole.z]).toEqual([0, 3, 3]);
  });
  it('consumes counts and removes at zero', () => {
    const a = reg.make(CLS.item, 24, 0, 0, 0, 2);
    expect(reg.consume(a.id, 1)).toBe(false);
    expect(reg.consume(a.id, 1)).toBe(true);
    expect(reg.get(CLS.item, a.id)).toBeUndefined();
  });
  it('allocates ids', () => {
    reg.make(CLS.item, 24, 0, 0, 0, 1, 10);
    expect(reg.nextId(CLS.item)).toBe(11);
    expect(reg.nextId(CLS.object)).toBe(1);
  });
});
