/** 挖掘与钓鱼：进度结束后从区域信息点的物品池里随机取一件。 */
import type { EntityRegistry, EntityRecord } from './entities';
import { CLS } from './entities';
import type { ScriptEngine } from '../script/engine';

export type ToolKind = 'dig' | 'fish';

export interface ToolDeps {
  registry: EntityRegistry;
  engine: ScriptEngine;
  playerId: number;
  infoRadius(id: number): number;
  random(min: number, max: number): number;
  message(text: string, font?: number): void;
  sound(file: string): void;
  digTimeMs: number;
  fishTimeMs: number;
}

const AREA_TYP: Record<ToolKind, number> = { dig: 42, fish: 43 };
const RANGE: Record<ToolKind, number> = { dig: 100, fish: 150 };
const TITLE: Record<ToolKind, string> = { dig: 'digging', fish: 'fishing' };

export class Tools {
  constructor(private readonly d: ToolDeps) {}

  start(kind: ToolKind): { title: string; ms: number } {
    return { title: TITLE[kind], ms: kind === 'dig' ? this.d.digTimeMs : this.d.fishTimeMs };
  }

  /** px/pz 为玩家 Blitz 坐标。返回是否取到物品。 */
  finish(kind: ToolKind, px: number, pz: number): boolean {
    const range = RANGE[kind];
    for (const info of this.d.registry.all(CLS.info)) {
      if (Math.hypot(info.x - px, info.z - pz) < range) this.d.engine.entityEvent(CLS.info, info.id, kind);
    }
    for (const info of this.d.registry.all(CLS.info, AREA_TYP[kind])) {
      if (Math.hypot(info.x - px, info.z - pz) - this.d.infoRadius(info.id) >= range) continue;
      const pool = this.d.registry.storedIn(CLS.info, info.id);
      if (pool.length === 0) continue;
      const pick: EntityRecord = pool[this.d.random(0, pool.length - 1)];
      const item = this.d.registry.make(CLS.item, pick.typ, px, 0, pz, 1);
      this.d.registry.consume(pick.id, 1);
      const stored = this.d.registry.store(item.id, CLS.unit, this.d.playerId);
      const name = this.d.registry.defFor(CLS.item, pick.typ)?.name ?? `#${pick.typ}`;
      if (stored > 0) {
        this.d.message(`Collected ${name} (1)`, 1);
        this.d.sound('collect.wav');
        return true;
      }
      this.d.registry.remove(CLS.item, item.id);
      this.d.message('No space left', 2);
      this.d.sound('fail.wav');
      return false;
    }
    this.d.message(kind === 'dig' ? 'Nothing to dig up here' : 'No fish to catch here', 2);
    this.d.sound('fail.wav');
    return false;
  }
}
