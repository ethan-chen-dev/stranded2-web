/** 技能：名称到整数值与显示名；原版为 mode 5 的 Tx 记录（skills.bb）。 */

export interface SkillEntry {
  name: string;
  value: number;
  caption: string;
}

export class Skills {
  readonly map = new Map<string, { value: number; caption: string }>();

  /** 增加技能值并更新显示名；返回该技能此前是否存在。 */
  inc(name: string, by = 1, caption?: string): boolean {
    const key = name.trim();
    const cur = this.map.get(key);
    if (cur) {
      cur.value += Math.trunc(by);
      if (caption !== undefined) cur.caption = caption;
      return true;
    }
    this.map.set(key, { value: Math.trunc(by), caption: caption ?? key });
    return false;
  }

  value(name: string): number {
    return this.map.get(name.trim())?.value ?? 0;
  }

  has(name: string): boolean {
    return this.map.has(name.trim());
  }

  setName(name: string, caption: string): boolean {
    const cur = this.map.get(name.trim());
    if (!cur) return false;
    cur.caption = caption;
    return true;
  }

  free(name: string): boolean {
    return this.map.delete(name.trim());
  }

  entries(): SkillEntry[] {
    return [...this.map.entries()].map(([name, s]) => ({ name, value: s.value, caption: s.caption }));
  }

  load(entries: SkillEntry[]): void {
    this.map.clear();
    for (const e of entries) this.map.set(e.name, { value: e.value, caption: e.caption });
  }
}
