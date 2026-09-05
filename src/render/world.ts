/**
 * 按地图实体列表查定义、取模型、实例化并摆放，并维护实体记录供游戏逻辑使用。
 * 原版前进方向为 (-Sin yaw, Cos yaw)，即正 yaw 在左手系里向左转；z 镜像后对应 Three 的 rotation.y = +yaw。
 */
import * as THREE from 'three';
import type { MapData } from '../formats/s2map';
import type { EntityDef } from '../formats/inf';
import { Resources } from '../assets/resources';
import { instantiate, subclip, type ThreeModel } from '../assets/b3d-to-three';
import { worldHeight, SEA_LEVEL } from './terrain';
import type { Log } from '../viewer/log';

export interface Defs {
  objects: Map<number, EntityDef>;
  units: Map<number, EntityDef>;
  items: Map<number, EntityDef>;
}

export interface WorldStats {
  objects: number;
  units: number;
  items: number;
  missing: number;
}

export type EntityKind = 'object' | 'unit' | 'item';

export interface WorldEntity {
  kind: EntityKind;
  id: number;
  typ: number;
  count: number;
  def?: EntityDef;
  object: THREE.Object3D;
  mixer?: THREE.AnimationMixer;
}

export interface World {
  group: THREE.Group;
  entities: WorldEntity[];
  mixers: THREE.AnimationMixer[];
  stats: WorldStats;
  removeEntity(e: WorldEntity): void;
  /** 在 Blitz 坐标 (x, z) 的地面上放一个新物品。 */
  addItem(typ: number, x: number, z: number, count?: number): Promise<WorldEntity | null>;
}

const DEG = Math.PI / 180;

/** 原版每次循环推进 speed*f 帧，f 为循环毫秒/20，等价于 speed*50 帧每秒。 */
const BLITZ_FRAMES_PER_SECOND = 50;

/** parent_mode 为 1 的物品存放在容器或背包里，没有可见模型；掉落在世界的物品每帧下落并吸附到地面。 */
const ITEM_STORED_INSIDE = 1;

function placeholder(): THREE.Object3D {
  return new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), new THREE.MeshBasicMaterial({ color: 0xff00ff }));
}

export async function buildWorld(map: MapData, defs: Defs, res: Resources, log: Log): Promise<World> {
  const group = new THREE.Group();
  group.name = 'world';
  const mixers: THREE.AnimationMixer[] = [];
  const entities: WorldEntity[] = [];
  const stats: WorldStats = { objects: 0, units: 0, items: 0, missing: 0 };
  const reported = new Set<string>();
  let nextId = 1;

  const modelFor = async (kind: EntityKind, typ: number): Promise<{ def?: EntityDef; model: ThreeModel | null }> => {
    const table = kind === 'object' ? defs.objects : kind === 'unit' ? defs.units : defs.items;
    const def = table.get(typ);
    if (!def) {
      if (!reported.has(`${kind}:${typ}`)) {
        reported.add(`${kind}:${typ}`);
        log.warn(`${kind} 类型 ${typ} 无定义`);
      }
      return { model: null };
    }
    if (!def.model) return { def, model: null };
    const model = await res.model(def.model, { fx: def.fx, color: def.color, alpha: def.alpha });
    return { def, model };
  };

  const place = (kind: EntityKind, id: number, typ: number, count: number, model: ThreeModel | null, def: EntityDef | undefined, x: number, y: number, z: number, yaw: number): WorldEntity => {
    let obj: THREE.Object3D;
    let mixer: THREE.AnimationMixer | undefined;
    if (model) {
      const inst = instantiate(model);
      obj = inst.object;
      if (inst.mixer && def) {
        const idle = def.anims.get('idle1') ?? [...def.anims.entries()].find(([k]) => k.startsWith('idle'))?.[1];
        if (idle) {
          const clip = subclip(model.clips[0], 'idle', idle.start, idle.end, model.fps);
          const action = inst.mixer.clipAction(clip);
          action.timeScale = (idle.speed * BLITZ_FRAMES_PER_SECOND) / model.fps;
          action.play();
          mixers.push(inst.mixer);
          mixer = inst.mixer;
        }
      }
    } else {
      obj = placeholder();
      stats.missing++;
    }
    obj.position.set(x, y, -z);
    obj.rotation.y = yaw * DEG;
    if (def) obj.scale.set(def.scale[0], def.scale[1], def.scale[2]);
    group.add(obj);
    const entity: WorldEntity = { kind, id, typ, count, def, object: obj, mixer };
    entities.push(entity);
    if (id >= nextId) nextId = id + 1;
    return entity;
  };

  for (const o of map.objects) {
    const { def, model } = await modelFor('object', o.typ);
    let y = worldHeight(map, o.x, o.z);
    if (def?.aligntowater && y < SEA_LEVEL) y = SEA_LEVEL;
    place('object', o.id, o.typ, 1, model, def, o.x, y, o.z, o.yaw);
    stats.objects++;
  }
  for (const u of map.units) {
    const { def, model } = await modelFor('unit', u.typ);
    place('unit', u.id, u.typ, 1, model, def, u.x, u.y, u.z, u.yaw);
    stats.units++;
  }
  for (const it of map.items) {
    if (it.parentMode === ITEM_STORED_INSIDE) continue;
    const { def, model } = await modelFor('item', it.typ);
    place('item', it.id, it.typ, it.count, model, def, it.x, worldHeight(map, it.x, it.z), it.z, it.yaw);
    stats.items++;
  }

  return {
    group, entities, mixers, stats,
    removeEntity(e) {
      group.remove(e.object);
      const i = entities.indexOf(e);
      if (i >= 0) entities.splice(i, 1);
      if (e.mixer) {
        const m = mixers.indexOf(e.mixer);
        if (m >= 0) mixers.splice(m, 1);
      }
      if (e.kind === 'item') stats.items--;
    },
    async addItem(typ, x, z, count = 1) {
      const { def, model } = await modelFor('item', typ);
      if (!def) return null;
      const e = place('item', nextId++, typ, count, model, def, x, worldHeight(map, x, z), z, Math.random() * 360);
      stats.items++;
      return e;
    },
  };
}
