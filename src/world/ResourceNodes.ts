import * as THREE from 'three';
import {
  archiveShape,
  grassShape,
  scrapShape,
  soilShape,
  supplyShape,
  waterShape,
} from './NodeShapes';
import { RESOURCE, WORLD } from '../config';
import { Rng } from '../util/math';
import { Terrain } from './Terrain';
import { ColliderWorld, type Aabb } from './Collision';
import type { ItemId } from '../gameplay/Items';

export type NodeKind = 'scrap' | 'soil' | 'water' | 'supply' | 'archive' | 'grass';

export interface ResourceNode {
  kind: NodeKind;
  x: number;
  y: number;
  z: number;
  /** 남은 채집 횟수 */
  remaining: number;
  /** 처음 채집 횟수 — 시각적 소진 표현에 쓴다 */
  capacity: number;
  /** InstancedMesh 안에서의 위치 */
  index: number;
  active: boolean;
}

interface KindSpec {
  item: ItemId;
  label: string;
  /** 한 번 채집에 걸리는 시간 (s) */
  duration: number;
  /** 한 번에 얻는 개수 */
  yield: number;
  /** 노드 하나가 버티는 채집 횟수 */
  capacity: [number, number];
  verb: string;
}

export const NODE_SPEC: Record<NodeKind, KindSpec> = {
  scrap: {
    item: 'scrap',
    label: '금속 잔해 더미',
    duration: 1.0,
    yield: 2,
    capacity: [2, 4],
    verb: '뜯어낸다',
  },
  soil: {
    item: 'soil',
    label: '남은 흙',
    // 흙은 이 세계에서 가장 귀하다. 캐는 데도 가장 오래 걸린다.
    duration: 1.7,
    yield: 1,
    capacity: [2, 4],
    verb: '긁어모은다',
  },
  water: {
    item: 'stagnantWater',
    label: '빗물 웅덩이',
    duration: 0.9,
    yield: 1,
    capacity: RESOURCE.waterCapacity,
    verb: '떠담는다',
  },
  supply: {
    item: 'cannedFood',
    label: '부서진 보급 상자',
    duration: 1.3,
    yield: 1,
    // 유한하다. 다시 차지 않는다.
    // 통조림이 떨어지기 전에 농사를 지어야 한다는 압박이 이 게임의 첫 시계다.
    capacity: [1, 2],
    verb: '뒤진다',
  },
  grass: {
    item: 'driedGrass',
    label: '마른 풀덤불',
    // 베는 것뿐이라 빠르다. 불은 자주 굶으므로 채집까지 굼뜨면 심부름이 된다.
    duration: 0.7,
    // 한 번에 한 단씩, 덤불 하나가 두세 단. 거점 하나를 하룻밤 먹이는 양이다.
    // 더 주면 첫 나들이 한 번으로 한 달치가 모여 연료가 없는 것과 같아진다.
    yield: 1,
    capacity: [2, 4],
    verb: '벤다',
  },
  archive: {
    item: 'blueprint',
    label: '데이터 단말',
    duration: 1.8,
    yield: 1,
    // 아주 드물다. 조감도 하나가 곧 새로운 기술 한 단계다.
    capacity: [1, 1],
    verb: '읽어낸다',
  },
};

/**
 * 자원이 몰려 있는 자리 (v0.5 — 폐허 구조물).
 *
 * 지형이 정하는 배치와 별개로, 손으로 세운 구조물이 **자기 몫의 자원을
 * 끌고 온다.** 온실 잔해에 흙이 쏟아져 있는 것이 그런 경우다 —
 * 건물이 거기 서 있다는 것 자체가 자원의 이유가 되어야, 구조물이
 * 배경이 아니라 목적지가 된다.
 */
export interface Hotspot {
  x: number;
  z: number;
  radius: number;
  /** 종류별로 몇 자리를 몰아 놓을지. 구조물마다 주는 것이 달라야 한다 */
  nodes: Partial<Record<NodeKind, number>>;
}

const HASH_ORIGIN = 512;
const HASH_STRIDE = 2048;
const CELL = 8;

/**
 * 채집 가능한 자원 노드.
 *
 * 세계관이 배치 규칙을 정한다.
 *  - 금속 잔해: 폐허 어디에나 흔하다
 *  - 흙: 지형의 soilRichness가 높은 극소수 지점에만 — 농장을 넓히려면 멀리 나가야 한다
 *  - 빗물: 콘크리트가 꺼진 웅덩이에 고인다. 지표수가 없는 세계의 유일한 물이며,
 *    하루가 바뀔 때 다시 찬다 (밤새 내린 비)
 */
export class ResourceNodes {
  readonly group = new THREE.Group();
  readonly nodes: ResourceNode[] = [];

  stats = { scrap: 0, soil: 0, water: 0, supply: 0, archive: 0, grass: 0 };

  private readonly meshes = {} as Record<NodeKind, THREE.InstancedMesh>;
  private readonly byKind: Record<NodeKind, ResourceNode[]> = {
    scrap: [],
    soil: [],
    water: [],
    supply: [],
    archive: [],
    grass: [],
  };
  private readonly cells = new Map<number, ResourceNode[]>();

  private readonly terrain: Terrain;
  private readonly rng: Rng;

  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();

  constructor(
    terrain: Terrain,
    colliders: ColliderWorld,
    hotspots: readonly Hotspot[] = [],
    seed = WORLD.seed + 777,
  ) {
    this.terrain = terrain;
    this.rng = new Rng(seed);
    this.group.name = 'resources';

    // ── 종류마다 난수를 따로 쓴다 ──────────────────────────────
    //
    // 하나의 흐름을 나눠 쓰면 앞의 배치가 뽑아 쓴 횟수만큼 뒤가 밀린다.
    // 그래서 **흙 확률만 만졌는데 풀과 물의 개수가 같이 움직였다** —
    // 확률을 23% 올렸더니 개수가 68% 뛰어서, 문서에 적힌 개수에 맞추는 일이
    // 두더지잡기가 됐다. 종류마다 씨를 따로 주면 하나를 만져도 나머지는 그대로다.
    this.placeSoil(colliders, new Rng(seed + 11));
    this.placeGrass(colliders, new Rng(seed + 22));
    this.placeScrap(colliders, new Rng(seed + 33));
    this.placeWater(colliders, new Rng(seed + 44));
    this.placeSupply(colliders, new Rng(seed + 55));
    this.placeArchives(colliders, new Rng(seed + 66));
    // 지형이 깔고 난 뒤에 얹는다. 인스턴스 개수는 buildMeshes 에서 확정되므로
    // 이 줄이 그보다 아래로 내려가면 새 노드가 그려지지 않는다.
    this.placeHotspots(colliders, hotspots);

    this.buildMeshes();
    this.indexCells();
  }

  // ---------------------------------------------------------------- 배치

  private key(ix: number, iz: number): number {
    return (ix + HASH_ORIGIN) * HASH_STRIDE + (iz + HASH_ORIGIN);
  }

  /**
   * 이 자리에 노드를 놓을 수 없는가.
   *
   * **공간 해시의 조회는 후보이지 답이 아니다** (기획서 8.3). `query` 는 격자
   * 한 칸(6m) 안의 상자를 전부 돌려주므로, 높이만 보고 막혔다고 판단하면
   * 실제로는 6m 떨어진 벽 때문에 발밑이 막힌 것으로 읽힌다.
   *
   * 그 탓에 폐허와 손으로 세운 구조물 **주변 한 칸이 통째로 빈 땅**이 되어
   * 있었다. 격납고에서는 반경 15m 안의 82%가 막힌 것으로 나와 잔해가 한
   * 자리도 깔리지 않았다 — 건물은 서 있는데 올 이유가 없는 상태였다.
   * XZ 겹침을 한 번 더 걸러야 한다.
   */
  private blocked(colliders: ColliderWorld, x: number, z: number): boolean {
    const pad = 0.6;
    const found: Aabb[] = [];
    colliders.query(x - pad, z - pad, x + pad, z + pad, found);
    const y = this.terrain.sampleHeight(x, z);
    for (const b of found) {
      // 발치 높이에서 겹치는가
      if (b.minY >= y + 1.2 || b.maxY <= y - 0.2) continue;
      // 그리고 실제로 발밑인가 — 이 줄이 없으면 격자 한 칸이 통째로 막힌다
      if (b.maxX <= x - pad || b.minX >= x + pad) continue;
      if (b.maxZ <= z - pad || b.minZ >= z + pad) continue;
      return true;
    }
    return false;
  }

  private tooSteep(x: number, z: number): boolean {
    return this.terrain.sampleNormal(x, z).y < 0.86;
  }

  private push(kind: NodeKind, x: number, z: number, rng: Rng): void {
    const [lo, hi] = NODE_SPEC[kind].capacity;
    const cap = rng.int(lo, hi + 1);
    const node: ResourceNode = {
      kind,
      x,
      y: this.terrain.sampleHeight(x, z),
      z,
      remaining: cap,
      capacity: cap,
      index: this.byKind[kind].length,
      active: true,
    };
    this.nodes.push(node);
    this.byKind[kind].push(node);
  }

  /**
   * 비옥도가 자리를 정하고, **개수는 목표가 정한다.**
   *
   * 예전에는 칸마다 확률을 굴려 나오는 대로 두었다. 그러면 배치를 거르는
   * 코드를 손댈 때마다 개수가 조용히 달라진다 — 실제로 `blocked()` 의 공간
   * 해시 버그를 고쳤더니 흙이 31에서 50이 됐다. 흙이 귀하다는 전제가
   * 이 게임의 경제 전체를 떠받치는데, 그게 남의 버그 수정에 딸려 움직인 것이다.
   *
   * 그래서 후보를 전부 모은 뒤 **가중 추첨으로 목표 개수만큼** 고른다.
   * 잔해·보급·단말이 이미 목표 개수를 세는 것과 같은 방식이고,
   * 자리를 정하는 규칙(비옥도·시작점 고갈)은 가중치로 그대로 살아 있다.
   */
  private placeWeighted(
    kind: NodeKind,
    target: number,
    minRichness: number,
    jitter: number,
    colliders: ColliderWorld,
    rng: Rng,
    weightAt: (richness: number, x: number, z: number) => number,
  ): void {
    const step = 3;
    const half = WORLD.size / 2 - 10;
    const cands: Array<{ x: number; z: number; w: number }> = [];

    for (let x = -half; x <= half; x += step) {
      for (let z = -half; z <= half; z += step) {
        const richness = this.terrain.sampleSoilRichness(x, z);
        if (richness < minRichness) continue;
        const w = weightAt(richness, x, z);
        if (w <= 0) continue;

        const px = x + rng.range(-jitter, jitter);
        const pz = z + rng.range(-jitter, jitter);
        if (this.tooSteep(px, pz) || this.blocked(colliders, px, pz)) continue;
        cands.push({ x: px, z: pz, w });
      }
    }

    // 가중 추첨. 뽑은 것은 빼내어 같은 자리가 두 번 나오지 않게 한다
    let total = 0;
    for (const c of cands) total += c.w;
    const want = Math.min(target, cands.length);
    for (let n = 0; n < want; n++) {
      let pick = rng.range(0, total);
      let i = 0;
      for (; i < cands.length - 1; i++) {
        pick -= cands[i]!.w;
        if (pick <= 0) break;
      }
      const c = cands[i]!;
      total -= c.w;
      cands.splice(i, 1);
      this.push(kind, c.x, c.z, rng);
    }
    this.stats[kind] = this.byKind[kind].length;
  }

  /** 흙은 지형이 허락하는 곳에만 놓는다 */
  private placeSoil(colliders: ColliderWorld, rng: Rng): void {
    this.placeWeighted(
      'soil',
      RESOURCE.soilCount,
      RESOURCE.soilMinRichness,
      1.2,
      colliders,
      rng,
      (richness, x, z) => {
        // 시작 지점 근처는 이미 훑고 간 자리라 거의 남아 있지 않다.
        // 밭을 넓히려면 바깥으로 나가야 한다는 압박이 여기서 나온다.
        const fromSpawn = Math.hypot(x, z);
        const pickedOver =
          fromSpawn < RESOURCE.pickedOverRadius
            ? RESOURCE.pickedOverFactor +
              (1 - RESOURCE.pickedOverFactor) * (fromSpawn / RESOURCE.pickedOverRadius)
            : 1;
        // 풍부할수록 뽑힐 자리가 많다
        return richness * pickedOver;
      },
    );
  }

  /**
   * 마른 풀 — 흙이 남은 자리에만 선다.
   *
   * 흙과 같은 땅을 쓰되 문턱이 낮고 더 흔하다. 그래서 풀덤불은
   * "여기서부터 땅이 살아 있다"는 예고편이 된다 — 풀이 보이기 시작하면
   * 조금 더 들어가 흙을 찾는다.
   *
   * 흙과 달리 시작 지점 주변에서도 나온다. 앞서 지나간 사람들은 흙을 걷어갔지
   * 풀을 베어가지는 않았다. 그리고 게임 쪽 사정도 있다 — 첫 불을 세우자마자
   * 태울 것이 없으면 화톳불은 배우기도 전에 미움부터 산다.
   */
  private placeGrass(colliders: ColliderWorld, rng: Rng): void {
    this.placeWeighted(
      'grass',
      RESOURCE.grassCount,
      RESOURCE.grassMinRichness,
      1.3,
      colliders,
      rng,
      // 흙과 달리 시작 지점을 가리지 않는다 — 앞선 사람들은 흙을 걷어갔지
      // 풀을 베어가지는 않았다
      (richness) => richness,
    );
  }

  /** 금속 잔해는 폐허 어디에나 */
  private placeScrap(colliders: ColliderWorld, rng: Rng): void {
    const target = 340;
    let tries = 0;
    while (this.byKind.scrap.length < target && tries < target * 12) {
      tries++;
      const x = rng.range(-92, 92);
      const z = rng.range(-92, 92);
      // 폭심지는 깨끗이 날아갔다
      if (Math.hypot(x, z) < 11) continue;
      if (this.tooSteep(x, z) || this.blocked(colliders, x, z)) continue;
      this.push('scrap', x, z, rng);
    }
    this.stats.scrap = this.byKind.scrap.length;
  }

  /**
   * 빗물은 지형이 꺼진 곳에 고인다.
   *
   * "모든 이웃보다 낮은" 엄격한 극소점을 요구하면 완만한 지형에서는 몇 곳밖에 안 나온다.
   * 여덟 방향 중 다수가 높으면 오목한 것으로 본다.
   *
   * ── 흩뿌리지 않고 모아 둔다 ──────────────────────────────
   * 웅덩이를 온 세계에 하나씩 흩어 놓으면, 한 번 뜨고 또 걸어가야 한다.
   * 물을 구하는 일이 이동으로만 채워져서 지루하다.
   *
   * 그래서 웅덩이가 고이는 "저지대"는 드물게 두되, 한 곳을 찾으면
   * 여러 개가 모여 있게 한다. 찾기는 어렵고 찾으면 보람이 있어야 한다 —
   * 그 자리가 거점을 세울 이유가 되기도 한다.
   */
  private placeWater(colliders: ColliderWorld, rng: Rng): void {
    const step = 3;
    const half = WORLD.size / 2 - 12;

    // 1) 오목한 자리를 전부 모은 뒤 **목표 개수만큼** 고른다.
    //
    // 확률로 흘려보내면 배치를 거르는 코드가 바뀔 때마다 저지대 수가 달라진다
    // (흙에서 실제로 겪었다). 후보를 모아 놓고 세어서 뽑으면 개수가 확정된다.
    const spots: Array<{ x: number; z: number }> = [];
    for (let x = -half; x <= half; x += step) {
      for (let z = -half; z <= half; z += step) {
        const h = this.terrain.sampleHeight(x, z);

        let higher = 0;
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2;
          const nx = x + Math.cos(ang) * 2.6;
          const nz = z + Math.sin(ang) * 2.6;
          if (this.terrain.sampleHeight(nx, nz) > h + 0.05) higher++;
        }
        if (higher < RESOURCE.waterConcavity) continue;
        if (this.tooSteep(x, z)) continue;
        if (this.blocked(colliders, x, z)) continue;
        spots.push({ x, z });
      }
    }

    const basins: Array<{ x: number; z: number }> = [];
    while (basins.length < RESOURCE.basinCount && spots.length > 0) {
      const i = rng.int(0, spots.length);
      const s = spots.splice(i, 1)[0]!;
      // 이미 잡은 저지대와 너무 가까우면 한 덩어리로 친다
      let tooClose = false;
      for (const b of basins) {
        if (Math.hypot(b.x - s.x, b.z - s.z) < RESOURCE.basinSpacing) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) basins.push(s);
    }

    // 2) 저지대마다 웅덩이를 여럿 흩어 놓는다
    for (const b of basins) {
      const n = rng.int(RESOURCE.puddlesPerBasin[0], RESOURCE.puddlesPerBasin[1]);
      let placed = 0;
      for (let tries = 0; tries < n * 6 && placed < n; tries++) {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.range(0, 1)) * RESOURCE.basinRadius;
        const px = b.x + Math.cos(a) * r;
        const pz = b.z + Math.sin(a) * r;
        if (this.tooSteep(px, pz) || this.blocked(colliders, px, pz)) continue;
        this.push('water', px, pz, rng);
        placed++;
      }
    }

    this.stats.water = this.byKind.water.length;
  }

  /**
   * 부서진 보급 상자.
   *
   * 농사가 없는 v0.1에서 유일한 식량원이다. 다시 생기지 않으므로
   * 월드에 있는 양이 곧 남은 시간이다.
   */
  private placeSupply(colliders: ColliderWorld, rng: Rng): void {
    const target = 38;
    let tries = 0;
    while (this.byKind.supply.length < target && tries < target * 30) {
      tries++;
      const x = rng.range(-88, 88);
      const z = rng.range(-88, 88);
      const d = Math.hypot(x, z);
      // 폭심지는 비어 있고, 분화구 테두리(보존 구역 잔해)와 도시에 남아 있다
      if (d < 13) continue;
      if (this.tooSteep(x, z) || this.blocked(colliders, x, z)) continue;
      this.push('supply', x, z, rng);
    }
    this.stats.supply = this.byKind.supply.length;
  }

  /**
   * 데이터 단말 — 폐허에 남은 설계 기록.
   *
   * 도시 구역(분화구 바깥)에만 있다. 보존 구역 잔해가 아니라
   * AI가 쓰던 시설의 기록이기 때문이다.
   */
  private placeArchives(colliders: ColliderWorld, rng: Rng): void {
    const target = 14;
    let tries = 0;
    while (this.byKind.archive.length < target && tries < target * 40) {
      tries++;
      const x = rng.range(-86, 86);
      const z = rng.range(-86, 86);
      if (Math.hypot(x, z) < 45) continue;
      if (this.tooSteep(x, z) || this.blocked(colliders, x, z)) continue;
      this.push('archive', x, z, rng);
    }
    this.stats.archive = this.byKind.archive.length;
  }

  /**
   * 손으로 세운 구조물이 끌고 오는 자원.
   *
   * 지형이 정한 조건을 묻지 않는다 — 여기 자원이 있는 이유는 땅이 아니라
   * **건물**이기 때문이다. 온실은 깨진 지붕으로 재배 상토가 쏟아진 자리고,
   * 급수탑은 터진 물탱크가 고인 자리며, 격납고는 뜯다 만 기계가 쌓인 자리다.
   * 그 사연이 곧 비옥도·오목함 검사를 건너뛰는 근거다.
   *
   * 이랑이나 벽 위에 얹히는 것은 기존 `blocked()` 가 알아서 걸러낸다.
   * 구조물마다 예외를 두기 시작하면 구조물이 늘 때마다 여기가 어긋난다.
   */
  private placeHotspots(colliders: ColliderWorld, hotspots: readonly Hotspot[]): void {
    // 한 자리에 겹쳐 쌓이면 무더기 하나로 보인다. 흩어 놓아야 "몰려 있다"로 읽힌다
    const minGap = 1.6;

    for (const spot of hotspots) {
      for (const [kind, target] of Object.entries(spot.nodes) as Array<[NodeKind, number]>) {
        const placed: Array<[number, number]> = [];

        for (let tries = 0; tries < target * 20 && placed.length < target; tries++) {
          const a = this.rng.range(0, Math.PI * 2);
          // sqrt 를 씌워야 원 안에 고르게 퍼진다 (안 씌우면 가운데로 몰린다)
          const r = Math.sqrt(this.rng.range(0, 1)) * spot.radius;
          const px = spot.x + Math.cos(a) * r;
          const pz = spot.z + Math.sin(a) * r;

          if (this.tooSteep(px, pz) || this.blocked(colliders, px, pz)) continue;

          let tooClose = false;
          for (const [qx, qz] of placed) {
            if (Math.hypot(qx - px, qz - pz) < minGap) {
              tooClose = true;
              break;
            }
          }
          if (tooClose) continue;

          this.push(kind, px, pz, this.rng);
          placed.push([px, pz]);
        }

        this.stats[kind] = this.byKind[kind].length;
      }
    }
  }

  // ---------------------------------------------------------------- 메시

  private buildMeshes(): void {
    const make = (
      kind: NodeKind,
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
    ): void => {
      const list = this.byKind[kind];
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(list.length, 1));
      mesh.name = `resource:${kind}`;
      mesh.castShadow = kind !== 'water';
      mesh.receiveShadow = true;
      mesh.count = list.length;
      this.meshes[kind] = mesh;
      this.group.add(mesh);
      for (const node of list) this.writeInstance(node);
      mesh.instanceMatrix.needsUpdate = true;
    };

    // 부품마다 색이 달라야 형태가 읽힌다 — 색은 전부 정점에 실려 있다.
    make(
      'soil',
      soilShape(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98, flatShading: true }),
    );
    make(
      'grass',
      grassShape(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.95,
        flatShading: true,
        // 마른 잎은 얇아서 뒤에서 빛이 들면 비친다. 양면을 그려야
        // 어느 각도에서 봐도 덤불이 사라지지 않는다.
        side: THREE.DoubleSide,
      }),
    );
    make(
      'scrap',
      scrapShape(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.52,
        metalness: 0.45,
        flatShading: true,
      }),
    );
    make(
      'water',
      waterShape(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        // 물은 금속이 아니다.
        //
        // metalness 를 올리면 알베도가 반사색이 되어 탁한 파란 금속판이 된다.
        // 0 으로 두고 거칠기만 낮추면 프레넬이 작동한다 —
        // 내려다보면 어둡고, 비스듬히 보면 하늘이 환하게 비친다. 그게 물이다.
        metalness: 0,
        roughness: 0.06,
        // 하늘 반사를 조금 세게 실어준다
        envMapIntensity: 1.6,
        transparent: true,
        opacity: 0.72,
      }),
    );
    // 데이터 단말 — 아직 희미하게 살아 있는 화면
    make(
      'archive',
      archiveShape(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        emissive: 0x1b3a4a,
        emissiveIntensity: 0.55,
        roughness: 0.42,
        metalness: 0.45,
        flatShading: true,
      }),
    );
    // 보급 상자는 눈에 띄어야 한다 — 폐허의 회색 안에서 유일하게 따뜻한 색
    make(
      'supply',
      supplyShape(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.8,
        metalness: 0.1,
        flatShading: true,
      }),
    );
  }

  /** 노드 하나의 인스턴스 행렬을 다시 쓴다 */
  private writeInstance(node: ResourceNode): void {
    const mesh = this.meshes[node.kind];
    if (!mesh) return;

    if (!node.active) {
      // 크기 0으로 접어 시야에서 지운다
      this.tmpMatrix.makeScale(0, 0, 0);
      mesh.setMatrixAt(node.index, this.tmpMatrix);
      return;
    }

    // 남은 양에 따라 눈에 보이게 줄어든다
    const t = 0.55 + 0.45 * (node.remaining / node.capacity);

    // 새 형상은 전부 밑면이 y=0 이라 지면 높이를 그대로 준다.
    // 웅덩이만 살짝 띄워 지형과 겹쳐 깜빡이는 것을 막는다.
    if (node.kind === 'water') {
      this.tmpPos.set(node.x, node.y + 0.02, node.z);
      this.tmpScale.set(t * 1.3, 1, t * 1.3);
      this.tmpQuat.setFromAxisAngle(UP, node.index * 1.1);
    } else if (node.kind === 'soil') {
      this.tmpPos.set(node.x, node.y, node.z);
      this.tmpScale.set(t, 0.85 * t, t);
      this.tmpQuat.setFromAxisAngle(UP, node.index * 1.7);
    } else if (node.kind === 'grass') {
      // 베어낼수록 낮아진다. 밑동은 남으므로 아주 작아지지는 않는다.
      this.tmpPos.set(node.x, node.y, node.z);
      this.tmpScale.set(0.9 + 0.2 * t, 0.5 + 0.5 * t, 0.9 + 0.2 * t);
      this.tmpQuat.setFromAxisAngle(UP, node.index * 2.9);
    } else if (node.kind === 'archive') {
      this.tmpPos.set(node.x, node.y, node.z);
      this.tmpScale.setScalar(1);
      this.tmpQuat.setFromAxisAngle(UP, node.index * 1.3);
    } else if (node.kind === 'supply') {
      // 상자는 뒤져도 줄어들지 않고 뚜껑만 기울어진 채 남는다
      this.tmpPos.set(node.x, node.y, node.z);
      this.tmpScale.setScalar(1);
      this.tmpQuat.setFromAxisAngle(UP, node.index * 0.9);
    } else {
      this.tmpPos.set(node.x, node.y, node.z);
      this.tmpScale.setScalar(t);
      this.tmpQuat.setFromAxisAngle(UP, node.index * 2.3);
    }

    this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
    mesh.setMatrixAt(node.index, this.tmpMatrix);
  }

  private flush(kind: NodeKind): void {
    const mesh = this.meshes[kind];
    if (mesh) mesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- 조회

  private indexCells(): void {
    this.cells.clear();
    for (const node of this.nodes) {
      const k = this.key(Math.floor(node.x / CELL), Math.floor(node.z / CELL));
      let list = this.cells.get(k);
      if (!list) {
        list = [];
        this.cells.set(k, list);
      }
      list.push(node);
    }
  }

  /**
   * 플레이어 앞쪽 reach 안에서 가장 알맞은 노드를 고른다.
   * 거리뿐 아니라 시선과의 각도도 함께 본다 — 등 뒤의 것이 잡히면 답답하다.
   */
  findTarget(
    px: number,
    pz: number,
    forwardX: number,
    forwardZ: number,
    reach: number,
    coneCos: number,
  ): ResourceNode | null {
    const i0 = Math.floor((px - reach) / CELL);
    const i1 = Math.floor((px + reach) / CELL);
    const j0 = Math.floor((pz - reach) / CELL);
    const j1 = Math.floor((pz + reach) / CELL);

    let best: ResourceNode | null = null;
    let bestScore = Infinity;

    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (const node of list) {
          if (!node.active) continue;
          const dx = node.x - px;
          const dz = node.z - pz;
          const dist = Math.hypot(dx, dz);
          if (dist > reach) continue;

          // 아주 가까우면 각도를 따지지 않는다
          let aim = 1;
          if (dist > 0.4) {
            aim = (dx * forwardX + dz * forwardZ) / dist;
            if (aim < coneCos) continue;
          }

          // 가깝고 정면일수록 낮은 점수
          const score = dist - aim * 1.4;
          if (score < bestScore) {
            bestScore = score;
            best = node;
          }
        }
      }
    }
    return best;
  }

  /**
   * 노드에서 한 번 채집한다.
   * @returns 얻은 아이템과 개수. 노드가 이미 비었으면 null
   */
  harvest(node: ResourceNode): { item: ItemId; count: number } | null {
    if (!node.active || node.remaining <= 0) return null;

    node.remaining -= 1;
    if (node.remaining <= 0) node.active = false;

    this.writeInstance(node);
    this.flush(node.kind);

    const spec = NODE_SPEC[node.kind];
    return { item: spec.item, count: spec.yield };
  }

  /** 밤새 내린 비로 웅덩이가 다시 찬다 */
  refillWater(): void {
    for (const node of this.byKind.water) {
      if (node.remaining >= node.capacity) continue;
      // 하룻밤에 조금씩만 찬다 — 한 웅덩이에 눌러앉지 못하게 한다
      node.remaining = Math.min(node.capacity, node.remaining + RESOURCE.waterRefillPerNight);
      node.active = true;
      this.writeInstance(node);
    }
    this.flush('water');
  }

  /**
   * 계절이 바뀔 때 한 종류를 되살린다 (기획서 3.7 — 해빙기의 재생).
   *
   * 다 캐서 사라진 자리 중 일부만 돌아온다. 전부 돌아오면 세계가 리셋되는 것이고,
   * 그러면 "유한한 세계"라는 전제가 계절마다 무너진다. 대신 **완전히 마르지는
   * 않는다**는 감각을 준다 — 봄이 오면 조금은 숨통이 트인다.
   *
   * 정해진 순서로 훑어 앞쪽부터 되살린다. 무작위로 고르면 같은 세이브를
   * 다시 불러올 때마다 다른 결과가 나와, 시드 기반 결정론이 깨진다.
   *
   * @param ratio 소진된 것 중 되살아나는 비율 (0..1)
   * @returns 실제로 되살아난 자리 수
   */
  regrow(kind: NodeKind, ratio: number): number {
    const spent = this.byKind[kind].filter((n) => n.remaining < n.capacity);
    if (spent.length === 0) return 0;

    const target = Math.round(spent.length * Math.max(0, Math.min(1, ratio)));
    let revived = 0;
    for (const node of spent) {
      if (revived >= target) break;
      node.remaining = node.capacity;
      node.active = true;
      this.writeInstance(node);
      revived++;
    }
    if (revived > 0) this.flush(kind);
    return revived;
  }

  /**
   * 세이브용 — 캐서 줄어든 노드만 [인덱스, 남은 횟수] 로 내보낸다.
   * 배치 자체는 시드에서 다시 만들어지므로 저장할 필요가 없다.
   */
  serialize(): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i]!;
      if (node.remaining !== node.capacity) out.push([i, node.remaining]);
    }
    return out;
  }

  restore(delta: Array<[number, number]>): void {
    this.reset();
    for (const [i, remaining] of delta) {
      const node = this.nodes[i];
      if (!node) continue;
      node.remaining = Math.max(0, Math.min(remaining, node.capacity));
      node.active = node.remaining > 0;
      this.writeInstance(node);
    }
    for (const kind of Object.keys(this.byKind) as NodeKind[]) this.flush(kind);
  }

  /** 사망 후 세계를 처음 상태로 되돌린다 */
  reset(): void {
    for (const node of this.nodes) {
      node.remaining = node.capacity;
      node.active = true;
      this.writeInstance(node);
    }
    for (const kind of Object.keys(this.byKind) as NodeKind[]) this.flush(kind);
  }

  dispose(): void {
    for (const kind of Object.keys(this.meshes) as NodeKind[]) {
      const mesh = this.meshes[kind];
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
