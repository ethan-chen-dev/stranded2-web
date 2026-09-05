import { describe, it, expect, beforeEach } from 'vitest';
import { AiSystem, AI, behaviourCode, isAggressive, physicsMode, modeByName } from './ai';
import { makeTestWorld, testDef, type TestWorld } from './test-world';
import { CLS, type EntityRecord } from './entities';

let tw: TestWorld;
let ai: AiSystem;
let now = 0;
let terrain = 0;
let playerAlive = true;
let underwater = false;
const playerHits: number[] = [];

function player(): EntityRecord {
  return tw.registry.get(CLS.unit, 1)!;
}

function setup(): void {
  tw = makeTestWorld({
    objects: new Map(),
    units: new Map([
      [1, testDef({ id: 1, name: 'Player', colyr: 17 })],
      [2, testDef({ id: 2, name: 'Turtle', behaviour: 'normal', speed: 1, range: 300, colyr: 5 })],
      [3, testDef({ id: 3, name: 'Lion', behaviour: 'raptor', speed: 2, damage: 10, range: 300, attackrange: 50, colyr: 1, health: 30, script: 'on:ai_attack { $atk=$atk+1; }' })],
      [4, testDef({ id: 4, name: 'Crab', behaviour: 'crab', speed: 1 })],
      [5, testDef({ id: 5, name: 'Fish', behaviour: 'fish', speed: 1 })],
      [6, testDef({ id: 6, name: 'Bird', behaviour: 'bird', speed: 2 })],
      [7, testDef({ id: 7, name: 'Monkey', behaviour: 'shy', speed: 2 })],
      [8, testDef({ id: 8, name: 'Idler', behaviour: 'normal', speed: 1, anims: new Map([['idle1', { start: 0, end: 49, speed: 0.05 }]]) })],
    ]),
    items: new Map([[9, testDef({ id: 9, name: 'Meat', health: 4, script: 'on:ai_eat { $eaten=ai_eater(); }' })]]),
  });
  now = 0;
  terrain = 0;
  playerAlive = true;
  underwater = false;
  playerHits.length = 0;
  ai = new AiSystem({
    registry: tw.registry, engine: tw.engine, world: tw.world, playerId: 1,
    player: () => ({ x: player().x, y: player().y, z: player().z, alive: playerAlive, underwater }),
    terrainY: () => terrain,
    blocked: () => false,
    damagePlayer: amount => { playerHits.push(amount); },
    damageEntity: (cls, id, amount) => {
      const rec = tw.registry.get(cls, id);
      if (!rec) return;
      rec.health -= amount;
      if (rec.health > 0) return;
      if (cls === CLS.item && rec.count > 1) { rec.count--; rec.health = rec.healthMax; return; }
      tw.registry.remove(cls, id);
    },
    random: (min, max) => (tw.random.length ? Math.min(Math.max(tw.random.shift()!, min), max) : min),
  });
  tw.host.lastEater = () => ai.lastEater;
}

function spawn(typ: number, x: number, y: number, z: number): EntityRecord {
  return tw.registry.make(CLS.unit, typ, x, y, z, 1);
}

/** 以 step 毫秒推进 total 毫秒。 */
function run(total: number, step = 50): void {
  for (let t = 0; t < total; t += step) {
    now += step;
    ai.update(step, now);
    tw.engine.update(step);
  }
}

describe('behaviour codes', () => {
  it('maps names and classifies', () => {
    expect(behaviourCode('raptor')).toBe(2);
    expect(behaviourCode('Animal')).toBe(1);
    expect(behaviourCode('nonsense')).toBe(0);
    expect(isAggressive(2)).toBe(true);
    expect(isAggressive(1)).toBe(false);
    expect(physicsMode(300)).toBe(2);
    expect(physicsMode(400)).toBe(3);
    expect(physicsMode(10)).toBe(6);
    expect(physicsMode(200)).toBe(1);
    expect(modeByName('return')).toBe(AI.ret);
    expect(modeByName('food')).toBe(AI.getfood);
  });
});

describe('AiSystem wandering', () => {
  beforeEach(setup);

  it('starts idle and moves forward after the idle period expires', () => {
    const t = spawn(2, 500, 5, 500);
    run(50);
    expect(t.ai!.mode).toBe(AI.idle);
    tw.random.push(0);
    run(1600);
    expect(t.ai!.mode).toBe(AI.move);
    const z0 = t.z;
    run(1000);
    expect(t.z - z0).toBeCloseTo(50, 0);
    expect(t.x).toBeCloseTo(500, 5);
    expect(t.y).toBe(5);
  });

  it('returns toward the activity center when out of range', () => {
    const t = spawn(2, 0, 5, 0);
    run(50);
    t.x = 400;
    run(50);
    expect(t.ai!.mode).toBe(AI.ret);
    run(3000);
    expect(Math.hypot(t.x, t.z)).toBeLessThan(400);
  });

  it('keeps the player unit untouched', () => {
    run(100);
    expect(player().ai).toBeUndefined();
  });

  it('crab moves sideways along its local x axis', () => {
    const c = spawn(4, 100, 1, 100);
    tw.random.push(0);
    run(1600);
    expect(c.ai!.mode).toBe(AI.move);
    run(1000);
    expect(c.x).toBeGreaterThan(140);
    expect(c.z).toBeCloseTo(100, 5);
  });

  it('idle waits for the idle animation before the mode expires', () => {
    const u = spawn(8, 300, 1, 300);
    u.playAnim = () => true;
    run(50);
    expect(u.ai!.mode).toBe(AI.idle);
    run(3000);
    expect(u.ai!.mode).toBe(AI.idle);
    expect(u.ai!.animUntil).toBe(20050);
  });

  it('keeps fish below the surface and birds above their height band', () => {
    terrain = -100;
    const fish = spawn(5, 600, 5, 600);
    const bird = spawn(6, -600, 0, -600);
    run(100);
    expect(fish.y).toBeLessThanOrEqual(-10);
    expect(bird.y).toBeGreaterThanOrEqual(351);
  });
});

describe('AiSystem combat', () => {
  beforeEach(setup);

  it('raptor hunts the player, then attacks within attackrange', () => {
    const lion = spawn(3, 0, 1, 200);
    run(50);
    expect(lion.ai!.mode).toBe(AI.hunt);
    const d0 = Math.hypot(lion.x, lion.z);
    run(500);
    expect(Math.hypot(lion.x, lion.z)).toBeLessThan(d0);
    run(3000);
    expect(playerHits.length).toBeGreaterThan(0);
    expect(playerHits[0]).toBe(10);
    expect(tw.engine.vars.globals.get('atk')).not.toBe('0');
  });

  it('tamed raptor neither hunts nor attacks', () => {
    const lion = spawn(3, 0, 1, 40);
    tw.engine.states.add(CLS.unit, lion.id, tw.engine.stateType('tame'));
    run(1000);
    expect(playerHits).toHaveLength(0);
    expect(lion.ai!.mode).not.toBe(AI.hunt);
  });

  it('shy unit flees when the player is close, passive unit does not', () => {
    const monkey = spawn(7, 0, 1, 50);
    const turtle = spawn(2, 30, 5, 50);
    run(50);
    expect(monkey.ai!.mode).toBe(AI.flee);
    expect(turtle.ai!.mode).not.toBe(AI.flee);
    run(1000);
    expect(monkey.z).toBeGreaterThan(80);
  });

  it('hurt reactions: raptor hunts, turtle flees', () => {
    const lion = spawn(3, 0, 1, 800);
    const turtle = spawn(2, 0, 5, 800);
    run(50);
    ai.onHurt(lion);
    ai.onHurt(turtle);
    expect(lion.ai!.mode).toBe(AI.hunt);
    expect(turtle.ai!.mode).toBe(AI.flee);
  });

  it('food signal sends an eater to the meat and triggers ai_eat', () => {
    player().x = 2000;
    const lion = spawn(3, 0, 1, 0);
    const meat = tw.world.create(CLS.item, 9, 0, 120, 2)!;
    run(50);
    expect(ai.signal('food', CLS.item, meat.id, 300)).toBe(1);
    expect(lion.ai!.mode).toBe(AI.getfood);
    run(3000);
    expect(tw.engine.vars.globals.get('eaten')).toBe(String(lion.id));
    expect(ai.lastEater).toBe(lion.id);
    expect(meat.count).toBeLessThan(2);
  });

  it('ai_mode command, stay and center', () => {
    const turtle = spawn(2, 100, 5, 100);
    run(50);
    expect(ai.command(turtle, 'move')).toBe(true);
    expect(turtle.ai!.mode).toBe(AI.move);
    ai.stay(turtle, true);
    run(5000);
    expect(turtle.ai!.mode).toBe(AI.idle);
    ai.stay(turtle, false);
    turtle.x = 700;
    ai.center(turtle);
    run(100);
    expect(turtle.ai!.mode).not.toBe(AI.ret);
  });

  it('ai_signal script command reaches the host', () => {
    const calls: unknown[] = [];
    tw.host.aiSignal = (...a) => { calls.push(a); return 2; };
    tw.host.lastEater = () => 7;
    tw.engine.runText('$n=ai_signal("food",150); $e=ai_eater();', { cls: CLS.unit, id: 3, event: 'test', info: '' }, 'test');
    expect(calls[0]).toEqual(['food', CLS.unit, 3, 150]);
    expect(tw.engine.vars.globals.get('n')).toBe('2');
    expect(tw.engine.vars.globals.get('e')).toBe('7');
  });
});
