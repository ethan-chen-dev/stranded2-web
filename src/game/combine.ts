/** 背包合成：候选筛选与执行，规则来自原版 combine_item。 */
import type { Combination } from '../formats/combinations';
import type { EntityRegistry, EntityRecord } from './entities';
import { CLS, STORED_INSIDE } from './entities';
import type { ScriptEngine } from '../script/engine';
import type { World } from '../render/world';

export interface CombineDeps {
  registry: EntityRegistry;
  engine: ScriptEngine;
  world: World;
  locks: Set<string>;
  playerId: number;
  combinations: Combination[];
  message(text: string, font?: number): void;
  sound(file: string): void;
}

export interface Candidate {
  combi: Combination;
  feasible: boolean;
  locked: boolean;
}

export class Combine {
  constructor(private readonly d: CombineDeps) {}

  isLocked(c: Combination): boolean {
    return this.d.locks.has(`combi:${c.key}`);
  }

  /** 需求条数等于选中数且类型互相覆盖的合成；feasible 表示数量足够且未锁。 */
  candidates(selected: EntityRecord[]): Candidate[] {
    const out: Candidate[] = [];
    for (const c of this.d.combinations) {
      if (c.reqs.length !== selected.length) continue;
      const typesMatch = c.reqs.every(r => selected.some(s => s.typ === r.typ)) && selected.every(s => c.reqs.some(r => r.typ === s.typ));
      if (!typesMatch) continue;
      const enough = c.reqs.every(r => (selected.find(s => s.typ === r.typ)?.count ?? 0) >= r.count);
      const locked = this.isLocked(c);
      out.push({ combi: c, feasible: enough && !locked, locked });
    }
    return out;
  }

  /** 执行合成；返回是否执行（脚本取消也算执行）。 */
  execute(c: Combination, selected: EntityRecord[]): boolean {
    const cand = this.candidates(selected).find(x => x.combi === c);
    if (!cand || !cand.feasible) {
      this.d.sound('fail.wav');
      return false;
    }
    if (c.script) {
      const r = this.d.engine.runText(c.script, { cls: CLS.global, id: 0, event: 'combine', info: '(combinations.inf-script)' }, `combination ${c.key}`);
      this.d.engine.update(0);
      if (r === 'skipevent') return true;
    }
    for (const req of c.reqs) {
      if (req.stay) continue;
      const item = selected.find(s => s.typ === req.typ);
      if (!item) continue;
      const removed = this.d.registry.consume(item.id, req.count);
      if (removed) this.d.world.remove(item);
    }
    for (const gen of c.gens) {
      const item = this.d.registry.make(CLS.item, gen.typ, 0, 0, 0, gen.count);
      const stored = this.d.registry.store(item.id, CLS.unit, this.d.playerId);
      const name = this.d.registry.defFor(CLS.item, gen.typ)?.name ?? `#${gen.typ}`;
      if (stored > 0) {
        this.d.message(`${name} × ${stored}`, 1);
      } else {
        this.d.registry.remove(CLS.item, item.id);
        this.d.message('没有空间了', 2);
        this.d.sound('fail.wav');
      }
      const left = this.d.registry.get(CLS.item, item.id);
      if (left && left.parentMode !== STORED_INSIDE) this.d.registry.remove(CLS.item, item.id);
    }
    return true;
  }
}
