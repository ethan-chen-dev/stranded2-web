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
  it('reads player, item and collision fields', () => {
    const units = parseInf(readRefText('sys/units.inf'));
    const player = toEntityDef(units.find(e => e.id === 1)!);
    expect([player.eyes, player.colxr, player.colyr, player.speed, player.store, player.maxweight]).toEqual([16, 8, 17, 1.6, 100, 25000]);
    const meat = toEntityDef(parseInf(readRefText('sys/items_edible.inf')).find(e => e.id === 9)!);
    expect(meat.weight).toBe(500);
    const palm = toEntityDef(parseInf(readRefText('sys/objects_palms.inf')).find(e => e.id === 1)!);
    expect(palm.col).toBe(1);
    const grass = parseInf(readRefText('sys/objects_gras.inf')).map(toEntityDef).find(d => d.col === 0);
    expect(grass).toBeDefined();
  });
  it('reads behaviour, material, health and vars', () => {
    const palm = toEntityDef(parseInf(readRefText('sys/objects_palms.inf')).find(e => e.id === 1)!);
    expect([palm.behaviour, palm.mat, palm.health, palm.group]).toEqual(['tree', 'wood', 300, 'palm']);
    const withVar = readdirSync(`${MOD_ROOT}/sys`).filter(f => f.endsWith('.inf'))
      .flatMap(f => parseInf(readRefText(`sys/${f}`)).map(toEntityDef)).find(d => d.vars.length > 0);
    expect(withVar).toBeDefined();
    expect(withVar!.vars[0].name.length).toBeGreaterThan(0);
  });
  it('reads weapon, find and loot fields', () => {
    const palm = toEntityDef(parseInf(readRefText('sys/objects_palms.inf')).find(e => e.id === 1)!);
    expect(palm.finds.length).toBe(1);
    expect(palm.finds[0]).toEqual({ typ: 15, ratio: 15, max: 3, min: 1, reqTyp: 0 });
    expect(palm.findratio).toBe(30);
    const tree = toEntityDef(parseInf(readRefText('sys/objects_trees.inf')).find(e => e.id === 10)!);
    expect(tree.finds.length).toBe(5);
    expect(tree.finds[4]).toEqual({ typ: 107, ratio: 150, max: 3, min: 1, reqTyp: 28 });
    const raptor = toEntityDef(parseInf(readRefText('sys/units.inf')).find(e => e.id === 2)!);
    expect(raptor.loots[0]).toEqual({ typ: 9, max: 3 });
    expect(raptor.loots.length).toBeGreaterThanOrEqual(1);
    expect(raptor.attackrange).toBe(65);
    const flint = toEntityDef(parseInf(readRefText('sys/items_tools.inf')).find(e => e.id === 22)!);
    expect([flint.damage, flint.rate]).toEqual([5, 500]);
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
