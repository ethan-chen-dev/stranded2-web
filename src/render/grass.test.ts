import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { MapData } from '../formats/s2map';
import type { ThreeModel } from '../assets/b3d-to-three';
import { Grass, grassPreset, type GrassResources } from './grass';
import { buildTerrain, worldHeight } from './terrain';

/** 32 格地形、32 像素颜色图：一个像素正好 64 单位，地图范围 Blitz x/z 为 -1024..1024。 */
const N = 32;
const S = 32;
const HALF = N / 2 * 64;

function makeMap(color: (px: number, py: number) => [number, number, number], flag: (px: number, py: number) => number = () => 1): MapData {
  const n1 = N + 1;
  const heights = new Float32Array(n1 * n1);
  for (let x = 0; x < n1; x++) for (let z = 0; z < n1; z++) heights[x * n1 + z] = 0.5 + x * 0.002 + z * 0.001;
  const colormap = new Uint8Array(S * S * 3);
  for (let x = 0; x < S; x++) for (let y = 0; y < S; y++) colormap.set(color(x, y), (x * S + y) * 3);
  const grass = new Uint8Array((S + 1) * (S + 1));
  for (let x = 0; x <= S; x++) for (let y = 0; y <= S; y++) grass[x * (S + 1) + y] = flag(x, y);
  return {
    header: { version: '', date: '', time: '', format: '', mode: 'map', day: 1, hour: 8, minute: 0, freezeTime: false, skybox: 'sky', multiplayer: false, climate: 0, music: '', briefing: '', fog: [255, 255, 255, 0], quickslots: [] },
    preview: new Uint8Array(96 * 72 * 3), colormapSize: S, colormap, terrainSize: N, heights, grass,
    objects: [], units: [], items: [], infos: [], states: [], extensions: [],
  };
}

const uniqueColor = (px: number, py: number): [number, number, number] => [px * 8, py * 8, 200];

function stubRes(): GrassResources & { textures: THREE.Texture[] } {
  const textures: THREE.Texture[] = [];
  return {
    textures,
    async model(): Promise<ThreeModel> {
      const object = new THREE.Group();
      object.add(new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshBasicMaterial()));
      return { object, clips: [], fps: 30, frames: 0, skinned: false };
    },
    async texture() {
      const t = new THREE.Texture();
      textures.push(t);
      return t;
    },
  };
}

/** Three 坐标下的镜头，参数为 Blitz x/z。 */
function camAt(x: number, z: number, y = 30): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(x, y, -z);
  return cam;
}

async function setup(map: MapData, level: number) {
  const grass = new Grass(map, level);
  const res = stubRes();
  await grass.load(res);
  return { grass, res };
}

function mesh(grass: Grass): THREE.InstancedMesh {
  return grass.group.children[0] as THREE.InstancedMesh;
}

/** 可见草丛的 Blitz 坐标与颜色（sRGB 十六进制）。 */
function tufts(grass: Grass) {
  const m = mesh(grass);
  const mat = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const col = new THREE.Color();
  const out: { x: number; y: number; z: number; hex: number }[] = [];
  for (let i = 0; i < m.count; i++) {
    m.getMatrixAt(i, mat);
    pos.setFromMatrixPosition(mat);
    m.getColorAt(i, col);
    out.push({ x: pos.x, y: pos.y, z: -pos.z, hex: col.getHex(THREE.SRGBColorSpace) });
  }
  return out;
}

/** Blitz3D 浮点转整数：就近取整，.5 取偶数。 */
const bround = (v: number) => {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

/** 原版 Mod 2 半格偏移：坐标为偶数时加 dist/2。 */
const halfStep = (v: number, dist: number) => (v % 2 === 0 ? v + Math.trunc(dist / 2) : v);

describe('grassPreset', () => {
  it('follows grass_map', () => {
    expect(grassPreset(0)).toBeNull();
    expect(grassPreset(1)).toEqual({ c: 10, dist: 23, fadeStart: 23, fadeEnd: 115, alpha: 0.45 });
    expect(grassPreset(2)).toEqual({ c: 20, dist: 22, fadeStart: 44, fadeEnd: 220, alpha: 0.43 });
    expect(grassPreset(3)).toEqual({ c: 40, dist: 21, fadeStart: 63, fadeEnd: 420, alpha: 0.41 });
    expect(grassPreset(4)).toEqual({ c: 80, dist: 20, fadeStart: 100, fadeEnd: 800, alpha: 0.39 });
  });
});

describe('Grass', () => {
  it('builds a (c+1)^2 grid per level', async () => {
    for (const [level, c] of [[1, 10], [2, 20], [3, 40], [4, 80]]) {
      const { grass } = await setup(makeMap(uniqueColor), level);
      grass.update(camAt(0, 0), 20);
      expect(grass.group.children).toHaveLength(1);
      expect(mesh(grass).instanceMatrix.count).toBe((c + 1) ** 2);
      expect(mesh(grass).count).toBe((c + 1) ** 2);
    }
  });

  it('snaps the grid to the camera cell with the odd/even half step', async () => {
    const map = makeMap(uniqueColor);
    const { grass } = await setup(map, 1);
    grass.update(camAt(100.4, -50.6), 20);
    // Int(100.4)=100, 100/23=4；Int(-50.6)=-51, -51/23 向零截断为 -2；half=-5。
    const xs = Array.from({ length: 11 }, (_, i) => halfStep((4 - 5 + i) * 23, 23));
    const zs = Array.from({ length: 11 }, (_, j) => halfStep((-2 - 5 + j) * 23, 23));
    expect(xs.slice(0, 3)).toEqual([-23, 11, 23]);
    expect(zs.slice(0, 2)).toEqual([-161, -127]);
    const expected = xs.flatMap(x => zs.map(z => `${x},${z}`)).sort();
    const got = tufts(grass);
    expect(got.map(t => `${Math.round(t.x)},${Math.round(t.z)}`).sort()).toEqual(expected);
    for (const t of got) expect(t.y).toBeCloseTo(worldHeight(map, t.x, t.z), 3);
  });

  it('orders visible tufts from far to near', async () => {
    const { grass } = await setup(makeMap(uniqueColor), 2);
    grass.update(camAt(37, 81), 20);
    const d = tufts(grass).map(t => Math.hypot(t.x - 37, t.y - 30, t.z - 81));
    expect(d.length).toBe(21 * 21);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeLessThanOrEqual(d[i - 1]);
  });

  it('only re-places when the camera changes cell', async () => {
    const { grass } = await setup(makeMap(uniqueColor), 1);
    grass.update(camAt(100.4, -50.6), 20);
    const v = mesh(grass).instanceMatrix.version;
    grass.update(camAt(110, -60), 20);
    grass.update(camAt(93, -46, 200), 20);
    expect(mesh(grass).instanceMatrix.version).toBe(v);
    grass.update(camAt(120, -60), 20);
    expect(mesh(grass).instanceMatrix.version).toBeGreaterThan(v);
  });

  it('colours each tuft from the colour map pixel under it', async () => {
    const { grass } = await setup(makeMap(uniqueColor), 3);
    grass.update(camAt(-200, 300), 20);
    const got = tufts(grass);
    expect(got.length).toBeGreaterThan(1000);
    for (const t of got) {
      const tx = (t.x + HALF) / 64;
      const tz = (t.z + HALF) / 64;
      const px = Math.min(bround(tx), S - 1);
      const py = Math.min(bround(tz), S - 1);
      const [r, g, b] = uniqueColor(px, py);
      expect(t.hex).toBe((r << 16) | (g << 8) | b);
    }
  });

  it('matches the colour the terrain shows under the tuft', async () => {
    // 四个象限四种颜色：z 方向弄反时上下两半的颜色对调。
    const quad = (px: number, py: number): [number, number, number] => [px < S / 2 ? 255 : 0, py < S / 2 ? 255 : 0, 77];
    const map = makeMap(quad);
    const { grass } = await setup(map, 4);
    grass.update(camAt(0, 0), 20);

    const terrain = buildTerrain(map, null);
    const uv = terrain.geometry.getAttribute('uv');
    const data = ((terrain.material as THREE.MeshLambertMaterial).map as THREE.DataTexture).image.data as Uint8Array;
    const n1 = N + 1;
    /** 地形在 Blitz (x, z) 处的 uv（网格内线性插值）与最近的颜色贴图像素。 */
    const terrainHex = (x: number, z: number) => {
      const gx = (x + HALF) / 64;
      const gz = (z + HALF) / 64;
      const x0 = Math.min(Math.floor(gx), N - 1);
      const z0 = Math.min(Math.floor(gz), N - 1);
      const fx = gx - x0;
      const fz = gz - z0;
      const at = (i: number, j: number) => [uv.getX(i * n1 + j), uv.getY(i * n1 + j)];
      const [u00, v00] = at(x0, z0); const [u10, v10] = at(x0 + 1, z0);
      const [u01, v01] = at(x0, z0 + 1); const [u11, v11] = at(x0 + 1, z0 + 1);
      const u = (u00 * (1 - fx) + u10 * fx) * (1 - fz) + (u01 * (1 - fx) + u11 * fx) * fz;
      const v = (v00 * (1 - fx) + v10 * fx) * (1 - fz) + (v01 * (1 - fx) + v11 * fx) * fz;
      const col = Math.min(Math.floor(u * S), S - 1);
      const row = Math.min(Math.floor(v * S), S - 1);
      const k = (row * S + col) * 4;
      return (data[k] << 16) | (data[k + 1] << 8) | data[k + 2];
    };

    const seen = new Set<number>();
    for (const t of tufts(grass)) {
      if (Math.abs(t.x) < 128 || Math.abs(t.z) < 128) continue;
      expect(t.hex).toBe(terrainHex(t.x, t.z));
      seen.add(t.hex);
    }
    expect(seen.size).toBe(4);
  });

  it('hides tufts whose grass flag is 0, using the same pixel as the colour', async () => {
    // 只有 (255, 0) 象限的像素有草：所有可见草丛必须是这个颜色。
    const quad = (px: number, py: number): [number, number, number] => [px < S / 2 ? 255 : 0, py < S / 2 ? 255 : 0, 77];
    const map = makeMap(quad, (px, py) => (px < S / 2 && py >= S / 2 ? 1 : 0));
    const { grass } = await setup(map, 4);
    grass.update(camAt(0, 0), 20);
    const got = tufts(grass);
    expect(got.length).toBeGreaterThan(1000);
    expect(got.length).toBeLessThan(81 * 81 / 2);
    for (const t of got) expect(t.hex).toBe(0xff004d);
  });

  it('hides tufts outside the map', async () => {
    const { grass } = await setup(makeMap(uniqueColor), 2);
    grass.update(camAt(1000, 0), 20);
    // Int(1000)/22=45，half=-10：列 x 从 35*22=770 到 55*22=1210。
    const xs = Array.from({ length: 21 }, (_, i) => halfStep((45 - 10 + i) * 22, 22));
    const inside = xs.filter(x => bround((x + HALF) / 64) <= S);
    expect(inside.length).toBeLessThan(21);
    const got = tufts(grass);
    expect(got).toHaveLength(inside.length * 21);
    for (const t of got) expect(t.x).toBeLessThan(HALF + 32);
  });

  it('builds nothing at level 0 and rebuilds on setLevel', async () => {
    const { grass } = await setup(makeMap(uniqueColor), 0);
    grass.update(camAt(0, 0), 20);
    expect(grass.group.children).toHaveLength(0);
    grass.setLevel(1);
    grass.update(camAt(0, 0), 20);
    expect(mesh(grass).count).toBe(121);
    grass.setLevel(3);
    expect(mesh(grass).count).toBe(0);
    grass.update(camAt(0, 0), 20);
    expect(mesh(grass).count).toBe(41 * 41);
    grass.setLevel(0);
    expect(grass.group.children).toHaveLength(0);
  });

  it('sways the texture with the wind', async () => {
    const { grass } = await setup(makeMap(uniqueColor), 1);
    grass.update(camAt(0, 0), 20);
    grass.update(camAt(0, 0), 40);
    const tex = (mesh(grass).material as THREE.MeshLambertMaterial).map!;
    const deg = Math.sin(6 * Math.PI / 180) * 1.5;
    expect(tex.rotation).toBeCloseTo(deg * Math.PI / 180, 6);
    expect(tex.center.toArray()).toEqual([0.5, 0.5]);
  });

  it('uses a two-sided blended material with shader autofade', async () => {
    const { grass } = await setup(makeMap(uniqueColor), 2);
    const mat = mesh(grass).material as THREE.MeshLambertMaterial;
    expect(mat.side).toBe(THREE.DoubleSide);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.opacity).toBe(0.43);
    const lib = THREE.ShaderLib.lambert;
    const shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
    mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
    expect(shader.uniforms.grassFadeStart.value).toBe(44);
    expect(shader.uniforms.grassFadeEnd.value).toBe(220);
    expect(shader.vertexShader).toContain('vGrassFade = 1.0 -');
    expect(shader.fragmentShader).toContain('diffuseColor.a *= vGrassFade;');
  });

  it('removes everything on dispose', async () => {
    const { grass } = await setup(makeMap(uniqueColor), 1);
    grass.update(camAt(0, 0), 20);
    grass.dispose();
    expect(grass.group.children).toHaveLength(0);
    expect(() => grass.update(camAt(500, 0), 20)).not.toThrow();
  });
});
