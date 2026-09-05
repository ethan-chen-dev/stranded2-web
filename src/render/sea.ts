/** 海面：y=1 的半透明色板加一层平铺滚动的水面贴图。 */
import * as THREE from 'three';
import { SEA_LEVEL } from './terrain';

export interface Sea {
  group: THREE.Group;
  update(dt: number): void;
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

  let surface: THREE.Mesh | undefined;
  if (waterTex) {
    waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
    waterTex.repeat.set(200, 200);
    surface = new THREE.Mesh(
      new THREE.PlaneGeometry(extent, extent),
      new THREE.MeshBasicMaterial({ map: waterTex, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = SEA_LEVEL + 0.5;
    group.add(surface);
  }

  return {
    group,
    update(dt) {
      if (waterTex) {
        waterTex.offset.x = (waterTex.offset.x + 0.02 * dt) % 1;
        waterTex.offset.y = (waterTex.offset.y + 0.01 * dt) % 1;
      }
    },
  };
}
