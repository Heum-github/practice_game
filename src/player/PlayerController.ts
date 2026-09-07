import * as THREE from 'three';
import { PLAYER } from '../config';
import { Input } from '../core/Input';
import { Terrain } from '../world/Terrain';
import { ColliderSet, type Aabb } from '../world/Collision';
import { PlayerCharacter } from './PlayerCharacter';
import type { GroundProbe } from './PlayerCharacter';
import { DEG, dampAngle } from '../util/math';

const EPS = 1e-4;

/** 캐릭터가 진행 방향으로 돌아서는 속도. 낮출수록 부드럽고 높일수록 즉각적이다 */
const FACING_DAMPING = 9;
/** 서 있을 때 몸을 돌리지 않고 시선만 줄 수 있는 각도 (rad, 약 65도) */
const TURN_DEADZONE = 1.13;
/** 제자리 회전 속도 */
const TURN_DAMPING = 7;

/**
 * 캐릭터 이동 물리.
 *
 * 충돌은 축 분리(axis-separated) 방식이다. Y → X → Z 순으로 각각 움직이고
 * 파고든 만큼만 밀어낸다. 잔해 위로 올라설 수 있도록 step-up 재시도가 붙어 있고,
 * 지형은 AABB가 아니라 높이 함수로 직접 처리한다.
 */
export class PlayerController {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly character = new PlayerCharacter();

  grounded = false;
  sliding = false;
  /** 캐릭터가 바라보는 방향 (rad) */
  facing = 0;
  /** 제자리에서 도는 각속도 (rad/s) — 발을 옮기는 모션에 쓴다 */
  turnRate = 0;
  /**
   * 몸 상태가 만드는 속도 배수 (1 = 성한 몸).
   * 포자병에 걸리면 여기가 떨어진다 — 아프면 자원을 구하러 가는 것부터 느려진다.
   */
  speedScale = 1;
  /** 마지막으로 받은 카메라 방향 */
  private cameraYaw = 0;

  private readonly terrain: Terrain;

  /** 캐릭터에게 지면을 알려주는 창구 */
  private readonly groundProbe: GroundProbe = {
    heightAt: (x, z) => this.terrain.sampleHeight(x, z),
    slope: 0,
  };
  private readonly colliders: ColliderSet;

  private coyote = 0;
  private jumpBuffered = 0;
  /** 이번 스텝에 이동 입력이 있었는지 — 방향 전환의 기준이 된다 */
  private hasWish = false;
  private groundNormal = new THREE.Vector3(0, 1, 0);

  // 재사용 임시 객체 — 매 프레임 할당을 피한다
  private readonly candidates: Aabb[] = [];
  private readonly tmpNormal = new THREE.Vector3();
  private readonly wish = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  constructor(terrain: Terrain, colliders: ColliderSet) {
    this.terrain = terrain;
    this.colliders = colliders;
    this.character.object.position.copy(this.position);
  }

  /** 지정 위치의 지면 위에 세운다 */
  spawn(x: number, z: number): void {
    this.position.set(x, this.terrain.sampleHeight(x, z) + 0.05, z);
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this.facing = 0;
  }

  get eyePosition(): THREE.Vector3 {
    return new THREE.Vector3(
      this.position.x,
      this.position.y + PLAYER.eyeHeight,
      this.position.z,
    );
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  // ---------------------------------------------------------------- 프레임 갱신

  /**
   * 물리 한 스텝. 고정 간격으로 여러 번 호출될 수 있다.
   * @param jumpPressed 이번 프레임에 점프가 새로 눌렸는지 (첫 서브스텝에만 true)
   */
  step(dt: number, input: Input, cameraYaw: number, jumpPressed: boolean): void {
    this.applyInput(dt, input, cameraYaw, jumpPressed);
    this.applyGravity(dt);
    this.integrate(dt);
    this.updateFacing(dt);

    // 월드 밖으로 나가지 못하게 막는다
    this.terrain.clampToWorld(this.position, 3);

    // 어딘가에 끼어 바닥 아래로 떨어졌을 때의 안전장치
    if (this.position.y < -60) this.spawn(0, 0);
  }

  /** 시각 표현 갱신 — 프레임당 한 번, 실제 프레임 시간으로 호출한다 */
  updateVisual(dt: number, headPitch: number): void {
    this.character.object.position.copy(this.position);
    this.character.object.rotation.y = this.facing;
    this.character.setHeadPitch(headPitch);

    // 진행 방향의 경사를 잰다.
    //
    // 평면의 높이 기울기는 (-n.x/n.y, -n.z/n.y) 이므로, 바라보는 방향으로
    // 내적하면 그 방향의 기울기가 나온다. 오르막이 양수다.
    this.terrain.sampleNormal(this.position.x, this.position.z, this.groundNormal);
    const fx = Math.sin(this.facing);
    const fz = Math.cos(this.facing);
    const n = this.groundNormal;
    const slope = -(n.x * fx + n.z * fz) / Math.max(0.25, n.y);
    this.groundProbe.slope = slope;

    // 제자리에서 돌 때도 다리가 움직여야 한다.
    // 회전 각속도를 작은 "속력"으로 바꿔 넣으면 기존 보행 모델이
    // 알아서 종종걸음을 만들어낸다 — 별도 모션을 만들 필요가 없다.
    const shuffle = Math.min(this.turnRate * 0.5, PLAYER.walkSpeed * 0.42);
    this.character.update(
      dt,
      Math.max(this.horizontalSpeed, shuffle),
      PLAYER.walkSpeed,
      this.grounded,
      this.velocity.y,
      this.groundProbe,
    );
  }

  private applyInput(dt: number, input: Input, cameraYaw: number, jumpPressed: boolean): void {
    this.cameraYaw = cameraYaw;
    const axis = input.moveAxis();

    // 카메라 기준 이동 방향
    this.fwd.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    this.right.set(-this.fwd.z, 0, this.fwd.x);

    this.wish
      .set(0, 0, 0)
      .addScaledVector(this.fwd, axis.z)
      .addScaledVector(this.right, axis.x);

    const hasInput = this.wish.lengthSq() > EPS;
    if (hasInput) this.wish.normalize();
    this.hasWish = hasInput;

    const sprinting = input.isDown('sprint') && axis.z > 0;
    const maxSpeed = (sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed) * this.speedScale;

    const control = this.grounded ? 1 : PLAYER.airControl;
    const accel = PLAYER.groundAccel * control;
    const decel = PLAYER.groundDecel * control;

    if (hasInput) {
      const tx = this.wish.x * maxSpeed;
      const tz = this.wish.z * maxSpeed;
      this.velocity.x = approach(this.velocity.x, tx, accel * dt);
      this.velocity.z = approach(this.velocity.z, tz, accel * dt);
    } else {
      this.velocity.x = approach(this.velocity.x, 0, decel * dt);
      this.velocity.z = approach(this.velocity.z, 0, decel * dt);
    }

    // 가파른 경사에서는 아래로 미끄러진다
    if (this.sliding) {
      const n = this.groundNormal;
      const slideAccel = 16;
      this.velocity.x += n.x * slideAccel * dt;
      this.velocity.z += n.z * slideAccel * dt;
    }

    // ---- 점프: 코요테 타임 + 입력 선행 버퍼
    this.coyote = this.grounded ? PLAYER.coyoteTime : Math.max(0, this.coyote - dt);
    this.jumpBuffered = jumpPressed
      ? PLAYER.jumpBuffer
      : Math.max(0, this.jumpBuffered - dt);

    if (this.jumpBuffered > 0 && this.coyote > 0 && !this.sliding) {
      this.velocity.y = PLAYER.jumpSpeed;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffered = 0;
    }
  }

  private applyGravity(dt: number): void {
    const g = this.velocity.y < 0 ? PLAYER.gravity * PLAYER.fallGravityMult : PLAYER.gravity;
    this.velocity.y = Math.max(this.velocity.y - g * dt, -PLAYER.maxFallSpeed);
  }

  private integrate(dt: number): void {
    const wasGrounded = this.grounded;
    this.grounded = false;
    this.moveVertical(this.velocity.y * dt);
    this.moveHorizontal(this.velocity.x * dt, this.velocity.z * dt);
    this.snapToGround(wasGrounded);
    this.evaluateGroundSlope();
  }

  /**
   * 내리막에서 지면에 다시 붙인다.
   *
   * 순간이동시키지 않고 moveVertical 로 내려보낸다 —
   * 중간에 구조물이 있으면 거기서 멈추는 판정을 그대로 쓰기 위해서다.
   */
  private snapToGround(wasGrounded: boolean): void {
    // 원래 떠 있었거나 뛰어오르는 중이면 붙이지 않는다
    if (!wasGrounded || this.grounded || this.velocity.y > 0.1) return;

    const groundY = this.terrain.sampleHeight(this.position.x, this.position.z);
    const drop = this.position.y - groundY;
    if (drop <= 0.001 || drop > PLAYER.groundSnap) return;

    this.moveVertical(-drop);
  }

  // ---------------------------------------------------------------- 충돌

  /** 현재 위치의 플레이어 AABB */
  private playerBox(out: Aabb, x = this.position.x, y = this.position.y, z = this.position.z): Aabb {
    const r = PLAYER.radius;
    out.minX = x - r;
    out.maxX = x + r;
    out.minY = y;
    out.maxY = y + PLAYER.height;
    out.minZ = z - r;
    out.maxZ = z + r;
    return out;
  }

  private readonly boxA: Aabb = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

  private queryAround(): Aabb[] {
    const b = this.playerBox(this.boxA);
    // 한 프레임 이동량을 감안해 조금 넓게 잡는다
    return this.colliders.query(b.minX - 1, b.minZ - 1, b.maxX + 1, b.maxZ + 1, this.candidates);
  }

  private overlapsAny(list: Aabb[]): boolean {
    const p = this.playerBox(this.boxA);
    for (const b of list) {
      if (
        p.minX < b.maxX - EPS &&
        p.maxX > b.minX + EPS &&
        p.minY < b.maxY - EPS &&
        p.maxY > b.minY + EPS &&
        p.minZ < b.maxZ - EPS &&
        p.maxZ > b.minZ + EPS
      ) {
        return true;
      }
    }
    return false;
  }

  private moveVertical(dy: number): void {
    this.position.y += dy;
    const list = this.queryAround();
    const p = this.playerBox(this.boxA);

    for (const b of list) {
      if (
        p.minX >= b.maxX || p.maxX <= b.minX ||
        p.minZ >= b.maxZ || p.maxZ <= b.minZ ||
        p.minY >= b.maxY || p.maxY <= b.minY
      ) {
        continue;
      }

      if (dy <= 0) {
        // 낙하 중 → 상자 윗면에 올라선다
        this.position.y = b.maxY;
        this.velocity.y = 0;
        this.grounded = true;
      } else {
        // 상승 중 → 천장에 머리를 부딪친다
        this.position.y = b.minY - PLAYER.height;
        this.velocity.y = 0;
      }
      this.playerBox(p);
    }

    // 지형
    const groundY = this.terrain.sampleHeight(this.position.x, this.position.z);
    if (this.position.y <= groundY) {
      this.position.y = groundY;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    }
  }

  /** X, Z를 따로 밀어내고, 막히면 턱을 넘어보는 재시도를 한 번 한다 */
  private moveHorizontal(dx: number, dz: number): void {
    const desired = Math.hypot(dx, dz);
    if (desired < EPS) return;

    const startX = this.position.x;
    const startY = this.position.y;
    const startZ = this.position.z;

    this.sweepXZ(dx, dz);

    const moved = Math.hypot(this.position.x - startX, this.position.z - startZ);
    if (!this.grounded || moved >= desired - 0.001) return;

    // 막혔다 — 발판 높이만큼 올려서 다시 시도
    const blockedX = this.position.x;
    const blockedZ = this.position.z;

    this.position.set(startX, startY + PLAYER.stepHeight, startZ);
    const list = this.queryAround();

    if (!this.overlapsAny(list)) {
      this.sweepXZ(dx, dz);
      const moved2 = Math.hypot(this.position.x - startX, this.position.z - startZ);
      if (moved2 > moved + 0.005) {
        this.snapDown(PLAYER.stepHeight + 0.08);
        return;
      }
    }

    // 실패 → 막힌 위치로 되돌린다
    this.position.set(blockedX, startY, blockedZ);
  }

  private sweepXZ(dx: number, dz: number): void {
    this.position.x += dx;
    this.resolveAxis('x', dx);
    this.position.z += dz;
    this.resolveAxis('z', dz);
  }

  private resolveAxis(axis: 'x' | 'z', delta: number): void {
    if (Math.abs(delta) < EPS) return;
    const list = this.queryAround();
    const p = this.playerBox(this.boxA);

    for (const b of list) {
      if (
        p.minX >= b.maxX || p.maxX <= b.minX ||
        p.minY >= b.maxY || p.maxY <= b.minY ||
        p.minZ >= b.maxZ || p.maxZ <= b.minZ
      ) {
        continue;
      }

      if (axis === 'x') {
        this.position.x = delta > 0 ? b.minX - PLAYER.radius : b.maxX + PLAYER.radius;
        this.velocity.x = 0;
      } else {
        this.position.z = delta > 0 ? b.minZ - PLAYER.radius : b.maxZ + PLAYER.radius;
        this.velocity.z = 0;
      }
      this.playerBox(p);
    }
  }

  /** 올라선 뒤 발밑의 지지면으로 내려붙인다 */
  private snapDown(maxDrop: number): void {
    const list = this.queryAround();
    const p = this.playerBox(this.boxA);

    let support = this.terrain.sampleHeight(this.position.x, this.position.z);

    for (const b of list) {
      if (p.minX >= b.maxX || p.maxX <= b.minX) continue;
      if (p.minZ >= b.maxZ || p.maxZ <= b.minZ) continue;
      if (b.maxY <= this.position.y + 0.02 && b.maxY > support) support = b.maxY;
    }

    if (this.position.y - support <= maxDrop && support <= this.position.y) {
      this.position.y = support;
      this.grounded = true;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }
  }

  /** 서 있는 면의 기울기를 평가해 미끄러짐 여부를 정한다 */
  private evaluateGroundSlope(): void {
    if (!this.grounded) {
      this.sliding = false;
      return;
    }

    const groundY = this.terrain.sampleHeight(this.position.x, this.position.z);
    // 상자 위에 서 있으면 평면으로 취급한다
    const onTerrain = Math.abs(this.position.y - groundY) < 0.05;
    if (!onTerrain) {
      this.groundNormal.set(0, 1, 0);
      this.sliding = false;
      return;
    }

    this.terrain.sampleNormal(this.position.x, this.position.z, this.tmpNormal);
    this.groundNormal.copy(this.tmpNormal);
    this.sliding = this.tmpNormal.y < Math.cos(PLAYER.maxSlopeDeg * DEG);
  }

  // ---------------------------------------------------------------- 방향

  /**
   * 캐릭터가 바라보는 방향.
   *
   * 속도가 아니라 **입력 방향**을 기준으로 삼는다.
   * 시점을 빠르게 돌리면 속도 벡터가 목표 방향을 향해 크게 휘둘리는데,
   * 그 과도기의 속도로 방향을 정하면 캐릭터가 좌우로 휘청거린다.
   * 입력 방향은 카메라 각도만 따라가므로 훨씬 안정적이다.
   */
  private updateFacing(dt: number): void {
    let tx: number;
    let tz: number;

    if (this.hasWish) {
      tx = this.wish.x;
      tz = this.wish.z;
    } else {
      // 입력을 놓은 뒤 미끄러지는 동안에는 진행 방향을 유지한다
      if (this.horizontalSpeed < 0.4) {
        this.turnInPlace(dt);
        return;
      }
      tx = this.velocity.x;
      tz = this.velocity.z;
    }
    this.turnRate = 0;

    const target = Math.atan2(tx, tz);
    this.facing = dampAngle(this.facing, target, FACING_DAMPING, dt);
  }

  /**
   * 제자리 회전.
   *
   * 서 있는 동안 facing 을 아예 건드리지 않으면, 시점을 뒤로 돌려도 몸은
   * 앞을 본 채 목만 돌아간 그림이 된다. 사람은 그 자세로 서 있지 않는다.
   *
   * 다만 시선을 조금 움직일 때마다 몸이 따라 돌면 부산스럽다.
   * 어깨 너머로 볼 수 있는 각도(사각지대)를 두고, 그걸 넘어설 때만 발을 옮긴다.
   */
  private turnInPlace(dt: number): void {
    let d = this.cameraYaw - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));

    if (Math.abs(d) < TURN_DEADZONE) {
      this.turnRate = 0;
      return;
    }

    // 사각지대 경계까지만 따라간다 — 정면으로 딱 맞추면 계속 미세하게 흔들린다
    const target = this.cameraYaw - Math.sign(d) * TURN_DEADZONE * 0.55;
    const before = this.facing;
    this.facing = dampAngle(this.facing, target, TURN_DAMPING, dt);

    let moved = this.facing - before;
    moved = Math.atan2(Math.sin(moved), Math.cos(moved));
    this.turnRate = Math.abs(moved) / Math.max(dt, 1e-4);
  }
}

/** current를 target 쪽으로 최대 maxDelta만큼 이동시킨다 */
function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}
