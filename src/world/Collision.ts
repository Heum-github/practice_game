import * as THREE from 'three';

export interface Aabb {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export function makeAabb(
  center: THREE.Vector3 | { x: number; y: number; z: number },
  halfX: number,
  halfY: number,
  halfZ: number,
): Aabb {
  return {
    minX: center.x - halfX,
    minY: center.y - halfY,
    minZ: center.z - halfZ,
    maxX: center.x + halfX,
    maxY: center.y + halfY,
    maxZ: center.z + halfZ,
  };
}

const HASH_ORIGIN = 512;
const HASH_STRIDE = 2048;

/**
 * AABB 콜라이더 저장소.
 *
 * 폐허 구조물은 전부 축 정렬 상자로 표현되므로 균일 격자 해시로 충분하다.
 * XZ 평면만 해싱한다 — 월드가 넓고 낮아서 Y축 분할은 이득이 없다.
 */
export class ColliderWorld {
  private readonly cellSize: number;
  private readonly cells = new Map<number, Aabb[]>();
  private readonly all: Aabb[] = [];

  constructor(cellSize = 6) {
    this.cellSize = cellSize;
  }

  get count(): number {
    return this.all.length;
  }

  private key(ix: number, iz: number): number {
    return (ix + HASH_ORIGIN) * HASH_STRIDE + (iz + HASH_ORIGIN);
  }

  /** 전부 비운다 — 플레이어가 지은 것들을 초기화할 때 쓴다 */
  clear(): void {
    this.all.length = 0;
    this.cells.clear();
  }

  /** 이 상자 하나만 제거한다 (참조 동일성으로 찾는다) */
  remove(box: Aabb): void {
    const i = this.all.indexOf(box);
    if (i >= 0) this.all.splice(i, 1);
    for (const list of this.cells.values()) {
      const j = list.indexOf(box);
      if (j >= 0) list.splice(j, 1);
    }
  }

  add(box: Aabb): void {
    this.all.push(box);
    const i0 = Math.floor(box.minX / this.cellSize);
    const i1 = Math.floor(box.maxX / this.cellSize);
    const j0 = Math.floor(box.minZ / this.cellSize);
    const j1 = Math.floor(box.maxZ / this.cellSize);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let list = this.cells.get(k);
        if (!list) {
          list = [];
          this.cells.set(k, list);
        }
        list.push(box);
      }
    }
  }

  /** 주어진 XZ 영역과 겹칠 수 있는 후보들을 out에 채운다 (중복 제거됨) */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Aabb[]): Aabb[] {
    out.length = 0;
    const i0 = Math.floor(minX / this.cellSize);
    const i1 = Math.floor(maxX / this.cellSize);
    const j0 = Math.floor(minZ / this.cellSize);
    const j1 = Math.floor(maxZ / this.cellSize);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (const b of list) {
          // 격자 여러 칸에 걸친 상자가 중복 반환되는 것을 막는다
          if (!out.includes(b)) out.push(b);
        }
      }
    }
    return out;
  }

  /**
   * 광선과 콜라이더들의 최단 교차 거리. 없으면 Infinity.
   * 카메라가 벽을 뚫지 않게 당기는 데 쓴다.
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    const minX = Math.min(origin.x, origin.x + dir.x * maxDist);
    const maxX = Math.max(origin.x, origin.x + dir.x * maxDist);
    const minZ = Math.min(origin.z, origin.z + dir.z * maxDist);
    const maxZ = Math.max(origin.z, origin.z + dir.z * maxDist);

    const candidates: Aabb[] = [];
    this.query(minX, minZ, maxX, maxZ, candidates);

    let best = Infinity;
    const invX = 1 / (dir.x || 1e-9);
    const invY = 1 / (dir.y || 1e-9);
    const invZ = 1 / (dir.z || 1e-9);

    for (const b of candidates) {
      // slab method
      let t0 = (b.minX - origin.x) * invX;
      let t1 = (b.maxX - origin.x) * invX;
      if (t0 > t1) [t0, t1] = [t1, t0];

      let u0 = (b.minY - origin.y) * invY;
      let u1 = (b.maxY - origin.y) * invY;
      if (u0 > u1) [u0, u1] = [u1, u0];

      let v0 = (b.minZ - origin.z) * invZ;
      let v1 = (b.maxZ - origin.z) * invZ;
      if (v0 > v1) [v0, v1] = [v1, v0];

      const tEnter = Math.max(t0, u0, v0);
      const tExit = Math.min(t1, u1, v1);

      if (tEnter <= tExit && tExit >= 0 && tEnter < best && tEnter <= maxDist) {
        best = Math.max(tEnter, 0);
      }
    }
    return best;
  }
}

/**
 * 여러 콜라이더 저장소를 하나처럼 다룬다.
 *
 * 폐허(생성 후 불변)와 플레이어가 지은 것(계속 늘고 사망 시 사라짐)은
 * 수명이 완전히 다르다. 한 저장소에 섞으면 초기화할 때 폐허까지 날아간다.
 * 분리해 두고 조회할 때만 합친다.
 */
export class ColliderSet {
  private readonly worlds: ColliderWorld[];

  constructor(...worlds: ColliderWorld[]) {
    this.worlds = worlds;
  }

  get count(): number {
    return this.worlds.reduce((n, w) => n + w.count, 0);
  }

  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Aabb[]): Aabb[] {
    out.length = 0;
    const scratch: Aabb[] = [];
    for (const w of this.worlds) {
      w.query(minX, minZ, maxX, maxZ, scratch);
      for (const b of scratch) out.push(b);
    }
    return out;
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    let best = Infinity;
    for (const w of this.worlds) {
      const t = w.raycast(origin, dir, maxDist);
      if (t < best) best = t;
    }
    return best;
  }
}

export function aabbOverlaps(a: Aabb, b: Aabb): boolean {
  return (
    a.minX < b.maxX &&
    a.maxX > b.minX &&
    a.minY < b.maxY &&
    a.maxY > b.minY &&
    a.minZ < b.maxZ &&
    a.maxZ > b.minZ
  );
}
