import * as THREE from 'three';
import { cropStages } from './CropShapes';
import { BUILD, FARM } from '../config';
import { Terrain } from './Terrain';
import { clamp, Rng } from '../util/math';
import { ColliderWorld } from './Collision';
import { mergeBoxes, type BoxSpec } from '../util/geometry';
import { StorageBox } from '../gameplay/Storage';
import type { BuildKind, ItemId } from '../gameplay/Items';

export type PlotStage = 'empty' | 'planted' | 'ripe';

export interface Placed {
  kind: BuildKind;
  /** 격자 좌표 */
  gx: number;
  gz: number;
  x: number;
  y: number;
  z: number;
  index: number;

  // --- 밭 전용
  stage: PlotStage;
  /** 밭: 0..1 자란 정도. 퇴비 더미: 다음 한 줌까지의 삭은 정도 */
  growth: number;
  /** 밭: 남은 수분 (일 단위). 퇴비 더미: 아직 삭지 않은 유기물 몫 */
  moisture: number;

  /**
   * 집수기: 뜰 수 있는 물. 퇴비 더미: 꺼낼 수 있는 흙.
   * 둘 다 "이 설비가 내놓을 준비가 된 양"이라는 한 가지 뜻이다.
   */
  stored: number;

  /**
   * 화톳불 전용 — 남은 연료 (일 단위).
   *
   * 0이면 불이 꺼진다. 꺼진 불은 빛도 온기도 없고 물도 끓이지 못한다.
   * 자리와 형체는 남으므로 마른 풀만 넣으면 다시 살아난다.
   */
  fuel: number;

  /**
   * 방벽·문 전용 — 서 있는 방향. 0 = X축을 따라, 1 = Z축을 따라.
   *
   * 판이 늘 같은 축을 보고 서면, 이어 놓아도 벽이 아니라 울타리가 된다.
   * 구역을 두르려면 두 방향이 다 필요하다.
   */
  rot: 0 | 1;

  /** 문 전용 — 열려 있으면 지나갈 수 있다 */
  openGate: boolean;

  /** 이 칸 땅의 비옥도 0..1 — 성장 속도와 수확량을 좌우한다 */
  fertility: number;
}

/** 밭 구획 한 칸의 배치 후보 */
export interface BedCell {
  gx: number;
  gz: number;
  x: number;
  z: number;
  y: number;
  fertility: number;
  ok: boolean;
  reason: string | null;
}

const MAX_PLACED = 400;

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
const UP_AXIS = new THREE.Vector3(0, 1, 0);

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
/** 밭 한 칸을 일굴 때 주변에 남는 흙덩이 개수 */
const CLUMPS_PER_PLOT = 6;
/** 작물 성장을 몇 단계로 나눠 다시 그릴지 — 매 프레임 버퍼 업로드를 막는다 */
const GROWTH_STEPS = 26;
/** 미리보기 칸 최대 개수 */
const GHOST_MAX = 32;

/** 부피가 있어 몸으로 막히는 설치물 */
const SOLID: Partial<Record<BuildKind, { half: number; height: number }>> = {
  wall: { half: BUILD.wallHalf, height: BUILD.wallHeight },
  // 닫힌 문은 벽과 똑같이 막는다
  gate: { half: BUILD.wallHalf, height: BUILD.wallHeight },
  collector: { half: BUILD.collectorHalf, height: BUILD.collectorHeight },
  workbench: { half: 0.56, height: 0.98 },
  storage: { half: 0.48, height: 0.72 },
  compost: { half: 0.5, height: 0.66 },
};

/**
 * 철거하면 돌려주는 것.
 *
 * 전액이다. 잘못 놓은 것을 되돌리는 데 대가를 물리면 아무도 짓지 않는다 —
 * 이 게임에서 아까워야 할 것은 자재가 아니라 흙과 시간이다.
 * 다만 밭에서 자라던 작물과 화톳불에 남은 연료는 돌려주지 않는다.
 */
const REFUND: Partial<Record<BuildKind, ItemId>> = {
  plot: 'soil',
  collector: 'rainCollector',
  wall: 'wall',
  gate: 'gate',
  campfire: 'campfire',
  workbench: 'workbench',
  storage: 'storageBox',
  compost: 'compostBin',
  trap: 'trap',
};
/**
 * 종류 표 — 새 설치물을 더할 때 **여기 한 곳만** 채우면 된다.
 *
 * 종류 목록을 손으로 적은 배열로 두면 새 종류를 조용히 빠뜨린다. 빠지면
 * `reset()` 이 그 통을 안 비우고 `flush()` 가 그 버퍼를 안 올린다 — 둘 다
 * 화면에만 남고 자료는 사라지는 사고다 (8.3).
 *
 * 완전한 Record 는 하나라도 빠지면 컴파일이 깨진다. 그래서 목록(`ALL_KINDS`)도
 * 통(`byKind`)도 전부 이 표에서 뽑는다 — 컴파일러가 지키는 표는 하나면 된다.
 */
const KIND_TABLE: Record<BuildKind, true> = {
  plot: true,
  collector: true,
  wall: true,
  gate: true,
  campfire: true,
  workbench: true,
  storage: true,
  compost: true,
  trap: true,
};
const ALL_KINDS = Object.keys(KIND_TABLE) as BuildKind[];
const CELL = 1;
const HASH_ORIGIN = 512;
const HASH_STRIDE = 2048;

/**
 * 플레이어가 설치한 것들 — 밭과 빗물 집수기.
 *
 * 밭은 이 프로토타입이 검증하려는 핵심 루프의 종착지다.
 * 흙 한 줌으로 한 칸을 만들고, 씨앗을 심고, 물을 대고, 이틀을 기다려 거둔다.
 * 수확물에 씨앗이 함께 나오므로 한 번 성공하면 농사는 스스로 굴러간다 —
 * 대신 밭을 넓히려면 계속 흙을 찾아 멀리 나가야 한다.
 */
export class Buildings {
  readonly group = new THREE.Group();
  readonly placed: Placed[] = [];

  private readonly terrain: Terrain;
  private readonly cells = new Map<number, Placed>();

  /** 플레이어가 지은 것들의 충돌 — 폐허와 분리해 두어야 초기화가 안전하다 */
  readonly colliders = new ColliderWorld(4);

  private plotMesh!: THREE.InstancedMesh;
  /**
   * 작물 — 성장 단계마다 형상이 다르므로 메시를 셋으로 나눈다.
   * 인스턴싱이라 한 메시에 여러 형상을 담을 수 없다.
   */
  private cropMeshes: THREE.InstancedMesh[] = [];
  private collectorMesh!: THREE.InstancedMesh;
  private wallMesh!: THREE.InstancedMesh;
  private gateMesh!: THREE.InstancedMesh;
  private compostMesh!: THREE.InstancedMesh;
  private trapMesh!: THREE.InstancedMesh;
  private fireMesh!: THREE.InstancedMesh;
  private flameMesh!: THREE.InstancedMesh;
  /** 밭 주변에 흩어진 흙덩이 — 일군 흔적 */
  private clumpMesh!: THREE.InstancedMesh;
  private clumpCount = 0;
  /** 설치 미리보기 격자 */
  private benchMesh!: THREE.InstancedMesh;
  private boxMesh!: THREE.InstancedMesh;
  private ghostMesh!: THREE.InstancedMesh;
  private readonly ghostColor = new THREE.Color();

  /** 종류 표에서 뽑아 만든다 — 종류를 더해도 통이 비지 않는다 */
  private readonly byKind = Object.fromEntries(
    ALL_KINDS.map((k) => [k, [] as Placed[]]),
  ) as Record<BuildKind, Placed[]>;
  private readonly clumpRng = new Rng(4242);

  /** 보관함마다의 내용물 */
  readonly boxes = new Map<Placed, StorageBox>();

  /** 화톳불 조명 — 개수가 적으므로 실제 PointLight를 붙인다 */
  private readonly fireLights: THREE.PointLight[] = [];
  private flicker = 0;

  private get plots(): Placed[] {
    return this.byKind.plot;
  }

  private get collectors(): Placed[] {
    return this.byKind.collector;
  }

  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    this.group.name = 'buildings';
    this.buildMeshes();
  }

  // ---------------------------------------------------------------- 설치

  private key(gx: number, gz: number): number {
    return (gx + HASH_ORIGIN) * HASH_STRIDE + (gz + HASH_ORIGIN);
  }

  /** 이 칸에 이미 무언가 있는지 */
  occupied(gx: number, gz: number): boolean {
    return this.cells.has(this.key(gx, gz));
  }

  static toGrid(x: number, z: number): { gx: number; gz: number } {
    return { gx: Math.round(x / CELL), gz: Math.round(z / CELL) };
  }

  /**
   * 밭 구획 한 칸의 배치 가능 여부를 따진다.
   *
   * 밭만 비옥도를 요구한다 — 이 세계에서 흙은 아무 데나 있는 것이 아니고,
   * 그 제약이 "좋은 땅을 찾아다니는 일"을 플레이로 만든다.
   */
  evaluateCell(gx: number, gz: number, requireFertile: boolean): BedCell {
    const x = gx * CELL;
    const z = gz * CELL;
    const fertility = this.terrain.sampleSoilRichness(x, z);
    const cell: BedCell = {
      gx,
      gz,
      x,
      z,
      y: this.terrain.sampleHeight(x, z),
      fertility,
      ok: true,
      reason: null,
    };

    if (this.occupied(gx, gz)) {
      cell.ok = false;
      cell.reason = '이미 무언가 있다';
    } else if (requireFertile && fertility < FARM.minFertility) {
      cell.ok = false;
      // 가진 흙이 모자란다는 뜻으로 읽히면 안 된다. 이건 땅의 상태다.
      // 숫자를 같이 보여줘야 어디를 찾아다녀야 하는지 알 수 있다.
      const have = Math.round(fertility * 100);
      const need = Math.round(FARM.minFertility * 100);
      cell.reason = `이 땅은 메말랐다 · 비옥도 ${have}% (${need}% 필요)`;
    } else if (this.terrain.sampleNormal(x, z).y < FARM.maxPlaceSlopeNormalY) {
      cell.ok = false;
      cell.reason = '땅이 너무 기울었다';
    }
    return cell;
  }

  /**
   * 밭 구획을 통째로 놓는다.
   * @returns 실패 사유. 성공이면 null
   */
  placeBed(cells: BedCell[]): string | null {
    if (cells.some((c) => !c.ok)) return cells.find((c) => !c.ok)?.reason ?? '놓을 수 없다';
    if (this.placed.length + cells.length > MAX_PLACED) return '더는 지을 수 없다';

    // 구획 전체를 같은 높이로 다진다 — 밭은 평평해야 물이 고이고, 보기에도 줄이 선다
    const levelY = cells.reduce((a, c) => a + c.y, 0) / cells.length;
    for (const cell of cells) {
      this.placeCell('plot', cell.gx, cell.gz, cell.fertility, levelY);
    }
    this.flush('plot');
    return null;
  }

  /**
   * 설치를 시도한다.
   * @returns 실패 사유. 성공이면 null
   */
  tryPlace(kind: BuildKind, x: number, z: number, rot: 0 | 1 = 0): string | null {
    const { gx, gz } = Buildings.toGrid(x, z);
    if (this.occupied(gx, gz)) return '이미 무언가 있다';
    if (this.placed.length >= MAX_PLACED) return '더는 지을 수 없다';

    const wx = gx * CELL;
    const wz = gz * CELL;

    // 평평한 곳에만 — 비탈에 걸친 밭은 보기에도 이상하고 물도 고이지 않는다
    if (this.terrain.sampleNormal(wx, wz).y < FARM.maxPlaceSlopeNormalY) {
      return '땅이 너무 기울었다';
    }

    this.placeCell(kind, gx, gz, this.terrain.sampleSoilRichness(wx, wz), undefined, rot);
    this.flush(kind);
    return null;
  }

  /** 한 칸을 실제로 등록한다 (검사는 호출부에서 끝나 있어야 한다) */
  private placeCell(
    kind: BuildKind,
    gx: number,
    gz: number,
    fertility: number,
    levelY?: number,
    rot: 0 | 1 = 0,
  ): Placed {
    const wx = gx * CELL;
    const wz = gz * CELL;
    const list = this.byKind[kind];
    const node: Placed = {
      kind,
      gx,
      gz,
      x: wx,
      y: levelY ?? this.terrain.sampleHeight(wx, wz),
      z: wz,
      index: list.length,
      stage: 'empty',
      growth: 0,
      moisture: 0,
      // 함정은 남은 횟수를 여기에 담는다 (집수기의 물, 퇴비의 흙과 같은 자리)
      stored: kind === 'trap' ? BUILD.trapUses : 0,
      // 갓 세운 불에는 이미 불쏘시개가 들어 있다 — 세우자마자 꺼지면 황당하다
      fuel: kind === 'campfire' ? BUILD.fuelOnBuild : 0,
      rot,
      // 문은 닫힌 채로 선다. 열어둔 채 밤이 오면 벽을 세운 뜻이 없다.
      openGate: false,
      fertility,
    };

    this.placed.push(node);
    list.push(node);
    this.cells.set(this.key(gx, gz), node);
    this.registerCollider(node);
    this.writeInstance(node);
    // 밭은 일군 흔적을 남긴다
    if (kind === 'plot') this.scatterClumps(node);
    if (kind === 'campfire') this.addFireLight(node);
    if (kind === 'storage') this.boxes.set(node, new StorageBox());
    return node;
  }

  /**
   * 부피가 있는 것만 충돌을 갖는다.
   * 밭은 밟고 지나갈 수 있어야 하고, 화톳불도 넘어갈 수 있어야 답답하지 않다.
   */
  private registerCollider(node: Placed): void {
    const spec = SOLID[node.kind];
    if (!spec) return;
    // 열린 문은 지나갈 수 있어야 한다 — 벽으로 두르고 자기도 못 들어가면 곤란하다
    if (node.kind === 'gate' && node.openGate) return;
    const half = spec.half;
    const height = spec.height;
    this.colliders.add({
      minX: node.x - half,
      maxX: node.x + half,
      minY: node.y - 0.4,
      maxY: node.y + height,
      minZ: node.z - half,
      maxZ: node.z + half,
    });
  }

  /**
   * 충돌 집합을 전부 다시 만든다.
   *
   * 문을 여닫거나 무언가를 철거하면 **없어진 충돌**이 생긴다. ColliderWorld 는
   * 하나만 빼내는 방법이 없으므로 통째로 다시 쌓는다. 설치물은 많아야 수백 개라
   * 이 정도면 충분하고, 부분 삭제를 흉내 내다 유령 벽을 남기는 것보다 안전하다.
   */
  private rebuildColliders(): void {
    this.colliders.clear();
    for (const node of this.placed) this.registerCollider(node);
  }

  /**
   * 문을 여닫는다.
   * @returns 여닫은 뒤의 상태 (문이 아니면 null)
   */
  toggleGate(node: Placed): boolean | null {
    if (node.kind !== 'gate') return null;
    node.openGate = !node.openGate;
    this.rebuildColliders();
    this.refresh(node);
    return node.openGate;
  }

  /**
   * 설치물 하나를 걷어낸다.
   * @returns 돌려줄 아이템과 개수 (철거할 수 없으면 null)
   */
  demolish(node: Placed): { id: ItemId; count: number } | null {
    const list = this.byKind[node.kind];
    const at = list.indexOf(node);
    if (at < 0) return null;

    // 밭 한 칸은 흙 한 줌으로 되돌아온다. 자란 작물은 잃는다 —
    // 다 키운 밭을 실수로 걷어내는 일이 없도록 수확한 뒤에 걷게 만드는 편이 낫다.
    const refund = REFUND[node.kind];

    list.splice(at, 1);
    const all = this.placed.indexOf(node);
    if (all >= 0) this.placed.splice(all, 1);
    this.cells.delete(this.key(node.gx, node.gz));
    this.boxes.delete(node);

    // 인스턴스 번호는 배열 위치를 그대로 쓰므로, 뒤엣것들을 당겨 다시 쓴다
    for (let i = at; i < list.length; i++) {
      list[i]!.index = i;
      this.writeInstance(list[i]!);
    }
    this.hideTail(node.kind, list.length);
    this.flush(node.kind);
    this.rebuildColliders();
    this.rebuildFireLights();
    return refund ? { id: refund, count: 1 } : null;
  }

  /**
   * 종류마다 어느 메시가 그리는가.
   *
   * 처음에는 삼항 연산자를 이어 붙였는데, 종류가 여덟이 되자
   * 들여쓰기만 보고는 어느 가지가 어디에 걸리는지 알 수 없게 됐다.
   * 표는 한 줄에 한 종류라 늘어나도 읽힌다.
   *
   * **`default:` 를 두지 않는다.** 예전엔 보관함이 기본 가지에 얹혀 있었는데,
   * 그러면 새 종류가 조용히 그 가지로 흘러 `reset()` 이 제 메시를 못 지운다 —
   * 죽고 살아나면 만질 수 없는 껍데기가 그대로 선다 (8.3). 가지를 다 덮지 않으면
   * 반환형이 안 맞아 컴파일이 깨지므로, 종류가 늘면 여기서 먼저 걸린다.
   */
  private meshesFor(kind: BuildKind): THREE.InstancedMesh[] {
    switch (kind) {
      case 'plot':
        return [this.plotMesh, ...this.cropMeshes];
      case 'campfire':
        return [this.fireMesh, this.flameMesh];
      case 'collector':
        return [this.collectorMesh];
      case 'wall':
        return [this.wallMesh];
      case 'gate':
        return [this.gateMesh];
      case 'trap':
        return [this.trapMesh];
      case 'compost':
        return [this.compostMesh];
      case 'workbench':
        return [this.benchMesh];
      case 'storage':
        return [this.boxMesh];
    }
  }

  /** 줄어든 종류의 남은 인스턴스를 접어 화면에서 지운다 */
  private hideTail(kind: BuildKind, count: number): void {
    for (const mesh of this.meshesFor(kind)) {
      mesh.setMatrixAt(count, ZERO_MATRIX);
      mesh.count = count;
    }
  }

  /** 화톳불이 줄면 조명도 다시 맞춘다 */
  private rebuildFireLights(): void {
    for (const light of this.fireLights) {
      light.removeFromParent();
      light.dispose();
    }
    this.fireLights.length = 0;
    for (const node of this.byKind.campfire) this.addFireLight(node);
  }

  private addFireLight(node: Placed): void {
    if (this.fireLights.length >= BUILD.maxFireLights) return;
    const light = new THREE.PointLight(BUILD.fireColor, 0, BUILD.lightRadius * 1.6, 1.7);
    light.position.set(node.x, node.y + 0.75, node.z);
    this.group.add(light);
    this.fireLights.push(light);
  }

  // ---------------------------------------------------------------- 불빛

  /** 지금 타고 있는 불인지. 꺼진 불은 아무 일도 하지 않는다 */
  static lit(node: Placed): boolean {
    return node.kind === 'campfire' && node.fuel > 0;
  }

  /**
   * 이 지점이 화톳불 빛 안인지 (0=바깥, 1=중심).
   * 변이 생물의 접근 판정에 쓴다.
   */
  lightAt(x: number, z: number): number {
    let best = 0;
    for (const f of this.byKind.campfire) {
      if (f.fuel <= 0) continue;
      const d = Math.hypot(f.x - x, f.z - z);
      if (d >= BUILD.lightRadius) continue;
      best = Math.max(best, 1 - d / BUILD.lightRadius);
    }
    return best;
  }

  /**
   * 화톳불에 연료를 넣는다.
   * @returns 실제로 들어갔는지 (가득 찼으면 false)
   */
  refuel(node: Placed, amount: number): boolean {
    if (node.kind !== 'campfire') return false;
    if (node.fuel >= BUILD.fuelCapacity) return false;
    const wasOut = node.fuel <= 0;
    node.fuel = Math.min(BUILD.fuelCapacity, node.fuel + amount);
    // 꺼졌다 살아난 불은 형체가 달라진다 — 다시 그려야 한다
    if (wasOut) this.refresh(node);
    return true;
  }

  /**
   * 이 지점을 밟은 것이 함정에 걸렸는지 본다.
   *
   * 함정은 쓸수록 닳아 없어진다 — 한 번 깔고 잊는 것이 되면
   * "사전 준비"가 아니라 그냥 영구 방어막이 된다.
   *
   * @returns 입힐 피해 (걸리지 않았으면 0)
   */
  triggerTrap(x: number, z: number): number {
    const traps = this.byKind.trap;
    for (let i = 0; i < traps.length; i++) {
      const t = traps[i]!;
      if (t.stored <= 0) continue;
      if (Math.hypot(t.x - x, t.z - z) > BUILD.trapRadius) continue;

      t.stored -= 1;
      if (t.stored <= 0) {
        // 다 쓴 함정은 사라진다. 자리를 비워 다시 놓을 수 있게 한다.
        this.demolishSilently(t);
      } else {
        this.writeInstance(t);
        this.flush('trap');
      }
      return BUILD.trapDamage;
    }
    return 0;
  }

  /** 부서진 함정처럼 알림 없이 사라지는 경우 */
  private demolishSilently(node: Placed): void {
    const list = this.byKind[node.kind];
    const at = list.indexOf(node);
    if (at < 0) return;
    list.splice(at, 1);
    const all = this.placed.indexOf(node);
    if (all >= 0) this.placed.splice(all, 1);
    this.cells.delete(this.key(node.gx, node.gz));
    for (let i = at; i < list.length; i++) {
      list[i]!.index = i;
      this.writeInstance(list[i]!);
    }
    this.hideTail(node.kind, list.length);
    this.flush(node.kind);
  }

  /**
   * 보관함에서 먹을 것을 꺼내 쓴다 (생존자의 식사).
   *
   * 앞에 적은 것부터 먹는다 — 잘 만든 것을 먼저 축내고 날것을 남긴다.
   * 창고가 여럿이면 순서대로 훑는다.
   *
   * @returns 실제로 꺼낸 개수
   */
  consumeFromStorage(order: ItemId[], count: number): number {
    let left = count;
    for (const id of order) {
      for (const node of this.byKind.storage) {
        const box = this.boxes.get(node);
        if (!box) continue;
        for (const slot of box.slots) {
          if (left <= 0) return count;
          if (!slot || slot.id !== id) continue;
          const take = Math.min(slot.count, left);
          slot.count -= take;
          left -= take;
          if (slot.count <= 0) box.dropAt(box.slots.indexOf(slot));
        }
      }
    }
    return count - left;
  }

  /** 이 종류를 몇 개 지었는지 */
  countOf(kind: BuildKind): number {
    return this.byKind[kind].length;
  }

  /**
   * 이 격자 칸이 울타리로 막혀 있는지 (정착지 등급의 둘러쌈 판정용).
   *
   * 문은 **닫혀 있든 열려 있든 벽으로 친다.** 여닫는 것은 사람의 사정이고,
   * 울타리로서는 이어져 있다 — 문을 열어뒀다고 두른 것이 풀리면
   * 드나들 때마다 등급이 오르내려 아무 뜻이 없어진다.
   */
  blocksAt(gx: number, gz: number): boolean {
    const node = this.cells.get(this.key(gx, gz));
    return node?.kind === 'wall' || node?.kind === 'gate';
  }

  /** 이 지점이 작업대 곁인지 */
  nearWorkbench(x: number, z: number, radius: number): boolean {
    return this.byKind.workbench.some((w) => Math.hypot(w.x - x, w.z - z) <= radius);
  }

  /** 가장 가까운 **타고 있는** 화톳불까지의 거리 (없으면 Infinity) */
  fireDistance(x: number, z: number): number {
    let best = Infinity;
    for (const f of this.byKind.campfire) {
      if (f.fuel <= 0) continue;
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < best) best = d;
    }
    return best;
  }

  /** 가장 가까운 불에서 멀어지는 방향 (정규화) */
  awayFromLight(x: number, z: number): { x: number; z: number } {
    let bestD = Infinity;
    let bx = 0;
    let bz = 0;
    for (const f of this.byKind.campfire) {
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < bestD) {
        bestD = d;
        bx = x - f.x;
        bz = z - f.z;
      }
    }
    const l = Math.hypot(bx, bz);
    return l < 1e-4 ? { x: 1, z: 0 } : { x: bx / l, z: bz / l };
  }

  // ---------------------------------------------------------------- 진행

  /**
   * @param days 이번 프레임에 흐른 게임 시간 (일 단위)
   */
  /** 비옥도가 성장 속도에 주는 배수 */
  static growthRate(fertility: number): number {
    return FARM.growthFertilityBase + fertility * FARM.growthFertilityScale;
  }

  /** 비옥도에 따른 수확량 */
  static yieldOf(fertility: number): number {
    return Math.max(
      1,
      Math.round(FARM.yieldFertilityBase + fertility * FARM.yieldFertilityScale),
    );
  }

  /**
   * 인스턴스 경계구를 다시 재야 하는지.
   *
   * InstancedMesh 의 경계구는 생성 시점에 한 번 계산된다. 설치물 메시는
   * 전부 count = 0 으로 태어나므로 그때 "빈 구"(반지름 -1)가 박히고,
   * 이후 밭을 놓아도 갱신되지 않는다. 그 상태로 프러스텀 판정을 하면
   * 시선 방향에 따라 밭 전체가 통째로 사라진다. 실제로 그랬다.
   */
  private boundsDirty = true;

  /**
   * 경계구를 다시 재는 대상 — 전부 count 0 으로 태어나는 것들.
   *
   * 손으로 나열하지 않는다. 예전엔 문이 빠져 있었고, count 0 으로 태어난 메시는
   * 빈 경계구를 문 채 갱신되지 않아 시선 방향에 따라 통째로 사라졌다.
   * 종류 표에서 뽑으면 종류를 더해도 다시는 빠지지 않는다.
   * 흙덩이만 따로 더한다 — 밭의 부산물이라 종류가 없다.
   */
  private boundsMeshes(): THREE.InstancedMesh[] {
    const out = new Set<THREE.InstancedMesh>();
    for (const kind of ALL_KINDS) {
      for (const mesh of this.meshesFor(kind)) out.add(mesh);
    }
    out.add(this.clumpMesh);
    return [...out];
  }

  /**
   * @param dryMult 수분이 마르는 속도 배수 — 먼지폭풍이 부는 날엔 빨리 마른다
   * @param growthMult 작물 성장 배수 — 계절이 정한다
   */
  update(days: number, dt = 0, dryMult = 1, growthMult = 1): void {
    // 프레임당 최대 한 번. 설치·성장으로 표시가 서면 그때만 다시 잰다.
    if (this.boundsDirty) {
      this.boundsDirty = false;
      for (const mesh of this.boundsMeshes()) mesh.computeBoundingSphere();
    }

    let dirty = false;

    for (const plot of this.plots) {
      if (plot.stage !== 'planted' || plot.moisture <= 0) continue;

      plot.moisture = Math.max(0, plot.moisture - days * dryMult);

      // 성장은 눈에 보이는 단계로 양자화한다.
      // 매 프레임 인스턴스를 다시 쓰면 밭이 늘어날수록 버퍼 업로드가 폭발한다 —
      // 작물이 실제로 한 칸 자란 순간에만 다시 그린다.
      const before = Math.floor(plot.growth * GROWTH_STEPS);
      // 계절이 성장에 곱해진다 — 혹한기에는 심어둔 것이 거의 자라지 않는다
      const rate = Buildings.growthRate(plot.fertility) * growthMult;
      plot.growth = Math.min(1, plot.growth + (days * rate) / FARM.daysToRipen);
      const after = Math.floor(plot.growth * GROWTH_STEPS);

      if (plot.growth >= 1) {
        plot.stage = 'ripe';
        this.writeInstance(plot);
        dirty = true;
      } else if (after !== before) {
        this.writeInstance(plot);
        dirty = true;
      }
    }

    if (dirty) this.flush('plot');

    // ---- 유기물이 삭아 흙이 된다
    //
    // 즉석 변환이 아니라 며칠 걸리는 설비다. 레시피 한 줄이면 흙은 그냥
    // 작물의 다른 이름이 되지만, 시간이 걸리면 미리 넣어두는 살림이 된다.
    let compostDirty = false;
    for (const bin of this.byKind.compost) {
      if (bin.moisture <= 0 || bin.stored >= FARM.compostCapacity) continue;
      bin.growth += days / FARM.compostDays;
      if (bin.growth < 1) continue;

      bin.growth = 0;
      bin.moisture -= 1;
      bin.stored += 1;
      this.writeInstance(bin);
      compostDirty = true;
    }
    if (compostDirty) this.flush('compost');

    // ---- 연료가 탄다
    //
    // 사위는 모습은 연속이지만 인스턴스는 단계로만 다시 쓴다. 매 프레임
    // 불꽃 행렬을 올리면 불이 늘어날수록 버퍼 업로드가 쌓인다 — 작물 성장과 같은 이유다.
    let fireDirty = false;
    for (const fire of this.byKind.campfire) {
      if (fire.fuel <= 0) continue;
      const before = Buildings.flameStep(fire.fuel);
      fire.fuel = Math.max(0, fire.fuel - days);
      if (Buildings.flameStep(fire.fuel) !== before) {
        this.writeInstance(fire);
        fireDirty = true;
      }
    }
    if (fireDirty) this.flush('campfire');

    // 불꽃 흔들림 — 꺼진 불은 빛도 없다
    if (dt > 0 && this.fireLights.length > 0) {
      this.flicker += dt;
      const wobble = 0.82 + Math.sin(this.flicker * 9.1) * 0.1 + Math.sin(this.flicker * 3.3) * 0.08;
      for (let i = 0; i < this.fireLights.length; i++) {
        const node = this.byKind.campfire[i];
        // 사위어갈 때 빛도 함께 줄어든다 — 숫자를 보지 않아도 곧 꺼진다는 게 읽힌다
        const strength = node ? Math.min(1, node.fuel / BUILD.fuelLowLevel) : 0;
        this.fireLights[i]!.intensity = BUILD.fireIntensity * wobble * strength;
      }
    }
  }

  /**
   * 불꽃 크기의 단계 (0 = 꺼짐).
   * 연속값을 그대로 쓰지 않고 계단으로 끊어 인스턴스 갱신 횟수를 묶는다.
   */
  private static flameStep(fuel: number): number {
    if (fuel <= 0) return 0;
    return Math.max(1, Math.ceil((fuel / BUILD.fuelCapacity) * 6));
  }

  /** 하루가 바뀔 때 — 집수기에 빗물이 고인다 */
  onNewDay(): void {
    for (const c of this.collectors) {
      c.stored = Math.min(FARM.collectorCapacity, c.stored + FARM.collectorPerDay);
    }
  }

  // ---------------------------------------------------------------- 조회

  /** 시선 앞쪽 reach 안에서 가장 가까운 설치물 */
  findTarget(
    px: number,
    pz: number,
    fx: number,
    fz: number,
    reach: number,
    coneCos: number,
  ): Placed | null {
    let best: Placed | null = null;
    let bestScore = Infinity;

    for (const node of this.placed) {
      const dx = node.x - px;
      const dz = node.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist > reach) continue;

      let aim = 1;
      if (dist > 0.4) {
        aim = (dx * fx + dz * fz) / dist;
        if (aim < coneCos) continue;
      }
      const score = dist - aim * 1.4;
      if (score < bestScore) {
        bestScore = score;
        best = node;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- 렌더

  /**
   * 갈아엎은 밭의 형태.
   *
   * 평평한 판 하나로는 "일궜다"는 인상이 나오지 않는다.
   * 바닥 판 위에 이랑을 세우고 가장자리를 흙으로 두르면
   * 멀리서도 손이 간 땅이라는 게 읽힌다.
   */
  private static plotGeometry(): THREE.BufferGeometry {
    const dark = new THREE.Color(0x3d2e1c);
    const mid = new THREE.Color(0x4f3b23);
    const light = new THREE.Color(0x62492c);
    const boxes: BoxSpec[] = [];

    // 바닥 판 (고랑 바닥)
    boxes.push({ x: 0, y: 0.05, z: 0, w: 0.94, h: 0.1, d: 0.94, color: dark });

    // 이랑 넷 — 폭과 높이를 조금씩 다르게 해 기계적으로 보이지 않게 한다
    const ridges = [-0.3, -0.1, 0.1, 0.3];
    ridges.forEach((z, i) => {
      const h = 0.085 + (i % 2) * 0.022;
      boxes.push({
        x: 0,
        y: 0.1 + h / 2,
        z,
        w: 0.9 - (i % 3) * 0.03,
        h,
        d: 0.115,
        color: i % 2 === 0 ? mid : light,
      });
    });

    // 파낸 흙을 밀어 올린 가장자리 둔덕
    boxes.push({ x: 0, y: 0.13, z: -0.46, w: 0.94, h: 0.07, d: 0.08, color: light });
    boxes.push({ x: 0, y: 0.13, z: 0.46, w: 0.94, h: 0.07, d: 0.08, color: light });
    boxes.push({ x: -0.46, y: 0.13, z: 0, w: 0.08, h: 0.07, d: 0.94, color: mid });
    boxes.push({ x: 0.46, y: 0.13, z: 0, w: 0.08, h: 0.07, d: 0.94, color: mid });

    return mergeBoxes(boxes);
  }

  /**
   * 잔해를 쌓아 만든 벽.
   * 매끈한 판이 아니라 크기가 다른 조각을 어긋나게 쌓은 모양이어야
   * "주워 모아 세웠다"가 읽힌다.
   */
  private static wallGeometry(): THREE.BufferGeometry {
    const concrete = new THREE.Color(0x6b6a62);
    const dark = new THREE.Color(0x565550);
    const metal = new THREE.Color(0x5a6169);
    const boxes: BoxSpec[] = [];

    const h = BUILD.wallHeight;
    const rows = 5;
    for (let r = 0; r < rows; r++) {
      const y = -h / 2 + (r + 0.5) * (h / rows);
      // 줄마다 좌우로 어긋나게, 두께도 조금씩 다르게
      const shift = (r % 2 === 0 ? 1 : -1) * 0.06;
      boxes.push({
        x: shift,
        y,
        z: 0,
        // 칸은 1m 다. 판이 0.92m 면 이어 놓아도 줄마다 8cm 씩 틈이 벌어져
        // "둘렀다"는 느낌이 안 난다 — 칸을 꽉 채우고 줄마다 조금씩만 뺀다.
        w: 1.0 - (r % 3) * 0.04,
        h: h / rows - 0.03,
        d: 0.34 + (r % 2) * 0.05,
        color: r % 3 === 1 ? dark : concrete,
      });
    }
    // 벽에 박아 넣은 금속 보강재
    boxes.push({ x: 0.2, y: 0, z: 0.19, w: 0.1, h: h * 0.8, d: 0.06, color: metal });
    boxes.push({ x: -0.26, y: -0.2, z: -0.19, w: 0.09, h: h * 0.5, d: 0.06, color: metal });
    // 꼭대기 마감
    boxes.push({ x: 0, y: h / 2 - 0.04, z: 0, w: 1.02, h: 0.09, d: 0.42, color: dark });

    return mergeBoxes(boxes);
  }

  /**
   * 잔해 함정 — 땅에 얕게 묻은 틀에 철판을 세워 박았다.
   *
   * 밟기 전에 보여야 한다. 안 보이는 함정은 플레이어 자신도 밟게 되고,
   * 그러면 "길목을 고른다"는 재미가 "기억력 시험"이 된다.
   * 그래서 날이 위로 삐죽 서 있고 테두리가 밝다.
   */
  private static trapGeometry(): THREE.BufferGeometry {
    const frame = new THREE.Color(0x5d5a52);
    const blade = new THREE.Color(0x9aa4ae);
    const rust = new THREE.Color(0x7a4a2c);
    const boxes: BoxSpec[] = [
      // 얕게 묻은 테두리
      { x: 0, y: 0.04, z: -0.4, w: 0.86, h: 0.09, d: 0.08, color: frame },
      { x: 0, y: 0.04, z: 0.4, w: 0.86, h: 0.09, d: 0.08, color: frame },
      { x: -0.4, y: 0.04, z: 0, w: 0.08, h: 0.09, d: 0.86, color: frame },
      { x: 0.4, y: 0.04, z: 0, w: 0.08, h: 0.09, d: 0.86, color: frame },
    ];
    // 엇갈려 세운 날 — 마주 보는 두 줄
    for (let i = 0; i < 5; i++) {
      const t = -0.3 + i * 0.15;
      boxes.push({
        x: t,
        y: 0.16,
        z: -0.1,
        w: 0.05,
        h: 0.3,
        d: 0.05,
        color: i % 2 === 0 ? blade : rust,
      });
      boxes.push({
        x: t + 0.07,
        y: 0.13,
        z: 0.12,
        w: 0.05,
        h: 0.24,
        d: 0.05,
        color: i % 2 === 0 ? rust : blade,
      });
    }
    return mergeBoxes(boxes);
  }

  /**
   * 퇴비 더미 — 잔해 판으로 두른 낮은 통에 유기물을 쌓아둔 모양.
   *
   * 흙을 만드는 설비이므로 흙처럼 보여야 한다. 금속 테두리 안에
   * 검게 삭은 더미가 봉긋하게 올라오고, 위에 마른 대가 얹혀 있다.
   */
  private static compostGeometry(): THREE.BufferGeometry {
    const metal = new THREE.Color(0x6f6a5e);
    const dark = new THREE.Color(0x4a3c28);
    const rot = new THREE.Color(0x3d3320);
    const straw = new THREE.Color(0x8a7c46);
    return mergeBoxes([
      // 네 면을 두른 낮은 판
      { x: 0, y: 0.26, z: -0.46, w: 0.98, h: 0.5, d: 0.08, color: metal },
      { x: 0, y: 0.26, z: 0.46, w: 0.98, h: 0.5, d: 0.08, color: metal },
      { x: -0.46, y: 0.26, z: 0, w: 0.08, h: 0.5, d: 0.98, color: metal },
      { x: 0.46, y: 0.26, z: 0, w: 0.08, h: 0.5, d: 0.98, color: metal },
      // 안에 쌓인 것 — 아래는 삭아 검고 위는 아직 마른 풀빛
      { x: 0, y: 0.16, z: 0, w: 0.82, h: 0.3, d: 0.82, color: rot },
      { x: 0.06, y: 0.36, z: -0.04, w: 0.6, h: 0.16, d: 0.56, color: dark },
      { x: -0.1, y: 0.44, z: 0.1, w: 0.34, h: 0.12, d: 0.3, color: straw },
      // 걸쳐둔 마른 대 몇 개
      { x: 0.1, y: 0.52, z: 0.16, w: 0.5, h: 0.05, d: 0.06, color: straw },
      { x: -0.14, y: 0.52, z: -0.18, w: 0.06, h: 0.05, d: 0.44, color: straw },
    ]);
  }

  /**
   * 여닫이 문 — 방벽 사이에 낀 철판 문짝.
   *
   * 방벽과 확실히 달라 보여야 한다. 둘러친 벽을 한 바퀴 돌면서
   * "어디가 문이었지"를 찾게 만들면 안 되기 때문이다.
   * 그래서 색을 밝게 하고, 가운데를 비우고, 경첩과 빗장을 붙인다.
   */
  private static gateGeometry(): THREE.BufferGeometry {
    const frame = new THREE.Color(0x6b6a62);
    const plate = new THREE.Color(0x8a7a58);
    const metal = new THREE.Color(0x8b939c);
    const h = BUILD.wallHeight;
    return mergeBoxes([
      // 좌우 기둥 — 문틀
      { x: -0.46, y: 0, z: 0, w: 0.16, h, d: 0.34, color: frame },
      { x: 0.46, y: 0, z: 0, w: 0.16, h, d: 0.34, color: frame },
      // 상인방
      { x: 0, y: h / 2 - 0.1, z: 0, w: 1.0, h: 0.2, d: 0.36, color: frame },
      // 문짝 — 판 둘을 가로대로 묶었다
      { x: 0, y: -0.15, z: 0.02, w: 0.78, h: h - 0.34, d: 0.1, color: plate },
      { x: 0, y: 0.35, z: 0.06, w: 0.74, h: 0.1, d: 0.06, color: metal },
      { x: 0, y: -0.55, z: 0.06, w: 0.74, h: 0.1, d: 0.06, color: metal },
      // 경첩과 빗장
      { x: -0.36, y: 0.35, z: 0.09, w: 0.1, h: 0.16, d: 0.06, color: metal },
      { x: -0.36, y: -0.55, z: 0.09, w: 0.1, h: 0.16, d: 0.06, color: metal },
      { x: 0.3, y: -0.1, z: 0.1, w: 0.22, h: 0.07, d: 0.07, color: metal },
    ]);
  }

  /** 작업대 — 잔해를 잘라 만든 상판에 연장을 올려둔 모양 */
  private static workbenchGeometry(): THREE.BufferGeometry {
    const wood = new THREE.Color(0x7a6444);
    const metal = new THREE.Color(0x6d747c);
    const dark = new THREE.Color(0x4a4238);
    return mergeBoxes([
      // 상판
      { x: 0, y: 0.86, z: 0, w: 1.15, h: 0.11, d: 0.75, color: wood },
      { x: 0, y: 0.78, z: 0, w: 1.05, h: 0.06, d: 0.66, color: dark },
      // 다리 넷
      { x: -0.48, y: 0.38, z: -0.28, w: 0.1, h: 0.78, d: 0.1, color: metal },
      { x: 0.48, y: 0.38, z: -0.28, w: 0.1, h: 0.78, d: 0.1, color: metal },
      { x: -0.48, y: 0.38, z: 0.28, w: 0.1, h: 0.78, d: 0.1, color: metal },
      { x: 0.48, y: 0.38, z: 0.28, w: 0.1, h: 0.78, d: 0.1, color: metal },
      // 아래 선반과 그 위의 잔해
      { x: 0, y: 0.24, z: 0, w: 0.95, h: 0.06, d: 0.5, color: dark },
      { x: -0.2, y: 0.33, z: 0.02, w: 0.24, h: 0.14, d: 0.2, color: metal },
      // 상판 위 연장
      { x: 0.28, y: 0.96, z: -0.1, w: 0.36, h: 0.09, d: 0.12, color: metal },
      { x: -0.3, y: 0.95, z: 0.14, w: 0.14, h: 0.08, d: 0.28, color: dark },
    ]);
  }

  /** 보관함 — 뚜껑을 살짝 어긋나게 얹은 금속 궤짝 */
  private static storageGeometry(): THREE.BufferGeometry {
    const body = new THREE.Color(0x7d6544);
    const band = new THREE.Color(0x6a707a);
    const lid = new THREE.Color(0x8b7250);
    return mergeBoxes([
      { x: 0, y: 0.3, z: 0, w: 0.94, h: 0.56, d: 0.66, color: body },
      { x: 0, y: 0.61, z: -0.02, w: 0.98, h: 0.1, d: 0.7, color: lid },
      // 보강 띠
      { x: -0.34, y: 0.3, z: 0, w: 0.08, h: 0.58, d: 0.69, color: band },
      { x: 0.34, y: 0.3, z: 0, w: 0.08, h: 0.58, d: 0.69, color: band },
      // 걸쇠
      { x: 0, y: 0.5, z: 0.34, w: 0.14, h: 0.16, d: 0.06, color: band },
    ]);
  }

  private buildMeshes(): void {
    const plotGeo = Buildings.plotGeometry();
    const plotMat = new THREE.MeshStandardMaterial({
      // 갈아엎은 흙 — 주변 콘크리트와 확실히 구분되어야 밭이 눈에 들어온다
      vertexColors: true,
      roughness: 0.99,
      flatShading: true,
    });
    this.plotMesh = new THREE.InstancedMesh(plotGeo, plotMat, MAX_PLACED);
    this.plotMesh.name = 'build:plot';
    this.plotMesh.count = 0;
    this.plotMesh.receiveShadow = true;
    this.plotMesh.castShadow = true;
    this.group.add(this.plotMesh);

    // 작물 — 성장도에 따라 자라는 낮은 원뿔
    const cropGeos = cropStages();
    const cropMat = new THREE.MeshStandardMaterial({
      // 잎은 초록, 이삭은 누렇다 — 한 재질로 둘을 그리려면 정점 색뿐이다
      vertexColors: true,
      roughness: 0.88,
      side: THREE.DoubleSide,
    });
    this.cropMeshes = cropGeos.map((geo, i) => {
      const mesh = new THREE.InstancedMesh(geo, cropMat, MAX_PLACED);
      mesh.name = `build:crop${i}`;
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    });

    const colGeo = new THREE.CylinderGeometry(0.52, 0.2, 0.72, 6, 1, true);
    const colMat = new THREE.MeshStandardMaterial({
      color: 0x9aa1a6,
      roughness: 0.5,
      metalness: 0.4,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    this.collectorMesh = new THREE.InstancedMesh(colGeo, colMat, MAX_PLACED);
    this.collectorMesh.name = 'build:collector';
    this.collectorMesh.count = 0;
    this.collectorMesh.castShadow = true;
    this.collectorMesh.receiveShadow = true;
    this.group.add(this.collectorMesh);

    // 잔해 방벽 — 무너진 것을 다시 쌓아 올린 벽
    this.wallMesh = new THREE.InstancedMesh(
      Buildings.wallGeometry(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        metalness: 0.2,
        flatShading: true,
      }),
      MAX_PLACED,
    );
    this.wallMesh.name = 'build:wall';
    this.wallMesh.count = 0;
    this.wallMesh.castShadow = true;
    this.wallMesh.receiveShadow = true;
    this.group.add(this.wallMesh);

    // 잔해 함정 — 길목에 묻는다
    this.trapMesh = new THREE.InstancedMesh(
      Buildings.trapGeometry(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.6,
        metalness: 0.45,
        flatShading: true,
      }),
      MAX_PLACED,
    );
    this.trapMesh.name = 'build:trap';
    this.trapMesh.count = 0;
    this.trapMesh.castShadow = true;
    this.trapMesh.receiveShadow = true;
    this.group.add(this.trapMesh);

    // 퇴비 더미 — 유기물을 삭혀 흙으로 되돌린다
    this.compostMesh = new THREE.InstancedMesh(
      Buildings.compostGeometry(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.97,
        flatShading: true,
      }),
      MAX_PLACED,
    );
    this.compostMesh.name = 'build:compost';
    this.compostMesh.count = 0;
    this.compostMesh.castShadow = true;
    this.compostMesh.receiveShadow = true;
    this.group.add(this.compostMesh);

    // 여닫이 문 — 같은 자리에 서지만 판이 얇고 경첩이 보인다
    this.gateMesh = new THREE.InstancedMesh(
      Buildings.gateGeometry(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.82,
        metalness: 0.3,
        flatShading: true,
      }),
      MAX_PLACED,
    );
    this.gateMesh.name = 'build:gate';
    this.gateMesh.count = 0;
    this.gateMesh.castShadow = true;
    this.gateMesh.receiveShadow = true;
    this.group.add(this.gateMesh);

    // 화톳불 — 받침과 불꽃
    this.fireMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.42, 0.5, 0.24, 7),
      new THREE.MeshStandardMaterial({
        color: 0x4c4741,
        roughness: 0.95,
        flatShading: true,
      }),
      MAX_PLACED,
    );
    this.fireMesh.name = 'build:fire';
    this.fireMesh.count = 0;
    this.fireMesh.castShadow = true;
    this.fireMesh.receiveShadow = true;
    this.group.add(this.fireMesh);

    this.flameMesh = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.26, 0.62, 6),
      // 불꽃은 조명을 받지 않고 스스로 빛난다
      new THREE.MeshBasicMaterial({ color: BUILD.fireColor }),
      MAX_PLACED,
    );
    this.flameMesh.name = 'build:flame';
    this.flameMesh.count = 0;
    this.group.add(this.flameMesh);

    // 작업대 — 상판과 다리, 위에 올려둔 연장
    this.benchMesh = new THREE.InstancedMesh(
      Buildings.workbenchGeometry(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.72,
        metalness: 0.3,
        flatShading: true,
      }),
      MAX_PLACED,
    );
    this.benchMesh.name = 'build:workbench';
    this.benchMesh.count = 0;
    this.benchMesh.castShadow = true;
    this.benchMesh.receiveShadow = true;
    this.group.add(this.benchMesh);

    // 보관함 — 뚜껑을 살짝 얹은 궤짝
    this.boxMesh = new THREE.InstancedMesh(
      Buildings.storageGeometry(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.82,
        metalness: 0.22,
        flatShading: true,
      }),
      MAX_PLACED,
    );
    this.boxMesh.name = 'build:storage';
    this.boxMesh.count = 0;
    this.boxMesh.castShadow = true;
    this.boxMesh.receiveShadow = true;
    this.group.add(this.boxMesh);

    // 설치 미리보기 — 얇은 판을 칸마다 띄운다
    this.ghostMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.94, 0.05, 0.94),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      }),
      GHOST_MAX,
    );
    this.ghostMesh.name = 'build:ghost';
    this.ghostMesh.count = 0;
    this.ghostMesh.visible = false;
    this.ghostMesh.frustumCulled = false;
    this.ghostMesh.renderOrder = 5;
    this.group.add(this.ghostMesh);

    // 일군 흔적 — 밭 둘레에 떨어진 흙덩이. 밭 한 칸당 여섯 개까지.
    const clumpGeo = new THREE.DodecahedronGeometry(0.1, 0);
    const clumpMat = new THREE.MeshStandardMaterial({
      color: 0x533d24,
      roughness: 1,
      flatShading: true,
    });
    this.clumpMesh = new THREE.InstancedMesh(clumpGeo, clumpMat, MAX_PLACED * CLUMPS_PER_PLOT);
    this.clumpMesh.name = 'build:clump';
    this.benchMesh.count = 0;
    this.boxMesh.count = 0;
    this.clumpMesh.count = 0;
    this.clumpMesh.castShadow = true;
    this.clumpMesh.receiveShadow = true;
    this.group.add(this.clumpMesh);
  }

  /**
   * 이 칸에 방벽을 세운다면 어느 쪽으로 서야 하는가.
   *
   * 방벽 판은 가로 1m · 두께 0.34m 라 방향이 있다. 방향을 손으로만 돌리게 두면
   * 대부분은 R 이 있다는 것도 모른 채 한 방향으로만 늘어놓다가
   * **구역을 두르는 데 실패한다.** 실제로 그런 보고를 받았다.
   *
   * 그래서 옆 칸을 보고 이어지는 쪽으로 알아서 돈다 — 줄을 긋다 모퉁이에서
   * 꺾으면 벽도 같이 꺾인다. 손으로 정하고 싶으면 R 로 덮어쓸 수 있다.
   */
  suggestRotation(gx: number, gz: number): 0 | 1 {
    const along = (dx: number, dz: number): number => {
      const n = this.cells.get(this.key(gx + dx, gz + dz));
      return n && (n.kind === 'wall' || n.kind === 'gate') ? 1 : 0;
    };
    const x = along(1, 0) + along(-1, 0);
    const z = along(0, 1) + along(0, -1);
    // 모퉁이(양쪽 다 있음)는 무승부다. 그때는 가로로 둔다 —
    // 어느 쪽으로 서든 한 면은 어긋나므로, 적어도 일관되게 어긋나는 편이 낫다.
    if (z > x) return 1;
    return 0;
  }

  /**
   * 설치 미리보기.
   *
   * 팰월드처럼 "어디에 어떤 모양으로 놓일지"를 먼저 보여준다.
   * 칸마다 초록(가능) / 붉은색(불가)으로 칠해서, 왜 못 놓는지가 위치로 읽힌다.
   *
   * @param orient 방향이 있는 설치물이면 그 방향 — 미리보기 판이 같이 눕는다.
   *   방향을 눈으로 못 보면 R 을 눌러도 바뀐 줄 모른다.
   */
  showGhost(cells: BedCell[], orient: 0 | 1 | null = null): void {
    const n = Math.min(cells.length, GHOST_MAX);
    for (let i = 0; i < n; i++) {
      const c = cells[i]!;
      this.v.set(c.x, c.y + 0.09, c.z);
      this.q.identity();
      if (orient === null) this.s.set(1, 1, 1);
      else if (orient === 0) this.s.set(1, 1, 0.36);
      else this.s.set(0.36, 1, 1);
      this.m.compose(this.v, this.q, this.s);
      this.ghostMesh.setMatrixAt(i, this.m);

      if (!c.ok) {
        this.ghostColor.setRGB(0.85, 0.22, 0.16);
      } else {
        // 비옥할수록 진한 초록 — 어느 칸이 좋은 땅인지 눈으로 고를 수 있다
        const t = clamp((c.fertility - FARM.minFertility) / (1 - FARM.minFertility), 0, 1);
        this.ghostColor.setRGB(0.42 - t * 0.28, 0.6 + t * 0.32, 0.24 - t * 0.1);
      }
      this.ghostMesh.setColorAt(i, this.ghostColor);
    }
    this.ghostMesh.count = n;
    this.ghostMesh.instanceMatrix.needsUpdate = true;
    if (this.ghostMesh.instanceColor) this.ghostMesh.instanceColor.needsUpdate = true;
    this.ghostMesh.visible = n > 0;
  }

  hideGhost(): void {
    this.ghostMesh.count = 0;
    this.ghostMesh.visible = false;
  }

  /** 밭을 새로 일굴 때 주변에 흙덩이를 흩뿌린다 */
  private scatterClumps(node: Placed): void {
    for (let i = 0; i < CLUMPS_PER_PLOT; i++) {
      if (this.clumpCount >= MAX_PLACED * CLUMPS_PER_PLOT) return;

      const a = this.clumpRng.range(0, Math.PI * 2);
      const r = this.clumpRng.range(0.55, 0.95);
      const x = node.x + Math.cos(a) * r;
      const z = node.z + Math.sin(a) * r;
      const s = this.clumpRng.range(0.5, 1.15);

      this.v.set(x, this.terrain.sampleHeight(x, z) + 0.05 * s, z);
      this.s.setScalar(s);
      this.q.setFromEuler(
        new THREE.Euler(
          this.clumpRng.range(0, Math.PI),
          this.clumpRng.range(0, Math.PI),
          this.clumpRng.range(0, Math.PI),
        ),
      );
      this.m.compose(this.v, this.q, this.s);
      this.clumpMesh.setMatrixAt(this.clumpCount++, this.m);
    }
    this.clumpMesh.count = this.clumpCount;
    this.clumpMesh.instanceMatrix.needsUpdate = true;
    this.boundsDirty = true;
  }

  private writeInstance(node: Placed): void {
    if (node.kind === 'collector') {
      this.v.set(node.x, node.y + 0.4, node.z);
      this.s.setScalar(1);
      this.q.identity();
      this.m.compose(this.v, this.q, this.s);
      this.collectorMesh.setMatrixAt(node.index, this.m);
      this.collectorMesh.count = this.collectors.length;
      return;
    }

    if (node.kind === 'wall' || node.kind === 'gate') {
      this.v.set(node.x, node.y + BUILD.wallHeight / 2 - 0.2, node.z);
      this.s.setScalar(1);
      // 판을 세운 방향. 90도 돌려야 다른 축을 따라 서고, 그래야 구역을 두를 수 있다.
      this.q.setFromAxisAngle(UP_AXIS, node.rot === 1 ? Math.PI / 2 : 0);
      this.m.compose(this.v, this.q, this.s);

      if (node.kind === 'wall') {
        this.wallMesh.setMatrixAt(node.index, this.m);
        this.wallMesh.count = this.byKind.wall.length;
        return;
      }

      // 열린 문은 문짝을 옆으로 젖혀 놓는다 — 문틀은 그대로 남아
      // "여기가 출입구"라는 표시가 유지된다
      if (node.openGate) {
        this.q.setFromAxisAngle(UP_AXIS, (node.rot === 1 ? Math.PI / 2 : 0) + Math.PI / 2.2);
        this.m.compose(this.v, this.q, this.s);
      }
      this.gateMesh.setMatrixAt(node.index, this.m);
      this.gateMesh.count = this.byKind.gate.length;
      return;
    }

    if (node.kind === 'trap') {
      // 닳을수록 날이 주저앉는다 — 남은 횟수를 숫자 없이 보여주는 방법
      const left = clamp01(node.stored / BUILD.trapUses);
      this.v.set(node.x, node.y, node.z);
      this.s.set(1, 0.45 + 0.55 * left, 1);
      this.q.identity();
      this.m.compose(this.v, this.q, this.s);
      this.trapMesh.setMatrixAt(node.index, this.m);
      this.trapMesh.count = this.byKind.trap.length;
      return;
    }

    if (node.kind === 'compost') {
      // 넣어둔 유기물이 많을수록 더미가 봉긋해진다 —
      // 뚜껑을 열어보지 않아도 얼마나 찼는지 보인다
      const fill = 0.55 + 0.45 * clamp01(node.moisture / FARM.compostInputMax);
      this.v.set(node.x, node.y, node.z);
      this.s.set(1, fill, 1);
      this.q.identity();
      this.m.compose(this.v, this.q, this.s);
      this.compostMesh.setMatrixAt(node.index, this.m);
      this.compostMesh.count = this.byKind.compost.length;
      return;
    }

    if (node.kind === 'workbench' || node.kind === 'storage') {
      const mesh = node.kind === 'workbench' ? this.benchMesh : this.boxMesh;
      this.v.set(node.x, node.y, node.z);
      this.s.setScalar(1);
      this.q.identity();
      this.m.compose(this.v, this.q, this.s);
      mesh.setMatrixAt(node.index, this.m);
      mesh.count = this.byKind[node.kind].length;
      return;
    }

    if (node.kind === 'campfire') {
      // 화덕(돌·잔해)은 꺼져도 그대로 남는다. 자리를 잃으면 다시 살릴 수도 없다.
      this.v.set(node.x, node.y + 0.12, node.z);
      this.s.setScalar(1);
      this.q.identity();
      this.m.compose(this.v, this.q, this.s);
      this.fireMesh.setMatrixAt(node.index, this.m);
      this.fireMesh.count = this.byKind.campfire.length;

      // 불꽃만 사위고 꺼진다
      if (node.fuel <= 0) {
        this.flameMesh.setMatrixAt(node.index, ZERO_MATRIX);
      } else {
        // 잔량이 낮으면 작아진다. 다 차 있어도 커지지는 않는다 —
        // 가득한 불이 두 배로 부풀면 불이 아니라 풍선처럼 보인다.
        const k = 0.45 + 0.55 * Math.min(1, node.fuel / BUILD.fuelLowLevel);
        this.v.set(node.x, node.y + 0.42, node.z);
        this.s.set(0.8 + 0.2 * k, k, 0.8 + 0.2 * k);
        this.m.compose(this.v, this.q, this.s);
        this.flameMesh.setMatrixAt(node.index, this.m);
      }
      this.flameMesh.count = this.byKind.campfire.length;
      return;
    }

    // 밭 — 여기가 마지막 종류다.
    //
    // 예전엔 이 꼬리가 "나머지 전부"였다. 그러면 새 종류가 밭 모양으로 그려지고
    // 밭의 인스턴스 번호를 덮어써 멀쩡한 밭까지 자리를 잃는다.
    // 종류가 늘면 이 줄에서 먼저 컴파일이 깨진다.
    if (node.kind !== 'plot') {
      node.kind satisfies never;
      return;
    }

    this.v.set(node.x, node.y + 0.05, node.z);
    this.s.setScalar(1);
    this.q.identity();
    this.m.compose(this.v, this.q, this.s);
    this.plotMesh.setMatrixAt(node.index, this.m);
    this.plotMesh.count = this.plots.length;

    // 작물: 심지 않았으면 접어둔다
    // 어느 단계의 형상을 쓸지 고르고, 나머지 둘은 접어둔다
    const stage = node.stage === 'empty' ? -1 : node.growth < 0.35 ? 0 : node.growth < 0.75 ? 1 : 2;
    for (let i = 0; i < this.cropMeshes.length; i++) {
      const mesh = this.cropMeshes[i]!;
      if (i === stage) {
        // 단계 안에서의 진행도로 크기를 줘야 자라는 게 이어져 보인다
        const lo = stage === 0 ? 0 : stage === 1 ? 0.35 : 0.75;
        const hi = stage === 0 ? 0.35 : stage === 1 ? 0.75 : 1;
        const local = clamp01((node.growth - lo) / (hi - lo));
        const k = 0.72 + 0.28 * local;
        this.v.set(node.x, node.y + 0.08, node.z);
        this.s.setScalar(k);
        this.m.compose(this.v, this.q, this.s);
        mesh.setMatrixAt(node.index, this.m);
      } else {
        mesh.setMatrixAt(node.index, ZERO_MATRIX);
      }
      mesh.count = this.plots.length;
    }
  }

  private flush(kind: BuildKind): void {
    // 인스턴스가 움직였으니 경계구도 다시 재야 한다
    this.boundsDirty = true;
    switch (kind) {
      case 'collector':
        this.collectorMesh.instanceMatrix.needsUpdate = true;
        return;
      case 'wall':
        this.wallMesh.instanceMatrix.needsUpdate = true;
        return;
      case 'gate':
        this.gateMesh.instanceMatrix.needsUpdate = true;
        return;
      case 'compost':
        this.compostMesh.instanceMatrix.needsUpdate = true;
        return;
      case 'trap':
        this.trapMesh.instanceMatrix.needsUpdate = true;
        return;
      case 'campfire':
        this.fireMesh.instanceMatrix.needsUpdate = true;
        this.flameMesh.instanceMatrix.needsUpdate = true;
        return;
      case 'workbench':
        this.benchMesh.instanceMatrix.needsUpdate = true;
        return;
      case 'storage':
        this.boxMesh.instanceMatrix.needsUpdate = true;
        return;
      case 'plot':
        this.plotMesh.instanceMatrix.needsUpdate = true;
        for (const mesh of this.cropMeshes) mesh.instanceMatrix.needsUpdate = true;
        return;
      default:
        // meshesFor 와 같은 이유로 기본 가지를 비워 둔다. 예전엔 밭이 여기 얹혀
        // 있었는데, 그러면 새 종류의 버퍼는 아무도 안 올려 인스턴스를 써도
        // 화면이 안 바뀐다. 종류가 늘면 여기서 컴파일이 깨진다.
        kind satisfies never;
    }
  }

  /** 상태가 바뀐 밭 하나를 다시 그린다 */
  refresh(node: Placed): void {
    this.writeInstance(node);
    this.flush(node.kind);
  }

  /** 세이브용 — 지어둔 것 전부 */
  serialize(): Array<{
    kind: BuildKind;
    gx: number;
    gz: number;
    stage: PlotStage;
    growth: number;
    moisture: number;
    stored: number;
    fertility?: number;
    /** 화톳불 연료 — v0.3에서 추가. 옛 세이브에는 없다 */
    fuel?: number;
    /** 방벽·문이 선 방향 (v0.3.1) */
    rot?: number;
    /** 문이 열려 있는지 (v0.3.1) */
    openGate?: boolean;
  }> {
    return this.placed.map((p) => ({
      kind: p.kind,
      gx: p.gx,
      gz: p.gz,
      stage: p.stage,
      growth: p.growth,
      moisture: p.moisture,
      stored: p.stored,
      fertility: p.fertility,
      fuel: p.fuel,
      rot: p.rot,
      openGate: p.openGate,
    }));
  }

  restore(list: ReturnType<Buildings['serialize']>): void {
    this.reset();
    for (const s of list) {
      // 지형 조건은 다시 검사하지 않는다 — 이미 한 번 놓였던 자리다
      const wx = s.gx * CELL;
      const wz = s.gz * CELL;
      const bucket = this.byKind[s.kind];
      if (!bucket) continue; // 알 수 없는 종류의 세이브는 건너뛴다
      const node: Placed = {
        kind: s.kind,
        gx: s.gx,
        gz: s.gz,
        x: wx,
        y: this.terrain.sampleHeight(wx, wz),
        z: wz,
        index: bucket.length,
        stage: s.stage,
        growth: s.growth,
        moisture: s.moisture,
        stored: s.stored,
        // 옛 세이브에는 연료가 없다. 그때는 불이 꺼지지 않았으므로
        // 가득 찬 것으로 본다 — 돌아와 보니 거점이 다 꺼져 있으면 억울하다.
        fuel: s.fuel ?? (s.kind === 'campfire' ? BUILD.fuelCapacity : 0),
        rot: s.rot === 1 ? 1 : 0,
        openGate: s.openGate ?? false,
        // 옛 세이브에는 비옥도가 없다 — 지형에서 다시 읽어 채운다
        fertility: s.fertility ?? this.terrain.sampleSoilRichness(wx, wz),
      };
      this.placed.push(node);
      bucket.push(node);
      this.cells.set(this.key(s.gx, s.gz), node);
      this.registerCollider(node);
      this.writeInstance(node);
      if (s.kind === 'plot') this.scatterClumps(node);
      if (s.kind === 'campfire') this.addFireLight(node);
      // 보관함은 껍데기만 살려서는 안 된다. 내용물 객체가 없으면 열리지도 않고,
      // 뒤이어 오는 restoreStorage 가 넣을 곳을 못 찾아 **저장된 물건이 통째로 사라진다.**
      if (s.kind === 'storage') this.boxes.set(node, new StorageBox());
    }
    for (const kind of ALL_KINDS) this.flush(kind);
  }

  /** 사망 후 초기화 — 지어둔 것은 전부 사라진다 */
  reset(): void {
    this.placed.length = 0;
    for (const kind of ALL_KINDS) this.byKind[kind].length = 0;
    this.cells.clear();
    this.colliders.clear();
    this.boxes.clear();
    // count 를 0 으로 되돌린 메시는 빈 경계구를 다시 물게 된다. 다음에 지을 때
    // 다시 재주지 않으면 시선 방향에 따라 통째로 사라진다 (8.3의 그 규칙이다).
    this.boundsDirty = true;

    for (const light of this.fireLights) this.group.remove(light);
    this.fireLights.length = 0;

    // 메시를 손으로 나열하면 종류가 늘 때마다 하나씩 빠뜨린다. 실제로 문·퇴비·
    // 함정·작업대·보관함이 빠져 있었고, 그래서 죽고 살아나면 **만질 수 없는
    // 껍데기만 그대로 서 있었다.** 자료는 지워졌는데 그림만 남은 것이다.
    // 종류 표를 돌게 하면 종류를 더해도 다시는 어긋나지 않는다.
    for (const kind of ALL_KINDS) {
      for (const mesh of this.meshesFor(kind)) mesh.count = 0;
    }
    this.ghostMesh.count = 0;
    this.ghostMesh.visible = false;
    this.clumpMesh.count = 0;
    this.clumpCount = 0;
    // 흙덩이 위치를 시드로 되돌린다 — 같은 세이브는 같은 흔적을 남겨야 한다
    this.clumpRng.reseed(4242);
    this.clumpMesh.instanceMatrix.needsUpdate = true;
    for (const kind of ALL_KINDS) this.flush(kind);
  }

  get stats(): {
    plots: number;
    collectors: number;
    walls: number;
    fires: number;
    ripe: number;
    /** 물이 말라 자라지 못하는 밭 */
    dry: number;
    /** 아직 심지 않은 빈 밭 */
    empty: number;
    /** 뜰 수 있는 빗물이 고인 집수기 */
    filled: number;
    /** 꺼진 화톳불 — 다시 살리려면 마른 풀이 필요하다 */
    firesOut: number;
    /** 곧 꺼질 화톳불 */
    firesLow: number;
    /** 꺼낼 수 있는 흙이 삭아 있는 퇴비 더미 */
    compostReady: number;
    /** 퇴비 더미 수 — 정착지 등급이 설비로 센다 */
    compost: number;
  } {
    // 매 프레임 호출되므로 filter를 네 번 돌려 배열을 네 개 만들지 않는다
    let ripe = 0;
    let dry = 0;
    let empty = 0;
    for (const p of this.plots) {
      if (p.stage === 'ripe') ripe++;
      else if (p.stage === 'empty') empty++;
      else if (p.moisture <= 0) dry++;
    }
    let filled = 0;
    for (const c of this.collectors) if (c.stored > 0) filled++;

    let firesOut = 0;
    let firesLow = 0;
    for (const f of this.byKind.campfire) {
      if (f.fuel <= 0) firesOut++;
      else if (f.fuel < BUILD.fuelLowLevel) firesLow++;
    }

    let compostReady = 0;
    for (const b of this.byKind.compost) if (b.stored > 0) compostReady++;

    return {
      plots: this.plots.length,
      collectors: this.collectors.length,
      walls: this.byKind.wall.length,
      fires: this.byKind.campfire.length,
      ripe,
      dry,
      empty,
      filled,
      firesOut,
      firesLow,
      compostReady,
      compost: this.byKind.compost.length,
    };
  }

  /**
   * 나침반에 띄울 거점 표지.
   * 밭 하나하나가 아니라 설비 단위로만 — 표지가 스무 개씩 뜨면 아무 뜻이 없다.
   */
  landmarks(out: Array<{ x: number; z: number; kind: BuildKind; source?: Placed }> = []): Array<{
    x: number;
    z: number;
    kind: BuildKind;
    /**
     * 표지가 가리키는 실제 설치물.
     *
     * 이 목록은 설치물이 늘거나 줄 때만 다시 만든다. 연료처럼 매 순간 변하는
     * 값을 복사해 두면 곧 옛날 값이 되므로, 물건 자체를 들고 있다가 그때그때 읽는다.
     */
    source?: Placed;
  }> {
    out.length = 0;
    for (const kind of ['workbench', 'storage', 'campfire'] as BuildKind[]) {
      for (const node of this.byKind[kind]) {
        out.push({ x: node.x, z: node.z, kind, source: node });
      }
    }
    // 밭은 무리의 중심 하나만
    const plots = this.plots;
    if (plots.length > 0) {
      let cx = 0;
      let cz = 0;
      for (const p of plots) {
        cx += p.x;
        cz += p.z;
      }
      out.push({ x: cx / plots.length, z: cz / plots.length, kind: 'plot' });
    }
    return out;
  }

  /**
   * 비가 밭을 적신다.
   *
   * 물통을 들고 뛰어다니지 않아도 되는 날이 있어야 비가 반가운 일이 된다.
   * 아직 심지 않은 밭도 함께 적신다 — 비는 밭을 가리지 않는다.
   */
  soak(days: number): void {
    for (const plot of this.plots) {
      plot.moisture = Math.min(FARM.moistureMax, plot.moisture + days);
    }
  }

  /** 길잡이가 보는 현황 — 목표 판정에만 쓴다 */
  get guideStats(): {
    plots: number;
    planted: number;
    watered: number;
    ripe: number;
    fires: number;
    benches: number;
    collectors: number;
    compost: number;
    traps: number;
  } {
    let planted = 0;
    let watered = 0;
    let ripe = 0;
    for (const p of this.plots) {
      if (p.stage !== 'empty') planted++;
      if (p.moisture > 0) watered++;
      if (p.stage === 'ripe') ripe++;
    }
    return {
      plots: this.plots.length,
      planted,
      watered,
      ripe,
      fires: this.byKind.campfire.length,
      benches: this.byKind.workbench.length,
      collectors: this.byKind.collector.length,
      compost: this.byKind.compost.length,
      traps: this.byKind.trap.length,
    };
  }

  /** 세워둔 화톳불들 — 소리와 빛 계산에 쓴다 */
  get campfires(): ReadonlyArray<Placed> {
    return this.byKind.campfire;
  }

  /** 보관함 내용을 격자 좌표와 함께 내보낸다 */
  serializeStorage(): Array<{ gx: number; gz: number; slots: ReturnType<StorageBox['serialize']> }> {
    const out: Array<{ gx: number; gz: number; slots: ReturnType<StorageBox['serialize']> }> = [];
    for (const node of this.byKind.storage) {
      const box = this.boxes.get(node);
      if (box) out.push({ gx: node.gx, gz: node.gz, slots: box.serialize() });
    }
    return out;
  }

  /** 복원된 설치물에 내용물을 다시 채운다 (restore 이후에 부른다) */
  restoreStorage(list: Array<{ gx: number; gz: number; slots: Parameters<StorageBox['restore']>[0] }>): void {
    for (const entry of list) {
      const node = this.cells.get(this.key(entry.gx, entry.gz));
      if (!node || node.kind !== 'storage') continue;
      this.boxes.get(node)?.restore(entry.slots);
    }
  }

  /** 설치물이 바뀔 때마다 오르는 값 — 캐시 무효화에 쓴다 */
  get revision(): number {
    return this.placed.length;
  }

  /** 급수 시 채워지는 수분량을 0..1로 잘라 넣는다 */
  static water(node: Placed): void {
    node.moisture = clamp(node.moisture + FARM.moisturePerWatering, 0, FARM.moistureMax);
  }

  dispose(): void {
    // 여기서도 손으로 세지 않는다 — 빠뜨린 메시는 조용히 새기만 한다
    const meshes = [...this.boundsMeshes(), this.ghostMesh];
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}
