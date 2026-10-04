/**
 * 受击材质特效，依据 load_materials.bb 的 material_fx：按材质生成烟、木屑、火星、血或水花，并播放材质音效。
 * effects 为特效档位 set_effects（0 关闭粒子），gore 为 set_gore（关闭时不溅血）。
 */
import { P, type ParticleHandle } from '../render/particles';

export interface MaterialFxDeps {
  particle(x: number, y: number, z: number, typ: number, size?: number, a?: number): ParticleHandle | null;
  sound(file: string, at?: { x: number; y: number; z: number }): void;
  random(min: number, max: number): number;
  rnd(min: number, max: number): number;
  effects(): number;
  gore(): boolean;
}

/** Cmat_* 的编号顺序；material_name 对不认识的名字按数字解析，非数字即 0（none）。 */
const MATERIALS = ['none', 'wood', 'stone', 'dirt', 'dust', 'leaf', 'metal', 'flesh', 'water', 'lava', 'fruit', 'glass'];

export function materialName(material: string): string {
  const m = material.trim().toLowerCase();
  if (MATERIALS.includes(m)) return m;
  return MATERIALS[Number.parseInt(m, 10) || 0] ?? 'none';
}

export function materialFx(d: MaterialFxDeps, x: number, y: number, z: number, material: string, withSound = true): void {
  const mat = materialName(material);
  const fx = d.effects();
  const at = { x, y, z };
  const play = (file: string) => { if (withSound) d.sound(file, at); };
  switch (mat) {
    case 'none':
      if (fx > 0) d.particle(x + d.rnd(-5, 5), y + d.rnd(-3, 3), z + d.rnd(-5, 5), P.smoke, d.rnd(5, 10), d.rnd(0.3, 1.5));
      break;
    case 'wood':
      if (fx > 0) {
        d.particle(x + d.rnd(-3, 3), y + d.rnd(-3, 3), z + d.rnd(-3, 3), P.smoke, d.rnd(3, 5), d.rnd(0.3, 0.7))?.color(d.random(65, 100), 50, 0);
        for (let i = 0; i < fx * 3; i++) d.particle(x, y, z, P.wood, d.random(1, 3), 3);
      }
      play(`mat_wood${d.random(1, 2)}.wav`);
      break;
    case 'stone':
      if (fx > 0) {
        d.particle(x + d.rnd(-3, 3), y + d.rnd(-3, 3), z + d.rnd(-3, 3), P.smoke, d.rnd(3, 5), d.rnd(0.3, 0.7));
        if (d.random(1, 2) === 1) d.particle(x, y, z, P.spark, d.random(1, 5), 3);
      }
      play('mat_stone1.wav');
      break;
    case 'dust':
      play('mat_dust1.wav');
      break;
    case 'leaf':
      play(`mat_leaf${d.random(1, 4)}.wav`);
      break;
    case 'metal':
      if (fx > 0 && d.random(1, 2) === 1) d.particle(x, y, z, P.spark, d.random(1, 5), 3);
      play('mat_metal1.wav');
      break;
    case 'flesh':
      if (fx > 0 && d.gore()) for (let i = 0; i < fx * 3; i++) d.particle(x + d.rnd(-5, 5), y + d.rnd(-3, 3), z + d.rnd(-5, 5), P.splatter, d.rnd(1, 5), d.rnd(0.9, 1.5));
      play(`mat_flesh${d.random(1, 5)}.wav`);
      break;
    case 'water':
      if (fx > 0) for (let i = 0; i < fx * 3; i++) d.particle(x, y, z, P.spark, d.random(1, 2), 3)?.color(d.random(230, 240), d.random(230, 240), 255);
      play(['startdive.wav', 'splash.wav', 'splash2.wav'][d.random(0, 2)]);
      break;
    case 'lava':
      if (fx > 0) for (let i = 0; i < fx * 3; i++) d.particle(x, y, z, P.spark, d.random(1, 5), 3);
      play('explode5.wav');
      break;
    case 'fruit':
      play(`mat_fruit${d.random(1, 2)}.wav`);
      break;
    case 'glass':
      play(`mat_glass${d.random(1, 2)}.wav`);
      break;
    default:
      break;
  }
}
