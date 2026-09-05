import { describe, it, expect } from 'vitest';
import { readRefText } from '../test/reference';
import { parseBuildings } from './buildings';

describe('buildings', () => {
  const list = parseBuildings(readRefText('sys/buildings.inf'));
  it('parses all buildings', () => {
    expect(list.length).toBe(25);
    const tent = list.find(b => b.id === 1)!;
    expect([tent.name, tent.objectId, tent.reqs]).toEqual(['Tent', 184, [{ typ: 97, count: 1 }]]);
    expect(tent.script).toContain('unlockbuilding 3');
    const shelter = list.find(b => b.id === 2)!;
    expect(shelter.reqs).toEqual([{ typ: 24, count: 20 }, { typ: 15, count: 30 }]);
  });
  it('reads units, spaces and site overrides', () => {
    expect(list.some(b => b.unitId > 0)).toBe(true);
    expect(list.some(b => b.space === 'water' || b.space === 'shallow' || b.space === 'landwater')).toBe(true);
    expect(list.some(b => b.space === 'atobject' && b.atObject > 0)).toBe(true);
  });
});
