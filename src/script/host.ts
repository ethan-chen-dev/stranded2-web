/** 解释器访问引擎的全部能力。游戏会话实现它；测试用内存版。 */
export const CLASS = { global: 0, object: 1, unit: 2, item: 3, info: 4, state: 5 } as const;
export const GAME_SCRIPT_CLASS = -1;

export interface HostEntity {
  cls: number;
  id: number;
  typ: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  health: number;
  healthMax: number;
  count: number;
  parentClass: number;
  parentId: number;
  parentMode: number;
}

export interface HostDef {
  name: string;
  behaviour: string;
  mat: string;
  group: string;
  weight: number;
  health: number;
}

export interface HostPlayer {
  id: number;
  health: number;
  healthMax: number;
  hunger: number;
  thirst: number;
  exhaustion: number;
  store: number;
}

export interface ImpactInfo {
  cls: number;
  id: number;
  kill: boolean;
  x: number;
  y: number;
  z: number;
  ground: boolean;
  damage: number;
  weapon: number;
}

export interface ScriptHost {
  /** 最近一次命中的信息；没有命中过为 null。 */
  impact(): ImpactInfo | null;
  playerWeapon(): number;
  setPlayerWeapon(typ: number): boolean;
  /** 合成与建筑锁：键为 `combi:<id>` 或 `building:<id>`。 */
  locks: Set<string>;
  /** 全部合成 id 与建筑 id，供 lockcombis/lockbuildings 使用。 */
  catalog: { combis: string[]; buildings: number[] };
  /** 区域类信息点的半径；不是区域时为 0。 */
  infoRadius(id: number): number;
  /** 工地物体对应的建筑 id，不是工地为 0。 */
  builtAt(objectId: number): number;
  lastBuildingSite(): number;
  log(level: 'info' | 'warn' | 'error', msg: string): void;
  /** 游戏毫秒计时。 */
  now(): number;
  time(): { day: number; hour: number; minute: number };
  setTime(day?: number, hour?: number, minute?: number): void;
  entity(cls: number, id: number): HostEntity | undefined;
  entities(cls: number, typ?: number): HostEntity[];
  /** 返回新实体 id，失败为 -1。x/z 为 Blitz 坐标；物体落到地面。 */
  createEntity(cls: number, typ: number, x: number, z: number, count: number): number;
  freeEntity(cls: number, id: number, count?: number): void;
  setPosition(cls: number, id: number, x: number, y: number, z: number): void;
  setRotation(cls: number, id: number, pitch: number, yaw: number, roll: number): void;
  /** 返回变化后的生命；kill 为真时降到 0 触发死亡。 */
  changeHealth(cls: number, id: number, delta: number, kill: boolean): number;
  def(cls: number, typ: number): HostDef | undefined;
  terrainY(x: number, z: number): number;
  mapSize(): number;
  player(): HostPlayer;
  playerConsume(health: number, hunger: number, thirst: number, exhaustion: number, unitId?: number): void;
  storeItem(itemId: number, cls: number, id: number): number;
  unstoreItem(itemId: number, count: number): number;
  giveItem(typ: number, count: number): number;
  message(text: string, font: number, durationMs: number): void;
  speech(name: string): void;
  playSound(file: string, volume: number): void;
  process(title: string, ms: number, event: string): void;
  useTarget(): { x: number; y: number; z: number };
  random(min: number, max: number): number;
  loadScriptFile(path: string, section?: string): string | undefined;
}
