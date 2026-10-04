/** 把昼夜光照颜色应用到天空盒、环境光、方向光与雾。 */
import * as THREE from 'three';
import { lightColor, ambientColor, fogColor, FOG_NEAR, FOG_FAR, type RGB } from './lightcycle';

const UNDERWATER_FOG_FAR = 500;

export class Environment {
  private readonly skyMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly fog: THREE.Fog;
  /** skycolor 指令的覆盖色；mix 为 0 时直接替换，否则按 mix% 保留昼夜颜色（e_environment.bb）。 */
  override: { color: RGB; mix: number } | null = null;
  /** 镜头在水下：雾距离 1..500，雾色为光色减去水色（e_environment.bb）。 */
  underwater = false;
  /** 水色 env_wcol，watertexture 换贴图时取贴图左上角像素的反色。 */
  waterColor: RGB = [220, 110, 90];

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
    const c = lightColor(this.cycle, hour, minute);
    const o = this.override;
    if (!o) return c;
    if (o.mix === 0) return o.color;
    const keep = Math.min(1, Math.max(0, o.mix / 100));
    return [0, 1, 2].map(i => o.color[i] * (1 - keep) + c[i] * keep) as RGB;
  }

  apply(hour: number, minute: number): void {
    const c = this.current(hour, minute);
    for (const m of this.skyMaterials) m.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
    const a = ambientColor(c);
    this.ambient.color.setRGB(a[0] / 255, a[1] / 255, a[2] / 255, THREE.SRGBColorSpace);
    const luminance = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
    this.sun.intensity = 1.6 * luminance;
    if (this.underwater) {
      const w = this.waterColor;
      this.fog.near = 1;
      this.fog.far = UNDERWATER_FOG_FAR;
      this.fog.color.setRGB(Math.max(0, c[0] - w[0]) / 255, Math.max(0, c[1] - w[1]) / 255, Math.max(0, c[2] - w[2]) / 255, THREE.SRGBColorSpace);
      this.scene.fog = this.fog;
      return;
    }
    this.fog.near = FOG_NEAR;
    this.fog.far = FOG_FAR;
    if (this.mapFog[3] > 0 || this.forceFog) {
      const f = fogColor(c, [this.mapFog[0], this.mapFog[1], this.mapFog[2]]);
      this.fog.color.setRGB(f[0] / 255, f[1] / 255, f[2] / 255, THREE.SRGBColorSpace);
      this.scene.fog = this.fog;
    } else {
      this.scene.fog = null;
    }
  }
}
