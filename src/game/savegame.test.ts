import { describe, it, expect } from 'vitest';
import { snapshot, restore } from './savegame';
import { makeTestWorld, testDef, type TestWorld } from './test-world';
import { CLS, STORED_INSIDE } from './entities';

function world(): TestWorld {
  return makeTestWorld({
    objects: new Map([[1, testDef({ id: 1, name: 'Palm', health: 9 })]]),
    units: new Map([[1, testDef({ id: 1, name: 'Player', maxweight: 25000 })], [2, testDef({ id: 2, name: 'Raptor', health: 30 })]]),
    items: new Map([[7, testDef({ id: 7, name: 'Log', weight: 100 })]]),
  });
}

describe('savegame', () => {
  it('round-trips entities, vars, states, timers and diary into a fresh world', () => {
    const a = world();
    const palm = a.world.create(CLS.object, 1, 100, 200)!;
    palm.health = 4;
    const raptor = a.registry.make(CLS.unit, 2, 50, 3, 60, 1, 30);
    raptor.dead = true;
    const bag = a.registry.make(CLS.item, 7, 0, 0, 0, 2);
    a.registry.store(bag.id, CLS.unit, 1);
    const loose = a.world.create(CLS.item, 7, 5, 6, 1)!;
    a.engine.vars.globals.set('quest', '3');
    a.engine.vars.setLocal(CLS.object, palm.id, 'hits', '2');
    a.engine.states.add(CLS.object, palm.id, 4).value = '7';
    a.engine.timers.add({ cls: CLS.unit, id: 1, duration: 5000, start: 800, mode: 1, source: 'tick', isScript: false });
    a.host.diary.push({ title: 'D1', text: 'txt' });
    a.host.locks.add('building:9');
    a.host.buffer.set('buf');
    const snap = snapshot({
      mapPath: 'maps/adventure/map02.s2', registry: a.registry, engine: a.engine, now: 1000,
      clock: { day: 3, hour: 14, minute: 30 }, player: { x: 1, y: 2, z: 3, yaw: 45, pitch: -5 },
      stats: { health: 77, hunger: 10, thirst: 20, exhaustion: 30 }, weapon: 7, diary: a.host.diary, locks: a.host.locks, buffer: a.host.buffer.value,
    });
    const json = JSON.parse(JSON.stringify(snap));
    expect(json.entities.length).toBe(5);
    expect(json.timers[0].remaining).toBe(4800);

    const b = world();
    b.world.create(CLS.object, 1, 900, 900);
    let placed: unknown = null;
    const hands: number[] = [];
    restore({
      registry: b.registry, engine: b.engine, world: b.world, playerId: 1, now: 5000,
      clock: b.clock, stats: b.stats,
      setPlayer: p => { placed = p; }, takeInHand: t => { hands.push(t); },
      diary: b.host.diary, locks: b.host.locks, setBuffer: t => b.host.buffer.set(t),
    }, json);
    expect(b.registry.all(CLS.object).map(r => [r.id, r.x, r.health])).toEqual([[palm.id, 100, 4]]);
    expect(b.registry.get(CLS.unit, 30)?.dead).toBe(true);
    expect(b.registry.get(CLS.unit, 1)?.health).toBe(77);
    expect(b.registry.countStored(CLS.unit, 1, 7)).toBe(2);
    expect(b.registry.all(CLS.item).filter(r => r.parentMode !== STORED_INSIDE).map(r => r.id)).toEqual([loose.id]);
    expect(b.engine.vars.globals.get('quest')).toBe('3');
    expect(b.engine.vars.getLocal(CLS.object, palm.id, 'hits')).toBe('2');
    expect(b.engine.states.find(CLS.object, palm.id, 4)?.value).toBe('7');
    expect(b.engine.timers.records[0]).toMatchObject({ duration: 5000, start: 4800, source: 'tick' });
    expect(b.host.diary).toEqual([{ title: 'D1', text: 'txt' }]);
    expect(b.host.locks.has('building:9')).toBe(true);
    expect(b.host.buffer.value).toBe('buf');
    expect(b.clock.day).toBe(3);
    expect(b.clock.minute).toBe(30);
    expect(b.stats.thirst).toBe(20);
    expect(placed).toEqual({ x: 1, y: 2, z: 3, yaw: 45, pitch: -5 });
    expect(hands).toEqual([7]);
    expect(b.registry.nextId(CLS.unit)).toBeGreaterThan(30);
  });
});
