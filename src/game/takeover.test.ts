import { describe, it, expect } from 'vitest';
import { collectTakeover, applyTakeover, parseFlags } from './takeover';
import { makeTestWorld, testDef, type TestWorld } from './test-world';
import { CLS } from './entities';

function world(): TestWorld {
  return makeTestWorld({
    objects: new Map(),
    units: new Map([[1, testDef({ id: 1, name: 'Player', maxweight: 25000 })]]),
    items: new Map([[7, testDef({ id: 7, name: 'Log', weight: 100 })], [22, testDef({ id: 22, name: 'Flint', weight: 10 })]]),
  });
}

describe('takeover', () => {
  it('parses loadmap flags', () => {
    expect(parseFlags(['1', '1', '0', '0', '0', '1'])).toEqual({ skills: true, items: true, vars: false, diary: false, states: false, locks: true });
    expect(parseFlags([])).toEqual({ skills: false, items: false, vars: false, diary: false, states: false, locks: false });
  });

  it('collects by flags and applies to a fresh world', () => {
    const a = world();
    const log = a.registry.make(CLS.item, 7, 0, 0, 0, 3);
    a.registry.store(log.id, CLS.unit, 1);
    const flint = a.registry.make(CLS.item, 22, 0, 0, 0, 1);
    a.registry.store(flint.id, CLS.unit, 1);
    a.engine.vars.globals.set('quest', '2');
    a.host.diary.push({ title: 'Day 1', text: 'Stranded.' });
    a.engine.states.add(CLS.unit, 1, 18);
    a.host.locks.add('building:5');
    a.host.locks.add('combi:x');
    a.host.skills.inc('wood', 3, 'Lumbering');
    const src = { registry: a.registry, playerId: 1, weaponTyp: 22, engine: a.engine, diary: a.host.diary, locks: a.host.locks, skills: a.host.skills };
    const partial = collectTakeover(src, parseFlags(['1', '1', '0', '0', '0', '1']));
    expect(partial.items).toEqual([{ typ: 7, count: 3 }, { typ: 22, count: 1 }]);
    expect(partial.weapon).toBe(22);
    expect(partial.vars).toEqual([]);
    expect(partial.diary).toEqual([]);
    expect(partial.states).toEqual([]);
    expect(partial.locks).toEqual(['building:5']);
    const full = collectTakeover(src, parseFlags(['1', '1', '1', '1', '1', '1']));
    expect(full.vars).toEqual([['quest', '2']]);
    expect(full.diary).toEqual([{ title: 'Day 1', text: 'Stranded.' }]);
    expect(full.states).toEqual([18]);

    const b = world();
    const hands: number[] = [];
    expect(partial.skills).toEqual([{ name: 'wood', value: 3, caption: 'Lumbering' }]);
    applyTakeover({ registry: b.registry, playerId: 1, engine: b.engine, diary: b.host.diary, locks: b.host.locks, skills: b.host.skills, takeInHand: t => { hands.push(t); } }, JSON.parse(JSON.stringify(full)));
    expect(b.host.skills.value('wood')).toBe(3);
    expect(b.registry.countStored(CLS.unit, 1, 7)).toBe(3);
    expect(b.registry.countStored(CLS.unit, 1, 22)).toBe(1);
    expect(hands).toEqual([22]);
    expect(b.engine.vars.globals.get('quest')).toBe('2');
    expect(b.host.diary).toHaveLength(1);
    expect(b.engine.states.has(CLS.unit, 1, 18)).toBe(true);
    expect(b.host.locks.has('building:5')).toBe(true);
  });
});
