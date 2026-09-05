/** 把昼夜光照颜色应用到天空盒、环境光、方向光与雾。 */
import * as THREE from 'three';
import { lightColor, ambientColor, fogColor, FOG_NEAR, FOG_FAR, type RGB } from './lightcycle';

export class Environment {
  private readonly skyMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly fog: THREE.Fog;

  constructor(
    private readonly scene: THREE.Scene,
    sky: THREE.Object3D,
    private readonly ambient: THREE.AmbientLight,
    private readonly sun: THREE.DirectionalLight,
    private readonly mapFog: [number, number, number, number],
    private readonly cycle: RGB[],
    private readonly forceFog = true,
  ) {
    sky.traverse(o => {
      const m = (o as THREE.Mesh).material;
      if (m instanceof THREE.MeshBasicMaterial) this.skyMaterials.push(m);
    });
    this.fog = new THREE.Fog(0xffffff, FOG_NEAR, FOG_FAR);
  }

  current(hour: number, minute: number): RGB {
    return lightColor(this.cycle, hour, minute);
  }

  apply(hour: number, minute: number): void {
    const c = this.current(hour, minute);
    for (const m of this.skyMaterials) m.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
    const a = ambientColor(c);
    this.ambient.color.setRGB(a[0] / 255, a[1] / 255, a[2] / 255, THREE.SRGBColorSpace);
    const luminance = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
    this.sun.intensity = 1.6 * luminance;
    if (this.mapFog[3] > 0 || this.forceFog) {
      const f = fogColor(c, [this.mapFog[0], this.mapFog[1], this.mapFog[2]]);
      this.fog.color.setRGB(f[0] / 255, f[1] / 255, f[2] / 255, THREE.SRGBColorSpace);
      this.scene.fog = this.fog;
    } else {
      this.scene.fog = null;
    }
  }
}
