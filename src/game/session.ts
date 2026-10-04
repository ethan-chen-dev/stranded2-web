/** 游戏模式会话：组装玩家、时钟、光照、数值、拾取、背包、攻击、合成、建造、工具动作、界面与脚本引擎。 */
import * as THREE from 'three';
import type { MapData } from '../formats/s2map';
import { parseInf } from '../formats/inf';
import { parseCombinations, assignGroups, type Combination } from '../formats/combinations';
import { parseBuildings, type Building } from '../formats/buildings';
import { objectHeight, type Defs, type World } from '../render/world';
import { worldHeight, SEA_LEVEL, CELL } from '../render/terrain';
import type { Resources } from '../assets/resources';
import type { Log } from '../viewer/log';
import { GameClock } from './clock';
import { parseLightcycle, type RGB } from './lightcycle';
import { Environment } from './environment';
import { InputState } from './input';
import { ObjectCollider } from './collision';
import { Player, PLAYER } from './player';
import { SurvivalStats } from './stats';
import { Pickup } from './pickup';
import { Hud } from './hud';
import { InventoryUi } from './inventory-ui';
import { BuildUi } from './build-ui';
import { Sounds } from './sounds';
import { CLS, STORED_INSIDE, type EntityRecord } from './entities';
import { ScriptEngine } from '../script/engine';
import { createRegistry } from '../script/commands';
import { GameScriptHost } from './script-host';
import { Weapons } from './weapons';
import { AiSystem } from './ai';
import { Projectiles } from './projectiles';
import { Sequence } from './sequence';
import { SequenceUi } from './sequence-ui';
import { Panels, MENU_CRACKLOCK } from './panels';
import { renderTerrainMap, buildMapView } from './map-ui';
import { expandText } from './textvars';
import { DayUpdate, applyGrowth } from './dayupdate';
import { ItemPhysics } from './itemphysics';
import { materialFx, type MaterialFxDeps } from './materialfx';
import { Weather } from './weather';
import { StateEffects, ST } from './stateeffects';
import { Particles, P, type ParticleHandle } from '../render/particles';
import { Grass } from '../render/grass';
import { ShoreWaves, buildWavePoints } from './shorewaves';
import { ObjectBehaviour } from './objectbehaviour';
import { SoundSets, type SoundEvent } from './soundsets';
import { Vehicles } from './vehicles';
import { loadSettings, viewFactor, type Action, type Settings } from './settings';
import { LightPool } from '../render/lightpool';
import { buildWeatherBox } from '../render/sky';
import type { Sea } from '../render/sea';
import { UnitPaths } from './unitpath';
import { Triggers } from './triggers';
import { ExchangeUi } from './exchange-ui';
import { parseDialogue } from '../formats/dialogue';
import { collectTakeover, applyTakeover, stashTakeover, popTakeover } from './takeover';
import { playUrl, MENU_URL, PauseMenu, loadSaveUrl } from './menu-ui';
import { snapshot, restore, saveGame, loadGame, listSaves, downloadSave, pickAndImportSave, QUICKSAVE, AUTOSAVE, type Snapshot } from './savegame';
import { Combine, type Candidate } from './combine';
import { Build } from './build';
import { Tools, type ToolKind } from './tools';
import { assetUrl } from '../assets/paths';

export interface SessionOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLElement;
  root: HTMLElement;
  map: MapData;
  mapPath: string;
  defs: Defs;
  world: World;
  res: Resources;
  log: Log;
  sky: THREE.Object3D;
  sea?: Sea;
  ambient: THREE.AmbientLight;
  sun: THREE.DirectionalLight;
  listFiles(dir: string): Promise<string[]>;
  /** 读档：创建后按快照恢复，只触发 load 事件。 */
  restore?: Snapshot;
}

const DEG = Math.PI / 180;
const FOCUS_INTERVAL_MS = 300;
const PLAYER_ID = 1;
const PLAYER_TYP = 1;
const SPAWN_INFO_TYP = 1;
const TEXT_CONTAINER_INFO_TYP = 37;
const FISHING_INFO_TYP = 43;
const ARROWS: Partial<Record<Action, string>> = { forward: 'ArrowUp', backward: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
/** 只给这个距离内的单位播移动声（原版全部播放，按 0.02 衰减此处音量约 0.11）。 */
const MOVE_SOUND_RANGE = 400;
const PLACE_DISTANCE = 60;
/** 按 E 对物体或单位触发 use 事件的距离。 */
const USE_ENTITY_RANGE = 60;
/** 没有 use 脚本也能使用的物品行为（handle_items.bb use_item）。 */
const ITEM_ACTIONS = new Set(['map', 'watch']);
/** 撬锁左、右、上、下的音效，原版 load_media.bb 的 sfx_crack。 */
const CRACK_SOUNDS = ['crack1.wav', 'crack2.wav', 'crack3.wav', 'crack4.wav'];
/** 爆炸音效，原版 load_media.bb 的 sfx_explode。 */
const EXPLODE_SOUNDS = ['explode1.wav', 'explode2.wav', 'explode3.wav', 'explode4.wav'];

interface ProcessState {
  title: string;
  start: number;
  ms: number;
  event: string;
  onDone?: () => void;
}

interface GameSettings {
  digTime: number;
  fishTime: number;
  /** 水下能憋气的毫秒数，-1 为不限（game.inf dive_time）。 */
  diveTime: number;
  /** 憋不住后每秒扣的生命（game.inf dive_damage）。 */
  diveDamage: number;
  rainRatio: number;
  snowRatio: number;
  fireRange: number;
  fireLightSize: number;
  fireLightBrightness: number;
  /** 岸边浪花的生成间隔毫秒。 */
  waveRate: number;
  /** 浪点背后至少要有这么远的水面（小水洼没有浪）。 */
  minWaveSpace: number;
}

function readGameSettings(gameInf: string): GameSettings {
  const num = (key: string, d: number) => {
    const m = new RegExp(`^${key}\\s*=\\s*(-?[\\d.]+)`, 'm').exec(gameInf);
    return m ? parseFloat(m[1]) : d;
  };
  return {
    digTime: num('dig_time', 2500), fishTime: num('fish_time', 2500),
    diveTime: num('dive_time', 8000), diveDamage: num('dive_damage', 1),
    rainRatio: num('rainratio', 10), snowRatio: num('snowratio', 30),
    fireRange: num('firerange', 50), fireLightSize: num('firelightsize', 60), fireLightBrightness: num('firelightbrightness', 160),
    waveRate: num('waverate', 2000), minWaveSpace: num('minwavespace', 300),
  };
}

export class GameSession {
  readonly clock: GameClock;
  readonly env: Environment;
  readonly input: InputState;
  readonly player: Player;
  readonly stats: SurvivalStats;
  readonly collider: ObjectCollider;
  readonly pickup: Pickup;
  readonly hud: Hud;
  readonly invUi: InventoryUi;
  readonly buildUi: BuildUi;
  readonly sounds = new Sounds();
  readonly engine: ScriptEngine;
  readonly host: GameScriptHost;
  readonly playerRec: EntityRecord;
  readonly weapons: Weapons;
  readonly ai: AiSystem;
  readonly projectiles: Projectiles;
  readonly sequence: Sequence;
  private readonly seqUi: SequenceUi;
  readonly panels: Panels;
  readonly pauseMenu: PauseMenu;
  readonly unitPaths: UnitPaths;
  readonly dayUpdate: DayUpdate;
  readonly itemPhysics: ItemPhysics;
  readonly particles: Particles;
  readonly weather: Weather;
  readonly stateEffects: StateEffects;
  private readonly lights = new LightPool();
  private readonly weatherBox = buildWeatherBox();
  /** 玩家设置（视距、特效、草地、血腥、随风摆动、动态模糊、音量、灵敏度、按键），见 settings.ts。 */
  private options: Settings = loadSettings();
  get prefs() {
    const o = this.options;
    return { viewFac: viewFactor(o), effects: o.effects, grass: o.grass, gore: o.gore, windsway: o.windsway && o.effects > 0, motionBlur: o.motionBlur, motionBlurAlpha: o.motionBlurAlpha };
  }
  readonly grass: Grass;
  readonly shoreWaves: ShoreWaves;
  readonly objectBehaviour: ObjectBehaviour;
  readonly vehicles: Vehicles;
  /** 单位音效组；sfx 目录列表与 .inf 重定向读完前为 null。 */
  private soundSets: SoundSets | null = null;
  /** 水下逐帧效果按原版 50 帧/秒的步长累计。 */
  private diveFxAcc = 0;
  /** blur 命令设置的模糊，0..0.97。 */
  private scriptBlur = 0;
  /** 状态（眩晕、醉酒、狂暴）要求的模糊。 */
  private stateBlur = 0;
  /** particlec 作用的最近一个粒子。 */
  private lastParticle: ParticleHandle | null = null;
  /** msgwin 打开期间推迟的 quit 与换图（原版 gui_msg 会阻塞脚本直到关闭）。 */
  private modalQueue: (() => void)[] | null = null;
  private get fxDeps(): MaterialFxDeps {
    return {
      particle: (x, y, z, typ, size, a) => this.particles.add(x, y, z, typ, size, a),
      sound: f => this.sounds.play(f),
      random: (a, b) => this.host.random(a, b),
      rnd: (a, b) => a + Math.random() * (b - a),
      effects: () => this.prefs.effects,
      gore: () => this.prefs.gore,
    };
  }
  readonly triggers: Triggers;
  readonly exchangeUi: ExchangeUi;
  /** 本地图由 loadmap 带数据载入。 */
  private tookOver = false;
  readonly combine: Combine;
  readonly build: Build;
  readonly tools: Tools;
  readonly combinations: Combination[];
  readonly buildings: Building[];
  private focusAcc = 0;
  private focused: EntityRecord | null = null;
  /** autosave 指令在脚本执行中调用，存档推迟到本帧结束。 */
  private pendingAutosave = false;
  private lastCatch = -Infinity;
  /** 读档时会先移除地图自带实体再按存档重建，此时不做 free_childs 清理。 */
  private restoring = false;
  private mapTerrain: HTMLCanvasElement | undefined;
  private mapArrows: HTMLCanvasElement | null = null;
  private readonly settings: GameSettings;
  /** 憋气：眼睛低于水面为潜水；airSince 为上次在水面以上的游戏时间（原版 g_airtimer）。 */
  private diving = false;
  private airSince = 0;
  private lastDrown = 0;
  /** 上次移动音效（脚步、涉水、划水）的游戏时间，g_player_mst。 */
  private lastStep = 0;
  private waveAcc = 0;
  private infoAcc = 0;
  private readonly ground: { heightAt(x: number, z: number): number };
  private gameMs = 0;
  private process: ProcessState | null = null;
  private useTargetPos = { x: 0, y: 0, z: 0 };
  /** footprint 为建筑本体模型，放置时与周围物体做相交检查（game_build.bb 的 MeshesIntersect）。 */
  private placing: { building: Building; preview?: EntityRecord; footprint?: THREE.Object3D | null } | null = null;

  static async create(o: SessionOptions): Promise<GameSession> {
    const text = (p: string) => o.res.text(p).catch(() => '');
    const [cycleText, gameInf, statesInf, buildingsInf] = await Promise.all([
      text('/sys/lightcycle.inf'), text('/sys/game.inf'), text('/sys/states.inf'), text('/sys/buildings.inf'),
    ]);
    const sysFiles = await o.listFiles('sys');
    const combiTexts = await Promise.all(sysFiles.filter(f => /^combinations.*\.inf$/i.test(f)).map(async f => [f, await text(`/sys/${f}`)] as const));
    const combinations = combiTexts.flatMap(([f, t]) => parseCombinations(t, f));
    assignGroups(combinations);
    // 脚本与文本来源（.s2s、.txt）由 msgbox/dialogue/diary/addscript 等指令同步读取，
    // 全 mod 只有几十个、共两百多 KB，创建会话时一次并发读入。
    const files = new Map<string, string>();
    const textFiles = (await o.listFiles('')).filter(f => /\.(s2s|txt)$/i.test(f));
    await Promise.all(textFiles.map(async f => {
      try {
        files.set(f.toLowerCase(), await o.res.text('/' + f));
      } catch {
        /* 单个文件读取失败时该来源视为不存在 */
      }
    }));
    return new GameSession(o, parseLightcycle(cycleText), gameInf, statesInf, files, combinations, parseBuildings(buildingsInf));
  }

  constructor(private readonly o: SessionOptions, cycle: RGB[], gameInf: string, statesInf: string, files: Map<string, string>, combinations: Combination[], buildings: Building[]) {
    this.combinations = combinations;
    this.buildings = buildings;
    this.settings = readGameSettings(gameInf);
    const h = o.map.header;
    this.clock = new GameClock(h.day, h.hour, h.minute, h.freezeTime);
    this.env = new Environment(o.scene, o.sky, o.ambient, o.sun, h.fog, cycle);
    this.env.apply(this.clock.hour, this.clock.minute);
    this.ground = { heightAt: (x, z) => worldHeight(o.map, x, -z) };

    const registry = o.world.registry;
    const spawn = registry.all(CLS.info, SPAWN_INFO_TYP)[0];
    let pos: THREE.Vector3;
    let yaw = 0;
    let pitch = 0;
    if (spawn) {
      pos = new THREE.Vector3(spawn.x, Math.max(spawn.y, this.ground.heightAt(spawn.x, -spawn.z) + PLAYER.halfHeight), -spawn.z);
      yaw = spawn.yaw * DEG;
      pitch = -spawn.pitch * DEG;
    } else {
      pos = new THREE.Vector3(0, this.ground.heightAt(0, 0) + PLAYER.halfHeight, 0);
      o.log.warn('map has no start position info; spawning at the map center');
    }
    this.player = new Player(pos, yaw, pitch);

    const playerDef = o.defs.units.get(PLAYER_TYP);
    this.stats = new SurvivalStats(playerDef?.store ?? 100, playerDef?.health ?? 100);
    const existing = registry.get(CLS.unit, PLAYER_ID);
    if (existing) o.world.remove(existing);
    this.playerRec = registry.make(CLS.unit, PLAYER_TYP, pos.x, pos.y, -pos.z, 1, PLAYER_ID);
    this.playerRec.healthMax = this.stats.healthMax;

    this.collider = new ObjectCollider(
      registry.all(CLS.object).filter(r => r.object).map(r => ({ object: r.object!, col: r.def?.col ?? 1 })),
    );
    this.pickup = new Pickup(o.camera, o.world);
    this.input = new InputState(o.canvas);
    this.hud = new Hud(o.root);

    this.host = new GameScriptHost({
      world: o.world, map: o.map, stats: this.stats, clock: this.clock, hud: this.hud, sounds: this.sounds, log: o.log,
      playerId: PLAYER_ID, files,
      gameTime: () => this.gameMs,
      useTarget: () => this.useTargetPos,
      startProcess: (title, ms, event) => this.startProcess(title, ms, event),
      onTimeSet: () => this.env.apply(this.clock.hour, this.clock.minute),
      onEntityDied: rec => this.entityDied(rec),
    });
    this.host.catalog = { combis: combinations.map(c => c.key), buildings: buildings.map(b => b.id) };
    this.engine = new ScriptEngine(this.host, createRegistry());
    this.host.states = this.engine.states;
    this.mountScripts(gameInf, statesInf);

    const message = (text: string, font = 0) => this.hud.message(text, font);
    const sound = (file: string) => this.sounds.play(file);
    const terrainY = (x: number, z: number) => worldHeight(o.map, x, z);
    this.weapons = new Weapons({
      registry, engine: this.engine, world: o.world, stats: this.stats, playerId: PLAYER_ID,
      now: () => this.gameMs, random: (a, b) => this.host.random(a, b),
      eye: () => o.camera.getWorldPosition(new THREE.Vector3()), dir: () => o.camera.getWorldDirection(new THREE.Vector3()),
      terrainY: (x, zThree) => this.ground.heightAt(x, zThree), message, sound,
      onUnitDied: rec => this.unitDied(rec),
      onUnitHurt: rec => this.ai.onHurt(rec),
      materialFx: (x, y, z, mat) => materialFx(this.fxDeps, x, y, z, mat),
      particle: (x, y, z, typ, size, a) => this.particles.add(x, y, z, typ, size, a),
      effects: () => this.prefs.effects,
      objectFall: model => { this.particles.animate(model, { typ: P.fall }, () => { model.removeFromParent(); }); },
    });
    this.projectiles = new Projectiles({
      registry, world: o.world, engine: this.engine, weapons: this.weapons, playerId: PLAYER_ID,
      terrainY, now: () => this.gameMs, model: typ => o.world.spawnModel(CLS.item, typ),
      particle: (x, y, z, typ, size, a) => this.particles.add(x, y, z, typ, size, a),
      ghost: (obj, kind) => {
        const copy = obj.clone(true);
        o.world.group.add(copy);
        const done = () => { copy.removeFromParent(); };
        if ('fade' in kind) {
          this.particles.animate(copy, { typ: P.fadeout, alpha: kind.fade.alpha, speed: kind.fade.speed }, done);
          tintCopy(copy, [255, 255, 255], true);
        } else {
          const r = kind.resfade;
          this.particles.animate(copy, { typ: P.resfade, speed: r.speed, grow: r.grow, alpha: r.alpha, scale: r.scale }, done);
          tintCopy(copy, r.color, r.additive);
        }
      },
      materialFx: (x, y, z, mat) => materialFx(this.fxDeps, x, y, z, mat),
      sound,
      explosion: (x, y, z, range, damage, style) => this.host.explosion(x, y, z, range, damage, style),
      stateImpact: (typ, x, y, z) => this.stateEffects.impact(typ, x, y, z),
      effects: () => this.prefs.effects,
      random: (a, b) => this.host.random(a, b),
    });
    this.weapons.launcher = this.projectiles;
    this.ai = new AiSystem({
      registry, engine: this.engine, world: o.world, playerId: PLAYER_ID,
      player: () => ({ x: this.playerRec.x, y: this.playerRec.y, z: this.playerRec.z, alive: !this.stats.dead, underwater: this.player.eye().y < SEA_LEVEL }),
      terrainY,
      collide: (rec, dx, dz) => this.unitCollide(rec, dx, dz),
      damagePlayer: (amount, by) => this.playerHurt(amount, by),
      damageEntity: (cls, id, amount) => { this.weapons.damage(cls, id, amount, 'other'); },
      random: (a, b) => this.host.random(a, b),
      controlled: rec => this.unitPaths.controlled(rec.id),
      driven: rec => this.vehicles.driving === rec.id,
      unitSound: (rec, event) => this.unitSound(rec, event),
      moveSound: (rec, moving) => {
        const key = `unit:${rec.id}`;
        const file = moving ? this.soundSets?.file(rec.def?.sfx ?? '', 'move') ?? null : null;
        const e = this.camThree();
        this.sounds.channel(key, file && Math.hypot(rec.x - e.x, rec.y - e.y, rec.z + e.z) < MOVE_SOUND_RANGE ? file : null, rec);
      },
      soundAt: (file, rec) => this.sounds.playAt(file, rec),
    });
    o.world.onAttach = rec => {
      if (rec.cls === CLS.object && rec.object && rec !== this.placing?.preview && !this.engine.states.has(CLS.object, rec.id, ST.ghost)) {
        this.collider.add(rec.object, rec.def?.col ?? 1);
      }
    };
    o.world.onDetach = rec => {
      if (rec.object) this.collider.remove(rec.object);
      if (rec.cls === CLS.object) this.itemPhysics?.reset();
    };
    o.world.onRemove = rec => {
      if (this.restoring) return;
      this.engine.removeInstanceScript(rec.cls, rec.id);
      this.stateEffects.freeAll(rec.cls, rec.id);
      this.engine.timers.free(rec.cls, rec.id);
      if (rec.cls === CLS.unit) this.unitPaths.free(rec.id);
      // free_childs：里面收着的和挂在外面的子物品都随父实体删除
      if (rec.cls !== CLS.item) for (const child of registry.all(CLS.item).filter(i => i.parentClass === rec.cls && i.parentId === rec.id)) o.world.remove(child);
    };
    this.dayUpdate = new DayUpdate({
      registry, engine: this.engine, world: o.world, terrainY,
      random: (a, b) => this.host.random(a, b),
      killObject: rec => { this.weapons.damage(CLS.object, rec.id, rec.health + 1, 'other'); },
      killUnit: rec => this.weapons.kill(rec),
      changeWeather: () => this.weather.changeDay(),
      spawnFx: rec => {
        const e = this.camThree();
        const y = rec.y - (rec.cls === CLS.unit ? rec.def?.colyr ?? 0 : 0);
        if (Math.hypot(rec.x - e.x, y - e.y, rec.z + e.z) >= 3000) return;
        const r = (a: number, b: number) => a + Math.random() * (b - a);
        for (let i = 0; i < 5 + this.prefs.effects * 10; i++) this.particles.add(rec.x + r(-20, 20), y + r(-5, 5), rec.z + r(-20, 20), P.spawn, r(3, 6), r(0.5, 2));
      },
    }, o.map.infos);
    for (const rec of registry.all(CLS.object)) if ((rec.daytimer ?? 0) < 0) applyGrowth(rec, o.world);
    this.itemPhysics = new ItemPhysics({
      registry, terrainY, sync: rec => o.world.sync(rec),
      floorBelow: (x, top, bottom, z) => this.collider.floorBelow(x, top, bottom, -z),
      viewFac: () => this.prefs.viewFac,
    });
    this.particles = new Particles({
      scene: o.scene, camera: o.camera, textures: url => o.res.texture(url), terrainY, diving: () => this.diving,
      sequenceMs: () => null,
    });
    void this.particles.load();
    const frustum = new THREE.Frustum();
    const viewProj = new THREE.Matrix4();
    const probe = new THREE.Vector3();
    this.shoreWaves = new ShoreWaves(buildWavePoints(o.map.terrainSize, CELL, terrainY, this.settings.minWaveSpace), this.settings.waveRate, {
      camera: () => this.cam(),
      inView: (x, y, z) => {
        viewProj.multiplyMatrices(o.camera.projectionMatrix, o.camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(viewProj);
        return frustum.containsPoint(probe.set(x, y, -z));
      },
      spawn: (p, size) => { this.particles.add(p.x, 0, p.z, P.wave, size, p.dir); },
      sound: (f, v) => this.sounds.play(f, v),
      random: (a, b) => this.host.random(a, b),
      effects: () => this.prefs.effects,
    });
    this.vehicles = new Vehicles({
      registry, terrainY, code: rec => this.ai.code(rec), sync: rec => o.world.sync(rec),
      wave: (x, z) => { this.particles.add(x, 1, z, P.rwave, 10 + Math.random() * 10, 0.6 + Math.random() * 0.3); },
      moveSound: (rec, volume) => this.sounds.channel('drive', volume === null ? null : this.soundSets?.file(rec.def?.sfx ?? '', 'move') ?? null, undefined, volume ?? 0),
      kill: rec => this.weapons.kill(rec),
    });
    const sphere = new THREE.Sphere();
    this.objectBehaviour = new ObjectBehaviour({
      registry,
      visible: rec => {
        if (!rec.object) return false;
        const e = this.camThree();
        const range = (rec.def?.autofade ?? 500) * this.prefs.viewFac + 300;
        if (Math.hypot(rec.x - e.x, rec.y - e.y, rec.z + e.z) > range) return false;
        viewProj.multiplyMatrices(o.camera.projectionMatrix, o.camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(viewProj);
        return frustum.intersectsSphere(sphere.set(probe.set(rec.x, rec.y, -rec.z), 60));
      },
      player: () => ({ x: this.playerRec.x, y: this.playerRec.y, z: this.playerRec.z }),
      camera: () => this.cam(),
      particle: (x, y, z, typ, size, a) => this.particles.add(x, y, z, typ, size, a),
      loop: (key, f) => this.sounds.loop(key, f),
      kill: rec => { this.weapons.damage(CLS.object, rec.id, rec.health + 1, 'other'); },
      trigger: rec => { this.engine.entityEvent(CLS.object, rec.id, 'trigger'); },
      windsway: () => this.prefs.windsway,
    });
    void o.listFiles('sfx').then(files => SoundSets.load(files, name => o.res.text('/sfx/' + name))).then(s => { this.soundSets = s; }).catch(() => undefined);
    this.grass = new Grass(o.map, this.prefs.grass);
    o.scene.add(this.grass.group);
    void this.grass.load(o.res);
    o.scene.add(this.lights.group);
    o.scene.add(this.weatherBox);
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const savedWeather = o.map.extensions.find(x => x.key === 'env_cweather');
    this.weather = new Weather({
      random: (a, b) => this.host.random(a, b), rnd,
      clearFire: () => this.stateEffects.clearFire(),
      sound: f => this.sounds.play(f),
      loop: f => this.sounds.loop('weather', f),
      flash: (size, a) => { this.particles.add(0, 0, 0, P.flash, size, a)?.color(255, 255, 255).additive(); },
      precipitation: (kind, dx, dz, size) => {
        const e = this.camThree();
        this.particles.add(e.x + dx, 0, -e.z + dz, kind === 'rain' ? P.rain : P.snow, size);
      },
      diving: () => this.diving,
    }, h.climate, { rain: this.settings.rainRatio, snow: this.settings.snowRatio }, savedWeather ? Number(savedWeather.value) : undefined);
    this.stateEffects = new StateEffects({
      engine: this.engine, playerId: PLAYER_ID,
      get: (cls, id) => registry.get(cls, id),
      material: (cls, id) => (registry.get(cls, id)?.def?.mat ?? '').trim().toLowerCase(),
      position: (cls, id) => this.statePosition(cls, id),
      staticPosition: (cls, id) => this.stateOffset(cls, id) !== null,
      camera: () => this.cam(),
      particle: (x, y, z, typ, size, a) => this.particles.add(x, y, z, typ, size, a),
      sound: f => this.sounds.play(f),
      loop: (key, f) => this.sounds.loop(key, f),
      damage: (cls, id, amount) => {
        if (cls === CLS.unit && id === PLAYER_ID) { this.playerHurt(amount); return this.stats.dead; }
        this.weapons.damage(cls, id, amount, 'other');
        const rec = registry.get(cls, id);
        return cls === CLS.unit && id === PLAYER_ID ? this.stats.dead : !rec || !!rec.dead;
      },
      heal: (cls, id, amount) => this.heal(cls, id, amount),
      createLight: () => this.lights.create(),
      blocksFire: () => this.weather.blocksFire,
      objectsNear: (x, z, range) => registry.all(CLS.object).filter(o => Math.hypot(o.x - x, o.z - z) <= range),
      fireRange: this.settings.fireRange, fireLightSize: this.settings.fireLightSize, fireLightBrightness: this.settings.fireLightBrightness,
      playerBlur: (amount, invert) => { this.stateBlur = amount; this.player.invertX = invert; },
      restoreCollision: id => { const rec = registry.get(CLS.object, id); if (rec?.object) this.collider.add(rec.object, rec.def?.col ?? 1); },
      restoring: () => this.restoring,
      viewFac: () => this.prefs.viewFac,
      random: (a, b) => this.host.random(a, b), rnd,
    });
    this.unitPaths = new UnitPaths({ registry, engine: this.engine, terrainY, sync: rec => o.world.sync(rec) });
    this.triggers = new Triggers({
      registry, engine: this.engine, playerId: PLAYER_ID,
      player: () => ({ x: this.playerRec.x, y: this.playerRec.y, z: this.playerRec.z }),
      clock: () => ({ day: this.clock.day, hour: this.clock.hour, minute: this.clock.minute }),
      aiSignal: (kind, infoId, range) => { this.ai.signal(kind, CLS.info, infoId, range); },
    });
    this.triggers.load(o.map.infos);
    this.host.unitPath = (unitId, nodes) => this.unitPaths.set(unitId, nodes);
    this.host.freeUnitPath = unitId => this.unitPaths.free(unitId);
    this.host.setTrigger = (id, on) => (on ? this.triggers.start(id) : this.triggers.stop(id));
    this.host.stopTriggers = () => this.triggers.stopAll();
    this.exchangeUi = new ExchangeUi(o.root);
    this.host.exchange = (cls, id, allowStore, only) => this.openExchange(cls, id, allowStore, only);
    this.host.showEntry = title => { this.panels.openDiary(this.host.diary, this.host.skills.entries(), title); this.syncLock(); };
    this.host.alterObject = (id, typ) => {
      const rec = registry.get(CLS.object, id);
      if (!rec || !registry.defFor(CLS.object, typ)) return false;
      const { x, y, z, yaw } = rec;
      o.world.remove(rec);
      const made = registry.make(CLS.object, typ, x, y, z, 1, id);
      made.yaw = yaw;
      o.world.sync(made);
      return true;
    };
    this.host.revive = unitId => {
      const rec = registry.get(CLS.unit, unitId);
      if (!rec) return false;
      const health = rec.def?.health ?? 100;
      rec.dead = false;
      rec.health = health;
      rec.healthMax = health;
      rec.ai = undefined;
      rec.playAnim?.('idle1', true) || rec.playAnim?.('idle', true);
      if (unitId === PLAYER_ID) {
        this.stats.health = this.stats.healthMax;
        this.hud.hideDead();
      }
      return true;
    };
    this.host.fireProjectile = p => {
      let yaw: number;
      let pitch: number;
      if (p.aim.kind === 'direction') {
        ({ yaw, pitch } = p.aim);
      } else {
        let t: { x: number; y: number; z: number } | undefined;
        if (p.aim.kind === 'point') t = p.aim;
        else if (p.aim.kind === 'player') t = this.playerRec;
        else {
          const { cls, id } = p.aim;
          const target = cls === CLS.unit && id === PLAYER_ID ? this.playerRec : registry.get(cls, id);
          // 原版朝单位时瞄准碰撞体中部
          if (target) t = { x: target.x, y: target.y - (cls === CLS.unit ? (target.def?.colyr ?? 0) / 2 : 0), z: target.z };
        }
        if (!t) return false;
        const dx = t.x - p.x, dy = t.y - p.y, dz = t.z - p.z;
        yaw = Math.atan2(-dx, dz) / DEG;
        pitch = -Math.atan2(dy, Math.hypot(dx, dz)) / DEG;
      }
      const cp = Math.cos(pitch * DEG);
      const x = p.x - Math.sin(yaw * DEG) * cp * p.offset;
      const y = p.y - Math.sin(pitch * DEG) * p.offset;
      const z = p.z + Math.cos(yaw * DEG) * cp * p.offset;
      this.projectiles.fire({
        typ: p.typ, weaponTyp: p.weaponTyp || p.typ, ammoTyp: p.typ, spawner: 0, x, y, z,
        yaw, pitch, speed: p.speed, drag: p.drag, damage: p.damage,
      });
      return true;
    };
    this.host.inView = (cls, id) => {
      const rec = registry.get(cls, id);
      if (!rec) return false;
      const dir = o.camera.getWorldDirection(new THREE.Vector3());
      const to = new THREE.Vector3(rec.x, rec.y, -rec.z).sub(o.camera.getWorldPosition(new THREE.Vector3()));
      if (to.lengthSq() === 0) return true;
      return dir.dot(to.normalize()) > Math.cos((o.camera.fov * DEG) / 2 * 1.3);
    };
    this.host.aiSignal = (kind, srcCls, srcId, range, unitTyp, behaviour) =>
      this.ai.signal(kind, srcCls, srcId, range, rec => (unitTyp === undefined || rec.typ === unitTyp) && (behaviour === undefined || this.ai.code(rec) === behaviour));
    this.host.aiMode = (unitId, mode, targetCls, targetId) => {
      const rec = registry.get(CLS.unit, unitId);
      return rec ? this.ai.command(rec, mode, targetCls, targetId) : false;
    };
    this.host.aiStay = (unitId, on) => {
      const rec = registry.get(CLS.unit, unitId);
      if (!rec) return;
      const stick = this.engine.stateType('ai_stick');
      if (on) { if (!this.engine.states.has(CLS.unit, unitId, stick)) this.engine.states.add(CLS.unit, unitId, stick); }
      else this.engine.states.free(CLS.unit, unitId, stick);
      this.ai.stay(rec, on);
    };
    this.host.movePlayer = (x, y, z) => {
      this.player.position.set(x, Math.max(y, this.ground.heightAt(x, -z) + PLAYER.halfHeight), -z);
      this.player.fallStart = -1;
      this.player.jumpUntil = -1;
      this.playerRec.x = x; this.playerRec.y = this.player.position.y; this.playerRec.z = z;
      this.player.applyTo(o.camera);
    };
    this.host.playerSpotted = () => this.ai.playerSpotted();
    this.host.sleep = () => this.sleep();
    this.host.openMap = () => this.openMap();
    this.host.addAir = ms => { if (this.diving) this.airSince = Math.min(this.airSince + ms, this.gameMs); };
    this.host.skyColor = o => { this.env.override = o; this.env.apply(this.clock.hour, this.clock.minute); };
    this.host.autosave = () => { this.pendingAutosave = true; };
    this.host.explosion = (x, y, z, range, damage, style) => {
      const hit = (r: EntityRecord) => Math.hypot(r.x - x, r.y - y, r.z - z) < range;
      for (const cls of [CLS.object, CLS.unit, CLS.item]) {
        for (const rec of [...registry.all(cls)]) {
          if (rec.dead || (cls === CLS.unit && rec.id === PLAYER_ID) || (cls === CLS.item && rec.parentMode === STORED_INSIDE)) continue;
          if (hit(rec)) this.weapons.damage(cls, rec.id, damage, 'other');
        }
      }
      if (damage > 0 && hit(this.playerRec)) this.playerHurt(damage);
      const size = range / 10;
      if (style === 1) {
        this.sounds.play(EXPLODE_SOUNDS[this.host.random(0, 3)]);
        this.particles.explosion(x, y, z, size);
      } else if (style === 3) {
        const r = (a: number, b: number) => a + Math.random() * (b - a);
        for (let i = 0; i < 10; i++) {
          if (this.host.random(1, 3) === 1) {
            const smoke = this.particles.add(x + r(-size * 3, size * 3), y + r(0, size * 3), z + r(-size * 3, size * 3), P.smoke, r(10, 30), r(0.9, 1.5));
            if (smoke) { smoke.color(256, this.host.random(128, 256), this.host.random(32, 128)); smoke.a = smoke.fadein; smoke.fadein = 0; smoke.alpha(smoke.a); }
          }
          this.particles.add(x + r(-size * 3, size * 3), y + r(0, size * 3), z + r(-size * 3, size * 3), P.spark, this.host.random(2, 3), 3)
            ?.color(128, this.host.random(64, 128), this.host.random(0, 64)).blend(1);
          this.particles.add(x + r(-size * 3, size * 3), y + r(-size * 3, size * 3), z + r(-size * 3, size * 3), P.firespark, this.host.random(1, 2), 1)
            ?.color(128, this.host.random(64, 128), this.host.random(0, 64)).blend(1);
        }
        this.sounds.play('pang.wav');
      }
    };
    this.host.weather = () => this.weather.current;
    this.host.setWeather = v => this.weather.setWeather(v);
    this.host.setClimate = v => this.weather.setClimate(v);
    this.host.setWeatherRatio = (kind, n) => { if (kind === 'rain') this.weather.rainRatio = n; else this.weather.snowRatio = n; };
    this.host.flash = (r, g, b, speed, alpha) => { this.particles.add(0, 0, 0, P.flash, speed, alpha)?.color(r, g, b); };
    this.host.thunder = () => {
      this.sounds.play(`thunder${this.host.random(1, 3)}.wav`);
      this.particles.add(0, 0, 0, P.flash, 0.1 + Math.random() * 0.2, Math.random())?.color(255, 255, 255).additive();
    };
    this.host.blur = v => { this.scriptBlur = Math.max(0, Math.min(0.97, v)); };
    this.host.particle = (x, y, z, typ, size, alpha) => { this.lastParticle = this.particles.add(x, y, z, typ, size, alpha); };
    this.host.particleColor = (r, g, b) => { this.lastParticle?.color(r, g, b); };
    this.host.corona = (x, z, size, color, speed, unitId) => {
      const y = terrainY(x, z);
      const r = (a: number, b: number) => a + Math.random() * (b - a);
      const follow = unitId > 0 ? () => { const u = registry.get(CLS.unit, unitId); return u ? { x: u.x, y: u.y, z: u.z } : null; } : null;
      for (let i = 0; i < 10 + this.prefs.effects * 10; i++) {
        const h = this.particles.add(x + r(-size, size), y + r(-5, 5), z + r(-size, size), P.spawn, r(3, 6), r(0.5, 2));
        if (!h) continue;
        if (color) h.color(...color);
        h.speed(speed);
        if (follow) h.follow(follow);
      }
    };
    this.host.vomit = unitId => {
      const u = registry.get(CLS.unit, unitId);
      if (!u) return;
      const r = (a: number, b: number) => a + Math.random() * (b - a);
      for (let i = 0; i < 15; i++) {
        const red = r(50, 150);
        this.particles.add(u.x + r(-5, 5), u.y + r(-5, 5) + (u.def?.eyes ?? 0), u.z + r(-5, 5), P.subsplatter, r(4, 5), r(0.9, 3))?.frame(2).color(red, red + r(0, 55), 0);
      }
    };
    this.host.aiCenter = unitId => { const rec = registry.get(CLS.unit, unitId); if (rec) this.ai.center(rec); };
    this.host.lastEater = () => this.ai.lastEater;
    this.sequence = new Sequence({
      now: () => this.gameMs,
      cameraNow: () => {
        const eye = this.player.eye();
        return { x: eye.x, y: eye.y, z: -eye.z, pitch: -this.player.pitch / DEG, yaw: this.player.yaw / DEG };
      },
      info: id => {
        const rec = registry.get(CLS.info, id);
        return rec ? { x: rec.x, y: rec.y, z: rec.z, pitch: rec.pitch, yaw: rec.yaw } : undefined;
      },
      entityPos: (cls, id) => {
        const rec = cls === CLS.unit && id === PLAYER_ID ? this.playerRec : registry.get(cls, id);
        return rec ? { x: rec.x, y: rec.y, z: rec.z } : undefined;
      },
      terrainY,
      globalEvent: name => this.engine.globalEvent(name),
      entityEvent: (cls, id, name) => this.engine.entityEvent(cls, id, name),
      runScript: (text, origin) => { this.engine.runText(text, { cls: 0, id: 0, event: 'sequence', info: 'triggered by seqscript command' }, origin); },
      sound: (file, volume) => this.sounds.play(file, volume * 100),
      loadText: src => this.host.textSource(src),
      log: msg => o.log.warn(msg),
    });
    this.host.seq = () => this.sequence;
    this.seqUi = new SequenceUi(o.root);
    this.panels = new Panels(o.root, {
      expand: text => expandText(text, name => String(this.engine.vars.globals.get(name) ?? '0')),
      runScript: (text, origin) => { this.engine.runText(text, { cls: 0, id: 0, event: 'dialogue', info: origin }, origin); this.engine.update(0); },
      globalEvent: name => { this.engine.globalEvent(name); this.engine.update(0); },
      log: msg => o.log.warn(msg),
    });
    this.panels.onSleep = () => { this.syncLock(); this.sleep(); };
    void o.res.maskedImage('/sys/gfx/arrows.bmp').then(img => { this.mapArrows = img; });
    this.pauseMenu = new PauseMenu(o.root, {
      resume: () => { this.pauseMenu.close(); this.syncLock(); },
      save: name => { this.save(name); },
      saves: () => listSaves(),
      quickSaveName: QUICKSAVE,
      exportSave: name => { downloadSave(name); },
      importSave: () => pickAndImportSave(),
      optionsChanged: s => this.applyOptions(s),
    });
    this.host.msgbox = (title, text) => { this.panels.msgbox(title, text); this.syncLock(); };
    this.host.dialogue = (page, source, section) => {
      const text = this.host.textSource(source, section);
      if (text === undefined) return false;
      const ok = this.panels.dialogue(parseDialogue(text), page);
      if (ok) this.syncLock();
      return ok;
    };
    this.host.extendMessage = text => this.panels.extendText(text);
    this.host.replaceMessage = (from, to) => this.panels.replaceText(from, to);
    this.host.dialogueButton = (id, text, target) => this.panels.setButton(id, text, target);
    this.host.freeDialogueButton = id => this.panels.freeButton(id);
    this.host.crackLock = (title, mode, code, cls, id) => {
      this.panels.crackLock({
        title, mode, code,
        sound: dir => this.sounds.play(CRACK_SOUNDS[dir] ?? 'fail.wav'),
        fail: () => { this.sounds.play('fail.wav'); this.engine.entityEvent(cls, id, 'cracklock_failure'); this.engine.update(0); },
        success: () => { this.engine.entityEvent(cls, id, 'cracklock_success'); this.engine.update(0); this.syncLock(); },
      });
      this.syncLock();
    };
    this.host.uiText = (id, text, font, x, y, align) => this.panels.uiText(id, text, font, x, y, align);
    this.host.uiImage = (id, path, x, y) => this.panels.uiImage(id, path, x, y);
    this.host.menuId = () => (this.sequence.active ? 100 : this.panels.menuId());
    this.host.closeMenu = () => { this.panels.close(); this.syncLock(); };
    this.host.waterTexture = path => {
      void o.res.texture('/' + path.replace(/\\/g, '/').replace(/^\/+/, '')).then(tex => {
        if (!tex) { o.log.warn(`watertexture: unable to load '${path}'`); return; }
        o.sea?.setTexture(tex.clone());
        const img = tex.image as CanvasImageSource & { width: number; height: number } | undefined;
        if (!img || typeof document === 'undefined') return;
        const c = document.createElement('canvas');
        c.width = c.height = 1;
        const g = c.getContext('2d');
        if (!g) return;
        g.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1);
        const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
        this.env.waterColor = [255 - r, 255 - gr, 255 - b];
        if (this.env.underwater) this.env.apply(this.clock.hour, this.clock.minute);
      });
    };
    this.host.waterAlpha = a => { o.sea?.setAlpha(a); };
    this.host.ride = id => {
      if (!this.vehicles.ride(id)) return false;
      const rec = registry.get(CLS.unit, id);
      if (rec) this.player.yaw = rec.yaw * DEG;
      return true;
    };
    this.host.getOff = () => this.vehicles.stop();
    this.host.riding = () => this.vehicles.driving;
    this.host.msgwin = (text, color) => {
      this.modalQueue ??= [];
      this.panels.msgwin(text, color, () => {
        const queued = this.modalQueue ?? [];
        this.modalQueue = null;
        this.syncLock();
        for (const run of queued) run();
      });
      this.syncLock();
    };
    this.host.inputwin = text => {
      this.input.release();
      return (typeof window !== 'undefined' ? window.prompt(text) : null) ?? '';
    };
    this.host.loadMap = (path, flags) => {
      if (this.modalQueue) { this.modalQueue.push(() => this.host.loadMap(path, flags)); return; }
      stashTakeover(collectTakeover({ registry, playerId: PLAYER_ID, weaponTyp: this.weapons.weaponTyp, engine: this.engine, diary: this.host.diary, locks: this.host.locks, skills: this.host.skills }, flags));
      location.assign(playUrl(path.replace(/\\/g, '/')));
    };
    this.host.loadMapTakeover = () => this.tookOver;
    this.host.quit = () => {
      if (this.modalQueue) { this.modalQueue.push(() => this.host.quit()); return; }
      location.assign(MENU_URL);
    };
    this.host.credits = () => {
      void o.res.text('/sys/credits.inf').catch(() => '').then(text => {
        this.panels.msgbox('Credits', text, () => location.assign(MENU_URL));
        this.syncLock();
      });
    };
    this.host.impact = () => this.weapons.impact;
    this.host.playerWeapon = () => this.weapons.weaponTyp;
    this.host.setPlayerWeapon = typ => { const ok = this.weapons.takeInHand(typ); this.refreshWeaponHud(); return ok; };
    this.combine = new Combine({ registry, engine: this.engine, world: o.world, locks: this.host.locks, playerId: PLAYER_ID, combinations, message, sound });
    const buildSmoke = (x: number, z: number, n: number) => {
      const y = terrainY(x, z);
      const r = (a: number, b: number) => a + Math.random() * (b - a);
      for (let i = 0; i < n; i++) this.particles.add(x + r(-10, 10), y + this.host.random(2, 5), z + r(-10, 10), P.smoke, r(5, 10), r(0.3, 1.5));
    };
    this.build = new Build({
      registry, engine: this.engine, world: o.world, locks: this.host.locks, playerId: PLAYER_ID, buildings, terrainY, message, sound,
      onPlaced: site => buildSmoke(site.x, site.z, 10),
      onFinished: rec => {
        buildSmoke(rec.x, rec.z, 15);
        // 原版建成的物体先关闭碰撞并加幽灵状态，玩家走开 75 以上才恢复，避免卡在建筑里
        if (rec.cls === CLS.object && (rec.def?.col ?? 1) > 0) {
          this.engine.stateRules.set(CLS.object, rec.id, ST.ghost);
          if (rec.object) this.collider.remove(rec.object);
        }
      },
    });
    this.host.builtAt = id => this.build.builtAt(id);
    this.host.lastBuildingSite = () => this.build.lastSite;
    const settings = this.settings;
    this.tools = new Tools({
      registry, world: o.world, engine: this.engine, playerId: PLAYER_ID, infoRadius: id => this.host.infoRadius(id), terrainY,
      random: (a, b) => this.host.random(a, b), message, sound, digTimeMs: settings.digTime, fishTimeMs: settings.fishTime,
    });

    this.invUi = new InventoryUi(o.root, {
      items: () => registry.storedIn(CLS.unit, PLAYER_ID),
      usedWeight: () => registry.usedWeight(CLS.unit, PLAYER_ID),
      maxWeight: () => playerDef?.maxweight ?? 25000,
      hasEvent: (rec, event) => this.engine.scriptsFor(CLS.item, rec.id, event).length > 0 || (event === 'use' && ITEM_ACTIONS.has(rec.def?.behaviour ?? '')),
      weaponTyp: () => this.weapons.weaponTyp,
      use: rec => this.useItem(rec, 'use'),
      eat: rec => this.useItem(rec, 'eat'),
      drop: rec => this.drop(rec),
      takeInHand: rec => { this.weapons.takeInHand(rec ? rec.typ : 0); this.engine.update(0); this.refreshWeaponHud(); },
      combineCandidates: sel => this.combine.candidates(sel),
      combine: (c: Candidate, sel) => { this.combine.execute(c.combi, sel); },
    });
    this.buildUi = new BuildUi(o.root, {
      buildings: () => this.build.available(),
      itemName: typ => o.defs.items.get(typ)?.name ?? `#${typ}`,
      have: typ => registry.countStored(CLS.unit, PLAYER_ID, typ),
      choose: b => this.startPlacing(b),
    });
    o.canvas.addEventListener('click', () => { if (!this.overlayOpen() && !this.stats.dead) this.input.requestLock(true); });
    this.applyOptions(this.options);
    this.player.applyTo(o.camera);
    this.hud.setStats(this.stats);
    this.hud.setClock(this.clock.day, this.clock.hour, this.clock.minute);
    o.log.info(`play mode: spawn ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${(-pos.z).toFixed(0)}, ${this.collider.items.length} colliders, ${combinations.length} combinations, ${buildings.length} buildings, ${this.engine.syntaxErrors.length} script syntax errors`);

    const takeover = popTakeover();
    if (takeover && (takeover.items.length || takeover.vars.length || takeover.diary.length || takeover.states.length || takeover.locks.length || takeover.weapon || takeover.skills?.length)) {
      applyTakeover({ registry, playerId: PLAYER_ID, engine: this.engine, diary: this.host.diary, locks: this.host.locks, skills: this.host.skills, takeInHand: typ => { this.weapons.takeInHand(typ); this.refreshWeaponHud(); } }, takeover);
      this.tookOver = true;
    }
    if (o.restore) {
      this.restoring = true;
      restore({
        registry, engine: this.engine, world: o.world, playerId: PLAYER_ID, now: this.gameMs, clock: this.clock, stats: this.stats,
        setPlayer: p => { this.player.position.set(p.x, p.y, -p.z); this.player.yaw = p.yaw * DEG; this.player.pitch = -p.pitch * DEG; },
        takeInHand: typ => { this.weapons.takeInHand(typ); this.refreshWeaponHud(); },
        diary: this.host.diary, locks: this.host.locks, setBuffer: text => this.host.buffer.set(text),
        setSkills: entries => this.host.skills.load(entries),
        setTriggers: states => this.triggers.restore(states),
        setPaths: paths => { for (const p of paths) this.unitPaths.set(p.unitId, p.nodes); },
        setIndicators: ids => { this.host.indicators.clear(); for (const id of ids) this.host.indicators.add(id); },
        setSpawnDays: days => this.dayUpdate.restoreSpawnDays(days),
        setWeather: w => {
          this.weather.climate = w.climate;
          this.weather.rainRatio = w.rain;
          this.weather.snowRatio = w.snow;
          this.weather.current = w.current;
          this.weather.grey = w.current ? 0.75 : 0;
        },
        setDrive: id => { this.vehicles.ride(id); },
      }, o.restore);
      this.restoring = false;
      this.stateEffects.restoreLights();
      this.env.apply(this.clock.hour, this.clock.minute);
      this.player.applyTo(o.camera);
      o.log.info(`loaded save from ${o.restore.savedAt}, ${o.restore.entities.length} entities`);
    } else {
      this.engine.globalEvent('start');
    }
    this.engine.globalEvent('load');
    if (h.music.trim()) this.sounds.music(h.music, 1);
  }

  private mountScripts(gameInf: string, statesInf: string): void {
    const { defs, map, world, log } = this.o;
    const m = /script=start\r?\n([\s\S]*?)\r?\nscript=end/.exec(gameInf);
    if (m) this.engine.setGameScript(m[1], 'game.inf');
    if (map.header.briefing.trim()) this.engine.setMapScript(map.header.briefing, 'map briefing');
    for (const e of parseInf(statesInf)) {
      const name = e.fields.get('name')?.[0];
      if (name) this.engine.stateTypes.set(name.toLowerCase(), e.id);
      if (e.comment) this.engine.stateTypes.set(e.comment.toLowerCase(), e.id);
    }
    const tables: [number, Map<number, { script?: string }> | undefined, string][] = [
      [CLS.object, defs.objects, 'objects'], [CLS.unit, defs.units, 'units'], [CLS.item, defs.items, 'items'], [CLS.info, defs.infos, 'infos'],
    ];
    for (const [cls, table, name] of tables) {
      if (!table) continue;
      for (const [typ, def] of table) if (def.script) this.engine.setTypeScript(cls, typ, def.script, `${name}#${typ}`);
    }
    const textContainers = new Set(world.registry.all(CLS.info, TEXT_CONTAINER_INFO_TYP).map(r => r.id));
    for (const ext of map.extensions) {
      switch (ext.mode) {
        case 0:
          if (ext.parentClass === CLS.info && textContainers.has(ext.parentId)) break;
          if (ext.value.trim()) this.engine.addInstanceScript(ext.parentClass, ext.parentId, ext.value, false, `map ${ext.parentClass}:${ext.parentId}`);
          break;
        case 1:
          this.engine.vars.globals.set(ext.key, ext.value);
          break;
        case 3:
          this.host.locks.add(`building:${ext.key}`);
          break;
        case 4:
          this.engine.vars.setLocal(ext.parentClass, ext.parentId, ext.key, ext.value);
          break;
        case 50:
          this.host.locks.add(`combi:${ext.key}`);
          break;
        default:
          break;
      }
    }
    for (const cls of [CLS.object, CLS.unit, CLS.item, CLS.info]) {
      for (const rec of world.registry.all(cls)) {
        for (const v of rec.def?.vars ?? []) {
          if (!this.engine.vars.hasLocal(cls, rec.id, v.name)) this.engine.vars.setLocal(cls, rec.id, v.name, v.value);
        }
      }
    }
    if (this.engine.syntaxErrors.length) log.warn(`${this.engine.syntaxErrors.length} script syntax errors; see the console`);
  }

  private overlayOpen(): boolean {
    return this.invUi.open || this.buildUi.open || this.panels.paused || this.pauseMenu.open || this.exchangeUi.open;
  }

  private startProcess(title: string, ms: number, event: string, onDone?: () => void): void {
    this.process = { title, start: this.gameMs, ms, event, onDone };
    this.hud.setProcess(title, 0);
  }

  update(dtMs: number): void {
    const input = this.input;
    if (this.panels.paused || this.pauseMenu.open || this.exchangeUi.open) {
      if (this.panels.menuId() === MENU_CRACKLOCK) for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) if (input.hit(k)) this.panels.crackKey(k);
      if (input.hit('Escape')) {
        if (this.pauseMenu.open) this.pauseMenu.close();
        else if (this.exchangeUi.open) this.exchangeUi.close();
        else this.panels.close();
      }
      input.consumeLook();
      if (!this.panels.paused && !this.pauseMenu.open && !this.exchangeUi.open) this.syncLock();
      this.hud.showHint(false);
      input.endFrame();
      return;
    }
    this.gameMs += dtMs;
    const now = performance.now();
    const frozen = this.process !== null;
    const inSeq = this.sequence.active;
    if (!this.stats.dead) {
      if (inSeq && input.hit('Escape')) this.sequence.skip();
      if (this.hitKey('diary') && !inSeq && !this.overlayOpen()) { this.panels.openDiary(this.host.diary, this.host.skills.entries()); this.syncLock(); }
      if (this.hitKey('inventory') && !inSeq) {
        if (this.buildUi.open) this.buildUi.close();
        this.invUi.toggle();
        this.syncLock();
      }
      if (this.hitKey('build') && !inSeq) this.toggleBuildMenu();
      if (this.hitKey('sleep') && !inSeq && !this.overlayOpen() && !this.stats.dead) this.sleep();
      if (input.hit('Escape')) {
        if (this.placing) this.stopPlacing();
        else if (!inSeq && !this.overlayOpen()) { this.pauseMenu.show(); this.syncLock(); }
      }
      if (this.hitKey('quicksave') && !inSeq) this.save(QUICKSAVE);
      if (this.hitKey('quickload') && !inSeq && loadGame(QUICKSAVE)) location.assign(loadSaveUrl(QUICKSAVE));
      const canAct = !this.overlayOpen() && input.locked && !frozen && !inSeq && !this.playerRec.frozen;
      const ride = this.stats.dead ? (this.vehicles.stop(), undefined) : this.vehicles.current();
      if (ride) {
        // 骑乘（game_functions.bb game_setcam）：玩家固定在单位上方 rideoffset 处，不受自身物理与碰撞
        const look = canAct ? input.consumeLook() : (input.consumeLook(), { dx: 0, dy: 0 });
        this.player.look(look.dx, look.dy);
        this.vehicles.update(dtMs, {
          forward: canAct && this.downKey('forward'),
          backward: canAct && this.downKey('backward'),
          left: canAct && this.downKey('left'),
          right: canAct && this.downKey('right'),
        }, this.unitPaths.controlled(ride.id));
        this.player.position.set(ride.x, ride.y + (ride.def?.rideoffset ?? 0), -ride.z);
        if (canAct) {
          if (this.hitKey('attack1')) this.attack1();
          if (this.hitKey('attack2')) this.attack2();
          if (this.hitKey('use')) this.use();
        }
      } else if (canAct) {
        const look = input.consumeLook();
        this.player.update(dtMs, now, {
          forward: this.downKey('forward'),
          backward: this.downKey('backward'),
          left: this.downKey('left'),
          right: this.downKey('right'),
          jump: this.downKey('jump'),
          lookDx: look.dx,
          lookDy: look.dy,
        }, this.ground, this.collider);
        if (this.player.jumpedThisFrame) this.stats.jump(now);
        if (this.placing) {
          this.updatePlacing();
          if (this.hitKey('attack1')) this.confirmPlacing();
        } else {
          if (this.hitKey('attack1')) this.attack1();
          if (this.hitKey('attack2')) this.attack2();
          if (this.hitKey('use')) this.use();
        }
      } else {
        input.consumeLook();
        this.player.update(dtMs, now, { forward: false, backward: false, left: false, right: false, jump: false, lookDx: 0, lookDy: 0 }, this.ground, this.collider);
      }
      const damage = this.stats.update(dtMs, this.player.movedThisFrame, this.player.swimming);
      if (damage > 0) this.hud.message(`Starving and thirsty, you lose ${damage} health`, 3);
      this.updateAir(dtMs);
      this.updateMoveFx(dtMs);
      this.updateFishingAreas(dtMs);
      if (this.stats.dead) {
        this.hud.showDead();
        input.release();
      }
    }

    const p = this.player.position;
    this.playerRec.x = p.x;
    this.playerRec.y = p.y;
    this.playerRec.z = -p.z;
    this.playerRec.yaw = this.player.yaw / DEG;
    this.playerRec.health = this.stats.health;

    const dayBefore = this.clock.day;
    if (this.clock.advance(dtMs) > 0) {
      this.env.apply(this.clock.hour, this.clock.minute);
      if (this.clock.day !== dayBefore) this.dayUpdate.changeDay();
    }

    if (this.process) {
      const elapsed = this.gameMs - this.process.start;
      if (elapsed >= this.process.ms) {
        const done = this.process;
        this.process = null;
        this.hud.setProcess(null);
        done.onDone?.();
        if (done.event) this.engine.globalEvent(done.event);
      } else {
        this.hud.setProcess(this.process.title, elapsed / this.process.ms);
      }
    }

    this.engine.update(dtMs);
    this.unitPaths.update(dtMs);
    this.ai.update(dtMs, this.gameMs);
    this.itemPhysics.update(dtMs, this.gameMs, this.cam());
    this.stateEffects.update(dtMs, this.gameMs);
    this.weather.update(dtMs, false);
    this.particles.update(dtMs);
    this.grass.update(this.o.camera, dtMs);
    this.shoreWaves.update(dtMs);
    this.objectBehaviour.update(dtMs, this.gameMs);
    const cam = this.cam();
    this.sounds.listener = cam;
    this.lights.update(cam);
    this.weatherBox.position.copy(this.o.camera.position);
    (this.weatherBox.material as THREE.MeshBasicMaterial).opacity = this.weather.grey;
    this.weatherBox.visible = this.weather.grey > 0;
    this.projectiles.update(dtMs);
    this.triggers.update(dtMs);

    this.focusAcc += dtMs;
    if (this.focusAcc >= FOCUS_INTERVAL_MS) {
      this.focusAcc = 0;
      this.focused = this.pickup.focus();
      if (this.focused) {
        this.hud.setFocus(`${this.focused.def?.name ?? 'Item'}${this.focused.count > 1 ? ` x ${this.focused.count}` : ''}`);
      } else {
        const hit = input.locked && !this.overlayOpen() ? this.weapons.pick(USE_ENTITY_RANGE) : null;
        const corpse = hit && !hit.ground && hit.cls === CLS.unit ? this.o.world.registry.get(CLS.unit, hit.id) : undefined;
        this.hud.setFocus(corpse?.dead ? `Dead ${corpse.def?.name ?? 'animal'} (E to loot)` : null);
      }
    }

    this.player.applyTo(this.o.camera);
    this.sequence.update(dtMs);
    if (this.sequence.active) {
      const c = this.sequence.camera;
      this.o.camera.position.set(c.x, c.y, -c.z);
      this.o.camera.quaternion.setFromEuler(new THREE.Euler(-c.pitch * DEG, c.yaw * DEG, 0, 'YXZ'));
    }
    this.seqUi.render(this.sequence);
    this.hud.setVisible(!this.sequence.active);
    this.hud.setStats(this.stats);
    this.hud.setClock(this.clock.day, this.clock.hour, this.clock.minute);
    this.hud.showHint(!input.locked && !this.overlayOpen() && !this.stats.dead && !this.sequence.active, input.lockRefused);
    if (this.pendingAutosave) {
      this.pendingAutosave = false;
      if (!saveGame(AUTOSAVE, this.snapshot())) this.hud.message('Saving failed', 3);
    }
    input.endFrame();
  }

  private syncLock(): void {
    if (this.overlayOpen()) this.input.release();
    else this.input.requestLock();
  }

  private toggleBuildMenu(): void {
    if (this.placing) {
      this.confirmPlacing();
      return;
    }
    if (this.invUi.open) this.invUi.toggle();
    this.buildUi.toggle();
    this.syncLock();
  }

  private startPlacing(b: Building): void {
    this.buildUi.close();
    this.syncLock();
    this.placing = { building: b };
    if (b.objectId > 0) {
      void this.o.world.spawnModel(CLS.object, b.objectId).then(obj => { if (this.placing?.building === b) this.placing.footprint = obj; });
    }
    this.hud.setMode(`Placing ${b.name}: B or left click to confirm, Esc to cancel`);
    this.updatePlacing();
  }

  /** 建筑模型放在 (x, z) 时是否与有碰撞的物体相交；按包围盒近似原版的网格相交。 */
  private placementBlocked(x: number, z: number, yaw: number): boolean {
    const p = this.placing;
    if (!p?.footprint || p.building.space === 'atobject') return false;
    const fp = p.footprint;
    fp.position.set(x, worldHeight(this.o.map, x, z), -z);
    fp.rotation.set(0, yaw * DEG, 0, 'YXZ');
    fp.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(fp).expandByScalar(-2);
    if (box.isEmpty()) return false;
    const reach = box.getSize(new THREE.Vector3()).length() / 2 + 200;
    for (const rec of this.o.world.registry.all(CLS.object)) {
      if (rec === p.preview || !rec.object || (rec.def?.col ?? 1) === 0) continue;
      if (Math.hypot(rec.x - x, rec.z - z) > reach) continue;
      if (box.intersectsBox(new THREE.Box3().setFromObject(rec.object))) return true;
    }
    return false;
  }

  private placeTarget(): { x: number; z: number } {
    const dir = this.o.camera.getWorldDirection(new THREE.Vector3());
    dir.y = 0;
    if (dir.lengthSq() === 0) dir.set(0, 0, -1);
    dir.normalize();
    const p = this.player.position;
    return { x: p.x + dir.x * PLACE_DISTANCE, z: -(p.z + dir.z * PLACE_DISTANCE) };
  }

  private updatePlacing(): void {
    if (!this.placing) return;
    const t = this.placeTarget();
    const b = this.placing.building;
    if (!this.placing.preview) {
      const typ = b.siteObject || (worldHeight(this.o.map, t.x, t.z) < 0 ? 151 : 150);
      const preview = this.o.world.create(CLS.object, typ, t.x, t.z);
      if (preview) this.placing.preview = preview;
    }
    const preview = this.placing.preview;
    if (preview) {
      preview.x = t.x;
      preview.z = t.z;
      preview.y = objectHeight(this.o.map, preview.def, t.x, t.z);
      preview.yaw = this.player.yaw / DEG;
      this.o.world.sync(preview);
    }
    const fail = this.build.checkSpace(b, t.x, t.z) ?? (this.placementBlocked(t.x, t.z, this.player.yaw / DEG) ? 'not enough space here' : null);
    this.hud.setMode(fail ? `Placing ${b.name}: ${fail}` : `Placing ${b.name}: B or left click to confirm, Esc to cancel`);
  }

  private confirmPlacing(): void {
    if (!this.placing) return;
    const { building, preview } = this.placing;
    const t = this.placeTarget();
    if (this.placementBlocked(t.x, t.z, this.player.yaw / DEG)) {
      this.hud.message('There is not enough space here', 3);
      this.sounds.play('fail.wav');
      return;
    }
    if (preview) this.o.world.remove(preview);
    this.placing = null;
    this.hud.setMode(null);
    const site = this.build.place(building, t.x, t.z, this.player.yaw / DEG);
    if (site) this.hud.message(`Building site for ${building.name} placed. Hold a hammer and right click it to add materials.`, 4);
    this.engine.update(0);
  }

  private stopPlacing(): void {
    if (!this.placing) return;
    if (this.placing.preview) this.o.world.remove(this.placing.preview);
    this.placing = null;
    this.hud.setMode(null);
  }

  private attack1(): void {
    const r = this.weapons.attack1();
    this.engine.update(0);
    if (r !== 'cooldown') this.refreshWeaponHud();
  }

  private attack2(): void {
    const item = this.weapons.weaponItem();
    if (!item) {
      this.use();
      this.engine.entityEvent(CLS.unit, PLAYER_ID, 'attack2');
      return;
    }
    let skip = false;
    if (this.engine.runNow(CLS.item, item.id, 'attack2').skipevent) skip = true;
    if (this.engine.runNow(CLS.unit, PLAYER_ID, 'attack2').skipevent) skip = true;
    if (skip) return;
    switch (this.weapons.behaviour()) {
      case 'hammer': {
        const r = this.build.hammer(this.playerRec.x, this.playerRec.z);
        if (r === 'none') this.hud.message('No building site nearby', 3);
        break;
      }
      case 'spade': this.startTool('dig'); break;
      case 'fishingrod': this.startTool('fish'); break;
      case 'net': this.catchWithNet(item); break;
      default: break;
    }
    this.engine.update(0);
  }

  /**
   * 持网右键（game_functions.bb game_catch）：按物品 rate 冷却，作用距离取物品 speed（原版 range 也写进 speed），
   * 对准星命中的物体、单位或物品触发 catch 事件；没有响应者时触发全局 catch_failure。
   */
  private catchWithNet(item: EntityRecord): void {
    const def = item.def;
    if (!def || this.gameMs - this.lastCatch < def.rate) return;
    this.lastCatch = this.gameMs;
    this.sounds.play('swing_slow.wav');
    const hit = this.weapons.pick(def.speed > 0 ? def.speed : def.range);
    if (hit && !hit.ground && this.engine.scriptsFor(hit.cls, hit.id, 'catch').length > 0) {
      this.engine.runNow(hit.cls, hit.id, 'catch');
      return;
    }
    this.engine.globalEvent('catch_failure');
  }

  private startTool(kind: ToolKind): void {
    const { title, ms } = this.tools.start(kind);
    this.startProcess(title, ms, '', () => {
      const eye = this.player.eye();
      this.tools.finish(kind, { x: eye.x, y: eye.y, z: -eye.z, dirX: -Math.sin(this.player.yaw), dirZ: Math.cos(this.player.yaw) });
      this.engine.update(0);
    });
  }

  private refreshWeaponHud(): void {
    const typ = this.weapons.weaponTyp;
    const def = typ ? this.o.defs.items.get(typ) : undefined;
    this.hud.setWeapon(def ? { name: def.name, icon: def.icon ? encodeURI(assetUrl(def.icon)) : undefined } : null);
  }

  private use(): void {
    // game_use：骑乘时 E 键下来，载具的 getoff 脚本可用 skipevent 拒绝
    if (this.vehicles.driving) {
      const r = this.engine.runNow(CLS.unit, this.vehicles.driving, 'getoff');
      if (!r.skipevent) this.vehicles.stop();
      return;
    }
    const target = this.pickup.focus();
    if (target) {
      this.collect(target);
      return;
    }
    const hit = this.weapons.pick(USE_ENTITY_RANGE);
    if (hit && !hit.ground && (hit.cls === CLS.unit || hit.cls === CLS.object)) {
      const r = this.engine.runNow(hit.cls, hit.id, 'use');
      this.engine.update(0);
      const corpse = hit.cls === CLS.unit ? this.o.world.registry.get(CLS.unit, hit.id) : undefined;
      if (!r.skipevent && corpse?.dead) this.openExchange(CLS.unit, hit.id, false, []);
      return;
    }
    const aim = this.aimGround();
    if (!aim) return;
    this.useTargetPos = aim.point;
    this.engine.runGlobalNow(aim.sea ? 'usesea' : 'useground');
  }

  /** 沿视线每 2 单位采样，先碰到海面为 usesea，先碰到地形为 useground。 */
  private aimGround(): { sea: boolean; point: { x: number; y: number; z: number } } | null {
    const origin = this.o.camera.getWorldPosition(new THREE.Vector3());
    const dir = this.o.camera.getWorldDirection(new THREE.Vector3());
    for (let t = 0; t <= 48; t += 2) {
      const p = origin.clone().add(dir.clone().multiplyScalar(t));
      const ground = this.ground.heightAt(p.x, p.z);
      if (p.y <= ground) return { sea: false, point: { x: p.x, y: ground, z: -p.z } };
      if (p.y <= SEA_LEVEL && ground < SEA_LEVEL) return { sea: true, point: { x: p.x, y: SEA_LEVEL, z: -p.z } };
    }
    return null;
  }

  private collect(rec: EntityRecord): void {
    if (this.engine.runNow(CLS.item, rec.id, 'collect').skipevent) return;
    const registry = this.o.world.registry;
    const name = rec.def?.name ?? `#${rec.typ}`;
    const stored = registry.store(rec.id, CLS.unit, PLAYER_ID);
    if (stored <= 0) {
      this.hud.message('No space left', 3);
      this.sounds.play('fail.wav');
      return;
    }
    const still = registry.get(CLS.item, rec.id);
    if (still) this.o.world.sync(still);
    else this.o.world.remove(rec);
    this.hud.message(`Picked up ${name} x ${stored}`, 4);
    this.sounds.play('collect.wav');
    this.focused = null;
    this.hud.setFocus(null);
  }

  private drop(rec: EntityRecord): void {
    if (rec.parentMode !== STORED_INSIDE) return;
    if (this.engine.runNow(CLS.item, rec.id, 'drop').skipevent) return;
    const p = this.player.position;
    const out = this.o.world.registry.unstore(rec.id, 1, p.x, worldHeight(this.o.map, p.x, -p.z), -p.z);
    if (!out) return;
    this.o.world.sync(out);
    if (rec.typ === this.weapons.weaponTyp && !this.weapons.weaponItem()) {
      this.weapons.unequip();
      this.refreshWeaponHud();
    }
    this.hud.message(`Dropped ${rec.def?.name ?? `#${rec.typ}`}`, 0);
  }

  private useItem(rec: EntityRecord, event: 'use' | 'eat'): void {
    const r = this.engine.runNow(CLS.item, rec.id, event);
    this.engine.update(0);
    // handle_items.bb use_item：脚本没有 skipevent 时按物品行为执行默认动作。
    if (event === 'use' && !r.skipevent) {
      const beh = rec.def?.behaviour ?? '';
      if (beh === 'map') this.openMap();
      else if (beh === 'watch') {
        if (this.clock.hour === 13 && this.clock.minute === 37) {
          this.hud.message("13:37 o'clock - Y4y! t3h 3l!te!", 0);
          this.engine.globalEventNow('leet');
          this.particles.add(0, 0, 0, P.flash, 0.06, 0.75)?.color(0, 255, 0);
        } else {
          this.hud.message(`${this.clock.hour}:${String(this.clock.minute).padStart(2, '0')} o'clock`, 0);
        }
      }
    }
    if (!this.weapons.weaponItem()) {
      this.weapons.unequip();
      this.refreshWeaponHud();
    }
  }

  /** 单位沿 (dx, dz)（Blitz 坐标）移动：与玩家一样沿物体滑动，再用八方向推出已有的重叠。 */
  private unitCollide(rec: EntityRecord, dx: number, dz: number): { dx: number; dz: number } {
    const def = rec.def;
    const radius = def?.colxr ?? 10;
    const pos = new THREE.Vector3(rec.x, rec.y, -rec.z);
    const resolved = this.collider.resolveMove(pos, new THREE.Vector3(dx, 0, -dz), radius, def?.colyr ?? 10);
    const out = this.collider.pushOut(pos.clone().add(resolved), radius);
    return { dx: resolved.x + out.x, dz: -(resolved.z + out.z) };
  }

  /** 单位攻击玩家：扣生命、提示与音效；生命归零时进入死亡画面。 */
  private playerHurt(amount: number, by?: EntityRecord): void {
    if (this.stats.dead) return;
    this.stats.health = Math.max(0, this.stats.health - amount);
    if (by) this.hud.message(`${by.def?.name ?? 'Something'} hits you for ${amount} health`, 3);
    this.sounds.play(`human_hit${this.host.random(1, 5)}.wav`);
    this.particles.add(0, 0, 0, P.flash, 0.06, 0.75)?.color(255, 0, 0);
    if (this.stats.dead) {
      this.hud.showDead();
      this.input.release();
    }
  }

  /** play_soundset：单位定义 sfx= 音效组里该事件的声音，按距离衰减。 */
  private unitSound(rec: EntityRecord, event: SoundEvent): void {
    const file = this.soundSets?.file(rec.def?.sfx ?? '', event);
    if (file) this.sounds.playAt(file, rec);
  }

  private unitDied(rec: EntityRecord): void {
    this.host.freezeUnit(rec.id, false);
    rec.playAnim?.('die', false);
    this.sounds.channel(`unit:${rec.id}`, null);
    this.unitSound(rec, 'die');
    this.hud.message(`${rec.def?.name ?? 'The animal'} died`, 0);
  }

  private entityDied(rec: EntityRecord): void {
    if (rec.cls === CLS.unit) this.weapons.kill(rec);
    else this.weapons.kill(rec);
  }

  /** 打开与容器的交换界面；单件移动，放入受容器承重限制。 */
  private openExchange(cls: number, id: number, allowStore: boolean, only: number[]): void {
    const registry = this.o.world.registry;
    const holder = registry.get(cls, id);
    if (!holder) return;
    const p = this.player.position;
    this.exchangeUi.show({
      title: () => holder.def?.name ?? 'Container',
      playerItems: () => registry.storedIn(CLS.unit, PLAYER_ID),
      containerItems: () => registry.storedIn(cls, id),
      move: (item, toContainer, count) => {
        const [fromCls, fromId, toCls, toId] = toContainer ? [CLS.unit, PLAYER_ID, cls, id] : [cls, id, CLS.unit, PLAYER_ID];
        const loose = registry.unstore(item.id, count, p.x, p.y, -p.z);
        if (!loose) return false;
        const moved = registry.store(loose.id, toCls, toId);
        if (moved < count) {
          if (registry.get(CLS.item, loose.id)?.parentMode !== STORED_INSIDE) registry.store(loose.id, fromCls, fromId);
          this.hud.message('No space left', 3);
        }
        return moved > 0;
      },
      name: typ => this.o.defs.items.get(typ)?.name ?? `#${typ}`,
      icon: typ => { const icon = this.o.defs.items.get(typ)?.icon; return icon ? encodeURI(assetUrl(icon)) : undefined; },
      capacity: () => {
        const max = holder.def?.maxweight ?? 0;
        return max > 0 ? `Container load ${registry.usedWeight(cls, id)} / ${max}` : '';
      },
      onClose: () => { this.refreshWeaponHud(); this.syncLock(); },
    }, allowStore, only);
    this.syncLock();
  }

  /** 当前状态的存档快照。 */
  snapshot(): Snapshot {
    const p = this.player.position;
    return snapshot({
      mapPath: this.o.mapPath, registry: this.o.world.registry, engine: this.engine, now: this.gameMs,
      clock: { day: this.clock.day, hour: this.clock.hour, minute: this.clock.minute },
      player: { x: p.x, y: p.y, z: -p.z, yaw: this.player.yaw / DEG, pitch: -this.player.pitch / DEG },
      stats: this.stats, weapon: this.weapons.weaponTyp, diary: this.host.diary, locks: this.host.locks, buffer: this.host.buffer.value,
      skills: this.host.skills.entries(), triggers: this.triggers.states(), paths: this.unitPaths.entries(),
      indicators: [...this.host.indicators],
      spawnDays: this.dayUpdate.spawnDays(),
      weather: { current: this.weather.current, climate: this.weather.climate, rain: this.weather.rainRatio, snow: this.weather.snowRatio },
      drive: this.vehicles.driving || undefined,
    });
  }

  save(name: string): void {
    const ok = saveGame(name, this.snapshot());
    this.hud.message(ok ? `Saved to ${name}` : 'Saving failed', ok ? 1 : 2);
  }

  /** 打开地图界面；底图在第一次打开时生成。 */
  private openMap(): void {
    if (this.invUi.open) this.invUi.toggle();
    const registry = this.o.world.registry;
    this.mapTerrain ??= renderTerrainMap((x, z) => worldHeight(this.o.map, x, z), this.o.map.terrainSize);
    const infos = new Map(this.o.map.infos.map(i => [i.id, i]));
    const markers = registry.all(CLS.info, 36).filter(r => this.host.indicators.has(r.id)).map(r => {
      const info = infos.get(r.id);
      return { x: r.x, z: r.z, frame: info?.ints[0] ?? 0, label: info?.strings[0] ?? '' };
    });
    this.panels.showMap(buildMapView({
      terrain: this.mapTerrain, terrainSize: this.o.map.terrainSize, markers,
      player: { x: this.playerRec.x, z: this.playerRec.z, yaw: this.player.yaw / DEG }, arrows: this.mapArrows,
    }));
    this.syncLock();
  }

  /**
   * 憋气（game_input.bb 与 e_environment.bb）：眼睛低于水面开始潜水，超过 dive_time 后每秒扣 dive_damage；
   * 回到水面恢复，潜水超过 1.5 秒浮出时喘气。水下时地图环境音换成循环的 dive.wav（sfx.bb）。
   */
  /**
   * 移动音效与水面效果（game_input.bb）：着地行走每 500 毫秒一声脚步，脚在水面以下时为涉水声加涟漪与水花；
   * 游泳时镜头在水面以上每 100 毫秒在身边生成涟漪，移动时每秒一声划水。
   */
  private updateMoveFx(dtMs: number): void {
    const pl = this.player;
    const p = pl.position;
    const bx = p.x, bz = -p.z;
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    if (pl.swimming) {
      this.waveAcc += dtMs;
      if (this.waveAcc >= 100) {
        this.waveAcc %= 100;
        if (pl.eye().y > 0) this.particles.add(bx + r(-3, 3), 1, bz + r(-3, 3), P.rwave, r(3, 6), r(0.3, 0.7));
      }
      if (pl.movedThisFrame && this.gameMs - this.lastStep > 1000) {
        this.lastStep = this.gameMs;
        this.sounds.play('swim.wav');
      }
      return;
    }
    if (!pl.movedThisFrame || !pl.onGround || this.gameMs - this.lastStep <= 500) return;
    this.lastStep = this.gameMs;
    if (p.y - PLAYER.halfHeight > 0) {
      this.sounds.play(`step${this.host.random(1, 4)}.wav`);
    } else {
      this.sounds.play('waterstep.wav');
      this.particles.add(bx, 1, bz, P.rwave, r(5, 10), r(0.9, 1.5));
      this.particles.add(bx, 1, bz, P.splash, r(15, 20), 1);
    }
  }

  /** 每秒一次（cull.bb 的 in_t1000go）：镜头附近的钓鱼区（信息点 43）水面冒涟漪、水下冒泡。 */
  private updateFishingAreas(dtMs: number): void {
    this.infoAcc += dtMs;
    if (this.infoAcc < 1000) return;
    this.infoAcc %= 1000;
    const e = this.camThree();
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    for (const info of this.o.world.registry.all(CLS.info, FISHING_INFO_TYP)) {
      const radius = this.o.map.infos.find(i => i.id === info.id)?.floats[0] ?? 0;
      if (Math.hypot(info.x - e.x, info.z + e.z) - radius >= 500) continue;
      const spot = () => { const a = r(0, Math.PI * 2), d = r(0, radius); return { x: info.x + Math.sin(a) * d, z: info.z - Math.cos(a) * d }; };
      const s = spot();
      this.particles.add(s.x, 1, s.z, P.rwave, r(5, 10), r(0.9, 1.5));
      for (let i = 0, n = this.host.random(5, 10); i <= n; i++) {
        const b = spot();
        this.particles.add(b.x, -r(5, 50), b.z, P.bubbles, r(1, 3));
      }
    }
  }

  /** 水下（e_environment.bb）：每帧 1/10 机会在眼前冒泡，按特效档位在镜头周围生成悬浮物；原版每帧一次，按 20 毫秒折算。 */
  private diveFx(dtMs: number): void {
    this.diveFxAcc += dtMs;
    const e = this.player.eye();
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    for (; this.diveFxAcc >= 20; this.diveFxAcc -= 20) {
      if (this.host.random(1, 10) === 1) this.particles.add(e.x + r(-5, 5), e.y - 10, -e.z + r(-5, 5), P.bubbles, r(1, 3));
      const fx = this.prefs.effects;
      if (fx > 0 && this.host.random(1, fx === 1 ? 4 : 2) === 1) {
        let y = e.y + this.host.random(-100, 100);
        if (y > -20) y = -this.host.random(20, 70);
        this.particles.add(e.x + this.host.random(-200, 200), y, -e.z + r(-200, 200), P.hover, r(0.3, 5));
      }
    }
  }

  private updateAir(dtMs: number): void {
    const under = this.player.eye().y < 0;
    if (!under) {
      if (this.diving) {
        this.env.underwater = false;
        this.env.apply(this.clock.hour, this.clock.minute);
        this.sounds.loop('ambient', null);
        this.sounds.pauseMusic(false);
        this.sounds.play('splash2.wav');
        if (this.gameMs - this.airSince > 1500) this.sounds.play('gasp.wav');
        this.diving = false;
      }
      this.airSince = this.gameMs;
      this.hud.setAir(null);
      return;
    }
    if (!this.diving) {
      this.diving = true;
      this.env.underwater = true;
      this.env.apply(this.clock.hour, this.clock.minute);
      this.sounds.pauseMusic(true);
      this.sounds.loop('ambient', 'dive.wav');
      this.sounds.play('startdive.wav');
    }
    this.diveFx(dtMs);
    const { diveTime, diveDamage } = this.settings;
    if (diveTime < 0) return;
    const used = this.gameMs - this.airSince;
    this.hud.setAir(Math.max(0, diveTime - used) / diveTime);
    if (used >= diveTime && this.gameMs - this.lastDrown >= 1000) {
      this.lastDrown = this.gameMs;
      this.sounds.play('drown.wav');
      const e = this.player.eye();
      for (let i = 0; i < 5; i++) this.particles.add(e.x + (Math.random() * 10 - 5), e.y - 10, -e.z + (Math.random() * 10 - 5), P.bubbles, 1 + Math.random() * 2);
      this.playerHurt(diveDamage);
    }
  }

  /**
   * 睡觉（game_functions.bb game_sleep）：先让所有脚本处理 sleep 事件（game.inf 检查疲劳、危险与水中，
   * 可 skipevent 拒绝）；时间未冻结时下午及以后睡到次日 7:00 并触发 changeday，上午睡 6 小时；
   * 时间冻结时只加一天。
   */
  sleep(): void {
    if (this.engine.globalEventNow('sleep')) {
      this.engine.update(0);
      return;
    }
    const c = this.clock;
    if (c.frozen) {
      c.day++;
    } else if (c.hour >= 12) {
      c.set(7, 0);
      this.dayUpdate.changeDay();
      c.day++;
    } else {
      c.set(c.hour + 6, c.minute);
    }
    this.hud.fadeFromBlack();
    this.sounds.play('sleep.wav');
    this.env.apply(c.hour, c.minute);
    this.hud.setClock(c.day, c.hour, c.minute);
    this.engine.update(0);
  }

  /** 调试：把时钟拨到指定时间并立即应用光照。 */
  setTime(hour: number, minute: number): void {
    this.clock.set(hour, minute);
    this.env.apply(hour, minute);
  }

  /** 动作按键：设置里绑定的键；方向另外接受方向键。 */
  private downKey(a: Action): boolean {
    return this.input.pressed(this.options.keys[a]) || (ARROWS[a] !== undefined && this.input.pressed(ARROWS[a]!));
  }

  private hitKey(a: Action): boolean {
    return this.input.hit(this.options.keys[a]);
  }

  /** 设置改动即时生效：草地密度、雾与视距、音量、鼠标。 */
  applyOptions(s: Settings): void {
    this.options = s;
    this.grass.setLevel(this.prefs.grass);
    this.env.viewFac = this.prefs.viewFac;
    this.env.fogEnabled = s.fog;
    this.env.apply(this.clock.hour, this.clock.minute);
    this.sounds.setMusicVolume(s.musicVolume);
    this.sounds.sfxVolume = s.sfxVolume;
    this.player.lookScale = s.mouseSensitivity;
    this.player.invertY = s.invertMouse;
  }

  /** 渲染用的镜头位置（原版 cam）：过场时不在玩家身上。Three 坐标与 Blitz 坐标两种。 */
  private camThree(): THREE.Vector3 {
    return this.o.camera.position;
  }

  private cam(): { x: number; y: number; z: number } {
    const p = this.o.camera.position;
    return { x: p.x, y: p.y, z: -p.z };
  }

  /** 本帧的动态模糊（motionblur.bb mb_update）：设置关掉时没有模糊，否则取设置值与脚本、状态覆盖中较大者，上限 0.97。 */
  blurAlpha(): number {
    if (!this.prefs.motionBlur) return 0;
    return Math.min(0.97, Math.max(this.prefs.motionBlurAlpha, this.scriptBlur, this.stateBlur));
  }

  /** 状态特效的固定偏移（state=）：单位与信息点缺省为 (0,0,0)，物体与物品缺省取模型随机顶点（返回 null）。 */
  private stateOffset(cls: number, id: number): [number, number, number] | null {
    if (cls === CLS.info) return [0, 0, 0];
    const s = this.o.world.registry.get(cls, id)?.def?.state;
    if (s === 'random') return null;
    if (s) return s;
    return cls === CLS.unit ? [0, 0, 0] : null;
  }

  /** parent_statepos：Blitz 坐标；baseY 为实体高度加偏移 y，低于 0 时燃烧熄灭。 */
  private statePosition(cls: number, id: number): { x: number; y: number; z: number; baseY: number } | null {
    const rec = this.o.world.registry.get(cls, id);
    if (!rec) return null;
    const off = this.stateOffset(cls, id);
    const baseY = rec.y + (off?.[1] ?? 0);
    if (off) return { x: rec.x + off[0], y: rec.y + off[1], z: rec.z + off[2], baseY };
    const v = randomVertex(rec.object);
    return v ? { x: v.x, y: v.y, z: -v.z, baseY } : { x: rec.x, y: rec.y, z: rec.z, baseY };
  }

  /** ha_heal：生命加回，不超过上限。 */
  private heal(cls: number, id: number, amount: number): void {
    const add = Math.abs(amount);
    if (cls === CLS.unit && id === PLAYER_ID) {
      this.stats.health = Math.min(this.stats.healthMax, this.stats.health + add);
      return;
    }
    const rec = this.o.world.registry.get(cls, id);
    if (!rec || rec.dead) return;
    const max = cls === CLS.unit ? rec.healthMax : rec.def?.health ?? rec.healthMax;
    rec.health = Math.min(max, rec.health + add);
  }

  dispose(): void {
    this.input.release();
    this.seqUi.dispose();
    this.panels.dispose();
    this.exchangeUi.dispose();
    this.hud.dispose();
    this.sounds.stopMusic();
    this.sounds.stopLoops();
  }
}

/** 模型上随机一个顶点的世界坐标（Three 坐标），用于没有固定偏移的状态特效。 */
function randomVertex(object: THREE.Object3D | undefined): THREE.Vector3 | null {
  if (!object) return null;
  const meshes: THREE.Mesh[] = [];
  object.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const mesh = meshes[Math.floor(Math.random() * meshes.length)];
  const pos = mesh?.geometry.getAttribute('position');
  if (!mesh || !pos || pos.count === 0) return null;
  mesh.updateWorldMatrix(true, false);
  return new THREE.Vector3().fromBufferAttribute(pos, Math.floor(Math.random() * pos.count)).applyMatrix4(mesh.matrixWorld);
}

/** 残影复制体：animate 已给它换上自己的材质，这里设颜色与混合方式（EntityColor / EntityBlend）。 */
function tintCopy(object: THREE.Object3D, color: [number, number, number], additive: boolean): void {
  object.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const mat = m as THREE.MeshBasicMaterial;
      mat.color?.setRGB(color[0] / 255, color[1] / 255, color[2] / 255);
      mat.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      mat.depthWrite = false;
    }
  });
}
