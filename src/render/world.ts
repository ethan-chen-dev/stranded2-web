/**
 * 按地图实体列表查定义、取模型、实例化并摆放。
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

export interface World {
  group: THREE.Group;
  mixers: THREE.AnimationMixer[];
  stats: WorldStats;
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
  const stats: WorldStats = { objects: 0, units: 0, items: 0, missing: 0 };
  const reported = new Set<string>();

  const modelFor = async (kind: string, table: Map<number, EntityDef>, typ: number): Promise<{ def?: EntityDef; model: ThreeModel | null }> => {
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

  const place = (model: ThreeModel | null, def: EntityDef | undefined, x: number, y: number, z: number, yaw: number): void => {
    let obj: THREE.Object3D;
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
  };

  for (const o of map.objects) {
    const { def, model } = await modelFor('object', defs.objects, o.typ);
    let y = worldHeight(map, o.x, o.z);
    if (def?.aligntowater && y < SEA_LEVEL) y = SEA_LEVEL;
    place(model, def, o.x, y, o.z, o.yaw);
    stats.objects++;
  }
  for (const u of map.units) {
    const { def, model } = await modelFor('unit', defs.units, u.typ);
    place(model, def, u.x, u.y, u.z, u.yaw);
    stats.units++;
  }
  for (const it of map.items) {
    if (it.parentMode === ITEM_STORED_INSIDE) continue;
    const { def, model } = await modelFor('item', defs.items, it.typ);
    place(model, def, it.x, worldHeight(map, it.x, it.z), it.z, it.yaw);
    stats.items++;
  }
  return { group, mixers, stats };
}
