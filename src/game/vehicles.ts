/**
 * 骑乘与驾驶，依据 game_input_vehicles.bb 与 game_functions.bb：ride 命令选定单位（g_drive），按单位的 speed、turnspeed
 * 与 acceleration/friction/steering/maxdepth/flyspeed 操控。方向盘位置 steerpos 在 ±100 间随左右键变化，
 * 动物、陆地载具、船、飞机的回正速度不同；steering 1 时转向随速度变化，2 时至少一半转向。
 * 船碰到陆地（地形高于 -1）停下并每 100 毫秒留下涟漪；飞机速度过半时上升、不足时下降，最高 900。
 * 低于 maxdepth 的载具被毁（飞机除外）。原版加速度与摩擦按帧计，这里按 f 折算。
 */
import { CLS, type EntityRecord, type EntityRegistry } from './entities';

export type VehicleKind = 'animal' | 'vehicle' | 'watercraft' | 'aircraft';

export interface VehicleInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
}

export interface VehicleDeps {
  registry: EntityRegistry;
  terrainY(x: number, z: number): number;
  /** 单位行为编码（500 车、501 船、502 飞机，其余按动物）。 */
  code(rec: EntityRecord): number;
  sync(rec: EntityRecord): void;
  /** 水面涟漪（船行驶）。 */
  wave(x: number, z: number): void;
  /** 移动声：volume 为 0..100，null 时停止。 */
  moveSound(rec: EntityRecord, volume: number | null): void;
  kill(rec: EntityRecord): void;
}

/** 方向盘每 f 的变化与回正速度。 */
const STEER: Record<VehicleKind, { turn: number; back: number }> = {
  animal: { turn: 7, back: 7 },
  vehicle: { turn: 6, back: 5.5 },
  watercraft: { turn: 2.1, back: 2 },
  aircraft: { turn: 6, back: 5.5 },
};
const MAX_HEIGHT = 900;

export class Vehicles {
  /** 正在骑乘的单位 id，0 为没有。 */
  driving = 0;
  speed = 0;
  private steer = 0;
  private waveAcc = 0;
  private animating = false;

  constructor(private readonly d: VehicleDeps) {}

  kind(rec: EntityRecord): VehicleKind {
    const c = this.d.code(rec);
    return c === 500 ? 'vehicle' : c === 501 ? 'watercraft' : c === 502 ? 'aircraft' : 'animal';
  }

  /** ride：开始骑乘，速度与方向盘清零（game_input_vehicledata）。 */
  ride(id: number): boolean {
    const rec = this.d.registry.get(CLS.unit, id);
    if (!rec || rec.dead) return false;
    this.driving = id;
    this.speed = 0;
    this.steer = 0;
    this.animating = false;
    return true;
  }

  current(): EntityRecord | undefined {
    if (!this.driving) return undefined;
    const rec = this.d.registry.get(CLS.unit, this.driving);
    if (!rec || rec.dead || rec.healthMax <= 0) {
      this.stop();
      return undefined;
    }
    return rec;
  }

  stop(): void {
    const rec = this.driving ? this.d.registry.get(CLS.unit, this.driving) : undefined;
    if (rec) this.d.moveSound(rec, null);
    this.driving = 0;
    this.speed = 0;
    this.steer = 0;
  }

  update(dtMs: number, input: VehicleInput, controlled: boolean): void {
    const rec = this.current();
    if (!rec || controlled) return;
    const def = rec.def;
    if (!def) return;
    const f = dtMs / 20;
    const kind = this.kind(rec);
    const v = def.vehicle;
    const top = def.speed;
    const steerRate = STEER[kind];

    let tspeed = def.turnspeed;
    if (v.steering === 1) tspeed *= top ? Math.abs(this.speed) / top : 0;
    else if (v.steering === 2) tspeed = Math.min(def.turnspeed, tspeed * (top ? Math.abs(this.speed) / top : 0) + def.turnspeed / 2);
    if (input.left) this.steer = Math.min(100, this.steer + steerRate.turn * f);
    else if (input.right) this.steer = Math.max(-100, this.steer - steerRate.turn * f);
    else if (this.steer > 0) this.steer = Math.max(0, this.steer - steerRate.back * f);
    else if (this.steer < 0) this.steer = Math.min(0, this.steer + steerRate.back * f);
    if (this.steer !== 0) rec.yaw += tspeed * f * (this.steer / 100);

    if (input.forward) this.speed = Math.min(top, this.speed + v.acceleration * f);
    else if (input.backward) this.speed = Math.max(-top, this.speed - v.acceleration * f);
    else if (this.speed > 0) this.speed = Math.max(0, this.speed - v.friction * f);
    else if (this.speed < 0) this.speed = Math.min(0, this.speed + v.friction * f);

    if (this.speed !== 0) {
      const a = rec.yaw * Math.PI / 180;
      const dx = -Math.sin(a) * this.speed * f;
      const dz = Math.cos(a) * this.speed * f;
      rec.x += dx;
      rec.z += dz;
      if (kind === 'watercraft') {
        if (this.d.terrainY(rec.x, rec.z) > -1) {
          rec.x -= dx;
          rec.z -= dz;
          this.speed = 0;
        } else {
          this.waveAcc += dtMs;
          if (this.waveAcc >= 100) { this.waveAcc %= 100; this.d.wave(rec.x, rec.z); }
        }
      }
      this.d.moveSound(rec, top ? (Math.abs(this.speed) / top) * 100 : 100);
    } else {
      this.d.moveSound(rec, null);
    }
    const animating = this.speed !== 0;
    if (animating !== this.animating) {
      this.animating = animating;
      // 原版停下时 Animate mh,0 停住当前姿势；这里换成待机动画
      rec.playAnim?.(animating ? 'move' : 'idle', animating ? (def.loopmoveani ? true : 'pingpong') : false);
    }

    if (kind === 'aircraft') {
      const perc = top ? this.speed / top : 0;
      if (perc > 0.5) rec.y += 3 * f * perc;
      else {
        rec.y -= 10 * f * (1 - perc);
        rec.y = Math.max(rec.y, this.d.terrainY(rec.x, rec.z) + def.colyr);
      }
      rec.y = Math.min(rec.y, MAX_HEIGHT);
    } else if (rec.y - def.colyr < -v.maxdepth) {
      this.d.kill(rec);
      this.stop();
      return;
    }
    this.d.sync(rec);
  }
}
