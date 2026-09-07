import * as THREE from 'three';
import { Rng } from '../util/math';
import { mergeBoxes, type BoxSpec } from '../util/geometry';

/**
 * 지평선 너머의 도시.
 *
 * 월드는 200m 각이고 그 바깥은 아무것도 없다. 그래서 어느 방향을 봐도
 * 결국 빈 하늘에 닿는다 — 세계가 딱 이만큼이라는 게 눈에 보인다.
 *
 * 실제로 갈 수 있는 곳을 넓히는 건 다른 문제다. 여기서 하려는 건
 * "저 너머에도 무언가 있다"는 인상뿐이므로, 걸어갈 수 없는 먼 거리에
 * 실루엣만 세운다. 충돌도 그림자도 없다 — 보이기만 하면 된다.
 *
 * 안개가 대부분을 먹어치우기 때문에 형태는 단순해도 된다.
 * 중요한 건 높이의 들쭉날쭉함이다. 그것만으로 도시로 읽힌다.
 */

/**
 * 실루엣이 서는 고리의 안쪽·바깥쪽 반지름 (m).
 *
 * 고리를 월드 원점에 고정하면, 플레이어가 한쪽 끝으로 걸어갔을 때
 * 그쪽 실루엣이 코앞에 온다 — 실제로 화면을 가릴 만큼 커졌다.
 * 그래서 고리를 플레이어를 따라 옮긴다. 배경은 다가갈 수 있는 것이 아니다.
 */
const INNER = 150;
const OUTER = 205;

export class Skyline {
  readonly mesh: THREE.Mesh;
  readonly count: number;

  constructor(seed: number) {
    const rng = new Rng(seed ^ 0x5171);
    const boxes: BoxSpec[] = [];

    // 색은 하나로 두되 미세하게 흔든다. 안개에 묻힐 것이라 대비는 필요 없다.
    const base = new THREE.Color(0x2f3742);

    // 고리를 따라 촘촘히 세운다. 뒤쪽 열일수록 크고 낮게 깔린다.
    const rings = 3;
    for (let r = 0; r < rings; r++) {
      const t = r / (rings - 1 || 1);
      const radius = INNER + (OUTER - INNER) * t;
      // 반지름이 커지면 둘레도 커지므로 개수도 늘린다
      const n = Math.round(52 + t * 46);

      for (let i = 0; i < n; i++) {
        // 빈틈 — 빠짐없이 채우면 도시가 아니라 성벽으로 보인다
        if (rng.chance(0.28)) continue;
        const a = (i / n) * Math.PI * 2 + rng.range(-0.03, 0.03);
        const rr = radius * rng.range(0.93, 1.07);
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;

        // 멀수록 낮게 — 원근으로 자연히 낮아지는 것 위에 한 번 더 눌러
        // 여러 겹이 겹쳐 보이게 한다
        // 월드 경계의 잔해 둔덕(약 11m)이 시야를 막는다.
        // 그 위로 머리를 내밀지 못하면 아무리 세워도 보이지 않는다 —
        // 실제로 처음엔 통째로 가려져서 있으나 마나였다.
        const h = rng.range(48, 125) * (1 - t * 0.22);
        const w = rng.range(9, 26);
        const d = rng.range(9, 26);

        // 지평선 아래로 밑동을 묻어 지면과의 이음새를 감춘다
        const y = h / 2 - 8;

        const c = base.clone().multiplyScalar(rng.range(0.86, 1.14));
        boxes.push({ x, y, z, w, h, d, color: c });

        // 일부는 위에 한 단을 더 얹어 실루엣을 부순다
        if (rng.chance(0.35)) {
          boxes.push({
            x: x + rng.range(-w * 0.2, w * 0.2),
            y: y + h / 2 + rng.range(2, 9),
            z: z + rng.range(-d * 0.2, d * 0.2),
            w: w * rng.range(0.35, 0.7),
            h: rng.range(8, 30),
            d: d * rng.range(0.35, 0.7),
            color: c.clone().multiplyScalar(0.92),
          });
        }
      }
    }

    const geo = mergeBoxes(boxes);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      // 실루엣이므로 빛을 거의 받지 않아도 된다. 안개가 색을 정한다.
      flatShading: true,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'skyline';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // 월드 전체를 감싸는 고리라 잘라낼 여지가 거의 없다
    this.mesh.frustumCulled = false;
    this.count = boxes.length;
  }

  /**
   * 배경을 시점 위에 다시 얹는다.
   * y 는 건드리지 않는다 — 높이까지 따라오면 언덕을 오를 때 같이 솟는다.
   */
  follow(x: number, z: number): void {
    this.mesh.position.x = x;
    this.mesh.position.z = z;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
