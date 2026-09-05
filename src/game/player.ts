/** 第一人称玩家的移动与物理，常量来自原版 units.inf 与 game.inf，速度已换算为每秒。 */
import * as THREE from 'three';
import type { ObjectCollider } from './collision';

export interface PlayerInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  lookDx: number;
  lookDy: number;
}

export interface Ground {
  /** Three 坐标 (x, z) 处的地形高度。 */
  heightAt(x: number, z: number): number;
}

const F_PER_SECOND = 50;

export const PLAYER = {
  speed: 1.6 * F_PER_SECOND,
  eyes: 16,
  radius: 8,
  halfHeight: 17,
  jumpTimeMs: 450,
  jumpRise: 4 * F_PER_SECOND,
  jumpFactor: 1.1,
  fallAccelMs: 3000,
  gravity: 9.81 * 3 * F_PER_SECOND,
  seaSwimY: -8.5,
  swimFactor: 0.8,
  diagonalFactor: 0.75,
  lookSensitivity: 0.002,
  maxPitch: (88 * Math.PI) / 180,
  collisionRange: 256,
};

export class Player {
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
  jumpUntil = -1;
  fallStart = -1;
  swimming = false;
  movedThisFrame = false;
  jumpedThisFrame = false;

  constructor(pos: THREE.Vector3, yaw: number, pitch: number) {
    this.position = pos.clone();
    this.yaw = yaw;
    this.pitch = pitch;
  }

  get onLand(): boolean {
    return this.position.y > PLAYER.seaSwimY;
  }

  update(dtMs: number, nowMs: number, input: PlayerInput, ground: Ground, collider: ObjectCollider | null): void {
    const dt = dtMs / 1000;
    this.movedThisFrame = false;
    this.jumpedThisFrame = false;

    this.yaw -= input.lookDx * PLAYER.lookSensitivity;
    this.pitch = Math.max(-PLAYER.maxPitch, Math.min(PLAYER.maxPitch, this.pitch - input.lookDy * PLAYER.lookSensitivity));

    const fb = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
    const lr = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let speed = PLAYER.speed;
    if (fb !== 0 && lr !== 0) speed *= PLAYER.diagonalFactor;
    const jumping = this.jumpUntil > nowMs;
    if (this.onLand) {
      this.swimming = false;
      if (jumping) speed *= PLAYER.jumpFactor;
    } else {
      this.swimming = true;
      speed *= PLAYER.swimFactor;
    }

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const move = forward.multiplyScalar(fb).add(right.multiplyScalar(lr));
    if (move.lengthSq() > 0) {
      move.multiplyScalar(speed * dt);
      const resolved = collider ? collider.resolveMove(this.position, move, PLAYER.radius, PLAYER.halfHeight) : move;
      this.position.add(resolved);
      this.movedThisFrame = resolved.lengthSq() > 1e-8;
    }
    if (collider) this.position.add(collider.pushOut(this.position, PLAYER.radius));

    const groundY = ground.heightAt(this.position.x, this.position.z) + PLAYER.halfHeight;
    if (this.onLand) {
      if (jumping) {
        const perc = (this.jumpUntil - nowMs) / PLAYER.jumpTimeMs;
        this.position.y += PLAYER.jumpRise * perc * dt;
        this.fallStart = nowMs;
        if (this.position.y <= groundY) {
          this.position.y = groundY;
          this.jumpUntil = -1;
        }
      } else {
        if (this.fallStart < 0) this.fallStart = nowMs;
        const perc = Math.min(nowMs - this.fallStart, PLAYER.fallAccelMs) / PLAYER.fallAccelMs;
        this.position.y -= PLAYER.gravity * perc * dt;
        if (this.position.y <= groundY) {
          this.position.y = groundY;
          this.fallStart = nowMs;
          if (input.jump) {
            this.jumpUntil = nowMs + PLAYER.jumpTimeMs;
            this.jumpedThisFrame = true;
          }
        }
      }
      if (this.position.y <= PLAYER.seaSwimY) {
        this.position.y = PLAYER.seaSwimY;
        this.swimming = true;
        this.jumpUntil = -1;
      }
    } else {
      this.position.y = groundY > PLAYER.seaSwimY ? groundY : PLAYER.seaSwimY;
      this.fallStart = nowMs;
      this.jumpUntil = -1;
    }
  }

  eye(): THREE.Vector3 {
    return new THREE.Vector3(this.position.x, this.position.y + PLAYER.eyes, this.position.z);
  }

  applyTo(camera: THREE.Object3D): void {
    camera.position.copy(this.eye());
    camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }
}
