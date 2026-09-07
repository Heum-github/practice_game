import * as THREE from 'three';
import { GREENHOUSE, HANGAR, MAST, VAULT, WATER_TOWER, WORLD } from '../config';
import { Rng } from '../util/math';
import { Terrain } from './Terrain';
import { ColliderWorld, type Aabb } from './Collision';

/**
 * 하나의 인스턴스 배치 정보.
 * 먼저 전부 수집한 뒤 InstancedMesh를 정확한 개수로 만든다.
 */
interface InstanceDef {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
  color: THREE.Color;
}

type Kind = 'concrete' | 'metal' | 'panel' | 'rebar' | 'dome' | 'cable' | 'pebble';

/**
 * 폐허 생성이 비켜가야 하는 사각 구역 — 손으로 세운 구조물의 자리다.
 * 구조물을 하나 더 세우면 **여기 한 줄만 더한다.**
 */
const RESERVED = [
  VAULT,
  GREENHOUSE,
  HANGAR,
  // 급수탑은 다리 넷이 이루는 사각형에 집수반까지 품어야 한다
  {
    x: WATER_TOWER.x,
    z: WATER_TOWER.z,
    width: WATER_TOWER.basinRadius * 2,
    depth: WATER_TOWER.basinRadius * 2,
    clearance: WATER_TOWER.clearance,
  },
] as ReadonlyArray<{
  x: number;
  z: number;
  width: number;
  depth: number;
  clearance: number;
}>;

const PALETTE = {
  concrete: [0x6d6c63, 0x62615a, 0x757368, 0x585851],
  metal: [0x4a5057, 0x3f444b, 0x555b62],
  panel: [0x33404f, 0x2a3542, 0x3d4a5c],
  rust: [0x74462a, 0x6a4128, 0x855234],
  dome: [0x7f8886, 0x6f7876, 0x8b9491],
  cable: [0x1e1c1a, 0x272320, 0x171513],
} as const;

/**
 * 무너진 기계 문명의 잔해.
 *
 * 세계관 반영:
 *  - 도시는 격자로 구획되어 있었다 → 축 정렬 블록 배치 (AABB 충돌과도 잘 맞는다)
 *  - AI의 태양광 패널 파편이 곳곳에 박혀 있다
 *  - 분화구 주변에는 인류 보존 구역 돔의 잔해가 흩어져 있다
 */
export class Ruins {
  readonly group = new THREE.Group();
  readonly colliders = new ColliderWorld(6);

  private readonly terrain: Terrain;
  private readonly rng: Rng;
  private readonly buckets: Record<Kind, InstanceDef[]> = {
    concrete: [],
    metal: [],
    panel: [],
    rebar: [],
    dome: [],
    cable: [],
    pebble: [],
  };

  /** 통계 — HUD 디버그 표시용 */
  stats = { buildings: 0, instances: 0, colliders: 0 };

  constructor(terrain: Terrain, seed = WORLD.seed + 101) {
    this.terrain = terrain;
    this.rng = new Rng(seed);
    this.group.name = 'ruins';

    this.generateCityBlocks();
    this.generateDomeWreckage();
    this.generateLandmarks();
    this.scatterDebris();
    this.scatterPanels();
    this.scatterRebar();
    this.scatterPebbles();
    this.stringCables();

    this.buildMeshes();

    this.stats.colliders = this.colliders.count;
  }

  // ---------------------------------------------------------------- 생성

  private color(kind: keyof typeof PALETTE): THREE.Color {
    const hex = this.rng.pick(PALETTE[kind]);
    const c = new THREE.Color(hex);
    // 인스턴스마다 밝기를 흔들어 단조로움을 없앤다
    c.multiplyScalar(this.rng.range(0.84, 1.14));
    return c;
  }

  /**
   * 상자 하나를 배치한다. 축 정렬(회전 없음)일 때만 콜라이더를 등록한다.
   * @param base 상자 바닥의 월드 Y
   */
  private box(
    kind: Kind,
    colorKind: keyof typeof PALETTE,
    x: number,
    z: number,
    base: number,
    sx: number,
    sy: number,
    sz: number,
    opts: { ry?: number; tilt?: number; collide?: boolean } = {},
  ): void {
    if (this.inReservedZone(x, z)) return;

    const ry = opts.ry ?? 0;
    const tilt = opts.tilt ?? 0;
    const cy = base + sy / 2;

    this.buckets[kind].push({
      x,
      y: cy,
      z,
      rx: tilt,
      ry,
      rz: 0,
      sx,
      sy,
      sz,
      color: this.color(colorKind),
    });

    if (opts.collide ?? true) {
      // 90도 단위 회전은 폭·깊이를 맞바꾼 AABB로 정확히 표현된다
      const quarter = Math.round(ry / (Math.PI / 2)) % 2 !== 0;
      const hx = (quarter ? sz : sx) / 2;
      const hz = (quarter ? sx : sz) / 2;
      const box: Aabb = {
        minX: x - hx,
        maxX: x + hx,
        minY: base,
        maxY: base + sy,
        minZ: z - hz,
        maxZ: z + hz,
      };
      this.colliders.add(box);
    }
  }

  /**
   * 손으로 세운 구조물의 자리는 비워둔다.
   *
   * 폐허는 시드로 알아서 흩어지므로 무엇이 어디에 떨어질지 여기서는 모른다.
   * 실제로 무너진 건물 조각 하나가 종자고 한복판에 박혀서, 문을 열어도
   * **안으로 들어갈 수가 없었다.** 겉으로는 멀쩡해 보이는 종류의 사고다.
   *
   * 손으로 세운 구조물이 있는 자리는 손으로 비워야 한다.
   * 종자고 · 관측 첨탑 셋 · 온실 · 급수탑 · 격납고, 전부 여기서 비운다.
   *
   * **표를 돌게 한다.** 손으로 나열하면 구조물이 늘 때마다 한 곳을 빠뜨리고,
   * 빠뜨린 것은 화면으로 안 보인다 (8.3 — `Buildings.reset()` 이 그랬다).
   */
  private inReservedZone(x: number, z: number): boolean {
    for (const r of RESERVED) {
      if (
        Math.abs(x - r.x) < r.width / 2 + r.clearance &&
        Math.abs(z - r.z) < r.depth / 2 + r.clearance
      ) {
        return true;
      }
    }
    // 관측 첨탑은 원형이다. 계단 한 칸에 잔해가 박히면 오를 수가 없다.
    for (const m of MAST.spots) {
      if (Math.hypot(x - m.x, z - m.z) < MAST.clearance) return true;
    }
    return false;
  }

  private ground(x: number, z: number): number {
    return this.terrain.sampleHeight(x, z);
  }

  private inWorld(x: number, z: number, margin = 8): boolean {
    const half = WORLD.size / 2 - margin;
    return Math.abs(x) < half && Math.abs(z) < half;
  }

  /** 격자 구획마다 무너진 건물을 하나씩 세운다 */
  private generateCityBlocks(): void {
    const block = 27;
    const span = 3;

    for (let bx = -span; bx <= span; bx++) {
      for (let bz = -span; bz <= span; bz++) {
        const cx = bx * block + this.rng.range(-4, 4);
        const cz = bz * block + this.rng.range(-4, 4);

        // 분화구 안쪽은 비워둔다 — 여기는 보존 구역이 있던 자리다
        if (Math.hypot(cx, cz) < 40) continue;
        if (!this.inWorld(cx, cz, 14)) continue;
        // 가끔 공터를 남겨 도시가 기계적으로 보이지 않게 한다
        if (this.rng.chance(0.14)) continue;

        this.buildRuinedBuilding(cx, cz);
        this.stats.buildings++;
      }
    }
  }

  /**
   * 무너진 건물 하나.
   * 벽을 짧은 세그먼트로 쪼개고 높이를 들쭉날쭉하게, 일부는 아예 없앤다.
   */
  private buildRuinedBuilding(cx: number, cz: number): void {
    const w = this.rng.range(9, 17);
    const d = this.rng.range(9, 17);
    const floors = this.rng.int(1, 5);
    const floorH = 3.3;
    const fullH = floors * floorH;
    const wallT = 0.5;

    const baseY = this.ground(cx, cz);

    // 붕괴 방향 — 한쪽으로 갈수록 낮아지면 무너진 방향이 읽힌다
    const collapseAngle = this.rng.range(0, Math.PI * 2);
    const cdx = Math.cos(collapseAngle);
    const cdz = Math.sin(collapseAngle);

    const segLen = 2.0;

    const wall = (
      x0: number,
      z0: number,
      dirX: number,
      dirZ: number,
      length: number,
      /** 이 칸은 문으로 뚫는다 (-1이면 없음) */
      doorIndex = -1,
    ): void => {
      const n = Math.max(1, Math.round(length / segLen));
      const step = length / n;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) * step;
        const sx = x0 + dirX * t;
        const sz = z0 + dirZ * t;

        // 붕괴 방향으로 갈수록 낮다
        const lean = ((sx - cx) * cdx + (sz - cz) * cdz) / Math.max(w, d);
        const ratio = Math.max(0, 0.92 - lean * 0.62 + this.rng.range(-0.3, 0.22));
        const h = fullH * Math.min(ratio, 1);
        if (h < 0.7) continue;
        if (this.rng.chance(0.16)) continue; // 뚫린 구멍

        const isAlongX = Math.abs(dirX) > 0.5;
        const segW = isAlongX ? step * 1.02 : wallT;
        const segD = isAlongX ? wallT : step * 1.02;

        const g = this.ground(sx, sz);

        // 출입구.
        //
        // 벽이 무작위로 뚫리기를 기대하면 어떤 건물은 끝내 들어갈 수 없다.
        // 한 면에 문을 하나 보장해 두면 "들어가 볼까"가 성립한다.
        // 위쪽 상인방은 남겨서 구멍이 아니라 문으로 읽히게 한다.
        const DOOR_H = 2.2;
        if (i === doorIndex && h > DOOR_H + 0.6) {
          this.box(
            'concrete',
            'concrete',
            sx,
            sz,
            g + DOOR_H,
            segW,
            h - DOOR_H,
            segD,
          );
          continue;
        }

        this.box(
          'concrete',
          this.rng.chance(0.18) ? 'metal' : 'concrete',
          sx,
          sz,
          g - 0.7,
          segW,
          h + 0.7,
          segD,
        );

        // 창 — 이게 없으면 아무리 크게 지어도 그냥 콘크리트 판이다.
        // 층마다 어두운 띠를 벽 두께보다 아주 살짝 두껍게 박아
        // 양면 모두에서 뚫린 구멍처럼 읽히게 한다.
        const top = g + h;
        for (let f = 0; f < floors; f++) {
          const sill = baseY + f * floorH + 1.05;
          if (sill < g + 0.5 || sill + 1.25 > top - 0.35) continue;
          if (this.rng.chance(0.2)) continue; // 막혔거나 무너진 창

          const openW = step * this.rng.range(0.55, 0.72);
          this.box(
            'panel',
            'panel',
            sx,
            sz,
            sill,
            isAlongX ? openW : wallT * 1.08,
            1.25,
            isAlongX ? wallT * 1.08 : openW,
            { collide: false },
          );
        }

        // 부러진 콘크리트 위로 삐져나온 철근
        if (h > 2 && this.rng.chance(0.3)) {
          const bars = this.rng.int(1, 3);
          for (let i = 0; i < bars; i++) {
            const jx = this.rng.range(-segW * 0.3, segW * 0.3);
            const jz = this.rng.range(-segD * 0.3, segD * 0.3);
            this.box('rebar', 'rust', sx + jx, sz + jz, top - 0.1, 0.05, this.rng.range(0.3, 0.9), 0.05, {
              tilt: this.rng.range(-0.35, 0.35),
              collide: false,
            });
          }
        }
      }
    };

    const hw = w / 2;
    const hd = d / 2;
    // 어느 면에 문을 낼지 하나 고른다
    const doorWall = this.rng.int(0, 3);
    const segsX = Math.max(1, Math.round(w / segLen));
    const segsZ = Math.max(1, Math.round(d / segLen));
    const doorX = this.rng.int(0, segsX - 1);
    const doorZ = this.rng.int(0, segsZ - 1);

    wall(cx - hw, cz - hd, 1, 0, w, doorWall === 0 ? doorX : -1);
    wall(cx - hw, cz + hd, 1, 0, w, doorWall === 1 ? doorX : -1);
    wall(cx - hw, cz - hd, 0, 1, d, doorWall === 2 ? doorZ : -1);
    wall(cx + hw, cz - hd, 0, 1, d, doorWall === 3 ? doorZ : -1);

    // 남아 있는 바닥 슬래브
    const slabFloors = Math.min(floors, 3);
    for (let f = 1; f <= slabFloors; f++) {
      // 1층 천장은 웬만하면 남긴다. 지붕이 없으면 들어갈 이유도 없다.
      if (this.rng.chance(f === 1 ? 0.15 : 0.45)) continue;
      const y = baseY + f * floorH;
      const sw = w * (f === 1 ? this.rng.range(0.6, 0.95) : this.rng.range(0.35, 0.8));
      const sd = d * (f === 1 ? this.rng.range(0.6, 0.95) : this.rng.range(0.35, 0.8));
      const ox = this.rng.range(-(w - sw) / 2, (w - sw) / 2);
      const oz = this.rng.range(-(d - sd) / 2, (d - sd) / 2);
      this.box('concrete', 'concrete', cx + ox, cz + oz, y, sw, 0.35, sd);
    }

    // 기둥
    const cols = this.rng.int(2, 5);
    for (let i = 0; i < cols; i++) {
      const px = cx + this.rng.range(-hw + 1.5, hw - 1.5);
      const pz = cz + this.rng.range(-hd + 1.5, hd - 1.5);
      const h = fullH * this.rng.range(0.3, 0.95);
      const g = this.ground(px, pz);
      this.box('concrete', 'concrete', px, pz, g - 0.5, 0.7, h + 0.5, 0.7);
    }

    // 건물 주변에 무너져 쌓인 잔해 더미
    const heaps = this.rng.int(3, 8);
    for (let i = 0; i < heaps; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(hw * 0.8, hw * 1.9);
      const px = cx + Math.cos(a) * r;
      const pz = cz + Math.sin(a) * r;
      if (!this.inWorld(px, pz)) continue;
      const s = this.rng.range(1.0, 2.8);
      const g = this.ground(px, pz);
      this.box(
        'concrete',
        this.rng.chance(0.3) ? 'rust' : 'concrete',
        px,
        pz,
        g - s * 0.45,
        s,
        s * this.rng.range(0.5, 0.9),
        s * this.rng.range(0.7, 1.3),
        { ry: (Math.PI / 2) * this.rng.int(0, 4) },
      );
    }
  }

  /** 분화구 테두리에 흩어진 보존 구역 돔의 파편 */
  private generateDomeWreckage(): void {
    const shards = 46;
    for (let i = 0; i < shards; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(20, 46);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!this.inWorld(x, z)) continue;
      if (this.inReservedZone(x, z)) continue;

      const len = this.rng.range(3.5, 11);
      const wid = this.rng.range(2.5, 6);
      const g = this.ground(x, z);
      const tilt = this.rng.range(-1.1, 1.1);

      this.buckets.dome.push({
        x,
        y: g + Math.abs(Math.sin(tilt)) * len * 0.35,
        z,
        rx: tilt,
        ry: this.rng.range(0, Math.PI * 2),
        rz: this.rng.range(-0.35, 0.35),
        sx: wid,
        sy: 0.28,
        sz: len,
        color: this.color('dome'),
      });

      // 웬만한 크기의 파편에는 콜라이더를 준다.
      // 없으면 카메라가 파고들어 화면을 통째로 가린다.
      if (len > 4.5) {
        const hx = wid * 0.45;
        const hz = len * 0.3;
        this.colliders.add({
          minX: x - hx,
          maxX: x + hx,
          minY: g - 0.5,
          maxY: g + 1.4,
          minZ: z - hz,
          maxZ: z + hz,
        });
      }
    }
  }

  /** 방향을 잡을 수 있게 해주는 큰 지형지물 — 쓰러진 AI 첨탑 */
  private generateLandmarks(): void {
    const spots: Array<[number, number]> = [
      [-62, 58],
      [70, -48],
      [12, 78],
    ];

    for (const [sx, sz] of spots) {
      const g = this.ground(sx, sz);
      const angle = this.rng.range(0, Math.PI * 2);
      const len = this.rng.range(26, 40);

      // 쓰러진 몸통 — 축 정렬로 눕혀 콜라이더를 정확히 맞춘다
      const alongX = this.rng.chance(0.5);
      const w = alongX ? len : 3.4;
      const d = alongX ? 3.4 : len;
      this.box('metal', 'metal', sx, sz, g - 0.8, w, 3.6, d);

      // 부러진 밑동
      this.box('metal', 'metal', sx - Math.cos(angle) * 6, sz - Math.sin(angle) * 6,
        this.ground(sx - Math.cos(angle) * 6, sz - Math.sin(angle) * 6) - 1,
        4.5, this.rng.range(6, 11), 4.5);

      // 첨탑에서 떨어져 나온 패널 다발
      for (let i = 0; i < 14; i++) {
        const px = sx + this.rng.range(-16, 16);
        const pz = sz + this.rng.range(-16, 16);
        if (!this.inWorld(px, pz)) continue;
        this.buckets.panel.push({
          x: px,
          y: this.ground(px, pz) + 0.25,
          z: pz,
          rx: this.rng.range(-1.4, 1.4),
          ry: this.rng.range(0, Math.PI * 2),
          rz: this.rng.range(-0.5, 0.5),
          sx: this.rng.range(2, 4.5),
          sy: 0.12,
          sz: this.rng.range(2, 4.5),
          color: this.color('panel'),
        });
      }
    }
  }

  /** 월드 전역의 작은 파편 — 충돌 없음, 걸어서 넘어갈 수 있다 */
  private scatterDebris(): void {
    const count = 3200;
    for (let i = 0; i < count; i++) {
      const x = this.rng.range(-95, 95);
      const z = this.rng.range(-95, 95);
      if (!this.inWorld(x, z, 3)) continue;

      const s = this.rng.range(0.1, 0.85);
      const g = this.ground(x, z);
      const isMetal = this.rng.chance(0.3);

      this.buckets[isMetal ? 'metal' : 'concrete'].push({
        x,
        y: g + s * 0.22,
        z,
        rx: this.rng.range(-0.5, 0.5),
        ry: this.rng.range(0, Math.PI * 2),
        rz: this.rng.range(-0.5, 0.5),
        sx: s * this.rng.range(0.7, 1.6),
        sy: s * this.rng.range(0.4, 0.9),
        sz: s * this.rng.range(0.7, 1.6),
        color: this.color(isMetal ? 'metal' : this.rng.chance(0.25) ? 'rust' : 'concrete'),
      });
    }
  }

  /** AI의 태양광 패널 파편 — 이 세계가 왜 이렇게 됐는지 말해주는 오브젝트 */
  private scatterPanels(): void {
    const count = 340;
    for (let i = 0; i < count; i++) {
      const x = this.rng.range(-92, 92);
      const z = this.rng.range(-92, 92);
      if (!this.inWorld(x, z, 4)) continue;
      // 분화구 중심부는 폭심지라 깨끗이 날아갔다
      if (Math.hypot(x, z) < 14) continue;

      const g = this.ground(x, z);
      const half = this.rng.chance(0.35);

      this.buckets.panel.push({
        x,
        y: g + (half ? this.rng.range(0.4, 1.6) : 0.16),
        z,
        rx: half ? this.rng.range(-1.5, 1.5) : this.rng.range(-0.28, 0.28),
        ry: this.rng.range(0, Math.PI * 2),
        rz: half ? this.rng.range(-0.8, 0.8) : this.rng.range(-0.2, 0.2),
        sx: this.rng.range(1.6, 4.2),
        sy: 0.1,
        sz: this.rng.range(1.6, 4.2),
        color: this.color('panel'),
      });
    }
  }

  /** 콘크리트에서 삐져나온 철근 */
  private scatterRebar(): void {
    const count = 620;
    for (let i = 0; i < count; i++) {
      const x = this.rng.range(-90, 90);
      const z = this.rng.range(-90, 90);
      if (!this.inWorld(x, z, 6)) continue;

      const h = this.rng.range(0.8, 3.2);
      const g = this.ground(x, z);
      this.buckets.rebar.push({
        x,
        y: g + h * 0.42,
        z,
        rx: this.rng.range(-0.42, 0.42),
        ry: this.rng.range(0, Math.PI * 2),
        rz: this.rng.range(-0.42, 0.42),
        sx: this.rng.range(0.05, 0.11),
        sy: h,
        sz: this.rng.range(0.05, 0.11),
        color: this.color('rust'),
      });
    }
  }

  /**
   * 지면의 잔모래와 콘크리트 알갱이.
   *
   * 큰 덩어리만 있으면 바닥이 비어 보인다. 발치의 작은 알갱이가
   * 스케일을 알려주고 표면이 "부서진 것들로 덮여 있다"는 인상을 만든다.
   */
  private scatterPebbles(): void {
    const count = 5200;
    for (let i = 0; i < count; i++) {
      const x = this.rng.range(-95, 95);
      const z = this.rng.range(-95, 95);
      if (!this.inWorld(x, z, 2)) continue;

      const s = this.rng.range(0.05, 0.19);
      this.buckets.pebble.push({
        x,
        y: this.ground(x, z) + s * 0.3,
        z,
        rx: this.rng.range(0, Math.PI),
        ry: this.rng.range(0, Math.PI),
        rz: this.rng.range(0, Math.PI),
        sx: s * this.rng.range(0.7, 1.5),
        sy: s * this.rng.range(0.5, 1.0),
        sz: s * this.rng.range(0.7, 1.5),
        color: this.color(this.rng.chance(0.22) ? 'rust' : 'concrete'),
      });
    }
  }

  /**
   * 무너진 구조물 사이에 늘어진 전선.
   *
   * 폐허를 "부서진 덩어리들"이 아니라 "한때 작동하던 시설"로 읽히게 하는 것은
   * 이런 가늘고 긴 요소다. 두 지점을 잡아 그 사이를 처지는 곡선으로 잇는다.
   */
  private stringCables(): void {
    const strands = 90;
    const segments = 7;

    for (let i = 0; i < strands; i++) {
      const ax = this.rng.range(-84, 84);
      const az = this.rng.range(-84, 84);
      if (!this.inWorld(ax, az, 10)) continue;

      const angle = this.rng.range(0, Math.PI * 2);
      const span = this.rng.range(4, 11);
      const bx = ax + Math.cos(angle) * span;
      const bz = az + Math.sin(angle) * span;
      if (!this.inWorld(bx, bz, 6)) continue;

      // 양 끝은 지면보다 높은 지지점 — 남은 기둥이나 벽 위라고 친다
      const ay = this.ground(ax, az) + this.rng.range(2.2, 4.6);
      const by = this.ground(bx, bz) + this.rng.range(2.0, 4.4);
      const sag = this.rng.range(0.9, 2.4);
      const color = this.color('cable');

      let px = ax;
      let py = ay;
      let pz = az;

      for (let k = 1; k <= segments; k++) {
        const t = k / segments;
        const qx = ax + (bx - ax) * t;
        const qz = az + (bz - az) * t;
        // 포물선으로 처진다
        const qy = ay + (by - ay) * t - Math.sin(Math.PI * t) * sag;

        const dx = qx - px;
        const dy = qy - py;
        const dz = qz - pz;
        const len = Math.hypot(dx, dy, dz);

        this.buckets.cable.push({
          x: (px + qx) / 2,
          y: (py + qy) / 2,
          z: (pz + qz) / 2,
          // 실린더의 축(Y)을 선분 방향으로 돌린다
          rx: Math.atan2(Math.hypot(dx, dz), dy),
          ry: Math.atan2(dx, dz),
          rz: 0,
          sx: this.rng.range(0.035, 0.06),
          sy: len,
          sz: this.rng.range(0.035, 0.06),
          color,
        });

        px = qx;
        py = qy;
        pz = qz;
      }
    }
  }

  // ---------------------------------------------------------------- 메시 조립

  private buildMeshes(): void {
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const rodGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 5, 1);
    const pebbleGeo = new THREE.DodecahedronGeometry(0.5, 0);

    const mk = (
      kind: Kind,
      geo: THREE.BufferGeometry,
      matOpts: THREE.MeshStandardMaterialParameters,
    ): void => {
      const defs = this.buckets[kind];
      if (defs.length === 0) return;

      const mat = new THREE.MeshStandardMaterial({
        flatShading: true,
        ...matOpts,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, defs.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `ruins:${kind}`;

      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3();

      for (let i = 0; i < defs.length; i++) {
        const d = defs[i]!;
        pos.set(d.x, d.y, d.z);
        // 케이블은 방위각(Y)을 먼저 준 뒤 기울인다
        e.set(d.rx, d.ry, d.rz, kind === 'cable' ? 'YXZ' : 'XYZ');
        q.setFromEuler(e);
        scl.set(d.sx, d.sy, d.sz);
        m.compose(pos, q, scl);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, d.color);
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();

      this.group.add(mesh);
      this.stats.instances += defs.length;
    };

    mk('concrete', boxGeo, { roughness: 0.95, metalness: 0.0 });
    mk('metal', boxGeo, { roughness: 0.55, metalness: 0.38 });
    mk('dome', boxGeo, { roughness: 0.5, metalness: 0.06 });
    mk('panel', boxGeo, { roughness: 0.32, metalness: 0.34 });
    mk('rebar', rodGeo, { roughness: 0.68, metalness: 0.4 });
    mk('cable', rodGeo, { roughness: 0.94, metalness: 0.05 });
    mk('pebble', pebbleGeo, { roughness: 0.97, metalness: 0.0 });
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
        o.dispose();
      }
    });
  }
}
