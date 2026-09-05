/**
 * 单位路径：脚本用 unitpath 让单位依次走向若干信息点。规则来自原版 unitpath.bb。
 * 坐标为 Blitz 坐标；速度为 speed·f，f = 毫秒/20。
 */
import { CLS, type EntityRegistry, type EntityRecord } from './entities';
import type { ScriptEngine } from '../script/engine';
import { behaviourCode } from './ai';

const DEG = Math.PI / 180;
const WATERCRAFT = 501;
/** 海面以上的地形高度阈值，水面载具不会驶上去。 */
const WATERCRAFT_MAX_GROUND = -1;

export interface UnitPathDeps {
  registry: EntityRegistry;
  engine: ScriptEngine;
  terrainY(x: number, z: number): number;
  sync(rec: EntityRecord): void;
}

interface Controller {
  unitId: number;
  nodes: number[];
  index: number;
}

function wrapDeg(d: number): number {
  return ((d + 180) % 360 + 360) % 360 - 180;
}

export class UnitPaths {
  private readonly ctrls = new Map<number, Controller>();

  constructor(private readonly d: UnitPathDeps) {}

  set(unitId: number, nodes: number[]): void {
    this.ctrls.set(unitId, { unitId, nodes: nodes.slice(0, 256), index: 0 });
    const rec = this.d.registry.get(CLS.unit, unitId);
    rec?.playAnim?.('move', rec.def?.loopmoveani ? true : 'pingpong');
  }

  free(unitId: number): void {
    this.ctrls.delete(unitId);
  }

  controlled(unitId: number): boolean {
    return this.ctrls.has(unitId);
  }

  /** 当前所有受控单位与其剩余节点，供存档使用。 */
  entries(): { unitId: number; nodes: number[] }[] {
    return [...this.ctrls.values()].map(c => ({ unitId: c.unitId, nodes: c.nodes.slice(c.index) }));
  }

  update(dtMs: number): void {
    const f = dtMs / 20;
    for (const c of [...this.ctrls.values()]) {
      const rec = this.d.registry.get(CLS.unit, c.unitId);
      if (!rec || rec.dead) { this.ctrls.delete(c.unitId); continue; }
      let info: EntityRecord | undefined;
      while (c.index < c.nodes.length && !(info = this.d.registry.get(CLS.info, c.nodes[c.index]))) c.index++;
      if (!info) { this.ctrls.delete(c.unitId); continue; }
      const def = rec.def;
      const speed = (def?.speed ?? 0) * f;
      const predist = Math.hypot(info.x - rec.x, info.y - rec.y, info.z - rec.z);
      const delta = wrapDeg(Math.atan2(-(info.x - rec.x), info.z - rec.z) / DEG - rec.yaw);
      const angle = predist > 100 ? delta / 5 : delta;
      rec.yaw = wrapDeg(rec.yaw + angle);
      const dx = -Math.sin(rec.yaw * DEG) * speed;
      const dz = Math.cos(rec.yaw * DEG) * speed;
      const nx = rec.x + dx;
      const nz = rec.z + dz;
      const moved = !(behaviourCode(def?.behaviour ?? '') === WATERCRAFT && this.d.terrainY(nx, nz) > WATERCRAFT_MAX_GROUND);
      if (moved) { rec.x = nx; rec.z = nz; }
      const postdist = Math.hypot(info.x - rec.x, info.y - rec.y, info.z - rec.z);
      if (predist < postdist && Math.hypot(info.x - rec.x, info.z - rec.z) < (def?.speed ?? 0) * 50) {
        this.d.engine.entityEvent(CLS.unit, rec.id, `node${String(info.id).padStart(4, '0')}`, `reached by unit ${rec.id}`);
        this.d.engine.entityEvent(CLS.info, info.id, 'reach');
        if (moved) { rec.x -= dx; rec.z -= dz; }
        rec.yaw = wrapDeg(rec.yaw - angle);
        if (rec.ai) { rec.ai.centerX = rec.x; rec.ai.centerZ = rec.z; }
        c.index++;
        if (c.index >= c.nodes.length) this.ctrls.delete(c.unitId);
      }
      this.d.sync(rec);
    }
  }
}
