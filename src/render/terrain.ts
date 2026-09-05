/** 高度图地形。Blitz 世界坐标：格 64、高 3200、居中；转 Three 时 z 取反。 */
import * as THREE from 'three';
import type { MapData } from '../formats/s2map';

export const CELL = 64;
export const HEIGHT = 3200;
export const SEA_LEVEL = 1;

/** 颜色贴图 v 方向是否翻转，按视觉核对结果设定。 */
export const COLORMAP_FLIP_V = true;

export function heightAt(map: MapData, gx: number, gz: number): number {
  const n1 = map.terrainSize + 1;
  return map.heights[gx * n1 + gz] * HEIGHT - HEIGHT / 2;
}

/** Blitz 世界坐标 (x, z) 处的地面高度，双线性插值，越界取边缘。 */
export function worldHeight(map: MapData, x: number, zBlitz: number): number {
  const n = map.terrainSize;
  const gx = Math.min(Math.max((x + n / 2 * CELL) / CELL, 0), n);
  const gz = Math.min(Math.max((zBlitz + n / 2 * CELL) / CELL, 0), n);
  const x0 = Math.min(Math.floor(gx), n - 1);
  const z0 = Math.min(Math.floor(gz), n - 1);
  const fx = gx - x0;
  const fz = gz - z0;
  const h00 = heightAt(map, x0, z0);
  const h10 = heightAt(map, x0 + 1, z0);
  const h01 = heightAt(map, x0, z0 + 1);
  const h11 = heightAt(map, x0 + 1, z0 + 1);
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}

export function colormapTexture(map: MapData): THREE.DataTexture {
  const size = map.colormapSize;
  const data = new Uint8Array(size * size * 4);
  for (let gx = 0; gx < size; gx++) {
    for (let gz = 0; gz < size; gz++) {
      const src = (gx * size + gz) * 3;
      const dst = (gz * size + gx) * 4;
      data[dst] = map.colormap[src];
      data[dst + 1] = map.colormap[src + 1];
      data[dst + 2] = map.colormap[src + 2];
      data[dst + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function buildTerrain(map: MapData, detail: THREE.Texture | null): THREE.Mesh {
  const n = map.terrainSize;
  const n1 = n + 1;
  const positions = new Float32Array(n1 * n1 * 3);
  const uvs = new Float32Array(n1 * n1 * 2);
  const half = n / 2 * CELL;
  for (let gx = 0; gx < n1; gx++) {
    for (let gz = 0; gz < n1; gz++) {
      const i = gx * n1 + gz;
      positions[i * 3] = -half + gx * CELL;
      positions[i * 3 + 1] = heightAt(map, gx, gz);
      positions[i * 3 + 2] = -(-half + gz * CELL);
      uvs[i * 2] = gx / n;
      uvs[i * 2 + 1] = COLORMAP_FLIP_V ? 1 - gz / n : gz / n;
    }
  }
  const index = new Uint32Array(n * n * 6);
  let o = 0;
  for (let gx = 0; gx < n; gx++) {
    for (let gz = 0; gz < n; gz++) {
      const a = gx * n1 + gz;
      const b = (gx + 1) * n1 + gz;
      const c = gx * n1 + gz + 1;
      const d = (gx + 1) * n1 + gz + 1;
      index[o++] = a; index[o++] = b; index[o++] = c;
      index[o++] = b; index[o++] = d; index[o++] = c;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeVertexNormals();

  const material = new THREE.MeshLambertMaterial({ map: colormapTexture(map), color: 0xf0f0f0 });
  if (detail) {
    detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
    material.onBeforeCompile = shader => {
      shader.uniforms.detailMap = { value: detail };
      shader.uniforms.detailRepeat = { value: n * 2 };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\nuniform sampler2D detailMap;\nuniform float detailRepeat;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= texture2D(detailMap, vMapUv * detailRepeat).rgb * 2.0;');
    };
  }
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'terrain';
  return mesh;
}
