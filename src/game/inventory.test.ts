import { describe, it, expect } from 'vitest';
import { Inventory } from './inventory';

const defs = (typ: number) => (typ === 9 ? { weight: 500 } : typ === 24 ? { weight: 100 } : undefined);

describe('Inventory', () => {
  it('stores within weight limit', () => {
    const inv = new Inventory(25000, defs);
    expect(inv.store(9, 51)).toBe(50);
    expect(inv.usedWeight).toBe(25000);
    expect(inv.store(9, 1)).toBe(0);
    expect(inv.store(24, 1)).toBe(0);
  });
  it('merges same type', () => {
    const inv = new Inventory(25000, defs);
    inv.store(24, 2);
    inv.store(24, 3);
    expect(inv.count(24)).toBe(5);
    expect(inv.slots.size).toBe(1);
  });
  it('removes up to what it has', () => {
    const inv = new Inventory(25000, defs);
    inv.store(24, 3);
    expect(inv.remove(24, 5)).toBe(3);
    expect(inv.count(24)).toBe(0);
    expect(inv.slots.has(24)).toBe(false);
  });
  it('treats unknown weight as zero', () => {
    const inv = new Inventory(100, defs);
    expect(inv.store(999, 10)).toBe(10);
  });
});
