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
      map: tex ?? undefined, color: tex ? 0xffffff : 0x88aadd,
      side: THREE.DoubleSide, depthWrite: false, depthTest: false, fog: false,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = -1000;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  group.scale.setScalar(100);
  return group;
}
