/**
 * 按地图实体列表登记实体并同步场景对象。
 * 原版前进方向为 (-Sin yaw, Cos yaw)，即正 yaw 在左手系里向左转；z 镜像后对应 Three 的 rotation.y = +yaw。
 */
import * as THREE from 'three';
import type { MapData } from '../formats/s2map';
import type { EntityDef } from '../formats/inf';
import { Resources } from '../assets/resources';
import { instantiate, subclip, type ThreeModel } from '../assets/b3d-to-three';
import { worldHeight, SEA_LEVEL } from './terrain';
import type { Log } from '../viewer/log';
import { EntityRegistry, CLS, STORED_INSIDE, type EntityRecord } from '../game/entities';

export interface Defs {
  objects: Map<number, EntityDef>;
  units: Map<number, EntityDef>;
  items: Map<number, EntityDef>;
  infos?: Map<number, EntityDef>;
}

export interface WorldStats {
  objects: number;
  units: number;
  items: number;
  missing: number;
}

export interface World {
  group: THREE.Group;
  registry: EntityRegistry;
  mixers: THREE.AnimationMixer[];
  stats: WorldStats;
  /** 让场景对象与记录一致：存放中的物品移出场景，其余按需创建并更新位姿。 */
  sync(rec: EntityRecord): void;
  remove(rec: EntityRecord): void;
  /** 登记新实体（x, z 为 Blitz 坐标；物体与物品落到地面）并异步创建场景对象。 */
  create(cls: number, typ: number, x: number, z: number, count?: number): EntityRecord | undefined;
  /** 场景内可见的物品记录。 */
  visibleItems(): EntityRecord[];
  /** 按定义异步创建一个不登记实体的模型实例（投射物用）。 */
  spawnModel(cls: number, typ: number): Promise<THREE.Object3D | null>;
}

const DEG = Math.PI / 180;

/** 原版每次循环推进 speed*f 帧，f 为循环毫秒/20，等价于 speed*50 帧每秒。 */
const BLITZ_FRAMES_PER_SECOND = 50;

function placeholder(): THREE.Object3D {
  return new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), new THREE.MeshBasicMaterial({ color: 0xff00ff }));
}

/** 并发预取地图用到的全部模型，让之后逐个实体的创建直接命中缓存；首次访问站点时加载时间由串行请求数决定。 */
async function preloadModels(map: MapData, registry: EntityRegistry, res: Resources, onProgress?: (done: number, total: number) => void): Promise<void> {
  const wanted = new Map<string, { cls: number; typ: number }>();
  for (const o of map.objects) wanted.set(`${CLS.object}:${o.typ}`, { cls: CLS.object, typ: o.typ });
  for (const u of map.units) wanted.set(`${CLS.unit}:${u.typ}`, { cls: CLS.unit, typ: u.typ });
  for (const it of map.items) if (it.parentMode !== STORED_INSIDE) wanted.set(`${CLS.item}:${it.typ}`, { cls: CLS.item, typ: it.typ });
  const jobs = [...wanted.values()].map(w => registry.defFor(w.cls, w.typ)).filter((d): d is NonNullable<typeof d> => !!d && !!d.model);
  let done = 0;
  onProgress?.(0, jobs.length);
  const CONCURRENCY = 8;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const def = jobs[next++];
      try {
        await res.model(def.model, { fx: def.fx, color: def.color, alpha: def.alpha });
      } catch {
        /* 缺失的模型在 spawn 时按占位块处理 */
      }
      onProgress?.(++done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
}

export async function buildWorld(map: MapData, defs: Defs, res: Resources, log: Log, onProgress?: (done: number, total: number) => void): Promise<World> {
  const group = new THREE.Group();
  group.name = 'world';
  const registry = new EntityRegistry(defs);
  const mixers: THREE.AnimationMixer[] = [];
  const stats: WorldStats = { objects: 0, units: 0, items: 0, missing: 0 };
  const reported = new Set<string>();

  const modelFor = async (rec: EntityRecord): Promise<ThreeModel | null> => {
    if (!rec.def) {
      const key = `${rec.cls}:${rec.typ}`;
      if (!reported.has(key)) {
        reported.add(key);
        log.warn(`${['', 'object', 'unit', 'item', 'info'][rec.cls]} 类型 ${rec.typ} 无定义`);
      }
      return null;
    }
    if (!rec.def.model) return null;
    return res.model(rec.def.model, { fx: rec.def.fx, color: rec.def.color, alpha: rec.def.alpha });
  };

  /** 原版 pitch 正值为俯（左手系），镜像 z 后对应 Three 的负 rotation.x；yaw 符号一致。 */
  const applyTransform = (rec: EntityRecord): void => {
    if (!rec.object) return;
    rec.object.position.set(rec.x, rec.y, -rec.z);
    rec.object.rotation.set(-rec.pitch * DEG, rec.yaw * DEG, rec.roll * DEG);
  };

  const attach = (rec: EntityRecord, model: ThreeModel | null): void => {
    let obj: THREE.Object3D;
    if (model) {
      const inst = instantiate(model);
      obj = inst.object;
      if (inst.mixer && rec.def) {
        const mixer = inst.mixer;
        const def = rec.def;
        let current: THREE.AnimationAction | undefined;
        const play = (name: string, loop: boolean | 'pingpong'): boolean => {
          const range = def.anims.get(name) ?? (name === 'idle' ? [...def.anims.entries()].find(([k]) => k.startsWith('idle'))?.[1] : undefined);
          if (!range || model.clips.length === 0) return false;
          const clip = subclip(model.clips[0], name, range.start, range.end, model.fps);
          const action = mixer.clipAction(clip);
          action.timeScale = (range.speed * BLITZ_FRAMES_PER_SECOND) / model.fps;
          action.setLoop(loop === 'pingpong' ? THREE.LoopPingPong : loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
          action.clampWhenFinished = loop === false;
          current?.stop();
          action.reset().play();
          current = action;
          return true;
        };
        rec.playAnim = play;
        mixers.push(mixer);
        rec.mixer = mixer;
        play('idle1', true) || play('idle', true);
      }
    } else {
      obj = placeholder();
      stats.missing++;
    }
    if (rec.def) obj.scale.set(rec.def.scale[0], rec.def.scale[1], rec.def.scale[2]);
    rec.object = obj;
    applyTransform(rec);
    group.add(obj);
  };

  const detach = (rec: EntityRecord): void => {
    if (!rec.object) return;
    group.remove(rec.object);
    if (rec.mixer) {
      const m = mixers.indexOf(rec.mixer);
      if (m >= 0) mixers.splice(m, 1);
      rec.mixer = undefined;
    }
    rec.object = undefined;
  };

  const spawn = async (rec: EntityRecord): Promise<void> => {
    if (rec.cls === CLS.info) return;
    const model = await modelFor(rec);
    if (registry.get(rec.cls, rec.id) !== rec) return;
    if (rec.cls === CLS.item && rec.parentMode === STORED_INSIDE) return;
    attach(rec, model);
  };

  await preloadModels(map, registry, res, onProgress);

  for (const o of map.objects) {
    let y = worldHeight(map, o.x, o.z);
    const rec = registry.make(CLS.object, o.typ, o.x, y, o.z, 1, o.id);
    if (rec.def?.aligntowater && y < SEA_LEVEL) y = SEA_LEVEL;
    rec.y = y;
    rec.yaw = o.yaw;
    rec.health = o.health;
    rec.healthMax = o.healthMax;
    await spawn(rec);
    stats.objects++;
  }
  for (const u of map.units) {
    const rec = registry.make(CLS.unit, u.typ, u.x, u.y, u.z, 1, u.id);
    rec.yaw = u.yaw;
    rec.health = u.health;
    rec.healthMax = u.healthMax;
    await spawn(rec);
    stats.units++;
  }
  for (const it of map.items) {
    const stored = it.parentMode === STORED_INSIDE;
    const rec = registry.make(CLS.item, it.typ, it.x, stored ? it.y : worldHeight(map, it.x, it.z), it.z, it.count, it.id);
    rec.yaw = it.yaw;
    rec.parentClass = it.parentClass;
    rec.parentId = it.parentId;
    rec.parentMode = it.parentMode;
    if (!stored) {
      await spawn(rec);
      stats.items++;
    }
  }
  for (const info of map.infos) {
    const rec = registry.make(CLS.info, info.typ, info.x, info.y, info.z, 1, info.id);
    rec.pitch = info.pitch;
    rec.yaw = info.yaw;
  }

  return {
    group, registry, mixers, stats,
    async spawnModel(cls, typ) {
      const def = registry.defFor(cls, typ);
      if (!def?.model) return null;
      const model = await res.model(def.model, { fx: def.fx, color: def.color, alpha: def.alpha });
      if (!model) return null;
      const obj = instantiate(model).object;
      obj.scale.set(def.scale[0], def.scale[1], def.scale[2]);
      return obj;
    },
    sync(rec) {
      if (rec.cls === CLS.item && rec.parentMode === STORED_INSIDE) {
        detach(rec);
        return;
      }
      if (!rec.object) void spawn(rec);
      else applyTransform(rec);
    },
    remove(rec) {
      detach(rec);
      registry.remove(rec.cls, rec.id);
      if (rec.cls === CLS.item) stats.items--;
    },
    create(cls, typ, x, z, count = 1) {
      if (!registry.defFor(cls, typ) && cls !== CLS.info) return undefined;
      const y = cls === CLS.unit ? worldHeight(map, x, z) + (registry.defFor(cls, typ)?.colyr ?? 0) : worldHeight(map, x, z);
      const rec = registry.make(cls, typ, x, y, z, count);
      if (cls === CLS.object || cls === CLS.item) rec.yaw = Math.random() * 360;
      void spawn(rec);
      if (cls === CLS.item) stats.items++;
      if (cls === CLS.object) stats.objects++;
      if (cls === CLS.unit) stats.units++;
      return rec;
    },
    visibleItems() {
      return registry.all(CLS.item).filter(r => r.parentMode !== STORED_INSIDE);
    },
  };
}
