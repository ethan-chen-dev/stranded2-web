/** 海面：y=1 的半透明色板加一层平铺滚动的水面贴图。 */
import * as THREE from 'three';
import { SEA_LEVEL } from './terrain';

export interface Sea {
  group: THREE.Group;
  update(dt: number): void;
  /** watertexture：换水面贴图。 */
  setTexture(tex: THREE.Texture): void;
  /** wateralpha：水面贴图层的不透明度。 */
  setAlpha(a: number): void;
}

export function buildSea(waterTex: THREE.Texture | null, extent: number): Sea {
  const group = new THREE.Group();
  group.name = 'sea';

  const tint = new THREE.Mesh(
    new THREE.PlaneGeometry(extent, extent),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(80 / 255, 1, 240 / 255), transparent: true, opacity: 0.25, depthWrite: false }),
  );
  tint.rotation.x = -Math.PI / 2;
  tint.position.y = SEA_LEVEL;
  group.add(tint);

  const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false });
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(extent, extent), material);
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = SEA_LEVEL + 0.5;
  surface.visible = false;
  group.add(surface);
  let tex: THREE.Texture | null = null;
  const use = (t: THREE.Texture) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(200, 200);
    if (tex) t.offset.copy(tex.offset);
    tex = t;
    material.map = t;
    material.needsUpdate = true;
    surface.visible = true;
  };
  if (waterTex) use(waterTex);

  return {
    group,
    update(dt) {
      if (tex) {
        tex.offset.x = (tex.offset.x + 0.02 * dt) % 1;
        tex.offset.y = (tex.offset.y + 0.01 * dt) % 1;
      }
    },
    setTexture: use,
    setAlpha(a) { material.opacity = Math.max(0, Math.min(1, a)); },
  };
}
