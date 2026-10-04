/**
 * 地表草丛，依据 grasspread.bb 的 grass_map / grass_spread。镜头周围铺 (c+1)×(c+1) 个草丛，
 * 镜头所在格（Blitz 坐标按 grass_dist 取整）变化时整片重新摆放；坐标为偶数的行列再偏移半格，避免排成整齐的方阵。
 * 每个草丛取脚下颜色图像素的颜色，该像素的草地标记为 0 或位置超出地图时不显示。
 *
 * 颜色图与草地标记共用同一套像素坐标（编辑器在颜色图上直接涂草地标记），像素 x、y 分别随 Blitz x、z 增大，
 * 与 terrain.ts 的贴图坐标一致，保证草的颜色与脚下地形一致。
 *
 * 所有草丛画成一个 InstancedMesh（模型每个网格一个），可见的草丛压缩到实例数组前部并按到镜头的距离从远到近排列，
 * 相当于原版按实体排序的半透明绘制。材质半透明且不写深度；EntityAutoFade 的距离淡出在着色器里按实例原点计算。
 * 原版每 100ms 按 EntityInView 显示/隐藏的部分交给 Three 的视锥裁剪和 GPU 裁剪。
 */
import * as THREE from 'three';
import type { MapData } from '../formats/s2map';
import type { ThreeModel } from '../assets/b3d-to-three';
import { TEX_ALPHA } from '../formats/b3d';
import { CELL, worldHeight } from './terrain';

export interface GrassPreset {
  /** 每边草丛数减一，网格为 (c+1)×(c+1)。 */
  c: number;
  /** 草丛间距。 */
  dist: number;
  fadeStart: number;
  fadeEnd: number;
  alpha: number;
}

/** grass_map 中 set_grass 1..4 的设置；淡出终点为 grass_dist*(grass_c/2)。 */
export function grassPreset(level: number): GrassPreset | null {
  const p = ([
    null,
    [10, 23, 1, 0.45],
    [20, 22, 2, 0.43],
    [40, 21, 3, 0.41],
    [80, 20, 5, 0.39],
  ] as const)[level];
  if (!p) return null;
  const [c, dist, fadeMul, alpha] = p;
  return { c, dist, fadeStart: dist * fadeMul, fadeEnd: dist * Math.trunc(c / 2), alpha };
}

export interface GrassResources {
  model(path: string): Promise<ThreeModel | null>;
  texture(url: string, flags?: number): Promise<THREE.Texture | null>;
}

const MODEL_PATH = 'gfx\\grasspread.b3d';
const TEXTURE_URL = '/gfx/grasspread_a.png';
/** 原版 grass_x/grass_y 的初值，保证第一次 grass_spread 一定重新摆放。 */
const NO_CELL = -2147483648;

/** Blitz3D 浮点转整数：就近取整，恰好 .5 时取偶数（FPU 默认舍入）。 */
function blitzInt(v: number): number {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export class Grass {
  readonly group = new THREE.Group();
  private preset: GrassPreset | null;
  private geometries: THREE.BufferGeometry[] = [];
  private texture: THREE.Texture | null = null;
  private material: THREE.MeshLambertMaterial | null = null;
  private meshes: THREE.InstancedMesh[] = [];
  private wind = 0;
  private cellX = NO_CELL;
  private cellZ = NO_CELL;
  private disposed = false;

  constructor(private readonly map: MapData, level: number) {
    this.group.name = 'grass';
    this.preset = grassPreset(level);
  }

  /** 加载 gfx\grasspread.b3d 与 grasspread_a.png（load_media.bb）；密度为 0 时也加载，供之后 setLevel 使用。 */
  async load(res: GrassResources): Promise<void> {
    const [model, tex] = await Promise.all([res.model(MODEL_PATH), res.texture(TEXTURE_URL, TEX_ALPHA)]);
    if (this.disposed || !model || !tex) return;
    this.geometries = collectGeometries(model.object);
    this.texture = tex.clone();
    this.texture.center.set(0.5, 0.5);
    this.texture.needsUpdate = true;
    this.build();
  }

  /** 换一档密度并重建，相当于修改 set_grass 后重新调用 grass_map。 */
  setLevel(level: number): void {
    this.preset = grassPreset(level);
    this.build();
  }

  /** grass_spread：贴图随风摆动，镜头换格时重新摆放全部草丛。 */
  update(camera: THREE.Camera, dtMs: number): void {
    const f = dtMs / 20;
    this.wind = (this.wind + 2 * f) % 360;
    if (this.texture) this.texture.rotation = THREE.MathUtils.degToRad(Math.sin(THREE.MathUtils.degToRad(this.wind)) * 1.5);

    const p = this.preset;
    if (!p || this.meshes.length === 0) return;
    const cam = camera.getWorldPosition(new THREE.Vector3());
    const half = -Math.trunc(p.c / 2);
    const baseX = Math.trunc(blitzInt(cam.x) / p.dist) + half;
    const baseZ = Math.trunc(blitzInt(-cam.z) / p.dist) + half;
    if (baseX * p.dist === this.cellX && baseZ * p.dist === this.cellZ) return;
    this.cellX = baseX * p.dist;
    this.cellZ = baseZ * p.dist;
    this.place(p, baseX, baseZ, cam);
  }

  dispose(): void {
    this.disposed = true;
    this.clearMeshes();
    for (const g of this.geometries) g.dispose();
    this.geometries = [];
    this.texture?.dispose();
    this.texture = null;
  }

  private build(): void {
    this.clearMeshes();
    this.cellX = this.cellZ = NO_CELL;
    const p = this.preset;
    if (!p || !this.texture || this.geometries.length === 0) return;
    this.material = grassMaterial(this.texture, p);
    const capacity = (p.c + 1) * (p.c + 1);
    for (const g of this.geometries) {
      const mesh = new THREE.InstancedMesh(g, this.material, capacity);
      mesh.name = 'grass';
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  private clearMeshes(): void {
    for (const m of this.meshes) {
      this.group.remove(m);
      m.dispose();
    }
    this.meshes = [];
    this.material?.dispose();
    this.material = null;
  }

  private place(p: GrassPreset, baseX: number, baseZ: number, cam: THREE.Vector3): void {
    const map = this.map;
    const size = map.colormapSize;
    const terHalf = map.terrainSize / 2 * CELL;
    const pixel = map.terrainSize / size * CELL;
    const step = Math.trunc(p.dist / 2);
    const tufts: { x: number; y: number; z: number; px: number; py: number; d: number }[] = [];
    for (let i = 0; i <= p.c; i++) {
      for (let j = 0; j <= p.c; j++) {
        let gx = (baseX + i) * p.dist;
        let gz = (baseZ + j) * p.dist;
        if (gx % 2 === 0) gx += step;
        if (gz % 2 === 0) gz += step;
        const tz = (gz + terHalf) / pixel;
        const px = blitzInt((gx + terHalf) / pixel);
        const py = blitzInt(tz);
        if (px < 0 || px > size || py < 0 || py > size) continue;
        if (map.grass[px * (size + 1) + py] !== 1) continue;
        const y = worldHeight(map, gx, gz);
        tufts.push({ x: gx, y, z: -gz, px, py, d: (gx - cam.x) ** 2 + (y - cam.y) ** 2 + (-gz - cam.z) ** 2 });
      }
    }
    tufts.sort((a, b) => b.d - a.d);

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    for (const mesh of this.meshes) {
      tufts.forEach((t, k) => {
        // 颜色图只有 0..size-1，草地标记多一行一列（0..size），边缘一行取最近的颜色像素。
        const ci = (Math.min(t.px, size - 1) * size + Math.min(t.py, size - 1)) * 3;
        color.setRGB(map.colormap[ci] / 255, map.colormap[ci + 1] / 255, map.colormap[ci + 2] / 255, THREE.SRGBColorSpace);
        mesh.setMatrixAt(k, matrix.makeTranslation(t.x, t.y, t.z));
        mesh.setColorAt(k, color);
      });
      mesh.count = tufts.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }
}

/** 模型各网格的几何体，连同网格在模型内的变换一起烘焙（LoadMesh 会把层级合并成单个网格）。 */
function collectGeometries(root: THREE.Object3D): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = new THREE.Matrix4();
    for (let n: THREE.Object3D | null = mesh; n; n = n === root ? null : n.parent) {
      n.updateMatrix();
      m.premultiply(n.matrix);
    }
    const g = mesh.geometry.clone().applyMatrix4(m);
    g.clearGroups();
    out.push(g);
  });
  return out;
}

/**
 * EntityTexture/EntityColor/EntityAlpha/EntityFX 16 对应的材质：贴图自带 alpha（_a 后缀即 TextureFilter 标志 2），
 * 整体透明度为档位的 alpha，双面不剔除。半透明混合而非 alphaTest，保留贴图柔和的边缘与原版整体半透明的观感；
 * 不写深度，草丛之间互不遮挡，顺序由实例的远近排列保证。
 * 淡出：实例原点到镜头的距离在 fadeStart..fadeEnd 之间线性降到 0（EntityAutoFade），完全淡出的实例在顶点阶段移出裁剪空间。
 */
function grassMaterial(map: THREE.Texture, p: GrassPreset): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    map, transparent: true, opacity: p.alpha, depthWrite: false, side: THREE.DoubleSide, alphaTest: 0.01,
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.grassFadeStart = { value: p.fadeStart };
    shader.uniforms.grassFadeEnd = { value: p.fadeEnd };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float grassFadeStart;\nuniform float grassFadeEnd;\nvarying float vGrassFade;')
      .replace('#include <project_vertex>', [
        '#include <project_vertex>',
        '#ifdef USE_INSTANCING',
        'vec3 grassOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;',
        '#else',
        'vec3 grassOrigin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;',
        '#endif',
        'vGrassFade = 1.0 - clamp((distance(grassOrigin, cameraPosition) - grassFadeStart) / max(grassFadeEnd - grassFadeStart, 1.0), 0.0, 1.0);',
        'if (vGrassFade <= 0.0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);',
      ].join('\n'));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGrassFade;')
      .replace('#include <alphatest_fragment>', 'diffuseColor.a *= vGrassFade;\n#include <alphatest_fragment>');
  };
  material.customProgramCacheKey = () => 'grass';
  return material;
}
