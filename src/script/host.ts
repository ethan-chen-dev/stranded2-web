/** 解释器访问引擎的全部能力。游戏会话实现它；测试用内存版。 */
import type { Sequence } from '../game/sequence';
import type { TextBuffer } from '../game/textbuffer';
import type { DiaryEntry } from '../game/panels';
import type { TakeoverFlags } from '../game/takeover';
import type { Skills } from '../game/skills';

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

/** projectile 指令的瞄准方式（parser_commands.bb 的 mode 1 到 4）。 */
export type ProjectileAim =
  | { kind: 'entity'; cls: number; id: number }
  | { kind: 'point'; x: number; y: number; z: number }
  | { kind: 'direction'; pitch: number; yaw: number }
  | { kind: 'player' };

export interface ProjectileOrder {
  typ: number;
  x: number;
  y: number;
  z: number;
  aim: ProjectileAim;
  /** 起点沿发射方向前移的距离。 */
  offset: number;
  weaponTyp: number;
  speed: number;
  damage: number;
  drag: number;
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
  /** model/scale/fx/color 指令：改实体外观，未给的项保持不变。 */
  setLook(cls: number, id: number, look: { model?: string; scale?: [number, number, number]; fx?: number; color?: [number, number, number] }): boolean;
  freezeUnit(id: number, on: boolean): void;
  playerSpotted(): boolean;
  /** sleep 指令：与按睡觉键相同。 */
  sleep(): void;
  /** map 指令：打开地图界面。 */
  openMap(): void;
  /** showindicator/hideindicator：地图标记（信息点 36）显示与否；不是地图标记返回 false。 */
  setIndicator(id: number, on: boolean): boolean;
  /** air 指令：潜水时补充憋气时间（毫秒）。 */
  addAir(ms: number): void;
  /** savevars/loadvars 的变量缓存；读不到返回 null。 */
  saveVarCache(file: string, entries: [string, string][]): boolean;
  loadVarCache(file: string): [string, string][] | null;
  /** msg_replace：替换当前消息框或对话正文里的文字。 */
  replaceMessage(from: string, to: string): void;
  /** style 1 爆炸、3 燃烧，0 与 2 无效果音。 */
  explosion(x: number, y: number, z: number, range: number, damage: number, style: number): void;
  /** skycolor：null 取消覆盖。 */
  skyColor(o: { color: [number, number, number]; mix: number } | null): void;
  /** 在当前脚本执行完后存到自动存档。 */
  autosave(): void;
  unitFrozen(id: number): boolean;
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
  /** 追加到当前消息框或对话的正文。 */
  extendMessage(text: string): void;
  /** 当前对话第 id 个按钮；target 为页名或 action:/script:/event: 动作。 */
  dialogueButton(id: number, text: string, target: string): void;
  freeDialogueButton(id: number): void;
  /** 打开撬锁界面，结果以事件发给 (cls, id)。 */
  crackLock(title: string, mode: number, code: string, cls: number, id: number): void;
  uiText(id: number, text: string, font: number, x?: number, y?: number, align?: number): void;
  uiImage(id: number, path: string, x: number, y: number): void;
  menuId(): number;
  closeMenu(): void;
  /** 按标志收集继承数据并切换地图。 */
  loadMap(path: string, flags: TakeoverFlags): void;
  /** 当前地图由 loadmap 载入且带有继承数据。 */
  loadMapTakeover(): boolean;
  quit(): void;
  credits(): void;
  skills: Skills;
  unitPath(unitId: number, nodes: number[]): void;
  freeUnitPath(unitId: number): void;
  /** 触发器开关；id 不是触发器信息点时返回 false。 */
  setTrigger(id: number, on: boolean): boolean;
  stopTriggers(): void;
  /** 打开与容器 (cls, id) 的交换界面。 */
  exchange(cls: number, id: number, allowStore: boolean, only: number[]): void;
  /** storage 指令（原版 capacity）：mode 0 剩余容量，1 剩余减上限，2 上限。 */
  storage(cls: number, id: number, mode: number): number;
  freeSpace(x: number, y: number, z: number, range: number, flags: { objects: boolean; units: boolean; items: boolean; infos: boolean }): boolean;
  /** 打开日记并定位到条目。 */
  showEntry(title: string): void;
  alterObject(id: number, typ: number): boolean;
  revive(unitId: number): boolean;
  /** 从 (x, y, z) 朝目标实体发射投射物。 */
  fireProjectile(o: ProjectileOrder): boolean;
  inView(cls: number, id: number): boolean;
  music(file: string, volume: number): void;
  stopMusic(): void;
  fadeMusic(ms: number): void;
  musicVolume(v: number): void;
}
