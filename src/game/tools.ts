/**
 * 挖掘与钓鱼，依据 game_functions.bb 的 game_dig / game_fish：进度结束后按顺序找第一个响应者——
 * 范围内带 dig/fish 实例脚本的信息点，或区域信息点（物品池里随机取一件）；然后是范围内带该事件脚本的
 * 物体、单位、地上物品。都没有时挖掘触发全局 dig_failure，钓鱼按面前是否有水触发 fish_success 或
 * fish_failure，由铲子与鱼竿的脚本按技能给出收获。
 */
import type { EntityRegistry, EntityRecord } from './entities';
import { CLS, STORED_INSIDE } from './entities';
import type { ScriptEngine } from '../script/engine';

export type ToolKind = 'dig' | 'fish';

export interface ToolDeps {
  registry: EntityRegistry;
  engine: ScriptEngine;
  playerId: number;
  infoRadius(id: number): number;
  /** Blitz 坐标 (x, z) 处的地形高度，低于 0 为海水。 */
  terrainY(x: number, z: number): number;
  random(min: number, max: number): number;
  message(text: string, font?: number): void;
  sound(file: string): void;
  digTimeMs: number;
  fishTimeMs: number;
}

const AREA_TYP: Record<ToolKind, number> = { dig: 42, fish: 43 };
const RANGE: Record<ToolKind, number> = { dig: 100, fish: 150 };
/** 钓鱼时检查面前的水面：沿视线水平方向每 25 单位采样一次，共 4 次（game_fish 的 CameraPick）。 */
const WATER_STEP = 25;
const WATER_STEPS = 4;

/** Blitz 坐标的眼睛位置与水平朝向（单位向量）。 */
export interface ToolView {
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
}
const TITLE: Record<ToolKind, string> = { dig: 'digging', fish: 'fishing' };

export class Tools {
  constructor(private readonly d: ToolDeps) {}

  start(kind: ToolKind): { title: string; ms: number } {
    return { title: TITLE[kind], ms: kind === 'dig' ? this.d.digTimeMs : this.d.fishTimeMs };
  }

  /** 返回是否有响应者（区域、实例脚本或类型脚本）。 */
  finish(kind: ToolKind, v: ToolView): boolean {
    const range = RANGE[kind];
    const { registry, engine } = this.d;
    const near = (e: EntityRecord) => Math.hypot(e.x - v.x, e.y - v.y, e.z - v.z) < range;
    const respond = (e: EntityRecord): boolean => {
      if (engine.scriptsFor(e.cls, e.id, kind).length === 0) return false;
      engine.entityEvent(e.cls, e.id, kind);
      return true;
    };
    for (const info of registry.all(CLS.info)) {
      let skip = near(info) && respond(info);
      if (info.typ === AREA_TYP[kind] && Math.hypot(info.x - v.x, info.z - v.z) - this.d.infoRadius(info.id) < range) {
        if (!skip && kind === 'dig') respond(info);
        this.takeFromPool(info, v);
        skip = true;
      }
      if (skip) return true;
    }
    for (const cls of [CLS.object, CLS.unit, CLS.item]) {
      for (const e of registry.all(cls)) {
        if (cls === CLS.item && e.parentMode === STORED_INSIDE) continue;
        if (e.cls === CLS.unit && e.id === this.d.playerId) continue;
        if (near(e) && respond(e)) return true;
      }
    }
    if (kind === 'dig') engine.globalEvent('dig_failure');
    else engine.globalEvent(this.waterAhead(v) ? 'fish_success' : 'fish_failure');
    return false;
  }

  private waterAhead(v: ToolView): boolean {
    for (let i = 1; i <= WATER_STEPS; i++) {
      if (this.d.terrainY(v.x + v.dirX * WATER_STEP * i, v.z + v.dirZ * WATER_STEP * i) < 0) return true;
    }
    return false;
  }

  private takeFromPool(info: EntityRecord, v: ToolView): void {
    const pool = this.d.registry.storedIn(CLS.info, info.id);
    if (pool.length === 0) return;
    const pick: EntityRecord = pool[this.d.random(0, pool.length - 1)];
    const item = this.d.registry.make(CLS.item, pick.typ, v.x, 0, v.z, 1);
    this.d.registry.consume(pick.id, 1);
    const name = this.d.registry.defFor(CLS.item, pick.typ)?.name ?? `#${pick.typ}`;
    if (this.d.registry.store(item.id, CLS.unit, this.d.playerId) > 0) {
      this.d.message(`Collected ${name} (1)`, 1);
      this.d.sound('collect.wav');
      return;
    }
    this.d.registry.remove(CLS.item, item.id);
    this.d.message('No space left', 2);
    this.d.sound('fail.wav');
  }
}
