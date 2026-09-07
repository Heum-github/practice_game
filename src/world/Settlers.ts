import * as THREE from 'three';
import { FARM, SETTLEMENT } from '../config';
import { mergeBoxes } from '../util/geometry';
import { Rng } from '../util/math';
import type { Terrain } from './Terrain';
import { Buildings } from './Buildings';

/**
 * 정착지에 모여든 생존자 (기획서 3.5).
 *
 * "생존 NPC가 유입되어 자동 노동력이 된다"는 한 줄이 이 파일 전부다.
 * 다만 자동 노동력을 **얼마나** 줄 것인가가 설계의 전부이기도 하다.
 *
 * 너무 많이 주면 플레이어가 할 일이 사라져 게임이 저절로 굴러가고,
 * 너무 적게 주면 등급을 올릴 이유가 없다. 그래서 생존자는
 * **밀린 집안일만** 한다 — 마른 밭에 물을 주고, 사위는 불에 풀을 넣는다.
 * 새로 짓거나 캐지는 않는다. 거점을 넓히는 것은 여전히 플레이어의 몫이고,
 * 생존자는 "자리를 비워도 무너지지 않는다"만 보장한다.
 *
 * 그리고 **먹는다.** 사람이 늘면 입도 는다 — 공짜 노동력이 아니라
 * 밭을 더 늘려야 할 이유다.
 *
 * 몸은 플레이어 리그를 쓰지 않는다. 그쪽은 부품이 69개라 다섯만 세워도
 * 드로우콜이 300을 넘는다. 여기서는 상자를 합쳐 구운 덩어리 하나면 충분하다 —
 * 멀리서 "사람이 있다"로 읽히면 그만이다.
 */

interface Settler {
  x: number;
  z: number;
  y: number;
  facing: number;
  /** 배회 목표 */
  goalX: number;
  goalZ: number;
  goalTimer: number;
  /** 다음 집안일까지 */
  workTimer: number;
  /** 걷는 위상 — 몸이 위아래로 흔들린다 */
  bob: number;
}

/** 한 번에 세울 수 있는 수 (등급 상한과 같다) */
const MAX_SETTLERS = 8;

export class Settlers {
  readonly group = new THREE.Group();

  private readonly list: Settler[] = [];
  private readonly rng = new Rng(0x5e77);
  private mesh!: THREE.InstancedMesh;

  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();

  /** 화면에 띄울 일감 알림 */
  private readonly notices: string[] = [];

  constructor(
    private readonly terrain: Terrain,
    private readonly buildings: Buildings,
  ) {
    this.group.name = 'settlers';
    this.buildMesh();
  }

  get count(): number {
    return this.list.length;
  }

  takeNotice(): string | null {
    return this.notices.shift() ?? null;
  }

  /**
   * 생존자 하나 — 상자를 합쳐 구운 덩어리.
   * 플레이어와 헷갈리지 않게 색을 낮추고 어깨에 짐을 얹었다.
   */
  private buildMesh(): void {
    const coat = new THREE.Color(0x6b6250);
    const dark = new THREE.Color(0x413c33);
    const skin = new THREE.Color(0x8a7358);
    const pack = new THREE.Color(0x7a6440);

    const geo = mergeBoxes([
      // 다리
      { x: -0.11, y: 0.36, z: 0, w: 0.16, h: 0.72, d: 0.17, color: dark },
      { x: 0.11, y: 0.36, z: 0, w: 0.16, h: 0.72, d: 0.17, color: dark },
      // 몸통 — 아래가 넓은 외투
      { x: 0, y: 1.02, z: 0, w: 0.44, h: 0.62, d: 0.28, color: coat },
      { x: 0, y: 0.76, z: 0, w: 0.5, h: 0.2, d: 0.32, color: dark },
      // 팔
      { x: -0.28, y: 1.02, z: 0, w: 0.13, h: 0.54, d: 0.15, color: coat },
      { x: 0.28, y: 1.02, z: 0, w: 0.13, h: 0.54, d: 0.15, color: coat },
      // 목과 머리
      { x: 0, y: 1.38, z: 0, w: 0.14, h: 0.1, d: 0.14, color: skin },
      { x: 0, y: 1.53, z: 0, w: 0.26, h: 0.26, d: 0.25, color: skin },
      // 두건
      { x: 0, y: 1.63, z: 0, w: 0.29, h: 0.14, d: 0.28, color: dark },
      // 등짐 — 멀리서도 "떠돌다 온 사람"으로 읽힌다
      { x: 0, y: 1.05, z: -0.22, w: 0.3, h: 0.38, d: 0.16, color: pack },
      { x: 0, y: 1.2, z: -0.24, w: 0.34, h: 0.06, d: 0.06, color: dark },
    ]);

    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, flatShading: true }),
      MAX_SETTLERS,
    );
    this.mesh.name = 'settlers';
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
  }

  /** 등급이 정한 인원에 맞춘다 */
  setTarget(n: number, cx: number, cz: number): void {
    const want = Math.min(MAX_SETTLERS, Math.max(0, n));

    while (this.list.length < want) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(2, SETTLEMENT.settlerRadius);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      this.list.push({
        x,
        z,
        y: this.terrain.sampleHeight(x, z),
        facing: a,
        goalX: x,
        goalZ: z,
        goalTimer: 0,
        // 처음부터 한꺼번에 일하지 않도록 흩어 둔다
        workTimer: this.rng.range(2, SETTLEMENT.settlerWorkInterval),
        bob: this.rng.range(0, Math.PI * 2),
      });
      this.notices.push('생존자 한 사람이 찾아왔다');
    }

    while (this.list.length > want) {
      this.list.pop();
      this.notices.push('생존자가 거점을 떠났다');
    }
  }

  /**
   * @param days 지나간 게임 내 시간 (일)
   * @returns 생존자들이 축낸 식량 (작물 개수, 소수)
   */
  update(dt: number, days: number, cx: number, cz: number): number {
    if (this.list.length === 0) {
      this.mesh.count = 0;
      return 0;
    }

    for (const s of this.list) {
      this.step(s, dt, cx, cz);
    }
    this.writeInstances();

    return this.list.length * SETTLEMENT.settlerFoodPerDay * days;
  }

  private step(s: Settler, dt: number, cx: number, cz: number): void {
    // 거점 안을 어슬렁거린다
    s.goalTimer -= dt;
    if (s.goalTimer <= 0) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(1.5, SETTLEMENT.settlerRadius);
      s.goalX = cx + Math.cos(a) * r;
      s.goalZ = cz + Math.sin(a) * r;
      s.goalTimer = this.rng.range(4, 11);
    }

    const dx = s.goalX - s.x;
    const dz = s.goalZ - s.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.4) {
      const speed = 1.5;
      s.x += (dx / dist) * speed * dt;
      s.z += (dz / dist) * speed * dt;
      s.facing = Math.atan2(dx, dz);
      s.bob += dt * 7;
    }
    s.y = this.terrain.sampleHeight(s.x, s.z);

    // 집안일 — 밀린 것 하나만
    s.workTimer -= dt;
    if (s.workTimer > 0) return;
    s.workTimer = SETTLEMENT.settlerWorkInterval;
    this.doChore();
  }

  /**
   * 밀린 집안일 하나를 처리한다.
   *
   * 새로 짓거나 캐지는 않는다 — 거점을 넓히는 것은 플레이어의 몫이다.
   * 생존자는 "자리를 비워도 무너지지 않는다"만 보장한다.
   */
  private doChore(): void {
    // 1) 마른 밭에 물을 준다
    for (const plot of this.buildings.placed) {
      if (plot.kind !== 'plot' || plot.stage !== 'planted' || plot.moisture > 0) continue;
      Buildings.water(plot);
      this.buildings.refresh(plot);
      this.notices.push('생존자가 밭에 물을 주었다');
      return;
    }

    // 2) 사위는 불에 풀을 넣는다 (자기들이 주워온 것으로)
    for (const fire of this.buildings.campfires) {
      if (fire.fuel <= 0 || fire.fuel >= 0.5) continue;
      this.buildings.refuel(fire, 0.4);
      this.notices.push('생존자가 불에 풀을 넣었다');
      return;
    }

    // 3) 씨앗이 남은 빈 밭에 심는다 — 있는 밭을 놀리지는 않는다
    for (const plot of this.buildings.placed) {
      if (plot.kind !== 'plot' || plot.stage !== 'empty') continue;
      plot.stage = 'planted';
      plot.growth = 0;
      plot.moisture = FARM.moisturePerWatering;
      this.buildings.refresh(plot);
      this.notices.push('생존자가 빈 밭에 씨를 뿌렸다');
      return;
    }
  }

  private writeInstances(): void {
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i]!;
      // 걸을 때 몸이 살짝 위아래로 흔들린다 — 팔다리를 따로 움직이지 않아도
      // "걷고 있다"가 읽히는 가장 싼 방법이다
      const lift = Math.abs(Math.sin(s.bob)) * 0.045;
      this.v.set(s.x, s.y + lift, s.z);
      this.q.setFromAxisAngle(UP, s.facing);
      this.s.setScalar(1);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = this.list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
  }

  reset(): void {
    this.list.length = 0;
    this.notices.length = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

const UP = new THREE.Vector3(0, 1, 0);
