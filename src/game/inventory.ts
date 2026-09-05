/** 背包：同类物品合并数量，承重为 weight*count 之和。 */
export interface InventoryDef {
  weight: number;
}

export class Inventory {
  readonly slots = new Map<number, number>();

  constructor(public readonly maxWeight: number, private readonly defs: (typ: number) => InventoryDef | undefined) {}

  get usedWeight(): number {
    let used = 0;
    for (const [typ, count] of this.slots) used += (this.defs(typ)?.weight ?? 0) * count;
    return used;
  }

  count(typ: number): number {
    return this.slots.get(typ) ?? 0;
  }

  /** 返回实际存入数量：全部放得下则全存，否则能放几件放几件。 */
  store(typ: number, count: number): number {
    if (count <= 0) return 0;
    const weight = this.defs(typ)?.weight ?? 0;
    const free = this.maxWeight - this.usedWeight;
    let stored = count;
    if (weight > 0 && weight * count > free) stored = Math.floor(free / weight);
    if (stored <= 0) return 0;
    this.slots.set(typ, this.count(typ) + stored);
    return stored;
  }

  /** 返回实际取出数量。 */
  remove(typ: number, count: number): number {
    const have = this.count(typ);
    const taken = Math.min(have, Math.max(count, 0));
    if (taken <= 0) return 0;
    if (have - taken === 0) this.slots.delete(typ);
    else this.slots.set(typ, have - taken);
    return taken;
  }
}
