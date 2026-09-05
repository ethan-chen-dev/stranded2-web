/** 解释器访问引擎的全部能力。游戏会话实现它；测试用内存版。 */
import type { Sequence } from '../game/sequence';
import type { TextBuffer } from '../game/textbuffer';
import type { DiaryEntry } from '../game/panels';

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
  /** AI 信号：以 (srcCls, srcId) 为源，range 内的单位按 kind 进入觅食、走向或逃跑；可限定单位类型或行为码。返回受影响数。 */
  aiSignal(kind: string, srcCls: number, srcId: number, range: number, unitTyp?: number, behaviour?: number): number;
  aiMode(unitId: number, mode: string, targetCls: number, targetId: number): boolean;
  aiStay(unitId: number, on: boolean): void;
  aiCenter(unitId: number): void;
  /** 最近一次触发 ai_eat 的单位 id。 */
  lastEater(): number;
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
  /** 文本来源：纯数字为信息点文本容器的内容，否则为文件路径与可选段名。 */
  textSource(source: string, section?: string): string | undefined;
  /** 当前会话的过场序列；没有会话时为 undefined，序列指令忽略。 */
  seq(): Sequence | undefined;
  /** loadfile/buffer/clear/add 的文本缓冲。 */
  buffer: TextBuffer;
  /** 日记条目，按写入顺序。 */
  diary: DiaryEntry[];
  msgbox(title: string, text: string): void;
  /** 打开对话文件的指定页；找不到返回 false。 */
  dialogue(page: string, source: string, section?: string): boolean;
  uiText(id: number, text: string, font: number, x?: number, y?: number, align?: number): void;
  uiImage(id: number, path: string, x: number, y: number): void;
  menuId(): number;
  closeMenu(): void;
}
