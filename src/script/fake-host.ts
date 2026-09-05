/** 内存版 ScriptHost，供解释器与指令测试使用。 */
import type { HostDef, HostEntity, HostPlayer, ImpactInfo, ScriptHost } from './host';
import type { Sequence } from '../game/sequence';
import { TextBuffer } from '../game/textbuffer';
import type { DiaryEntry } from '../game/panels';
import type { TakeoverFlags } from '../game/takeover';
import { Skills } from '../game/skills';

export class FakeHost implements ScriptHost {
  readonly logs: string[] = [];
  readonly messages: { text: string; font: number; duration: number }[] = [];
  readonly sounds: string[] = [];
  readonly speeches: string[] = [];
  readonly processes: { title: string; ms: number; event: string }[] = [];
  readonly ents: HostEntity[] = [];
  readonly defs = new Map<string, HostDef>();
  readonly files = new Map<string, string>();
  clock = { day: 1, hour: 8, minute: 0 };
  ms = 0;
  playerState: HostPlayer = { id: 1, health: 100, healthMax: 100, hunger: 0, thirst: 0, exhaustion: 0, store: 100 };
  randomValues: number[] = [];
  target = { x: 0, y: 0, z: 0 };
  impactInfo: ImpactInfo | null = null;
  weapon = 0;
  locks = new Set<string>();
  catalog = { combis: [] as string[], buildings: [] as number[] };
  radii = new Map<number, number>();
  sites = new Map<number, number>();
  infoRadius(id: number): number { return this.radii.get(id) ?? 0; }
  builtAt(objectId: number): number { return this.sites.get(objectId) ?? 0; }
  lastBuildingSite(): number { return 0; }
  signals: { kind: string; srcCls: number; srcId: number; range: number; unitTyp?: number; behaviour?: number }[] = [];
  aiSignal(kind: string, srcCls: number, srcId: number, range: number, unitTyp?: number, behaviour?: number): number { this.signals.push({ kind, srcCls, srcId, range, unitTyp, behaviour }); return 1; }
  aiModes: { unitId: number; mode: string; targetCls: number; targetId: number }[] = [];
  aiMode(unitId: number, mode: string, targetCls: number, targetId: number): boolean { this.aiModes.push({ unitId, mode, targetCls, targetId }); return true; }
  aiStay(): void { /* 无状态 */ }
  aiCenter(): void { /* 无状态 */ }
  lastEater(): number { return 0; }
  sequence?: Sequence;
  buffer = new TextBuffer();
  diary: DiaryEntry[] = [];
  boxes: { title: string; text: string }[] = [];
  dialogues: { page: string; source: string; section?: string }[] = [];
  uiTexts = new Map<number, string>();
  menu = 0;
  msgbox(title: string, text: string): void { this.boxes.push({ title, text }); this.menu = 21; }
  dialogue(page: string, source: string, section?: string): boolean { this.dialogues.push({ page, source, section }); this.menu = 26; return true; }
  uiText(id: number, text: string): void { if (text) this.uiTexts.set(id, text); else this.uiTexts.delete(id); }
  uiImage(): void { /* 无界面 */ }
  menuId(): number { return this.menu; }
  closeMenu(): void { this.menu = 0; }
  loadedMaps: { path: string; flags: TakeoverFlags }[] = [];
  tookOver = false;
  quits: string[] = [];
  loadMap(path: string, flags: TakeoverFlags): void { this.loadedMaps.push({ path, flags }); }
  loadMapTakeover(): boolean { return this.tookOver; }
  quit(): void { this.quits.push('quit'); }
  credits(): void { this.quits.push('credits'); }
  skills = new Skills();
  paths: { unitId: number; nodes: number[] }[] = [];
  triggers: [number, boolean][] = [];
  unitPath(unitId: number, nodes: number[]): void { this.paths.push({ unitId, nodes }); }
  freeUnitPath(unitId: number): void { this.paths = this.paths.filter(p => p.unitId !== unitId); }
  setTrigger(id: number, on: boolean): boolean { this.triggers.push([id, on]); return true; }
  stopTriggers(): void { this.triggers.push([-1, false]); }
  exchanges: { cls: number; id: number; allowStore: boolean; only: number[] }[] = [];
  exchange(cls: number, id: number, allowStore: boolean, only: number[]): void { this.exchanges.push({ cls, id, allowStore, only }); }
  storage(): number { return 0; }
  freeSpace(): boolean { return true; }
  shownEntries: string[] = [];
  showEntry(title: string): void { this.shownEntries.push(title); }
  alterObject(id: number, typ: number): boolean { const e = this.ents.find(x => x.cls === 1 && x.id === id); if (!e) return false; e.typ = typ; return true; }
  revive(unitId: number): boolean { const e = this.ents.find(x => x.cls === 2 && x.id === unitId); if (!e) return false; e.health = e.healthMax; return true; }
  projectiles: unknown[] = [];
  fireProjectile(o: unknown): boolean { this.projectiles.push(o); return true; }
  inView(): boolean { return true; }
  musics: string[] = [];
  music(file: string): void { this.musics.push(file); }
  stopMusic(): void { this.musics.push(''); }
  fadeMusic(): void { /* 无声音 */ }
  musicVolume(): void { /* 无声音 */ }
  seq(): Sequence | undefined { return this.sequence; }
  textSource(source: string, section?: string): string | undefined { return this.loadScriptFile(source.replace(/\\/g, '/'), section); }
  impact(): ImpactInfo | null { return this.impactInfo; }
  playerWeapon(): number { return this.weapon; }
  setPlayerWeapon(typ: number): boolean { this.weapon = typ; return true; }
  private nextIds = new Map<number, number>();

  log(level: 'info' | 'warn' | 'error', msg: string): void { this.logs.push(`${level}: ${msg}`); }
  now(): number { return this.ms; }
  time() { return { ...this.clock }; }
  setTime(day?: number, hour?: number, minute?: number): void {
    if (day !== undefined) this.clock.day = day;
    if (hour !== undefined) this.clock.hour = hour;
    if (minute !== undefined) this.clock.minute = minute;
  }

  add(cls: number, typ: number, id?: number, extra: Partial<HostEntity> = {}): HostEntity {
    const nid = id ?? this.nextId(cls);
    const e: HostEntity = {
      cls, id: nid, typ, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, health: 100, healthMax: 100, count: 1,
      parentClass: 0, parentId: 0, parentMode: 0, ...extra,
    };
    this.ents.push(e);
    if (nid >= (this.nextIds.get(cls) ?? 1)) this.nextIds.set(cls, nid + 1);
    return e;
  }

  private nextId(cls: number): number {
    const n = this.nextIds.get(cls) ?? 1;
    this.nextIds.set(cls, n + 1);
    return n;
  }

  entity(cls: number, id: number): HostEntity | undefined { return this.ents.find(e => e.cls === cls && e.id === id); }
  entities(cls: number, typ?: number): HostEntity[] { return this.ents.filter(e => e.cls === cls && (typ === undefined || e.typ === typ)); }
  createEntity(cls: number, typ: number, x: number, z: number, count: number): number {
    return this.add(cls, typ, undefined, { x, z, count, y: this.terrainY(x, z) }).id;
  }
  freeEntity(cls: number, id: number, count?: number): void {
    const e = this.entity(cls, id);
    if (!e) return;
    if (count !== undefined && cls === 3 && e.count > count) { e.count -= count; return; }
    this.ents.splice(this.ents.indexOf(e), 1);
  }
  setPosition(cls: number, id: number, x: number, y: number, z: number): void { const e = this.entity(cls, id); if (e) { e.x = x; e.y = y; e.z = z; } }
  setRotation(cls: number, id: number, pitch: number, yaw: number, roll: number): void { const e = this.entity(cls, id); if (e) { e.pitch = pitch; e.yaw = yaw; e.roll = roll; } }
  changeHealth(cls: number, id: number, delta: number): number {
    const e = this.entity(cls, id);
    if (!e) return 0;
    e.health = Math.max(0, Math.min(e.healthMax, e.health + delta));
    return e.health;
  }
  def(cls: number, typ: number): HostDef | undefined { return this.defs.get(`${cls}:${typ}`); }
  terrainY(x: number, z: number): number { return (x + z) * 0; }
  mapSize(): number { return 64; }
  player(): HostPlayer { return this.playerState; }
  playerConsume(health: number, hunger: number, thirst: number, exhaustion: number): void {
    const p = this.playerState;
    p.health = Math.max(0, Math.min(p.healthMax, p.health + health));
    p.hunger = Math.max(0, Math.min(p.store, p.hunger - hunger));
    p.thirst = Math.max(0, Math.min(p.store, p.thirst - thirst));
    p.exhaustion = Math.max(0, Math.min(p.store, p.exhaustion - exhaustion));
  }
  storeItem(itemId: number, cls: number, id: number): number {
    const e = this.entity(3, itemId);
    if (!e) return 0;
    e.parentClass = cls; e.parentId = id; e.parentMode = 1;
    return e.count;
  }
  unstoreItem(itemId: number, count: number): number {
    const e = this.entity(3, itemId);
    if (!e) return 0;
    e.parentClass = 0; e.parentId = 0; e.parentMode = 0;
    return Math.min(count, e.count);
  }
  giveItem(typ: number, count: number): number {
    const existing = this.ents.find(e => e.cls === 3 && e.typ === typ && e.parentClass === 2 && e.parentId === this.playerState.id);
    if (existing) { existing.count += count; return count; }
    this.add(3, typ, undefined, { count, parentClass: 2, parentId: this.playerState.id, parentMode: 1 });
    return count;
  }
  message(text: string, font: number, duration: number): void { this.messages.push({ text, font, duration }); }
  speech(name: string): void { this.speeches.push(name); }
  playSound(file: string): void { this.sounds.push(file); }
  process(title: string, ms: number, event: string): void { this.processes.push({ title, ms, event }); }
  useTarget() { return { ...this.target }; }
  random(min: number, max: number): number {
    if (this.randomValues.length) return this.randomValues.shift()!;
    return min + Math.floor(Math.random() * (max - min + 1));
  }
  loadScriptFile(path: string, section?: string): string | undefined {
    const text = this.files.get(path);
    if (text === undefined || !section) return text;
    const m = new RegExp(`^//~${section}\\s*$([\\s\\S]*?)(?=^//~|(?![\\s\\S]))`, 'm').exec(text);
    return m ? m[1] : '';
  }
}
