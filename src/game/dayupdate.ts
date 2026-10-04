/**
 * 逐日更新，依据 game_changeday.bb 的 game_cd、handle_objects.bb 的 grow_object 与 handle_infos.bb 的
 * info_spawncontrol：每过一天触发 changeday 脚本事件，物体生长或按 spawn 生成物品、按 healthchange 增减生命，
 * 单位增减生命或清理尸体，地上物品增减生命（腐烂），刷新点补足单位、物体或物品。天气没有实现。
 */
import { CLS, STORED_INSIDE, type EntityRecord, type EntityRegistry } from './entities';
import type { ScriptEngine } from '../script/engine';
import type { World } from '../render/world';
import type { MapInfo } from '../formats/s2map';

/** 原版挂在物体外面、可见的子物品（Cpm_out）。 */
export const STORED_OUTSIDE = 0;
const SPAWN_CONTROL = 45;
const STATE_INVULNERABILITY = 'invulnerability';
/** 编辑器里放的单位 id 从 100 起，玩家与特殊单位在下面，原版只清理 id 不小于 100 的尸体。 */
const FIRST_FREE_UNIT_ID = 100;

export interface DayDeps {
  registry: EntityRegistry;
  engine: ScriptEngine;
  world: World;
  random(min: number, max: number): number;
  terrainY(x: number, z: number): number;
  /** 以 0 伤害强制击杀物体（damage_object(0,1)）。 */
  killObject(rec: EntityRecord): void;
  /** 单位生命归零时的死亡流程（kill_unit）：死亡状态、on:kill、掉落与死亡动画。 */
  killUnit(rec: EntityRecord): void;
}

interface SpawnControl {
  info: MapInfo;
  /** 距上次补充过去的天数（原版 strings[2]）。 */
  days: number;
}

/** 物体生长进度 0..1；daytimer 为负表示还差多少天长成。 */
export function growth(rec: EntityRecord): number {
  const t = rec.daytimer ?? 0;
  const g = rec.def?.growtime ?? 0;
  if (t >= 0 || g <= 0) return 1;
  return Math.min(1, Math.max(1, g + t) / g);
}

/** grow_object：未长成的物体按比例缩小、偏绿，生命上限按比例。 */
export function applyGrowth(rec: EntityRecord, world: World): void {
  const def = rec.def;
  if (!def) return;
  const p = growth(rec);
  const scale: [number, number, number] = [p, p, p];
  const color: [number, number, number] = [def.color[0], Math.min(255, def.color[1] + 255 * (1 - p)), def.color[2]];
  const same = (a?: number[], b?: number[]) => !!a && !!b && a.every((v, i) => v === b[i]);
  const healthMax = Math.ceil(def.health * p);
  if (rec.healthMax !== healthMax) {
    rec.healthMax = healthMax;
    rec.health = healthMax;
  }
  if (p >= 1 && !rec.look?.scale && !rec.look?.color) return;
  if (same(rec.look?.scale, scale) && same(rec.look?.color, color)) return;
  rec.look = { ...rec.look, scale, color };
  world.restyle(rec);
}

export class DayUpdate {
  private readonly controls: SpawnControl[];

  constructor(private readonly d: DayDeps, infos: MapInfo[]) {
    this.controls = infos.filter(i => i.typ === SPAWN_CONTROL).map(info => ({ info, days: Number.parseInt(info.strings[2] ?? '0', 10) || 0 }));
  }

  /** 存档用：各刷新点距上次补充的天数。 */
  spawnDays(): [number, number][] {
    return this.controls.map(c => [c.info.id, c.days]);
  }

  restoreSpawnDays(entries: [number, number][]): void {
    for (const [id, days] of entries) {
      const c = this.controls.find(x => x.info.id === id);
      if (c) c.days = days;
    }
  }

  /** game_cd：每过一天调用一次。 */
  changeDay(): void {
    const { registry, engine } = this.d;
    engine.globalEvent('changeday');
    for (const o of [...registry.all(CLS.object)]) this.object(o);
    for (const u of [...registry.all(CLS.unit)]) this.unit(u);
    for (const it of [...registry.all(CLS.item)]) this.item(it);
    for (const c of this.controls) this.spawnControl(c);
  }

  private object(o: EntityRecord): void {
    const def = o.def;
    if (!def || !this.d.registry.get(CLS.object, o.id)) return;
    if ((o.daytimer ?? 0) < 0) {
      if (def.growtime > 0) {
        o.daytimer = (o.daytimer ?? 0) + 1;
        applyGrowth(o, this.d.world);
      }
      return;
    }
    const rule = def.spawn;
    if (rule && rule.rate > 0) {
      o.daytimer = (o.daytimer ?? 0) + 1;
      if (o.daytimer >= rule.rate) {
        o.daytimer = 0;
        const have = this.d.registry.all(CLS.item, rule.item).filter(r => r.parentClass === CLS.object && r.parentId === o.id).length;
        if (have < rule.limit) this.spawnAt(o, rule);
      }
    }
    if (def.healthchange < 0) {
      if (!this.d.engine.states.has(CLS.object, o.id, this.d.engine.stateType(STATE_INVULNERABILITY))) {
        o.health += def.healthchange;
        if (o.health <= 0) this.d.killObject(o);
      }
    } else if (def.healthchange > 0) {
      o.health = Math.min(o.health + def.healthchange, o.healthMax);
    }
  }

  /** 物品挂在物体外面：水平方向在 xzr/2.5 到 xzr 之间，高度为物体高度加随机幅度与偏移。 */
  private spawnAt(o: EntityRecord, rule: NonNullable<NonNullable<EntityRecord['def']>['spawn']>): void {
    const rec = this.d.world.create(CLS.item, rule.item, o.x, o.z, rule.count);
    if (!rec) return;
    const a = this.d.random(0, 359) * Math.PI / 180;
    const dist = rule.xzr / 2.5 + Math.random() * (rule.xzr - rule.xzr / 2.5);
    rec.x = o.x + Math.sin(a) * dist;
    rec.z = o.z + Math.cos(a) * dist;
    rec.y = o.y + (Math.random() * 2 - 1) * rule.yr + rule.yo;
    rec.parentClass = CLS.object;
    rec.parentId = o.id;
    rec.parentMode = STORED_OUTSIDE;
    this.d.world.sync(rec);
  }

  private unit(u: EntityRecord): void {
    if (!this.d.registry.get(CLS.unit, u.id)) return;
    if (u.dead || u.health <= 0) {
      if (u.id >= FIRST_FREE_UNIT_ID) this.d.world.remove(u);
      return;
    }
    const change = u.def?.healthchange ?? 0;
    if (change === 0) return;
    u.health = Math.min(u.health + change, u.healthMax);
    if (u.health <= 0) this.d.killUnit(u);
  }

  private item(it: EntityRecord): void {
    if (it.parentClass !== 0 || it.parentMode === STORED_INSIDE || !this.d.registry.get(CLS.item, it.id)) return;
    const change = it.def?.healthchange ?? 0;
    if (change < 0) {
      if (this.d.engine.states.has(CLS.item, it.id, this.d.engine.stateType(STATE_INVULNERABILITY))) return;
      it.health += change;
      if (it.health <= 0) this.d.world.remove(it);
    } else if (change > 0) {
      it.health = Math.min(it.health + change, it.def?.health ?? it.health);
    }
  }

  /** 刷新点：每 strings[1] 天检查一次，floats[1]=1 时把半径 floats[0] 内类型 ints[1] 补到 ints[2] 个，单次最多 strings[0] 个。 */
  private spawnControl(c: SpawnControl): void {
    const info = this.d.registry.get(CLS.info, c.info.id);
    if (!info) return;
    const [cls, typ, max] = c.info.ints;
    const [radius, active] = c.info.floats;
    c.days++;
    if (c.days < (Number.parseInt(c.info.strings[1] ?? '0', 10) || 0)) return;
    c.days = 0;
    if (Math.trunc(active) !== 1) return;
    const near = this.d.registry.all(cls, typ).filter(r => !r.dead && (cls !== CLS.item || r.parentMode !== STORED_INSIDE) && Math.hypot(r.x - info.x, r.z - info.z) <= radius).length;
    let n = max - near;
    const partial = Number.parseInt(c.info.strings[0] ?? '0', 10) || 0;
    if (partial > 0 && n > partial) n = partial;
    for (let i = 0; i < n; i++) {
      const a = this.d.random(0, 359) * Math.PI / 180;
      const dist = Math.random() * radius;
      const rec = this.d.world.create(cls, typ, info.x + Math.sin(a) * dist, info.z + Math.cos(a) * dist);
      if (!rec) continue;
      rec.yaw = this.d.random(0, 359);
      this.d.world.sync(rec);
      this.d.engine.entityEvent(cls, rec.id, 'spawn');
    }
  }
}
