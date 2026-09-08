import * as THREE from 'three';
import { FARM } from '../config';
import { Terrain } from '../world/Terrain';
import { Buildings, type BedCell } from '../world/Buildings';
import type { Inventory } from './Inventory';
import { itemDef, type BuildKind } from './Items';

/**
 * 좌클릭 설치.
 *
 * 밭은 한 칸씩 놓는다. 격자에 붙기 때문에 이어 놓으면 저절로 줄이 서고,
 * 한 칸이라 어디에 놓을지 세밀하게 고를 수 있다.
 *
 * 놓기 전에 미리보기가 뜬다 — 칸의 색이 가부와 비옥도를 함께 알려주므로
 * "여기가 좋은 땅인가"를 삽을 대기 전에 판단할 수 있다.
 * 비옥도가 기준에 못 미치는 땅에는 아예 만들 수 없다.
 *
 * FARM.bedWidth/bedDepth를 키우면 여러 칸을 통째로 놓는 구획 방식이 된다.
 */
export class Placement {
  /** 설치 예정 지점 (구획의 기준 칸) */
  readonly aim = new THREE.Vector3();
  /** 이번 프레임의 배치 후보 칸들 */
  cells: BedCell[] = [];
  valid = false;
  reason: string | null = null;
  /** 구획을 돌렸는지 — 가로 3×2 ↔ 세로 2×3 */
  rotated = false;

  /**
   * 방벽·문의 방향 — '자동'은 옆 칸을 보고 이어지는 쪽으로 선다.
   *
   * 기본을 자동으로 둔 이유는, R 을 모르는 사람도 구역을 두를 수 있어야 하기
   * 때문이다. 방향을 손으로만 정하게 두면 대부분은 한 방향으로만 늘어놓다가
   * 모퉁이에서 막힌다.
   */
  orientMode: 'auto' | 'x' | 'z' = 'auto';

  /** 이번 프레임에 실제로 서게 될 방향 (방향이 없는 것이면 null) */
  orient: 0 | 1 | null = null;

  private readonly terrain: Terrain;
  private readonly buildings: Buildings;
  private readonly inventory: Inventory;

  private readonly origin = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(terrain: Terrain, buildings: Buildings, inventory: Inventory) {
    this.terrain = terrain;
    this.buildings = buildings;
    this.inventory = inventory;
  }

  /** 지금 선택한 아이템이 설치 가능한 것인지 */
  get heldKind(): BuildKind | null {
    const slot = this.inventory.selectedSlot;
    if (!slot) return null;
    return itemDef(slot.id).places ?? null;
  }

  /** 이번 설치에 드는 아이템 개수 */
  get cost(): number {
    return this.heldKind === 'plot' ? this.cells.length : 1;
  }

  /** 구획의 평균 비옥도 */
  get averageFertility(): number {
    if (this.cells.length === 0) return 0;
    return this.cells.reduce((a, c) => a + c.fertility, 0) / this.cells.length;
  }

  /**
   * `R`.
   *
   * 밭은 구획을 눕히고, 방벽·문은 방향을 돌린다 — 손에 든 것이 곧 의도라
   * 키를 나누지 않았다. 방벽은 자동 → 가로 → 세로 로 도는데, 자동을 첫 칸에
   * 두어야 아무것도 모르고 한 번 눌러본 사람이 더 나빠지지 않는다.
   */
  cycleRotation(): void {
    const kind = this.heldKind;
    if (kind === 'wall' || kind === 'gate') {
      this.orientMode =
        this.orientMode === 'auto' ? 'x' : this.orientMode === 'x' ? 'z' : 'auto';
      return;
    }
    this.rotated = !this.rotated;
  }

  /** 지금 방향을 한 마디로 — 미리보기 옆에 붙는다 */
  get orientLabel(): string {
    if (this.orient === null) return '';
    const dir = this.orient === 0 ? '가로' : '세로';
    return this.orientMode === 'auto' ? `${dir} (자동)` : dir;
  }

  /**
   * 조준 지점과 구획을 갱신한다.
   * @param camera 화면 중앙 방향을 얻기 위한 카메라
   * @param playerPos 거리 제한의 기준
   */
  update(camera: THREE.Camera, playerPos: THREE.Vector3): void {
    this.valid = false;
    this.reason = null;

    const kind = this.heldKind;
    this.orient = null;
    if (!kind) {
      if (this.cells.length > 0) {
        this.cells = [];
        this.buildings.hideGhost();
      }
      return;
    }

    if (!this.aimGround(camera, playerPos)) {
      this.cells = [];
      this.buildings.hideGhost();
      this.reason = '땅을 보고 있지 않다';
      return;
    }

    const { gx, gz } = Buildings.toGrid(this.aim.x, this.aim.z);
    this.cells = kind === 'plot' ? this.bedCells(gx, gz) : [
      this.buildings.evaluateCell(gx, gz, false),
    ];

    // 가진 흙보다 많은 칸은 만들 수 없다
    const held = this.inventory.selectedSlot?.count ?? 0;
    if (this.cost > held) {
      this.reason = `${this.cost}칸에 ${this.cost}개가 필요하다 (${held}개 보유)`;
    } else {
      const bad = this.cells.find((c) => !c.ok);
      this.reason = bad?.reason ?? null;
      this.valid = !bad;
    }

    if (kind === 'wall' || kind === 'gate') {
      this.orient =
        this.orientMode === 'auto'
          ? this.buildings.suggestRotation(gx, gz)
          : this.orientMode === 'x'
            ? 0
            : 1;
    }

    this.buildings.showGhost(this.cells, this.orient);
  }

  /** 화면 중앙에서 지면으로 광선을 던져 조준점을 찾는다 */
  private aimGround(camera: THREE.Camera, playerPos: THREE.Vector3): boolean {
    camera.getWorldPosition(this.origin);
    camera.getWorldDirection(this.dir);

    let hit = -1;
    for (let t = 0.5; t < 60; t += 0.25) {
      const x = this.origin.x + this.dir.x * t;
      const y = this.origin.y + this.dir.y * t;
      const z = this.origin.z + this.dir.z * t;
      if (y <= this.terrain.sampleHeight(x, z)) {
        hit = t;
        break;
      }
    }
    if (hit < 0) return false;

    this.aim.set(this.origin.x + this.dir.x * hit, 0, this.origin.z + this.dir.z * hit);

    // 손이 닿는 거리로 당긴다
    const dx = this.aim.x - playerPos.x;
    const dz = this.aim.z - playerPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > FARM.placeReach) {
      const k = FARM.placeReach / dist;
      this.aim.x = playerPos.x + dx * k;
      this.aim.z = playerPos.z + dz * k;
    }
    this.aim.y = this.terrain.sampleHeight(this.aim.x, this.aim.z);
    return true;
  }

  /**
   * 조준 칸을 중심으로 구획을 펼친다.
   * 중심에 맞춰야 미리보기가 조준점을 따라오는 느낌이 난다.
   */
  private bedCells(gx: number, gz: number): BedCell[] {
    const w = this.rotated ? FARM.bedDepth : FARM.bedWidth;
    const d = this.rotated ? FARM.bedWidth : FARM.bedDepth;
    const x0 = gx - Math.floor((w - 1) / 2);
    const z0 = gz - Math.floor((d - 1) / 2);

    const out: BedCell[] = [];
    for (let j = 0; j < d; j++) {
      for (let i = 0; i < w; i++) {
        out.push(this.buildings.evaluateCell(x0 + i, z0 + j, true));
      }
    }

    // 밭은 놓일 때 땅을 고르므로 칸마다의 미세한 굴곡은 따지지 않는다.
    // 대신 구획 전체의 고저차를 본다 — 비탈에 걸친 밭은 만들 수 없다.
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of out) {
      if (c.y < lo) lo = c.y;
      if (c.y > hi) hi = c.y;
    }
    if (hi - lo > FARM.bedMaxDrop) {
      for (const c of out) {
        c.ok = false;
        c.reason = '땅이 고르지 않다';
      }
    }

    return out;
  }

  /**
   * 실제로 설치한다.
   * @returns 결과 메시지 (성공/실패 모두)
   */
  place(): { ok: boolean; message: string } | null {
    const kind = this.heldKind;
    if (!kind) return null;

    if (!this.valid) {
      return { ok: false, message: this.reason ?? '여기엔 놓을 수 없다' };
    }

    if (kind === 'plot') {
      const err = this.buildings.placeBed(this.cells);
      if (err) return { ok: false, message: err };
      for (let i = 0; i < this.cells.length; i++) {
        this.inventory.takeOneSelected();
      }
      const pct = Math.round(this.averageFertility * 100);
      const many = this.cells.length > 1 ? `${this.cells.length}칸을 ` : '';
      return { ok: true, message: `${many}일궜다 · 비옥도 ${pct}%` };
    }

    // 방벽과 문은 옆 칸을 보고 알아서 돌아선다 (R 로 덮어쓸 수 있다).
    // 판이 한 축만 보고 서면 이어 놓아도 벽이 아니라 울타리가 되어
    // 구역을 두를 수 없다 — 그래서 자동을 기본으로 두었다.
    const rot: 0 | 1 = this.orient ?? 0;
    const err = this.buildings.tryPlace(kind, this.aim.x, this.aim.z, rot);
    if (err) return { ok: false, message: err };
    this.inventory.takeOneSelected();
    return { ok: true, message: PLACED_MESSAGE[kind] ?? '세웠다' };
  }
}

/** 세우고 나서 띄우는 한 줄 */
const PLACED_MESSAGE: Partial<Record<BuildKind, string>> = {
  collector: '빗물 집수기를 세웠다',
  wall: '방벽을 세웠다',
  gate: '문을 달았다',
  campfire: '화톳불을 피웠다',
  workbench: '작업대를 세웠다',
  storage: '보관함을 놓았다',
  compost: '퇴비 더미를 놓았다',
  trap: '함정을 묻었다',
  plant: '토양 재생 플랜트를 세웠다',
};
