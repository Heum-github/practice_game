import * as THREE from 'three';
import { CAMERA } from '../config';
import { Input } from '../core/Input';
import { Terrain } from '../world/Terrain';
import { ColliderSet } from '../world/Collision';
import { DEG, clamp, damp, dampAngle } from '../util/math';

/**
 * 어깨 너머 3인칭 카메라.
 *
 * - 마우스로 궤도 회전, 휠로 거리 조절
 * - 지형과 잔해를 향해 광선을 쏘아 벽에 낀 화면을 막는다
 *   (막힐 때는 빠르게 당기고, 트일 때는 천천히 풀어준다 — 화면이 튀지 않는다)
 */
export class ThirdPersonCamera {
  /** 실제로 적용되는 각도 (목표를 감쇠 추종한다) */
  yaw = 0;
  pitch = 14 * DEG;

  /** 마우스 입력이 쌓이는 목표 각도 */
  private yawTarget = 0;
  private pitchTarget = 14 * DEG;

  /** 화면 흔들림 세기 0..1 */
  private shake = 0;
  private shakeT = 0;
  /** 달리기 정도 0..1 — 화각을 넓히는 데 쓴다 */
  private runAmount = 0;

  private distance: number = CAMERA.distance;
  private currentDistance: number = CAMERA.distance;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly terrain: Terrain;
  private readonly colliders: ColliderSet;

  /** 플레이어를 감쇠 추종하는 지점 (어깨 오프셋 이전) */
  private readonly smoothFollow = new THREE.Vector3();
  /** 실제로 바라보는 지점 = smoothFollow + 어깨 오프셋 */
  private readonly smoothTarget = new THREE.Vector3();
  private initialized = false;

  private readonly target = new THREE.Vector3();
  private readonly offsetDir = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly rightVec = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, terrain: Terrain, colliders: ColliderSet) {
    this.camera = camera;
    this.terrain = terrain;
    this.colliders = colliders;
  }

  /** 머리 방향 연출에 쓸 정규화된 피치 */
  get normalizedPitch(): number {
    return this.pitch / (CAMERA.pitchMaxDeg * DEG);
  }

  /**
   * 시점 각도만 갱신한다.
   * 물리 서브스텝이 카메라 방향을 참조하므로 프레임 맨 앞에서 한 번만 호출한다.
   */
  updateAngles(input: Input): void {
    if (!input.looking) return;

    this.yawTarget -= input.mouseDX * CAMERA.sensitivity;
    this.pitchTarget += input.mouseDY * CAMERA.sensitivity;
    this.pitchTarget = clamp(
      this.pitchTarget,
      CAMERA.pitchMinDeg * DEG,
      CAMERA.pitchMaxDeg * DEG,
    );

    if (input.wheelDelta !== 0) {
      this.distance = clamp(
        this.distance + input.wheelDelta * 0.006,
        CAMERA.distanceMin,
        CAMERA.distanceMax,
      );
    }
  }

  /**
   * 화면을 흔든다.
   * @param amount 0..1 — 착지·피격·타격의 세기
   */
  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  /** 달리는 정도를 알려주면 화각이 따라 넓어진다 */
  setRunAmount(run: number): void {
    this.runAmount = clamp(run, 0, 1);
  }

  /** 플레이어가 최종 위치로 이동한 뒤, 프레임당 한 번 호출한다 */
  updateTransform(dt: number, playerPos: THREE.Vector3): void {
    // ---------------------------------------------------------- 시점 각도 추종
    this.yaw = dampAngle(this.yaw, this.yawTarget, CAMERA.lookDamping, dt);
    this.pitch = damp(this.pitch, this.pitchTarget, CAMERA.lookDamping, dt);

    // ---------------------------------------------------------- 주시점
    // 위치 추종과 어깨 오프셋을 분리한다.
    //
    // 어깨 오프셋을 감쇠 대상에 포함시키면, 시점을 빠르게 돌릴 때 오프셋이
    // 월드 좌표에서 원을 그리며 이동하고 그 이동을 카메라가 뒤늦게 따라잡는다.
    // 그 지연이 화면 속 캐릭터를 좌우로 미끄러지게 만든다 — 휘청거림의 정체다.
    // 오프셋은 감쇠 없이 마지막에 얹어야 캐릭터의 화면상 위치가 고정된다.
    this.target.set(playerPos.x, playerPos.y + CAMERA.targetHeight, playerPos.z);

    if (!this.initialized) {
      this.smoothFollow.copy(this.target);
      this.initialized = true;
    } else {
      const l = CAMERA.followDamping;
      this.smoothFollow.x = damp(this.smoothFollow.x, this.target.x, l, dt);
      this.smoothFollow.y = damp(this.smoothFollow.y, this.target.y, l * 0.72, dt);
      this.smoothFollow.z = damp(this.smoothFollow.z, this.target.z, l, dt);
    }

    // 어깨 너머로 살짝 비켜선다 — 캐릭터가 화면 중앙을 가리지 않게.
    // 감쇠된 지점 위에 매 프레임 새로 얹는다 (누적되지 않는다).
    this.rightVec.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.smoothTarget
      .copy(this.smoothFollow)
      .addScaledVector(this.rightVec, CAMERA.shoulderOffset);

    // ---------------------------------------------------------- 궤도 위치
    const cp = Math.cos(this.pitch);
    this.offsetDir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);

    // ---------------------------------------------------------- 충돌
    const probe = this.distance + CAMERA.collisionPadding;
    const hitBoxes = this.colliders.raycast(this.smoothTarget, this.offsetDir, probe);
    const hitTerrain = this.terrain.raycast(this.smoothTarget, this.offsetDir, probe, 0.3);
    const nearest = Math.min(hitBoxes, hitTerrain);

    let allowed = this.distance;
    if (nearest < probe) {
      allowed = clamp(nearest - CAMERA.collisionPadding, CAMERA.distanceMin * 0.4, this.distance);
    }

    // 막힐 때는 즉시, 트일 때는 여유 있게
    const lambda = allowed < this.currentDistance ? CAMERA.collisionPullIn : CAMERA.collisionPushOut;
    this.currentDistance = damp(this.currentDistance, allowed, lambda, dt);

    this.desired.copy(this.smoothTarget).addScaledVector(this.offsetDir, this.currentDistance);

    // 지면을 뚫고 내려가지 않게 최소 높이를 보장한다
    const groundY = this.terrain.sampleHeight(this.desired.x, this.desired.z) + 0.42;
    if (this.desired.y < groundY) this.desired.y = groundY;

    this.camera.position.copy(this.desired);
    this.camera.lookAt(this.smoothTarget);

    // ---------------------------------------------------------- 화각
    // 달릴수록 넓어진다. 시야가 열리면서 속도가 몸으로 느껴진다.
    const wantFov = CAMERA.fov + this.runAmount * CAMERA.runFovBoost;
    const fov = damp(this.camera.fov, wantFov, CAMERA.fovDamping, dt);
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    // ---------------------------------------------------------- 흔들림
    //
    // 위치가 아니라 회전을 흔든다. 위치를 흔들면 벽을 뚫고 들어가지만
    // 회전은 충돌과 무관하고, 화면에서는 오히려 더 강하게 읽힌다.
    if (this.shake > 0.001) {
      this.shakeT += dt * 34;
      const s = this.shake * this.shake * CAMERA.shakeAmount;
      this.camera.rotateZ(Math.sin(this.shakeT * 1.7) * s);
      this.camera.rotateX(Math.sin(this.shakeT) * s * 0.8);
      this.shake = Math.max(0, this.shake - dt * CAMERA.shakeDecay);
    }
  }

  /** 스폰 직후 캐릭터 뒤를 바라보도록 초기화 */
  reset(playerPos: THREE.Vector3, yaw: number): void {
    this.yaw = yaw;
    this.yawTarget = yaw;
    this.pitch = 14 * DEG;
    this.pitchTarget = this.pitch;
    this.currentDistance = this.distance;
    this.initialized = false;
    this.smoothFollow.set(playerPos.x, playerPos.y + CAMERA.targetHeight, playerPos.z);
    this.smoothTarget.copy(this.smoothFollow);
  }
}
