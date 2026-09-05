/** 建筑锁、放置校验、工地投料与完工，规则来自原版 game_build.bb。 */
import type { Building } from '../formats/buildings';
import type { EntityRegistry, EntityRecord } from './entities';
import { CLS, STORED_INSIDE } from './entities';
import type { ScriptEngine } from '../script/engine';
import type { World } from '../render/world';

export const STATE_BUILDPLACE = 52;
export const SITE_LAND = 150;
export const SITE_WATER = 151;
export const HAMMER_RANGE = 75;
export const AT_OBJECT_RANGE = 32;

export interface BuildDeps {
  registry: EntityRegistry;
  engine: ScriptEngine;
  world: World;
  locks: Set<string>;
  playerId: number;
  buildings: Building[];
  terrainY(x: number, z: number): number;
  message(text: string, font?: number): void;
  sound(file: string): void;
}

export type HammerResult = 'added' | 'finished' | 'missing' | 'none';

export class Build {
  lastSite = 0;

  constructor(private readonly d: BuildDeps) {}

  isLocked(b: Building): boolean {
    return this.d.locks.has(`building:${b.id}`);
  }

  available(): Building[] {
    return this.d.buildings.filter(b => !this.isLocked(b));
  }

  /** 返回不满足放置约束时的提示，满足时为 null。 */
  checkSpace(b: Building, x: number, z: number): string | null {
    const y = this.d.terrainY(x, z);
    switch (b.space) {
      case 'land': return y < 0 ? '需要建在陆地上' : null;
      case 'landwater': return null;
      case 'water': return y > 0 ? '需要建在水面上' : null;
      case 'shore': return y < -3 || y > 3 ? '需要建在岸边' : null;
      case 'hill': return y < 100 ? '需要建在山地上' : null;
      case 'shallow': return y < -3 || y > -0.1 ? '需要建在浅水里' : null;
      case 'atobject': {
        const ok = this.d.registry.all(CLS.object, b.atObject).some(o => Math.hypot(o.x - x, o.z - z) <= AT_OBJECT_RANGE);
        return ok ? null : '需要建在指定的物体上';
      }
      default: return null;
    }
  }

  place(b: Building, x: number, z: number, yaw: number): EntityRecord | null {
    if (this.d.engine.runGlobalNow('build_start')) return null;
    const fail = this.checkSpace(b, x, z);
    if (fail) {
      this.d.message(fail, 2);
      this.d.sound('fail.wav');
      return null;
    }
    const typ = b.siteObject || (this.d.terrainY(x, z) < 0 ? SITE_WATER : SITE_LAND);
    const site = this.d.world.create(CLS.object, typ, x, z);
    if (!site) return null;
    site.yaw = yaw;
    this.d.world.sync(site);
    this.d.engine.states.add(CLS.object, site.id, STATE_BUILDPLACE).value = String(b.id);
    this.lastSite = site.id;
    return site;
  }

  buildingOf(site: EntityRecord): Building | undefined {
    const st = this.d.engine.states.find(CLS.object, site.id, STATE_BUILDPLACE);
    if (!st) return undefined;
    return this.d.buildings.find(b => b.id === parseInt(st.value, 10));
  }

  builtAt(objectId: number): number {
    const rec = this.d.registry.get(CLS.object, objectId);
    return rec ? (this.buildingOf(rec)?.id ?? 0) : 0;
  }

  sites(): EntityRecord[] {
    return this.d.registry.all(CLS.object).filter(o => this.d.engine.states.has(CLS.object, o.id, STATE_BUILDPLACE));
  }

  /** 玩家附近的工地：按需求逐件投料，齐了就完工。 */
  hammer(px: number, pz: number): HammerResult {
    const site = this.sites().find(s => Math.hypot(s.x - px, s.z - pz) < HAMMER_RANGE);
    if (!site) return 'none';
    const b = this.buildingOf(site);
    if (!b) return 'none';
    let complete = 0;
    for (const req of b.reqs) {
      const have = this.d.registry.countStored(CLS.object, site.id, req.typ);
      if (have >= req.count) {
        complete++;
        continue;
      }
      const mine = this.d.registry.storedIn(CLS.unit, this.d.playerId, req.typ)[0];
      if (mine) {
        if (this.d.registry.consume(mine.id, 1)) this.d.world.remove(mine);
        const existing = this.d.registry.storedIn(CLS.object, site.id, req.typ)[0];
        if (existing) {
          existing.count += 1;
        } else {
          const stored = this.d.registry.make(CLS.item, req.typ, site.x, site.y, site.z, 1);
          stored.parentClass = CLS.object;
          stored.parentId = site.id;
          stored.parentMode = STORED_INSIDE;
        }
        const name = this.d.registry.defFor(CLS.item, req.typ)?.name ?? `#${req.typ}`;
        this.d.message(`放入 ${name}（${have + 1}/${req.count}）`, 1);
        this.d.sound('build.wav');
        return 'added';
      }
    }
    if (complete === b.reqs.length) {
      this.finish(site, b);
      return 'finished';
    }
    this.d.message('缺少材料', 2);
    this.d.sound('fail.wav');
    return 'missing';
  }

  finish(site: EntityRecord, b: Building): EntityRecord | null {
    const { x, z, yaw } = site;
    for (const item of this.d.registry.storedIn(CLS.object, site.id)) this.d.registry.remove(CLS.item, item.id);
    this.d.engine.states.free(CLS.object, site.id);
    this.d.world.remove(site);
    const cls = b.objectId > 0 ? CLS.object : CLS.unit;
    const rec = this.d.world.create(cls, b.objectId > 0 ? b.objectId : b.unitId, x, z);
    if (!rec) return null;
    rec.yaw = yaw;
    this.d.world.sync(rec);
    this.d.message('建造完成', 1);
    this.d.sound('build_finish.wav');
    if (b.script) this.d.engine.runText(b.script, { cls, id: rec.id, event: 'build', info: '(buildings.inf-script)' }, `building ${b.id}`);
    this.d.engine.runNow(cls, rec.id, 'build_finish');
    this.d.engine.update(0);
    return rec;
  }
}
