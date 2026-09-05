/**
 * 实体注册表：物体、单位、物品、信息点统一按类与 id 登记。
 * 坐标为 Blitz 世界坐标（z 未镜像），供脚本直接读写；场景对象由 World 同步。
 * 物品的 parentMode 为 1 表示存放在容器或背包里。
 */
import type * as THREE from 'three';
import type { EntityDef } from '../formats/inf';
import type { Defs } from '../render/world';

export const CLS = { global: 0, object: 1, unit: 2, item: 3, info: 4, state: 5 } as const;
export const STORED_INSIDE = 1;

export interface EntityRecord {
  cls: number;
  id: number;
  typ: number;
  def?: EntityDef;
  object?: THREE.Object3D;
  mixer?: THREE.AnimationMixer;
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
  /** 单位死亡后保留尸体，不再参与碰撞与拾取。 */
  dead?: boolean;
  /** 播放定义里 ani_<name> 的动画片段；由 World 在创建场景对象时提供。 */
  playAnim?: (name: string, loop: boolean) => boolean;
}

export class EntityRegistry {
  private readonly tables = new Map<number, Map<number, EntityRecord>>();

  constructor(readonly defs: Defs) {}

  private table(cls: number): Map<number, EntityRecord> {
    let t = this.tables.get(cls);
    if (!t) {
      t = new Map();
      this.tables.set(cls, t);
    }
    return t;
  }

  defFor(cls: number, typ: number): EntityDef | undefined {
    switch (cls) {
      case CLS.object: return this.defs.objects.get(typ);
      case CLS.unit: return this.defs.units.get(typ);
      case CLS.item: return this.defs.items.get(typ);
      case CLS.info: return this.defs.infos?.get(typ);
      default: return undefined;
    }
  }

  all(cls: number, typ?: number): EntityRecord[] {
    const out: EntityRecord[] = [];
    for (const r of this.table(cls).values()) if (typ === undefined || r.typ === typ) out.push(r);
    return out;
  }

  get(cls: number, id: number): EntityRecord | undefined {
    return this.table(cls).get(id);
  }

  nextId(cls: number): number {
    let max = 0;
    for (const id of this.table(cls).keys()) if (id > max) max = id;
    return max + 1;
  }

  add(rec: EntityRecord): EntityRecord {
    this.table(rec.cls).set(rec.id, rec);
    return rec;
  }

  make(cls: number, typ: number, x: number, y: number, z: number, count = 1, id?: number): EntityRecord {
    const def = this.defFor(cls, typ);
    const health = def?.health ?? 100;
    return this.add({
      cls, id: id ?? this.nextId(cls), typ, def, x, y, z, yaw: 0, pitch: 0, roll: 0,
      health, healthMax: health, count, parentClass: 0, parentId: 0, parentMode: 0,
    });
  }

  remove(cls: number, id: number): EntityRecord | undefined {
    const t = this.table(cls);
    const r = t.get(id);
    t.delete(id);
    return r;
  }

  storedIn(cls: number, id: number, typ?: number): EntityRecord[] {
    return this.all(CLS.item).filter(r => r.parentMode === STORED_INSIDE && r.parentClass === cls && r.parentId === id && (typ === undefined || r.typ === typ));
  }

  countStored(cls: number, id: number, typ?: number): number {
    return this.storedIn(cls, id, typ).reduce((s, r) => s + r.count, 0);
  }

  usedWeight(cls: number, id: number): number {
    return this.storedIn(cls, id).reduce((s, r) => s + (r.def?.weight ?? 0) * r.count, 0);
  }

  /** 容器剩余承重；容器没有定义时为 -1（不限）。 */
  capacity(cls: number, id: number): number {
    const holder = this.get(cls, id);
    const total = holder?.def?.maxweight ?? -1;
    if (total < 0) return -1;
    return total - this.usedWeight(cls, id);
  }

  /**
   * 原版 store_item：承重够则全部存入，否则能存几件存几件；同类合并。
   * 返回实际存入数量；全部存入且合并时原记录被删除。
   */
  store(itemId: number, cls: number, id: number): number {
    const item = this.get(CLS.item, itemId);
    if (!item) return 0;
    const free = this.capacity(cls, id);
    const weight = item.def?.weight ?? 0;
    let storeCount = item.count;
    if (free >= 0 && weight > 0) {
      const needed = weight * item.count;
      if (needed > free) {
        if (weight > free) return 0;
        storeCount = Math.floor(free / weight);
      }
    }
    const existing = this.storedIn(cls, id, item.typ).find(r => r.id !== itemId);
    if (storeCount >= item.count) {
      if (existing) {
        existing.count += item.count;
        this.remove(CLS.item, itemId);
      } else {
        item.parentClass = cls;
        item.parentId = id;
        item.parentMode = STORED_INSIDE;
      }
      return item.count;
    }
    item.count -= storeCount;
    if (existing) {
      existing.count += storeCount;
    } else {
      const rec = this.make(CLS.item, item.typ, item.x, item.y, item.z, storeCount);
      rec.parentClass = cls;
      rec.parentId = id;
      rec.parentMode = STORED_INSIDE;
    }
    return storeCount;
  }

  /** 取出：数量不足整份时拆出一份新物品；返回进入世界的记录。 */
  unstore(itemId: number, count: number, x: number, y: number, z: number): EntityRecord | undefined {
    const item = this.get(CLS.item, itemId);
    if (!item) return undefined;
    if (count < item.count) {
      item.count -= count;
      return this.make(CLS.item, item.typ, x, y, z, count);
    }
    item.parentClass = 0;
    item.parentId = 0;
    item.parentMode = 0;
    item.x = x;
    item.y = y;
    item.z = z;
    return item;
  }

  /** 减少物品数量，减到 0 或 count 为负时删除整条记录。 */
  consume(itemId: number, count = -1): boolean {
    const item = this.get(CLS.item, itemId);
    if (!item) return false;
    if (count >= 0 && item.count > count) {
      item.count -= count;
      return false;
    }
    this.remove(CLS.item, itemId);
    return true;
  }
}
