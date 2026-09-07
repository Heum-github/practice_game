import * as THREE from 'three';
import { MAST } from '../config';
import { mergeBoxes, type BoxSpec } from '../util/geometry';
import type { Aabb, ColliderWorld } from './Collision';
import type { Terrain } from './Terrain';

/**
 * 관측 첨탑 (기획서 3.8 · v0.5 「세계」).
 *
 * v0.5의 검증 질문은 "탐험할 이유가 있는가"다. 처음에는 월드를 넓힐 생각이었는데,
 * 세어 보니 200m 도 이미 다 돌아볼 이유가 없어서 안 도는 것이지 좁아서 도는 게
 * 아니었다. 넓이는 답이 아니다.
 *
 * 그래서 **탐험의 보상을 다음 탐험으로** 만들었다. 꼭대기에 오르면 그 일대의
 * 흙과 기록 단말이 나침반에 박힌다 — 한 번 오른 곳은 다시 헤매지 않으므로,
 * 멀리 갈수록 세계가 읽히기 시작한다. 걷는 일이 곧 지도를 만드는 일이 된다.
 *
 * 오르는 것 자체가 관문이다. 계단은 기둥을 한 바퀴 감아 올라가고, 챌면은
 * 0.32m 라 발이 걸리지 않는다 — 어렵게 만들 이유가 없다. 시간이 드는 것으로 충분하다.
 * 밤에 오르면 밑에서 뭔가 올려다보고 있을 수도 있다는 것이 값이다.
 */
export interface Mast {
  x: number;
  z: number;
  /** 꼭대기 발판의 월드 Y */
  topY: number;
  surveyed: boolean;
}

export class SurveyMast {
  readonly group = new THREE.Group();
  readonly masts: Mast[] = [];

  constructor(terrain: Terrain, colliders: ColliderWorld) {
    this.group.name = 'surveyMasts';

    const concrete = new THREE.Color(0x6f6e65);
    const dark = new THREE.Color(0x54534d);
    const metal = new THREE.Color(0x4d545b);
    const band = new THREE.Color(0x9aa86a);

    const boxes: BoxSpec[] = [];
    const push = (
      x: number,
      z: number,
      base: number,
      w: number,
      h: number,
      d: number,
      color: THREE.Color,
      collide = true,
    ): void => {
      boxes.push({ x, y: base + h / 2, z, w, h, d, color });
      if (!collide) return;
      colliders.add({
        minX: x - w / 2,
        maxX: x + w / 2,
        minY: base,
        maxY: base + h,
        minZ: z - d / 2,
        maxZ: z + d / 2,
      } satisfies Aabb);
    };

    for (const spot of MAST.spots) {
      const g = terrain.sampleHeight(spot.x, spot.z);
      const c = MAST.core;
      const h = MAST.height;

      // 기둥 — 계단이 감아 도는 심
      push(spot.x, spot.z, g - 1, c, h + 1, c, concrete);

      // 계단.
      //
      // 사각 경로를 네 변으로 나눠 축 정렬 상자만 쓴다. 비스듬한 상자는
      // AABB 콜라이더로 표현할 수 없어서, 보이는 것과 밟히는 것이 어긋난다.
      const r = MAST.stairRadius;
      const n = MAST.steps;
      const rise = h / n;
      const perSide = n / 4;
      const run = (r * 2) / perSide;

      for (let i = 0; i < n; i++) {
        const side = Math.floor(i / perSide) % 4;
        const t = (i % perSide) + 0.5;
        const along = -r + run * t;
        // 0: +Z 변을 +X 로, 1: +X 변을 -Z 로, 2: -Z 변을 -X 로, 3: -X 변을 +Z 로
        const sx = side === 0 ? along : side === 1 ? r : side === 2 ? -along : -r;
        const sz = side === 0 ? r : side === 1 ? -along : side === 2 ? -r : along;
        const alongX = side === 0 || side === 2;

        const stepBase = g + i * rise;
        push(
          spot.x + sx,
          spot.z + sz,
          stepBase,
          alongX ? run * 1.06 : 1.5,
          rise + 0.14,
          alongX ? 1.5 : run * 1.06,
          i % 2 === 0 ? concrete : dark,
        );
      }

      // 꼭대기 발판.
      //
      // **계단보다 안쪽에 둔다.** 처음에는 계단을 덮을 만큼 넓게 깔았는데,
      // 그러면 위쪽 일곱 칸이 발판 밑을 지나게 되어 머리가 천장에 막힌다 —
      // 계단은 멀쩡히 보이는데 도중에 더 못 올라가는, 눈으로는 안 보이는 사고다.
      // 계단 반지름(3.3)보다 안으로 물리면 몸이 어디서도 겹치지 않는다.
      const half = MAST.platformHalf;
      const topBase = g + h + 0.14; // 마지막 디딤면과 같은 높이
      push(spot.x, spot.z, topBase, half * 2, 0.3, half * 2, dark);

      // 난간 — 없으면 발판이 아니라 그냥 뚜껑으로 보인다 (충돌은 주지 않는다,
      // 여기서 떨어지는 것도 이 첨탑의 일부다)
      const rr = half;
      for (const [rx, rz, rw, rd] of [
        [0, rr, rr * 2, 0.14],
        [0, -rr, rr * 2, 0.14],
        [rr, 0, 0.14, rr * 2],
        [-rr, 0, 0.14, rr * 2],
      ] as Array<[number, number, number, number]>) {
        push(spot.x + rx, spot.z + rz, topBase + 0.3, rw, 0.9, rd, metal, false);
      }

      // 꼭대기 표지 — 멀리서도 "저기가 올라갈 수 있는 곳"으로 읽혀야 한다
      push(spot.x, spot.z, topBase + 1.2, 0.5, 1.8, 0.5, metal, false);
      push(spot.x, spot.z, topBase + 3.0, 1.6, 0.34, 1.6, band, false);

      this.masts.push({ x: spot.x, z: spot.z, topY: topBase + 0.3, surveyed: false });
    }

    const mesh = new THREE.Mesh(
      mergeBoxes(boxes),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true }),
    );
    mesh.name = 'mast';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /**
   * 지금 어느 첨탑 꼭대기에 서 있는가. 없으면 -1.
   *
   * 높이를 함께 보는 것이 요점이다 — 밑동에 서 있는 것과 꼭대기에 오른 것을
   * 가르지 않으면 첨탑은 그냥 "지나가면 켜지는 스위치"가 된다.
   */
  standingOn(x: number, y: number, z: number): number {
    for (let i = 0; i < this.masts.length; i++) {
      const m = this.masts[i]!;
      if (Math.hypot(m.x - x, m.z - z) > MAST.stairRadius + 1.4) continue;
      if (Math.abs(y - m.topY) > MAST.topBand) continue;
      return i;
    }
    return -1;
  }

  /** 세이브·계승에서 이미 훑어둔 첨탑을 되살린다 */
  restore(indices: readonly number[]): void {
    for (const m of this.masts) m.surveyed = false;
    for (const i of indices) {
      const m = this.masts[i];
      if (m) m.surveyed = true;
    }
  }

  serialize(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.masts.length; i++) if (this.masts[i]!.surveyed) out.push(i);
    return out;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
