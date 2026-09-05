/** 游戏会话对脚本引擎的 ScriptHost 实现。 */
import type { ScriptHost, HostEntity, HostDef, HostPlayer, ImpactInfo } from '../script/host';
import type { World } from '../render/world';
import { worldHeight } from '../render/terrain';
import type { MapData } from '../formats/s2map';
import { CLS, STORED_INSIDE, type EntityRecord } from './entities';
import type { SurvivalStats } from './stats';
import type { GameClock } from './clock';
import type { Hud } from './hud';
import type { Sounds } from './sounds';
import type { Log } from '../viewer/log';
import type { Sequence } from './sequence';
import { TextBuffer } from './textbuffer';
import type { DiaryEntry } from './panels';
import type { TakeoverFlags } from './takeover';
import { Skills } from './skills';

export interface HostDeps {
  world: World;
  map: MapData;
  stats: SurvivalStats;
  clock: GameClock;
  hud: Hud;
  sounds: Sounds;
  log: Log;
  playerId: number;
  files: Map<string, string>;
  gameTime(): number;
  useTarget(): { x: number; y: number; z: number };
  startProcess(title: string, ms: number, event: string): void;
  onTimeSet(): void;
  onEntityDied(rec: EntityRecord): void;
}

export class GameScriptHost implements ScriptHost {
  readonly locks = new Set<string>();
  catalog = { combis: [] as string[], buildings: [] as number[] };
  builtAt: (objectId: number) => number = () => 0;
  lastBuildingSite: () => number = () => 0;
  aiSignal: (kind: string, srcCls: number, srcId: number, range: number, unitTyp?: number, behaviour?: number) => number = () => 0;
  aiMode: (unitId: number, mode: string, targetCls: number, targetId: number) => boolean = () => false;
  aiStay: (unitId: number, on: boolean) => void = () => undefined;
  aiCenter: (unitId: number) => void = () => undefined;
  lastEater: () => number = () => 0;
  seq: () => Sequence | undefined = () => undefined;
  readonly buffer = new TextBuffer();
  readonly diary: DiaryEntry[] = [];
  msgbox: (title: string, text: string) => void = () => undefined;
  dialogue: (page: string, source: string, section?: string) => boolean = () => false;
  uiText: (id: number, text: string, font: number, x?: number, y?: number, align?: number) => void = () => undefined;
  uiImage: (id: number, path: string, x: number, y: number) => void = () => undefined;
  menuId: () => number = () => 0;
  closeMenu: () => void = () => undefined;
  loadMap: (path: string, flags: TakeoverFlags) => void = () => undefined;
  loadMapTakeover: () => boolean = () => false;
  quit: () => void = () => undefined;
  credits: () => void = () => undefined;
  readonly skills = new Skills();
  unitPath: (unitId: number, nodes: number[]) => void = () => undefined;
  freeUnitPath: (unitId: number) => void = () => undefined;
  setTrigger: (id: number, on: boolean) => boolean = () => false;
  stopTriggers: () => void = () => undefined;
  /** 由武器模块接管：最近命中与手持类型。 */
  impact: () => ImpactInfo | null = () => null;
  playerWeapon: () => number = () => 0;
  setPlayerWeapon: (typ: number) => boolean = () => false;
  random: (min: number, max: number) => number = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

  constructor(private readonly d: HostDeps) {}

  private get registry() {
    return this.d.world.registry;
  }

  log(level: 'info' | 'warn' | 'error', msg: string): void {
    this.d.log[level](msg);
  }

  now(): number {
    return this.d.gameTime();
  }

  time() {
    return { day: this.d.clock.day, hour: this.d.clock.hour, minute: this.d.clock.minute };
  }

  setTime(day?: number, hour?: number, minute?: number): void {
    if (day !== undefined) this.d.clock.day = day;
    this.d.clock.set(hour ?? this.d.clock.hour, minute ?? this.d.clock.minute);
    this.d.onTimeSet();
  }

  entity(cls: number, id: number): HostEntity | undefined {
    return this.registry.get(cls, id);
  }

  entities(cls: number, typ?: number): HostEntity[] {
    return this.registry.all(cls, typ);
  }

  createEntity(cls: number, typ: number, x: number, z: number, count: number): number {
    const rec = this.d.world.create(cls, typ, x, z, count);
    if (!rec) return -1;
    if (rec.def) for (const v of rec.def.vars) this.d.log.info(`var ${v.name}=${v.value} @ ${cls}:${rec.id}`);
    return rec.id;
  }

  freeEntity(cls: number, id: number, count?: number): void {
    const rec = this.registry.get(cls, id);
    if (!rec) return;
    if (cls === CLS.item && count !== undefined && count >= 0) {
      if (!this.registry.consume(id, count)) return;
      this.d.world.remove(rec);
      return;
    }
    this.d.world.remove(rec);
  }

  setPosition(cls: number, id: number, x: number, y: number, z: number): void {
    const rec = this.registry.get(cls, id);
    if (!rec) return;
    rec.x = x; rec.y = y; rec.z = z;
    this.d.world.sync(rec);
  }

  setRotation(cls: number, id: number, pitch: number, yaw: number, roll: number): void {
    const rec = this.registry.get(cls, id);
    if (!rec) return;
    rec.pitch = pitch; rec.yaw = yaw; rec.roll = roll;
    this.d.world.sync(rec);
  }

  changeHealth(cls: number, id: number, delta: number, kill: boolean): number {
    if (cls === CLS.unit && id === this.d.playerId) {
      const s = this.d.stats;
      s.health = Math.max(0, Math.min(s.healthMax, s.health + delta));
      return s.health;
    }
    const rec = this.registry.get(cls, id);
    if (!rec) return 0;
    rec.health = Math.min(rec.healthMax, rec.health + delta);
    if (rec.health <= 0) {
      rec.health = 0;
      if (kill) this.d.onEntityDied(rec);
    }
    return rec.health;
  }

  def(cls: number, typ: number): HostDef | undefined {
    const d = this.registry.defFor(cls, typ);
    if (!d) return undefined;
    return { name: d.name, behaviour: d.behaviour, mat: d.mat, group: d.group, weight: d.weight, health: d.health };
  }

  terrainY(x: number, z: number): number {
    return worldHeight(this.d.map, x, z);
  }

  infoRadius(id: number): number {
    return this.d.map.infos.find(i => i.id === id)?.floats[0] ?? 0;
  }

  mapSize(): number {
    return this.d.map.terrainSize;
  }

  player(): HostPlayer {
    const s = this.d.stats;
    return { id: this.d.playerId, health: s.health, healthMax: s.healthMax, hunger: s.hunger, thirst: s.thirst, exhaustion: s.exhaustion, store: s.store };
  }

  playerConsume(health: number, hunger: number, thirst: number, exhaustion: number): void {
    const s = this.d.stats;
    s.health = Math.max(0, Math.min(s.healthMax, s.health + health));
    s.hunger = Math.max(0, Math.min(s.store, s.hunger - hunger));
    s.thirst = Math.max(0, Math.min(s.store, s.thirst - thirst));
    s.exhaustion = Math.max(0, Math.min(s.store, s.exhaustion - exhaustion));
  }

  storeItem(itemId: number, cls: number, id: number): number {
    const rec = this.registry.get(CLS.item, itemId);
    if (!rec) return 0;
    const n = this.registry.store(itemId, cls, id);
    if (n > 0) {
      const still = this.registry.get(CLS.item, itemId);
      if (still) this.d.world.sync(still);
      else this.d.world.remove(rec);
    }
    return n;
  }

  unstoreItem(itemId: number, count: number): number {
    const rec = this.registry.get(CLS.item, itemId);
    if (!rec || rec.parentMode !== STORED_INSIDE) return 0;
    const holder = this.registry.get(rec.parentClass, rec.parentId);
    const x = holder?.x ?? rec.x;
    const z = holder?.z ?? rec.z;
    const out = this.registry.unstore(itemId, count, x, worldHeight(this.d.map, x, z), z);
    if (out) this.d.world.sync(out);
    return out ? Math.min(count, out.count) : 0;
  }

  giveItem(typ: number, count: number): number {
    const rec = this.d.world.create(CLS.item, typ, 0, 0, count);
    if (!rec) return 0;
    const n = this.registry.store(rec.id, CLS.unit, this.d.playerId);
    const still = this.registry.get(CLS.item, rec.id);
    if (still) this.d.world.sync(still);
    else this.d.world.remove(rec);
    if (n < count && still) this.d.world.remove(still);
    return n;
  }

  message(text: string, font: number, durationMs: number): void {
    this.d.hud.message(text, font, durationMs);
  }

  speech(name: string): void {
    this.d.log.info(`speech: ${name}`);
  }

  playSound(file: string, volume: number): void {
    this.d.sounds.play(file, volume);
  }

  process(title: string, ms: number, event: string): void {
    this.d.startProcess(title, ms, event);
  }

  useTarget() {
    return this.d.useTarget();
  }

  textSource(source: string, section?: string): string | undefined {
    const src = source.trim();
    if (/^\d+$/.test(src)) {
      const id = Number(src);
      if (id === 0) return undefined;
      const ext = this.d.map.extensions.find(e => e.mode === 0 && e.parentClass === CLS.info && e.parentId === id);
      return ext?.value;
    }
    return this.loadScriptFile(src, section);
  }

  loadScriptFile(path: string, section?: string): string | undefined {
    const key = path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    const text = this.d.files.get(key);
    if (text === undefined) return undefined;
    if (!section) return text;
    const lines = text.split(/\r?\n/);
    const out: string[] = [];
    let on = false;
    for (const l of lines) {
      if (l.startsWith('//~')) {
        if (on) break;
        on = l.slice(3).trim() === section;
        continue;
      }
      if (on) out.push(l);
    }
    return out.join('\n');
  }
}
