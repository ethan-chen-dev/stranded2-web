/** 自由飞行相机：拖拽转视角，WASD 平移，QE 升降，Shift 加速。 */
import * as THREE from 'three';

export class FlyControls {
  speed = 400;
  private yaw: number;
  private pitch: number;
  private readonly keys = new Set<string>();
  private dragging = false;

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly el: HTMLElement) {
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;
    el.addEventListener('mousedown', ev => { if (ev.button === 0) this.dragging = true; });
    addEventListener('mouseup', () => { this.dragging = false; });
    addEventListener('mousemove', ev => {
      if (!this.dragging) return;
      this.yaw -= ev.movementX * 0.003;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - ev.movementY * 0.003));
    });
    addEventListener('keydown', ev => { this.keys.add(ev.code); });
    addEventListener('keyup', ev => { this.keys.delete(ev.code); });
    el.tabIndex = 0;
  }

  update(dt: number): void {
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const v = new THREE.Vector3();
    if (this.keys.has('KeyW')) v.z -= 1;
    if (this.keys.has('KeyS')) v.z += 1;
    if (this.keys.has('KeyA')) v.x -= 1;
    if (this.keys.has('KeyD')) v.x += 1;
    if (this.keys.has('KeyQ')) v.y -= 1;
    if (this.keys.has('KeyE')) v.y += 1;
    if (v.lengthSq() === 0) return;
    v.normalize().multiplyScalar(this.speed * dt * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 5 : 1));
    const up = v.y;
    v.y = 0;
    v.applyQuaternion(this.camera.quaternion);
    v.y += up;
    this.camera.position.add(v);
  }
}
