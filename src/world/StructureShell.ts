import * as THREE from 'three';
import { mergeBoxes, type BoxSpec } from '../util/geometry';
import type { Aabb, ColliderWorld } from './Collision';
import type { Terrain } from './Terrain';

/**
 * 손으로 세운 구조물의 껍데기를 굽는 도구 (기획서 8.3).
 *
 * 온실·급수탑·격납고가 같은 함정을 공유한다 — **건물은 딱딱한데 땅은 아니다.**
 * 중심 한 점의 높이로 통째로 앉히면 기복이 3m 인 자리에서 한쪽 벽은 완전히
 * 파묻히고 반대쪽은 허공에 뜬다. 화면에는 건물이 통째로 안 보이고, 콜라이더는
 * 땅속이라 벽을 그냥 통과한다. 눈으로는 절대 안 잡히는 종류다.
 *
 * 그 규칙을 세 곳에 베껴 적으면 네 번째 구조물에서 반드시 어긋난다.
 * 여기 한 번만 적어 두고 전부 이걸 통해 세운다 —
 * **뼈대는 deck 에 수평으로 고정, 땅에 닿는 것만 구간마다 제 발밑을 다시 잰다.**
 */
export class StructureShell {
  private readonly boxes: BoxSpec[] = [];

  /** 뼈대를 앉힐 기준 높이 — 발자국 안의 가장 높은 지점 */
  readonly deck: number;

  constructor(
    private readonly terrain: Terrain,
    private readonly colliders: ColliderWorld,
    cx: number,
    cz: number,
    width: number,
    depth: number,
  ) {
    this.deck = terrain.deckHeight(cx, cz, width, depth);
  }

  /**
   * 상자 하나.
   * @param base 상자 **바닥**의 월드 Y
   * @param collide 몸을 막을지. 머리 위(들보·지붕)에는 주지 않는다 —
   *   걸어다닐 수 없게 되고, 그건 화면으로는 안 보이는 사고다
   */
  push(
    x: number,
    z: number,
    base: number,
    w: number,
    h: number,
    d: number,
    color: THREE.Color,
    collide = false,
  ): void {
    if (h <= 0 || w <= 0 || d <= 0) return;
    this.boxes.push({ x, y: base + h / 2, z, w, h, d, color });
    if (!collide) return;
    this.colliders.add({
      minX: x - w / 2,
      maxX: x + w / 2,
      minY: base,
      maxY: base + h,
      minZ: z - d / 2,
      maxZ: z + d / 2,
    } satisfies Aabb);
  }

  /**
   * 땅에 닿는 벽 한 줄.
   *
   * 윗변은 `top` 에 맞춰 수평으로 두고 **아랫변만 구간마다 지면을 따라 내려간다.**
   * 경사에서는 기초가 그만큼 깊어질 뿐, 뜨거나 파묻히지 않는다.
   * (폐허의 `wall()` 이 이미 같은 방식으로 벽을 쪼갠다.)
   */
  wallRun(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    thickness: number,
    top: number,
    color: THREE.Color,
    collide = true,
  ): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.01) return;
    const n = Math.max(1, Math.round(len / 2));
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const seg = (len / n) * 1.04;

    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const sx = x0 + (x1 - x0) * u;
      const sz = z0 + (z1 - z0) * u;
      // 제 발밑보다 조금 더 내려가야 지면과의 틈이 안 보인다
      const base = Math.min(this.terrain.sampleHeight(sx, sz) - 0.35, top - 0.2);
      this.push(
        sx,
        sz,
        base,
        alongX ? seg : thickness,
        top - base,
        alongX ? thickness : seg,
        color,
        collide,
      );
    }
  }

  /** 땅에 발을 딛는 기둥 — 밑동만 지면까지 내려간다 */
  post(x: number, z: number, top: number, side: number, color: THREE.Color, collide = true): void {
    const base = this.terrain.sampleHeight(x, z) - 0.3;
    this.push(x, z, base, side, top - base, side, color, collide);
  }

  /** 지금까지 담은 상자를 하나의 메시로 굽는다 */
  build(name: string, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(mergeBoxes(this.boxes), material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}
