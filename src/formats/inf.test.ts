import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { readRefText, MOD_ROOT } from '../test/reference';
import { parseInf, toEntityDef, buildDefTable } from './inf';

describe('parseInf', () => {
  it('parses palms', () => {
    const entries = parseInf(readRefText('sys/objects_palms.inf'));
    const palm = entries.find(e => e.id === 1)!;
    expect(palm.comment).toBe('Palm');
    expect(palm.fields.get('model')).toEqual(['gfx\\palm01.b3d']);
    expect(palm.script).toContain('on:kill');
    const def = toEntityDef(palm);
    expect(def.name).toBe('Palm');
    expect(def.model).toBe('gfx\\palm01.b3d');
    expect(def.scale).toEqual([2.3, 2.3, 2.3]);
    expect(def.fx).toBe(16);
    expect(def.color).toEqual([255, 255, 255]);
    expect(def.alpha).toBe(1);
  });
  it('parses raptor anims', () => {
    const def = toEntityDef(parseInf(readRefText('sys/units.inf')).find(e => e.id === 2)!);
    expect(def.anims.get('idle1')).toEqual({ start: 4, end: 8, speed: 0.02 });
    expect(def.scale).toEqual([0.5, 0.5, 0.5]);
  });
  it('keeps repeated keys', () => {
    const tree = parseInf(readRefText('sys/objects_trees.inf')).find(e => e.id === 10)!;
    expect(tree.fields.get('find')!.length).toBe(5);
  });
  it('parses every sys inf without throwing', () => {
    for (const f of readdirSync(`${MOD_ROOT}/sys`).filter(f => f.endsWith('.inf'))) {
      expect(() => parseInf(readRefText(`sys/${f}`)), f).not.toThrow();
    }
  });
  it('builds table across split files', () => {
    const files = readdirSync(`${MOD_ROOT}/sys`).filter(f => /^objects.*\.inf$/i.test(f));
    const table = buildDefTable(files.map(f => readRefText(`sys/${f}`)));
    expect(table.get(1)!.name).toBe('Palm');
    expect(table.get(10)!.name).toBe('Tree');
  });
});
