/** 测试用的内存世界：平坦地形、无场景对象的 World、GameScriptHost 与脚本引擎。 */
import * as THREE from 'three';
import type { EntityDef } from '../formats/inf';
import type { MapData } from '../formats/s2map';
import type { Defs, World } from '../render/world';
import { EntityRegistry, CLS, STORED_INSIDE, type EntityRecord } from './entities';
import { SurvivalStats } from './stats';
import { GameClock } from './clock';
import { Sounds } from './sounds';
import { GameScriptHost } from './script-host';
import { ScriptEngine } from '../script/engine';
import { createRegistry } from '../script/commands';
import type { Log } from '../viewer/log';

export function testDef(over: Partial<EntityDef>): EntityDef {
  return {
    id: 0, name: '', model: '', icon: '', scale: [1, 1, 1], color: [255, 255, 255], alpha: 1, fx: 0, autofade: 0,
    aligntowater: false, anims: new Map(), weight: 0, col: 1, eyes: 0, colxr: 1, colyr: 1, speed: 0, store: 100,
    maxweight: 0, group: '', behaviour: '', mat: '', health: 100, vars: [],
    damage: 0, rate: 500, attackrange: 45, turnspeed: 2, range: 300, loopmoveani: 0, drag: 0, weaponstate: '', findratio: 30, finds: [], loots: [], ...over,
  };
}

export function flatMap(size = 16, height = 0.5): MapData {
  const n1 = size + 1;
  return {
    header: { version: '', date: '', time: '', format: '', mode: 'map', day: 1, hour: 8, minute: 0, freezeTime: false, skybox: 'sky', multiplayer: false, climate: 0, music: '', briefing: '', fog: [255, 255, 255, 0], quickslots: [] },
    preview: new Uint8Array(96 * 72 * 3), colormapSize: 8, colormap: new Uint8Array(8 * 8 * 3), terrainSize: size,
    heights: new Float32Array(n1 * n1).fill(height), grass: new Uint8Array((8 + 1) ** 2), objects: [], units: [], items: [], infos: [], states: [], extensions: [],
  };
}

export interface TestWorld {
  registry: EntityRegistry;
  world: World;
  host: GameScriptHost;
  engine: ScriptEngine;
  stats: SurvivalStats;
  clock: GameClock;
  map: MapData;
  messages: string[];
  logs: string[];
  sounds: string[];
  random: number[];
  processes: { title: string; ms: number; event: string }[];
  dead: EntityRecord[];
  useTarget: { x: number; y: number; z: number };
}

export function makeTestWorld(defs: Defs, map = flatMap()): TestWorld {
  const registry = new EntityRegistry(defs);
  const messages: string[] = [];
  const logs: string[] = [];
  const sounds: string[] = [];
  const processes: { title: string; ms: number; event: string }[] = [];
  const dead: EntityRecord[] = [];
  const stats = new SurvivalStats();
  const clock = new GameClock(1, 8, 0);
  const group = new THREE.Group();
  const world: World = {
    group, registry, mixers: [], stats: { objects: 0, units: 0, items: 0, missing: 0 },
    sync: () => undefined,
    remove: rec => { registry.remove(rec.cls, rec.id); },
    create: (cls, typ, x, z, count = 1) => {
      if (!registry.defFor(cls, typ) && cls !== CLS.info) return undefined;
      const rec = registry.make(cls, typ, x, 0, z, count);
      rec.object = new THREE.Object3D();
      rec.object.position.set(x, 0, -z);
      return rec;
    },
    visibleItems: () => registry.all(CLS.item).filter(r => r.parentMode !== STORED_INSIDE),
    spawnModel: async () => null,
  };
  const log = { info: (m: string) => logs.push(`info: ${m}`), warn: (m: string) => logs.push(`warn: ${m}`), error: (m: string) => logs.push(`error: ${m}`) } as unknown as Log;
  const sound = new Sounds();
  sound.enabled = false;
  sound.play = (file: string) => { sounds.push(file); };
  const hud = { message: (text: string) => { messages.push(text); } };
  const tw: Partial<TestWorld> = { random: [], useTarget: { x: 0, y: 0, z: 0 } };
  let engine!: ScriptEngine;
  const host = new GameScriptHost({
    world, map, stats, clock, hud: hud as never, sounds: sound, log, playerId: 1, files: new Map(),
    gameTime: () => 0,
    useTarget: () => tw.useTarget!,
    startProcess: (title, ms, event) => { processes.push({ title, ms, event }); },
    onTimeSet: () => undefined,
    onEntityDied: rec => { dead.push(rec); engine.entityEvent(rec.cls, rec.id, 'kill'); registry.remove(rec.cls, rec.id); },
  });
  host.random = (min: number, max: number) => (tw.random!.length ? tw.random!.shift()! : min);
  engine = new ScriptEngine(host, createRegistry());
  for (const [cls, table] of [[CLS.object, defs.objects], [CLS.unit, defs.units], [CLS.item, defs.items], [CLS.info, defs.infos]] as const) {
    if (!table) continue;
    for (const [typ, def] of table) if (def.script) engine.setTypeScript(cls, typ, def.script, `def ${cls}:${typ}`);
  }
  registry.make(CLS.unit, 1, 0, 17, 0, 1, 1);
  return { registry, world, host, engine, stats, clock, map, messages, logs, sounds, random: tw.random!, processes, dead, useTarget: tw.useTarget! };
}
