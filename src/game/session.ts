/** 游戏模式会话：组装玩家、时钟、光照、数值、拾取、背包、攻击、合成、建造、工具动作、界面与脚本引擎。 */
import * as THREE from 'three';
import type { MapData } from '../formats/s2map';
import { parseInf } from '../formats/inf';
import { parseCombinations, assignGroups, type Combination } from '../formats/combinations';
import { parseBuildings, type Building } from '../formats/buildings';
import type { Defs, World } from '../render/world';
import { worldHeight, SEA_LEVEL } from '../render/terrain';
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
import { Panels } from './panels';
import { UnitPaths } from './unitpath';
import { Triggers } from './triggers';
import { ExchangeUi } from './exchange-ui';
import { parseDialogue } from '../formats/dialogue';
import { collectTakeover, applyTakeover, stashTakeover, popTakeover } from './takeover';
import { playUrl, MENU_URL, PauseMenu, loadSaveUrl } from './menu-ui';
import { snapshot, restore, saveGame, loadGame, listSaves, QUICKSAVE, type Snapshot } from './savegame';
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
const PLACE_DISTANCE = 60;
/** 按 E 对物体或单位触发 use 事件的距离。 */
const USE_ENTITY_RANGE = 60;

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
}

function readGameSettings(gameInf: string): GameSettings {
  const num = (key: string, d: number) => {
    const m = new RegExp(`^${key}\\s*=\\s*(\\d+)`, 'm').exec(gameInf);
    return m ? parseInt(m[1], 10) : d;
  };
  return { digTime: num('dig_time', 2500), fishTime: num('fish_time', 2500) };
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
  private readonly ground: { heightAt(x: number, z: number): number };
  private gameMs = 0;
  private process: ProcessState | null = null;
  private useTargetPos = { x: 0, y: 0, z: 0 };
  private placing: { building: Building; preview?: EntityRecord } | null = null;

  static async create(o: SessionOptions): Promise<GameSession> {
    const text = (p: string) => o.res.text(p).catch(() => '');
    const [cycleText, gameInf, statesInf, buildingsInf] = await Promise.all([
      text('/sys/lightcycle.inf'), text('/sys/game.inf'), text('/sys/states.inf'), text('/sys/buildings.inf'),
    ]);
    const sysFiles = await o.listFiles('sys');
    const combiTexts = await Promise.all(sysFiles.filter(f => /^combinations.*\.inf$/i.test(f)).map(async f => [f, await text(`/sys/${f}`)] as const));
    const combinations = combiTexts.flatMap(([f, t]) => parseCombinations(t, f));
    assignGroups(combinations);
    const files = new Map<string, string>();
    const scriptFiles = (await o.listFiles('sys/scripts')).filter(f => f.toLowerCase().endsWith('.s2s')).map(f => `sys/scripts/${f}`);
    const mapDir = o.mapPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    const mapScripts = (await o.listFiles(mapDir)).filter(f => f.toLowerCase().endsWith('.s2s')).map(f => `${mapDir}/${f}`);
    for (const f of [...scriptFiles, mapScripts.length ? mapScripts : [o.mapPath.replace(/\.s2$/i, '.s2s')]].flat()) {
      try {
        files.set(f.toLowerCase(), await o.res.text('/' + f));
      } catch {
        /* 地图不一定有同名脚本文件 */
      }
    }
    return new GameSession(o, parseLightcycle(cycleText), gameInf, statesInf, files, combinations, parseBuildings(buildingsInf));
  }

  constructor(private readonly o: SessionOptions, cycle: RGB[], gameInf: string, statesInf: string, files: Map<string, string>, combinations: Combination[], buildings: Building[]) {
    this.combinations = combinations;
    this.buildings = buildings;
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
    });
    this.projectiles = new Projectiles({
      registry, world: o.world, engine: this.engine, weapons: this.weapons, playerId: PLAYER_ID,
      terrainY, now: () => this.gameMs, model: typ => o.world.spawnModel(CLS.item, typ),
    });
    this.weapons.launcher = this.projectiles;
    this.ai = new AiSystem({
      registry, engine: this.engine, world: o.world, playerId: PLAYER_ID,
      player: () => ({ x: this.playerRec.x, y: this.playerRec.y, z: this.playerRec.z, alive: !this.stats.dead, underwater: this.player.eye().y < SEA_LEVEL }),
      terrainY,
      blocked: (rec, dx, dz) => this.unitBlocked(rec, dx, dz),
      damagePlayer: (amount, by) => this.playerHurt(amount, by),
      damageEntity: (cls, id, amount) => { this.weapons.damage(cls, id, amount, 'other'); },
      random: (a, b) => this.host.random(a, b),
      controlled: rec => this.unitPaths.controlled(rec.id),
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
      const target = p.targetCls === CLS.unit && p.targetId === PLAYER_ID ? this.playerRec : registry.get(p.targetCls, p.targetId);
      if (!target) return false;
      const ty = target.y - (p.targetCls === CLS.unit ? (target.def?.colyr ?? 0) / 2 : 0);
      const dx = target.x - p.x;
      const dy = ty - p.y;
      const dz = target.z - p.z;
      this.projectiles.fire({
        typ: p.typ, weaponTyp: p.weaponTyp || p.typ, ammoTyp: p.typ, spawner: 0, x: p.x, y: p.y, z: p.z,
        yaw: Math.atan2(-dx, dz) / DEG, pitch: -Math.atan2(dy, Math.hypot(dx, dz)) / DEG, speed: p.speed, drag: p.drag, damage: p.damage,
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
      runScript: (text, origin) => { this.engine.runText(text, { cls: 0, id: 0, event: 'dialogue', info: origin }, origin); this.engine.update(0); },
      globalEvent: name => { this.engine.globalEvent(name); this.engine.update(0); },
      log: msg => o.log.warn(msg),
    });
    this.pauseMenu = new PauseMenu(o.root, {
      resume: () => { this.pauseMenu.close(); this.syncLock(); },
      save: name => { this.save(name); },
      saves: () => listSaves(),
      quickSaveName: QUICKSAVE,
    });
    this.host.msgbox = (title, text) => { this.panels.msgbox(title, text); this.syncLock(); };
    this.host.dialogue = (page, source, section) => {
      const text = this.host.textSource(source, section);
      if (text === undefined) return false;
      const ok = this.panels.dialogue(parseDialogue(text), page);
      if (ok) this.syncLock();
      return ok;
    };
    this.host.uiText = (id, text, font, x, y, align) => this.panels.uiText(id, text, font, x, y, align);
    this.host.uiImage = (id, path, x, y) => this.panels.uiImage(id, path, x, y);
    this.host.menuId = () => (this.sequence.active ? 100 : this.panels.menuId());
    this.host.closeMenu = () => { this.panels.close(); this.syncLock(); };
    this.host.loadMap = (path, flags) => {
      stashTakeover(collectTakeover({ registry, playerId: PLAYER_ID, weaponTyp: this.weapons.weaponTyp, engine: this.engine, diary: this.host.diary, locks: this.host.locks, skills: this.host.skills }, flags));
      location.assign(playUrl(path.replace(/\\/g, '/')));
    };
    this.host.loadMapTakeover = () => this.tookOver;
    this.host.quit = () => location.assign(MENU_URL);
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
    this.build = new Build({ registry, engine: this.engine, world: o.world, locks: this.host.locks, playerId: PLAYER_ID, buildings, terrainY, message, sound });
    this.host.builtAt = id => this.build.builtAt(id);
    this.host.lastBuildingSite = () => this.build.lastSite;
    const settings = readGameSettings(gameInf);
    this.tools = new Tools({
      registry, engine: this.engine, playerId: PLAYER_ID, infoRadius: id => this.host.infoRadius(id),
      random: (a, b) => this.host.random(a, b), message, sound, digTimeMs: settings.digTime, fishTimeMs: settings.fishTime,
    });

    this.invUi = new InventoryUi(o.root, {
      items: () => registry.storedIn(CLS.unit, PLAYER_ID),
      usedWeight: () => registry.usedWeight(CLS.unit, PLAYER_ID),
      maxWeight: () => playerDef?.maxweight ?? 25000,
      hasEvent: (rec, event) => this.engine.scriptsFor(CLS.item, rec.id, event).length > 0,
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
    o.canvas.addEventListener('click', () => { if (!this.overlayOpen() && !this.stats.dead) this.input.requestLock(); });
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
      restore({
        registry, engine: this.engine, world: o.world, playerId: PLAYER_ID, now: this.gameMs, clock: this.clock, stats: this.stats,
        setPlayer: p => { this.player.position.set(p.x, p.y, -p.z); this.player.yaw = p.yaw * DEG; this.player.pitch = -p.pitch * DEG; },
        takeInHand: typ => { this.weapons.takeInHand(typ); this.refreshWeaponHud(); },
        diary: this.host.diary, locks: this.host.locks, setBuffer: text => this.host.buffer.set(text),
        setSkills: entries => this.host.skills.load(entries),
        setTriggers: states => this.triggers.restore(states),
        setPaths: paths => { for (const p of paths) this.unitPaths.set(p.unitId, p.nodes); },
      }, o.restore);
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
      if (input.hit('KeyT') && !inSeq && !this.overlayOpen()) { this.panels.openDiary(this.host.diary, this.host.skills.entries()); this.syncLock(); }
      if (input.hit('Tab') && !inSeq) {
        if (this.buildUi.open) this.buildUi.close();
        this.invUi.toggle();
        this.syncLock();
      }
      if (input.hit('KeyB') && !inSeq) this.toggleBuildMenu();
      if (input.hit('Escape')) {
        if (this.placing) this.stopPlacing();
        else if (!inSeq && !this.overlayOpen()) { this.pauseMenu.show(); this.syncLock(); }
      }
      if (input.hit('F5') && !inSeq) this.save(QUICKSAVE);
      if (input.hit('F9') && !inSeq && loadGame(QUICKSAVE)) location.assign(loadSaveUrl(QUICKSAVE));
      const canAct = !this.overlayOpen() && input.locked && !frozen && !inSeq;
      if (canAct) {
        const look = input.consumeLook();
        this.player.update(dtMs, now, {
          forward: input.pressed('KeyW') || input.pressed('ArrowUp'),
          backward: input.pressed('KeyS') || input.pressed('ArrowDown'),
          left: input.pressed('KeyA') || input.pressed('ArrowLeft'),
          right: input.pressed('KeyD') || input.pressed('ArrowRight'),
          jump: input.pressed('Space'),
          lookDx: look.dx,
          lookDy: look.dy,
        }, this.ground, this.collider);
        if (this.player.jumpedThisFrame) this.stats.jump(now);
        if (this.placing) {
          this.updatePlacing();
          if (input.hit('Mouse0')) this.confirmPlacing();
        } else {
          if (input.hit('Mouse0')) this.attack1();
          if (input.hit('Mouse2')) this.attack2();
          if (input.hit('KeyE')) this.use();
        }
      } else {
        input.consumeLook();
        this.player.update(dtMs, now, { forward: false, backward: false, left: false, right: false, jump: false, lookDx: 0, lookDy: 0 }, this.ground, this.collider);
      }
      const damage = this.stats.update(dtMs, this.player.movedThisFrame, this.player.swimming);
      if (damage > 0) this.hud.message(`Starving and thirsty, you lose ${damage} health`, 2);
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
      if (this.clock.day !== dayBefore) this.engine.globalEvent('changeday');
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
    this.hud.showHint(!input.locked && !this.overlayOpen() && !this.stats.dead && !this.sequence.active);
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
    this.hud.setMode(`Placing ${b.name}: B or left click to confirm, Esc to cancel`);
    this.updatePlacing();
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
      preview.y = worldHeight(this.o.map, t.x, t.z);
      preview.yaw = this.player.yaw / DEG;
      this.o.world.sync(preview);
    }
    const fail = this.build.checkSpace(b, t.x, t.z);
    this.hud.setMode(fail ? `Placing ${b.name}: ${fail}` : `Placing ${b.name}: B or left click to confirm, Esc to cancel`);
  }

  private confirmPlacing(): void {
    if (!this.placing) return;
    const { building, preview } = this.placing;
    const t = this.placeTarget();
    if (preview) this.o.world.remove(preview);
    this.placing = null;
    this.hud.setMode(null);
    const site = this.build.place(building, t.x, t.z, this.player.yaw / DEG);
    if (site) this.hud.message(`Building site for ${building.name} placed. Hold a hammer and right click it to add materials.`, 1);
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
        if (r === 'none') this.hud.message('No building site nearby', 2);
        break;
      }
      case 'spade': this.startTool('dig'); break;
      case 'fishingrod': this.startTool('fish'); break;
      default: break;
    }
    this.engine.update(0);
  }

  private startTool(kind: ToolKind): void {
    const { title, ms } = this.tools.start(kind);
    this.startProcess(title, ms, '', () => {
      this.tools.finish(kind, this.playerRec.x, this.playerRec.z);
      this.engine.update(0);
    });
  }

  private refreshWeaponHud(): void {
    const typ = this.weapons.weaponTyp;
    const def = typ ? this.o.defs.items.get(typ) : undefined;
    this.hud.setWeapon(def ? { name: def.name, icon: def.icon ? encodeURI(assetUrl(def.icon)) : undefined } : null);
  }

  private use(): void {
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
      this.hud.message('No space left', 2);
      this.sounds.play('fail.wav');
      return;
    }
    const still = registry.get(CLS.item, rec.id);
    if (still) this.o.world.sync(still);
    else this.o.world.remove(rec);
    this.hud.message(`Picked up ${name} x ${stored}`, 1);
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
    this.engine.runNow(CLS.item, rec.id, event);
    this.engine.update(0);
    if (!this.weapons.weaponItem()) {
      this.weapons.unequip();
      this.refreshWeaponHud();
    }
  }

  /** 单位沿 (dx, dz)（Blitz 坐标）移动时被物体挡住超过一半距离。 */
  private unitBlocked(rec: EntityRecord, dx: number, dz: number): boolean {
    const def = rec.def;
    const delta = new THREE.Vector3(dx, 0, -dz);
    const resolved = this.collider.resolveMove(new THREE.Vector3(rec.x, rec.y, -rec.z), delta, def?.colxr ?? 10, def?.colyr ?? 10);
    return resolved.length() < delta.length() * 0.5;
  }

  /** 单位攻击玩家：扣生命、提示与音效；生命归零时进入死亡画面。 */
  private playerHurt(amount: number, by: EntityRecord): void {
    if (this.stats.dead) return;
    this.stats.health = Math.max(0, this.stats.health - amount);
    this.hud.message(`${by.def?.name ?? 'Something'} hits you for ${amount} health`, 2);
    this.sounds.play(`human_hit${this.host.random(1, 5)}.wav`);
    if (this.stats.dead) {
      this.hud.showDead();
      this.input.release();
    }
  }

  private unitDied(rec: EntityRecord): void {
    rec.playAnim?.('die', false);
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
      move: (item, toContainer) => {
        const [fromCls, fromId, toCls, toId] = toContainer ? [CLS.unit, PLAYER_ID, cls, id] : [cls, id, CLS.unit, PLAYER_ID];
        const loose = registry.unstore(item.id, 1, p.x, p.y, -p.z);
        if (!loose) return false;
        if (registry.store(loose.id, toCls, toId) > 0) return true;
        registry.store(loose.id, fromCls, fromId);
        this.hud.message('No space left', 2);
        return false;
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
    });
  }

  save(name: string): void {
    const ok = saveGame(name, this.snapshot());
    this.hud.message(ok ? `Saved to ${name}` : 'Saving failed', ok ? 1 : 2);
  }

  /** 调试：把时钟拨到指定时间并立即应用光照。 */
  setTime(hour: number, minute: number): void {
    this.clock.set(hour, minute);
    this.env.apply(hour, minute);
  }

  dispose(): void {
    this.input.release();
    this.seqUi.dispose();
    this.panels.dispose();
    this.exchangeUi.dispose();
    this.hud.dispose();
  }
}
