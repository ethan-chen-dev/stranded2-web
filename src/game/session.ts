/** 游戏模式会话：组装玩家、时钟、光照、数值、拾取、背包与界面。 */
import * as THREE from 'three';
import type { MapData } from '../formats/s2map';
import type { Defs, World } from '../render/world';
import { worldHeight } from '../render/terrain';
import type { Resources } from '../assets/resources';
import type { Log } from '../viewer/log';
import { GameClock } from './clock';
import { parseLightcycle, type RGB } from './lightcycle';
import { Environment } from './environment';
import { InputState } from './input';
import { ObjectCollider } from './collision';
import { Player, PLAYER } from './player';
import { SurvivalStats } from './stats';
import { Inventory } from './inventory';
import { Pickup } from './pickup';
import { Hud } from './hud';
import { InventoryUi } from './inventory-ui';

export interface SessionOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLElement;
  root: HTMLElement;
  map: MapData;
  defs: Defs;
  world: World;
  res: Resources;
  log: Log;
  sky: THREE.Object3D;
  ambient: THREE.AmbientLight;
  sun: THREE.DirectionalLight;
}

const DEG = Math.PI / 180;
const FOCUS_INTERVAL_MS = 300;
const PLAYER_TYP = 1;
const SPAWN_INFO_TYP = 1;

export class GameSession {
  readonly clock: GameClock;
  readonly env: Environment;
  readonly input: InputState;
  readonly player: Player;
  readonly stats: SurvivalStats;
  readonly inventory: Inventory;
  readonly collider: ObjectCollider;
  readonly pickup: Pickup;
  readonly hud: Hud;
  readonly invUi: InventoryUi;
  private focusAcc = 0;
  private focused: ReturnType<Pickup['focus']> = null;
  private readonly ground: { heightAt(x: number, z: number): number };

  static async create(o: SessionOptions): Promise<GameSession> {
    let cycle: RGB[];
    try {
      cycle = parseLightcycle(await o.res.text('/sys/lightcycle.inf'));
    } catch (e) {
      o.log.warn(`lightcycle.inf 读取失败，使用白天光照: ${(e as Error).message}`);
      cycle = parseLightcycle('');
    }
    return new GameSession(o, cycle);
  }

  constructor(private readonly o: SessionOptions, cycle: RGB[]) {
    const h = o.map.header;
    this.clock = new GameClock(h.day, h.hour, h.minute, h.freezeTime);
    this.env = new Environment(o.scene, o.sky, o.ambient, o.sun, h.fog, cycle);
    this.env.apply(this.clock.hour, this.clock.minute);
    this.ground = { heightAt: (x, z) => worldHeight(o.map, x, -z) };

    const spawn = o.map.infos.find(i => i.typ === SPAWN_INFO_TYP);
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
    this.stats = new SurvivalStats(playerDef?.store ?? 100, 100);
    this.inventory = new Inventory(playerDef?.maxweight || 25000, typ => o.defs.items.get(typ));
    this.collider = new ObjectCollider(
      o.world.entities.filter(e => e.kind === 'object').map(e => ({ object: e.object, col: e.def?.col ?? 1 })),
    );
    this.pickup = new Pickup(o.camera, o.world);
    this.input = new InputState(o.canvas);
    this.hud = new Hud(o.root);
    this.invUi = new InventoryUi(o.root, this.inventory, o.defs.items, typ => this.drop(typ));
    o.canvas.addEventListener('click', () => { if (!this.invUi.open && !this.stats.dead) this.input.requestLock(); });
    this.player.applyTo(o.camera);
    this.hud.setStats(this.stats);
    this.hud.setClock(this.clock.day, this.clock.hour, this.clock.minute);
    o.log.info(`游戏模式：出生点 ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${(-pos.z).toFixed(0)}，可碰撞物体 ${this.collider.items.length}`);
  }

  update(dtMs: number): void {
    const now = performance.now();
    const input = this.input;
    if (!this.stats.dead) {
      if (input.hit('Tab')) {
        this.invUi.toggle();
        if (this.invUi.open) input.release();
        else input.requestLock();
      }
      if (!this.invUi.open && input.locked) {
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
      if (damage > 0) this.hud.message(`饥渴交加，失去 ${damage} 点生命`, 'bad');
      if (this.stats.dead) {
        this.hud.showDead();
        input.release();
      }
    }

    if (this.clock.advance(dtMs) > 0) this.env.apply(this.clock.hour, this.clock.minute);

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
    if (!target) return;
    const name = target.def?.name ?? `#${target.typ}`;
    const stored = this.inventory.store(target.typ, target.count);
    if (stored <= 0) {
      this.hud.message('没有空间了', 'bad');
      return;
    }
    if (stored >= target.count) this.o.world.removeEntity(target);
    else target.count -= stored;
    this.hud.message(`拾取 ${name} × ${stored}`);
    this.focused = null;
    this.hud.setFocus(null);
  }

  private drop(typ: number): void {
    if (this.inventory.remove(typ, 1) <= 0) return;
    const p = this.player.position;
    void this.o.world.addItem(typ, p.x, -p.z, 1);
    const name = this.o.defs.items.get(typ)?.name ?? `#${typ}`;
    this.hud.message(`丢下 ${name}`);
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
