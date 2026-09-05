/** 游戏模式会话：组装玩家、时钟、光照、数值、拾取、背包、界面与脚本引擎。 */
import * as THREE from 'three';
import type { MapData } from '../formats/s2map';
import { parseInf } from '../formats/inf';
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
import { Sounds } from './sounds';
import { CLS, STORED_INSIDE, type EntityRecord } from './entities';
import { ScriptEngine } from '../script/engine';
import { createRegistry } from '../script/commands';
import { GameScriptHost } from './script-host';

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
}

const DEG = Math.PI / 180;
const FOCUS_INTERVAL_MS = 300;
const PLAYER_ID = 1;
const PLAYER_TYP = 1;
const SPAWN_INFO_TYP = 1;
const TEXT_CONTAINER_INFO_TYP = 37;

interface ProcessState {
  title: string;
  start: number;
  ms: number;
  event: string;
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
  readonly sounds = new Sounds();
  readonly engine: ScriptEngine;
  readonly playerRec: EntityRecord;
  private focusAcc = 0;
  private focused: EntityRecord | null = null;
  private readonly ground: { heightAt(x: number, z: number): number };
  private gameMs = 0;
  private process: ProcessState | null = null;
  private useTargetPos = { x: 0, y: 0, z: 0 };

  static async create(o: SessionOptions): Promise<GameSession> {
    const [cycleText, gameInf, statesInf] = await Promise.all([
      o.res.text('/sys/lightcycle.inf').catch(() => ''),
      o.res.text('/sys/game.inf').catch(() => ''),
      o.res.text('/sys/states.inf').catch(() => ''),
    ]);
    const files = new Map<string, string>();
    const scriptFiles = (await o.listFiles('sys/scripts')).filter(f => f.toLowerCase().endsWith('.s2s')).map(f => `sys/scripts/${f}`);
    const mapScript = o.mapPath.replace(/\.s2$/i, '.s2s');
    for (const f of [...scriptFiles, mapScript]) {
      try {
        files.set(f.toLowerCase(), await o.res.text('/' + f));
      } catch {
        /* 地图不一定有同名脚本文件 */
      }
    }
    return new GameSession(o, parseLightcycle(cycleText), gameInf, statesInf, files);
  }

  constructor(private readonly o: SessionOptions, cycle: RGB[], gameInf: string, statesInf: string, files: Map<string, string>) {
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
      o.log.warn('地图没有出生点信息点，放在地图中心');
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

    const host = new GameScriptHost({
      world: o.world, map: o.map, stats: this.stats, clock: this.clock, hud: this.hud, sounds: this.sounds, log: o.log,
      playerId: PLAYER_ID, files,
      gameTime: () => this.gameMs,
      useTarget: () => this.useTargetPos,
      startProcess: (title, ms, event) => { this.process = { title, start: this.gameMs, ms, event }; this.hud.setProcess(title, 0); },
      onTimeSet: () => this.env.apply(this.clock.hour, this.clock.minute),
      onEntityDied: rec => { this.engine.entityEvent(rec.cls, rec.id, 'kill'); o.world.remove(rec); },
    });
    this.engine = new ScriptEngine(host, createRegistry());
    this.mountScripts(gameInf, statesInf);

    this.invUi = new InventoryUi(o.root, {
      items: () => registry.storedIn(CLS.unit, PLAYER_ID),
      usedWeight: () => registry.usedWeight(CLS.unit, PLAYER_ID),
      maxWeight: () => playerDef?.maxweight ?? 25000,
      hasEvent: (rec, event) => this.engine.scriptsFor(CLS.item, rec.id, event).length > 0,
      use: rec => this.useItem(rec, 'use'),
      eat: rec => this.useItem(rec, 'eat'),
      drop: rec => this.drop(rec),
    });
    o.canvas.addEventListener('click', () => { if (!this.invUi.open && !this.stats.dead) this.input.requestLock(); });
    this.player.applyTo(o.camera);
    this.hud.setStats(this.stats);
    this.hud.setClock(this.clock.day, this.clock.hour, this.clock.minute);
    o.log.info(`游戏模式：出生点 ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${(-pos.z).toFixed(0)}，可碰撞物体 ${this.collider.items.length}，脚本 ${this.engine.syntaxErrors.length} 处语法错误`);

    this.engine.globalEvent('start');
    this.engine.globalEvent('load');
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
        case 4:
          this.engine.vars.setLocal(ext.parentClass, ext.parentId, ext.key, ext.value);
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
    if (this.engine.syntaxErrors.length) log.warn(`脚本语法错误 ${this.engine.syntaxErrors.length} 处，详见控制台`);
  }

  update(dtMs: number): void {
    this.gameMs += dtMs;
    const now = performance.now();
    const input = this.input;
    const frozen = this.process !== null;
    if (!this.stats.dead) {
      if (input.hit('Tab')) {
        this.invUi.toggle();
        if (this.invUi.open) input.release();
        else input.requestLock();
      }
      if (!this.invUi.open && input.locked && !frozen) {
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
        if (input.hit('Mouse0') || input.hit('KeyE')) this.use();
      } else {
        input.consumeLook();
        this.player.update(dtMs, now, { forward: false, backward: false, left: false, right: false, jump: false, lookDx: 0, lookDy: 0 }, this.ground, this.collider);
      }
      const damage = this.stats.update(dtMs, this.player.movedThisFrame, this.player.swimming);
      if (damage > 0) this.hud.message(`饥渴交加，失去 ${damage} 点生命`, 2);
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
        const ev = this.process.event;
        this.process = null;
        this.hud.setProcess(null);
        if (ev) this.engine.globalEvent(ev);
      } else {
        this.hud.setProcess(this.process.title, elapsed / this.process.ms);
      }
    }

    this.engine.update(dtMs);

    this.focusAcc += dtMs;
    if (this.focusAcc >= FOCUS_INTERVAL_MS) {
      this.focusAcc = 0;
      this.focused = this.pickup.focus();
      this.hud.setFocus(this.focused ? `${this.focused.def?.name ?? '物品'}${this.focused.count > 1 ? ` × ${this.focused.count}` : ''}` : null);
    }

    this.player.applyTo(this.o.camera);
    this.hud.setStats(this.stats);
    this.hud.setClock(this.clock.day, this.clock.hour, this.clock.minute);
    this.hud.showHint(!input.locked && !this.invUi.open && !this.stats.dead);
    input.endFrame();
  }

  private use(): void {
    const target = this.pickup.focus();
    if (target) {
      this.collect(target);
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
      this.hud.message('没有空间了', 2);
      this.sounds.play('fail.wav');
      return;
    }
    const still = registry.get(CLS.item, rec.id);
    if (still) this.o.world.sync(still);
    else this.o.world.remove(rec);
    this.hud.message(`拾取 ${name} × ${stored}`, 1);
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
    this.hud.message(`丢下 ${rec.def?.name ?? `#${rec.typ}`}`, 0);
  }

  private useItem(rec: EntityRecord, event: 'use' | 'eat'): void {
    this.engine.runNow(CLS.item, rec.id, event);
    this.engine.update(0);
  }

  /** 调试：把时钟拨到指定时间并立即应用光照。 */
  setTime(hour: number, minute: number): void {
    this.clock.set(hour, minute);
    this.env.apply(hour, minute);
  }

  dispose(): void {
    this.input.release();
    this.hud.dispose();
  }
}
