/** 天空盒：按原版 e_skybox 的六个面构建，Blitz z 取反。渲染时置于相机位置。 */
import * as THREE from 'three';

export type SkyFace = 'fr' | 'lf' | 'bk' | 'rt' | 'up' | 'dn';
export const SKY_FACES: SkyFace[] = ['fr', 'lf', 'bk', 'rt', 'up', 'dn'];

type V = [number, number, number, number, number];

/** 原版每面四个顶点：x y z u v（Blitz 坐标、v=0 在上）。 */
const FACES: Record<SkyFace, V[]> = {
  fr: [[-1, 1, -1, 0, 0], [1, 1, -1, 1, 0], [1, -1, -1, 1, 1], [-1, -1, -1, 0, 1]],
  lf: [[1, 1, -1, 0, 0], [1, 1, 1, 1, 0], [1, -1, 1, 1, 1], [1, -1, -1, 0, 1]],
  bk: [[1, 1, 1, 0, 0], [-1, 1, 1, 1, 0], [-1, -1, 1, 1, 1], [1, -1, 1, 0, 1]],
  rt: [[-1, 1, 1, 0, 0], [-1, 1, -1, 1, 0], [-1, -1, -1, 1, 1], [-1, -1, 1, 0, 1]],
  up: [[-1, 1, 1, 0, 1], [1, 1, 1, 0, 0], [1, 1, -1, 1, 0], [-1, 1, -1, 1, 1]],
  dn: [[-1, -1, -1, 1, 0], [1, -1, -1, 1, 1], [1, -1, 1, 0, 1], [-1, -1, 1, 0, 0]],
};

export function buildSky(textures: Record<SkyFace, THREE.Texture | null>): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sky';
  for (const face of SKY_FACES) {
    const verts = FACES[face];
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(verts.flatMap(v => [v[0], v[1], -v[2]]));
    const uv = new Float32Array(verts.flatMap(v => [v[3], 1 - v[4]]));
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    const tex = textures[face];
    if (tex) {
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    }
    const mat = new THREE.MeshBasicMaterial({
      color: tex ? 0xffffff : 0x88aadd,
      side: THREE.DoubleSide, depthWrite: false, depthTest: false, fog: false,
    });
    if (tex) mat.map = tex;
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = -1000;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  group.scale.setScalar(100);
  return group;
}

/**
 * 天气灰色罩（e_environment.bb 的 env_wbox）：相机周围 2000 见方、颜色 100,100,100 的立方体，
 * 画在天空之后、世界之前，不受雾影响；不透明度由天气控制，0 时隐藏。
 */
export function buildWeatherBox(): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(100 / 255, 100 / 255, 100 / 255), side: THREE.BackSide,
    transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(2000, 2000, 2000), mat);
  box.name = 'weatherbox';
  box.renderOrder = -999;
  box.frustumCulled = false;
  box.visible = false;
  return box;
}
