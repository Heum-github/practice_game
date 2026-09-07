import * as THREE from 'three';
import { WATER_TOWER, WORLD } from '../config';
import { mergeBoxes, type BoxSpec } from '../util/geometry';
import { Rng } from '../util/math';
import { StructureShell } from './StructureShell';
import type { ColliderWorld } from './Collision';
import type { Terrain } from './Terrain';

/**
 * 급수탑 (기획서 5장 남은 우선순위 4 · v0.5 「세계」).
 *
 * 폐허 구조물 둘째. 온실이 흙을 준다면 여기는 **물**을 준다.
 *
 * 물은 이 게임에서 가장 자주 떨어지는 것이고, 웅덩이는 하룻밤에 조금씩만
 * 차서 한 자리에 눌러앉을 수 없다. 그래서 물 구하기는 늘 이동이 된다.
 * 급수탑은 그 이동을 **한 번의 먼 나들이**로 바꾼다.
 *
 * 다만 고인 물이라는 사실은 그대로다 — 끓이지 않으면 앓는다.
 * 물이 많아지는 것이지 안전해지는 것이 아니다.
 *
 * ── 첨탑과 겹치지 않게 ────────────────────────────────
 * 높은 것을 하나 더 세우면 멀리서 첨탑과 헷갈린다. 첨탑은 "오르는 것"이므로
 * 여기까지 올라갈 수 있게 보이면 걸어와서 헛걸음을 한다.
 * 그래서 **계단을 두지 않고**, 물탱크가 다리 위에서 터져 한쪽으로 주저앉은
 * 모습으로 세운다 — 실루엣부터 "오르는 것"이 아니라 "쏟아진 것"이어야 한다.
 */
export class WaterTower {
  readonly group = new THREE.Group();
  /** 웅덩이 한복판 — 나침반이 가리키는 지점 */
  readonly x = WATER_TOWER.x;
  readonly z = WATER_TOWER.z;

  constructor(terrain: Terrain, colliders: ColliderWorld) {
    this.group.name = 'waterTower';

    const cx = WATER_TOWER.x;
    const cz = WATER_TOWER.z;
    const rng = new Rng(WORLD.seed + 7717);

    const span = WATER_TOWER.legSpan;
    const shell = new StructureShell(terrain, colliders, cx, cz, span + 4, span + 4);
    const deck = shell.deck;

    const steel = new THREE.Color(0x6d7379);
    const rust = new THREE.Color(0x74462a);
    const dark = new THREE.Color(0x4a5057);
    const concrete = new THREE.Color(0x6a6a61);
    const water = new THREE.Color(0x4c6d78);

    const half = span / 2;
    const legTop = deck + WATER_TOWER.legHeight;

    // ---- 다리 넷. 밑동만 제 발밑까지 내려간다.
    const legs: Array<[number, number]> = [
      [cx - half, cz - half],
      [cx + half, cz - half],
      [cx - half, cz + half],
      [cx + half, cz + half],
    ];
    for (const [lx, lz] of legs) {
      shell.post(lx, lz, legTop, WATER_TOWER.legSide, steel);
    }

    // ---- 가새(빗장). 다리 넷만 서 있으면 탑이 아니라 젓가락 넷이다.
    //
    // 비스듬한 상자는 AABB 로 못 그리므로 층마다 수평 띠를 두른다.
    // 머리 위라 콜라이더는 주지 않는다 — 여기 걸리면 웅덩이에 못 들어간다.
    for (let level = 1; level <= 3; level++) {
      const y = deck + (WATER_TOWER.legHeight * level) / 3.4;
      for (const [ax, az, aw, ad] of [
        [cx, cz - half, span, 0.2],
        [cx, cz + half, span, 0.2],
        [cx - half, cz, 0.2, span],
        [cx + half, cz, 0.2, span],
      ] as Array<[number, number, number, number]>) {
        shell.push(ax, az, y, aw, 0.2, ad, level === 2 ? rust : steel);
      }
    }

    // ---- 물탱크. 한쪽 다리가 꺾여 기울어진 채 얹혀 있다.
    //
    // 원통은 축 정렬 상자로 못 만든다. 대신 **모서리를 깎은 팔각**으로 쌓으면
    // 로우폴리에서 통으로 읽힌다 — 넓은 몸통에 좁은 테를 위아래로 두른다.
    const tw = WATER_TOWER.tankWidth;
    const th = WATER_TOWER.tankHeight;
    const tilt = WATER_TOWER.tankTilt;
    // 기운 쪽(-X)이 내려앉아 있다. 층을 쌓으며 조금씩 낮춘다
    const tankBase = (fx: number): number => legTop - tilt * (0.5 - fx / tw);

    for (let i = 0; i < 4; i++) {
      const u = i / 3;
      const shrink = i === 0 || i === 3 ? 0.86 : 1; // 위아래는 접시처럼 좁다
      const y = tankBase(0) + th * u * 0.92;
      shell.push(cx, cz, y, tw * shrink, th * 0.3, tw * shrink, i === 1 ? steel : dark);
      // 팔각을 흉내내는 모서리 조각
      shell.push(cx, cz, y, tw * shrink * 0.72, th * 0.32, tw * shrink * 1.06, steel);
    }
    // 테 — 통에 두른 쇠띠. 이게 있어야 상자가 아니라 탱크로 보인다
    for (const hy of [0.18, 0.62]) {
      shell.push(cx, cz, tankBase(0) + th * hy, tw * 1.04, 0.22, tw * 0.8, rust);
      shell.push(cx, cz, tankBase(0) + th * hy, tw * 0.8, 0.22, tw * 1.04, rust);
    }

    // ---- 터진 자리. 여기서 물이 쏟아졌다는 것이 이 구조물의 전부다.
    //
    // 찢긴 철판이 아래로 늘어져 웅덩이를 가리킨다 — 눈이 위에서 아래로
    // 따라 내려가야 "저 물이 여기서 나왔다"가 한 장면에 담긴다.
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      shell.push(
        cx - tw * 0.5 - 0.1,
        cz + rng.range(-1.4, 1.4),
        tankBase(0) - t * 2.6,
        0.5 + rng.range(0, 0.5),
        1.1,
        0.34,
        rust,
      );
    }

    // ---- 웅덩이 바닥. 콘크리트 집수반이 깨진 채 남아 있다.
    //
    // 테두리만 두른다. 안을 막으면 물을 뜨러 들어갈 수가 없다 —
    // 그러면 물이 많은 것과 없는 것이 같아진다.
    const br = WATER_TOWER.basinRadius;
    const rimSegs = 14;
    for (let i = 0; i < rimSegs; i++) {
      // 한쪽은 깨져 열려 있다. 넘어 들어가는 문턱이 아니라 걸어 들어가는 입구다
      if (i >= 4 && i <= 6) continue;
      const a0 = (i / rimSegs) * Math.PI * 2;
      const a1 = ((i + 1) / rimSegs) * Math.PI * 2;
      const mx = cx + Math.cos((a0 + a1) / 2) * br;
      const mz = cz + Math.sin((a0 + a1) / 2) * br;
      const segLen = (Math.PI * 2 * br) / rimSegs;
      const alongX = Math.abs(Math.sin((a0 + a1) / 2)) > 0.7;
      const g = terrain.sampleHeight(mx, mz);
      shell.push(
        mx,
        mz,
        g - 0.4,
        alongX ? segLen * 1.1 : 0.8,
        0.75,
        alongX ? 0.8 : segLen * 1.1,
        concrete,
        true,
      );
    }

    const shellMesh = shell.build(
      'waterTower:frame',
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.72,
        metalness: 0.38,
        flatShading: true,
      }),
    );
    this.group.add(shellMesh);

    // ---- 고인 물의 면.
    //
    // 자원 노드(웅덩이)와 별개로, 집수반 바닥에 얕게 깔린 물이다. 노드만
    // 흩어 놓으면 "물이 대량으로 고여 있다"가 개수로만 남는다 — 한 장면에
    // 물바닥이 보여야 걸어 들어간 값이 눈에 찬다.
    //
    // 물은 금속이 아니다. metalness 를 올리면 알베도가 반사색이 되어 탁한
    // 금속판이 된다 — 0 으로 두고 거칠기만 낮춰야 프레넬이 산다 (8.3).
    const puddle: BoxSpec[] = [];
    for (let i = 0; i < 26; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.range(0, 1)) * (br - 0.9);
      const px = cx + Math.cos(a) * r;
      const pz = cz + Math.sin(a) * r;
      puddle.push({
        x: px,
        // 완벽히 평평한 반사면은 칠한 판으로 보인다. 2cm 만 흔들어도 반사가 부서진다
        y: terrain.sampleHeight(px, pz) + 0.05 + rng.range(0, 0.02),
        z: pz,
        w: rng.range(2.2, 3.8),
        h: 0.06,
        d: rng.range(2.2, 3.8),
        color: water,
      });
    }
    const puddleMesh = new THREE.Mesh(
      mergeBoxes(puddle),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        metalness: 0,
        roughness: 0.07,
        envMapIntensity: 1.6,
        transparent: true,
        opacity: 0.72,
      }),
    );
    puddleMesh.name = 'waterTower:puddle';
    puddleMesh.receiveShadow = true;
    this.group.add(puddleMesh);
  }

  /** 웅덩이까지의 평면 거리 */
  distanceTo(x: number, z: number): number {
    return Math.hypot(this.x - x, this.z - z);
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
