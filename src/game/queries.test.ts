import { describe, it, expect } from 'vitest';
import { storageValue, freeSpace } from './queries';
import { makeTestWorld, testDef } from './test-world';
import { CLS } from './entities';
import { ScriptEngine } from '../script/engine';
import { createRegistry } from '../script/commands';
import { FakeHost } from '../script/fake-host';

describe('queries', () => {
  it('storage reports used weight, remaining and capacity', () => {
    const tw = makeTestWorld({
      objects: new Map([[5, testDef({ id: 5, name: 'Chest', maxweight: 1000 })]]),
      units: new Map([[1, testDef({ id: 1, name: 'Player', maxweight: 25000 })]]),
      items: new Map([[7, testDef({ id: 7, name: 'Log', weight: 100 })]]),
    });
    const chest = tw.world.create(CLS.object, 5, 0, 0)!;
    const log = tw.registry.make(CLS.item, 7, 0, 0, 0, 3);
    tw.registry.store(log.id, CLS.object, chest.id);
    expect(storageValue(tw.registry, CLS.object, chest.id, 0)).toBe(300);
    expect(storageValue(tw.registry, CLS.object, chest.id, 1)).toBe(-700);
    expect(storageValue(tw.registry, CLS.object, chest.id, 2)).toBe(1000);
    expect(storageValue(tw.registry, CLS.item, log.id, 0)).toBe(100);
    expect(freeSpace(tw.registry, 0, 0, 0, 20, { objects: true, units: false, items: false, infos: false })).toBe(false);
    expect(freeSpace(tw.registry, 500, 0, 500, 20, { objects: true, units: true, items: true, infos: false })).toBe(true);
    expect(freeSpace(tw.registry, 0, 0, 0, 20, { objects: false, units: false, items: true, infos: false })).toBe(true);
  });

  it('def_override replaces and def_extend appends type scripts', () => {
    const host = new FakeHost();
    host.ents.push({ cls: CLS.item, id: 3, typ: 9, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, health: 1, healthMax: 1, count: 1, parentClass: 0, parentId: 0, parentMode: 0 });
    host.files.set('scripts/x.s2s', 'on:use { $b=1; }');
    const engine = new ScriptEngine(host, createRegistry());
    engine.setTypeScript(CLS.item, 9, 'on:use { $a=1; }', 'items');
    engine.runText('def_extend "item",9,"scripts/x.s2s";', { cls: 0, id: 0, event: 'test', info: '' }, 'test');
    engine.runNow(CLS.item, 3, 'use');
    expect([engine.vars.globals.get('a'), engine.vars.globals.get('b')]).toEqual(['1', '1']);
    engine.vars.freeGlobals();
    engine.runText('def_override "item",9,"scripts/x.s2s";', { cls: 0, id: 0, event: 'test', info: '' }, 'test');
    engine.runNow(CLS.item, 3, 'use');
    expect([engine.vars.globals.get('a'), engine.vars.globals.get('b')]).toEqual([undefined, '1']);
    engine.runText('def_free "item",9;', { cls: 0, id: 0, event: 'test', info: '' }, 'test');
    expect(engine.typeScript(CLS.item, 9)).toBeUndefined();
  });
});
