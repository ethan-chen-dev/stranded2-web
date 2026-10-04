/**
 * 动态模糊，依据 motionblur.bb：把上一帧显示的画面按 alpha 盖在当前画面上（mb_sprite 拷贝后缓冲）。
 * 中间缓冲为半精度浮点、线性颜色；alpha 为 0 时直接渲染且清空历史，避免重新开启时出现旧画面。
 */
import * as THREE from 'three';

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const BLEND = `
uniform sampler2D tCurrent;
uniform sampler2D tPrevious;
uniform float alpha;
varying vec2 vUv;
void main() { gl_FragColor = mix(texture2D(tCurrent, vUv), texture2D(tPrevious, vUv), alpha); }`;
/** 缓冲里是线性颜色，输出到屏幕时转换到画布的颜色空间。 */
const COPY = `
uniform sampler2D tSource;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tSource, vUv);
  #include <colorspace_fragment>
}`;

export class MotionBlur {
  private readonly current: THREE.WebGLRenderTarget;
  private history: THREE.WebGLRenderTarget;
  private next: THREE.WebGLRenderTarget;
  private hasHistory = false;
  private readonly blend: THREE.ShaderMaterial;
  private readonly copy: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const make = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.current = make();
    this.history = make();
    this.next = make();
    this.blend = new THREE.ShaderMaterial({
      uniforms: { tCurrent: { value: null }, tPrevious: { value: null }, alpha: { value: 0 } },
      vertexShader: VERT, fragmentShader: BLEND, depthTest: false, depthWrite: false,
    });
    this.copy = new THREE.ShaderMaterial({ uniforms: { tSource: { value: null } }, vertexShader: VERT, fragmentShader: COPY, depthTest: false, depthWrite: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blend);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, alpha: number): void {
    const r = this.renderer;
    if (alpha <= 0) {
      this.hasHistory = false;
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    for (const t of [this.current, this.history, this.next]) if (t.width !== size.x || t.height !== size.y) { t.setSize(size.x, size.y); this.hasHistory = false; }
    r.setRenderTarget(this.current);
    r.render(scene, camera);
    this.blend.uniforms.tCurrent.value = this.current.texture;
    this.blend.uniforms.tPrevious.value = this.hasHistory ? this.history.texture : this.current.texture;
    this.blend.uniforms.alpha.value = Math.min(alpha, 1);
    this.quad.material = this.blend;
    r.setRenderTarget(this.next);
    r.render(this.quadScene, this.quadCamera);
    this.copy.uniforms.tSource.value = this.next.texture;
    this.quad.material = this.copy;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCamera);
    [this.history, this.next] = [this.next, this.history];
    this.hasHistory = true;
  }

  dispose(): void {
    for (const t of [this.current, this.history, this.next]) t.dispose();
    this.blend.dispose();
    this.copy.dispose();
    this.quad.geometry.dispose();
  }
}
