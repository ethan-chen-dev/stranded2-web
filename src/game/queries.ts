/** 脚本查询类的纯函数：容器承重（storage）与空地判断（freespace）。 */
import { CLS, STORED_INSIDE, type EntityRegistry } from './entities';

/** storage 指令：mode 0 已用重量，1 已用减上限，2 上限；物品类返回单件重量。 */
export function storageValue(registry: EntityRegistry, cls: number, id: number, mode: number): number {
  if (cls === CLS.item) return registry.get(CLS.item, id)?.def?.weight ?? 0;
  if (cls !== CLS.object && cls !== CLS.unit) return 0;
  const holder = registry.get(cls, id);
  if (!holder) return 0;
  const max = holder.def?.maxweight ?? 0;
  const used = registry.usedWeight(cls, id);
  switch (Math.trunc(mode)) {
    case 1: return used - max;
    case 2: return max;
    default: return used;
  }
}

export interface FreeSpaceFlags {
  objects: boolean;
  units: boolean;
  items: boolean;
  infos: boolean;
}

/** 范围内没有勾选类别的实体时为真；物品只算散落在地上的。 */
export function freeSpace(registry: EntityRegistry, x: number, y: number, z: number, range: number, flags: FreeSpaceFlags): boolean {
  const near = (ex: number, ey: number, ez: number) => Math.hypot(ex - x, ey - y, ez - z) < range;
  if (flags.objects && registry.all(CLS.object).some(o => near(o.x, o.y, o.z))) return false;
  if (flags.units && registry.all(CLS.unit).some(u => near(u.x, u.y, u.z))) return false;
  if (flags.items && registry.all(CLS.item).some(i => i.parentMode !== STORED_INSIDE && near(i.x, i.y, i.z))) return false;
  if (flags.infos && registry.all(CLS.info).some(i => near(i.x, i.y, i.z))) return false;
  return true;
}
